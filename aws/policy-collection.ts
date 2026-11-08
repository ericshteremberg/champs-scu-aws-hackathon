import { createHash } from 'node:crypto';
import { POLICY_LIMITATIONS, exactOrderMention, policyClauses, policyRelatedRecords, policySignal, selectPolicies } from '../lib/policies/matching.ts';
import { commit, getItem, keys, queryItems } from './store.ts';
import type { EvidenceDoc, StoreChange, TrustedUser } from './types.ts';
import { ApiError } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';
import type { PolicyDoc } from './policies.ts';
import { verifiedCasePayment } from './stripe-originals.ts';
import { captureOriginalDatabaseRows } from './supabase-originals.ts';
import { gmailProviderAction } from './gmail-provider.ts';
import { imapProviderAction } from './imap-provider.ts';
import type { GmailPreview, ImapPreview } from '../lib/providers/types.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

async function attach(user: TrustedUser, caseId: string, additions: EvidenceDoc[], guards: StoreChange[], version: number) {
  const wid = (await requireWorkspace(user)).data.id, row = await ownedCase(wid, caseId); assertMutableCase(row.data);
  if (row.version !== version || row.data.activeRunId) throw new ApiError(409, 'The case changed or an investigation is active. Run collection again.', 'conflict');
  if (!additions.length) { await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }, ...guards]); return; }
  const [records, draft] = await Promise.all([listEvidence(wid, caseId), getDraft(wid, caseId)]);
  if (records.length + additions.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'The case evidence limit has been reached.');
  const changes: StoreChange[] = [caseChange(row, { ...row.data, dataRevision: row.data.dataRevision+1, status: 'needs_review', updatedAt: now() }), ...guards, ...additions.map(data => ({ key: keys.evidence(caseId, data.id), expectedVersion: null, data })), auditChange(user, 'policy.evidence_collected', `Attached ${additions.length} dated policy or exact-order correspondence record(s); no acceptance or dispute outcome was assumed.`, caseId)];
  if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
  await commit(wid, changes);
}
export async function collectPolicyEvidence(user: TrustedUser, caseId: string, refreshRecords = false) {
  const wid = (await requireWorkspace(user)).data.id;
  const initial = await ownedCase(wid, caseId); assertMutableCase(initial.data);
  if (initial.data.activeRunId) throw new ApiError(409, 'Wait for the active investigation before collecting policy evidence.', 'run_active');
  const notices: string[] = []; let refreshedRecords = 0;
  if (refreshRecords) {
    try { const result = await captureOriginalDatabaseRows(user, caseId); refreshedRecords = result.captured; notices.push(...result.unavailable.map(v => v.reason)); if (!result.configured) notices.push('Supabase is not connected. Saved records were still checked.'); }
    catch (e) { if (e instanceof ApiError && e.code === 'conflict') throw e; notices.push('Approved order-linked database records could not be refreshed. Existing evidence was preserved.'); }
  }
  const row = await ownedCase(wid, caseId), records = await listEvidence(wid, caseId), policies = await queryItems<PolicyDoc>(wid, 'policy#', { maxItems: 100 });
  let purchaseAt: string | undefined; const guards: StoreChange[] = [];
  try { if (!policies.length) throw new Error('No policies to match'); const payment = await verifiedCasePayment(wid, row, records); purchaseAt = new Date(payment.charge.created * 1000).toISOString(); guards.push(...payment.checks); }
  catch {
    const dates = [...new Set(records.filter(r => ['database','stripe'].includes(r.data.source) && ['live','supabase_oauth','stripe_oauth'].includes(r.data.provenance?.sourceMode || '')).flatMap(r => ['purchasedAt','paidAt','orderCreatedAt'].map(k => r.data.provenance?.fields[k])).filter((v): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))))];
    if (dates.length === 1) purchaseAt = new Date(dates[0]).toISOString();
  }
  const selected = selectPolicies(policies.map(p => p.data), purchaseAt), related = policyRelatedRecords(records.map(r => r.data));
  const additions: EvidenceDoc[] = []; let alreadySaved = 0, remaining = 0;
  for (const match of selected) {
    const p = match.policy as PolicyDoc, stored = policies.find(r => r.data.id === p.id)!;
    const id = `ev_policy_${hash(`${caseId}:${p.id}`)}`;
    if (records.some(r => r.data.id === id)) { alreadySaved++; continue; }
    if (additions.length >= 40) { remaining++; continue; }
    guards.push({ key: stored.key, expectedVersion: stored.version, check: true });
    const limitations = [...POLICY_LIMITATIONS, ...(match.capturedAfterPurchase ? ['This version was captured after the purchase. Its historical use remains unverified, even if its declared effective date is earlier.'] : ['Capture before the purchase establishes retention time only, not checkout disclosure or acceptance.']), ...(match.ambiguous ? ['Multiple versions share this effective date. Applicability is ambiguous.'] : [])];
    const clauses = policyClauses(p.content);
    const content = `Policy: ${p.name}\nType: ${p.kind || 'terms'}\nVersion: ${p.versionLabel || p.version || 'legacy'}\nDeclared effective date: ${p.effectiveDate}\nCaptured: ${p.capturedAt || p.createdAt}\nPurchase timestamp used for matching: ${purchaseAt}\nMatch: candidate based on the declared effective period; not verified checkout acceptance.\nSource: ${p.sourceUrl || p.fileName || 'Merchant-provided text'}\n\n${clauses.length ? 'Relevant clauses (verbatim excerpts; complete policy retained):\n' + clauses.map(c => `“${c}”`).join('\n\n') : 'No refund, cancellation or acceptance clause was identified automatically. Review the full policy.'}\n\n${limitations.join('\n')}${p.extractionNotice ? '\n' + p.extractionNotice : ''}`;
    additions.push({ id, caseId, source: 'policy', title: `${p.name} - version ${p.version || 'legacy'} (historical applicability unverified)`.slice(0, 240), content: content.slice(0, 24000), occurredAt: p.capturedAt || p.createdAt, createdAt: now(), reference: `Policy ${p.id}; effective ${p.effectiveDate}`, ...(p.fileKey ? { fileKey: p.fileKey, fileName: p.fileName, mimeType: p.mimeType, fileSha256: p.fileSha256, capturedAt: p.capturedAt, originalPolicy: { policyId: p.id, sourceType: p.sourceType || 'text', effectiveDate: p.effectiveDate, version: p.version || 1 } } : {}), provenance: { section: 'policy', sourceMode: 'policy_library', originalSourceId: p.id, fields: { policyId: p.id, declaredEffectiveDate: p.effectiveDate, purchaseAt: purchaseAt!, historicalApplicabilityVerified: false, customerAcceptanceVerified: false }, limitations } });
  }
  if (!purchaseAt) notices.push('No verified purchase timestamp was available. No policy was selected using the case creation date or dispute date.');
  else if (!selected.length) notices.push('No stored policy has a declared effective period covering this purchase. Today’s policy was not substituted.');
  if (remaining) notices.push(`${remaining} additional policy matches remain. Run collection again to continue.`);
  await attach(user, caseId, additions, guards, row.version);
  return { captured: additions.length, refreshedRecords, alreadySaved, remaining, purchaseAt, policies: selected.map(s => ({ id: s.policy.id, name: s.policy.name, ambiguous: s.ambiguous, capturedAfterPurchase: s.capturedAfterPurchase })), related: related.map(r => ({ id: r.id, title: r.title, reference: r.reference })), notices, limitation: 'Related records are search matches, not proof of disclosure, acceptance, or a refund obligation. Review their exact fields and timestamps.' };
}
/** Reuses the existing read-only mailbox authorization and exact customer search. */
export async function collectPolicyMail(user: TrustedUser, caseId: string, provider: 'gmail'|'imap') {
  const wid = (await requireWorkspace(user)).data.id, row = await ownedCase(wid, caseId); assertMutableCase(row.data);
  if (row.data.activeRunId) throw new ApiError(409, 'Wait for the active investigation.', 'run_active');
  const connection = await getItem<{ status: string; email?: string; host?: string }>(wid, `provider#${provider}`);
  if (connection?.data.status !== 'authorized') return { captured: 0, candidates: 0, moreAvailable: false, notice: `${provider.toUpperCase()} is not connected.` };
  const action = provider === 'gmail' ? gmailProviderAction : imapProviderAction;
  const searched = await action(user, { action: 'search', caseId, topic: 'policy', ...(provider === 'imap' ? { scope: 'all' } : {}) });
  if (!('messages' in searched)) throw new ApiError(502, 'Mailbox search did not return messages.');
  const records = await listEvidence(wid, caseId); const additions: EvidenceDoc[] = []; let candidates = 0;
  const messageId = (id: string) => `ev_policy_mail_${hash(`${provider}:${connection.data.email}:${connection.data.host || ''}:${caseId}:${id}`)}`;
  const pending = searched.messages.filter(m => !records.some(r => r.data.id === messageId(m.id)));
  for (const message of pending.slice(0, 3)) {
    const found = await action(user, { action: 'preview', caseId, messageId: message.id });
    if (!('preview' in found)) continue;
    const m = found.preview as GmailPreview | ImapPreview;
    const text = `${m.subject}\n${m.text}`;
    if (!policySignal.test(text)) continue;
    const addresses = `${m.from} ${m.to}`.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi) || [];
    if (!addresses.some(a => a.toLowerCase() === row.data.email.toLowerCase()) || !exactOrderMention(text, row.data.orderRef)) { candidates++; continue; }
    const id = messageId(m.id);
    if (records.some(r => r.data.id === id)) continue;
    additions.push({ id, caseId, source: provider, title: `Policy correspondence: ${m.subject || 'Customer message'}`.slice(0,240), content: `From: ${m.from}\nTo: ${m.to}\nDate: ${m.occurredAt}\nSubject: ${m.subject}\n\n${m.text}\n\nPlain-text provider extraction${m.truncated ? ', truncated by the connector' : ''}; attachments excluded. An exact order reference and customer email were matched. A request is not evidence that a refund or cancellation was completed.`, reference: `${provider}:${m.id}`, occurredAt: m.occurredAt, createdAt: now(), provenance: { section: 'support', sourceMode: `${provider}_policy_search`, fields: { orderRef: row.data.orderRef }, limitations: ['A correspondence search match does not establish policy acceptance, cancellation completion or refund issuance.'] } });
  }
  await attach(user, caseId, additions, [{ key: connection.key, expectedVersion: connection.version, check: true }], row.version);
  return { captured: additions.length, candidates, moreAvailable: searched.moreAvailable || pending.length > 3, notice: 'Up to three matching messages were inspected. Messages without an exact order reference require review in the individual mailbox tool.' };
}
