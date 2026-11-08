import { describe, expect, it, vi } from 'vitest';
import { createEvidenceHandler, sections } from './adapter.ts';
import { postgresRepository, queries } from './repository.ts';
import type { CaseGrant } from './grants.ts';
import type { PaymentEvidence } from './stripe.ts';
import type { Pool } from 'pg';
import { normalizeMerchantSection } from '../../lib/investigation/merchant.ts';
const date = '2026-11-07T18:00:00Z';
const uid = '10000000-0000-4000-8000-000000000001';
const grant: CaseGrant = { caseId: 'fictional_case', merchantId: uid, orderId: uid, orderRef: 'FICT-123', paymentRef: 'pi_fictional',
  disputeId: 'du_fictional', stripeAccountId: 'acct_fictional', stripePlatform: 'atmsphr', livemode: false,
  expiresAt: '2026-11-08T18:00:00Z', revoked: false, customerLabel: 'Fictional customer', claim: 'Ticket not received' };
const payment: PaymentEvidence = { disputeId: grant.disputeId, chargeId: 'ch_fictional', paymentRef: grant.paymentRef, accountId: grant.stripeAccountId,
  livemode: false, paymentAmount: 5000, disputedAmount: 5000, currency: 'USD', reason: 'product_not_received', openedAt: date, dueAt: date };
function setup() {
  const rows: Record<string, Record<string, unknown>[]> = {
    order: [{ id: uid, order_number: grant.orderRef, event_id: uid, status: 'paid', total_cents: 5000, refunded_cents: 0,
      channel: 'app', terms_version: 'v1', age_ack: true, created_at: date, paid_at: date, payment_ref: grant.paymentRef,
      title: 'Fictional show', starts_at: date, ends_at: date, merchant_name: 'Fictional merchant' }],
    items: [{ id: uid, qty: 1, unit_price_cents: 5000, unit_fee_cents: 0, tier_id: uid }],
    tickets: [{ id: uid, status: 'issued', tier_id: uid, face_value_cents: 5000, created_at: date, scanned_at: null, transferred_from: null, transferred_to: null }],
    scans: [{ id: uid, ticket_id: uid, result: 'wrong_event', created_at: date }],
    email: [{ order_id: uid, state: 'accepted', attempts: 1, first_attempt_at: date, created_at: date }],
    refunds: [{ id: uid, amount_cents: 100, fee_withheld_cents: 0, created_at: date }],
  };
  const client = { query: vi.fn(async (sql: string, _values?: unknown[]) => {
    void _values; const key = Object.entries(queries).find(([, query]) => query === sql)?.[0]; return { rows: key ? rows[key] : [] };
  }), release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pick<Pool, 'connect'>;
  const verify = vi.fn(async () => ({ ...payment }));
  const repo = postgresRepository(pool, async () => ({ ...grant }), verify, () => new Date(date));
  return { rows, client, verify, repo };
}
describe('schema-backed merchant repository', () => {
  it('builds every section accepted by the actual consumer', async () => {
    const s = setup(); const result = await s.repo.readCase(grant, new AbortController().signal);
    expect(result?.mappingVerified).toBe(true);
    for (const section of sections) expect(normalizeMerchantSection(result?.sections[section], grant.caseId, section)).toBeDefined();
    expect(s.client.query).toHaveBeenCalledWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(s.client.query).toHaveBeenCalledWith('COMMIT'); expect(s.client.release).toHaveBeenCalledWith(false);
    for (const [sql, values] of s.client.query.mock.calls.filter(call => call[1])) {
      expect(values?.slice(0, 4)).toEqual([grant.orderId, grant.merchantId, grant.orderRef, grant.paymentRef]);
      expect(sql).toContain('e.organizer_id=$2'); expect(sql).not.toContain(grant.orderId);
    }
  });
  it('does not contact Stripe or fetch children when the bounded order is missing', async () => {
    const s = setup(); s.rows.order = [];
    expect(await s.repo.readCase(grant, new AbortController().signal)).toBeNull();
    expect(s.verify).not.toHaveBeenCalled(); expect(s.client.query.mock.calls.filter(c => c[1])).toHaveLength(1);
  });
  it('requires explicit approved case configuration', async () => {
    const s = setup(); await expect(s.repo.readCase({ ...grant, orderId: undefined } as unknown as CaseGrant, new AbortController().signal)).rejects.toThrow();
    expect(s.client.query).not.toHaveBeenCalled();
  });
  it.each(['accountId', 'paymentRef', 'livemode', 'paymentAmount', 'disputeId'] as const)('rejects changed Stripe %s', async field => {
    const s = setup(); const changed = { ...payment, [field]: field === 'livemode' ? true : field === 'paymentAmount' ? 12 : 'changed' };
    s.verify.mockResolvedValue(changed as PaymentEvidence);
    await expect(s.repo.readCase(grant, new AbortController().signal)).rejects.toThrow();
    expect(s.client.query).toHaveBeenCalledWith('ROLLBACK'); expect(s.client.release).toHaveBeenCalledWith(true);
  });
  it('returns honest unavailable sources', async () => {
    const s = setup(); s.rows.scans = []; s.rows.email = []; s.rows.tickets = []; s.rows.refunds = [];
    const result = await s.repo.readCase(grant, new AbortController().signal);
    for (const section of ['support', 'attendance', 'delivery', 'tickets', 'history'] as const) {
      const parsed = normalizeMerchantSection(result?.sections[section], grant.caseId, section);
      expect(parsed.evidence.status).toBe('unavailable'); expect(parsed.evidence.records).toEqual([]); expect(parsed.evidence.limitations.length).toBeGreaterThan(0);
    }
  });
  it('bounds all source sets below the 90-record aggregate cap', async () => {
    const s = setup();
    for (const [kind, count] of Object.entries({ items: 13, tickets: 26, scans: 21, refunds: 11 })) {
      s.rows[kind] = Array.from({ length: count }, (_, i) => ({ ...s.rows[kind][0], id: `${uid}_${i}` }));
    }
    const result = await s.repo.readCase(grant, new AbortController().signal); const ids: string[] = [];
    for (const section of sections) {
      const parsed = normalizeMerchantSection(result?.sections[section], grant.caseId, section);
      ids.push(...parsed.evidence.records.map(r => r.id));
    }
    expect(ids.length).toBeLessThanOrEqual(90); expect(new Set(ids).size).toBe(ids.length);
    expect(normalizeMerchantSection(result?.sections.tickets, grant.caseId, 'tickets').evidence.status).toBe('partial');
  });
  it('does not infer delivery, attendance, or refund settlement', async () => {
    const s = setup(); const result = await s.repo.readCase(grant, new AbortController().signal);
    const delivery = normalizeMerchantSection(result?.sections.delivery, grant.caseId, 'delivery').evidence;
    expect(delivery.records[0].fields.delivered).toBeNull(); expect(delivery.records[0].fields.read).toBeNull();
    expect(normalizeMerchantSection(result?.sections.attendance, grant.caseId, 'attendance').evidence.records[0].fields.result).toBe('wrong_event');
  });
  it('serves repository output through authorization and normalization', async () => {
    const s = setup(); const handle = createEvidenceHandler(s.repo, () => new Date(date));
    const response = await handle(new Request(`https://merchant.example/v1/cases/${grant.caseId}/evidence?section=summary`, { headers: { authorization: 'Bearer fictional_token_at_least_32_characters' } }));
    expect(response.status).toBe(200); expect(((await response.json()) as Record<string, unknown>).mapping_verified).toBe(true);
  });
  it('never serializes extra source fields', async () => {
    const s = setup(); s.rows.order[0].purchase_email_key = 'PRIVATE'; s.rows.tickets[0].qr_secret = 'PRIVATE';
    const result = await s.repo.readCase(grant, new AbortController().signal); expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('does not acquire a connection for an aborted request', async () => {
    const s = setup(); await expect(s.repo.readCase(grant, AbortSignal.abort())).rejects.toThrow(); expect(s.client.query).not.toHaveBeenCalled();
  });
});
