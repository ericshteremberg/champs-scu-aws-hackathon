import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONNECTOR_TEMPLATES, connectorManifestSchema, getConnectorTemplate, previewConnector,
  type ConnectorManifest, type ConnectorPreview,
} from '../lib/evidence-connectors/index.ts';
import type { ConnectorInstallResponse, ConnectorListResponse, EvidenceConnection } from '../lib/evidence-connectors/api-types.ts';
import type { EvidenceEnvelope } from '../lib/investigation/types.ts';
import { buildConnectorInstallFiles } from '../integrations/evidence-connector/install-files.ts';
import { commit, getItem, keys, queryItems } from './store.ts';
import { ApiError, ConflictError, type CaseDoc, type EvidenceDoc, type Stored, type TrustedUser } from './types.ts';
import { auditChange, MAX_CASE_EVIDENCE, requireWorkspace } from './workspace.ts';

const prefix = 'evidence-connection#';
const key = (id: string) => `${prefix}${id}`;
const connectionId = z.string().regex(/^conn_[a-f0-9-]{36}$/);
const templateId = z.enum(['atmsphr-tickets', 'rentul-rentals']);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), templateId, manifest: connectorManifestSchema }).strict(),
  z.object({ action: z.literal('save'), name: z.string().trim().min(1).max(100), templateId, manifest: connectorManifestSchema }).strict(),
  z.object({ action: z.literal('revoke'), connectionId }).strict(),
  z.object({ action: z.literal('import_demo'), connectionId }).strict(),
]);

function validatedPreview(manifest: ConnectorManifest, selectedTemplate: string): ConnectorPreview {
  try {
    const template = getConnectorTemplate(selectedTemplate);
    if (!template || manifest.businessType !== template.manifest.businessType) throw new Error('The business type must match the selected template.');
    const preview = previewConnector(manifest, selectedTemplate);
    if (!preview.checks.length || preview.checks.some(check => !check.passed) || preview.sourceMode !== 'synthetic') throw new Error('The case preview did not pass its access checks.');
    if (!preview.recordCount || preview.recordCount > MAX_CASE_EVIDENCE) throw new Error('Choose a mapping with between 1 and 90 case records.');
    return preview;
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message.slice(0, 500) : 'Check the selected mapping.', 'invalid_mapping');
  }
}

async function ownedConnection(wid: string, id: string): Promise<Stored<EvidenceConnection>> {
  if (!connectionId.safeParse(id).success) throw new ApiError(400, 'Choose a valid evidence connection.', 'invalid_connection');
  const row = await getItem<EvidenceConnection>(wid, key(id));
  if (!row || row.data.id !== id) throw new ApiError(404, 'Evidence connection not found.', 'connection_not_found');
  return row;
}

function requireActive(connection: EvidenceConnection) {
  if (connection.status === 'revoked') throw new ApiError(409, 'This configuration has been revoked. Create a new setup to continue.', 'connection_revoked');
}

export async function listEvidenceConnections(user: TrustedUser): Promise<ConnectorListResponse> {
  const workspace = await requireWorkspace(user);
  const connections = await queryItems<EvidenceConnection>(workspace.data.id, prefix, { maxItems: 50 });
  return { templates: structuredClone([...CONNECTOR_TEMPLATES]), connections: connections.map(row => row.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), storage: 'aws', setupMode: 'guided' };
}

export async function getConnectorInstallation(user: TrustedUser, id: string): Promise<ConnectorInstallResponse> {
  const workspace = await requireWorkspace(user);
  const connection = await ownedConnection(workspace.data.id, id);
  requireActive(connection.data);
  return buildConnectorInstallFiles(connection.data.manifest);
}

function importRecords(caseId: string, sections: EvidenceEnvelope[], timestamp: string): EvidenceDoc[] {
  return sections.flatMap(section => section.records.map(record => ({
    id: `ev_connector_${createHash('sha256').update(`${caseId}:${section.section}:${record.id}`).digest('hex')}`,
    caseId, source: 'database' as const, title: record.title, content: record.detail,
    occurredAt: record.occurredAt, reference: record.sourceId, createdAt: timestamp,
    provenance: { section: section.section, sourceMode: 'synthetic' as const, fields: { ...record.fields, sourceTable: record.source }, limitations: section.limitations, originalSourceId: record.id },
  })));
}

async function importDemo(user: TrustedUser, wid: string, connection: Stored<EvidenceConnection>) {
  requireActive(connection.data);
  const preview = validatedPreview(connection.data.manifest, connection.data.templateId);
  const id = `case_connector_${createHash('sha256').update(`${wid}:${connection.data.id}`).digest('hex').slice(0, 32)}`;
  if (await getItem(wid, keys.case(id))) return { caseId: id };
  const timestamp = new Date().toISOString();
  const metadata = preview.case;
  const records = importRecords(id, preview.sections, timestamp);
  if (records.length > MAX_CASE_EVIDENCE || new Set(records.map(row => row.id)).size !== records.length) throw new ApiError(400, 'The sample exceeds the case evidence limit or repeats records.', 'invalid_evidence');
  const item: CaseDoc = {
    id, workspaceId: wid, title: `${metadata.reason} (connector sample)`, customerName: metadata.customerLabel,
    email: '', amount: metadata.amount, currency: metadata.currency.toLowerCase(), status: 'needs_review',
    reason: metadata.claim, orderRef: metadata.orderRef, dueAt: metadata.dueAt, source: 'demo',
    createdAt: timestamp, updatedAt: timestamp, dataRevision: records.length,
  };
  try {
    await commit(wid, [
      { key: connection.key, expectedVersion: connection.version, check: true },
      { key: keys.case(id), expectedVersion: null, data: item },
      ...records.map(record => ({ key: keys.evidence(id, record.id), expectedVersion: null, data: record })),
      auditChange(user, 'connector.sample_imported', `Imported synthetic ${connection.data.templateId} evidence through the shared connector. No live database was accessed.`, id),
    ]);
  } catch (error) {
    // A duplicate click may race. A revocation must still win over a new import.
    if (!(error instanceof ConflictError)) throw error;
    requireActive((await ownedConnection(wid, connection.data.id)).data);
    if (!(await getItem(wid, keys.case(id)))) throw error;
  }
  return { caseId: id };
}

export async function executeConnectorAction(user: TrustedUser, input: unknown) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Check the connector action and mapping fields.', 'invalid_request');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const action = parsed.data;
  if (action.action === 'preview') return { preview: validatedPreview(action.manifest, action.templateId) };
  if (action.action === 'save') {
    validatedPreview(action.manifest, action.templateId);
    // Every installation is immutable. Changes require a new reviewed preview.
    const existing = await queryItems<EvidenceConnection>(wid, prefix, { maxItems: 50 });
    if (existing.length >= 30) throw new ApiError(409, 'This prototype supports up to 30 saved connector configurations.', 'connection_limit');
    const timestamp = new Date().toISOString();
    const connection: EvidenceConnection = { id: `conn_${randomUUID()}`, name: action.name, templateId: action.templateId, manifest: action.manifest, status: 'demo_ready', createdAt: timestamp, updatedAt: timestamp };
    await commit(wid, [
      { key: key(connection.id), expectedVersion: null, data: connection },
      auditChange(user, 'connector.configured', `Saved a reviewed ${action.templateId} mapping. Live installation remains separate.`),
    ]);
    return { connection };
  }
  const row = await ownedConnection(wid, action.connectionId);
  if (action.action === 'import_demo') return importDemo(user, wid, row);
  if (row.data.status === 'revoked') return { connection: row.data };
  const connection: EvidenceConnection = { ...row.data, status: 'revoked', updatedAt: new Date().toISOString() };
  await commit(wid, [
    { key: row.key, expectedVersion: row.version, data: connection },
    auditChange(user, 'connector.revoked', 'Revoked the saved configuration. Existing sample evidence remains available; independently installed merchant services must be disconnected by their owner.'),
  ]);
  return { connection };
}
