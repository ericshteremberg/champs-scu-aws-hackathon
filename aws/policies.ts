import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import type { Policy } from '../lib/domain.ts';
import { validateUpload } from '../lib/server/uploads.ts';
import { storage, readUploadedBytes } from './files.ts';
import { fetchPolicyUrl, policyText } from './policy-source.ts';
import { commit, getItem, keys, queryItems } from './store.ts';
import { ApiError, type StoreChange, type TrustedUser } from './types.ts';
import { auditChange, now, requireWorkspace } from './workspace.ts';

export type PolicyDoc = Policy & { fileKey?: string };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const policyMetadata = z.object({ name: z.string().trim().min(2).max(160), kind: z.enum(['terms', 'refund', 'cancellation']), effectiveDate: day, endsAt: day.optional(), versionLabel: z.string().trim().max(100).optional(), previousVersionId: z.string().min(1).max(200).optional() }).strict().refine(v => !v.endsAt || v.endsAt > v.effectiveDate, 'The end date must follow the effective date.');
type Metadata = z.infer<typeof policyMetadata>;
type Upload = { kind: 'policy'; metadata: Metadata; ownerId: string; size: number; tempKey: string; fileName: string; mimeType: string; expiresAt: string; ttlEpochSeconds: number; policyId?: string };
const saveSchema = z.object({ action: z.literal('save'), metadata: policyMetadata, sourceType: z.enum(['text','url']), text: z.string().min(10).max(24000).optional(), url: z.string().url().max(2048).optional() }).strict();
const uploadSchema = z.object({ action: z.literal('prepare-upload'), metadata: policyMetadata, fileName: z.string().min(1).max(180), mimeType: z.string().max(100), size: z.number().int().min(1).max(10 * 1024 * 1024) }).strict();
const finishSchema = z.object({ action: z.literal('finalize-upload'), uploadId: z.string().min(1).max(200) }).strict();
export function policyForClient(row: PolicyDoc): Policy {
  const { fileKey, ...value } = row;
  return { ...value, ...(fileKey ? { downloadUrl: `/api/policies/${encodeURIComponent(row.id)}` } : {}) };
}
async function saveVersion(user: TrustedUser, metadata: Metadata, sourceType: 'text'|'url'|'file', bytes: Uint8Array, mimeType: string, fileName: string, url?: string, pending?: { key: string; version: number; data: Upload }) {
  const wid = (await requireWorkspace(user)).data.id;
  if ((await queryItems<PolicyDoc>(wid, 'policy#', { maxItems: 101 })).length >= 100) throw new ApiError(409, 'The policy library supports up to 100 dated versions.');
  const previous = metadata.previousVersionId ? await getItem<PolicyDoc>(wid, keys.policy(metadata.previousVersionId)) : null;
  if (metadata.previousVersionId && !previous) throw new ApiError(404, 'The previous policy version is not in this workspace.');
  if (previous && previous.data.kind && previous.data.kind !== metadata.kind) throw new ApiError(400, 'Keep the same policy type when adding a version.');
  const familyId = previous?.data.familyId || previous?.data.id || createHash('sha256').update(`${metadata.kind}:${metadata.name.toLowerCase()}`).digest('hex').slice(0, 32);
  const familyKey = `policy-family#${familyId}`, head = await getItem<{ version: number }>(wid, familyKey);
  const version = (head?.data.version || previous?.data.version || 0) + 1;
  const id = `policy_${randomUUID()}`, capturedAt = now();
  const extracted = await policyText(bytes, mimeType).catch(error => { if (error instanceof ApiError) throw error; throw new ApiError(422, 'The policy could not be read. Use a readable PDF or UTF-8 text document.', 'policy_unreadable'); });
  let retained = bytes, retainedMime = mimeType, retainedName = fileName;
  if (sourceType !== 'file' && mimeType !== 'application/pdf') {
    retained = Buffer.from(JSON.stringify({ schemaVersion: 1, provider: 'policy-library', policyId: id, sourceType, sourceUrl: url, capturedAt, effectiveDate: metadata.effectiveDate, text: extracted.text, original: new TextDecoder('utf-8', { fatal: true }).decode(bytes), originalMimeType: mimeType }));
    retainedMime = 'application/json'; retainedName = 'policy-capture.json';
  }
  const sha256 = createHash('sha256').update(retained).digest('hex'); const fileKey = `policies/${wid}/${id}/${sha256}`;
  const data: PolicyDoc = { id, familyId, version, name: metadata.name, kind: metadata.kind, content: extracted.text, effectiveDate: metadata.effectiveDate, createdAt: capturedAt, capturedAt, sourceType, fileKey, fileName: retainedName.replace(/[\\/\x00-\x1f]/g, '_'), mimeType: retainedMime, fileSha256: sha256, ...(url ? { sourceUrl: url } : {}), ...(metadata.versionLabel ? { versionLabel: metadata.versionLabel } : {}), ...(metadata.endsAt ? { endsAt: metadata.endsAt } : {}), ...(extracted.notice ? { extractionNotice: extracted.notice } : {}) };
  const { bucket, client } = storage();
  try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: fileKey, Body: retained, ContentType: retainedMime, ServerSideEncryption: 'AES256', IfNoneMatch: '*', Metadata: { sha256 } }), { abortSignal: AbortSignal.timeout(15000) }); } finally { client.destroy(); }
  const changes: StoreChange[] = [{ key: keys.policy(id), expectedVersion: null, data }, { key: familyKey, expectedVersion: head?.version ?? null, data: { version } }, auditChange(user, 'policy.version_saved', `Saved ${metadata.kind} policy version ${version}; effective date is merchant-declared, not proof of checkout acceptance.`)];
  if (previous) changes.push({ key: previous.key, expectedVersion: previous.version, check: true });
  if (pending) changes.push({ key: pending.key, expectedVersion: pending.version, data: { ...pending.data, policyId: id } });
  await commit(wid, changes);
  return policyForClient(data);
}
export async function policyAction(user: TrustedUser, input: unknown) {
  const wid = (await requireWorkspace(user)).data.id;
  const save = saveSchema.safeParse(input);
  if (save.success) {
    const s = save.data;
    if (s.sourceType === 'text') { if (!s.text) throw new ApiError(400, 'Paste the policy text.'); return { policy: await saveVersion(user, s.metadata, 'text', Buffer.from(s.text), 'text/plain', 'policy.txt') }; }
    if (!s.url) throw new ApiError(400, 'Enter a public policy URL.');
    const source = await fetchPolicyUrl(s.url);
    return { policy: await saveVersion(user, s.metadata, 'url', source.bytes, source.mimeType, source.mimeType === 'application/pdf' ? 'policy.pdf' : 'policy.html', source.url) };
  }
  const upload = uploadSchema.safeParse(input);
  if (upload.success) {
    const s = upload.data; if (!/\.(pdf|txt)$/i.test(s.fileName)) throw new ApiError(400, 'Upload a PDF or UTF-8 text policy.');
    const id = `policy_upload_${randomUUID()}`, tempKey = `pending/${wid}/${id}`, { bucket, client } = storage();
    try {
      const signed = await createPresignedPost(client, { Bucket: bucket, Key: tempKey, Expires: 600, Fields: { 'Content-Type': s.mimeType || 'application/octet-stream', 'x-amz-server-side-encryption': 'AES256' }, Conditions: [['content-length-range', s.size, s.size], ['eq', '$Content-Type', s.mimeType || 'application/octet-stream'], ['eq', '$x-amz-server-side-encryption', 'AES256']] });
      await commit(wid, [{ key: keys.upload(id), expectedVersion: null, data: { kind: 'policy', metadata: s.metadata, ownerId: user.userId, tempKey, fileName: s.fileName, mimeType: s.mimeType, size: s.size, expiresAt: new Date(Date.now()+3600000).toISOString(), ttlEpochSeconds: Math.floor(Date.now()/1000)+86400 } satisfies Upload }]);
      return { uploadId: id, uploadUrl: signed.url, fields: signed.fields, method: 'POST' };
    } finally { client.destroy(); }
  }
  const finish = finishSchema.safeParse(input);
  if (finish.success) {
    const pending = await getItem<Upload>(wid, keys.upload(finish.data.uploadId));
    if (!pending || pending.data.kind !== 'policy' || pending.data.ownerId !== user.userId) throw new ApiError(404, 'Policy upload not found.');
    if (pending.data.policyId) { const policy = await getItem<PolicyDoc>(wid, keys.policy(pending.data.policyId)); if (!policy) throw new ApiError(404, 'This saved policy was removed.'); return { policy: policyForClient(policy.data) }; }
    if (pending.data.expiresAt <= now()) throw new ApiError(410, 'Upload expired. Choose the file again.');
    const { bucket, client } = storage();
    try {
      const bytes = await readUploadedBytes(client, bucket, pending.data);
      const checked = validateUpload(pending.data.fileName, pending.data.mimeType, bytes);
      if (!['application/pdf','text/plain'].includes(checked.mimeType)) throw new ApiError(400, 'Upload a PDF or text policy.');
      const policy = await saveVersion(user, pending.data.metadata, 'file', bytes, checked.mimeType, checked.fileName, undefined, pending);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: pending.data.tempKey })).catch(() => undefined);
      return { policy };
    } finally { client.destroy(); }
  }
  throw new ApiError(400, 'Choose a valid policy source and dated version.', 'invalid_policy');
}
export async function policyDownload(user: TrustedUser, id: string) {
  const wid = (await requireWorkspace(user)).data.id, row = await getItem<PolicyDoc>(wid, keys.policy(id));
  if (!row?.data.fileKey) throw new ApiError(404, 'Policy original not found.');
  const { bucket, client } = storage();
  try { return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: row.data.fileKey, ResponseContentDisposition: 'attachment', ResponseContentType: row.data.mimeType }), { expiresIn: 60 }); } finally { client.destroy(); }
}
