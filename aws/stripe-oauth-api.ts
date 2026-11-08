import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { ApiError } from './types.ts';
import { frontendOrigin } from './supabase-api.ts';

const appSchema = z.object({ clientId: z.string().regex(/^ca_[A-Za-z0-9]+$/), developerApiKey: z.string().regex(/^sk_(live|test)_[A-Za-z0-9]+$/), authorizeUrl: z.string().url().max(4096), mode: z.enum(['live', 'test']), redirectUri: z.string().url() });
export type StripeOAuthApp = z.infer<typeof appSchema>;
export type StripeOAuthTokens = { accessToken: string; refreshToken: string; accountId: string; mode: 'live' | 'test'; expiresAt: number };
export const stripeAccountId = z.string().regex(/^acct_[A-Za-z0-9]+$/);

export function stripeAuthorizationUrl(app: StripeOAuthApp, state: string): string {
  const url = new URL(app.authorizeUrl);
  // Preserve the private test path and parameters exactly. Never guess a test URL.
  if (url.origin !== 'https://marketplace.stripe.com' || url.username || url.password || url.hash || !/^\/oauth\/v2\/(?:[A-Za-z0-9_-]+\/)?authorize$/.test(url.pathname) || url.searchParams.getAll('client_id').length !== 1 || url.searchParams.get('client_id') !== app.clientId || url.searchParams.getAll('redirect_uri').length > 1 || (url.searchParams.has('redirect_uri') && url.searchParams.get('redirect_uri') !== app.redirectUri)) throw new ApiError(503, 'Stripe authorization configuration is invalid.', 'provider_not_configured');
  url.searchParams.set('state', state); url.searchParams.set('redirect_uri', app.redirectUri);
  return url.toString();
}

export async function loadStripeOAuthApp(): Promise<StripeOAuthApp> {
  if (!process.env.STRIPE_OAUTH_SECRET_ARN) throw new ApiError(503, 'Stripe authorization is not configured.', 'provider_not_configured');
  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 });
    const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.STRIPE_OAUTH_SECRET_ARN }), { abortSignal: AbortSignal.timeout(4000) });
    const app = appSchema.parse(JSON.parse(result.SecretString || ''));
    if (app.redirectUri !== `${frontendOrigin()}/api/providers/stripe/callback` || !app.developerApiKey.startsWith(`sk_${app.mode}_`)) throw new Error('Invalid callback or mode');
    stripeAuthorizationUrl(app, 'configuration-check');
    return app;
  } catch { throw new ApiError(503, 'Stripe authorization configuration could not be loaded. Contact the workspace operator.', 'provider_not_configured'); }
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(`https://api.stripe.com${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new ApiError(409, 'Stripe access expired or was revoked. Disconnect and authorize again.', 'provider_reauthorize');
      if (response.status === 403) throw new ApiError(403, 'Stripe denied this read. Check the app installation and read permissions.', 'provider_forbidden');
      throw new ApiError(502, 'Stripe could not complete the request. Try again.', 'provider_unavailable');
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, 'Stripe returned more data than this evidence read supports.', 'provider_response_limit'); } chunks.push(next.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'Stripe could not complete the request. Try again.', 'provider_unavailable');
  }
}

export async function exchangeStripeOAuthToken(app: StripeOAuthApp, fields: { grant_type: 'authorization_code'; code: string } | { grant_type: 'refresh_token'; refresh_token: string }): Promise<StripeOAuthTokens> {
  // The standard developer key is used only for token exchange/refresh.
  const value = await request('/v1/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${app.developerApiKey}:`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const parsed = z.object({ access_token: z.string().min(1).max(16000), refresh_token: z.string().min(1).max(16000), stripe_user_id: stripeAccountId, livemode: z.boolean(), scope: z.literal('stripe_apps'), token_type: z.literal('bearer'), expires_in: z.number().int().min(60).max(3600).optional() }).safeParse(value);
  if (!parsed.success || parsed.data.livemode !== (app.mode === 'live')) throw new ApiError(502, 'Stripe returned an unsupported account or environment. Authorize the intended account again.', 'provider_invalid_response');
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token, accountId: parsed.data.stripe_user_id, mode: app.mode, expiresAt: Date.now() + (parsed.data.expires_in ?? 3600) * 1000 };
}

export async function verifyStripeOAuthRead(tokens: StripeOAuthTokens): Promise<{ disputeReadVerified: true; chargeReadVerified: boolean }> {
  // No developer key, account override, expanded objects, or write endpoint is used here.
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };
  // Stripe returns both legacy and newer dispute/payment ID prefixes.
  const result = z.object({ object: z.literal('list'), data: z.array(z.object({ id: z.string().regex(/^(?:dp|du)_[A-Za-z0-9]+$/), livemode: z.boolean(), charge: z.string().regex(/^(?:ch|py)_[A-Za-z0-9]+$/).nullable() })).max(1) }).safeParse(await request('/v1/disputes?limit=1', { method: 'GET', headers }));
  if (!result.success || result.data.data.some(d => d.livemode !== (tokens.mode === 'live'))) throw new ApiError(502, 'Stripe returned an unexpected dispute response.', 'provider_invalid_response');
  const chargeId = result.data.data[0]?.charge;
  if (!chargeId) return { disputeReadVerified: true, chargeReadVerified: false };
  const charge = z.object({ id: z.string(), livemode: z.boolean() }).safeParse(await request(`/v1/charges/${encodeURIComponent(chargeId)}`, { method: 'GET', headers }));
  if (!charge.success || charge.data.id !== chargeId || charge.data.livemode !== (tokens.mode === 'live')) throw new ApiError(502, 'Stripe returned an unexpected payment response.', 'provider_invalid_response');
  return { disputeReadVerified: true, chargeReadVerified: true };
}

export const stripeDisputeId = z.string().regex(/^(?:dp|du)_[A-Za-z0-9]{1,120}$/);
const stripeChargeId = z.string().regex(/^(?:ch|py)_[A-Za-z0-9]{1,120}$/);
const stripePaymentId = z.string().regex(/^pi_[A-Za-z0-9]{1,120}$/);
/** The connected account exposes its customer receipt through the existing charge-read grant. */
export async function readStripeReceiptSource(tokens: StripeOAuthTokens, id: string) {
  if (!stripeChargeId.safeParse(id).success) throw new ApiError(400, 'Choose a valid charge.');
  const value = z.object({ id: stripeChargeId, object: z.literal('charge'), livemode: z.boolean(), paid: z.boolean(), amount: z.number().int().nonnegative(), currency: z.string(), created: z.number().int().positive(), payment_intent: stripePaymentId.nullable(), receipt_url: z.string().url().nullable(), metadata: z.record(z.string(), z.string()) }).safeParse(await request(`/v1/charges/${id}`, { method: 'GET', headers: { Authorization: `Bearer ${tokens.accessToken}` } }));
  if (!value.success || value.data.id !== id || value.data.livemode !== (tokens.mode === 'live')) throw new ApiError(502, 'Stripe returned an unexpected receipt source.');
  return value.data;
}
const disputeSchema = z.object({ id: stripeDisputeId, object: z.literal('dispute'), livemode: z.boolean(), amount: z.number().int().positive().max(999999999), currency: z.string().regex(/^[a-z]{3}$/), charge: stripeChargeId, payment_intent: stripePaymentId.nullable().optional(), reason: z.string().min(1).max(100), status: z.string().min(1).max(100), created: z.number().int().min(1).max(4102444800), evidence_details: z.object({ due_by: z.number().int().min(0).max(4102444800).nullable() }) });
const allowedDispute = (d: z.infer<typeof disputeSchema>, tokens: StripeOAuthTokens) => {
  if (d.livemode !== (tokens.mode === 'live')) throw new ApiError(502, 'Stripe returned a different environment.', 'provider_invalid_response');
  return { id: d.id, amount: d.amount, currency: d.currency, reason: d.reason, status: d.status, dueAt: d.evidence_details.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : '', createdAt: new Date(d.created * 1000).toISOString() };
};
export async function listStripeOAuthDisputes(tokens: StripeOAuthTokens) {
  const value = z.object({ object: z.literal('list'), data: z.array(disputeSchema).max(10), has_more: z.boolean() }).safeParse(await request('/v1/disputes?limit=10', { method: 'GET', headers: { Authorization: `Bearer ${tokens.accessToken}` } }));
  if (!value.success) throw new ApiError(502, 'Stripe returned unsupported dispute records.', 'provider_invalid_response');
  return { disputes: value.data.data.map(d => allowedDispute(d, tokens)), moreAvailable: value.data.has_more };
}
export async function readStripeOAuthDispute(tokens: StripeOAuthTokens, id: string) {
  if (!stripeDisputeId.safeParse(id).success) throw new ApiError(400, 'Choose a valid dispute.', 'invalid_request');
  const headers = { Authorization: `Bearer ${tokens.accessToken}` };
  const parsed = disputeSchema.safeParse(await request(`/v1/disputes/${encodeURIComponent(id)}`, { method: 'GET', headers }));
  if (!parsed.success || parsed.data.id !== id) throw new ApiError(502, 'Stripe returned an unexpected dispute.', 'provider_invalid_response');
  const summary = allowedDispute(parsed.data, tokens);
  const charge = z.object({ id: stripeChargeId, object: z.literal('charge'), livemode: z.boolean(), payment_intent: stripePaymentId.nullable(), currency: z.string(), amount: z.number().int().nonnegative(), billing_details: z.object({ email: z.string().max(254).nullable(), name: z.string().max(200).nullable() }).optional() }).safeParse(await request(`/v1/charges/${parsed.data.charge}`, { method: 'GET', headers }));
  if (!charge.success || charge.data.id !== parsed.data.charge || charge.data.livemode !== (tokens.mode === 'live') || charge.data.currency !== summary.currency || charge.data.amount < summary.amount || (parsed.data.payment_intent && parsed.data.payment_intent !== charge.data.payment_intent)) throw new ApiError(502, 'The dispute and payment could not be verified together.', 'provider_invalid_response');
  return { ...summary, chargeId: charge.data.id, paymentIntentId: charge.data.payment_intent, email: z.string().email().safeParse(charge.data.billing_details?.email).success ? charge.data.billing_details!.email! : '', customerName: charge.data.billing_details?.name || 'Stripe customer', accountId: tokens.accountId, mode: tokens.mode };
}
