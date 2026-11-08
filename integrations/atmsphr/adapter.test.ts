import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEvidenceHandler, sections, type Repository } from './adapter.ts';
import { fictionalCase, fictionalGrant, fixtureNow } from './fixtures.ts';
import { fetchMerchantSection, normalizeMerchantSection } from '../../lib/investigation/merchant.ts';
type TestEnvelope = { case_id: string; section: string; status: string; records: { evidence_id: string; occurred_at: string; data: { detail: string; fields: Record<string, unknown> } }[]; privateDatabaseInternal?: string };
const token = 'fictional_test_only_not_a_real_credential_123';
function setup() {
  const grant = fictionalGrant(); const data = fictionalCase();
  const repo: Repository = { findGrant: vi.fn(async () => grant), readCase: vi.fn(async () => data) };
  const handle = createEvidenceHandler(repo, () => new Date(fixtureNow));
  const request = (section = 'summary', caseId = grant.caseId, authorization = `Bearer ${token}`) =>
    handle(new Request(`https://merchant.example/v1/cases/${caseId}/evidence?section=${section}`, { headers: { authorization } }));
  return { grant, data, repo, handle, request };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('merchant adapter', () => {
  it.each(sections)('returns consumer-compatible %s', async section => {
    const s = setup(); const response = await s.request(section);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const raw = await response.json(); expect(normalizeMerchantSection(raw, s.grant.caseId, section)).toBeDefined();
    expect(s.repo.readCase).toHaveBeenCalledWith(s.grant, expect.any(AbortSignal));
    const digest = vi.mocked(s.repo.findGrant).mock.calls[0][0];
    expect(digest).toMatch(/^[a-f0-9]{64}$/); expect(digest).not.toBe(token);
  });
  it.each(['', 'Basic abc', 'Bearer short'])('denies malformed authorization', async header => {
    const s = setup(); expect((await s.request('summary', s.grant.caseId, header)).status).toBe(401);
    expect(s.repo.readCase).not.toHaveBeenCalled();
  });
  it('denies unknown credentials', async () => {
    const s = setup(); vi.mocked(s.repo.findGrant).mockResolvedValue(null);
    expect((await s.request()).status).toBe(401); expect(s.repo.readCase).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'expired', 'invalid-expiry', 'other-case'])('denies %s before any data read', async mode => {
    const s = setup();
    if (mode === 'revoked') s.grant.revoked = true;
    if (mode === 'expired') s.grant.expiresAt = fixtureNow;
    if (mode === 'invalid-expiry') s.grant.expiresAt = 'bad';
    expect((await s.request('summary', mode === 'other-case' ? 'another_customer' : s.grant.caseId)).status).toBe(403);
    expect(s.repo.readCase).not.toHaveBeenCalled();
  });
  it.each(['merchant', 'order', 'payment', 'account', 'mode', 'unverified'])('denies changed %s mapping', async mode => {
    const s = setup();
    if (mode === 'merchant') s.data.metadata.merchantId = 'other';
    if (mode === 'order') s.data.metadata.orderRef = 'other';
    if (mode === 'payment') s.data.metadata.paymentRef = 'other';
    if (mode === 'account') s.data.stripeAccountId = 'other';
    if (mode === 'mode') s.data.livemode = true;
    if (mode === 'unverified') s.data.mappingVerified = false;
    expect((await s.request()).status).toBe(403);
  });
  it('returns 404 for unavailable approved case', async () => {
    const s = setup(); vi.mocked(s.repo.readCase).mockResolvedValue(null); expect((await s.request()).status).toBe(404);
  });
  it.each(['unknown', 'summary&section=order', 'summary&other=1'])('rejects invalid query %s', async query => {
    const s = setup(); expect((await s.request(query)).status).toBe(400); expect(s.repo.readCase).not.toHaveBeenCalled();
  });
  it.each(['wrong-case', 'wrong-section', 'duplicate', 'bad-date', 'missing-mapping', 'oversize', 'nested', 'too-many', 'contradiction'])('rejects %s evidence', async mode => {
    const s = setup(); const raw = s.data.sections.summary as TestEnvelope;
    if (mode === 'wrong-case') raw.case_id = 'other';
    if (mode === 'wrong-section') raw.section = 'order';
    if (mode === 'duplicate') (s.data.sections.order as TestEnvelope).records[0].evidence_id = raw.records[0].evidence_id;
    if (mode === 'bad-date') raw.records[0].occurred_at = 'yesterday';
    if (mode === 'missing-mapping') delete raw.records[0].data.fields.paymentRef;
    if (mode === 'oversize') raw.records[0].data.detail = 'x'.repeat(1024 * 1024 + 1);
    if (mode === 'nested') raw.records[0].data.fields.secret = { nested: true };
    if (mode === 'too-many') raw.records = Array.from({ length: 91 }, (_, i) => ({ ...raw.records[0], evidence_id: `fictional_${i}` }));
    if (mode === 'contradiction') raw.status = 'unavailable';
    expect((await s.request()).status).toBe(502);
  });
  it('strips unknown database internals from responses', async () => {
    const s = setup(); (s.data.sections.order as TestEnvelope).privateDatabaseInternal = 'excluded';
    expect(await (await s.request('order')).text()).not.toContain('privateDatabaseInternal');
  });
  it('rechecks revocation after reading', async () => {
    const s = setup(); vi.mocked(s.repo.readCase).mockImplementation(async () => { s.grant.revoked = true; return s.data; });
    expect((await s.request()).status).toBe(403);
  });
  it('bounds the request even if storage ignores cancellation', async () => {
    vi.useFakeTimers(); const s = setup(); vi.mocked(s.repo.readCase).mockImplementation(() => new Promise(() => {}));
    const pending = s.request(); await vi.advanceTimersByTimeAsync(14000);
    expect((await pending).status).toBe(504);
  });
  it('does not expose repository errors', async () => {
    const s = setup(); vi.mocked(s.repo.readCase).mockRejectedValue(new Error('private database detail'));
    const response = await s.request(); expect(response.status).toBe(502); expect(await response.text()).not.toContain('private');
  });
  it('works through the existing HTTP consumer', async () => {
    const s = setup(); vi.stubGlobal('fetch', async (url: string, init: RequestInit) => s.handle(new Request(url, init)));
    expect((await fetchMerchantSection({ baseUrl: 'https://merchant.example', token }, s.grant.caseId, 'summary', new AbortController().signal)).mappingVerified).toBe(true);
  });
  it('consumer rejects redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { expect(init.redirect).toBe('error'); throw new TypeError('redirect'); }));
    await expect(fetchMerchantSection({ baseUrl: 'https://merchant.example', token }, 'fictional_case_123', 'summary', new AbortController().signal)).rejects.toThrow();
  });
});
