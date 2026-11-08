import { afterEach, describe, expect, it, vi } from 'vitest';
import { stripeVerifier } from './stripe.ts';
import type { CaseGrant } from './grants.ts';
const grant = { stripePlatform: 'atmsphr', livemode: false, stripeAccountId: 'acct_fictional', disputeId: 'du_fictional', paymentRef: 'pi_fictional' } as CaseGrant;
function setup() {
  const dispute = { id: 'du_fictional', charge: 'ch_fictional', amount: 5000, currency: 'usd', livemode: false, reason: 'product_not_received', created: 1794000000, evidence_details: { due_by: 1795000000 } };
  const charge = { id: 'ch_fictional', payment_intent: 'pi_fictional', amount: 5000, currency: 'usd', livemode: false, paid: true };
  const request = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => { void _init; return Response.json(String(url).includes('/disputes/') ? dispute : charge); }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>;
  return { dispute, charge, request, verify: stripeVerifier({ atmsphr: 'rk_test_fictional_only' }, request) };
}
afterEach(() => vi.restoreAllMocks());
describe('read-only Stripe corroboration', () => {
  it('reads the dispute and charge under the approved account context', async () => {
    const s = setup(); const result = await s.verify(grant, new AbortController().signal);
    expect(result.paymentRef).toBe(grant.paymentRef); expect(result.accountId).toBe(grant.stripeAccountId);
    expect(s.request).toHaveBeenCalledTimes(2);
    for (const [url, init] of s.request.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api.stripe.com\/v1\/(disputes|charges)\//);
      expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error'); expect(init?.headers).toMatchObject({ 'Stripe-Account': grant.stripeAccountId });
    }
  });
  it.each(['payment', 'mode', 'unpaid', 'amount', 'currency', 'charge', 'deadline'])('rejects %s mismatch', async mode => {
    const s = setup();
    if (mode === 'payment') s.charge.payment_intent = 'pi_other';
    if (mode === 'mode') s.charge.livemode = true;
    if (mode === 'unpaid') s.charge.paid = false;
    if (mode === 'amount') s.dispute.amount = 6000;
    if (mode === 'currency') s.charge.currency = 'eur';
    if (mode === 'charge') s.charge.id = 'ch_other';
    if (mode === 'deadline') s.dispute.evidence_details.due_by = 0;
    await expect(s.verify(grant, new AbortController().signal)).rejects.toThrow();
  });
  it('fails closed on unavailable credentials or mode configuration', async () => {
    const s = setup(); await expect(s.verify({ ...grant, livemode: true }, new AbortController().signal)).rejects.toThrow(); expect(s.request).not.toHaveBeenCalled();
  });
  it('does not expose provider error bodies', async () => {
    const s = setup(); s.request.mockResolvedValue(new Response('private upstream information', { status: 403 }));
    await expect(s.verify(grant, new AbortController().signal)).rejects.toThrow('Stripe read failed');
  });
  it('rejects oversized upstream responses', async () => {
    const s = setup(); s.request.mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
    await expect(s.verify(grant, new AbortController().signal)).rejects.toThrow('too large');
  });
});
