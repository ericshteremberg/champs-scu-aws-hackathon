import { randomUUID } from 'node:crypto';
import type { AccessRequest, Finding, InvestigationRun, Policy, WorkspaceState } from '../lib/domain.ts';
import { DEMO_CASES } from '../lib/demo.ts';
import { actionSchema, canReviewAccess } from '../lib/server/validation.ts';
import { buildFindings, buildReport } from '../lib/server/report.ts';
import { reportEvidenceIds } from '../lib/investigation/report.ts';
import { listStripeIntegration } from './stripe.ts';
import { commit, getItem, keys, queryItems, workspaceIdForUser } from './store.ts';
import { ApiError, ConflictError, mutableStatuses, type AuditDoc, type CaseDoc, type DraftDoc, type EvidenceDoc, type Stored, type StoreChange, type TrustedUser, type WorkspaceDoc } from './types.ts';
export type { CaseDoc, DraftDoc, EvidenceDoc, Stored, StoreChange, TrustedUser, WorkspaceDoc } from './types.ts';

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
export const MAX_CASE_EVIDENCE = 90;

export async function requireWorkspace(user: TrustedUser | string): Promise<Stored<WorkspaceDoc>> {
  const userId = typeof user === 'string' ? user : user.userId;
  const record = await getItem<WorkspaceDoc>(workspaceIdForUser(userId), keys.workspace);
  if (!record || record.data.ownerId !== userId) throw new ApiError(409, 'Create your workspace first.', 'workspace_required');
  return record;
}
export async function ownedCase(workspaceId: string, caseId: string): Promise<Stored<CaseDoc>> {
  const record = await getItem<CaseDoc>(workspaceId, keys.case(caseId));
  if (!record || record.data.id !== caseId || record.data.workspaceId !== workspaceId) throw new ApiError(404, 'Case not found.');
  return record;
}
export function assertMutableCase(record: Pick<CaseDoc, 'status'>) {
  if (!mutableStatuses.includes(record.status)) throw new ApiError(409, 'This case is closed to changes. Its submitted evidence remains unchanged.');
}
export async function listEvidence(workspaceId: string, caseId: string) {
  const records = await queryItems<EvidenceDoc>(workspaceId, keys.evidencePrefix(caseId), { maxItems: MAX_CASE_EVIDENCE });
  if (records.some(record => record.data.caseId !== caseId)) throw new ApiError(500, 'Stored evidence does not match its case.');
  return records;
}
export async function findEvidence(workspaceId: string, evidenceId: string) {
  const records = await queryItems<EvidenceDoc>(workspaceId, 'evidence#', { maxItems: 5000 });
  const record = records.find(item => item.data.id === evidenceId);
  if (!record) throw new ApiError(404, 'Evidence not found.');
  await ownedCase(workspaceId, record.data.caseId);
  return record;
}
export const getDraft = (workspaceId: string, caseId: string) => getItem<DraftDoc>(workspaceId, keys.draft(caseId));
export function evidenceForClient(record: EvidenceDoc) {
  const { fileKey, createdAt: _createdAt, ...visible } = record;
  return { ...visible, ...(fileKey ? { downloadUrl: `/api/evidence/${encodeURIComponent(record.id)}` } : {}) };
}
export function auditChange(user: TrustedUser, action: string, detail: string, caseId?: string): StoreChange {
  const timestamp = now(); const id = newId('log');
  const data: AuditDoc = { id, actor: user.email, action, detail, caseId, createdAt: timestamp };
  return { key: keys.audit(timestamp, id), expectedVersion: null, data };
}
export function draftWithoutApproval(draft: DraftDoc): DraftDoc {
  return { ...draft, status: 'draft', approvedAt: undefined, approvedBy: undefined, revision: draft.revision + 1 };
}
export function caseChange(record: Stored<CaseDoc>, data: CaseDoc): StoreChange {
  return { key: record.key, expectedVersion: record.version, data };
}

function merchantConfigured(workspaceId: string) {
  if (!process.env.MERCHANT_EVIDENCE_TOKEN || process.env.MERCHANT_WORKSPACE_ID !== workspaceId) return false;
  try { const url = new URL(process.env.MERCHANT_EVIDENCE_URL || ''); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
async function latestRun(workspaceId: string, item: CaseDoc): Promise<InvestigationRun | undefined> {
  if (!item.latestRunId) return undefined;
  const stored = await getItem<InvestigationRun & { status: string }>(workspaceId, keys.run(item.latestRunId));
  if (!stored) return undefined;
  const events = await queryItems<InvestigationRun['events'][number]>(workspaceId, keys.eventPrefix(item.latestRunId), { maxItems: 100 });
  const run = stored.data;
  return { id: run.id, caseId: run.caseId, mode: run.mode, status: ['queued', 'committing'].includes(run.status) ? 'running' : run.status as InvestigationRun['status'], startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, modelId: run.modelId, events: events.map(event => event.data) };
}
export async function getWorkspaceState(user: TrustedUser): Promise<WorkspaceState> {
  const workspaceId = workspaceIdForUser(user.userId);
  const storedWorkspace = await getItem<WorkspaceDoc>(workspaceId, keys.workspace);
  const base: WorkspaceState = { user: { id: user.userId, email: user.email, name: user.displayName }, workspace: null, cases: [], integrations: [], activity: [], accessRequests: [], policies: [] };
  if (!storedWorkspace) return base;
  if (storedWorkspace.data.ownerId !== user.userId) throw new ApiError(403, 'This workspace belongs to a different owner.');
  base.workspace = storedWorkspace.data;
  const [caseRows, evidenceRows, draftRows, policyRows, accessRows, auditRows, stripe] = await Promise.all([
    queryItems<CaseDoc>(workspaceId, 'case#', { maxItems: 500 }),
    queryItems<EvidenceDoc>(workspaceId, 'evidence#', { maxItems: 5000 }),
    queryItems<DraftDoc>(workspaceId, 'draft#', { maxItems: 500 }),
    queryItems<Policy>(workspaceId, 'policy#', { maxItems: 100 }),
    queryItems<Omit<AccessRequest, 'canReview'>>(workspaceId, 'access#', { maxItems: 5000 }),
    queryItems<AuditDoc>(workspaceId, 'audit#', { maxItems: 5000 }),
    listStripeIntegration(workspaceId),
  ]);
  base.cases = await Promise.all(caseRows.map(async ({ data: item }) => {
    const evidence = evidenceRows.filter(record => record.data.caseId === item.id).map(record => evidenceForClient(record.data));
    const draft = draftRows.find(record => record.data.caseId === item.id)?.data;
    const sourceStale = Boolean(draft && draft.sourceRevision !== null && draft.sourceRevision !== item.dataRevision);
    const findings: Finding[] = sourceStale ? [{ kind: 'missing', title: 'Source records changed', detail: 'Run a new investigation or assemble a fresh template before approving or exporting this draft.', evidenceIds: [] }] : draft?.analysis?.findings ?? buildFindings(evidence);
    return { ...item, evidence, findings, ...(draft ? { draft: { ...draft, sourceStale } } : {}), investigation: await latestRun(workspaceId, item) };
  }));
  base.cases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const bedrockConfigured = Boolean(process.env.BEDROCK_MODEL_ID && (process.env.AWS_REGION || 'us-east-1') === 'us-east-1');
  base.integrations = [stripe,
    { id: 'bedrock', provider: 'bedrock', name: 'Amazon Bedrock', status: bedrockConfigured ? 'connected' : 'configuration_required', accountName: process.env.BEDROCK_MODEL_ID, description: bedrockConfigured ? 'Configured for sourced AI investigations using the AWS execution role. Model access is checked when an investigation runs.' : 'Configure a tool-capable Bedrock model in us-east-1. Sample investigations remain available for sample cases.' },
    { id: 'gmail', provider: 'gmail', name: 'Gmail', status: 'configuration_required', description: 'Import selected customer emails as evidence. Automatic mailbox access requires a configured OAuth integration.' },
    { id: 'database', provider: 'database', name: 'Company records', status: merchantConfigured(workspaceId) ? 'connected' : 'configuration_required', description: merchantConfigured(workspaceId) ? 'A merchant-owned evidence API is configured for this workspace. Only records linked to an approved case are retrieved.' : 'Connect a merchant-owned evidence API with a workspace binding. No database credentials are required.' },
  ];
  base.policies = policyRows.map(record => record.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  base.activity = auditRows.map(record => record.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  base.accessRequests = accessRows.map(({ data }) => ({ ...data, canReview: data.status === 'pending' && canReviewAccess(data.requestedBy, user.userId) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  if (Buffer.byteLength(JSON.stringify(base)) > 4 * 1024 * 1024) throw new ApiError(413, 'This workspace exceeds the prototype response limit. Reduce the attached records before loading all cases.', 'workspace_too_large');
  return base;
}

export async function executeAction(user: TrustedUser, input: unknown): Promise<WorkspaceState> {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || 'Check the submitted fields.', 'validation_error');
  const action = parsed.data;
  if (action.action === 'createWorkspace') {
    const id = workspaceIdForUser(user.userId); const timestamp = now();
    if (await getItem(id, keys.workspace)) throw new ApiError(409, 'You already have a workspace.');
    const data: WorkspaceDoc = { id, ownerId: user.userId, name: action.name, industry: action.industry, website: action.website, onboardingComplete: true, retentionDays: 90, createdAt: timestamp, updatedAt: timestamp };
    await commit(id, [{ key: keys.workspace, expectedVersion: null, data }, auditChange(user, 'workspace.created', 'Workspace created in Amazon DynamoDB.')]);
    return getWorkspaceState(user);
  }
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  switch (action.action) {
    case 'seedDemo': {
      for (const sample of DEMO_CASES) {
        const id = `${wid}_${sample.id}`;
        if (await getItem(wid, keys.case(id))) continue;
        const timestamp = now();
        const item: CaseDoc = { id, workspaceId: wid, title: sample.title, customerName: sample.customerName, email: sample.email, amount: sample.amount, currency: sample.currency, status: sample.status, reason: sample.reason, orderRef: sample.orderRef, dueAt: sample.dueAt, source: 'demo', createdAt: timestamp, updatedAt: timestamp, dataRevision: sample.evidence.length };
        const changes: StoreChange[] = [{ key: keys.case(id), expectedVersion: null, data: item }, ...sample.evidence.map(record => { const evidenceId = `${wid}_${record.id}`; return { key: keys.evidence(id, evidenceId), expectedVersion: null, data: { ...record, id: evidenceId, caseId: id, createdAt: timestamp } satisfies EvidenceDoc }; }), auditChange(user, 'demo.loaded', 'Loaded a clearly labeled synthetic sample case.', id)];
        try { await commit(wid, changes); }
        catch (error) { if (!(error instanceof ConflictError) || !(await getItem(wid, keys.case(id)))) throw error; }
      }
      break;
    }
    case 'addCase': {
      const id = newId('case'); const timestamp = now(); const { action: _action, ...fields } = action;
      const data: CaseDoc = { ...fields, id, workspaceId: wid, source: 'manual', status: 'needs_review', createdAt: timestamp, updatedAt: timestamp, dataRevision: 0 };
      await commit(wid, [{ key: keys.case(id), expectedVersion: null, data }, auditChange(user, 'case.created', 'Created a manual case.', id)]); break;
    }
    case 'updateCase': {
      const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data); const draft = await getDraft(wid, row.data.id);
      const changed = action.title !== undefined && action.title !== row.data.title;
      if (action.status === 'ready' && (changed || draft?.data.status !== 'approved' || (draft.data.sourceRevision !== null && draft.data.sourceRevision !== row.data.dataRevision))) throw new ApiError(409, 'Review and approve the current draft before marking the case ready.');
      const changes: StoreChange[] = [caseChange(row, { ...row.data, ...(action.title ? { title: action.title } : {}), status: changed ? 'needs_review' : action.status ?? row.data.status, dataRevision: row.data.dataRevision + Number(changed), updatedAt: now() }), auditChange(user, 'case.updated', 'Updated the case.', row.data.id)];
      if (draft) changes.push(changed ? { key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) } : { key: draft.key, expectedVersion: draft.version, check: true });
      await commit(wid, changes); break;
    }
    case 'addEvidence': {
      const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
      const [records, draft] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id)]);
      if (records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This prototype supports up to 90 evidence records per case.');
      const id = newId('ev'); const { action: _action, ...fields } = action;
      const changes: StoreChange[] = [caseChange(row, { ...row.data, dataRevision: row.data.dataRevision + 1, status: 'needs_review', updatedAt: now() }), { key: keys.evidence(row.data.id, id), expectedVersion: null, data: { ...fields, id, createdAt: now() } satisfies EvidenceDoc }, auditChange(user, 'evidence.added', 'Added a source record; prior approval cleared.', row.data.id)];
      if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
      await commit(wid, changes); break;
    }
    case 'generateDraft': {
      const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
      const [records, previous] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id)]);
      if (!records.length) throw new ApiError(409, 'Add evidence before assembling a draft.');
      const data: DraftDoc = { caseId: row.data.id, content: buildReport({ ...row.data, evidence: records.map(record => evidenceForClient(record.data)) }), status: 'draft', generatedAt: now(), revision: (previous?.data.revision ?? 0) + 1, method: 'evidence_template', sourceRevision: row.data.dataRevision };
      await commit(wid, [caseChange(row, { ...row.data, status: 'needs_review', updatedAt: now() }), { key: keys.draft(row.data.id), expectedVersion: previous?.version ?? null, data }, auditChange(user, 'draft.assembled', 'Assembled an evidence-template draft for review.', row.data.id)]); break;
    }
    case 'saveDraft': {
      const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data); const existing = await getDraft(wid, row.data.id);
      if ((existing?.data.revision ?? 0) !== action.revision) throw new ApiError(409, 'This draft changed. Refresh it before saving.', 'stale_draft');
      let data: DraftDoc = existing ? { ...draftWithoutApproval(existing.data), content: action.content } : { caseId: row.data.id, content: action.content, status: 'draft', generatedAt: now(), revision: 1, method: 'evidence_template', sourceRevision: row.data.dataRevision };
      if (existing && existing.data.method !== 'evidence_template') {
        const ids = new Set((await listEvidence(wid, row.data.id)).map(record => record.data.id));
        const citations = reportEvidenceIds({ content: action.content, findings: existing.data.analysis?.findings ?? [] });
        if (citations.some(id => !ids.has(id)) || (ids.size && !/(?<!\\)\[([^\]\n]{1,240})\]/.test(action.content))) throw new ApiError(422, 'Keep valid citations to this case’s evidence in the response.', 'invalid_citation');
        if (data.analysis) data = { ...data, analysis: { ...data.analysis, evidenceIds: citations, ...(data.analysis.factInventory ? { claimControl: 'human_edited' as const } : {}) } };
      }
      await commit(wid, [caseChange(row, { ...row.data, status: 'needs_review', updatedAt: now() }), { key: keys.draft(row.data.id), expectedVersion: existing?.version ?? null, data }, auditChange(user, 'draft.saved', 'Saved draft changes; prior approval cleared.', row.data.id)]); break;
    }
    case 'approveDraft': {
      const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data); const draft = await getDraft(wid, row.data.id);
      if (!draft || draft.data.revision !== action.revision || (draft.data.sourceRevision !== null && draft.data.sourceRevision !== row.data.dataRevision)) throw new ApiError(409, 'The draft or evidence changed. Refresh and review it again.', 'stale_draft');
      if (!(await listEvidence(wid, row.data.id)).length) throw new ApiError(409, 'Attach evidence before approval.');
      const approvedAt = now();
      await commit(wid, [caseChange(row, { ...row.data, status: 'ready', updatedAt: approvedAt }), { key: draft.key, expectedVersion: draft.version, data: { ...draft.data, status: 'approved', approvedBy: user.userId, approvedAt } satisfies DraftDoc }, auditChange(user, 'draft.approved', `Approved draft revision ${action.revision}. Nothing was submitted to Stripe.`, row.data.id)]); break;
    }
    case 'requestAccess': {
      const row = action.caseId ? await ownedCase(wid, action.caseId) : null; const id = newId('access');
      const data: Omit<AccessRequest, 'canReview'> = { id, caseId: action.caseId, scope: action.scope, reason: action.reason, status: 'pending', requestedBy: user.userId, createdAt: now() };
      await commit(wid, [{ key: keys.access(id), expectedVersion: null, data }, ...(row ? [{ key: row.key, expectedVersion: row.version, check: true } as StoreChange] : []), auditChange(user, 'access.requested', 'Requested additional access. Independent review is required.', action.caseId)]); break;
    }
    case 'resolveAccess': {
      const row = await getItem<Omit<AccessRequest, 'canReview'>>(wid, keys.access(action.requestId));
      if (!row) throw new ApiError(404, 'Access request not found.');
      if (!canReviewAccess(row.data.requestedBy, user.userId)) throw new ApiError(403, 'You cannot approve or deny your own access request. An independent reviewer is required.', 'independent_review_required');
      throw new ApiError(403, 'Independent reviewer provisioning is required before access can be granted.', 'reviewer_not_configured');
    }
    case 'saveSettings': {
      await commit(wid, [{ key: workspace.key, expectedVersion: workspace.version, data: { ...workspace.data, name: action.name, industry: action.industry, website: action.website, retentionDays: action.retentionDays, updatedAt: now() } satisfies WorkspaceDoc }, auditChange(user, 'settings.updated', 'Updated workspace settings and retention preference.')]); break;
    }
    case 'addPolicy': {
      const id = newId('policy'); const { action: _action, ...fields } = action;
      await commit(wid, [{ key: keys.policy(id), expectedVersion: null, data: { ...fields, id, createdAt: now() } satisfies Policy }, auditChange(user, 'policy.added', 'Added a versioned policy. This does not grant data access.')]); break;
    }
    case 'removePolicy': {
      const row = await getItem<Policy>(wid, keys.policy(action.policyId)); if (!row) throw new ApiError(404, 'Policy not found.');
      await commit(wid, [{ key: row.key, expectedVersion: row.version, delete: true }, auditChange(user, 'policy.removed', 'Removed a policy from workspace reference documents.')]); break;
    }
  }
  return getWorkspaceState(user);
}
