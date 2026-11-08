import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
import type { SupabaseConnection } from '../lib/providers/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), exchange: vi.fn(), revoke: vi.fn(), projects: vi.fn(), schema: vi.fn() }));
vi.mock('../aws/store.ts', async original => {
  const actual = await original<typeof import('../aws/store.ts')>();
  const { ConflictError } = await import('../aws/types.ts');
  return { ...actual,
    getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null),
    queryItems: async (wid: string, prefix: string) => [...fixture.rows].filter(([key]) => key.startsWith(`${wid}|${prefix}`)).map(([, value]) => structuredClone(value)),
    commit: async (wid: string, changes: StoreChange[]) => {
      for (const c of changes) if ((fixture.rows.get(`${wid}|${c.key}`)?.version ?? null) !== c.expectedVersion) throw new ConflictError();
      for (const c of changes) {
        if (c.check) continue;
        if (c.delete) fixture.rows.delete(`${wid}|${c.key}`);
        else fixture.rows.set(`${wid}|${c.key}`, structuredClone({ key: c.key, version: (c.expectedVersion ?? 0) + 1, data: c.data }));
      }
    },
  };
});
vi.mock('../aws/supabase-api.ts', async original => ({
  ...await original<typeof import('../aws/supabase-api.ts')>(),
  loadSupabaseApp: async () => ({ clientId: 'synthetic_client', clientSecret: 'synthetic_app_secret', redirectUri: 'https://dev.example.test/api/providers/supabase/callback', scopes: ['projects:read', 'database:read'] }),
  exchangeSupabaseToken: fixture.exchange, revokeSupabaseToken: fixture.revoke, fetchSupabaseProjects: fixture.projects, fetchSupabaseSchema: fixture.schema,
}));
import { providerStatus, startSupabase, finishSupabase, supabaseAction } from '../aws/providers.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser } from '../aws/store.ts';
import { ApiError } from '../aws/types.ts';
import { handler } from '../aws/handler.ts';

const user: TrustedUser = { userId: 'provider_owner', email: 'owner@example.test', displayName: 'Owner' };
const other = { ...user, userId: 'other_provider_owner' };
const wid = workspaceIdForUser(user.userId);
const binding = 'a'.repeat(64);
const project = { ref: 'abcdefghijklmnopqrst', name: 'Fictional Tickets', organization: 'fictional-org', region: 'us-east-1' };
const tokens = () => ({ accessToken: 'synthetic_customer_access', refreshToken: 'synthetic_customer_refresh', expiresAt: Date.now() + 3600000 });
const key = (name: string) => `${wid}|${name}`;
async function start() { return new URL((await startSupabase(user, binding)).authorizationUrl); }
const callback = (url: URL) => new URL(`https://dev.example.test/api/providers/supabase/callback?code=synthetic_code&state=${url.searchParams.get('state')}`);
async function authorize() { expect(await finishSupabase(user, callback(await start()), binding)).toContain('provider_result=authorized'); }
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks();
  process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test'; process.env.SUPABASE_OAUTH_SECRET_ARN = 'synthetic-app-arn';
  fixture.exchange.mockImplementation(async () => tokens()); fixture.revoke.mockResolvedValue(undefined);
  fixture.projects.mockResolvedValue([project]); fixture.schema.mockResolvedValue([{ name: 'orders', columns: ['id', 'payment_ref'] }]);
  await executeAction(user, { action: 'createWorkspace', name: 'Provider test' });
  await executeAction(other, { action: 'createWorkspace', name: 'Other provider test' });
});

describe('Supabase customer authorization', () => {
  it('requires trusted identity and a browser binding; Stripe stays unavailable', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers', method: 'GET' })).toMatchObject({ status: 401 });
    await expect(startSupabase(user, undefined)).rejects.toMatchObject({ code: 'oauth_browser_required' });
    expect(await providerStatus(user)).toMatchObject({ supabase: { configured: true, connection: null }, stripe: { configured: false } });
  });
  it('uses S256 PKCE, consumes state once and never exposes the secret or tokens', async () => {
    const url = await start(); const pending = fixture.rows.get(key('provider-oauth#supabase'))!.data as { verifier: string; stateHash: string };
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.toString()).not.toContain(pending.verifier); expect(url.toString()).not.toContain('synthetic_app_secret');
    expect(pending.stateHash).not.toBe(url.searchParams.get('state'));
    expect(await finishSupabase(user, callback(url), binding)).toContain('provider_result=authorized');
    expect(fixture.exchange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ grant_type: 'authorization_code', code_verifier: pending.verifier }));
    expect(await finishSupabase(user, callback(url), binding)).toContain('invalid_state');
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify([await providerStatus(user), await getWorkspaceState(user)]);
    expect(serialized).not.toContain('synthetic_customer'); expect(serialized).not.toContain(pending.verifier);
  });
  it('rejects another browser, workspace, expired state, and replaced state before token exchange', async () => {
    const url = await start();
    expect(await finishSupabase(user, callback(url), 'b'.repeat(64))).toContain('invalid_state');
    expect(await finishSupabase(other, callback(url), binding)).toContain('invalid_state');
    const expired = fixture.rows.get(key('provider-oauth#supabase'))!;
    (expired.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    expect(await finishSupabase(user, callback(url), binding)).toContain('invalid_state');
    await start(); expect(await finishSupabase(user, callback(url), binding)).toContain('invalid_state');
    expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it('consumes denied authorization without requesting or saving tokens', async () => {
    const url = callback(await start()); url.searchParams.set('error', 'access_denied');
    expect(await finishSupabase(user, url, binding)).toContain('denied');
    expect(fixture.exchange).not.toHaveBeenCalled(); expect(fixture.rows.has(key('provider-oauth#supabase'))).toBe(false);
  });
  it('never publishes credentials when disconnect races with code exchange', async () => {
    const url = callback(await start());
    fixture.exchange.mockImplementationOnce(async () => { await supabaseAction(user, { action: 'disconnect' }); return tokens(); });
    expect(await finishSupabase(user, url, binding)).toContain('failed');
    expect(fixture.rows.has(key('provider-token#supabase'))).toBe(false);
    expect(fixture.revoke).toHaveBeenCalledWith(expect.anything(), 'synthetic_customer_refresh');
    expect((await providerStatus(user)).supabase.connection?.status).toBe('disconnected');
  });
  it('binds project selection to the authorized account and clears scope on change', async () => {
    await authorize();
    await expect(supabaseAction(other, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_disconnected' });
    await expect(supabaseAction(user, { action: 'select_project', projectRef: 'zzzzzzzzzzzzzzzzzzzz' })).rejects.toMatchObject({ code: 'provider_project_denied' });
    await expect(supabaseAction(user, { action: 'schema' })).rejects.toMatchObject({ code: 'provider_project_required' });
    await supabaseAction(user, { action: 'select_project', projectRef: project.ref });
    await supabaseAction(user, { action: 'approve_tables', tables: [{ name: 'orders', columns: ['id'] }] });
    expect((await providerStatus(user)).supabase.connection?.approvedTables).toEqual([{ name: 'orders', columns: ['id'] }]);
    await supabaseAction(user, { action: 'select_project', projectRef: project.ref });
    expect((await providerStatus(user)).supabase.connection?.approvedTables).toBeUndefined();
  });
  it('rejects forged tables, duplicate columns, SQL and stale schema approvals', async () => {
    await authorize(); await supabaseAction(user, { action: 'select_project', projectRef: project.ref });
    for (const tables of [[{ name: 'credentials', columns: ['secret'] }], [{ name: 'orders', columns: ['id', 'id'] }], [{ name: 'orders; DELETE', columns: ['id'] }]]) {
      await expect(supabaseAction(user, { action: 'approve_tables', tables })).rejects.toBeInstanceOf(ApiError);
    }
    fixture.schema.mockResolvedValueOnce([{ name: 'orders', columns: ['id'] }]);
    await expect(supabaseAction(user, { action: 'approve_tables', tables: [{ name: 'orders', columns: ['payment_ref'] }] })).rejects.toMatchObject({ code: 'provider_mapping_changed' });
  });
  it('refreshes an expired token once and keeps rotated credentials private', async () => {
    await authorize();
    (fixture.rows.get(key('provider-token#supabase'))!.data as { expiresAt: number }).expiresAt = 1;
    fixture.exchange.mockResolvedValueOnce({ ...tokens(), accessToken: 'rotated_access', refreshToken: 'rotated_refresh' });
    await supabaseAction(user, { action: 'projects' });
    expect(fixture.exchange).toHaveBeenLastCalledWith(expect.anything(), { grant_type: 'refresh_token', refresh_token: 'synthetic_customer_refresh' });
    expect(fixture.projects).toHaveBeenLastCalledWith('rotated_access');
    expect(JSON.stringify(await providerStatus(user))).not.toContain('rotated');
  });
  it('serializes refresh requests and refuses to restore a disconnected token', async () => {
    await authorize(); (fixture.rows.get(key('provider-token#supabase'))!.data as { expiresAt: number }).expiresAt = 1;
    fixture.exchange.mockImplementationOnce(async () => {
      await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_refresh_busy' });
      await supabaseAction(user, { action: 'disconnect' }); return { ...tokens(), refreshToken: 'rotated_after_disconnect' };
    });
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'conflict' });
    expect(fixture.projects).not.toHaveBeenCalled(); expect(fixture.rows.has(key('provider-token#supabase'))).toBe(false);
    expect(fixture.revoke).toHaveBeenLastCalledWith(expect.anything(), 'rotated_after_disconnect');
  });
  it('fails closed after refresh failure and handles provider-side revocation', async () => {
    await authorize(); (fixture.rows.get(key('provider-token#supabase'))!.data as { expiresAt: number }).expiresAt = 1;
    fixture.exchange.mockRejectedValueOnce(new ApiError(409, 'Reconnect', 'provider_reauthorize'));
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_reauthorize' });
    expect((await providerStatus(user)).supabase.connection?.status).toBe('reconnect_required');
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_disconnected' });
    await supabaseAction(user, { action: 'disconnect' }); await authorize();
    fixture.projects.mockRejectedValueOnce(new ApiError(409, 'Revoked', 'provider_reauthorize'));
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_reauthorize' });
    expect((await providerStatus(user)).supabase.connection?.status).toBe('reconnect_required');
  });
  it('disables reads even when provider revocation fails and supports retry', async () => {
    await authorize(); fixture.revoke.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await supabaseAction(user, { action: 'disconnect' })).toMatchObject({ connection: { status: 'disconnected', revocationPending: true } });
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'provider_disconnected' });
    await expect(start()).rejects.toMatchObject({ code: 'provider_already_connected' });
    expect(await supabaseAction(user, { action: 'disconnect' })).toMatchObject({ connection: { revocationPending: false } });
    expect(fixture.rows.has(key('provider-token#supabase'))).toBe(false);
  });
  it('withholds in-flight metadata after disconnection', async () => {
    await authorize(); fixture.projects.mockImplementationOnce(async () => { await supabaseAction(user, { action: 'disconnect' }); return [project]; });
    await expect(supabaseAction(user, { action: 'projects' })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('projects only public connection fields even if stored records gain credentials', async () => {
    await authorize(); const row = fixture.rows.get(key('provider#supabase'))! as Stored<SupabaseConnection & { accessToken?: string }>;
    row.data.accessToken = 'must_not_escape';
    expect(JSON.stringify(await providerStatus(user))).not.toContain('must_not_escape');
  });
});
