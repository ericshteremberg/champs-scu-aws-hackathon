import { z } from 'zod';
import { InvestigationError, type EvidenceEnvelope, type EvidenceSection } from './types.ts';

const date = z.string().datetime({ offset: true });
const scalar = z.union([z.string().max(6000), z.number().finite(), z.boolean(), z.null()]);
const record = z.object({
  evidence_id: z.string().min(1).max(240).regex(/^[^\[\]\r\n]+$/), source: z.string().min(1).max(160), source_id: z.string().min(1).max(240), occurred_at: date,
  data: z.object({ title: z.string().min(1).max(240), detail: z.string().max(24000), fields: z.record(z.string().max(100), scalar).refine(fields => Object.keys(fields).length <= 60, 'Too many evidence fields') }),
});
const wire = z.object({ case_id: z.string().min(1).max(200), section: z.string().min(1), source_mode: z.literal('live'), fetched_at: date, status: z.enum(['available', 'partial', 'unavailable']), records: z.array(record).max(100), limitations: z.array(z.string().max(3000)).max(30) });
export const merchantCaseSchema = z.object({
  id: z.string().min(1).max(200), merchantId: z.string().min(1).max(200), merchantName: z.string().min(1).max(200), customerLabel: z.string().min(1).max(200),
  claim: z.string().min(1).max(6000), reason: z.string().min(1).max(200), amount: z.number().int().min(0).max(1000000000), currency: z.string().regex(/^[a-zA-Z]{3}$/),
  eventName: z.string().min(1).max(240), purchasedAt: date, openedAt: date, dueAt: date, sourceMode: z.literal('live'), summary: z.string().max(6000),
  orderRef: z.string().min(1).max(200), paymentRef: z.string().min(1).max(200), tags: z.array(z.string().max(80)).max(12).default([]),
});
export type MerchantCase = z.infer<typeof merchantCaseSchema>;
export interface MerchantConfiguration { baseUrl: string; token: string; allowLocalHttp?: boolean }
export interface MerchantSection { evidence: EvidenceEnvelope; case?: MerchantCase; mappingVerified: boolean }

export function normalizeMerchantSection(raw: unknown, caseId: string, section: EvidenceSection): MerchantSection {
  const parsed = wire.safeParse(raw);
  if (!parsed.success) throw new InvestigationError('invalid_evidence', 'The merchant returned evidence that does not match the API contract.');
  const value = parsed.data;
  if (value.case_id !== caseId || value.section !== section) throw new InvestigationError('evidence_scope_mismatch', 'The merchant returned evidence for a different case or section.');
  if (new Set(value.records.map(item => item.evidence_id)).size !== value.records.length || (value.status === 'unavailable' && value.records.length)) throw new InvestigationError('invalid_evidence', 'The merchant returned duplicate or contradictory evidence records.');
  const evidence: EvidenceEnvelope = { caseId, section, sourceMode: 'live', fetchedAt: value.fetched_at, status: value.status, limitations: value.limitations, records: value.records.map(item => ({ id: item.evidence_id, source: item.source, sourceId: item.source_id, occurredAt: item.occurred_at, title: item.data.title, detail: item.data.detail, fields: item.data.fields })) };
  if (section !== 'summary') return { evidence, mappingVerified: false };
  const metadata = z.object({ mapping_verified: z.literal(true), case: merchantCaseSchema }).safeParse(raw);
  if (!metadata.success || metadata.data.case.id !== caseId) throw new InvestigationError('unverified_case', 'The merchant summary must include verified case metadata.');
  const item = metadata.data.case;
  if (!evidence.records.some(entry => entry.fields.orderRef === item.orderRef && entry.fields.paymentRef === item.paymentRef)) throw new InvestigationError('mapping_mismatch', 'The summary evidence does not corroborate the case payment and order.');
  return { evidence, case: item, mappingVerified: true };
}

export async function fetchMerchantSection(config: MerchantConfiguration, externalCaseId: string, section: EvidenceSection, signal: AbortSignal): Promise<MerchantSection> {
  if (signal.aborted) throw new InvestigationError('stopped', 'The investigation was stopped.');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(externalCaseId)) throw new InvestigationError('invalid_case_id', 'The merchant case identifier is invalid.');
  let base: URL;
  try { base = new URL(config.baseUrl); } catch { throw new InvestigationError('merchant_configuration', 'Configure a valid merchant evidence base URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (!config.token || base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(config.allowLocalHttp && local && base.protocol === 'http:'))) throw new InvestigationError('merchant_configuration', 'The merchant API needs an HTTPS base URL and server-side credential.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${base.toString().replace(/\/+$/, '')}/v1/cases/${encodeURIComponent(externalCaseId)}/evidence?section=${section}`, { headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new InvestigationError('merchant_access_denied', 'The merchant denied access to this approved case.');
      if (response.status === 404) throw new InvestigationError('merchant_not_found', 'The merchant case or evidence section was not found.');
      throw new InvestigationError('merchant_unavailable', 'The merchant evidence API returned an error.');
    }
    if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new InvestigationError('invalid_evidence', 'The merchant evidence API must return JSON.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new InvestigationError('invalid_evidence', 'The merchant returned no evidence response.');
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 1024 * 1024) { await reader.cancel(); throw new InvestigationError('evidence_too_large', 'The merchant response exceeds the 1 MB limit.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (signal.aborted || controller.signal.aborted) throw new InvestigationError('stopped', 'The evidence request was stopped or timed out.');
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new InvestigationError('invalid_evidence', 'The merchant returned invalid JSON.'); }
    return normalizeMerchantSection(raw, externalCaseId, section);
  } catch (error) {
    if (error instanceof InvestigationError) throw error;
    if (signal.aborted) throw new InvestigationError('stopped', 'The investigation was stopped.');
    throw new InvestigationError('merchant_unavailable', 'The merchant evidence API could not be reached. Check its connection and case grant.');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
