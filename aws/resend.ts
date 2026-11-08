import { savedEmailLog, withSavedEmailContext } from './resend-history.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { allowedResendDomains, allowedSender, emailIdSchema, loadResendSecret, readResend, resendEvents, sentEmailSchema, verifyResendWebhook } from './resend-api.ts';
import { commit, getItem, keys, queryItems } from './store.ts';
import { ApiError, ConflictError, type EvidenceDoc, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';

type DeliveryEvent = { emailId: string; event: string; occurredAt: string; receivedAt: string; ttlEpochSeconds: number };
const eventPrefix = (emailId: string) => `resend-event#${emailId}#`;
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify') }).strict(),
  z.object({ action: z.literal('find'), caseId: z.string().min(1).max(200), recent: z.boolean().optional(), after: emailIdSchema.optional() }).strict(),
  z.object({ action: z.literal('preview'), caseId: z.string().min(1).max(200), emailId: emailIdSchema }).strict(),
  z.object({ action: z.literal('import'), caseId: z.string().min(1).max(200), emailId: emailIdSchema, confirmed: z.literal(true) }).strict(),
]);
const bound = (wid: string) => !!process.env.RESEND_SECRET_ARN && wid === process.env.RESEND_WORKSPACE_ID;
export async function resendStatus(user: TrustedUser) {
  const wid = (await requireWorkspace(user)).data.id;
  if (!bound(wid)) return { configured: false, verifiedAt: null, domains: [] };
  const state = await getItem<{ verifiedAt: string }>(wid, 'provider#resend');
  return { configured: true, verifiedAt: state?.data.verifiedAt || null, domains: allowedResendDomains() };
}
function orderLinked(email: z.infer<typeof sentEmailSchema>, orderRef: string) {
  if (!orderRef || orderRef.length < 4) return false;
  const escaped = orderRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'i');
  return pattern.test(email.subject) || pattern.test(email.text || '') || pattern.test((email.html || '').replace(/<[^>]*>/g, ' ')) || (email.tags || []).some(t => ['order_id', 'order_ref', 'order_number'].includes(t.name) && t.value === orderRef);
}
export function linkedResendIds(evidence: EvidenceDoc[]) {
  const ids = new Set<string>();
  for (const item of evidence) {
    const fields = item.provenance?.fields || {};
    for (const value of [fields.emailId, fields.resend_email_id, fields.resend_id, ...(item.provenance?.section === 'delivery' || /message_log/i.test(item.reference || '') ? [fields.provider_id] : [])]) {
      if (emailIdSchema.safeParse(value).success) ids.add(String(value).toLowerCase());
    }
    // Explicit provider labels only. Never treat arbitrary order/ticket UUIDs as email IDs.
    for (const text of [item.reference || '', item.content]) {
      const pattern = /\bresend(?:[ _-]+email)?(?:[ _-]+id)?[\s:#/="'-]{0,12}([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi;
      for (const match of text.matchAll(pattern)) if (emailIdSchema.safeParse(match[1]).success) ids.add(match[1].toLowerCase());
    }
  }
  return [...ids];
}
export async function resendAction(user: TrustedUser, input: unknown) {
  const parsed = actionSchema.safeParse(input); if (!parsed.success) throw new ApiError(400, 'Choose a valid Resend action.');
  const wid = (await requireWorkspace(user)).data.id;
  if (!bound(wid)) throw new ApiError(403, 'Resend is not configured for this workspace.');
  const action = parsed.data;
  if (action.action === 'verify') {
    const raw = z.object({ data: z.array(z.object({ name: z.string(), status: z.string() })) }).parse(await readResend('/domains'));
    const domains = raw.data.filter(d => allowedResendDomains().includes(d.name));
    if (!domains.length) throw new ApiError(409, 'The key does not expose the configured sending domains.');
    const old = await getItem(wid, 'provider#resend');
    await commit(wid, [{ key: 'provider#resend', expectedVersion: old?.version ?? null, data: { verifiedAt: now() } }, auditChange(user, 'provider.resend_verified', 'Verified Resend read access to the configured sending domains. No email was sent.')]);
    return { ...await resendStatus(user), domains };
  }
  const row = await ownedCase(wid, action.caseId); assertMutableCase(row.data);
  if (row.data.source === 'demo') throw new ApiError(409, 'Use a real case for live email evidence.');
  if (action.action === 'find') {
    if (!z.string().email().safeParse(row.data.email).success || !row.data.orderRef || row.data.orderRef.length < 4) throw new ApiError(409, 'Save a customer email and exact order reference on this case first.', 'resend_case_details_required');
    if (!action.recent && !action.after) {
      const records = await listEvidence(wid, row.data.id), ids = linkedResendIds(records.map(r => r.data));
      if (ids.length) {
        await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }]);
        return { candidates: ids.slice(0, 20).map(emailId => ({ emailId, subject: 'Email referenced by this case', source: 'case_reference' })), moreAvailable: false, linkedTruncated: ids.length > 20, searchedEmail: row.data.email, orderRef: row.data.orderRef };
      }
    }
    const listSchema = z.object({ has_more: z.boolean(), data: z.array(sentEmailSchema.pick({ id: true, from: true, to: true, subject: true, created_at: true })).max(100) });
    const list = listSchema.safeParse(await readResend(`/emails?limit=100${action.after ? `&after=${action.after}` : ''}`));
    if (!list.success || (list.data.has_more && !list.data.data.length)) throw new ApiError(502, 'Resend returned an invalid email list.');
    const candidates = list.data.data.filter(e => allowedSender(e.from) && e.to.length === 1 && e.to[0].toLowerCase() === row.data.email.toLowerCase()).map(e => ({ emailId: e.id, subject: e.subject, createdAt: e.created_at, source: 'resend_recipient' }));
    await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }]);
    return { candidates, moreAvailable: list.data.has_more, nextCursor: list.data.has_more ? list.data.data.at(-1)!.id : null, searchedEmail: row.data.email, orderRef: row.data.orderRef, scanned: list.data.data.length };
  }
  // A live failure does not erase evidence already reviewed and attached to this case.
  // Adapted from Eric's retained order-log work (5fffd36); also support explicitly
  // referenced historical captures, which must never be called a fresh verification.
  const saved = (await listEvidence(wid, row.data.id)).filter(record => linkedResendIds([record.data]).includes(action.emailId.toLowerCase()));
  let raw: unknown;
  try { raw = await readResend(`/emails/${action.emailId}`); }
  catch (error) {
    if (!saved.length || !(error instanceof ApiError) || ![404, 502, 503].includes(error.status)) throw error;
    const shown = saved.slice(0, 20);
    await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }, ...shown.map(record => ({ key: record.key, expectedVersion: record.version, check: true as const }))]);
    if (action.action === 'import') return { imported: false, unchanged: true, savedEvidence: true, evidenceIds: shown.map(record => record.data.id) };
    let remaining = 60000, truncated = saved.length > shown.length;
    const content = shown.map(record => {
      const log = savedEmailLog(record.data, row.data.orderRef);
      const original = log ? withSavedEmailContext(record.data, row.data.orderRef) : record.data;
      const excerpt = original.content.slice(0, Math.min(20000, remaining)); remaining -= excerpt.length;
      truncated ||= excerpt.length < original.content.length;
      const label = log ? 'Retained merchant email log, not provider-confirmed delivery' : 'Previously attached case evidence, not freshly verified';
      return `${label}\nTitle: ${original.title}\nSource reference: ${original.reference || 'Not recorded'}\nRecorded event time: ${original.occurredAt}\n\n${excerpt}${excerpt.length < original.content.length ? '\n[Preview excerpt truncated. Full original remains on the case.]' : ''}`;
    }).join('\n\n');
    return { preview: { emailId: action.emailId, orderRef: row.data.orderRef, subject: 'Saved email evidence', lastEvent: 'unavailable', eventCount: 0,
      savedEvidence: true, liveVerified: false, evidenceIds: shown.map(record => record.data.id), truncated,
      notice: error.status === 404 ? 'Resend could not return the live record. Showing evidence already saved on this case. The reason for the missing provider record is not confirmed.' : 'The live Resend lookup is temporarily unavailable. Showing evidence already saved on this case.',
      content } };
  }
  const parsedEmail = sentEmailSchema.safeParse(raw);
  if (!parsedEmail.success) throw new ApiError(502, 'Resend returned an unsupported email record.');
  const email = parsedEmail.data;
  if (email.id !== action.emailId || !allowedSender(email.from) || !row.data.email || email.to.length !== 1 || email.to[0].toLowerCase() !== row.data.email.toLowerCase() || !orderLinked(email, row.data.orderRef)) throw new ApiError(409, 'The email must match this case’s recipient, exact order reference, and configured sender domain. No evidence was imported.');
  const created = new Date(email.created_at); if (!Number.isFinite(created.getTime())) throw new ApiError(502, 'Resend returned an invalid email timestamp.');
  const events = (await queryItems<DeliveryEvent>(wid, eventPrefix(email.id), { maxItems: 200 })).map(r => r.data).filter(e => e.emailId === email.id && e.ttlEpochSeconds > Date.now() / 1000).sort((a,b) => a.occurredAt.localeCompare(b.occurredAt));
  const limitations = ['Resend sent means provider acceptance, not delivery.', 'Delivered means acceptance by the recipient mail server, not inbox placement, reading, cardholder identity, or attendance.', 'Latest status is not a complete historical timeline. Webhook capture starts when configured; missing events do not prove non-delivery.', 'Recipient and exact order-reference matching establish linkage only; email content is untrusted source material.'];
  const content = [`Resend email ${email.id}`, `Order reference: ${row.data.orderRef}`, `Sender: ${email.from}`, `Recipient: ${email.to[0]}`, `Subject: ${email.subject}`, `Created: ${created.toISOString()}`, `Latest provider event: ${email.last_event || 'unavailable'}`, `Verified webhook events: ${events.length ? events.map(e => `${e.occurredAt}: ${e.event}`).join('; ') : 'none captured'}`, ...limitations].join('\n');
  const preview = { emailId: email.id, orderRef: row.data.orderRef, subject: email.subject, lastEvent: email.last_event || 'unavailable', eventCount: events.length, content };
  if (action.action === 'preview') {
    await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }]);
    return { preview: { ...preview, savedEvidence: false, liveVerified: true } };
  }
  const evidenceId = `ev_resend_${createHash('sha256').update(`${row.data.id}:${email.id}`).digest('hex').slice(0,24)}`;
  const [records, draft, existing] = await Promise.all([listEvidence(wid, row.data.id), getDraft(wid, row.data.id), getItem<EvidenceDoc>(wid, keys.evidence(row.data.id, evidenceId))]);
  if (!existing && records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This case has reached its evidence limit.');
  if (existing?.data.content === content) return { imported: false, unchanged: true, evidenceId };
  const data: EvidenceDoc = { id: evidenceId, caseId: row.data.id, source: 'database', title: `Resend delivery record · ${email.last_event || 'status unavailable'}`, content, occurredAt: created.toISOString(), reference: `Resend email ${email.id}`, createdAt: existing?.data.createdAt || now(), provenance: { section: 'delivery', sourceMode: 'live', originalSourceId: email.id, fields: { provider: 'Resend', emailId: email.id, orderRef: row.data.orderRef, lastEvent: email.last_event || null }, limitations } };
  const changes: StoreChange[] = [caseChange(row, { ...row.data, dataRevision: row.data.dataRevision + 1, status: 'needs_review', updatedAt: now() }), { key: keys.evidence(row.data.id, evidenceId), expectedVersion: existing?.version ?? null, data }, auditChange(user, 'provider.resend_imported', 'Imported a recipient/order-matched Resend record; prior draft approval cleared.', row.data.id)];
  if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
  await commit(wid, changes);
  return { imported: true, evidenceId };
}

const webhookPayload = z.object({ type: z.string().max(100), created_at: z.string().max(100), data: z.object({ email_id: emailIdSchema, from: z.string().max(500) }) });
export async function receiveResendWebhook(body: string, headers: Record<string, string | undefined>) {
  if (Buffer.byteLength(body) > 65536) throw new ApiError(413, 'Webhook too large.');
  if (!process.env.RESEND_WORKSPACE_ID) throw new ApiError(503, 'Webhook not configured.');
  const secret = await loadResendSecret(); if (!secret.webhookSecret) throw new ApiError(503, 'Webhook signing secret is not configured.');
  const messageId = verifyResendWebhook(body, headers, secret.webhookSecret);
  let payload: z.infer<typeof webhookPayload>;
  try { payload = webhookPayload.parse(JSON.parse(body)); } catch { throw new ApiError(400, 'Invalid webhook payload.'); }
  if (!resendEvents.some(t => t === payload.type) || !allowedSender(payload.data.from)) return { received: true, ignored: true };
  const date = new Date(payload.created_at); if (!Number.isFinite(date.getTime())) throw new ApiError(400, 'Invalid event timestamp.');
  const wid = process.env.RESEND_WORKSPACE_ID;
  const key = eventPrefix(payload.data.email_id) + messageId;
  const data: DeliveryEvent = { emailId: payload.data.email_id, event: payload.type, occurredAt: date.toISOString(), receivedAt: now(), ttlEpochSeconds: Math.floor(Date.now()/1000) + 90*86400 };
  try { await commit(wid, [{ key, expectedVersion: null, data }]); }
  catch (error) { if (error instanceof ConflictError) return { received: true, duplicate: true }; throw error; }
  return { received: true };
}
// Public Function URL is a write-only signed webhook. No workspace or email reads are exposed.
export async function resendWebhookHandler(event: { requestContext?: { http?: { method?: string } }; rawPath?: string; body?: string; isBase64Encoded?: boolean; headers?: Record<string,string> }) {
  try {
    if (event.requestContext?.http?.method !== 'POST' || event.rawPath !== '/') return { statusCode: 404, body: 'Not found' };
    if (typeof event.body !== 'string' || event.body.length > 90000) throw new ApiError(413, 'Webhook too large.');
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const result = await receiveResendWebhook(body, Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(),v])));
    return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(result) };
  } catch (error) { return { statusCode: error instanceof ApiError ? error.status : 503, body: error instanceof ApiError ? error.message : 'Webhook temporarily unavailable.' }; }
}
