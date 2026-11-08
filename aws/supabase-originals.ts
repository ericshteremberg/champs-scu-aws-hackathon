import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { CustomerLookupMapping, OrderEvidenceMapping } from '../lib/providers/types.ts';
import { supabaseProviderAccess } from './providers.ts';
import { fetchSupabaseSchema, querySupabaseReadOnly } from './supabase-api.ts';
import { evidenceQuery, fetchMappedOriginalRows, validateOrderMapping } from './supabase-evidence-api.ts';
import { verifiedCasePayment } from './stripe-originals.ts';
import { commit, getItem, keys } from './store.ts';
import { ApiError, type EvidenceDoc, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';

type Snapshot = { section: string; table: string; query: { sql: string; parameters: string[] }; rows: Record<string, string | number | boolean | null>[] };
type Mapping = { mapping: OrderEvidenceMapping; supabaseVersion: number; projectRef: string; stripeAccountId: string; mode: 'live' | 'test' };
const rowSchema = z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]));
const identifier = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const sensitive = /password|passwd|secret|token|qr.?code|qr.?payload|barcode|private.?key|api.?key|cvv|cvc|card.?number/i;

export async function captureOriginalDatabaseRows(user: TrustedUser, caseId: string) {
  const wid = (await requireWorkspace(user)).data.id, row = await ownedCase(wid, caseId); assertMutableCase(row.data);
  if (row.data.activeRunId) throw new ApiError(409, 'Wait for the active investigation before collecting originals.', 'run_active');
  const result = { configured: false, captured: 0, alreadySaved: 0, unavailable: [] as { provider: string; reason: string }[] };
  if (row.data.source === 'demo') return result;
  const configured = await getItem<{ status: string }>(wid, 'provider#supabase');
  if (configured?.data.status !== 'authorized' || !process.env.EVIDENCE_BUCKET) return result;
  result.configured = true;
  const access = await supabaseProviderAccess(wid), project = access.connection.data.project;
  if (!project) throw new ApiError(409, 'Select the Supabase project before collecting original rows.');
  const [records, draft, mapping, customer] = await Promise.all([
    listEvidence(wid, caseId), getDraft(wid, caseId), getItem<Mapping>(wid, 'provider-mapping#supabase'),
    getItem<{ mapping: CustomerLookupMapping; projectRef: string; connectionVersion: number }>(wid, 'provider-customer-mapping#supabase'),
  ]);
  const payment = await verifiedCasePayment(wid, row, records);
  const paymentRef = payment.charge.payment_intent || payment.charge.id;
  const checks: StoreChange[] = [...payment.checks, ...[access.connection, access.token].map(value => ({ key: value.key, expectedVersion: value.version, check: true as const }))];
  let snapshots: Snapshot[] = [], limitations: string[] = [];
  const schema = await fetchSupabaseSchema(access.token.data.accessToken, project.ref);
  if (mapping && mapping.data.projectRef === project.ref && mapping.data.supabaseVersion === access.connection.version && mapping.data.stripeAccountId === payment.dispute.accountId && mapping.data.mode === payment.dispute.mode) {
    const approved = validateOrderMapping(mapping.data.mapping, access.connection.data.approvedTables || [], schema);
    const ref = approved.order.paymentKind === 'charge' ? payment.charge.id : payment.charge.payment_intent;
    if (!ref) throw new ApiError(409, 'The selected mapping requires a PaymentIntent.');
    const fetched = await fetchMappedOriginalRows(access.token.data.accessToken, project.ref, approved, ref);
    snapshots = fetched.snapshots; limitations = fetched.limitations;
    checks.push({ key: mapping.key, expectedVersion: mapping.version, check: true });
  } else if (customer && customer.data.projectRef === project.ref && customer.data.connectionVersion === access.connection.version) {
    // Reuse the approved identity lookup, using exact IDs from the verified charge, not a name search.
    const m = customer.data.mapping, columns = [m.idColumn, m.nameColumn, m.emailColumn];
    const allowed = access.connection.data.approvedTables?.find(t => t.name === m.table), live = schema.find(t => t.name === m.table);
    if ([m.table, ...columns].some(v => !identifier.test(v) || sensitive.test(v)) || columns.some(c => !allowed?.columns.includes(c) || !live?.columns.includes(c))) throw new ApiError(409, 'The current database columns are not approved.', 'mapping_scope_denied');
    const candidates = [...new Set([payment.charge.metadata.order_id, payment.charge.metadata.customer_id].filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200))];
    for (const sourceId of candidates) {
      const sql = evidenceQuery(m.table, columns, m.idColumn, 2);
      const parsed = z.array(rowSchema).max(2).safeParse(await querySupabaseReadOnly(access.token.data.accessToken, project.ref, sql, [sourceId]));
      if (!parsed.success || parsed.data.some(r => Object.keys(r).length !== columns.length || columns.some(c => !Object.hasOwn(r, c)) || String(r[m.idColumn]) !== sourceId) || JSON.stringify(parsed.data).includes(access.token.data.accessToken)) throw new ApiError(502, 'The provider returned unsupported original rows.');
      if (parsed.data.length > 1) throw new ApiError(409, 'The mapped record ID is not unique.');
      if (parsed.data.length === 1 && String(parsed.data[0][m.emailColumn]).trim().toLowerCase() === row.data.email.trim().toLowerCase()) snapshots.push({ section: 'order', table: m.table, query: { sql, parameters: [sourceId] }, rows: parsed.data });
    }
    limitations = ['Only the approved ID, name and email lookup fields were collected. Configure the order evidence mapping in Connections to include approved order, ticket, delivery, attendance or support fields.', 'The row ID is linked through verified Stripe payment metadata; a name or email match alone does not prove cardholder identity.'];
    checks.push({ key: customer.key, expectedVersion: customer.version, check: true });
  } else throw new ApiError(409, 'Configure the approved Supabase evidence mapping to collect original rows.', 'mapping_required');
  if (!snapshots.length) { result.unavailable.push({ provider: 'Supabase', reason: 'No unique, case-matched rows were returned within the approved scope.' }); return result; }
  const pending = snapshots.map(snapshot => ({ snapshot, id: `ev_rows_${createHash('sha256').update(JSON.stringify([caseId, project.ref, paymentRef, snapshot])).digest('hex').slice(0, 24)}` })).filter(value => { if (records.some(r => r.data.id === value.id && r.data.fileKey)) { result.alreadySaved++; return false; } return true; });
  if (records.length + pending.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'The case evidence limit has been reached.');
  const client = new S3Client({ region: 'us-east-1', maxAttempts: 2 }), changes: StoreChange[] = [];
  try {
    for (const { snapshot, id } of pending) {
      const capturedAt = now();
      const original = { schemaVersion: 1, provider: 'supabase', caseId, projectRef: project.ref, paymentRef, capturedAt, ...snapshot, limitations };
      const bytes = Buffer.from(JSON.stringify(original)), sha256 = createHash('sha256').update(bytes).digest('hex');
      const fileKey = `evidence/${wid}/${caseId}/${id}/${sha256}`;
      await client.send(new PutObjectCommand({ Bucket: process.env.EVIDENCE_BUCKET, Key: fileKey, Body: bytes, ContentType: 'application/json', ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256 } }), { abortSignal: AbortSignal.timeout(15000) });
      const text = JSON.stringify(snapshot.rows, null, 2);
      const content = `Original read-only Supabase query result, collected ${capturedAt}. This is the retrieval time, not the event time.\nProject: ${project.ref}\nTable: public.${snapshot.table}\nQuery: ${snapshot.query.sql}\nParameters: ${JSON.stringify(snapshot.query.parameters)}\nRows returned: ${snapshot.rows.length}\n${text.slice(0, 18000)}${text.length > 18000 ? '\n[Text excerpt truncated; all returned rows retained in the original file.]' : ''}`;
      const linkedEmailIds = snapshot.section === 'delivery' ? [...new Set(snapshot.rows.filter(r => (!r.channel || r.channel === 'email') && (!r.provider || r.provider === 'resend')).map(r => r.provider_id).filter((v): v is string => z.string().uuid().safeParse(v).success))] : [];
      const data: EvidenceDoc = { id, caseId, source: 'database', title: `Original Supabase rows: ${snapshot.table}`, content, reference: `supabase:${project.ref}:public.${snapshot.table}:${id}`, occurredAt: capturedAt, createdAt: capturedAt, capturedAt, fileName: `${snapshot.table}-${id}.json`, mimeType: 'application/json', fileKey, fileSha256: sha256, originalRows: { provider: 'supabase', projectRef: project.ref, table: snapshot.table, rowCount: snapshot.rows.length }, provenance: { section: snapshot.section, sourceMode: 'supabase_oauth', originalSourceId: id, fields: { projectRef: project.ref, table: snapshot.table, paymentRef, rowCount: snapshot.rows.length }, limitations: [...limitations, 'This is an original query-result snapshot and visual export, not a screenshot of the Supabase dashboard. Empty results do not prove nonoccurrence.'] } };
      if (linkedEmailIds.length) data.originalRows!.linkedEmailIds = linkedEmailIds;
      changes.push({ key: keys.evidence(caseId, id), expectedVersion: null, data }); result.captured++;
    }
    if (changes.length) {
      changes.push(caseChange(row, { ...row.data, status: 'needs_review', dataRevision: row.data.dataRevision + 1, updatedAt: now() }), auditChange(user, 'evidence.original_rows_collected', `Preserved ${result.captured} original scoped database query result(s) in private S3. No source database writes.`, caseId));
      if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
      await commit(wid, [...checks, ...changes]);
    } else await commit(wid, [...checks, { key: row.key, expectedVersion: row.version, check: true }]);
    return result;
  } finally { client.destroy(); }
}
