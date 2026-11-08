import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), verify: vi.fn(), search: vi.fn(), preview: vi.fn() }));
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
vi.mock('../aws/imap-api.ts', async original => ({ ...await original<typeof import('../aws/imap-api.ts')>(), verifyImap: fixture.verify, searchImap: fixture.search, previewImap: fixture.preview }));
import { imapProviderAction, imapProviderStatus } from '../aws/imap-provider.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser, keys } from '../aws/store.ts';
import { handler } from '../aws/handler.ts';
import { ApiError } from '../aws/types.ts';
const user: TrustedUser = { userId: 'imap_owner', email: 'owner@example.test', displayName: 'Owner' };
const other = { ...user, userId: 'imap_other' }, wid = workspaceIdForUser(user.userId);
const key = (name: string) => `${wid}|${name}`;
const settings = { host: 'mail.provider.com', email: 'merchant@example.test', password: 'synthetic_private_password', folders: ['INBOX'] };
const message = { id: 'SU5CT1g.7.123', folder: 'INBOX', subject: 'Ticket support', from: 'customer@example.test', to: 'merchant@example.test', occurredAt: '2026-11-01T00:00:00.000Z' };
let caseId: string;
const connect = () => imapProviderAction(user, { action: 'connect', settings, confirmed: true });
const action = (name: string, fields = {}) => imapProviderAction(user, { action: name, caseId, ...fields });
const disconnect = () => imapProviderAction(user, { action: 'disconnect' });
async function preview() { await action('search'); await action('preview', { messageId: message.id }); }
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks();
  fixture.verify.mockResolvedValue(true); fixture.search.mockResolvedValue({ messages: [message], moreAvailable: false, scanLimited: false }); fixture.preview.mockResolvedValue({ ...message, text: 'Original customer statement', truncated: false });
  await executeAction(user, { action: 'createWorkspace', name: 'IMAP test' }); await executeAction(other, { action: 'createWorkspace', name: 'Other IMAP test' });
  const state = await executeAction(user, { action: 'addCase', title: 'Missing ticket', customerName: 'Customer', email: 'customer@example.test', amount: 5000, currency: 'usd', reason: 'Ticket not received', orderRef: 'ORDER-1', dueAt: '2026-12-01' });
  caseId = state.cases[0].id;
});
describe('IMAP customer connection and evidence boundary', () => {
  it('requires authenticated user and explicit credential storage consent', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers/imap', method: 'POST', body: { action: 'connect', settings, confirmed: true } })).toMatchObject({ status: 401 });
    await expect(imapProviderAction(user, { action: 'connect', settings })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fixture.verify).not.toHaveBeenCalled();
  });
  it('stores credentials only after verifying and never exposes them through public responses', async () => {
    const result = await connect();
    expect(result).toMatchObject({ connection: { status: 'authorized', email: settings.email, host: settings.host } });
    expect(fixture.verify).toHaveBeenCalledWith(settings);
    expect(JSON.stringify([result, await imapProviderStatus(wid), await getWorkspaceState(user)])).not.toContain(settings.password);
    expect(fixture.rows.get(key('provider-token#imap'))?.data).toEqual(settings);
    await expect(connect()).rejects.toMatchObject({ code: 'provider_already_connected' });
  });
  it('does not store failed credentials and rate limits repeated login checks', async () => {
    fixture.verify.mockRejectedValueOnce(new ApiError(502, 'Unavailable', 'imap_unavailable'));
    await expect(connect()).rejects.toMatchObject({ code: 'imap_unavailable' });
    expect(fixture.rows.has(key('provider-token#imap'))).toBe(false);
    await expect(connect()).rejects.toMatchObject({ code: 'imap_rate_limited' });
    await disconnect(); await expect(connect()).rejects.toMatchObject({ code: 'imap_rate_limited' });
    expect(fixture.verify).toHaveBeenCalledTimes(1);
  });
  it('disconnect wins an in-flight connection check and prevents credential resurrection', async () => {
    fixture.verify.mockImplementationOnce(async () => { await disconnect(); return true; });
    await expect(connect()).rejects.toMatchObject({ code: 'conflict' });
    expect(fixture.rows.has(key('provider-token#imap'))).toBe(false);
    expect((await imapProviderStatus(wid)).connection?.status).toBe('disconnected');
  });
  it('searches only the case customer, requires exact preview and invalidates approval on import', async () => {
    await connect();
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'imap_preview_expired' });
    await expect(action('preview', { messageId: message.id })).rejects.toMatchObject({ code: 'imap_selection_expired' });
    await action('search'); expect(fixture.search).toHaveBeenCalledWith(settings, 'customer@example.test');
    await expect(action('preview', { messageId: 'SU5CT1g.7.999' })).rejects.toMatchObject({ code: 'imap_selection_expired' });
    await executeAction(user, { action: 'addEvidence', caseId, source: 'manual', title: 'Order', content: 'Order was received', reference: 'ORDER-1', occurredAt: '2026-11-01T00:00:00Z' });
    await executeAction(user, { action: 'generateDraft', caseId });
    const state = await getWorkspaceState(user); await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    await preview();
    await expect(action('import', { messageId: message.id, confirmed: false })).rejects.toMatchObject({ code: 'invalid_request' });
    await action('import', { messageId: message.id, confirmed: true });
    const item = (await getWorkspaceState(user)).cases[0]; expect(item.status).toBe('needs_review'); expect(item.draft?.status).toBe('draft'); expect(item.draft?.sourceStale).toBe(true);
    expect(item.evidence.find(e => e.source === 'imap')).toMatchObject({ reference: 'imap:SU5CT1g.7.123', content: expect.stringContaining('Original customer statement') });
    expect(fixture.rows.has(key(`imap-preview#${caseId}`))).toBe(false);
    await preview(); await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'imap_already_imported' });
  });
  it('blocks cross-workspace cases, expired previews, changed cases and closed cases', async () => {
    await connect(); await expect(imapProviderAction(other, { action: 'search', caseId })).rejects.toMatchObject({ status: 404 });
    await preview(); (fixture.rows.get(key(`imap-preview#${caseId}`))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'imap_preview_expired' });
    await preview(); await executeAction(user, { action: 'updateCase', caseId, title: 'Changed title' });
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'imap_preview_expired' });
    (fixture.rows.get(key(keys.case(caseId)))!.data as { status: string }).status = 'submitted';
    await expect(action('search')).rejects.toMatchObject({ status: 409 });
  });
  it('drops in-flight results after disconnect and removes the private credential', async () => {
    await connect(); fixture.search.mockImplementationOnce(async () => { await disconnect(); return { messages: [message] }; });
    await expect(action('search')).rejects.toMatchObject({ code: 'conflict' });
    expect(fixture.rows.has(key('provider-token#imap'))).toBe(false);
    await expect(action('search')).rejects.toMatchObject({ code: 'provider_disconnected' });
  });
  it('invalidates old selections after reconnect and fails closed on rejected credentials', async () => {
    await connect(); await preview(); await disconnect(); await connect();
    await expect(action('preview', { messageId: message.id })).rejects.toMatchObject({ code: 'imap_selection_expired' });
    await expect(action('import', { messageId: message.id, confirmed: true })).rejects.toMatchObject({ code: 'imap_preview_expired' });
    fixture.search.mockRejectedValueOnce(new ApiError(409, 'Rejected', 'imap_auth_failed'));
    await expect(action('search')).rejects.toMatchObject({ code: 'imap_auth_failed' });
    expect((await imapProviderStatus(wid)).connection?.status).toBe('reconnect_required');
  });
  it('rejects sending, custom ports, unconfirmed access, arbitrary queries and forged evidence', async () => {
    for (const body of [{ action: 'send' }, { action: 'connect', settings: { ...settings, port: 143 }, confirmed: true }, { action: 'search', caseId, query: '*' }, { action: 'import', caseId, messageId: message.id, confirmed: true, content: 'forged' }]) await expect(imapProviderAction(user, body)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
