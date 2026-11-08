import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), dispute: vi.fn(), disputes: vi.fn(), schema: vi.fn(), query: vi.fn() }));
vi.mock('../aws/store.ts', async original => {
  const actual = await original<typeof import('../aws/store.ts')>(); const { ConflictError } = await import('../aws/types.ts');
  return { ...actual,
    getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null),
    queryItems: async (wid: string, prefix: string) => [...fixture.rows].filter(([key]) => key.startsWith(`${wid}|${prefix}`)).map(([, row]) => structuredClone(row)),
    commit: async (wid: string, changes: StoreChange[]) => {
      if (new Set(changes.map(c => c.key)).size !== changes.length) throw new Error('Duplicate transaction key');
      for (const c of changes) if ((fixture.rows.get(`${wid}|${c.key}`)?.version ?? null) !== c.expectedVersion) throw new ConflictError();
      for (const c of changes) { if (c.check) continue; if (c.delete) fixture.rows.delete(`${wid}|${c.key}`); else fixture.rows.set(`${wid}|${c.key}`, structuredClone({ key: c.key, version: (c.expectedVersion ?? 0) + 1, data: c.data })); }
    },
  };
});
vi.mock('../aws/stripe-oauth-api.ts', async original => ({ ...await original<typeof import('../aws/stripe-oauth-api.ts')>(), readStripeOAuthDispute: fixture.dispute, listStripeOAuthDisputes: fixture.disputes }));
vi.mock('../aws/supabase-api.ts', async original => ({ ...await original<typeof import('../aws/supabase-api.ts')>(), fetchSupabaseSchema: fixture.schema, querySupabaseReadOnly: fixture.query }));
import { providerEvidenceAction, providerEvidenceStatus } from '../aws/provider-evidence.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser, keys } from '../aws/store.ts';
import { handler } from '../aws/handler.ts';
import type { OrderEvidenceMapping } from '../lib/providers/types.ts';
const user: TrustedUser = { userId: 'linked_owner', email: 'owner@example.test', displayName: 'Owner' };
const other = { ...user, userId: 'linked_other' }, wid = workspaceIdForUser(user.userId);
const key = (name: string) => `${wid}|${name}`;
const mapping: OrderEvidenceMapping = { order: { table: 'orders', idColumn: 'id', paymentColumn: 'payment_ref', paymentKind: 'payment_intent', columns: ['id', 'payment_ref', 'status'] }, related: [{ table: 'tickets', section: 'tickets', orderColumn: 'order_id', columns: ['order_id', 'status'] }] };
const schema = [{ name: 'orders', columns: ['id', 'payment_ref', 'status', 'private_token'] }, { name: 'tickets', columns: ['order_id', 'status'] }];
const dispute = { id: 'du_example', accountId: 'acct_customer', mode: 'live', chargeId: 'ch_payment', paymentIntentId: 'pi_payment', status: 'needs_response', reason: 'product_not_received', amount: 5000, currency: 'usd', email: 'customer@example.test', customerName: 'Customer', dueAt: '2026-12-01T00:00:00Z', createdAt: '2026-11-01T00:00:00Z' };
const act = (action: string, fields = {}) => providerEvidenceAction(user, { action, ...fields });
const save = () => act('save_mapping', { mapping, confirmed: true });
let caseId: string;
function seed(name: string, data: unknown) { const old = fixture.rows.get(key(name)); fixture.rows.set(key(name), { key: name, version: (old?.version ?? 0) + 1, data }); }
const preview = async () => (await act('preview_records', { caseId }) as { preview: { id: string } }).preview;
const importRecords = (previewId: string) => act('import_records', { caseId, previewId, confirmed: true });
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks();
  fixture.dispute.mockResolvedValue(dispute); fixture.disputes.mockResolvedValue({ disputes: [dispute], moreAvailable: false }); fixture.schema.mockResolvedValue(schema);
  fixture.query.mockImplementation(async (_token: string, _ref: string, sql: string) => sql.includes('public."tickets"') ? [{ order_id: 'ORDER-1', status: 'delivered' }] : sql.startsWith('SELECT "id", "payment_ref", "status"') ? [{ id: 'ORDER-1', payment_ref: 'pi_payment', status: 'paid' }] : [{ id: 'ORDER-1', payment_ref: 'pi_payment' }]);
  await executeAction(user, { action: 'createWorkspace', name: 'Linked evidence' }); await executeAction(other, { action: 'createWorkspace', name: 'Other' });
  seed('provider#stripe', { status: 'authorized', updatedAt: new Date().toISOString(), accountId: dispute.accountId, mode: 'live' });
  seed('provider-token#stripe', { accessToken: 'synthetic_stripe_private', refreshToken: 'synthetic_stripe_refresh', accountId: dispute.accountId, mode: 'live', expiresAt: Date.now() + 3600000 });
  seed('provider#supabase', { status: 'authorized', updatedAt: new Date().toISOString(), project: { ref: 'abcdefghijklmnopqrst', name: 'Tickets', organization: 'Example', region: 'us-east-1' }, approvedTables: schema });
  seed('provider-token#supabase', { accessToken: 'synthetic_supabase_private', refreshToken: 'synthetic_supabase_refresh', expiresAt: Date.now() + 3600000 });
  caseId = (await act('import_stripe_dispute', { disputeId: dispute.id, confirmed: true }) as { caseId: string }).caseId;
});
describe('customer-selected Stripe disputes and linked Supabase evidence', () => {
  it('requires authentication, confirmation and server-owned payment references', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers/evidence', method: 'POST', body: { action: 'stripe_disputes' } })).toMatchObject({ status: 401 });
    for (const input of [{ action: 'import_stripe_dispute', disputeId: dispute.id }, { action: 'preview_records', caseId, paymentRef: 'pi_other' }, { action: 'save_mapping', mapping, confirmed: true, projectRef: 'differentprojectxxxx' }, { action: 'import_records', caseId, previewId: crypto.randomUUID(), confirmed: true, records: [] }, { action: 'refund' }]) await expect(providerEvidenceAction(user, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('previews the case payment without importing and rejects amount mismatches or multiple references', async () => {
    const before = structuredClone(fixture.rows);
    expect(await act('preview_case_payment', { caseId })).toMatchObject({ payment: { disputeId: dispute.id, chargeId: dispute.chargeId } });
    expect(fixture.rows).toEqual(before);
    fixture.dispute.mockResolvedValueOnce({ ...dispute, amount: 5100 });
    await expect(act('preview_case_payment', { caseId })).rejects.toMatchObject({ code: 'payment_case_mismatch' });
    seed(keys.evidence(caseId, 'other-dispute'), { id: 'other-dispute', caseId, source: 'stripe', reference: 'du_other', content: 'Another dispute' });
    await expect(act('preview_case_payment', { caseId })).rejects.toMatchObject({ code: 'payment_link_required' });
  });
  it('imports exactly one selected dispute, preserves local work and hides credentials', async () => {
    await executeAction(user, { action: 'updateCase', caseId, title: 'My reviewed title' });
    expect(await act('import_stripe_dispute', { disputeId: dispute.id, confirmed: true })).toMatchObject({ imported: false, caseId });
    const state = await getWorkspaceState(user); expect(state.cases).toHaveLength(1); expect(state.cases[0]).toMatchObject({ title: 'My reviewed title', source: 'stripe', stripeDisputeId: dispute.id, orderRef: 'pi_payment', amount: 5000 });
    expect(state.cases[0].evidence).toHaveLength(1);
    expect(JSON.stringify([state, await providerEvidenceStatus(user)])).not.toContain('synthetic_');
    fixture.dispute.mockResolvedValueOnce({ ...dispute, id: 'du_closed', status: 'won' });
    await expect(act('import_stripe_dispute', { disputeId: 'du_closed', confirmed: true })).rejects.toMatchObject({ code: 'dispute_not_actionable' });
  });
  it('rechecks schema when saving and previewing, then imports only the reviewed snapshot', async () => {
    await save(); expect(fixture.query).not.toHaveBeenCalled();
    expect(await providerEvidenceStatus(user)).toEqual({ mapping, eligibleCaseIds: [caseId] });
    const result = await preview(); expect(fixture.schema).toHaveBeenCalledTimes(2);
    expect(fixture.query.mock.calls.map(c => c[3])).toEqual([['pi_payment'], ['ORDER-1'], ['ORDER-1']]);
    expect(fixture.query.mock.calls.every(c => c[0] === 'synthetic_supabase_private' && c[1] === 'abcdefghijklmnopqrst')).toBe(true);
    fixture.query.mockRejectedValue(new Error('must not query again on import'));
    expect(await importRecords(result.id)).toMatchObject({ imported: true, count: 2 });
    const state = await getWorkspaceState(user), evidence = state.cases[0].evidence.filter(e => e.source === 'database');
    expect(evidence).toHaveLength(2); expect(evidence[1].provenance?.fields).toBeDefined();
    expect(evidence.every(e => e.content.includes('not the event time'))).toBe(true);
    await expect(importRecords(result.id)).rejects.toMatchObject({ code: 'evidence_preview_expired' });
  });
  it('requires a fresh preview and clears draft approval on import', async () => {
    await save(); await expect(importRecords(crypto.randomUUID())).rejects.toMatchObject({ code: 'evidence_preview_expired' });
    await executeAction(user, { action: 'generateDraft', caseId });
    const state = await getWorkspaceState(user); await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    const p = await preview(); await importRecords(p.id);
    const item = (await getWorkspaceState(user)).cases[0]; expect(item.status).toBe('needs_review'); expect(item.draft?.status).toBe('draft'); expect(item.draft?.sourceStale).toBe(true);
    await expect(importRecords((await preview()).id)).rejects.toMatchObject({ code: 'evidence_already_imported' });
  });
  it('invalidates previews when a case, mapping or connection changes, or TTL expires', async () => {
    await save(); const p = await preview(); await executeAction(user, { action: 'updateCase', caseId, title: 'Changed' });
    await expect(importRecords(p.id)).rejects.toMatchObject({ code: 'evidence_preview_expired' });
    const p2 = await preview(); await save(); await expect(importRecords(p2.id)).rejects.toMatchObject({ code: 'evidence_preview_expired' });
    const p3 = await preview(); (fixture.rows.get(key(`provider-evidence-preview#${caseId}`))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    await expect(importRecords(p3.id)).rejects.toMatchObject({ code: 'evidence_preview_expired' });
    await preview(); const s = fixture.rows.get(key('provider#supabase'))!; seed(s.key, s.data);
    expect((await providerEvidenceStatus(user)).mapping).toBeNull(); await expect(preview()).rejects.toMatchObject({ code: 'mapping_required' });
  });
  it('does not query an unselected project, an unapproved column or a manual case', async () => {
    await expect(act('save_mapping', { mapping: { ...mapping, order: { ...mapping.order, columns: [...mapping.order.columns, 'private_token'] } }, confirmed: true })).rejects.toMatchObject({ code: 'mapping_scope_denied' });
    fixture.schema.mockResolvedValueOnce([{ name: 'orders', columns: ['id'] }]); await expect(save()).rejects.toMatchObject({ code: 'mapping_scope_denied' });
    await save(); const state = await executeAction(user, { action: 'addCase', title: 'Manual', customerName: 'Name', amount: 5000, reason: 'Not received', dueAt: '2026-12-01' });
    const manual = state.cases.find(c => c.source === 'manual')!; await expect(act('preview_records', { caseId: manual.id })).rejects.toMatchObject({ code: 'payment_link_required' });
    seed('provider#supabase', { status: 'authorized', updatedAt: new Date().toISOString() }); await expect(preview()).rejects.toMatchObject({ code: 'mapping_scope_required' }); expect(fixture.query).not.toHaveBeenCalled();
  });
  it('blocks another workspace, a different account and closed local cases', async () => {
    await save(); await expect(providerEvidenceAction(other, { action: 'preview_records', caseId })).rejects.toMatchObject({ code: 'provider_disconnected' });
    (fixture.rows.get(key(keys.case(caseId)))!.data as { status: string }).status = 'submitted'; await expect(preview()).rejects.toMatchObject({ status: 409 });
    seed('provider#stripe', { status: 'authorized', accountId: 'acct_other', mode: 'live' }); await expect(preview()).rejects.toMatchObject({ code: 'provider_account_mismatch' });
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('rejects changed payment associations before querying rows', async () => {
    await save(); fixture.dispute.mockResolvedValueOnce({ ...dispute, paymentIntentId: 'pi_someoneelse' });
    await expect(preview()).rejects.toMatchObject({ code: 'payment_link_changed' }); expect(fixture.query).not.toHaveBeenCalled();
  });
  it('disconnect wins an in-flight provider read and prevents a preview from being saved', async () => {
    await save(); fixture.query.mockImplementationOnce(async () => { seed('provider#supabase', { status: 'disconnected' }); return [{ id: 'ORDER-1', payment_ref: 'pi_payment', status: 'paid' }]; });
    await expect(preview()).rejects.toMatchObject({ code: 'conflict' }); expect(fixture.rows.has(key(`provider-evidence-preview#${caseId}`))).toBe(false);
  });
  it('drops a dispute list if Stripe disconnects during the read', async () => {
    fixture.disputes.mockImplementationOnce(async () => { seed('provider#stripe', { status: 'disconnected' }); return { disputes: [dispute] }; });
    await expect(act('stripe_disputes')).rejects.toMatchObject({ code: 'conflict' });
  });
});

it('fills a missing case email only from the explicitly mapped and reviewed order, and preserves an existing email', async () => {
  const c = fixture.rows.get(key(keys.case(caseId)))!; (c.data as { email: string }).email = '';
  const withEmail: OrderEvidenceMapping = { ...mapping, order: { ...mapping.order, customerEmailColumn: 'email', columns: [...mapping.order.columns, 'email'] } };
  const expanded = [{ name: 'orders', columns: [...schema[0].columns, 'email'] }, schema[1]];
  const conn = fixture.rows.get(key('provider#supabase'))!;
  seed(conn.key, { ...(conn.data as object), approvedTables: expanded }); fixture.schema.mockResolvedValue(expanded);
  await act('save_mapping', { mapping: withEmail, confirmed: true });
  const query = fixture.query.getMockImplementation()!;
  fixture.query.mockImplementation(async (...args: unknown[]) => {
    const rows = await query(...args); return String(args[2]).includes('"email"') ? rows.map((r: object) => ({ ...r, email: 'reviewed@example.test' })) : rows;
  });
  await importRecords((await preview()).id);
  const first = (await getWorkspaceState(user)).cases[0]; expect(first.email).toBe('reviewed@example.test'); expect(first.orderRef).toBe('ORDER-1');
  fixture.query.mockImplementation(async (...args: unknown[]) => {
    const rows = await query(...args); return String(args[2]).includes('"email"') ? rows.map((r: object) => ({ ...r, email: 'changed@example.test' })) : rows;
  });
  await importRecords((await preview()).id);
  expect((await getWorkspaceState(user)).cases[0].email).toBe('reviewed@example.test');
});

describe('reviewed Supabase customer lookup before mailbox search', () => {
  const customerMapping = { table: 'customers', idColumn: 'id', nameColumn: 'name', emailColumn: 'email' };
  const configure = async () => {
    fixture.schema.mockResolvedValue([...schema, { name: 'customers', columns: ['id', 'name', 'email', 'private_token'] }]);
    await act('customer_save_mapping', { mapping: customerMapping, confirmed: true });
    fixture.query.mockResolvedValue([{ id: 'CUSTOMER-1', name: 'Mason Example', email: 'mason@example.com' }, { id: 'CUSTOMER-2', name: 'Mason Example', email: 'another@example.com' }]);
  };
  const lookup = () => act('customer_lookup', { caseId, query: 'Mason Example' }) as Promise<{ lookupId: string; matches: { id: string; email: string }[] }>;
  const select = (p: { lookupId: string; matches: { id: string }[] }) => act('customer_select', { caseId, lookupId: p.lookupId, matchId: p.matches[0].id, confirmed: true });
  it('requires authentication, explicit scope approval and denies secret columns', async () => {
    expect(await handler({ kind: 'api', path: '/api/providers/evidence', method: 'POST', body: { action: 'customer_config' } })).toMatchObject({ status: 401 });
    await expect(act('customer_save_mapping', { mapping: customerMapping })).rejects.toMatchObject({ code: 'invalid_request' });
    fixture.schema.mockResolvedValue([{ name: 'customers', columns: ['id', 'name', 'private_token'] }]);
    await expect(act('customer_save_mapping', { mapping: { ...customerMapping, emailColumn: 'private_token' }, confirmed: true })).rejects.toMatchObject({ code: 'customer_mapping_invalid' });
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('adds only the approved lookup columns while preserving existing scope, without requiring Stripe', async () => {
    fixture.rows.delete(key('provider#stripe')); fixture.rows.delete(key('provider-token#stripe'));
    await configure();
    const config = await act('customer_config'); expect(config).toMatchObject({ mapping: customerMapping });
    const data = fixture.rows.get(key('provider#supabase'))!.data as { approvedTables: unknown[] };
    expect(data.approvedTables).toEqual([...schema, { name: 'customers', columns: ['id', 'name', 'email'] }]);
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('returns distinct accounts and changes the case only after selection of a stored result', async () => {
    await configure(); const p = await lookup();
    expect(p.matches).toHaveLength(2);
    expect((await getWorkspaceState(user)).cases[0].email).toBe('customer@example.test');
    expect(fixture.query.mock.calls[0][2]).toContain('LIMIT 6');
    expect(fixture.query.mock.calls[0][3]).toEqual(['%Mason Example%', '%Mason%', '%Example%']);
    await executeAction(user, { action: 'generateDraft', caseId });
    const state = await getWorkspaceState(user); await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    const fresh = await lookup(); expect(await select(fresh)).toMatchObject({ email: 'mason@example.com' });
    const updated = (await getWorkspaceState(user)).cases[0]; expect(updated.email).toBe('mason@example.com'); expect(updated.draft?.status).toBe('draft'); expect(updated.draft?.sourceStale).toBe(true);
    await expect(select(fresh)).rejects.toMatchObject({ code: 'customer_lookup_expired' });
  });
  it('preserves the case and approved draft when selecting its existing email', async () => {
    await configure();
    fixture.query.mockResolvedValue([{ id: '1', name: 'Customer', email: dispute.email }]);
    await executeAction(user, { action: 'generateDraft', caseId });
    const state = await getWorkspaceState(user); await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    const before = (await getWorkspaceState(user)).cases[0];
    await select(await lookup());
    expect((await getWorkspaceState(user)).cases[0]).toEqual(before);
  });
  it('rejects forged addresses, stale results, changed cases and permissions', async () => {
    await configure(); const p = await lookup();
    await expect(act('customer_select', { caseId, lookupId: p.lookupId, matchId: p.matches[0].id, confirmed: true, email: 'forged@example.com' })).rejects.toMatchObject({ code: 'invalid_request' });
    await executeAction(user, { action: 'updateCase', caseId, title: 'Changed' });
    await expect(select(p)).rejects.toMatchObject({ code: 'customer_lookup_expired' });
    const p2 = await lookup(); (fixture.rows.get(key(`customer-lookup#${caseId}`))!.data as { ttlEpochSeconds: number }).ttlEpochSeconds = 1;
    await expect(select(p2)).rejects.toMatchObject({ code: 'customer_lookup_expired' });
    const connection = fixture.rows.get(key('provider#supabase'))!; seed(connection.key, connection.data);
    await expect(lookup()).rejects.toMatchObject({ code: 'customer_mapping_required' });
  });
  it('filters invalid emails, binds query values and does not persist results after disconnect', async () => {
    await configure(); fixture.query.mockResolvedValue([{ id: '1', name: 'Mason', email: 'not-an-email' }]);
    expect(await lookup()).toMatchObject({ matches: [], skippedInvalid: 1 });
    await act('customer_lookup', { caseId, query: "Mason%' OR true--" });
    const call = fixture.query.mock.calls.at(-1)!; expect(call[2]).not.toContain("Mason%"); expect(call[3][0]).toContain('\\%');
    fixture.query.mockImplementationOnce(async () => { const connection = fixture.rows.get(key('provider#supabase'))!; seed(connection.key, { status: 'disconnected' }); return [{ id: '1', name: 'Mason', email: 'mason@example.com' }]; });
    await expect(lookup()).rejects.toMatchObject({ code: 'conflict' });
  });
  it('supports manual cases but rejects another workspace and closed cases', async () => {
    await configure();
    await expect(providerEvidenceAction(other, { action: 'customer_lookup', caseId, query: 'Mason' })).rejects.toMatchObject({ code: 'provider_disconnected' });
    (fixture.rows.get(key(keys.case(caseId)))!.data as { status: string }).status = 'submitted';
    await expect(lookup()).rejects.toMatchObject({ status: 409 });
    const state = await executeAction(user, { action: 'addCase', title: 'Manual customer', customerName: 'Mason', amount: 5000, reason: 'Not received', dueAt: '2026-12-01' });
    const manual = state.cases.find(c => c.source === 'manual')!;
    expect(await act('customer_lookup', { caseId: manual.id, query: 'Mason' })).toMatchObject({ matches: expect.any(Array) });
  });
});
