import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), exchange: vi.fn(), verify: vi.fn() }));
vi.mock('../aws/store.ts', async original => {
  const actual = await original<typeof import('../aws/store.ts')>(); const { ConflictError } = await import('../aws/types.ts');
  return { ...actual,
    getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null),
    queryItems: async (wid: string, prefix: string) => [...fixture.rows].filter(([key]) => key.startsWith(`${wid}|${prefix}`)).map(([, row]) => structuredClone(row)),
    commit: async (wid: string, changes: StoreChange[]) => {
      for (const c of changes) if ((fixture.rows.get(`${wid}|${c.key}`)?.version ?? null) !== c.expectedVersion) throw new ConflictError();
      for (const c of changes) { if (c.check) continue; if (c.delete) fixture.rows.delete(`${wid}|${c.key}`); else fixture.rows.set(`${wid}|${c.key}`, structuredClone({ key: c.key, version: (c.expectedVersion ?? 0) + 1, data: c.data })); }
    },
  };
});
vi.mock('../aws/stripe-oauth-api.ts', async original => ({ ...await original<typeof import('../aws/stripe-oauth-api.ts')>(),
  loadStripeOAuthApp: async () => ({ clientId: 'ca_fictional', developerApiKey: 'synthetic_developer_key', authorizeUrl: 'https://marketplace.stripe.com/oauth/v2/fictional_private_test/authorize?client_id=ca_fictional', mode: 'live', redirectUri: 'https://dev.example.test/api/providers/stripe/callback' }),
  exchangeStripeOAuthToken: fixture.exchange, verifyStripeOAuthRead: fixture.verify,
}));
import { startStripeProvider, finishStripeProvider, stripeProviderAction, stripeProviderStatus } from '../aws/stripe-provider.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser } from '../aws/store.ts';
import { handler } from '../aws/handler.ts';
import { ApiError } from '../aws/types.ts';
const user: TrustedUser = { userId: 'stripe_oauth_owner', email: 'owner@example.test', displayName: 'Owner' };
const other = { ...user, userId: 'stripe_oauth_other' }; const wid = workspaceIdForUser(user.userId);
const key = (name: string) => `${wid}|${name}`; const binding = 'a'.repeat(64);
const tokens = () => ({ accessToken: 'synthetic_customer_access', refreshToken: 'synthetic_customer_refresh', accountId: 'acct_customer', mode: 'live' as const, expiresAt: Date.now() + 3600000 });
const start = async () => new URL((await startStripeProvider(user, binding)).authorizationUrl);
const callback = (u: URL) => new URL(`https://dev.example.test/api/providers/stripe/callback?code=fictional_code&state=${u.searchParams.get('state')}`);
async function authorize() { expect(await finishStripeProvider(user, callback(await start()), binding)).toContain('stripe_authorized'); }
function expire() { (fixture.rows.get(key('provider-token#stripe'))!.data as { expiresAt: number }).expiresAt = 1; }
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks(); process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test'; process.env.STRIPE_OAUTH_SECRET_ARN = 'synthetic_arn';
  fixture.exchange.mockImplementation(async () => tokens()); fixture.verify.mockResolvedValue({ disputeReadVerified: true, chargeReadVerified: true });
  await executeAction(user, { action: 'createWorkspace', name: 'Stripe OAuth test' }); await executeAction(other, { action: 'createWorkspace', name: 'Other Stripe OAuth test' });
});
describe('Stripe customer OAuth lifecycle', () => {
  it('requires authentication/browser binding and uses the exact private app link', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers/stripe/start', method: 'POST' })).toMatchObject({ status: 401 });
    await expect(startStripeProvider(user, undefined)).rejects.toMatchObject({ code: 'oauth_browser_required' });
    const url = await start(); expect(url.pathname).toBe('/oauth/v2/fictional_private_test/authorize'); expect(url.searchParams.get('redirect_uri')).toBe('https://dev.example.test/api/providers/stripe/callback'); expect(url.toString()).not.toContain('synthetic_developer_key');
  });
  it('rejects wrong browser, workspace, state and expired callbacks before exchange', async () => {
    const cb = callback(await start());
    expect(await finishStripeProvider(user, cb, 'b'.repeat(64))).toContain('invalid_state');
    expect(await finishStripeProvider(other, cb, binding)).toContain('invalid_state');
    const wrong = new URL(cb); wrong.searchParams.set('state', 'wrong'); expect(await finishStripeProvider(user, wrong, binding)).toContain('invalid_state');
    (fixture.rows.get(key('provider-oauth#stripe'))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    expect(await finishStripeProvider(user, cb, binding)).toContain('invalid_state'); expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it('consumes denied consent and prevents replay even with the same browser cookie', async () => {
    const cb = callback(await start()); cb.searchParams.set('error', 'access_denied'); cb.searchParams.set('error_description', 'private-provider-detail');
    expect(await finishStripeProvider(user, cb, binding)).toBe('https://dev.example.test/workspace?view=integrations&provider_result=stripe_denied');
    expect(await finishStripeProvider(user, cb, binding)).toContain('invalid_state'); expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it('stores tokens privately, returns account/mode, and prevents callback replay', async () => {
    const cb = callback(await start()); expect(await finishStripeProvider(user, cb, binding)).toContain('stripe_authorized');
    expect(await finishStripeProvider(user, cb, binding)).toContain('invalid_state');
    expect(await stripeProviderStatus(wid)).toMatchObject({ configured: true, connection: { status: 'authorized', accountId: 'acct_customer', mode: 'live' } });
    const result = JSON.stringify([await stripeProviderStatus(wid), await getWorkspaceState(user)]);
    expect(result).not.toContain('synthetic_customer'); expect(result).not.toContain('fictional_private_test');
    await expect(start()).rejects.toMatchObject({ code: 'provider_already_connected' });
  });
  it('does not restore a connection when disconnect races with token exchange', async () => {
    const cb = callback(await start()); fixture.exchange.mockImplementationOnce(async () => { await stripeProviderAction(user, { action: 'disconnect' }); return tokens(); });
    expect(await finishStripeProvider(user, cb, binding)).toContain('stripe_failed'); expect(fixture.rows.has(key('provider-token#stripe'))).toBe(false);
    expect((await stripeProviderStatus(wid)).connection?.status).toBe('disconnected');
  });
  it('verifies reads without importing customer records and rejects another workspace', async () => {
    await authorize();
    await expect(stripeProviderAction(other, { action: 'verify' })).rejects.toMatchObject({ code: 'provider_disconnected' });
    expect(await stripeProviderAction(user, { action: 'verify' })).toMatchObject({ disputeReadVerified: true, chargeReadVerified: true, connection: { lastVerifiedAt: expect.any(String) } });
    expect((await getWorkspaceState(user)).cases).toHaveLength(0);
    await expect(stripeProviderAction(user, { action: 'submit' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('serializes token refresh and uses rotated credentials', async () => {
    await authorize(); expire();
    fixture.exchange.mockImplementationOnce(async () => {
      await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'provider_refresh_busy' });
      return { ...tokens(), accessToken: 'rotated_access', refreshToken: 'rotated_refresh' };
    });
    await stripeProviderAction(user, { action: 'verify' });
    expect(fixture.exchange).toHaveBeenLastCalledWith(expect.anything(), { grant_type: 'refresh_token', refresh_token: 'synthetic_customer_refresh' });
    expect(fixture.verify).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'rotated_access' }));
  });
  it('fails closed on refresh account changes and provider revocation', async () => {
    await authorize(); expire(); fixture.exchange.mockResolvedValueOnce({ ...tokens(), accountId: 'acct_another' });
    await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'provider_account_mismatch' });
    expect((await stripeProviderStatus(wid)).connection?.status).toBe('reconnect_required'); expect(fixture.verify).not.toHaveBeenCalled();
    await stripeProviderAction(user, { action: 'disconnect' }); await authorize();
    fixture.verify.mockRejectedValueOnce(new ApiError(409, 'Revoked', 'provider_reauthorize'));
    await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'provider_reauthorize' });
    expect((await stripeProviderStatus(wid)).connection?.status).toBe('reconnect_required');
  });
  it('rejects corrupted account binding without using its token', async () => {
    await authorize(); (fixture.rows.get(key('provider-token#stripe'))!.data as { accountId: string }).accountId = 'acct_other';
    await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'provider_account_mismatch' }); expect(fixture.verify).not.toHaveBeenCalled();
  });
  it('drops refresh/read results after disconnect and keeps all credentials deleted', async () => {
    await authorize(); expire(); fixture.exchange.mockImplementationOnce(async () => { await stripeProviderAction(user, { action: 'disconnect' }); return tokens(); });
    await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'conflict' }); expect(fixture.rows.has(key('provider-token#stripe'))).toBe(false);
    await authorize(); fixture.verify.mockImplementationOnce(async () => { await stripeProviderAction(user, { action: 'disconnect' }); return { disputeReadVerified: true, chargeReadVerified: true }; });
    await expect(stripeProviderAction(user, { action: 'verify' })).rejects.toMatchObject({ code: 'conflict' }); expect(fixture.rows.has(key('provider-token#stripe'))).toBe(false);
    expect((await stripeProviderStatus(wid)).connection).toMatchObject({ status: 'disconnected', uninstallRequired: true });
  });
});
