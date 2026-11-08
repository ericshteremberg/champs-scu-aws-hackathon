import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreChange, Stored, TrustedUser } from '../aws/types.ts';
import type { ManagedConnection } from '../lib/evidence-connectors/live-types.ts';
import type { MerchantSection } from '../lib/investigation/merchant.ts';

const fixture = vi.hoisted(() => ({
  rows: new Map<string, Stored<unknown>>(),
  beforeCommit: undefined as undefined | (() => void),
  verify: vi.fn<(...args: unknown[]) => Promise<MerchantSection>>(),
  fetchSection: vi.fn<(...args: unknown[]) => Promise<MerchantSection>>(),
}));
vi.mock('../aws/store.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../aws/store.ts')>();
  const { ConflictError } = await import('../aws/types.ts');
  return {
    ...actual,
    getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null),
    queryItems: async (wid: string, prefix: string) => [...fixture.rows.entries()].filter(([key]) => key.startsWith(`${wid}|${prefix}`)).map(([, value]) => structuredClone(value)),
    commit: async (wid: string, changes: StoreChange[]) => {
      const before = fixture.beforeCommit; fixture.beforeCommit = undefined; before?.();
      for (const change of changes) {
        if ((fixture.rows.get(`${wid}|${change.key}`)?.version ?? null) !== change.expectedVersion) throw new ConflictError();
      }
      for (const change of changes) {
        if (change.check) continue;
        if (change.delete) fixture.rows.delete(`${wid}|${change.key}`);
        else fixture.rows.set(`${wid}|${change.key}`, structuredClone({ key: change.key, version: (change.expectedVersion ?? 0) + 1, data: change.data }));
      }
    },
  };
});
vi.mock('../aws/merchant-network.ts', () => ({
  verifyPublicMerchantConnection: fixture.verify,
  fetchPublicMerchantSection: fixture.fetchSection,
  validatePublicMerchantUrl: (value: string) => {
    if (value !== 'https://evidence.example.test/' && value !== 'https://evidence.example.test') throw { code: 'merchant_configuration' };
    return 'https://evidence.example.test';
  },
}));
vi.mock('../aws/stripe.ts', () => ({ listStripeIntegration: async () => ({ id: 'stripe', provider: 'stripe', name: 'Stripe', status: 'configuration_required', description: 'Not configured.' }) }));

import { executeManagedConnectorAction, listManagedConnections, loadManagedConnection, parseLiveImport } from '../aws/managed-connectors.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser } from '../aws/store.ts';
import { handler } from '../aws/handler.ts';

const user: TrustedUser = { userId: 'live-connector-owner', email: 'owner@example.test', displayName: 'Owner' };
const other: TrustedUser = { userId: 'live-connector-other', email: 'other@example.test', displayName: 'Other' };
const wid = workspaceIdForUser(user.userId);
const token = 'fictional_scoped_token_for_registry_testing_123456';
const input = { action: 'connect', name: 'Tickets', baseUrl: 'https://evidence.example.test/', token, externalCaseId: 'dp_test_case' };
const timestamp = '2026-11-07T12:00:00.000Z';
function summary(): MerchantSection {
  return {
    mappingVerified: true,
    case: {
      id: input.externalCaseId, merchantId: 'merchant_test', merchantName: 'Tickets Test', customerLabel: 'Customer',
      claim: 'Ticket not received', reason: 'product_not_received', amount: 5000, currency: 'usd', eventName: 'Test Event',
      purchasedAt: timestamp, openedAt: timestamp, dueAt: timestamp, sourceMode: 'live', summary: 'A test case',
      orderRef: 'order_test', paymentRef: 'pi_test', tags: [],
    },
    evidence: { caseId: input.externalCaseId, section: 'summary', sourceMode: 'live', fetchedAt: timestamp, status: 'available', limitations: [], records: [
      { id: 'summary_test', source: 'orders', sourceId: 'order_test', occurredAt: timestamp, title: 'Approved order', detail: 'Fictional summary for route tests.', fields: { orderRef: 'order_test', paymentRef: 'pi_test' } },
    ] },
  };
}
const save = async () => (await executeManagedConnectorAction(user, input)).connection;
const publicKey = (id: string) => `${wid}|live-connection#${id}`;
const privateKey = (id: string) => `${wid}|connector-credential#${id}`;
function revokeDirectly(id: string) {
  const row = fixture.rows.get(publicKey(id))! as Stored<ManagedConnection>;
  fixture.rows.set(publicKey(id), { ...row, version: row.version + 1, data: { ...row.data, status: 'disconnected' } });
  fixture.rows.delete(privateKey(id));
}

beforeEach(async () => {
  fixture.rows.clear(); fixture.beforeCommit = undefined; fixture.verify.mockReset(); fixture.verify.mockImplementation(async () => summary());
  fixture.fetchSection.mockReset(); fixture.fetchSection.mockImplementation(async () => summary());
  await executeAction(user, { action: 'createWorkspace', name: 'Live connectors test' });
});

describe('live connector Lambda routes', () => {
  const api = (method: 'GET' | 'POST', body?: unknown, actingUser: TrustedUser | undefined = user) => handler({ kind: 'api', method, path: '/api/connectors/live', user: actingUser, ...(body === undefined ? {} : { body }) });

  it('routes connect, list, recheck, and disconnect through the registry without exposing its token', async () => {
    const connected = await api('POST', input);
    expect(connected).toMatchObject({ status: 200, body: { connection: { status: 'connected', externalCaseId: input.externalCaseId } } });
    const connection = (connected as { body: { connection: ManagedConnection } }).body.connection;
    expect(await api('GET')).toEqual({ status: 200, body: { connections: [connection], storage: 'aws' } });
    expect(await api('POST', { action: 'recheck', connectionId: connection.id })).toMatchObject({ status: 200, body: { connection: { id: connection.id, status: 'connected' } } });
    const disconnected = await api('POST', { action: 'disconnect', connectionId: connection.id });
    expect(disconnected).toMatchObject({ status: 200, body: { connection: { id: connection.id, status: 'disconnected' } } });
    expect(JSON.stringify([connected, disconnected, await api('GET')])).not.toContain(token);
  });

  it('dispatches import to the actual merchant import path and returns the persisted case and state', async () => {
    const connection = await save();
    const imported = await api('POST', { action: 'import', connectionId: connection.id });
    expect(imported).toMatchObject({ status: 200, body: { caseId: expect.stringMatching(/^case_/), state: { cases: [{ merchantConnectionId: connection.id, merchantCaseId: input.externalCaseId, source: 'merchant', evidence: [{ reference: 'order_test' }] }] } } });
    expect(fixture.fetchSection).toHaveBeenCalledWith({ baseUrl: 'https://evidence.example.test', token }, input.externalCaseId, 'summary', expect.any(AbortSignal));
    expect(await api('POST', { action: 'import', connectionId: connection.id })).toEqual(imported);
    expect(fixture.fetchSection).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(imported)).not.toContain(token);
    await api('POST', { action: 'disconnect', connectionId: connection.id });
    expect(await api('POST', { action: 'import', connectionId: connection.id })).toMatchObject({ status: 409, body: { code: 'connector_disconnected' } });
  });

  it('rejects invalid connect and import bodies at the route without making a merchant request', async () => {
    const connection = await save(); fixture.verify.mockClear();
    for (const body of [
      { ...input, previewPassed: true },
      { action: 'import', connectionId: connection.id, token },
      { action: 'import', externalCaseId: input.externalCaseId },
      { action: 'recheck', connectionId: '../private' },
    ]) expect(await api('POST', body)).toMatchObject({ status: 400, body: { code: 'invalid_request' } });
    expect(fixture.verify).not.toHaveBeenCalled();
    expect(fixture.fetchSection).not.toHaveBeenCalled();
    expect((await getWorkspaceState(user)).cases).toHaveLength(0);
  });

  it('keeps route responses isolated to the requesting workspace', async () => {
    const connection = await save();
    await executeAction(other, { action: 'createWorkspace', name: 'Other route workspace' });
    expect(await api('GET', undefined, other)).toEqual({ status: 200, body: { connections: [], storage: 'aws' } });
    for (const action of ['recheck', 'disconnect', 'import']) expect(await api('POST', { action, connectionId: connection.id }, other)).toMatchObject({ status: 404, body: { code: 'connection_not_found' } });
    expect(fixture.fetchSection).not.toHaveBeenCalled();
    expect((await loadManagedConnection(wid, connection.id)).connection.data.status).toBe('connected');
  });

  it('requires a trusted user and an existing workspace before reading or verifying a connection', async () => {
    expect(await handler({ kind: 'api', method: 'GET', path: '/api/connectors/live' })).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    expect(await handler({ kind: 'api', method: 'POST', path: '/api/connectors/live', body: input })).toMatchObject({ status: 401, body: { code: 'unauthenticated' } });
    expect(await api('POST', input, other)).toMatchObject({ status: 409, body: { code: 'workspace_required' } });
    expect(fixture.verify).not.toHaveBeenCalled();
  });

  it('returns a sanitized failure when endpoint verification rejects access', async () => {
    fixture.verify.mockRejectedValue({ code: 'merchant_access_denied', message: token });
    const response = await api('POST', input);
    expect(response).toMatchObject({ status: 400, body: { code: 'connector_access_denied' } });
    expect(JSON.stringify(response)).not.toContain(token);
    expect(await api('GET')).toEqual({ status: 200, body: { connections: [], storage: 'aws' } });
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('workspace-owned live evidence connections', () => {
  it('verifies before saving and keeps the credential out of metadata, list, workspace state, and audit', async () => {
    const connection = await save();
    expect(fixture.verify).toHaveBeenCalledWith({ baseUrl: 'https://evidence.example.test', token }, input.externalCaseId, expect.any(AbortSignal));
    expect(connection).toMatchObject({ status: 'connected', externalCaseId: input.externalCaseId, merchantId: 'merchant_test', orderRef: 'order_test', paymentRef: 'pi_test' });
    expect(fixture.rows.get(privateKey(connection.id))?.data).toEqual({ token });
    const loaded = await loadManagedConnection(wid, connection.id);
    expect(loaded.configuration).toEqual({ baseUrl: 'https://evidence.example.test', token });
    expect(loaded.connection).toMatchObject({ key: `live-connection#${connection.id}`, version: 1 });
    expect(loaded.credential).toMatchObject({ key: `connector-credential#${connection.id}`, version: 1 });
    const list = await listManagedConnections(user);
    expect(list).toEqual({ storage: 'aws', connections: [connection] });
    const exposed = [connection, list, await getWorkspaceState(user), fixture.rows.get(publicKey(connection.id))];
    expect(JSON.stringify(exposed)).not.toContain(token);
    expect(JSON.stringify(exposed)).not.toContain('"token"');
    const tokenRows = [...fixture.rows.entries()].filter(([, row]) => JSON.stringify(row).includes(token));
    expect(tokenRows.map(([key]) => key)).toEqual([privateKey(connection.id)]);
  });

  it('projects stored metadata through a public allowlist', async () => {
    const connection = await save();
    const row = fixture.rows.get(publicKey(connection.id))! as Stored<ManagedConnection>;
    fixture.rows.set(publicKey(connection.id), { ...row, data: { ...row.data, token, internalNotes: 'private' } });
    expect((await listManagedConnections(user)).connections).toEqual([connection]);
    expect(JSON.stringify((await loadManagedConnection(wid, connection.id)).connection)).not.toContain(token);
  });

  it('does not expose or mutate another workspace connection', async () => {
    const connection = await save();
    await executeAction(other, { action: 'createWorkspace', name: 'Other' });
    expect((await listManagedConnections(other)).connections).toHaveLength(0);
    for (const action of ['recheck', 'disconnect']) await expect(executeManagedConnectorAction(other, { action, connectionId: connection.id })).rejects.toMatchObject({ status: 404 });
    await expect(loadManagedConnection(workspaceIdForUser(other.userId), connection.id)).rejects.toMatchObject({ status: 404 });
    expect((await loadManagedConnection(wid, connection.id)).connection.data.status).toBe('connected');
  });

  it.each([
    { ...input, verified: true }, { ...input, workspaceId: 'another_workspace' }, { ...input, token: 'short' },
    { ...input, token: `${token}\nheader` }, { ...input, externalCaseId: '../other' }, { ...input, baseUrl: 'http://localhost' },
  ])('rejects invalid or client-approved configuration before verification', async badInput => {
    await expect(executeManagedConnectorAction(user, badInput)).rejects.toMatchObject({ status: 400 });
    expect(fixture.verify).not.toHaveBeenCalled();
    expect((await listManagedConnections(user)).connections).toHaveLength(0);
  });

  it.each([
    ['merchant_access_denied', 'connector_access_denied'], ['merchant_scope_unverified', 'connector_scope_unverified'],
    ['merchant_host_blocked', 'invalid_connector_configuration'], ['merchant_timeout', 'connector_timeout'],
    ['invalid_evidence', 'connector_evidence_invalid'], ['unexpected', 'connector_verification_failed'],
  ])('does not save on %s and never returns upstream secret-bearing error text', async (upstreamCode, code) => {
    fixture.verify.mockRejectedValue({ code: upstreamCode, message: `Request rejected: ${token}`, detail: { token } });
    const error = await executeManagedConnectorAction(user, input).catch(value => value);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain(token);
    expect((await listManagedConnections(user)).connections).toHaveLength(0);
    expect([...fixture.rows.keys()].some(key => key.includes('connector-credential#'))).toBe(false);
  });

  it('refuses unverified summary identity or credential echoes in public metadata', async () => {
    fixture.verify.mockResolvedValueOnce({ ...summary(), mappingVerified: false });
    await expect(save()).rejects.toMatchObject({ code: 'connector_verification_failed' });
    const echoed = summary(); echoed.case!.merchantName = token;
    fixture.verify.mockResolvedValueOnce(echoed);
    await expect(save()).rejects.toMatchObject({ code: 'invalid_connector_configuration' });
    expect((await listManagedConnections(user)).connections).toHaveLength(0);
  });

  it('updates verification time only after rechecking the original case identity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(timestamp));
    const connection = await save();
    vi.setSystemTime(new Date('2026-11-07T13:00:00.000Z'));
    const result = await executeManagedConnectorAction(user, { action: 'recheck', connectionId: connection.id });
    expect(result.connection.verifiedAt).toBe('2026-11-07T13:00:00.000Z');
    expect(result.connection.createdAt).toBe(connection.createdAt);
    expect((await loadManagedConnection(wid, connection.id)).credential.version).toBe(1);
    fixture.verify.mockRejectedValueOnce(new Error(token));
    await expect(executeManagedConnectorAction(user, { action: 'recheck', connectionId: connection.id })).rejects.toMatchObject({ code: 'connector_verification_failed' });
    expect((await listManagedConnections(user)).connections[0]).toEqual(result.connection);
  });

  it.each(['merchantId', 'orderRef', 'paymentRef'] as const)('rejects a recheck that changes %s', async field => {
    const connection = await save();
    const changed = summary(); changed.case![field] = 'different'; fixture.verify.mockResolvedValueOnce(changed);
    await expect(executeManagedConnectorAction(user, { action: 'recheck', connectionId: connection.id })).rejects.toMatchObject({ code: 'connector_identity_changed' });
    expect((await listManagedConnections(user)).connections[0]).toEqual(connection);
  });

  it('disconnects atomically, removes its credential, and refuses subsequent reads and rechecks', async () => {
    const connection = await save();
    const result = await executeManagedConnectorAction(user, { action: 'disconnect', connectionId: connection.id });
    expect(result.connection.status).toBe('disconnected');
    expect(fixture.rows.has(privateKey(connection.id))).toBe(false);
    await expect(loadManagedConnection(wid, connection.id)).rejects.toMatchObject({ code: 'connector_disconnected' });
    await expect(executeManagedConnectorAction(user, { action: 'recheck', connectionId: connection.id })).rejects.toMatchObject({ code: 'connector_disconnected' });
    expect(await executeManagedConnectorAction(user, { action: 'disconnect', connectionId: connection.id })).toEqual(result);
    expect(fixture.verify).toHaveBeenCalledTimes(1);
  });

  it('does not publish a successful recheck after a concurrent disconnect', async () => {
    const connection = await save();
    fixture.beforeCommit = () => revokeDirectly(connection.id);
    await expect(executeManagedConnectorAction(user, { action: 'recheck', connectionId: connection.id })).rejects.toMatchObject({ code: 'conflict' });
    expect((await listManagedConnections(user)).connections[0].status).toBe('disconnected');
    expect(fixture.rows.has(privateKey(connection.id))).toBe(false);
    const actions = [...fixture.rows.values()].map(row => (row.data as { action?: string }).action);
    expect(actions).not.toContain('connector.live_rechecked');
  });

  it('fails closed when the saved credential is missing', async () => {
    const connection = await save(); fixture.rows.delete(privateKey(connection.id));
    await expect(loadManagedConnection(wid, connection.id)).rejects.toMatchObject({ code: 'connector_credential_missing' });
    expect((await executeManagedConnectorAction(user, { action: 'disconnect', connectionId: connection.id })).connection.status).toBe('disconnected');
  });

  it('preserves metadata and credential together when a disconnect transaction conflicts', async () => {
    const connection = await save();
    fixture.beforeCommit = () => {
      const row = fixture.rows.get(publicKey(connection.id))!;
      fixture.rows.set(publicKey(connection.id), { ...row, version: row.version + 1 });
    };
    await expect(executeManagedConnectorAction(user, { action: 'disconnect', connectionId: connection.id })).rejects.toMatchObject({ code: 'conflict' });
    expect((await loadManagedConnection(wid, connection.id)).connection.data.status).toBe('connected');
    expect(fixture.rows.has(privateKey(connection.id))).toBe(true);
  });

  it('keeps the saved-connection limit under simultaneous connects', async () => {
    const first = await save();
    for (let n = 1; n < 29; n++) {
      const id = `live_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const key = `live-connection#${id}`;
      fixture.rows.set(`${wid}|${key}`, { key, version: 1, data: { ...first, id } });
    }
    fixture.rows.set(`${wid}|connector-registry#live`, { key: 'connector-registry#live', version: 1, data: { count: 29 } });
    const results = await Promise.allSettled([save(), save()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await listManagedConnections(user)).connections).toHaveLength(30);
    await expect(save()).rejects.toMatchObject({ code: 'connection_limit' });
    expect([...fixture.rows.keys()].filter(key => key.includes('connector-credential#'))).toHaveLength(2);
  });

  it('parses imports strictly without accepting an arbitrary URL or token', async () => {
    const connection = await save();
    expect(parseLiveImport({ action: 'import', connectionId: connection.id })).toEqual({ action: 'import', connectionId: connection.id });
    expect(() => parseLiveImport({ action: 'import', connectionId: connection.id, token })).toThrow();
    expect(() => parseLiveImport({ action: 'import', connectionId: '../private' })).toThrow();
    await expect(executeManagedConnectorAction(user, { action: 'import', connectionId: connection.id })).rejects.toMatchObject({ status: 400 });
  });
});
