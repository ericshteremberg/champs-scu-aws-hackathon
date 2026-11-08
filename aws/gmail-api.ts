import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { ApiError } from './types.ts';
import { frontendOrigin } from './supabase-api.ts';
import type { GmailMessage } from '../lib/providers/types.ts';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const appSchema = z.object({ clientId: z.string().endsWith('.apps.googleusercontent.com'), clientSecret: z.string().min(1).max(4096), redirectUri: z.string().url(), scopes: z.array(z.literal(GMAIL_SCOPE)).length(1) });
export type GmailApp = z.infer<typeof appSchema>;
export type GmailTokens = { accessToken: string; refreshToken: string; expiresAt: number; email: string };
export const messageId = z.string().regex(/^[a-f0-9]{1,64}$/);
export const searchEmail = z.string().email().max(254).regex(/^[A-Za-z0-9.!#$%&'*+\-/=?^_`|~]+@[A-Za-z0-9.-]+$/);
export async function loadGmailApp(): Promise<GmailApp> {
  if (!process.env.GMAIL_OAUTH_SECRET_ARN) throw new ApiError(503, 'Gmail requires a one-time Google app registration by the Causality operator.', 'provider_not_configured');
  try {
    const result = await new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 }).send(new GetSecretValueCommand({ SecretId: process.env.GMAIL_OAUTH_SECRET_ARN }), { abortSignal: AbortSignal.timeout(4000) });
    const app = appSchema.parse(JSON.parse(result.SecretString || ''));
    if (app.redirectUri !== `${frontendOrigin()}/api/providers/gmail/callback`) throw new Error('Invalid callback');
    return app;
  } catch { throw new ApiError(503, 'Gmail configuration could not be loaded. Contact the workspace operator.', 'provider_not_configured'); }
}
async function request(url: string, init: RequestInit, empty = false): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || (response.status === 400 && url.endsWith('/token'))) throw new ApiError(409, 'Gmail authorization expired or was revoked. Disconnect and connect again.', 'provider_reauthorize');
      if (response.status === 403) throw new ApiError(403, 'Google denied access. Check Gmail API activation, consent and test-user access.', 'provider_forbidden');
      throw new ApiError(502, 'Gmail could not complete this request. Try again.', 'provider_unavailable');
    }
    if (empty) { await response.body?.cancel(); return null; }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, 'This email exceeds the connector preview limit. Import a selected excerpt manually.', 'provider_response_limit'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(502, 'Gmail could not complete this request. Try again.', 'provider_unavailable'); }
}
export async function exchangeGmailToken(app: GmailApp, fields: { grant_type: 'authorization_code'; code: string; code_verifier: string } | { grant_type: 'refresh_token'; refresh_token: string }): Promise<Omit<GmailTokens, 'email'>> {
  const value = await request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, client_id: app.clientId, client_secret: app.clientSecret, ...(fields.grant_type === 'authorization_code' ? { redirect_uri: app.redirectUri } : {}) }) });
  const parsed = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(16000).optional(), token_type: z.literal('Bearer'), expires_in: z.number().int().min(60).max(86400), scope: z.string().optional() }).safeParse(value);
  if (!parsed.success || (parsed.data.scope !== undefined && parsed.data.scope.split(' ').filter(Boolean).some(scope => scope !== GMAIL_SCOPE)) || (fields.grant_type === 'authorization_code' && (!parsed.data.refresh_token || parsed.data.scope !== GMAIL_SCOPE))) throw new ApiError(502, 'Google did not return the required read-only authorization. Disconnect and connect again.', 'provider_invalid_response');
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token || (fields.grant_type === 'refresh_token' ? fields.refresh_token : ''), expiresAt: Date.now() + parsed.data.expires_in * 1000 };
}
export async function revokeGmailToken(token: string) {
  await request('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }, true);
}
const read = (token: string, path: string) => request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
export async function gmailProfile(token: string): Promise<string> {
  const result = z.object({ emailAddress: z.string().email().max(320) }).safeParse(await read(token, 'profile'));
  if (!result.success) throw new ApiError(502, 'Gmail returned an invalid mailbox.', 'provider_invalid_response');
  return result.data.emailAddress.toLowerCase();
}
const header = z.object({ name: z.string().max(256), value: z.string().max(4096) });
const envelope = z.object({ id: messageId, threadId: messageId, internalDate: z.string().regex(/^\d{1,16}$/), payload: z.object({ headers: z.array(header).max(200).optional() }).passthrough() });
function summary(raw: unknown): GmailMessage {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw new ApiError(502, 'Gmail returned an unsupported message.', 'provider_invalid_response');
  const data = parsed.data; const headers = data.payload.headers || [];
  const field = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  const date = new Date(Number(data.internalDate));
  if (!Number.isFinite(date.getTime())) throw new ApiError(502, 'Gmail returned an invalid message date.', 'provider_invalid_response');
  return { id: data.id, threadId: data.threadId, subject: field('subject').slice(0, 500), from: field('from'), to: field('to'), occurredAt: date.toISOString() };
}
export async function searchGmail(token: string, email: string, topic?: 'policy') {
  if (!searchEmail.safeParse(email).success) throw new ApiError(400, 'This case needs a supported customer email address.', 'invalid_case_email');
  const query = `{from:${email} to:${email}}${topic === 'policy' ? ' {refund cancel cancellation terms policy consent checkout accepted acceptance agreed disclosure}' : ''}`;
  const result = z.object({ messages: z.array(z.object({ id: messageId })).max(10).optional(), nextPageToken: z.string().optional() }).safeParse(await read(token, `messages?${new URLSearchParams({ q: query, maxResults: '10', includeSpamTrash: 'false' })}`));
  if (!result.success) throw new ApiError(502, 'Gmail returned an invalid search response.', 'provider_invalid_response');
  const messages = await Promise.all((result.data.messages || []).map(async m => {
    const item = summary(await read(token, `messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To`));
    if (item.id !== m.id) throw new ApiError(502, 'Gmail returned a mismatched message.', 'provider_invalid_response');
    return item;
  }));
  return { messages, moreAvailable: !!result.data.nextPageToken };
}
export async function previewGmail(token: string, id: string): Promise<GmailMessage & { text: string; truncated: boolean }> {
  messageId.parse(id);
  const raw = await read(token, `messages/${id}?format=full`); const item = summary(raw);
  if (item.id !== id) throw new ApiError(502, 'Gmail returned a mismatched message.', 'provider_invalid_response');
  const texts: string[] = []; let parts = 0;
  function visit(value: unknown, depth: number) {
    if (++parts > 100 || depth > 10) throw new ApiError(413, 'This message has too many MIME parts. Import a selected excerpt manually.', 'provider_response_limit');
    const p = z.object({ mimeType: z.string().optional(), filename: z.string().optional(), body: z.object({ data: z.string().optional(), attachmentId: z.string().optional() }).optional(), headers: z.array(header).optional(), parts: z.array(z.unknown()).optional() }).safeParse(value);
    if (!p.success) throw new ApiError(502, 'Gmail returned unsupported message content.', 'provider_invalid_response');
    const v = p.data;
    if (v.filename || v.body?.attachmentId || v.mimeType === 'message/rfc822') return;
    if (v.mimeType === 'text/plain' && v.body?.data) {
      const contentType = v.headers?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
      const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
      if (charset && !['utf-8','us-ascii'].includes(charset)) return;
      texts.push(Buffer.from(v.body.data, 'base64url').toString('utf8').replace(/\u0000/g, ''));
    }
    for (const child of v.parts || []) visit(child, depth + 1);
  }
  visit((raw as { payload: unknown }).payload, 0);
  const text = texts.join('\n\n');
  if (!text.trim()) throw new ApiError(422, 'This email has no supported plain-text body. HTML and attachments are not imported; add a reviewed excerpt manually.', 'gmail_plain_text_required');
  return { ...item, text: text.slice(0, 20000), truncated: text.length > 20000 };
}
