import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreChange, Stored, TrustedUser } from '../aws/types.ts';

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
vi.mock('../aws/stripe.ts', () => ({ listStripeIntegration: async () => ({ id: 'stripe', provider: 'stripe', name: 'Stripe', status: 'configuration_required', description: 'Not configured.' }) }));
import { executeConnectorAction, getConnectorInstallation, listEvidenceConnections } from '../aws/connectors.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser } from '../aws/store.ts';
import { CONNECTOR_TEMPLATES } from '../lib/evidence-connectors/index.ts';
import type { EvidenceConnection } from '../lib/evidence-connectors/api-types.ts';
import { localEvidence } from '../aws/investigations.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import type { CaseDoc } from '../aws/types.ts';

const user: TrustedUser = { userId: 'connector-owner', email: 'owner@example.test', displayName: 'Owner' };
const other: TrustedUser = { userId: 'connector-other', email: 'other@example.test', displayName: 'Other' };
const wid = workspaceIdForUser(user.userId);
it('does not claim an order is absent when a combined record is classified as attendance', () => {
  const record = { id: 'ev_combined', caseId: 'case_combined', source: 'database' as const, title: 'Order and ticket record', content: 'Order ORDER-EXAMPLE is paid; no attendance scan is recorded.', occurredAt: '2026-11-08T00:00:00.000Z', reference: 'orders/example' };
  const item = { id: 'case_combined', source: 'manual' } as CaseDoc;
  const order = localEvidence(item, [record], 'order');
  expect(order.status).toBe('unavailable');
  expect(order.limitations.join(' ')).toContain('Related facts may appear in records filed under other sections');
  expect(order.limitations.join(' ')).not.toContain('No order records are attached');
  expect(localEvidence(item, [record], 'attendance').records[0].id).toBe(record.id);
});
async function save(index = 0) {
  const template = CONNECTOR_TEMPLATES[index];
  const result = await executeConnectorAction(user, { action: 'save', name: template.name, templateId: template.id, manifest: template.manifest });
  if (!('connection' in result) || !result.connection) throw new Error('Expected saved connection');
  return result.connection;
}

beforeEach(async () => {
  fixture.rows.clear(); fixture.beforeCommit = undefined;
  await executeAction(user, { action: 'createWorkspace', name: 'Connector test' });
});

describe('AWS guided evidence connector setup', () => {
  it('persists public configuration in the owning workspace and never claims a live connection', async () => {
    const connection = await save();
    const list = await listEvidenceConnections(user);
    expect(list).toMatchObject({ storage: 'aws', setupMode: 'guided', connections: [{ id: connection.id, status: 'demo_ready' }] });
    expect(list.templates).toHaveLength(2);
    await executeAction(other, { action: 'createWorkspace', name: 'Other' });
    expect((await listEvidenceConnections(other)).connections).toHaveLength(0);
    for (const action of ['revoke', 'import_demo']) {
      await expect(executeConnectorAction(other, { action, connectionId: connection.id })).rejects.toMatchObject({ status: 404 });
    }
    await expect(getConnectorInstallation(other, connection.id)).rejects.toMatchObject({ status: 404 });
  });

  it('requires a real server-side preview and rejects client-supplied approval or credentials', async () => {
    const template = CONNECTOR_TEMPLATES[0];
    const input = { action: 'save', name: 'Test', templateId: template.id, manifest: template.manifest };
    await expect(executeConnectorAction(user, { ...input, previewPassed: true })).rejects.toMatchObject({ status: 400 });
    await expect(executeConnectorAction(user, { ...input, token: 'secret' })).rejects.toMatchObject({ status: 400 });
    await expect(executeConnectorAction(user, { ...input, templateId: 'rentul-rentals' })).rejects.toMatchObject({ code: 'invalid_mapping' });
    const manifest = structuredClone(template.manifest); manifest.order.table = 'unapproved_table';
    await expect(executeConnectorAction(user, { ...input, manifest })).rejects.toMatchObject({ status: 400 });
    expect((await listEvidenceConnections(user)).connections).toHaveLength(0);
  });

  it('returns usable installation files without creating credentials or claiming deployment', async () => {
    const connection = await save();
    const install = await getConnectorInstallation(user, connection.id);
    expect(install.files.some(file => file.name.endsWith('.json') && file.content.includes(connection.manifest.order.table))).toBe(true);
    expect(install.files.some(file => file.name.endsWith('.sql'))).toBe(true);
    expect(install.instructions.length).toBeGreaterThan(0);
    expect(JSON.stringify(install)).not.toContain('postgres://');
    expect((await listEvidenceConnections(user)).connections[0].status).toBe('demo_ready');
  });

  it.each([0, 1])('imports template %i idempotently into the same investigator with synthetic provenance', async index => {
    const connection = await save(index);
    const first = await executeConnectorAction(user, { action: 'import_demo', connectionId: connection.id });
    const second = await executeConnectorAction(user, { action: 'import_demo', connectionId: connection.id });
    expect(second).toEqual(first);
    const state = await getWorkspaceState(user);
    expect(state.cases).toHaveLength(1);
    const item = state.cases[0];
    expect(item.source).toBe('demo');
    expect(item.evidence.length).toBeGreaterThan(0);
    expect(item.evidence.every(record => record.provenance?.sourceMode === 'synthetic')).toBe(true);
    expect(item.evidence.every(record => record.source === 'database' && record.provenance?.fields.sourceTable)).toBe(true);
    const result = await runInvestigation({
      case: item, mode: 'sample', region: 'us-east-1', signal: AbortSignal.timeout(10_000),
      readEvidence: async section => localEvidence({ ...item, workspaceId: wid, dataRevision: item.evidence.length } as CaseDoc, item.evidence, section),
      assertActive: async () => {}, onEvent: async () => {},
    });
    expect(result.evidenceIds.length).toBeGreaterThan(0);
    expect(result.evidenceIds.every(id => item.evidence.some(record => record.id === id))).toBe(true);
    expect(result.metrics.modelCalls).toBe(0);
  });

  it('revokes configuration without deleting previously imported evidence', async () => {
    const connection = await save();
    await executeConnectorAction(user, { action: 'import_demo', connectionId: connection.id });
    const before = await getWorkspaceState(user);
    await executeConnectorAction(user, { action: 'revoke', connectionId: connection.id });
    await expect(executeConnectorAction(user, { action: 'import_demo', connectionId: connection.id })).rejects.toMatchObject({ code: 'connection_revoked' });
    await expect(getConnectorInstallation(user, connection.id)).rejects.toMatchObject({ code: 'connection_revoked' });
    expect((await getWorkspaceState(user)).cases).toEqual(before.cases);
  });

  it('prevents import when configuration is revoked during the transaction', async () => {
    const connection = await save();
    const storedKey = `${wid}|evidence-connection#${connection.id}`;
    fixture.beforeCommit = () => {
      const row = fixture.rows.get(storedKey)! as Stored<EvidenceConnection>;
      fixture.rows.set(storedKey, { ...row, version: row.version + 1, data: { ...row.data, status: 'revoked' } });
    };
    await expect(executeConnectorAction(user, { action: 'import_demo', connectionId: connection.id })).rejects.toMatchObject({ code: 'connection_revoked' });
    expect((await getWorkspaceState(user)).cases).toHaveLength(0);
  });
});
