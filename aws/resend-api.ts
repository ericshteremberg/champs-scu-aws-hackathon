import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { ApiError } from './types.ts';

export const emailIdSchema = z.string().uuid();
export const resendEvents = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.failed', 'email.complained', 'email.suppressed'] as const;
const secretSchema = z.object({ apiKey: z.string().regex(/^re_[\w-]+$/), webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9+/=]+$/).optional() });
export async function loadResendSecret() {
  if (!process.env.RESEND_SECRET_ARN) throw new ApiError(503, 'Resend has not been configured.');
  try {
    const value = await new SecretsManagerClient({ region: 'us-east-1' }).send(new GetSecretValueCommand({ SecretId: process.env.RESEND_SECRET_ARN }));
    return secretSchema.parse(JSON.parse(value.SecretString || '{}'));
  } catch { throw new ApiError(503, 'The Resend credential could not be loaded.'); }
}
export const allowedResendDomains = () => (process.env.RESEND_ALLOWED_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export function allowedSender(from: string) {
  const email = /<([^<>]+)>$/.exec(from.trim())?.[1] || from.trim();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(email) && allowedResendDomains().includes(email.split('@')[1].toLowerCase());
}
export async function readResend(path: '/domains' | `/emails/${string}` | `/emails?${string}`) {
  if (path !== '/domains' && !/^\/emails\/[a-f0-9-]{36}$/i.test(path) && !/^\/emails\?limit=100(?:&after=[a-f0-9-]{36})?$/i.test(path)) throw new ApiError(400, 'Invalid Resend resource.');
  const { apiKey } = await loadResendSecret();
  try {
    const response = await fetch(`https://api.resend.com${path}`, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ApiError(response.status === 404 ? 404 : 502, response.status === 404 ? 'Resend could not return this email (404). The cause is not confirmed; check the account, email reference and retention.' : 'Resend could not return the requested record.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 512 * 1024) { await reader.cancel(); throw new ApiError(413, 'The Resend record is too large.'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'Resend could not return the requested record.'); }
}
export const sentEmailSchema = z.object({ id: emailIdSchema, from: z.string().max(500), to: z.array(z.string().email()).min(1).max(50), created_at: z.string().max(100), subject: z.string().max(2000), last_event: z.string().max(100).nullable().optional(), text: z.string().nullable().optional(), html: z.string().nullable().optional(), tags: z.array(z.object({ name: z.string(), value: z.string() })).optional() });

// Svix documented HMAC format, with constant-time comparison and a five-minute replay window.
export function verifyResendWebhook(body: string, headers: Record<string, string | undefined>, secret: string, now = Date.now()) {
  const id = headers['svix-id'] || '', timestamp = headers['svix-timestamp'] || '', signatures = headers['svix-signature'] || '';
  if (!/^msg_[A-Za-z0-9_-]{1,200}$/.test(id) || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || signatures.length > 4096 || !/^whsec_[A-Za-z0-9+/=]+$/.test(secret)) throw new ApiError(400, 'Invalid webhook signature.');
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest();
  const valid = signatures.split(' ').some(s => { const [version, encoded] = s.split(','); if (version !== 'v1' || !encoded) return false; const bytes = Buffer.from(encoded, 'base64'); return bytes.length === expected.length && timingSafeEqual(bytes, expected); });
  if (!valid) throw new ApiError(400, 'Invalid webhook signature.');
  return id;
}
