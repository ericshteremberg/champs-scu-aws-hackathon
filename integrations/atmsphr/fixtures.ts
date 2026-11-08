/** Entirely fictional contract examples. NEVER serve these as production/live source data. */
import { sections, type VerifiedCase, type Grant } from './adapter.ts';
export const fixtureNow = '2026-11-07T18:00:00Z';
export function fictionalCase(): VerifiedCase {
  const metadata = {
    id: 'fictional_case_123', merchantId: 'fictional_organizer', merchantName: 'Fictional organizer',
    customerLabel: 'Fictional customer 123', claim: 'Ticket not received', reason: 'Ticket delivery',
    amount: 5000, currency: 'USD', eventName: 'Fictional concert', purchasedAt: '2026-11-04T18:00:00Z',
    openedAt: '2026-11-06T18:00:00Z', dueAt: '2026-11-14T18:00:00Z', sourceMode: 'live' as const,
    summary: 'Fictional contract test only.', orderRef: 'fictional_order_123', paymentRef: 'fictional_payment_123', tags: [],
  };
  const data = Object.fromEntries(sections.map(section => [section, {
    case_id: metadata.id, section, source_mode: 'live', fetched_at: fixtureNow,
    status: section === 'summary' || section === 'order' || section === 'tickets' ? 'available' : section === 'delivery' ? 'partial' : 'unavailable',
    records: ['summary', 'order', 'tickets', 'delivery'].includes(section) ? [{
      evidence_id: `${metadata.id}:${section}:1`, source: 'Fictional contract fixture', source_id: `fictional_${section}_1`,
      occurred_at: metadata.purchasedAt,
      data: { title: `Fictional ${section}`, detail: section === 'delivery' ? 'Provider accepted; delivery and reading unknown.' : 'Fictional contract test only.',
        fields: { orderRef: metadata.orderRef, paymentRef: metadata.paymentRef, ...(section === 'delivery' ? { providerStatus: 'accepted', delivered: null, read: null } : {}) } },
    }] : [],
    limitations: ['Fictional contract test only.', ...(['summary', 'order', 'tickets'].includes(section) ? [] : ['This source is incomplete or unavailable.'])],
    ...(section === 'summary' ? { mapping_verified: true, case: metadata } : {}),
  }])) as VerifiedCase['sections'];
  return { metadata, stripeAccountId: 'fictional_account', livemode: false, mappingVerified: true, sections: data };
}
export function fictionalGrant(): Grant {
  return { caseId: 'fictional_case_123', merchantId: 'fictional_organizer', orderRef: 'fictional_order_123',
    paymentRef: 'fictional_payment_123', stripeAccountId: 'fictional_account', livemode: false,
    expiresAt: '2026-11-08T18:00:00Z', revoked: false };
}
