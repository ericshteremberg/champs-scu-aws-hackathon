import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config.js';
import { EvidenceProvider, normalizeEvidence } from '../server/evidence.js';
import type { CaseRecord } from '../shared/types.js';

const timestamp = '2026-11-07T18:00:00Z';
const caseId = 'approved_case';

function wire(section = 'delivery') {
  return {
    case_id: caseId, section, source_mode: 'live', fetched_at: timestamp,
    status: 'partial',
    records: [{
      evidence_id: `${caseId}:email`, source: 'Mail provider', source_id: 'message_123', occurred_at: timestamp,
      data: { title: 'Message accepted', detail: 'Accepted for processing; delivery is unknown.', fields: { orderRef: 'ORDER-123', paymentRef: 'payment_123', delivered: null } },
    }],
    limitations: ['Delivery events are unavailable.'],
  };
}

function importedCase(): CaseRecord {
  return {
    id: caseId, merchantId: 'merchant_approved', merchantName: 'Example merchant', customerLabel: 'Customer reference 123',
    claim: 'The ticket did not arrive.', reason: 'Ticket not received', amount: 5000, currency: 'USD', eventName: 'Example event',
    purchasedAt: '2026-11-01T18:00:00Z', openedAt: '2026-11-06T18:00:00Z', dueAt: '2026-11-14T18:00:00Z',
    sourceMode: 'live', status: 'needs_review', summary: 'A payment needs evidence review.', orderRef: 'ORDER-123', paymentRef: 'payment_123', tags: [],
  };
}

function provider() {
  return new EvidenceProvider(loadConfig({ MERCHANT_EVIDENCE_URL: 'https://evidence.example.test', MERCHANT_EVIDENCE_TOKEN: 'test-only-credential' }));
}

function stubJson(value: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('merchant evidence validation', () => {
  it('preserves source provenance and uncertainty while normalizing the wire shape', () => {
    const result = normalizeEvidence(wire(), caseId, 'delivery');
    expect(result).toMatchObject({ caseId, section: 'delivery', sourceMode: 'live', status: 'partial', limitations: ['Delivery events are unavailable.'] });
    expect(result.records[0]).toMatchObject({ id: `${caseId}:email`, sourceId: 'message_123', occurredAt: timestamp, fields: { delivered: null } });
    expect(result.records[0]).not.toHaveProperty('data');
  });

  it.each([
    ['a different case', { case_id: 'another_case' }],
    ['a different section', { section: 'support' }],
  ])('rejects %s even if every returned record is well formed', (_name, change) => {
    expect(() => normalizeEvidence({ ...wire(), ...change }, caseId, 'delivery')).toThrow(expect.objectContaining({ code: 'EVIDENCE_SCOPE_MISMATCH' }));
  });

  it('rejects duplicate evidence IDs that could make citations ambiguous', () => {
    const value = wire();
    value.records.push({ ...value.records[0], source_id: 'a_different_message' });
    expect(() => normalizeEvidence(value, caseId, 'delivery')).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
  });

  it('does not allow unavailable sections to smuggle records into the investigation', () => {
    expect(() => normalizeEvidence({ ...wire(), status: 'unavailable' }, caseId, 'delivery')).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
    const result = normalizeEvidence({ ...wire(), status: 'unavailable', records: [] }, caseId, 'delivery');
    expect(result.records).toEqual([]);
    expect(result.limitations).toEqual(['Delivery events are unavailable.']);
  });

  it.each([
    ['unlabeled fixture data', { ...wire(), source_mode: 'synthetic' }],
    ['an invalid timestamp', { ...wire(), fetched_at: 'yesterday' }],
    ['nested arbitrary fields', { ...wire(), records: [{ ...wire().records[0], data: { ...wire().records[0].data, fields: { databaseDump: { customer: 'unrelated' } } } }] }],
    ['an unbounded number of records', { ...wire(), records: Array.from({ length: 101 }, (_, index) => ({ ...wire().records[0], evidence_id: `id_${index}` })) }],
  ])('rejects %s from a live connector', (_name, value) => {
    expect(() => normalizeEvidence(value, caseId, 'delivery')).toThrow(expect.objectContaining({ code: 'INVALID_EVIDENCE' }));
  });
});

describe('live case import and scoped reads', () => {
  it('imports only corroborated metadata and ignores a merchant-supplied review state', async () => {
    const fetchMock = stubJson({ ...wire('summary'), mapping_verified: true, case: { ...importedCase(), status: 'reviewed', latestRunId: 'untrusted_run' } });
    const result = await provider().importCase(caseId, new AbortController().signal);
    expect(result.status).toBe('needs_review');
    expect(result).not.toHaveProperty('latestRunId');
    expect(fetchMock).toHaveBeenCalledWith(`https://evidence.example.test/v1/cases/${caseId}/evidence?section=summary`, expect.objectContaining({ redirect: 'error' }));
  });

  it.each([
    ['missing attestation', { case: importedCase() }],
    ['false attestation', { mapping_verified: false, case: importedCase() }],
    ['another case in metadata', { mapping_verified: true, case: { ...importedCase(), id: 'different_case' } }],
    ['non-live metadata', { mapping_verified: true, case: { ...importedCase(), sourceMode: 'synthetic' } }],
  ])('rejects %s without importing a case', async (_name, additions) => {
    stubJson({ ...wire('summary'), ...additions });
    await expect(provider().importCase(caseId, new AbortController().signal)).rejects.toMatchObject({ code: 'UNVERIFIED_CASE' });
  });

  it('requires both the payment and order reference to agree with source evidence', async () => {
    stubJson({ ...wire('summary'), mapping_verified: true, case: { ...importedCase(), paymentRef: 'unrelated_payment' } });
    await expect(provider().importCase(caseId, new AbortController().signal)).rejects.toMatchObject({ code: 'MAPPING_MISMATCH' });
  });

  it('rejects a changed mapping when a previously imported case is read', async () => {
    const value = wire('summary');
    value.records[0].data.fields.orderRef = 'OTHER-ORDER';
    stubJson({ ...value, mapping_verified: true, case: importedCase() });
    await expect(provider().read(importedCase(), 'summary', new AbortController().signal)).rejects.toMatchObject({ code: 'MAPPING_MISMATCH' });
  });

  it('rechecks merchant identity on the summary of an imported case', async () => {
    stubJson({ ...wire('summary'), mapping_verified: true, case: { ...importedCase(), merchantId: 'different_merchant' } });
    await expect(provider().read(importedCase(), 'summary', new AbortController().signal)).rejects.toMatchObject({ code: 'MAPPING_MISMATCH' });
  });

  it('fails closed on a revoked merchant grant and does not expose the upstream body', async () => {
    const fetchMock = vi.fn(async () => new Response('private customer detail from upstream', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider().read(importedCase(), 'delivery', new AbortController().signal)).rejects.toMatchObject({ code: 'MERCHANT_ACCESS_DENIED', status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not issue a request after the run signal has been revoked', async () => {
    const fetchMock = stubJson(wire());
    const controller = new AbortController();
    controller.abort();
    await expect(provider().read(importedCase(), 'delivery', controller.signal)).rejects.toMatchObject({ code: 'RUN_INACTIVE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds the response body before JSON processing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })));
    await expect(provider().read(importedCase(), 'delivery', new AbortController().signal)).rejects.toMatchObject({ code: 'EVIDENCE_TOO_LARGE' });
  });

  it('rejects a path-shaped case identifier before contacting the merchant', async () => {
    const fetchMock = stubJson(wire('summary'));
    await expect(provider().importCase('../other-case', new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_CASE_ID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
