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
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, 'Stripe returned more data than this connection check supports.', 'provider_response_limit'); } chunks.push(next.value); }
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
