import { withSavedEmailContext } from './resend-history.ts';
import { createHash, randomUUID } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import type { Evidence, EvidenceSource, InvestigationConfig, InvestigationRun } from '../lib/domain.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import { fetchMerchantSection } from '../lib/investigation/merchant.ts';
import { fetchPublicMerchantSection } from './merchant-network.ts';
import { loadManagedConnection } from './managed-connectors.ts';
import { EVIDENCE_SECTIONS, InvestigationError, type EvidenceEnvelope, type EvidenceSection, type InvestigationEvent, type InvestigationMode } from '../lib/investigation/types.ts';
import { commit, getItem, keys, queryItems } from './store.ts';
import { ApiError, ConflictError, mutableStatuses, type CaseDoc, type DraftDoc, type EvidenceDoc, type Stored, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, getDraft, listEvidence, MAX_CASE_EVIDENCE, ownedCase, requireWorkspace } from './workspace.ts';

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const region = () => process.env.AWS_REGION || 'us-east-1';
const active = (status: string) => status === 'queued' || status === 'running';

export type RunDoc = Omit<InvestigationRun, 'events' | 'status'> & {
  status: InvestigationRun['status'] | 'queued'; workspaceId: string; actor: string;
  expiresAt: string; sourceRevision: number; baseDraftRevision: number;
  baseDraftStatus: string; baseDraftApprovedAt: string; workerToken?: string;
  merchantConnectionVersion?: number; merchantCredentialVersion?: number;
};

type ManagedContext = Awaited<ReturnType<typeof loadManagedConnection>>;
function connectionChecks(context?: ManagedContext): StoreChange[] {
  return context ? [
    { key: context.connection.key, expectedVersion: context.connection.version, check: true },
    { key: context.credential.key, expectedVersion: context.credential.version, check: true },
  ] : [];
}
async function caseConnection(wid: string, item: CaseDoc, run?: RunDoc): Promise<ManagedContext | undefined> {
  if (!item.merchantConnectionId) return undefined;
  const context = await loadManagedConnection(wid, item.merchantConnectionId);
  const connection = context.connection.data;
  if (connection.externalCaseId !== item.merchantCaseId || connection.merchantId !== item.merchantId || connection.orderRef !== item.orderRef || connection.paymentRef !== item.paymentRef) throw new ApiError(409, 'The case no longer matches its approved connection.', 'merchant_mapping_changed');
  if (run && (context.connection.version !== run.merchantConnectionVersion || context.credential.version !== run.merchantCredentialVersion)) throw new InvestigationError('stale', 'The connection changed during investigation. Start a new investigation after reviewing the connection.');
  return context;
}

function merchantConfigured(workspaceId: string) {
  if (!process.env.MERCHANT_EVIDENCE_TOKEN || process.env.MERCHANT_WORKSPACE_ID !== workspaceId) return false;
  try { const url = new URL(process.env.MERCHANT_EVIDENCE_URL || ''); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
function requireMerchant(workspaceId: string) {
  if (!merchantConfigured(workspaceId)) throw new ApiError(409, 'Configure a merchant evidence API bound to this workspace.', 'merchant_not_configured');
  return { baseUrl: process.env.MERCHANT_EVIDENCE_URL!, token: process.env.MERCHANT_EVIDENCE_TOKEN! };
}
export function getInvestigationConfig(workspaceId: string): InvestigationConfig {
  return { bedrockConfigured: Boolean(process.env.BEDROCK_MODEL_ID && region() === 'us-east-1'), merchantConfigured: merchantConfigured(workspaceId), archiveConfigured: Boolean(process.env.EVIDENCE_BUCKET && region() === 'us-east-1'), region: region(), modelId: process.env.BEDROCK_MODEL_ID };
}

export async function serializeInvestigation(workspaceId: string, run: RunDoc): Promise<InvestigationRun> {
  const events = await queryItems<InvestigationEvent>(workspaceId, keys.eventPrefix(run.id), { maxItems: 100 });
  return { id: run.id, caseId: run.caseId, status: run.status === 'queued' ? 'running' : run.status, mode: run.mode, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, modelId: run.modelId, events: events.map(event => event.data) };
}

async function closeRun(workspaceId: string, runId: string, status: 'failed' | 'stale' | 'cancelled', error: string, workerToken?: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = await getItem<RunDoc>(workspaceId, keys.run(runId));
    if (!run || !active(run.data.status) || (workerToken && run.data.workerToken !== workerToken)) return;
    const item = await ownedCase(workspaceId, run.data.caseId);
    const changes: StoreChange[] = [{ key: run.key, expectedVersion: run.version, data: { ...run.data, status, error, finishedAt: now() } satisfies RunDoc }];
    changes.push(item.data.activeRunId === runId
      ? { key: item.key, expectedVersion: item.version, data: { ...item.data, activeRunId: undefined, activeRunExpiresAt: undefined } }
      : { key: item.key, expectedVersion: item.version, check: true });
    try { await commit(workspaceId, changes); return; }
    catch (failure) { if (!(failure instanceof ConflictError) || attempt === 2) throw failure; }
  }
}

async function expireRun(workspaceId: string, item: Stored<CaseDoc>) {
  if (!item.data.activeRunId) return;
  const run = await getItem<RunDoc>(workspaceId, keys.run(item.data.activeRunId));
  if (run && active(run.data.status) && run.data.expiresAt <= now()) await closeRun(workspaceId, run.data.id, 'failed', 'This investigation expired. Start a new investigation.');
}

export async function getLatestInvestigation(user: TrustedUser, caseId: string): Promise<InvestigationRun | null> {
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  let item = await ownedCase(wid, caseId); await expireRun(wid, item); item = await ownedCase(wid, caseId);
  if (!item.data.latestRunId) return null;
  const run = await getItem<RunDoc>(wid, keys.run(item.data.latestRunId));
  return run ? serializeInvestigation(wid, run.data) : null;
}

export async function cancelInvestigation(user: TrustedUser, runId: string): Promise<InvestigationRun> {
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const run = await getItem<RunDoc>(wid, keys.run(runId));
  if (!run) throw new ApiError(404, 'Investigation not found.');
  await ownedCase(wid, run.data.caseId);
  await closeRun(wid, runId, 'cancelled', 'Stopped by the reviewer. Further evidence and model requests are blocked.');
  return serializeInvestigation(wid, (await getItem<RunDoc>(wid, keys.run(runId)))!.data);
}

export async function startInvestigation(user: TrustedUser, caseId: string, mode: InvestigationMode): Promise<InvestigationRun> {
  if (mode !== 'sample' && mode !== 'bedrock') throw new ApiError(400, 'Choose sample or bedrock investigation mode.');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  let item = await ownedCase(wid, caseId); await expireRun(wid, item); item = await ownedCase(wid, caseId);
  assertMutableCase(item.data);
  if (item.data.activeRunId) throw new ApiError(409, 'An investigation is already running for this case.', 'run_active');
  if (mode === 'sample' && item.data.source !== 'demo') throw new ApiError(409, 'Sample investigation is available only for clearly labeled sample cases.', 'sample_only');
  if (mode === 'bedrock' && !getInvestigationConfig(wid).bedrockConfigured) throw new ApiError(409, 'Configure a tool-capable Bedrock model in us-east-1.', 'bedrock_not_configured');
  const managed = await caseConnection(wid, item.data);
  if (item.data.source === 'merchant' && !managed) requireMerchant(wid);
  const functionName = process.env.FUNCTION_NAME || process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) throw new ApiError(503, 'The background investigation worker is not configured.', 'worker_not_configured');
  const [draft] = await Promise.all([getDraft(wid, caseId), listEvidence(wid, caseId)]);
  const id = newId('run'); const startedAt = now();
  const run: RunDoc = { id, workspaceId: wid, caseId, actor: user.email, status: 'queued', mode, modelId: mode === 'bedrock' ? process.env.BEDROCK_MODEL_ID : undefined, startedAt, expiresAt: new Date(Date.now() + 300_000).toISOString(), sourceRevision: item.data.dataRevision, baseDraftRevision: draft?.data.revision ?? 0, baseDraftStatus: draft?.data.status ?? 'none', baseDraftApprovedAt: draft?.data.approvedAt ?? '' };
  if (managed) { run.merchantConnectionVersion = managed.connection.version; run.merchantCredentialVersion = managed.credential.version; }
  await commit(wid, [{ key: keys.run(id), expectedVersion: null, data: run }, { key: item.key, expectedVersion: item.version, data: { ...item.data, activeRunId: id, activeRunExpiresAt: run.expiresAt, latestRunId: id } }, ...connectionChecks(managed), auditChange(user, 'investigation.started', mode === 'sample' ? 'Queued a deterministic investigation of synthetic sample evidence.' : 'Queued an Amazon Bedrock investigation.', caseId)]);
  try {
    const result = await new LambdaClient({ region: region(), maxAttempts: 2 }).send(new InvokeCommand({ FunctionName: functionName, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ kind: 'investigation', workspaceId: wid, caseId, runId: id })) }));
    if (result.StatusCode !== 202) throw new Error('Worker rejected invocation.');
  } catch {
    await closeRun(wid, id, 'failed', 'The background investigation could not be queued. Try again.');
    throw new ApiError(503, 'The background investigation could not be queued. Try again.', 'worker_unavailable');
  }
  return serializeInvestigation(wid, run);
}

function classify(row: Evidence): EvidenceSection {
  if (row.provenance && EVIDENCE_SECTIONS.includes(row.provenance.section as EvidenceSection)) return row.provenance.section as EvidenceSection;
  if (row.source === 'stripe') return 'summary';
  if ((row.source === 'gmail' || row.source === 'imap')) return 'support';
  if (row.source === 'policy') return 'policy';
  const text = `${row.title} ${row.content}`;
  if (/scan|admission|attendance/i.test(text)) return 'attendance';
  if (/recover|resend|transfer|replac/i.test(text)) return 'history';
  if (/deliver|dispatch|email|sms|bounce|mailbox/i.test(text)) return 'delivery';
  if (/ticket.*issu|issu.*ticket/i.test(text)) return 'tickets';
  return 'order';
}
export function localEvidence(item: CaseDoc, records: Evidence[], section: EvidenceSection): EvidenceEnvelope {
  const selected = records.filter(record => classify(record) === section).map(record => withSavedEmailContext(record, item.orderRef));
  const limitations = [...new Set(selected.flatMap(record => record.provenance?.limitations || []))];
  for (const record of selected) if (record.fileName && !record.content) limitations.push(`The attachment ${record.fileName} requires manual review. Its contents have not been extracted.`);
  if (!selected.length) limitations.push(`No attached records are classified under ${section}. Related facts may appear in records filed under other sections; this does not establish that source records or events do not exist.`);
  if (section === 'attendance') limitations.push('Missing scan records do not establish nonattendance. A scan alone does not establish cardholder identity.');
  if (section === 'policy') limitations.push('Current terms do not establish which disclosures were shown at purchase time.');
  return { caseId: item.id, section, sourceMode: item.source === 'demo' ? 'synthetic' : 'attached', fetchedAt: now(), status: !selected.length ? 'unavailable' : limitations.length ? 'partial' : 'available', limitations,
    records: selected.map(record => ({ id: record.id, source: record.source, sourceId: record.reference || record.id, occurredAt: record.occurredAt, title: record.title, detail: record.content || 'Attachment contents require manual review.', fields: record.provenance?.fields || {} })) };
}
function sourceForSection(section: EvidenceSection): EvidenceSource { return section === 'summary' ? 'stripe' : section === 'support' ? 'gmail' : section === 'policy' ? 'policy' : 'database'; }
function normalizeMerchantRecords(wid: string, item: CaseDoc, envelope: EvidenceEnvelope): EvidenceDoc[] {
  return envelope.records.map(record => ({ id: `ev_remote_${digest(`${wid}:${item.id}:${record.id}`)}`, caseId: item.id, source: sourceForSection(envelope.section), title: record.title, content: record.detail, occurredAt: record.occurredAt, reference: record.sourceId, provenance: { section: envelope.section, sourceMode: envelope.sourceMode, fields: record.fields, limitations: envelope.limitations, originalSourceId: record.id }, createdAt: now() }));
}
function assertSnapshot(run: RunDoc, item: CaseDoc, draft: DraftDoc | undefined) {
  if (item.activeRunId !== run.id || item.dataRevision !== run.sourceRevision || !mutableStatuses.includes(item.status) || (draft?.revision ?? 0) !== run.baseDraftRevision || (draft?.status ?? 'none') !== run.baseDraftStatus || (draft?.approvedAt ?? '') !== run.baseDraftApprovedAt) throw new InvestigationError('stale', 'The case or draft changed during investigation. Your changes were preserved. Start a new investigation.');
}

export async function processInvestigation(input: { workspaceId: string; caseId: string; runId: string }): Promise<void> {
  const { workspaceId: wid, caseId, runId } = input;
  const queued = await getItem<RunDoc>(wid, keys.run(runId));
  if (!queued || queued.data.status !== 'queued' || queued.data.caseId !== caseId || queued.data.workspaceId !== wid) return;
  if (queued.data.expiresAt <= now()) { await closeRun(wid, runId, 'failed', 'This investigation expired before the worker started.'); return; }
  const item = await ownedCase(wid, caseId); const initialDraft = await getDraft(wid, caseId);
  const workerToken = randomUUID();
  const running: RunDoc = { ...queued.data, status: 'running', workerToken, expiresAt: new Date(Date.now() + 120_000).toISOString() };
  try {
    assertSnapshot(running, item.data, initialDraft?.data);
    await commit(wid, [{ key: queued.key, expectedVersion: queued.version, data: running }, { key: item.key, expectedVersion: item.version, data: { ...item.data, activeRunExpiresAt: running.expiresAt } }]);
  } catch (error) {
    if (error instanceof ConflictError) return;
    if (error instanceof InvestigationError) { await closeRun(wid, runId, 'stale', error.message); return; }
    throw error;
  }
  const signal = AbortSignal.timeout(120_000);
  let modelClient: BedrockRuntimeClient | undefined;
  try {
    const records = await listEvidence(wid, caseId); const pending = new Map<string, EvidenceDoc>(); let sequence = 0; let summaryVerified = false;
    const snapshot = async () => {
      if (signal.aborted) throw new InvestigationError('time_limit', 'The investigation reached its two-minute limit.');
      const [run, current, draft] = await Promise.all([getItem<RunDoc>(wid, keys.run(runId)), ownedCase(wid, caseId), getDraft(wid, caseId)]);
      if (!run || run.data.status !== 'running' || run.data.workerToken !== workerToken) throw new InvestigationError('cancelled', 'The investigation is no longer active.');
      if (run.data.expiresAt <= now()) throw new InvestigationError('time_limit', 'The investigation reached its two-minute limit.');
      assertSnapshot(run.data, current.data, draft?.data);
      const managed = await caseConnection(wid, current.data, run.data);
      return { run, current, draft, managed };
    };
    const assertActive = async () => { await snapshot(); };
    const readEvidence = async (section: EvidenceSection, sectionSignal: AbortSignal): Promise<EvidenceEnvelope> => {
      const { managed } = await snapshot();
      if (item.data.source !== 'merchant') return localEvidence(item.data, records.map(record => record.data), section);
      if (!item.data.merchantCaseId || !item.data.merchantId || !item.data.paymentRef) throw new ApiError(409, 'This case lacks a verified merchant mapping.');
      if (section !== 'summary' && !summaryVerified) throw new ApiError(409, 'Verify the merchant summary before reading other sections.');
      const fetched = managed
        ? await fetchPublicMerchantSection(managed.configuration, item.data.merchantCaseId, section, sectionSignal)
        : await fetchMerchantSection(requireMerchant(wid), item.data.merchantCaseId, section, sectionSignal);
      await assertActive();
      if (section === 'summary') {
        const metadata = fetched.case;
        if (!fetched.mappingVerified || metadata?.id !== item.data.merchantCaseId || metadata.merchantId !== item.data.merchantId || metadata.paymentRef !== item.data.paymentRef || metadata.orderRef !== item.data.orderRef || metadata.amount !== item.data.amount || metadata.currency.toLowerCase() !== item.data.currency.toLowerCase() || metadata.claim !== item.data.reason || metadata.dueAt !== item.data.dueAt) throw new ApiError(409, 'The merchant case/payment mapping changed. Reconfirm it before investigating.', 'merchant_mapping_changed');
        summaryVerified = true;
      }
      const mapped = normalizeMerchantRecords(wid, item.data, fetched.evidence);
      for (const record of mapped) pending.set(record.id, record);
      if (new Set([...records.map(record => record.data.id), ...pending.keys()]).size > MAX_CASE_EVIDENCE) throw new ApiError(409, 'The merchant returned more than 90 records. Narrow the case grant.');
      return { ...fetched.evidence, caseId, records: fetched.evidence.records.map((record, index) => ({ ...record, id: mapped[index].id })) };
    };
    if (running.mode === 'bedrock') modelClient = new BedrockRuntimeClient({ region: region(), maxAttempts: 1, requestHandler: new FetchHttpHandler({ requestTimeout: 45_000 }) });
    const result = await runInvestigation({ case: item.data, mode: running.mode, modelId: running.modelId, region: region(), signal, readEvidence, assertActive,
      invokeModel: modelClient ? (command, abortSignal) => modelClient!.send(new ConverseCommand(command), { abortSignal }) : undefined,
      onEvent: async event => {
        if (++sequence > 100) throw new InvestigationError('event_limit', 'The investigation reached its event limit.');
        const { run, current, managed } = await snapshot();
        await commit(wid, [{ key: run.key, expectedVersion: run.version, check: true }, { key: current.key, expectedVersion: current.version, check: true }, ...connectionChecks(managed), { key: keys.event(runId, sequence), expectedVersion: null, data: event }]);
      },
    });
    const { run, current, draft, managed } = await snapshot(); const timestamp = now();
    const sourceRevision = current.data.dataRevision + pending.size;
    const { content, findings, ...analysis } = result;
    const nextDraft: DraftDoc = { caseId, content, revision: (draft?.data.revision ?? 0) + 1, generatedAt: timestamp, status: 'draft', method: running.mode === 'bedrock' ? 'bedrock' : 'sample_investigator', sourceRevision, analysis: { ...analysis, findings } };
    const changes: StoreChange[] = [
      { key: run.key, expectedVersion: run.version, data: { ...run.data, status: 'completed', finishedAt: timestamp } satisfies RunDoc },
      { key: current.key, expectedVersion: current.version, data: { ...current.data, dataRevision: sourceRevision, status: 'needs_review', updatedAt: timestamp, activeRunId: undefined, activeRunExpiresAt: undefined } satisfies CaseDoc },
      { key: keys.draft(caseId), expectedVersion: draft?.version ?? null, data: nextDraft },
      ...connectionChecks(managed),
    ];
    for (const record of pending.values()) changes.push({ key: keys.evidence(caseId, record.id), expectedVersion: records.find(existing => existing.data.id === record.id)?.version ?? null, data: record });
    await commit(wid, changes);
  } catch (error) {
    // Log operational failures without event payloads, evidence, request bodies, or credentials.
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const loggable = error instanceof ApiError || error instanceof InvestigationError || ['ReferenceError', 'TypeError', 'ValidationException', 'AccessDeniedException', 'ResourceNotFoundException', 'TransactionCanceledException'].includes(errorName);
    let diagnostic = loggable && error instanceof Error ? error.message.slice(0, 500) : 'Unexpected worker failure.';
    for (const secret of [process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY, process.env.AWS_SESSION_TOKEN, process.env.MERCHANT_EVIDENCE_TOKEN]) if (secret) diagnostic = diagnostic.split(secret).join('[redacted]');
    console.error(JSON.stringify({ event: 'investigation_failed', runId, type: errorName, message: diagnostic }));
    const stale = error instanceof ConflictError || (error instanceof InvestigationError && error.code === 'stale');
    const message = error instanceof InvestigationError || error instanceof ApiError ? error.message : 'The investigation could not finish. Check the configured connections and try again.';
    await closeRun(wid, runId, stale ? 'stale' : 'failed', message, workerToken);
  } finally { modelClient?.destroy(); }
}

export async function importMerchantCase(user: TrustedUser, externalCaseId: string): Promise<string> {
  if (typeof externalCaseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(externalCaseId)) throw new ApiError(400, 'Enter a valid merchant case ID.');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const fetched = await fetchMerchantSection(requireMerchant(wid), externalCaseId, 'summary', AbortSignal.timeout(15_000));
  if (!fetched.mappingVerified || !fetched.case || fetched.case.id !== externalCaseId) throw new ApiError(502, 'The merchant summary lacks a verified payment-to-order mapping.', 'unverified_case');
  if (await getItem(wid, keys.externalCase(externalCaseId))) throw new ApiError(409, 'This merchant case is already in the workspace.', 'case_exists');
  const metadata = fetched.case; const id = newId('case'); const timestamp = now();
  const item: CaseDoc = { id, workspaceId: wid, title: metadata.reason, customerName: metadata.customerLabel, email: '', amount: metadata.amount, currency: metadata.currency.toLowerCase(), status: 'needs_review', reason: metadata.claim, orderRef: metadata.orderRef, dueAt: metadata.dueAt, source: 'merchant', createdAt: timestamp, updatedAt: timestamp, dataRevision: 0, merchantCaseId: metadata.id, merchantId: metadata.merchantId, paymentRef: metadata.paymentRef };
  const records = normalizeMerchantRecords(wid, item, fetched.evidence);
  if (records.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'The merchant returned more than 90 records. Narrow the case grant.');
  await commit(wid, [{ key: keys.case(id), expectedVersion: null, data: { ...item, dataRevision: records.length } }, { key: keys.externalCase(externalCaseId), expectedVersion: null, data: { caseId: id, merchantId: metadata.merchantId } }, ...records.map(record => ({ key: keys.evidence(id, record.id), expectedVersion: null, data: record })), auditChange(user, 'merchant.imported', 'Imported a case through its verified payment-to-order mapping.', id)]);
  return id;
}

/** Imports only the approved case stored on the connection, never an arbitrary caller-supplied case. */
export async function importManagedMerchantCase(user: TrustedUser, connectionId: string): Promise<string> {
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const context = await loadManagedConnection(wid, connectionId);
  const connection = context.connection.data;
  const indexKey = keys.externalCase(`live:${connectionId}:${connection.externalCaseId}`);
  const existing = await getItem<{ caseId: string }>(wid, indexKey);
  if (existing) {
    await ownedCase(wid, existing.data.caseId);
    await commit(wid, [...connectionChecks(context), { key: existing.key, expectedVersion: existing.version, check: true }]);
    return existing.data.caseId;
  }
  const fetched = await fetchPublicMerchantSection(context.configuration, connection.externalCaseId, 'summary', AbortSignal.timeout(15_000));
  const metadata = fetched.case;
  if (!fetched.mappingVerified || !metadata || metadata.id !== connection.externalCaseId || metadata.merchantId !== connection.merchantId || metadata.orderRef !== connection.orderRef || metadata.paymentRef !== connection.paymentRef) throw new ApiError(409, 'The endpoint no longer matches this connection’s approved merchant, order, and payment.', 'merchant_mapping_changed');
  const id = newId('case'); const timestamp = now();
  const item: CaseDoc = { id, workspaceId: wid, title: metadata.reason, customerName: metadata.customerLabel, email: '', amount: metadata.amount, currency: metadata.currency.toLowerCase(), status: 'needs_review', reason: metadata.claim, orderRef: metadata.orderRef, dueAt: metadata.dueAt, source: 'merchant', createdAt: timestamp, updatedAt: timestamp, dataRevision: 0, merchantCaseId: metadata.id, merchantId: metadata.merchantId, paymentRef: metadata.paymentRef, merchantConnectionId: connectionId };
  const records = normalizeMerchantRecords(wid, item, fetched.evidence);
  if (records.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'The merchant returned more than 90 records. Narrow the case grant.');
  try {
    await commit(wid, [
      ...connectionChecks(context),
      { key: keys.case(id), expectedVersion: null, data: { ...item, dataRevision: records.length } },
      { key: indexKey, expectedVersion: null, data: { caseId: id, merchantId: metadata.merchantId } },
      ...records.map(record => ({ key: keys.evidence(id, record.id), expectedVersion: null, data: record })),
      auditChange(user, 'merchant.imported', 'Imported the approved case from its saved live connection.', id),
    ]);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const current = await loadManagedConnection(wid, connectionId);
    const concurrent = await getItem<{ caseId: string }>(wid, indexKey);
    if (!concurrent) throw error;
    await ownedCase(wid, concurrent.data.caseId);
    await commit(wid, [...connectionChecks(current), { key: concurrent.key, expectedVersion: concurrent.version, check: true }]);
    return concurrent.data.caseId;
  }
  return id;
}
