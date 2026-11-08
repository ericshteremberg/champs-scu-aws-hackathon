import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { convert } from 'html-to-text';
import { z } from 'zod';
import { linkedResendIds, orderLinked } from './resend.ts';
import { allowedSender, readResend, sentEmailSchema } from './resend-api.ts';
import { commit, keys } from './store.ts';
import { ApiError, type EvidenceDoc, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, caseChange, draftWithoutApproval, getDraft, listEvidence, MAX_CASE_EVIDENCE, now, ownedCase, requireWorkspace } from './workspace.ts';

export type OriginalCaptureResult = { configured: boolean; captured: number; alreadySaved: number; remaining: number; unavailable: { emailId: string; reason: string }[] };

/** Reads only explicitly case-linked emails; preserves provider bodies before model analysis. */
export async function captureOriginalEmails(user: TrustedUser, caseId: string): Promise<OriginalCaptureResult> {
  const wid = (await requireWorkspace(user)).data.id;
  const row = await ownedCase(wid, caseId); assertMutableCase(row.data);
  if (row.data.activeRunId) throw new ApiError(409, 'Wait for the current investigation before collecting originals.', 'run_active');
  const result: OriginalCaptureResult = { configured: Boolean(process.env.RESEND_SECRET_ARN && process.env.RESEND_WORKSPACE_ID === wid && process.env.EVIDENCE_BUCKET), captured: 0, alreadySaved: 0, remaining: 0, unavailable: [] };
  if (!result.configured || row.data.source === 'demo') return result;
  if (!z.string().email().safeParse(row.data.email).success || row.data.orderRef.length < 4) throw new ApiError(409, 'Save the exact order reference and customer email before collecting originals.');
  const [records, draft] = await Promise.all([listEvidence(wid, caseId), getDraft(wid, caseId)]);
  const ids = linkedResendIds(records.map(record => record.data));
  const saved = new Set(records.filter(record => record.data.originalEmail?.provider === 'resend' && record.data.fileKey).map(record => record.data.originalEmail!.emailId));
  result.alreadySaved = ids.filter(id => saved.has(id)).length;
  const pending = ids.filter(id => !saved.has(id)); result.remaining = Math.max(0, pending.length - 3);
  const candidates = pending.slice(0, 3);
  if (records.length + candidates.length > MAX_CASE_EVIDENCE) throw new ApiError(409, 'Narrow the case evidence before collecting more originals.');
  const fetched = await Promise.all(candidates.map(async emailId => {
    try {
      const parsed = sentEmailSchema.safeParse(await readResend(`/emails/${emailId}`));
      if (!parsed.success) throw new ApiError(502, 'The provider returned an unsupported message.');
      const email = parsed.data;
      if (email.id !== emailId || !allowedSender(email.from) || email.to.length !== 1 || email.to[0].toLowerCase() !== row.data.email.toLowerCase() || !orderLinked(email, row.data.orderRef)) throw new ApiError(409, 'The message did not match this case recipient, order and sender.');
      if (!email.html?.trim() && !email.text?.trim()) throw new ApiError(404, 'The provider has no original message body.');
      if (!Number.isFinite(new Date(email.created_at).valueOf())) throw new ApiError(502, 'The message date is invalid.');
      return { emailId, email };
    } catch (error) {
      result.unavailable.push({ emailId, reason: error instanceof ApiError && error.status === 409 ? 'The provider message could not be linked to this exact case.' : 'The provider could not return a usable original. Existing evidence was preserved.' });
      return null;
    }
  }));
  const client = new S3Client({ region: 'us-east-1', maxAttempts: 2 });
  const changes: StoreChange[] = [];
  try {
    for (const value of fetched) {
      if (!value) continue;
      const { emailId, email } = value, capturedAt = now();
      const id = `ev_original_${createHash('sha256').update(`${caseId}:${emailId}`).digest('hex').slice(0, 24)}`;
      const snapshot = { schemaVersion: 1, provider: 'resend', caseId, emailId, capturedAt, message: email };
      const bytes = Buffer.from(JSON.stringify(snapshot)), sha256 = createHash('sha256').update(bytes).digest('hex');
      const fileKey = `evidence/${wid}/${caseId}/${id}/${sha256}`;
      await client.send(new PutObjectCommand({ Bucket: process.env.EVIDENCE_BUCKET!, Key: fileKey, Body: bytes, ContentType: 'application/json', ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256 } }), { abortSignal: AbortSignal.timeout(15000) });
      const text = email.text || convert(email.html || '', { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] });
      const content = `Original email captured from Resend.\nFrom: ${email.from}\nTo: ${email.to.join(', ')}\nSubject: ${email.subject}\nMessage date: ${email.created_at}\nCollected: ${capturedAt}\nProvider ID: ${emailId}\n\n${text.slice(0, 18000)}${text.length > 18000 ? '\n[Model text excerpt truncated. Full original retained.]' : ''}`;
      const data: EvidenceDoc = { id, caseId, source: 'database', title: `Original email: ${email.subject}`.slice(0, 240), content, occurredAt: new Date(email.created_at).toISOString(), reference: `Resend email ${emailId}`, fileName: `resend-${emailId}.json`, mimeType: 'application/json', fileKey, fileSha256: sha256, capturedAt, createdAt: capturedAt, originalEmail: { provider: 'resend', emailId }, provenance: { section: 'delivery', sourceMode: 'live', originalSourceId: emailId, fields: { provider: 'Resend', emailId, orderRef: row.data.orderRef }, limitations: ['This is a provider message-content snapshot, not proof of inbox delivery, reading, attendance or cardholder identity.', 'Visual exhibits render the retained original body. Remote images and active content are blocked.'] } };
      changes.push({ key: keys.evidence(caseId, id), expectedVersion: null, data }); result.captured++;
    }
    if (changes.length) {
      changes.push(caseChange(row, { ...row.data, dataRevision: row.data.dataRevision + 1, status: 'needs_review', updatedAt: now() }), auditChange(user, 'evidence.originals_collected', `Preserved ${result.captured} case-matched original email bodies in private S3. No messages were sent.`, caseId));
      if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
      await commit(wid, changes);
    } else await commit(wid, [{ key: row.key, expectedVersion: row.version, check: true }]);
    return result;
  } finally { client.destroy(); }
}
