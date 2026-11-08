import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { validateUpload, UploadValidationError } from '../lib/server/uploads.ts';
import { commit, getItem, keys } from './store.ts';
import { ApiError, type CaseDoc, type EvidenceDoc, type Stored, type StoreChange, type TrustedUser } from './types.ts';
import { assertMutableCase, auditChange, draftWithoutApproval, findEvidence, getDraft, listEvidence, MAX_CASE_EVIDENCE, ownedCase, requireWorkspace } from './workspace.ts';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const now = () => new Date().toISOString();
const uploadSchema = z.object({
  caseId: z.string().min(1).max(200), title: z.string().trim().min(1).max(240),
  source: z.enum(['stripe', 'gmail', 'database', 'policy', 'manual']),
  fileName: z.string().min(1).max(255), mimeType: z.string().max(160).regex(/^[a-zA-Z0-9!#$&^_.+\-/]*$/),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
}).strict();
type PendingUpload = z.infer<typeof uploadSchema> & { id: string; ownerId: string; workspaceId: string; tempKey: string; createdAt: string; expiresAt: string; ttlEpochSeconds: number; evidenceId?: string };

function storage() {
  const bucket = process.env.EVIDENCE_BUCKET;
  if (!bucket || (process.env.AWS_REGION || 'us-east-1') !== 'us-east-1') throw new ApiError(503, 'Private AWS file storage is not configured.', 'storage_unavailable');
  return { bucket, client: new S3Client({ region: 'us-east-1', maxAttempts: 2 }) };
}
const filename = (value: string) => value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(-180) || 'attachment';

export async function prepareUpload(user: TrustedUser, input: unknown): Promise<{ uploadId: string; uploadUrl: string; fields: Record<string, string>; method: 'POST' }> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'Choose a supported evidence file between 1 byte and 10 MB, with a title and source.', 'invalid_upload');
  const metadata = parsed.data;
  if (!/\.(pdf|png|jpe?g|txt|csv|json|eml)$/i.test(metadata.fileName)) throw new ApiError(400, 'Use PDF, PNG, JPEG, UTF-8 text, CSV, JSON, or EML evidence.', 'invalid_upload');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id; const item = await ownedCase(wid, metadata.caseId);
  assertMutableCase(item.data);
  if ((await listEvidence(wid, metadata.caseId)).length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This prototype supports up to 90 evidence records per case.');
  const { bucket, client } = storage();
  const id = `upload_${randomUUID()}`; const tempKey = `pending/${wid}/${id}`;
  const data: PendingUpload = { ...metadata, fileName: filename(metadata.fileName), id, ownerId: user.userId, workspaceId: wid, tempKey, createdAt: now(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), ttlEpochSeconds: Math.floor(Date.now() / 1000) + 86400 };
  try {
    const signed = await createPresignedPost(client, { Bucket: bucket, Key: tempKey, Expires: 600,
      Fields: { 'Content-Type': metadata.mimeType || 'application/octet-stream', 'x-amz-server-side-encryption': 'AES256' },
      Conditions: [['content-length-range', metadata.size, metadata.size], ['eq', '$Content-Type', metadata.mimeType || 'application/octet-stream'], ['eq', '$x-amz-server-side-encryption', 'AES256']],
    });
    await commit(wid, [{ key: item.key, expectedVersion: item.version, check: true }, { key: keys.upload(id), expectedVersion: null, data }]);
    return { uploadId: id, uploadUrl: signed.url, fields: signed.fields, method: 'POST' };
  } finally { client.destroy(); }
}

async function readUploadedBytes(client: S3Client, bucket: string, upload: PendingUpload) {
  const signal = AbortSignal.timeout(20_000);
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: upload.tempKey }), { abortSignal: signal });
  if (!object.Body) throw new ApiError(409, 'The uploaded file is not available yet. Retry after the upload finishes.', 'upload_missing');
  const reader = object.Body.transformToWebStream().getReader();
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    if (object.ContentLength !== undefined && object.ContentLength !== upload.size) throw new ApiError(400, 'The uploaded file size differs from the prepared upload.', 'invalid_upload');
    while (true) {
      if (signal.aborted) throw new ApiError(408, 'Reading the uploaded file timed out. Retry the upload.');
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_UPLOAD_BYTES || length > upload.size) throw new ApiError(400, 'The uploaded file exceeds its permitted size.', 'invalid_upload');
      chunks.push(chunk.value);
    }
    if (length !== upload.size) throw new ApiError(400, 'The uploaded file size differs from the prepared upload.', 'invalid_upload');
    return Buffer.concat(chunks, length);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

export async function completeUpload(user: TrustedUser, uploadId: string): Promise<void> {
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const upload = await getItem<PendingUpload>(wid, keys.upload(uploadId));
  if (!upload || upload.data.ownerId !== user.userId || upload.data.workspaceId !== wid) throw new ApiError(404, 'Prepared upload not found.');
  if (upload.data.evidenceId) { await findEvidence(wid, upload.data.evidenceId); return; }
  if (upload.data.expiresAt <= now()) throw new ApiError(410, 'This upload expired. Choose the file again.');
  const item = await ownedCase(wid, upload.data.caseId); assertMutableCase(item.data);
  const [records, draft] = await Promise.all([listEvidence(wid, item.data.id), getDraft(wid, item.data.id)]);
  if (records.length >= MAX_CASE_EVIDENCE) throw new ApiError(409, 'This prototype supports up to 90 evidence records per case.');
  const { bucket, client } = storage();
  // The browser can overwrite only its pending key. A validated copy receives a new, server-only key.
  const evidenceId = `ev_${randomUUID()}`; const finalKey = `evidence/${wid}/${item.data.id}/${evidenceId}`;
  try {
    let bytes: Buffer;
    try { bytes = await readUploadedBytes(client, bucket, upload.data); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) throw new ApiError(409, 'The uploaded file is not available yet. Retry after the upload finishes.', 'upload_missing');
      throw error;
    }
    let validated: ReturnType<typeof validateUpload>;
    try { validated = validateUpload(upload.data.fileName, upload.data.mimeType, bytes); }
    catch (error) { if (error instanceof UploadValidationError) throw new ApiError(400, error.message, 'invalid_upload'); throw error; }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: finalKey, Body: bytes, ContentType: validated.mimeType, ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256: createHash('sha256').update(bytes).digest('hex') } }), { abortSignal: AbortSignal.timeout(20_000) });
    const content = validated.textContent.length > 24000 ? `${validated.textContent.slice(0, 23800)}\n[Text preview truncated. Review the attached original.]` : validated.textContent;
    const evidence: EvidenceDoc = { id: evidenceId, caseId: item.data.id, source: upload.data.source, title: upload.data.title, content, occurredAt: now(), reference: validated.fileName, fileName: validated.fileName, mimeType: validated.mimeType, fileKey: finalKey, fileSha256: createHash('sha256').update(bytes).digest('hex'), capturedAt: now(), createdAt: now() };
    const changes: StoreChange[] = [
      { key: item.key, expectedVersion: item.version, data: { ...item.data, dataRevision: item.data.dataRevision + 1, status: 'needs_review', updatedAt: now() } satisfies CaseDoc },
      { key: keys.evidence(item.data.id, evidenceId), expectedVersion: null, data: evidence },
      { key: upload.key, expectedVersion: upload.version, data: { ...upload.data, evidenceId } satisfies PendingUpload },
      auditChange(user, 'evidence.uploaded', 'Validated and attached an original file in private S3; prior approval cleared.', item.data.id),
    ];
    if (draft) changes.push({ key: draft.key, expectedVersion: draft.version, data: draftWithoutApproval(draft.data) });
    try { await commit(wid, changes); }
    catch (error) {
      // A lost response can hide a successful transaction. Reconcile its immutable IDs.
      const acceptedUpload = await getItem<PendingUpload>(wid, upload.key).catch(() => null);
      const acceptedEvidence = acceptedUpload?.data.evidenceId === evidenceId
        ? await getItem<EvidenceDoc>(wid, keys.evidence(item.data.id, evidenceId)).catch(() => null)
        : null;
      if (acceptedEvidence?.data.fileKey !== finalKey) throw error;
    }
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: upload.data.tempKey })).catch(() => undefined);
  } finally {
    // Never delete a final object after an uncertain commit, even when reconciliation
    // cannot confirm it yet. Unreferenced copies stay private for later cleanup.
    client.destroy();
  }
}

export async function getDownload(user: TrustedUser, evidenceId: string): Promise<{ url: string }> {
  const workspace = await requireWorkspace(user); const row = await findEvidence(workspace.data.id, evidenceId);
  if (!row.data.fileKey) throw new ApiError(404, 'This evidence has no attached original.');
  const { bucket, client } = storage();
  const safeName = filename(row.data.fileName || 'attachment').replace(/["\\]/g, '_');
  try {
    return { url: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: row.data.fileKey, ResponseContentType: row.data.mimeType || 'application/octet-stream', ResponseContentDisposition: `attachment; filename="${safeName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeName)}` }), { expiresIn: 60 }) };
  } finally { client.destroy(); }
}

export async function archiveApprovedCase(user: TrustedUser, caseId: string, revision: number): Promise<{ archived: true; key: string; sha256: string }> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError(400, 'Select an approved response revision.');
  const workspace = await requireWorkspace(user); const wid = workspace.data.id;
  const item = await ownedCase(wid, caseId); const draft = await getDraft(wid, caseId);
  if (!draft || draft.data.status !== 'approved' || draft.data.revision !== revision || draft.data.sourceRevision !== item.data.dataRevision || !draft.data.approvedAt) throw new ApiError(409, 'Review and approve the current evidence and response before archiving.', 'stale_archive');
  const records = await listEvidence(wid, caseId);
  if (!records.length) throw new ApiError(409, 'Attach evidence before archiving.');
  records.sort((a, b) => a.data.id.localeCompare(b.data.id));
  const packet = { schemaVersion: 1, workspaceId: wid,
    case: { id: item.data.id, title: item.data.title, source: item.data.source, reason: item.data.reason, orderRef: item.data.orderRef, amount: item.data.amount, currency: item.data.currency, dataRevision: item.data.dataRevision },
    response: { revision, content: draft.data.content, method: draft.data.method, approvedAt: draft.data.approvedAt, approvedBy: draft.data.approvedBy, analysis: draft.data.analysis || null },
    evidence: records.map(record => record.data),
    limitations: ['This is an approved response and evidence snapshot, not a Stripe submission.', 'Original file bytes remain private S3 objects. The packet identifies their immutable object keys.'],
  };
  const bytes = Buffer.from(JSON.stringify(packet, null, 2));
  if (bytes.length > 1024 * 1024) throw new ApiError(413, 'The evidence packet exceeds the 1 MB archive limit.');
  const guards = [{ key: item.key, expectedVersion: item.version, check: true }, { key: draft.key, expectedVersion: draft.version, check: true }] satisfies StoreChange[];
  await commit(wid, guards);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `archives/${wid}/${caseId}/revision-${revision}/${sha256}.json`;
  const { bucket, client } = storage();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/json', ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256, revision: String(revision) } }), { abortSignal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (!(error && typeof error === 'object' && '$metadata' in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)) throw new ApiError(502, 'The private S3 archive could not be confirmed. Retry the archive.', 'archive_failed');
  } finally { client.destroy(); }
  // A concurrent edit must never be reported as an archive of the currently approved revision.
  await commit(wid, [...guards, auditChange(user, 'evidence.archived', `Archived approved response revision ${revision} to private S3 (${sha256}).`, caseId)]);
  return { archived: true, key, sha256 };
}
