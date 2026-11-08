import type { DisputeCase, Evidence } from '../domain.ts';

export type Exhibit = { evidenceId: string; bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'application/pdf'; sha256: string; fetchedAt: string; original?: { bytes: Uint8Array; sha256: string; mimeType: string }; renderedEmail?: boolean };
export const isVisualEvidence = (record: Evidence) => Boolean(record.downloadUrl && (['image/png', 'image/jpeg', 'application/pdf'].includes(record.mimeType ?? '') || record.originalEmail?.provider === 'resend'));
export const visualEvidence = (item: DisputeCase) => item.evidence.filter(isVisualEvidence);
export const FILE_LIMIT = 10 * 1024 * 1024;
export const PACKET_FILE_LIMIT = 40 * 1024 * 1024;
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function visualMime(bytes: Uint8Array): Exhibit['mimeType'] | undefined {
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
}

/** Fetch only case-authorized file endpoints. S3 redirects retain their short-lived authorization. */
export async function loadVisualExhibits(item: DisputeCase, request: typeof fetch = fetch): Promise<Exhibit[]> {
  const records = visualEvidence(item);
  if (records.length > 20) throw new Error('This PDF supports up to 20 original visual files. Narrow the case evidence first.');
  let total = 0;
  const exhibits: Exhibit[] = [];
  for (const record of records) {
    if (record.downloadUrl !== `/api/evidence/${encodeURIComponent(record.id)}`) throw new Error('An original file has an invalid case download link. Refresh the case.');
    const response = await request(record.downloadUrl, { credentials: 'same-origin', signal: AbortSignal.timeout(30000), cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`The original file for "${record.title}" could not be retrieved. No PDF was created. Retry or inspect the original.`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; total += part.value.length;
        if (size > FILE_LIMIT || total > PACKET_FILE_LIMIT) throw new Error('Original files exceed the PDF download limit (10 MB per file, 40 MB total).');
        chunks.push(part.value);
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const originalHash = await hashBytes(bytes);
    if (record.fileSha256 && record.fileSha256 !== originalHash) throw new Error(`The original file for "${record.title}" differs from its saved fingerprint. No PDF was created.`);
    if (record.originalEmail) {
      if (!record.fileSha256 || record.mimeType !== 'application/json') throw new Error('This email snapshot has no verified source fingerprint. Collect its original again.');
      const { renderOriginalEmail } = await import('./email-renderer');
      const png = await renderOriginalEmail(bytes, record);
      exhibits.push({ evidenceId: record.id, bytes: png, mimeType: 'image/png', sha256: await hashBytes(png), fetchedAt: new Date().toISOString(), original: { bytes, sha256: originalHash, mimeType: 'application/json' }, renderedEmail: true });
      continue;
    }
    const mimeType = visualMime(bytes);
    if (!mimeType || mimeType !== record.mimeType) throw new Error(`The original file for "${record.title}" has an unexpected format.`);
    const sha256 = await hashBytes(bytes);
    if (record.fileSha256 && record.fileSha256 !== sha256) throw new Error(`The original file for "${record.title}" differs from its saved fingerprint. No PDF was created.`);
    exhibits.push({ evidenceId: record.id, bytes, mimeType, sha256, fetchedAt: new Date().toISOString() });
  }
  return exhibits;
}
