import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDoc, DraftDoc, StoreChange, Stored, TrustedUser } from '../aws/types.ts';

const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), beforeCommit: undefined as undefined | (() => void) }));
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
        const existing = fixture.rows.get(`${wid}|${change.key}`);
        if ((existing?.version ?? null) !== change.expectedVersion) throw new ConflictError();
      }
      for (const change of changes) {
        if (change.check) continue;
        if (change.delete) fixture.rows.delete(`${wid}|${change.key}`);
        else fixture.rows.set(`${wid}|${change.key}`, structuredClone({ key: change.key, version: (change.expectedVersion ?? 0) + 1, data: change.data }));
      }
    },
  };
});
vi.mock('../aws/stripe.ts', () => ({ listStripeIntegration: async () => ({ id: 'stripe', provider: 'stripe', name: 'Stripe', status: 'configuration_required', description: 'Not configured.' }) }));
import { executeAction, getWorkspaceState, ownedCase } from '../aws/workspace.ts';
import { keys, workspaceIdForUser } from '../aws/store.ts';
const user: TrustedUser = { userId: 'owner', email: 'owner@example.test', displayName: 'Owner' };
const other: TrustedUser = { userId: 'other', email: 'other@example.test', displayName: 'Other' };
const wid = workspaceIdForUser(user.userId);
const create = () => executeAction(user, { action: 'createWorkspace', name: 'Ticket business' });
const samples = async () => { await create(); return executeAction(user, { action: 'seedDemo' }); };

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { fixture.rows.clear(); fixture.beforeCommit = undefined; });
describe('AWS workspace ownership and approval lifecycle', () => {
  it('isolates owners and does not accept foreign cases', async () => {
    const state = await samples();
    expect((await getWorkspaceState(other)).workspace).toBeNull();
    await executeAction(other, { action: 'createWorkspace', name: 'Other business' });
    await expect(executeAction(other, { action: 'generateDraft', caseId: state.cases[0].id })).rejects.toMatchObject({ status: 404 });
    expect((await getWorkspaceState(other)).cases).toHaveLength(0);
  });

  it('seeds six samples idempotently without replacing edited sample records', async () => {
    const state = await samples(); expect(state.cases).toHaveLength(6);
    const item = state.cases[0];
    await executeAction(user, { action: 'updateCase', caseId: item.id, title: 'A reviewer changed this case' });
    const reseeded = await executeAction(user, { action: 'seedDemo' });
    expect(reseeded.cases).toHaveLength(6);
    expect(reseeded.cases.find(record => record.id === item.id)?.title).toBe('A reviewer changed this case');
    expect(reseeded.cases.find(record => record.orderRef === 'ATM-1042')?.evidence.some(record => record.provenance?.fields.customerAcknowledgedReceipt)).toBe(true);
  });

  it('binds approval to the exact draft revision and marks changed source records stale', async () => {
    const item = (await samples()).cases.find(record => record.orderRef === 'ATM-1042')!;
    const prepared = await executeAction(user, { action: 'generateDraft', caseId: item.id });
    const revision = prepared.cases.find(record => record.id === item.id)!.draft!.revision;
    const approved = await executeAction(user, { action: 'approveDraft', caseId: item.id, revision });
    expect(approved.cases.find(record => record.id === item.id)!.draft!.status).toBe('approved');
    const changed = await executeAction(user, { action: 'addEvidence', caseId: item.id, source: 'manual', title: 'New customer message', content: 'A new conflicting customer account.', occurredAt: '2026-11-07' });
    const current = changed.cases.find(record => record.id === item.id)!;
    expect(current.draft).toMatchObject({ status: 'draft', sourceStale: true, revision: revision + 1 });
    await expect(executeAction(user, { action: 'approveDraft', caseId: item.id, revision: current.draft!.revision })).rejects.toMatchObject({ code: 'stale_draft' });
  });

  it('loses a concurrent approval race atomically without approving or changing the case', async () => {
    const item = (await samples()).cases.find(record => record.orderRef === 'ATM-1042')!;
    await executeAction(user, { action: 'generateDraft', caseId: item.id });
    const caseKey = `${wid}|${keys.case(item.id)}`;
    fixture.beforeCommit = () => {
      const current = fixture.rows.get(caseKey)! as Stored<CaseDoc>;
      fixture.rows.set(caseKey, { ...current, version: current.version + 1, data: { ...current.data, dataRevision: current.data.dataRevision + 1 } });
    };
    await expect(executeAction(user, { action: 'approveDraft', caseId: item.id, revision: 1 })).rejects.toMatchObject({ code: 'conflict' });
    const state = await getWorkspaceState(user); const current = state.cases.find(record => record.id === item.id)!;
    expect(current.status).toBe('needs_review'); expect(current.draft!.status).toBe('draft'); expect(current.draft!.sourceStale).toBe(true);
  });

  it('keeps stored investigation findings and validates case-local citations on edits', async () => {
    const item = (await samples()).cases.find(record => record.orderRef === 'ATM-1042')!;
    const row = await ownedCase(wid, item.id); const evidenceId = item.evidence[0].id;
    const draft: DraftDoc = { caseId: item.id, content: `Review this supported source [${evidenceId}].`, method: 'sample_investigator', revision: 1, status: 'draft', generatedAt: '2026-11-07', sourceRevision: row.data.dataRevision, analysis: { summary: 'Structured summary', assessment: 'supported', recommendation: 'Review the response', gaps: [], evidenceIds: [evidenceId], findings: [{ kind: 'supported', title: 'Stored finding', detail: 'A source-linked finding', evidenceIds: [evidenceId] }], metrics: { durationMs: 1, toolCalls: 1, modelCalls: 0, recordCount: 1 } } };
    fixture.rows.set(`${wid}|${keys.draft(item.id)}`, { key: keys.draft(item.id), version: 1, data: draft });
    expect((await getWorkspaceState(user)).cases.find(record => record.id === item.id)!.findings[0].title).toBe('Stored finding');
    await expect(executeAction(user, { action: 'saveDraft', caseId: item.id, revision: 1, content: 'Unsupported source reference [someone_elses_record]' })).rejects.toMatchObject({ code: 'invalid_citation' });
    const saved = await executeAction(user, { action: 'saveDraft', caseId: item.id, revision: 1, content: `${draft.content}\nReviewer checked the original.` });
    expect(saved.cases.find(record => record.id === item.id)!.draft).toMatchObject({ method: 'sample_investigator', revision: 2, sourceStale: false });
  });
});


describe('production workspaces exclude fixtures', () => {
  it('hides old demo cases, evidence and activity while retaining real records', async () => {
    const seeded = await samples();
    await executeAction(user, { action: 'addCase', title: 'Actual disputed order', customerName: 'Merchant customer', amount: 1200, reason: 'product_not_received', dueAt: '2026-12-13' });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CAUSALITY_TEST_FIXTURES', 'true');
    const visible = await getWorkspaceState(user);
    expect(visible.cases).toHaveLength(1);
    expect(visible.cases[0].source).toBe('manual');
    expect(visible.cases[0].evidence).toEqual([]);
    expect(visible.activity.some(event => event.action === 'demo.loaded')).toBe(false);
    await expect(ownedCase(wid, seeded.cases[0].id)).rejects.toMatchObject({ status: 404 });
    await expect(executeAction(user, { action: 'seedDemo' })).rejects.toMatchObject({ status: 404 });
  });
  it('leaves ordinary local workspaces empty and refuses seeding', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CAUSALITY_TEST_FIXTURES', '');
    const state = await create();
    expect(state.cases).toEqual([]);
    await expect(executeAction(user, { action: 'seedDemo' })).rejects.toMatchObject({ status: 404 });
  });
});
