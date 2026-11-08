import { sampleDataEnabled } from './sample-data';
import { evidenceSections } from '../investigation/sections.ts';
import { env } from 'cloudflare:workers';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { cases, drafts, evidence, investigationRuns, auditLogs } from '@/db/schema';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import type { DisputeCase, Evidence, EvidenceSource, InvestigationConfig, InvestigationRun } from '@/lib/domain';
import { EVIDENCE_SECTIONS, InvestigationError, type EvidenceEnvelope, type EvidenceSection, type InvestigationEvent, type InvestigationResult } from '@/lib/investigation/types';
import { investigationLimits, runInvestigation } from '@/lib/investigation/engine';
import { fetchMerchantSection } from '@/lib/investigation/merchant';
import { ApiError, requireWorkspace } from './auth';

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const mutable = ['needs_review', 'investigating', 'ready'];
const MAX_RECORDS = 100;

type CaseRow = typeof cases.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;
type RunRow = typeof investigationRuns.$inferSelect;

export function readInvestigationSecrets() {
  const value = env as Cloudflare.Env;
  const credentials = value.AWS_ACCESS_KEY_ID && value.AWS_SECRET_ACCESS_KEY && value.AWS_SESSION_TOKEN
    ? { accessKeyId: value.AWS_ACCESS_KEY_ID, secretAccessKey: value.AWS_SECRET_ACCESS_KEY, sessionToken: value.AWS_SESSION_TOKEN } : undefined;
  return { region: value.AWS_REGION || 'us-east-1', modelId: value.BEDROCK_MODEL_ID, credentials,
    merchantUrl: value.MERCHANT_EVIDENCE_URL, merchantToken: value.MERCHANT_EVIDENCE_TOKEN,
    merchantWorkspaceId: value.MERCHANT_WORKSPACE_ID, archiveBucket: value.S3_EVIDENCE_BUCKET };
}

function merchantConfigured(workspaceId: string) {
  const config = readInvestigationSecrets();
  if (!config.merchantUrl || !config.merchantToken || config.merchantWorkspaceId !== workspaceId) return false;
  try { const url = new URL(config.merchantUrl); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}

export function getInvestigationConfig(workspaceId: string): InvestigationConfig {
  const config = readInvestigationSecrets();
  return { bedrockConfigured: Boolean(config.credentials && config.modelId && config.region === 'us-east-1'), merchantConfigured: merchantConfigured(workspaceId),
    archiveConfigured: Boolean(config.credentials && config.archiveBucket && config.region === 'us-east-1'), region: config.region, modelId: config.modelId };
}

export function serializeInvestigation(row: RunRow): InvestigationRun {
  let events: InvestigationRun['events'] = [];
  try { const parsed = JSON.parse(row.eventsJson); if (Array.isArray(parsed)) events = parsed; } catch { /* A corrupted log must not expose internals. */ }
  return { id: row.id, caseId: row.caseId, status: row.status === 'committing' ? 'running' : row.status as InvestigationRun['status'], mode: row.mode as InvestigationRun['mode'],
    startedAt: row.startedAt, finishedAt: row.finishedAt ?? undefined, error: row.error ?? undefined, modelId: row.modelId ?? undefined, events };
}

export function parseProvenance(value: string | null): Evidence['provenance'] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.section !== 'string' || !EVIDENCE_SECTIONS.includes(parsed.section) || typeof parsed.sourceMode !== 'string' || !parsed.fields || typeof parsed.fields !== 'object' || Array.isArray(parsed.fields) || !Array.isArray(parsed.limitations)) return undefined;
    return parsed;
  } catch { return undefined; }
}

export function evidenceForClient(row: EvidenceRow): Evidence {
  return { id: row.id, caseId: row.caseId, source: row.source as EvidenceSource, title: row.title, content: row.content, occurredAt: row.occurredAt, reference: row.reference,
    provenance: parseProvenance(row.metadataJson), ...(row.fileKey ? { fileName: row.fileName ?? undefined, mimeType: row.mimeType ?? undefined, downloadUrl: `/api/evidence/${encodeURIComponent(row.id)}` } : {}) };
}

async function getOwnedCase(workspaceId: string, id: string) {
  const row = await getDb().select().from(cases).where(and(eq(cases.workspaceId, workspaceId), eq(cases.id, id))).get();
  if (!row || (!sampleDataEnabled() && row.source === 'demo')) throw new ApiError(404, 'Case not found.');
  return row;
}

async function expireRuns(workspaceId: string, caseId: string) {
  await getDb().update(investigationRuns).set({ status: 'failed', finishedAt: now(), error: 'The investigation expired before completing. Start a new investigation.' })
    .where(and(eq(investigationRuns.workspaceId, workspaceId), eq(investigationRuns.caseId, caseId), eq(investigationRuns.status, 'running'), sql`${investigationRuns.expiresAt} <= ${now()}`));
}

export async function getLatestInvestigation(workspaceId: string, caseId: string): Promise<InvestigationRun | null> {
  await getOwnedCase(workspaceId, caseId);
  await expireRuns(workspaceId, caseId);
  const row = await getDb().select().from(investigationRuns).where(and(eq(investigationRuns.workspaceId, workspaceId), eq(investigationRuns.caseId, caseId))).orderBy(desc(investigationRuns.startedAt)).get();
  return row ? serializeInvestigation(row) : null;
}

export async function cancelInvestigation(user: ChatGPTUser, runId: string): Promise<InvestigationRun> {
  const workspace = await requireWorkspace(user.userId);
  const row = await getDb().select().from(investigationRuns).where(and(eq(investigationRuns.workspaceId, workspace.id), eq(investigationRuns.id, runId))).get();
  if (!row) throw new ApiError(404, 'Investigation not found.');
  const timestamp = now();
  await getDb().update(investigationRuns).set({ status: 'cancelled', finishedAt: timestamp, error: 'Stopped by the reviewer. Further evidence and model requests are blocked.' })
    .where(and(eq(investigationRuns.id, runId), eq(investigationRuns.workspaceId, workspace.id), eq(investigationRuns.status, 'running')));
  const saved = await getDb().select().from(investigationRuns).where(eq(investigationRuns.id, runId)).get();
  return serializeInvestigation(saved!);
}

function localEvidence(item: CaseRow, records: Evidence[], section: EvidenceSection): EvidenceEnvelope {
  const selected = records.filter(record => evidenceSections(record).includes(section));
  const limitations = [...new Set(selected.flatMap(record => record.provenance?.limitations || []))];
  for (const record of selected) if (record.fileName && !record.content) limitations.push(`The attachment ${record.fileName} requires manual review. Its contents have not been extracted.`);
  if (!selected.length) limitations.push(`No attached records were classified under ${section}. Related facts may appear in other source records.`);
  if (section === 'attendance') limitations.push('Missing scan records do not establish nonattendance. A scan alone does not establish cardholder identity.');
  if (section === 'policy') limitations.push('Current terms do not establish which disclosures were shown at purchase time.');
  return { caseId: item.id, section, sourceMode: item.source === 'demo' ? 'synthetic' : 'attached', fetchedAt: now(), status: !selected.length ? 'unavailable' : limitations.length ? 'partial' : 'available', limitations,
    records: selected.map(record => ({ id: record.id, source: record.source, sourceId: record.reference || record.id, occurredAt: record.occurredAt, title: record.title, detail: record.content || 'Attachment contents require manual review.', fields: record.provenance?.fields || {} })) };
}

async function digest(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function requireMerchant(workspaceId: string) {
  if (!merchantConfigured(workspaceId)) throw new ApiError(409, 'Configure a merchant evidence connection bound to this workspace before importing or investigating merchant cases.', 'merchant_not_configured');
  const config = readInvestigationSecrets();
  return { baseUrl: config.merchantUrl!, token: config.merchantToken! };
}

function sourceForSection(section: EvidenceSection): EvidenceSource {
  return section === 'summary' ? 'stripe' : section === 'support' ? 'gmail' : section === 'policy' ? 'policy' : 'database';
}

async function normalizeMerchantRecords(workspaceId: string, item: CaseRow, envelope: EvidenceEnvelope) {
  return Promise.all(envelope.records.map(async record => ({ id: `ev_remote_${await digest(`${workspaceId}:${item.id}:${record.id}`)}`, workspaceId, caseId: item.id,
    source: sourceForSection(envelope.section), title: record.title, content: record.detail, occurredAt: record.occurredAt, reference: record.sourceId,
    metadataJson: JSON.stringify({ section: envelope.section, sourceMode: envelope.sourceMode, fields: record.fields, limitations: envelope.limitations, originalSourceId: record.id }), createdAt: now(),
    fileKey: null, fileName: null, mimeType: null,
  })));
}

export async function importMerchantCase(user: ChatGPTUser, externalCaseId: string, signal: AbortSignal): Promise<string> {
  const workspace = await requireWorkspace(user.userId);
  const config = requireMerchant(workspace.id);
  const fetched = await fetchMerchantSection(config, externalCaseId, 'summary', signal);
  if (!fetched.mappingVerified || !fetched.case) throw new ApiError(502, 'The merchant summary lacks a verified payment-to-order mapping.', 'unverified_case');
  const metadata = fetched.case;
  if (metadata.id !== externalCaseId) throw new ApiError(502, 'The merchant returned a different case.', 'case_scope_mismatch');
  const existing = await getDb().select({ id: cases.id }).from(cases).where(and(eq(cases.workspaceId, workspace.id), eq(cases.merchantCaseId, externalCaseId))).get();
  if (existing) throw new ApiError(409, 'This merchant case is already in the workspace.', 'case_exists');
  const id = newId('case'); const timestamp = now();
  const item: CaseRow = { id, workspaceId: workspace.id, title: metadata.reason, customerName: metadata.customerLabel, email: '', amount: metadata.amount, currency: metadata.currency.toLowerCase(), status: 'needs_review', reason: metadata.claim, orderRef: metadata.orderRef, dueAt: metadata.dueAt, source: 'merchant', stripeDisputeId: null, stripeAccountId: null, createdAt: timestamp, updatedAt: timestamp, dataRevision: 0, merchantCaseId: metadata.id, merchantId: metadata.merchantId, paymentRef: metadata.paymentRef };
  const records = await normalizeMerchantRecords(workspace.id, item, fetched.evidence);
  if (signal.aborted) throw new ApiError(409, 'Import was cancelled.');
  try {
    await getDb().batch([getDb().insert(cases).values(item), ...records.map(record => getDb().insert(evidence).values(record)), getDb().insert(auditLogs).values({ id: newId('log'), workspaceId: workspace.id, actor: user.email, action: 'merchant.imported', detail: 'Imported a case through its verified payment-to-order mapping.', caseId: id, createdAt: timestamp })]);
  } catch (error) {
    const duplicate = await getDb().select({ id: cases.id }).from(cases).where(and(eq(cases.workspaceId, workspace.id), eq(cases.merchantCaseId, externalCaseId))).get();
    if (duplicate) throw new ApiError(409, 'This merchant case is already in the workspace.', 'case_exists');
    throw error;
  }
  return id;
}

async function commitInvestigation(workspaceId: string, item: CaseRow, run: RunRow, result: InvestigationResult, pending: EvidenceRow[]) {
  const binding = (env as Cloudflare.Env).DB;
  if (!binding) throw new ApiError(503, 'Workspace storage is unavailable.');
  const timestamp = now();
  const analysis = JSON.stringify({ summary: result.summary, assessment: result.assessment, recommendation: result.recommendation, gaps: result.gaps, findings: result.findings, evidenceIds: result.evidenceIds, modelId: result.modelId, metrics: result.metrics });
  const statements = [binding.prepare(`UPDATE investigation_runs SET status='committing' WHERE id=? AND workspace_id=? AND status='running' AND expires_at>? AND EXISTS (SELECT 1 FROM cases c WHERE c.id=investigation_runs.case_id AND c.workspace_id=investigation_runs.workspace_id AND c.data_revision=? AND c.status IN ('needs_review','investigating','ready')) AND COALESCE((SELECT revision FROM drafts WHERE case_id=? AND workspace_id=?),0)=? AND COALESCE((SELECT status FROM drafts WHERE case_id=? AND workspace_id=?),'none')=? AND COALESCE((SELECT approved_at FROM drafts WHERE case_id=? AND workspace_id=?),'')=?`)
    .bind(run.id, workspaceId, timestamp, run.sourceRevision, item.id, workspaceId, run.baseDraftRevision, item.id, workspaceId, run.baseDraftStatus, item.id, workspaceId, run.baseDraftApprovedAt)];
  for (const record of pending) statements.push(binding.prepare(`INSERT INTO evidence(id,workspace_id,case_id,source,title,content,occurred_at,reference,metadata_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM investigation_runs WHERE id=? AND workspace_id=? AND status='committing') ON CONFLICT(id) DO UPDATE SET source=excluded.source,title=excluded.title,content=excluded.content,occurred_at=excluded.occurred_at,reference=excluded.reference,metadata_json=excluded.metadata_json`)
    .bind(record.id, workspaceId, item.id, record.source, record.title, record.content, record.occurredAt, record.reference, record.metadataJson, record.createdAt, run.id, workspaceId));
  statements.push(binding.prepare(`INSERT INTO drafts(case_id,workspace_id,content,status,generated_at,method,revision,analysis_json,source_revision) SELECT ?,?,?,'draft',?,?,1,?,(SELECT data_revision FROM cases WHERE id=? AND workspace_id=?) WHERE EXISTS(SELECT 1 FROM investigation_runs WHERE id=? AND workspace_id=? AND status='committing') ON CONFLICT(case_id) DO UPDATE SET content=excluded.content,status='draft',generated_at=excluded.generated_at,method=excluded.method,revision=drafts.revision+1,analysis_json=excluded.analysis_json,source_revision=excluded.source_revision,approved_at=NULL,approved_by=NULL`)
    .bind(item.id, workspaceId, result.content, timestamp, run.mode === 'bedrock' ? 'bedrock' : 'sample_investigator', analysis, item.id, workspaceId, run.id, workspaceId));
  statements.push(binding.prepare(`UPDATE cases SET status='needs_review',updated_at=? WHERE id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM investigation_runs WHERE id=? AND workspace_id=? AND status='committing')`).bind(timestamp, item.id, workspaceId, run.id, workspaceId));
  statements.push(binding.prepare(`UPDATE investigation_runs SET status='completed',finished_at=? WHERE id=? AND workspace_id=? AND status='committing'`).bind(timestamp, run.id, workspaceId));
  await binding.batch(statements);
  await getDb().update(investigationRuns).set({ status: 'stale', finishedAt: timestamp, error: 'The case or draft changed during investigation. Your changes were preserved. Start a new investigation.' })
    .where(and(eq(investigationRuns.id, run.id), eq(investigationRuns.workspaceId, workspaceId), eq(investigationRuns.status, 'running')));
}

export async function startInvestigation(user: ChatGPTUser, caseId: string, mode: 'sample' | 'bedrock', requestSignal: AbortSignal): Promise<InvestigationRun> {
  const workspace = await requireWorkspace(user.userId); const wid = workspace.id; const db = getDb();
  const item = await getOwnedCase(wid, caseId);
  if (!mutable.includes(item.status)) throw new ApiError(409, 'This case is closed to changes.');
  const config = readInvestigationSecrets();
  if (mode === 'bedrock' && !getInvestigationConfig(wid).bedrockConfigured) throw new ApiError(409, 'Configure a tool-capable Bedrock model and temporary AWS session in us-east-1.', 'bedrock_not_configured');
  if (mode === 'sample' && item.source !== 'demo') throw new ApiError(409, 'Sample investigation is available only for clearly labeled sample cases.', 'sample_only');
  if (item.source === 'merchant') requireMerchant(wid);
  await expireRuns(wid, caseId);
  const records = await db.select().from(evidence).where(and(eq(evidence.workspaceId, wid), eq(evidence.caseId, caseId))).limit(MAX_RECORDS + 1);
  if (records.length > MAX_RECORDS) throw new ApiError(409, 'This prototype supports up to 100 source records per investigation. Narrow the case evidence first.');
  const draft = await db.select().from(drafts).where(and(eq(drafts.workspaceId, wid), eq(drafts.caseId, caseId))).get();
  const runLimitMs = investigationLimits(mode === 'bedrock' ? config.modelId : undefined).totalTimeoutMs;
  const run: RunRow = { id: newId('run'), workspaceId: wid, caseId, status: 'running', mode, modelId: mode === 'bedrock' ? config.modelId! : null, startedAt: now(), expiresAt: new Date(Date.now() + runLimitMs).toISOString(), finishedAt: null, sourceRevision: item.dataRevision, baseDraftRevision: draft?.revision ?? 0, baseDraftStatus: draft?.status ?? 'none', baseDraftApprovedAt: draft?.approvedAt ?? '', eventsJson: '[]', error: null };
  try { await db.batch([db.insert(investigationRuns).values(run), db.insert(auditLogs).values({ id: newId('log'), workspaceId: wid, actor: user.email, action: 'investigation.started', detail: mode === 'sample' ? 'Started a deterministic investigation of synthetic sample evidence.' : 'Started a sourced Amazon Bedrock investigation.', caseId, createdAt: run.startedAt })]); }
  catch (error) { const active = await db.select({ id: investigationRuns.id }).from(investigationRuns).where(and(eq(investigationRuns.workspaceId, wid), eq(investigationRuns.caseId, caseId), sql`${investigationRuns.status} IN ('running','committing')`)).get(); if (active) throw new ApiError(409, 'An investigation is already running for this case.', 'run_active'); throw error; }
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(runLimitMs)]);
  const pending = new Map<string, EvidenceRow>(); const events: InvestigationEvent[] = [];
  const assertActive = async () => {
    if (signal.aborted) throw new InvestigationError('cancelled', 'The investigation was cancelled or reached its time limit.');
    const active = await db.select().from(investigationRuns).where(and(eq(investigationRuns.id, run.id), eq(investigationRuns.workspaceId, wid))).get();
    if (!active || active.status !== 'running' || active.expiresAt <= now()) throw new InvestigationError('cancelled', 'The investigation is no longer active.');
    const current = await getOwnedCase(wid, caseId);
    const currentDraft = await db.select().from(drafts).where(and(eq(drafts.caseId, caseId), eq(drafts.workspaceId, wid))).get();
    if (current.dataRevision !== run.sourceRevision || !mutable.includes(current.status) || (currentDraft?.revision ?? 0) !== run.baseDraftRevision || (currentDraft?.status ?? 'none') !== run.baseDraftStatus || (currentDraft?.approvedAt ?? '') !== run.baseDraftApprovedAt) throw new InvestigationError('stale', 'The case or draft changed during investigation. Start a new investigation.');
  };
  let summaryVerified = false;
  const readEvidence = async (section: EvidenceSection, sectionSignal: AbortSignal): Promise<EvidenceEnvelope> => {
    await assertActive();
    if (item.source !== 'merchant') {
      if (mode === 'sample') await new Promise(resolve => setTimeout(resolve, 120));
      await assertActive();
      return localEvidence(item, records.map(evidenceForClient), section);
    }
    if (!item.merchantCaseId || !item.merchantId || !item.paymentRef) throw new ApiError(409, 'This case lacks a verified merchant mapping.');
    const fetched = await fetchMerchantSection(requireMerchant(wid), item.merchantCaseId, section, sectionSignal);
    if (section === 'summary') {
      if (!fetched.mappingVerified || fetched.case?.id !== item.merchantCaseId || fetched.case.merchantId !== item.merchantId || fetched.case.paymentRef !== item.paymentRef || fetched.case.orderRef !== item.orderRef || fetched.case.amount !== item.amount || fetched.case.currency.toLowerCase() !== item.currency || fetched.case.claim !== item.reason || fetched.case.dueAt !== item.dueAt) throw new ApiError(409, 'The merchant case/payment mapping changed. Reconfirm the connection before investigating.', 'merchant_mapping_changed');
      summaryVerified = true;
    } else if (!summaryVerified) throw new ApiError(409, 'Verify the merchant summary before reading other sections.');
    const mapped = await normalizeMerchantRecords(wid, item, fetched.evidence);
    for (const record of mapped) pending.set(record.id, record);
    if (new Set([...records.map(record => record.id), ...pending.keys()]).size > MAX_RECORDS) throw new ApiError(409, 'The merchant returned more than 100 records. Narrow the case grant.');
    return { ...fetched.evidence, caseId, records: fetched.evidence.records.map((record, index) => ({ ...record, id: mapped[index].id })) };
  };
  try {
    const result = await runInvestigation({ case: { id: item.id, title: item.title, reason: item.reason, orderRef: item.orderRef, amount: item.amount, currency: item.currency, source: item.source as DisputeCase['source'] }, mode,
      region: config.region, modelId: config.modelId, credentials: config.credentials, signal, readEvidence, assertActive,
      onEvent: async event => { await assertActive(); events.push(event); if (events.length > 100) throw new InvestigationError('limit', 'Investigation event limit reached.'); await db.update(investigationRuns).set({ eventsJson: JSON.stringify(events) }).where(and(eq(investigationRuns.id, run.id), eq(investigationRuns.status, 'running'))); },
    });
    await assertActive();
    await commitInvestigation(wid, item, run, result, [...pending.values()]);
  } catch (error) {
    const stale = error instanceof InvestigationError && error.code === 'stale';
    const cancelled = signal.aborted || (error instanceof InvestigationError && error.code === 'cancelled');
    const message = error instanceof InvestigationError || error instanceof ApiError ? error.message : 'The investigation could not finish. Check the configured connections and try again.';
    await db.update(investigationRuns).set({ status: stale ? 'stale' : cancelled ? 'cancelled' : 'failed', finishedAt: now(), error: message }).where(and(eq(investigationRuns.id, run.id), eq(investigationRuns.workspaceId, wid), eq(investigationRuns.status, 'running')));
  }
  const saved = await db.select().from(investigationRuns).where(and(eq(investigationRuns.id, run.id), eq(investigationRuns.workspaceId, wid))).get();
  await db.insert(auditLogs).values({ id: newId('log'), workspaceId: wid, actor: user.email, action: `investigation.${saved!.status}`, detail: saved!.status === 'completed' ? 'Saved a sourced investigation draft for human review. Nothing was submitted to Stripe.' : 'The investigation stopped without replacing the saved draft.', caseId, createdAt: now() });
  return serializeInvestigation(saved!);
}
