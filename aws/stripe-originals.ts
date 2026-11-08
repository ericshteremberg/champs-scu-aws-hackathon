import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { stripeProviderAccess } from './stripe-provider.ts';
import { readStripeOAuthDispute, readStripeReceiptSource, stripeDisputeId } from './stripe-oauth-api.ts';
import { fetchStripeReceiptPdf } from './stripe-receipt-file.ts';
import { commit, getItem, keys } from './store.ts';
import { ApiError, type EvidenceDoc, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';

export async function verifiedCasePayment(wid: string, row: Awaited<ReturnType<typeof ownedCase>>, records: Awaited<ReturnType<typeof listEvidence>>) {
  const ids = [...new Set([row.data.stripeDisputeId, ...records.filter(e => e.data.source === 'stripe').map(e => e.data.reference)].filter((value): value is string => stripeDisputeId.safeParse(value).success))];
  if (ids.length !== 1) throw new ApiError(409, 'Attach one exact Stripe dispute reference to collect payment-linked originals.', 'payment_link_required');
  const access = await stripeProviderAccess(wid);
  const dispute = await readStripeOAuthDispute(access.token.data, ids[0]);
  if (dispute.amount !== row.data.amount || dispute.currency !== row.data.currency.toLowerCase() || (row.data.stripeAccountId && dispute.accountId !== row.data.stripeAccountId)) throw new ApiError(409, 'The connected Stripe dispute does not match this case.', 'payment_case_mismatch');
  const charge = await readStripeReceiptSource(access.token.data, dispute.chargeId);
  const refs = [charge.id, charge.payment_intent, charge.metadata.order_id, charge.metadata.order_number, charge.metadata.order_ref];
  if (!charge.paid || charge.amount !== row.data.amount || charge.currency !== dispute.currency || charge.payment_intent !== dispute.paymentIntentId || !refs.includes(row.data.orderRef)) throw new ApiError(409, 'The receipt charge does not match this exact order and payment.', 'payment_case_mismatch');
  const checks: StoreChange[] = [access.connection, access.token].map(value => ({ key: value.key, expectedVersion: value.version, check: true }));
  return { dispute, charge, checks };
}

export async function captureOriginalStripeReceipt(user: TrustedUser, caseId: string) {
  const wid = (await requireWorkspace(user)).data.id, row = await ownedCase(wid, caseId);
  assertMutableCase(row.data);
  if (row.data.activeRunId) throw new ApiError(409, 'Wait for the active investigation before collecting originals.', 'run_active');
  const result = { configured: false, captured: 0, alreadySaved: 0, unavailable: [] as { provider: string; reason: string }[] };
  if (row.data.source === 'demo') return result;
  const connection = await getItem<{ status: string }>(wid, 'provider#stripe');
  if (connection?.data.status !== 'authorized' || !process.env.EVIDENCE_BUCKET) return result;
  result.configured = true;
  const [records, draft] = await Promise.all([listEvidence(wid, caseId), getDraft(wid, caseId)]);
  const { dispute, charge, checks: paymentChecks } = await verifiedCasePayment(wid, row, records);
  const saved = records.find(e => e.data.originalDocument?.provider === 'stripe' && e.data.originalDocument.sourceId === dispute.chargeId && e.data.fileKey);
  const checks: StoreChange[] = [{ key: row.key, expectedVersion: row.version, check: true }, ...paymentChecks];
  if (saved) { await commit(wid, checks); result.alreadySaved = 1; return result; }
  if (records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'The case evidence limit has been reached.');
  if (!charge.receipt_url) { result.unavailable.push({ provider: 'Stripe', reason: 'Stripe has no hosted receipt for this charge.' }); return result; }
  const bytes = await fetchStripeReceiptPdf(charge.receipt_url), capturedAt = now();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const id = `ev_receipt_${createHash('sha256').update(`${caseId}:${charge.id}`).digest('hex').slice(0, 24)}`;
  const fileKey = `evidence/${wid}/${caseId}/${id}/${sha256}`;
  const client = new S3Client({ region: 'us-east-1', maxAttempts: 2 });
  try {
    try {
      await client.send(new PutObjectCommand({ Bucket: process.env.EVIDENCE_BUCKET, Key: fileKey, Body: bytes, ContentType: 'application/pdf', ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256 } }), { abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      // A retry may encounter the same content-addressed, immutable private object.
      if (!(error && typeof error === 'object' && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)) throw error;
    }
    const data: EvidenceDoc = { id, caseId, source: 'stripe', title: 'Original Stripe payment receipt', content: `Original Stripe-generated receipt PDF retrieved through the connected account's verified charge and its hosted Download receipt link.\nDispute: ${dispute.id}\nCharge: ${charge.id}\nPaymentIntent: ${charge.payment_intent}\nOrder: ${row.data.orderRef}\nPaid amount: ${charge.amount} minor units ${charge.currency.toUpperCase()}\nThe original provider document is attached, not recreated from this description. Receipt billing/service periods do not establish event dates, delivery, attendance or satisfaction.`, reference: `Stripe receipt ${charge.id}`, occurredAt: new Date(charge.created * 1000).toISOString(), createdAt: capturedAt, capturedAt, fileName: `stripe-receipt-${charge.id}.pdf`, fileKey, mimeType: 'application/pdf', fileSha256: sha256, originalDocument: { provider: 'stripe', kind: 'receipt', sourceId: charge.id }, provenance: { section: 'payment', sourceMode: 'stripe_oauth', originalSourceId: charge.id, fields: { provider: 'Stripe', accountId: dispute.accountId, disputeId: dispute.id, chargeId: charge.id, orderRef: row.data.orderRef }, limitations: ['An original payment receipt establishes recorded payment, not ticket delivery, attendance, policy acceptance or service quality.'] } };
    const changes: StoreChange[] = [...checks.slice(1), { key: keys.evidence(caseId, id), expectedVersion: null, data }, caseChange(row, { ...row.data, status: 'needs_review', dataRevision: row.data.dataRevision + 1, updatedAt: capturedAt }), auditChange(user, 'evidence.original_receipt_collected', 'Preserved the original Stripe receipt PDF in private S3. No payment, refund or submission was made.', caseId)];
    if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
    await commit(wid, changes); result.captured = 1; return result;
  } finally { client.destroy(); }
}
