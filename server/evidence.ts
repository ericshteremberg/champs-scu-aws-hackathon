import { z } from 'zod';
import type { CaseRecord, EvidenceEnvelope, EvidenceSection } from '../shared/types.js';
import type { ServerConfig } from './config.js';
import { HttpError, assertActive } from './errors.js';
import { getDemoEvidence } from './fixtures.js';

const scalar = z.union([z.string().max(6000), z.number().finite(), z.boolean(), z.null()]);
const recordSchema = z.object({
  evidence_id: z.string().min(1).max(160), source: z.string().min(1).max(120), source_id: z.string().min(1).max(200),
  occurred_at: z.iso.datetime({ offset: true }),
  data: z.object({ title: z.string().min(1).max(240), detail: z.string().max(6000), fields: z.record(z.string().max(100), scalar).refine(value => Object.keys(value).length <= 60, 'Too many evidence fields') }),
});
const wireEnvelope = z.object({
  case_id: z.string().min(1).max(160), section: z.string().min(1), source_mode: z.literal('live'),
  fetched_at: z.iso.datetime({ offset: true }), status: z.enum(['available', 'partial', 'unavailable']),
  records: z.array(recordSchema).max(100), limitations: z.array(z.string().max(2000)).max(30),
});
const liveCase = z.object({
  id: z.string().min(1).max(160), merchantId: z.string().min(1).max(160), merchantName: z.string().min(1).max(200),
  customerLabel: z.string().min(1).max(200), claim: z.string().min(1).max(6000), reason: z.string().min(1).max(200),
  amount: z.number().int().min(0).max(1000000000), currency: z.string().regex(/^[A-Z]{3}$/), eventName: z.string().min(1).max(240),
  purchasedAt: z.iso.datetime({ offset: true }), openedAt: z.iso.datetime({ offset: true }), dueAt: z.iso.datetime({ offset: true }),
  sourceMode: z.literal('live'), summary: z.string().max(6000), orderRef: z.string().min(1).max(160), paymentRef: z.string().min(1).max(160),
  tags: z.array(z.string().max(60)).max(12).default([]),
});

export function normalizeEvidence(raw: unknown, caseId: string, section: EvidenceSection): EvidenceEnvelope {
  const parsed = wireEnvelope.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, 'The merchant returned evidence that does not match the API contract.', 'INVALID_EVIDENCE');
  const value = parsed.data;
  if (value.case_id !== caseId || value.section !== section) throw new HttpError(502, 'The merchant returned evidence for a different case or section.', 'EVIDENCE_SCOPE_MISMATCH');
  if (value.status === 'unavailable' && value.records.length > 0) throw new HttpError(502, 'Unavailable evidence must not contain records.', 'INVALID_EVIDENCE');
  const ids = new Set(value.records.map(record => record.evidence_id));
  if (ids.size !== value.records.length) throw new HttpError(502, 'The merchant returned duplicate evidence identifiers.', 'INVALID_EVIDENCE');
  return { caseId, section, sourceMode: 'live', fetchedAt: value.fetched_at, status: value.status,
    records: value.records.map(record => ({ id: record.evidence_id, source: record.source, sourceId: record.source_id, occurredAt: record.occurred_at, title: record.data.title, detail: record.data.detail, fields: record.data.fields })),
    limitations: value.limitations };
}

export class EvidenceProvider {
  constructor(private config: ServerConfig) {}
  private async remote(caseId: string, section: EvidenceSection, signal: AbortSignal): Promise<unknown> {
    assertActive(signal);
    if (!this.config.merchantUrl || !this.config.merchantToken) throw new HttpError(503, 'The merchant evidence connection is not configured.', 'MERCHANT_NOT_CONNECTED');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(caseId)) throw new HttpError(400, 'Case identifiers may contain letters, numbers, underscores, and hyphens.', 'INVALID_CASE_ID');
    const url = `${this.config.merchantUrl}/v1/cases/${encodeURIComponent(caseId)}/evidence?section=${section}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${this.config.merchantToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    } catch {
      assertActive(signal);
      throw new HttpError(502, 'The merchant evidence API could not be reached. Check its URL, availability, and authorization.', 'MERCHANT_UNAVAILABLE');
    }
    assertActive(signal);
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new HttpError(403, 'The merchant denied access to this case. Check the case grant or connection credential.', 'MERCHANT_ACCESS_DENIED');
      if (response.status === 404) throw new HttpError(404, 'The merchant did not find this approved case or evidence section.', 'MERCHANT_NOT_FOUND');
      throw new HttpError(502, 'The merchant evidence API returned an error.', 'MERCHANT_UNAVAILABLE');
    }
    if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new HttpError(502, 'The merchant must return JSON evidence.', 'INVALID_EVIDENCE'); }
    const reader = response.body?.getReader();
    if (!reader) throw new HttpError(502, 'The merchant returned an empty response.', 'INVALID_EVIDENCE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new HttpError(502, 'The merchant evidence response exceeds the 1 MB limit.', 'EVIDENCE_TOO_LARGE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    assertActive(signal);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(502, 'The merchant returned invalid JSON.', 'INVALID_EVIDENCE'); }
  }
  async importCase(caseId: string, signal: AbortSignal): Promise<CaseRecord> {
    const raw = await this.remote(caseId, 'summary', signal);
    const summary = normalizeEvidence(raw, caseId, 'summary');
    const metadata = z.object({ mapping_verified: z.literal(true), case: liveCase }).safeParse(raw);
    if (!metadata.success || metadata.data.case.id !== caseId) throw new HttpError(502, 'The summary must include verified case metadata and a payment-to-order mapping.', 'UNVERIFIED_CASE');
    const item = metadata.data.case;
    const payment = summary.records.find(record => record.fields.orderRef === item.orderRef && record.fields.paymentRef === item.paymentRef);
    if (!payment) throw new HttpError(502, 'The summary evidence must corroborate the case payment and order references.', 'MAPPING_MISMATCH');
    return { ...item, status: 'needs_review' };
  }
  async read(item: CaseRecord, section: EvidenceSection, signal: AbortSignal): Promise<EvidenceEnvelope> {
    assertActive(signal);
    if (item.sourceMode === 'synthetic') return structuredClone(getDemoEvidence(item.id, section));
    if (item.sourceMode !== 'live') throw new HttpError(400, 'This source mode is not configured for this case.', 'UNSUPPORTED_SOURCE');
    const raw = await this.remote(item.id, section, signal);
    const result = normalizeEvidence(raw, item.id, section);
    if (section === 'summary') {
      const metadata = z.object({ mapping_verified: z.literal(true), case: liveCase }).safeParse(raw);
      if (!metadata.success || metadata.data.case.id !== item.id || metadata.data.case.merchantId !== item.merchantId || metadata.data.case.orderRef !== item.orderRef || metadata.data.case.paymentRef !== item.paymentRef || !result.records.some(record => record.fields.orderRef === item.orderRef && record.fields.paymentRef === item.paymentRef)) throw new HttpError(502, 'The merchant, case, or payment-to-order mapping has changed. Reconfirm the case with the merchant.', 'MAPPING_MISMATCH');
    }
    return result;
  }
}
