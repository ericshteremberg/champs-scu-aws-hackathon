import { timingSafeEqual } from 'node:crypto';

// Disposable live-wire fixture. All evidence is fictional and no database,
// customer system, Stripe account, or downstream service is contacted.
const caseId = 'fixture_ticket_missing';
const occurredAt = '2026-11-06T18:00:00.000Z';
const orderRef = 'FICTIONAL-ORDER-001';
const paymentRef = 'pi_fictional_fixture_001';
const limitation = 'Fictional smoke-test data delivered over a real HTTPS connection. This is not a customer dispute.';
const sections = {
  summary: ['Approved fictional case', 'The fictional payment maps to the approved fictional order.', { mappingVerified: true }],
  order: ['Fictional ticket order', 'A fictional customer bought one general admission ticket for 50 USD.', { amount: 5000, currency: 'USD' }],
  tickets: ['Fictional ticket issued', 'One fictional ticket was issued for the approved order.', { ticketStatus: 'issued', ticketId: 'fictional_ticket_001' }],
  delivery: ['Fictional delivery accepted', 'The fictional email provider accepted a ticket email. This does not establish inbox receipt.', { deliveryStatus: 'accepted' }],
  history: ['Fictional recovery link opened', 'A fictional recovery link was opened after the ticket purchase.', { action: 'recovery_link_opened' }],
  support: ['Fictional customer request', 'The fictional customer said: I cannot find my ticket email.', { channel: 'fictional_support' }],
  attendance: ['Fictional scan absent', 'No fictional admission scan is available. This does not establish nonattendance.', { scanObserved: false }],
  policy: ['Fictional purchase policy', 'The fictional policy offered ticket recovery support. Acceptance at purchase has not been proven.', { acceptanceProven: false }],
};
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Fixture-Data': 'fictional-only' } });

const fixture = {
  async fetch(request, env) {
    if (!env.FIXTURE_TOKEN || request.method !== 'GET') return json({ error: 'Unavailable' }, 403);
    const expected = new TextEncoder().encode(`Bearer ${env.FIXTURE_TOKEN}`);
    const actual = new TextEncoder().encode(request.headers.get('Authorization') || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: 'Denied' }, 403);
    const url = new URL(request.url);
    if (url.pathname !== `/v1/cases/${caseId}/evidence`) return json({ error: 'Case denied' }, 403);
    const section = url.searchParams.get('section');
    if (!Object.hasOwn(sections, section || '')) return json({ error: 'Unknown section' }, 404);
    const [title, detail, fields] = sections[section];
    const response = {
      case_id: caseId, section, source_mode: 'live', fetched_at: new Date().toISOString(),
      status: 'partial', limitations: [limitation],
      records: [{ evidence_id: `fictional_${section}_001`, source: 'fictional_smoke_fixture', source_id: `fictional_${section}_001`, occurred_at: occurredAt,
        data: { title, detail: `FICTIONAL TEST RECORD: ${detail}`, fields: { ...fields, orderRef, paymentRef, fictional: true } } }],
    };
    if (section === 'summary') Object.assign(response, {
      mapping_verified: true,
      case: { id: caseId, merchantId: 'fictional_merchant_001', merchantName: 'Fictional Smoke Test Merchant', customerLabel: 'Fictional Customer',
        claim: 'Ticket not received. Fictional smoke-test dispute.', reason: 'product_not_received', amount: 5000, currency: 'USD',
        eventName: 'Fictional QA Event', purchasedAt: occurredAt, openedAt: '2026-11-07T18:00:00.000Z', dueAt: '2099-01-01T00:00:00.000Z',
        sourceMode: 'live', summary: limitation, orderRef, paymentRef, tags: ['fictional', 'smoke-test'] },
    });
    return json(response);
  },
};

export default fixture;
