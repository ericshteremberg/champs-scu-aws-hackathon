import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { commit, getItem } from './store.ts';
import { ApiError, type Stored, type StoreChange, type TrustedUser } from './types.ts';
import { auditChange, requireWorkspace } from './workspace.ts';
import { frontendOrigin } from './supabase-api.ts';
import { exchangeStripeOAuthToken, loadStripeOAuthApp, stripeAuthorizationUrl, verifyStripeOAuthRead, type StripeOAuthTokens } from './stripe-oauth-api.ts';
import type { StripeProviderConnection } from '../lib/providers/types.ts';

const connectionKey = 'provider#stripe';
const tokenKey = 'provider-token#stripe';
const pendingKey = 'provider-oauth#stripe';
type Pending = { stateHash: string; bindingHash: string; userId: string; connectionVersion: number; ttlEpochSeconds: number };
type Tokens = StripeOAuthTokens & { refreshing?: boolean };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (s: string, digest: string) => /^[a-f0-9]{64}$/.test(digest) && timingSafeEqual(Buffer.from(hash(s), 'hex'), Buffer.from(digest, 'hex'));
const bindingSchema = z.string().regex(/^[a-f0-9]{64}$/);
const actions = z.object({ action: z.enum(['verify', 'disconnect']) }).strict();

export async function stripeProviderStatus(wid: string) {
  const row = await getItem<StripeProviderConnection>(wid, connectionKey);
  const connection: StripeProviderConnection | null = row ? {
    status: row.data.status, updatedAt: row.data.updatedAt,
    ...(row.data.accountId ? { accountId: row.data.accountId } : {}),
    ...(row.data.mode ? { mode: row.data.mode } : {}),
    ...(row.data.lastVerifiedAt ? { lastVerifiedAt: row.data.lastVerifiedAt, chargeReadVerified: !!row.data.chargeReadVerified } : {}),
    ...(row.data.uninstallRequired ? { uninstallRequired: true } : {}),
  } : null;
  return { configured: !!process.env.STRIPE_OAUTH_SECRET_ARN, connection };
}

export async function startStripeProvider(user: TrustedUser, binding: string | undefined) {
  if (!bindingSchema.safeParse(binding).success) throw new ApiError(400, 'Start authorization from the Connections page.', 'oauth_browser_required');
  const wid = (await requireWorkspace(user)).data.id;
  const app = await loadStripeOAuthApp();
  const [connection, pending, token] = await Promise.all([getItem<StripeProviderConnection>(wid, connectionKey), getItem<Pending>(wid, pendingKey), getItem<Tokens>(wid, tokenKey)]);
  if ((connection && connection.data.status !== 'disconnected') || token) throw new ApiError(409, 'Disconnect the existing Stripe authorization before connecting again.', 'provider_already_connected');
  const state = randomBytes(32).toString('base64url');
  await commit(wid, [
    connection ? { key: connectionKey, expectedVersion: connection.version, check: true } : { key: connectionKey, expectedVersion: null, data: { status: 'disconnected', updatedAt: new Date().toISOString() } satisfies StripeProviderConnection },
    { key: pendingKey, expectedVersion: pending?.version ?? null, data: { stateHash: hash(state), bindingHash: hash(binding!), userId: user.userId, connectionVersion: connection?.version ?? 1, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Pending },
  ]);
  return { authorizationUrl: stripeAuthorizationUrl(app, state) };
}

export async function finishStripeProvider(user: TrustedUser, url: URL, binding: string | undefined) {
  const redirect = (result: string) => `${frontendOrigin()}/workspace?view=integrations&provider_result=stripe_${result}`;
  const wid = (await requireWorkspace(user)).data.id;
  const [pending, connection] = await Promise.all([getItem<Pending>(wid, pendingKey), getItem<StripeProviderConnection>(wid, connectionKey)]);
  const state = url.searchParams.get('state') || '';
  if (!bindingSchema.safeParse(binding).success || !pending || !connection || state.length > 200 || !same(state, pending.data.stateHash) || !same(binding!, pending.data.bindingHash) || pending.data.userId !== user.userId || pending.data.ttlEpochSeconds <= Date.now() / 1000 || pending.data.connectionVersion !== connection.version) return redirect('invalid_state');
  try { await commit(wid, [{ key: pendingKey, expectedVersion: pending.version, delete: true }, { key: connectionKey, expectedVersion: connection.version, check: true }]); }
  catch { return redirect('invalid_state'); }
  if (url.searchParams.has('error')) return redirect('denied');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) return redirect('failed');
  try {
    const token = await exchangeStripeOAuthToken(await loadStripeOAuthApp(), { grant_type: 'authorization_code', code });
    await commit(wid, [
      { key: connectionKey, expectedVersion: connection.version, data: { status: 'authorized', updatedAt: new Date().toISOString(), accountId: token.accountId, mode: token.mode } satisfies StripeProviderConnection },
      { key: tokenKey, expectedVersion: null, data: token },
      auditChange(user, 'provider.stripe_authorized', 'Authorized a Stripe account through the read-only Causality app. No disputes were imported.'),
    ]);
    return redirect('authorized');
  } catch { return redirect('failed'); }
}

async function active(wid: string) {
  const [connection, token] = await Promise.all([getItem<StripeProviderConnection>(wid, connectionKey), getItem<Tokens>(wid, tokenKey)]);
  if (!connection || connection.data.status !== 'authorized' || !token) throw new ApiError(409, 'Authorize Stripe to continue.', 'provider_disconnected');
  if (connection.data.accountId !== token.data.accountId || connection.data.mode !== token.data.mode) throw new ApiError(409, 'The Stripe account binding changed. Disconnect and authorize again.', 'provider_account_mismatch');
  return { connection, token };
}

async function access(wid: string): Promise<{ connection: Stored<StripeProviderConnection>; token: Stored<Tokens> }> {
  const loaded = await active(wid);
  if (loaded.token.data.refreshing) throw new ApiError(409, 'Stripe authorization refresh is in progress. If it does not finish, disconnect and authorize again.', 'provider_refresh_busy');
  if (loaded.token.data.expiresAt > Date.now() + 60_000) return loaded;
  const app = await loadStripeOAuthApp();
  if (app.mode !== loaded.token.data.mode) throw new ApiError(409, 'The Stripe environment changed. Disconnect and authorize again.', 'provider_account_mismatch');
  await commit(wid, [{ key: connectionKey, expectedVersion: loaded.connection.version, check: true }, { key: tokenKey, expectedVersion: loaded.token.version, data: { ...loaded.token.data, refreshing: true } }]);
  try {
    const fresh = await exchangeStripeOAuthToken(app, { grant_type: 'refresh_token', refresh_token: loaded.token.data.refreshToken });
    if (fresh.accountId !== loaded.token.data.accountId || fresh.mode !== loaded.token.data.mode) throw new ApiError(409, 'Stripe returned a different account during refresh. Disconnect and authorize again.', 'provider_account_mismatch');
    await commit(wid, [{ key: connectionKey, expectedVersion: loaded.connection.version, check: true }, { key: tokenKey, expectedVersion: loaded.token.version + 1, data: fresh }]);
    return { connection: loaded.connection, token: { key: tokenKey, version: loaded.token.version + 2, data: fresh } };
  } catch (error) {
    // Fail closed on an ambiguous refresh. Never restore a connection after disconnect.
    await commit(wid, [{ key: connectionKey, expectedVersion: loaded.connection.version, data: { ...loaded.connection.data, status: 'reconnect_required', updatedAt: new Date().toISOString() } }, { key: tokenKey, expectedVersion: loaded.token.version + 1, data: { ...loaded.token.data, refreshing: false } }]).catch(() => undefined);
    throw error;
  }
}

export async function stripeProviderAction(user: TrustedUser, input: unknown) {
  const parsed = actions.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid Stripe connection action.', 'invalid_request');
  const wid = (await requireWorkspace(user)).data.id;
  if (parsed.data.action === 'disconnect') {
    const [connection, token, pending] = await Promise.all([getItem<StripeProviderConnection>(wid, connectionKey), getItem<Tokens>(wid, tokenKey), getItem<Pending>(wid, pendingKey)]);
    if (!connection) return { connection: null };
    const data: StripeProviderConnection = { status: 'disconnected', updatedAt: new Date().toISOString(), uninstallRequired: !!token || !!connection.data.uninstallRequired || connection.data.status !== 'disconnected' };
    const changes: StoreChange[] = [{ key: connectionKey, expectedVersion: connection.version, data }, auditChange(user, 'provider.stripe_disconnected', 'Stopped Stripe reads and removed local credentials. Uninstall Causality in Stripe Installed Apps to revoke the provider grant.')];
    if (token) changes.push({ key: tokenKey, expectedVersion: token.version, delete: true });
    if (pending) changes.push({ key: pendingKey, expectedVersion: pending.version, delete: true });
    await commit(wid, changes);
    return { connection: data };
  }
  const { connection, token } = await access(wid);
  try {
    const verified = await verifyStripeOAuthRead(token.data);
    const timestamp = new Date().toISOString();
    const data: StripeProviderConnection = { ...connection.data, lastVerifiedAt: timestamp, updatedAt: timestamp, chargeReadVerified: verified.chargeReadVerified };
    await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data }, { key: tokenKey, expectedVersion: token.version, check: true }, auditChange(user, 'provider.stripe_verified', 'Checked read access using at most one dispute and its linked charge. No customer record contents were saved.')]);
    return { connection: data, ...verified };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'provider_reauthorize') await commit(wid, [{ key: connectionKey, expectedVersion: connection.version, data: { ...connection.data, status: 'reconnect_required', updatedAt: new Date().toISOString() } }, { key: tokenKey, expectedVersion: token.version, check: true }]).catch(() => undefined);
    throw error;
  }
}
