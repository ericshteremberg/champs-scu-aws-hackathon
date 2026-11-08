import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), exchange: vi.fn(), profile: vi.fn(), search: vi.fn(), preview: vi.fn(), revoke: vi.fn() }));
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
vi.mock('../aws/gmail-api.ts', async original => ({ ...await original<typeof import('../aws/gmail-api.ts')>(), loadGmailApp: async () => ({ clientId: 'fictional.apps.googleusercontent.com', clientSecret: 'synthetic_secret', redirectUri: 'https://dev.example.test/api/providers/gmail/callback' }), exchangeGmailToken: fixture.exchange, gmailProfile: fixture.profile, searchGmail: fixture.search, previewGmail: fixture.preview, revokeGmailToken: fixture.revoke }));
import { startGmailProvider, finishGmailProvider, gmailProviderAction, gmailProviderStatus } from '../aws/gmail-provider.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser, keys } from '../aws/store.ts';
import { handler } from '../aws/handler.ts';
import { ApiError } from '../aws/types.ts';
const user: TrustedUser = { userId: 'gmail_owner', email: 'owner@example.test', displayName: 'Owner' };
const other = { ...user, userId: 'gmail_other' }, wid = workspaceIdForUser(user.userId), binding = 'a'.repeat(64);
const key = (name: string) => `${wid}|${name}`;
const tokens = () => ({ accessToken: 'synthetic_access', refreshToken: 'synthetic_refresh', expiresAt: Date.now() + 3600000 });
const message = { id: 'ab12', threadId: 'cd34', subject: 'Ticket support', from: 'customer@example.test', to: 'merchant@example.test', occurredAt: '2026-11-01T00:00:00.000Z' };
let caseId: string;
const start = async () => new URL((await startGmailProvider(user, binding)).authorizationUrl);
const callback = (u: URL) => new URL(`https://dev.example.test/api/providers/gmail/callback?code=fictional_code&state=${u.searchParams.get('state')}`);
async function authorize() { expect(await finishGmailProvider(user, callback(await start()), binding)).toContain('gmail_authorized'); }
const action = (name: string, fields = {}) => gmailProviderAction(user, { action: name, caseId, ...fields });
async function preview() { await action('search'); await action('preview', { messageId: message.id }); }
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks(); process.env.CAUSALITY_FRONTEND_ORIGIN = 'https://dev.example.test'; process.env.GMAIL_OAUTH_SECRET_ARN = 'synthetic_arn';
  fixture.exchange.mockImplementation(async () => tokens()); fixture.profile.mockResolvedValue('merchant@example.test'); fixture.search.mockResolvedValue({ messages: [message], moreAvailable: false }); fixture.preview.mockResolvedValue({ ...message, text: 'Original customer statement', truncated: false }); fixture.revoke.mockResolvedValue(undefined);
  await executeAction(user, { action: 'createWorkspace', name: 'Gmail test' }); await executeAction(other, { action: 'createWorkspace', name: 'Other Gmail test' });
  const state = await executeAction(user, { action: 'addCase', title: 'Missing ticket', customerName: 'Customer', email: 'customer@example.test', amount: 5000, currency: 'usd', reason: 'Ticket not received', orderRef: 'ORDER-1', dueAt: '2026-12-01' });
  caseId = state.cases[0].id;
});
describe('Gmail authorization and selected evidence', () => {
  it('uses browser-bound, read-only offline authorization and PKCE', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers/gmail/start', method: 'POST' })).toMatchObject({ status: 401 });
    await expect(startGmailProvider(user, undefined)).rejects.toMatchObject({ code: 'oauth_browser_required' });
    const url = await start(); expect(url.origin).toBe('https://accounts.google.com'); expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly'); expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('access_type')).toBe('offline'); expect(url.toString()).not.toContain('synthetic_secret');
  });
  it('rejects cross-browser, cross-workspace, stale and replayed callbacks', async () => {
    const cb = callback(await start());
    expect(await finishGmailProvider(user, cb, 'b'.repeat(64))).toContain('invalid_state'); expect(await finishGmailProvider(other, cb, binding)).toContain('invalid_state');
    expect(fixture.exchange).not.toHaveBeenCalled();
    cb.searchParams.set('error', 'access_denied'); expect(await finishGmailProvider(user, cb, binding)).toContain('gmail_denied'); expect(await finishGmailProvider(user, cb, binding)).toContain('invalid_state');
    const expired = callback(await start()); (fixture.rows.get(key('provider-oauth#gmail'))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    expect(await finishGmailProvider(user, expired, binding)).toContain('invalid_state'); expect(fixture.exchange).not.toHaveBeenCalled();
  });
  it('never exposes tokens in status/workspace responses and refuses an already connected flow', async () => {
    await authorize(); const status = await gmailProviderStatus(wid); expect(status.connection).toMatchObject({ status: 'authorized', email: 'merchant@example.test' });
    expect(JSON.stringify([status, await getWorkspaceState(user)])).not.toContain('synthetic_');
    await expect(start()).rejects.toMatchObject({ code: 'provider_already_connected' });
  });
  it('revokes newly exchanged credentials when disconnect wins the callback race', async () => {
    const cb = callback(await start()); fixture.profile.mockImplementationOnce(async () => { await gmailProviderAction(user, { action: 'disconnect' }); return 'merchant@example.test'; });
    expect(await finishGmailProvider(user, cb, binding)).toContain('gmail_failed'); expect(fixture.revoke).toHaveBeenCalledWith('synthetic_refresh'); expect(fixture.rows.has(key('provider-token#gmail'))).toBe(false);
  });
  it('searches the case email, requires matching preview, imports exact reviewed content and clears approval', async () => {
    await authorize();
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'gmail_preview_expired' });
    await expect(action('preview', { messageId: message.id })).rejects.toMatchObject({ code: 'gmail_selection_expired' });
    await action('search'); expect(fixture.search).toHaveBeenCalledWith('synthetic_access', 'customer@example.test');
    await expect(action('preview', { messageId: 'ffff' })).rejects.toMatchObject({ code: 'gmail_selection_expired' });
    await executeAction(user, { action: 'addEvidence', caseId, source: 'manual', title: 'Order', content: 'Order was received', reference: 'ORDER-1', occurredAt: '2026-11-01T00:00:00Z' });
    await executeAction(user, { action: 'generateDraft', caseId }); const state = await getWorkspaceState(user);
    await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    await preview();
    await expect(action('import', { messageId: message.id, confirmed: false })).rejects.toMatchObject({ code: 'invalid_request' });
    await action('import', { messageId: message.id, confirmed: true });
    const item = (await getWorkspaceState(user)).cases[0]; expect(item.status).toBe('needs_review'); expect(item.draft?.status).toBe('draft'); expect(item.draft?.sourceStale).toBe(true);
    expect(item.evidence.find(e => e.source === 'gmail')).toMatchObject({ reference: 'gmail:ab12', content: expect.stringContaining('Original customer statement') });
    expect(fixture.rows.has(key(`gmail-preview#${caseId}`))).toBe(false);
    await preview(); await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'gmail_already_imported' });
  });
  it('blocks another workspace, expired selections, closed cases and changed previews', async () => {
    await authorize(); await expect(gmailProviderAction(other, { action: 'search', caseId })).rejects.toMatchObject({ status: 404 });
    await preview(); (fixture.rows.get(key(`gmail-preview#${caseId}`))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'gmail_preview_expired' });
    await preview(); await executeAction(user, { action: 'updateCase', caseId, title: 'Changed title' });
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'gmail_preview_expired' });
    (fixture.rows.get(key(keys.case(caseId)))!.data as { status: string }).status = 'submitted';
    await expect(action('search')).rejects.toMatchObject({ status: 409 });
  });
  it('serializes refresh and refuses a refreshed token for a different mailbox', async () => {
    await authorize(); (fixture.rows.get(key('provider-token#gmail'))!.data as { expiresAt: number }).expiresAt = 1;
    fixture.exchange.mockImplementationOnce(async () => { await expect(action('search')).rejects.toMatchObject({ code: 'provider_refresh_busy' }); return { ...tokens(), accessToken: 'fresh_access' }; });
    await action('search'); expect(fixture.search).toHaveBeenLastCalledWith('fresh_access', 'customer@example.test');
    (fixture.rows.get(key('provider-token#gmail'))!.data as { expiresAt: number }).expiresAt = 1; fixture.profile.mockResolvedValueOnce('different@example.test');
    await expect(action('search')).rejects.toMatchObject({ code: 'provider_account_mismatch' }); expect((await gmailProviderStatus(wid)).connection?.status).toBe('reconnect_required');
  });
  it('drops in-flight search/refresh results after disconnect', async () => {
    await authorize(); fixture.search.mockImplementationOnce(async () => { await gmailProviderAction(user, { action: 'disconnect' }); return { messages: [message] }; });
    await expect(action('search')).rejects.toMatchObject({ code: 'conflict' }); expect(fixture.rows.has(key('provider-token#gmail'))).toBe(false);
    await authorize(); (fixture.rows.get(key('provider-token#gmail'))!.data as { expiresAt: number }).expiresAt = 1;
    fixture.exchange.mockImplementationOnce(async () => { await gmailProviderAction(user, { action: 'disconnect' }); return tokens(); });
    await expect(action('search')).rejects.toMatchObject({ code: 'conflict' }); expect((await gmailProviderStatus(wid)).connection?.status).toBe('disconnected');
  });
  it('fails closed on revoked access, keeps revoke retry credentials private and clears them after success', async () => {
    await authorize(); fixture.search.mockRejectedValueOnce(new ApiError(409, 'Expired', 'provider_reauthorize'));
    await expect(action('search')).rejects.toMatchObject({ code: 'provider_reauthorize' }); expect((await gmailProviderStatus(wid)).connection?.status).toBe('reconnect_required');
    fixture.revoke.mockRejectedValueOnce(new Error('private-provider-error'));
    expect(await gmailProviderAction(user, { action: 'disconnect' })).toMatchObject({ connection: { status: 'disconnected', revocationPending: true } });
    await expect(action('search')).rejects.toMatchObject({ code: 'provider_disconnected' }); await expect(start()).rejects.toMatchObject({ code: 'provider_already_connected' });
    await gmailProviderAction(user, { action: 'disconnect' }); expect(fixture.rows.has(key('provider-token#gmail'))).toBe(false);
  });
  it('rejects sending, arbitrary mailbox queries and client-supplied evidence content', async () => {
    for (const body of [{ action: 'send' }, { action: 'search', caseId, query: '*' }, { action: 'import', caseId, messageId: 'ab12', confirmed: true, content: 'forged' }]) await expect(gmailProviderAction(user, body)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
