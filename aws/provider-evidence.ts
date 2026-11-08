import { customerActions, customerLookupAction } from './customer-lookup.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { commit, getItem, keys, queryItems } from './store.ts';
import { ApiError, type CaseDoc, type EvidenceDoc, type StoreChange, type Stored, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';
import { stripeProviderAccess } from './stripe-provider.ts';
import { supabaseProviderAccess } from './providers.ts';
import { listStripeOAuthDisputes, readStripeOAuthDispute, stripeDisputeId } from './stripe-oauth-api.ts';
import { fetchSupabaseSchema } from './supabase-api.ts';
import { fetchMappedEvidence, orderMappingSchema, validateOrderMapping } from './supabase-evidence-api.ts';
import type { LinkedEvidencePreview, OrderEvidenceMapping, StripeProviderConnection, SupabaseConnection } from '../lib/providers/types.ts';

const mappingKey = 'provider-mapping#supabase';
type Mapping = { mapping: OrderEvidenceMapping; supabaseVersion: number; projectRef: string; stripeAccountId: string; mode: 'live' | 'test' };
type PaymentLink = { disputeId: string; chargeId: string; paymentIntentId: string | null; accountId: string; mode: 'live' | 'test' };
type Preview = { preview: LinkedEvidencePreview; caseVersion: number; mappingVersion: number; stripeVersion: number; supabaseVersion: number; ttlEpochSeconds: number };
const caseId = z.string().min(1).max(200);
const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('stripe_disputes') }).strict(),
  z.object({ action: z.literal('preview_case_payment'), caseId }).strict(),
  z.object({ action: z.literal('import_stripe_dispute'), disputeId: stripeDisputeId, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('save_mapping'), mapping: orderMappingSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('preview_records'), caseId }).strict(),
  z.object({ action: z.literal('import_records'), caseId, previewId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);
const guard = (...rows: Stored<unknown>[]): StoreChange[] => rows.map(row => ({ key: row.key, expectedVersion: row.version, check: true }));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const matches = (row: Stored<Mapping> | null, supabase: Stored<SupabaseConnection> | null, stripe: Stored<StripeProviderConnection> | null) => !!row && supabase?.data.status === 'authorized' && stripe?.data.status === 'authorized' && row.data.supabaseVersion === supabase.version && row.data.projectRef === supabase.data.project?.ref && row.data.stripeAccountId === stripe.data.accountId && row.data.mode === stripe.data.mode;

export async function providerEvidenceStatus(user: TrustedUser) {
  const wid = (await requireWorkspace(user)).data.id;
  const [mapping, supabase, stripe, links] = await Promise.all([getItem<Mapping>(wid, mappingKey), getItem<SupabaseConnection>(wid, 'provider#supabase'), getItem<StripeProviderConnection>(wid, 'provider#stripe'), queryItems<PaymentLink>(wid, 'provider-case#', { maxItems: 1000 })]);
  return { mapping: matches(mapping, supabase, stripe) ? mapping!.data.mapping : null, eligibleCaseIds: links.filter(row => stripe?.data.status === 'authorized' && row.data.accountId === stripe.data.accountId && row.data.mode === stripe.data.mode).map(row => row.key.slice('provider-case#'.length)) };
}
export async function providerEvidenceAction(user: TrustedUser, input: unknown) {
  if (input && typeof input === 'object' && 'action' in input && typeof input.action === 'string' && input.action.startsWith('customer_')) {
    if (!customerActions.safeParse(input).success) throw new ApiError(400, 'Choose a valid customer lookup action.', 'invalid_request');
    return customerLookupAction(user, input);
  }
  const parsed = actions.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a valid evidence action and confirm imports.', 'invalid_request');
  const action = parsed.data, wid = (await requireWorkspace(user)).data.id;
  const stripe = await stripeProviderAccess(wid);
  const stripeGuard = guard(stripe.connection, stripe.token);
  if (action.action === 'stripe_disputes') {
    const result = await listStripeOAuthDisputes(stripe.token.data);
    await commit(wid, stripeGuard);
    return result;
  }
  if (action.action === 'preview_case_payment') {
    const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
    if (row.data.source === 'demo') throw new ApiError(409, 'Choose a real case for live provider reads.', 'live_case_required');
    const evidence = await listEvidence(wid, row.data.id);
    const ids = [...new Set([row.data.stripeDisputeId, ...evidence.filter(e => e.data.source === 'stripe').map(e => e.data.reference)].filter((v): v is string => stripeDisputeId.safeParse(v).success))];
    if (ids.length !== 1) throw new ApiError(409, 'Import a Stripe dispute or attach its exact dispute reference to this case first. Multiple references require review.', 'payment_link_required');
    const dispute = await readStripeOAuthDispute(stripe.token.data, ids[0]);
    if (dispute.amount !== row.data.amount || dispute.currency.toLowerCase() !== row.data.currency.toLowerCase() || (row.data.stripeAccountId && row.data.stripeAccountId !== dispute.accountId)) throw new ApiError(409, 'The Stripe dispute amount, currency or account differs from this case. Review the case before collecting payment evidence.', 'payment_case_mismatch');
    await commit(wid, [...stripeGuard, ...guard(row)]);
    return { payment: { disputeId: dispute.id, chargeId: dispute.chargeId, paymentIntentId: dispute.paymentIntentId, amount: dispute.amount, currency: dispute.currency, status: dispute.status, email: dispute.email, reason: dispute.reason, dueAt: dispute.dueAt }, limitation: 'Verified provider read. The reference alone does not prove customer identity or delivery. Preview only, nothing imported or submitted.' };
  }
  if (action.action === 'import_stripe_dispute') {
    const dispute = await readStripeOAuthDispute(stripe.token.data, action.disputeId);
    const id = `case_oauth_${hash(`${wid}:${dispute.accountId}:${dispute.mode}:${dispute.id}`).slice(0, 32)}`;
    const existing = await getItem<CaseDoc>(wid, keys.case(id));
    if (existing) { await commit(wid, [...stripeGuard, ...guard(existing)]); return { imported: false, caseId: id }; }
    if (!['needs_response', 'warning_needs_response'].includes(dispute.status)) throw new ApiError(409, 'Only disputes awaiting a response can be imported into this workflow.', 'dispute_not_actionable');
    const timestamp = now();
    const link: PaymentLink = { disputeId: dispute.id, chargeId: dispute.chargeId, paymentIntentId: dispute.paymentIntentId, accountId: dispute.accountId, mode: dispute.mode };
    const data: CaseDoc = { id, workspaceId: wid, title: `Stripe dispute: ${dispute.reason.replaceAll('_', ' ')}`, customerName: dispute.customerName, email: dispute.email, amount: dispute.amount, currency: dispute.currency, status: 'needs_review', reason: dispute.reason, orderRef: dispute.paymentIntentId || dispute.chargeId, paymentRef: dispute.paymentIntentId || dispute.chargeId, dueAt: dispute.dueAt, source: 'stripe', stripeDisputeId: dispute.id, stripeAccountId: dispute.accountId, createdAt: timestamp, updatedAt: timestamp, dataRevision: 1 };
    const fields = { dispute_id: dispute.id, charge_id: dispute.chargeId, payment_intent_id: dispute.paymentIntentId, stripe_account: dispute.accountId, mode: dispute.mode, amount_minor_units: dispute.amount, currency: dispute.currency, reason: dispute.reason, stripe_status: dispute.status, due_at: dispute.dueAt };
    await commit(wid, [...stripeGuard,
      { key: keys.case(id), expectedVersion: null, data },
      { key: `provider-case#${id}`, expectedVersion: null, data: link },
      { key: keys.evidence(id, 'stripe_payment'), expectedVersion: null, data: { id: 'stripe_payment', caseId: id, source: 'stripe', title: 'Verified Stripe dispute and payment', reference: `stripe:${dispute.id}`, content: JSON.stringify(fields, null, 2), occurredAt: dispute.createdAt, createdAt: timestamp, provenance: { section: 'payment', sourceMode: 'stripe_oauth', fields, limitations: ['A payment and dispute do not establish delivery or attendance.'], originalSourceId: dispute.id } } satisfies EvidenceDoc },
      auditChange(user, 'provider.stripe_dispute_imported', 'Imported a selected Stripe dispute and its verified payment. No refund or response submitted.', id),
    ]);
    return { imported: true, caseId: id };
  }
  const supabase = await supabaseProviderAccess(wid);
  const project = supabase.connection.data.project, approved = supabase.connection.data.approvedTables;
  if (!project || !approved?.length) throw new ApiError(409, 'Select a Supabase project and approve evidence columns first.', 'mapping_scope_required');
  const connections = [...stripeGuard, ...guard(supabase.connection, supabase.token)];
  const saved = await getItem<Mapping>(wid, mappingKey);
  if (action.action === 'save_mapping') {
    const mapping = validateOrderMapping(action.mapping, approved, await fetchSupabaseSchema(supabase.token.data.accessToken, project.ref));
    const data: Mapping = { mapping, projectRef: project.ref, supabaseVersion: supabase.connection.version, stripeAccountId: stripe.token.data.accountId, mode: stripe.token.data.mode };
    await commit(wid, [...connections, { key: mappingKey, expectedVersion: saved?.version ?? null, data }, auditChange(user, 'provider.mapping_saved', 'Approved an order-to-payment mapping and direct related tables. No customer rows were queried.')]);
    return { mapping };
  }
  if (!saved || !matches(saved, supabase.connection, stripe.connection)) throw new ApiError(409, 'Save an evidence mapping for the current accounts and approved scope first.', 'mapping_required');
  const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
  const link = await getItem<PaymentLink>(wid, `provider-case#${row.data.id}`);
  if (!link || link.data.accountId !== stripe.token.data.accountId || link.data.mode !== stripe.token.data.mode) throw new ApiError(409, 'Import this dispute from the currently connected Stripe account first.', 'payment_link_required');
  const guards = [...connections, ...guard(saved, link)];
  const previewKey = `provider-evidence-preview#${row.data.id}`;
  if (action.action === 'preview_records') {
    const [dispute, schema] = await Promise.all([readStripeOAuthDispute(stripe.token.data, link.data.disputeId), fetchSupabaseSchema(supabase.token.data.accessToken, project.ref)]);
    if (dispute.chargeId !== link.data.chargeId || dispute.paymentIntentId !== link.data.paymentIntentId) throw new ApiError(409, 'The verified payment link changed. Review the Stripe dispute.', 'payment_link_changed');
    const mapping = validateOrderMapping(saved.data.mapping, approved, schema);
    const paymentRef = mapping.order.paymentKind === 'charge' ? link.data.chargeId : link.data.paymentIntentId;
    if (!paymentRef) throw new ApiError(409, 'This payment has no PaymentIntent. Use a charge-ID mapping if your orders store it.', 'payment_link_required');
    const result = await fetchMappedEvidence(supabase.token.data.accessToken, project.ref, mapping, paymentRef);
    const preview: LinkedEvidencePreview = { ...result, id: randomUUID(), caseId: row.data.id, projectRef: project.ref, paymentRef, fetchedAt: now() };
    const prior = await getItem<Preview>(wid, previewKey);
    await commit(wid, [...guards, ...guard(row), { key: previewKey, expectedVersion: prior?.version ?? null, data: { preview, caseVersion: row.version, mappingVersion: saved.version, stripeVersion: stripe.connection.version, supabaseVersion: supabase.connection.version, ttlEpochSeconds: Math.floor(Date.now() / 1000) + 600 } satisfies Preview }]);
    return { preview };
  }
  const preview = await getItem<Preview>(wid, previewKey);
  if (!preview || preview.data.preview.id !== action.previewId || preview.data.caseVersion !== row.version || preview.data.mappingVersion !== saved.version || preview.data.stripeVersion !== stripe.connection.version || preview.data.supabaseVersion !== supabase.connection.version || preview.data.ttlEpochSeconds <= Date.now() / 1000) throw new ApiError(409, 'Preview these records again before importing. The case, connection or mapping may have changed.', 'evidence_preview_expired');
  const [existing, draft] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id)]);
  const records = preview.data.preview.records.filter(record => !existing.some(e => e.data.id === `supabase_${record.id}`));
  if (!records.length) throw new ApiError(409, 'These exact records are already evidence on this case.', 'evidence_already_imported');
  if (existing.length + records.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'These records would exceed the case evidence limit.', 'evidence_limit');
  const timestamp = now();
  const order = preview.data.preview.records.find(record => record.section === 'order')!;
  const emailColumn = saved.data.mapping.order.customerEmailColumn;
  const orderEmail = z.string().email().max(254).safeParse(emailColumn ? order.fields[emailColumn] : undefined);
  const email = row.data.email || (orderEmail.success ? orderEmail.data : '');
  const orderRef = String(order.fields[saved.data.mapping.order.idColumn]);
  const changes: StoreChange[] = [...guards, { key: preview.key, expectedVersion: preview.version, delete: true }, caseChange(row, { ...row.data, email, orderRef, status: 'needs_review', updatedAt: timestamp, dataRevision: row.data.dataRevision + 1 }), ...records.map(record => ({ key: keys.evidence(row.data.id, `supabase_${record.id}`), expectedVersion: null, data: { id: `supabase_${record.id}`, caseId: row.data.id, source: 'database', title: `${record.section}: ${record.table}`, reference: `supabase:${project.ref}:public.${record.table}:${record.id}`, occurredAt: preview.data.preview.fetchedAt, createdAt: timestamp, content: `Read-only snapshot fetched ${preview.data.preview.fetchedAt}. This timestamp is the fetch time, not the event time.\n${JSON.stringify(record.fields, null, 2)}`, provenance: { section: record.section, sourceMode: 'supabase_oauth', fields: record.fields, limitations: [...preview.data.preview.limitations, 'Snapshot timestamp is the fetch time. Use the original fields for event times.'], originalSourceId: record.id } } satisfies EvidenceDoc })), auditChange(user, 'provider.linked_evidence_imported', `Imported ${records.length} reviewed order-linked records. Prior draft approval cleared.`, row.data.id)];
  if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
  await commit(wid, changes);
  return { imported: true, caseId: row.data.id, count: records.length };
}
