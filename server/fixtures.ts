import { EVIDENCE_SECTIONS, type CaseRecord, type EvidenceEnvelope, type EvidenceRecord, type EvidenceSection } from '../shared/types.js';

/** Entirely fictional cases. These records must never be represented as ATMSPHR customer data. */
export const demoCases: CaseRecord[] = [
  {
    id: 'case_atm_1042', merchantId: 'merchant_atmsphr_demo', merchantName: 'ATMSPHR',
    customerLabel: 'Sample customer 1042', claim: 'I paid for two tickets but never received them.',
    reason: 'Ticket not received', amount: 9200, currency: 'USD', eventName: 'After Hours: Fall Session',
    purchasedAt: '2026-11-02T18:03:00Z', openedAt: '2026-11-06T20:15:00Z', dueAt: '2026-11-14T07:59:00Z',
    sourceMode: 'synthetic', status: 'needs_review',
    summary: 'Two tickets, a delivery trail, and a customer support conversation to connect.',
    orderRef: 'ATM-1042', paymentRef: 'pi_demo_atm_1042', tags: ['Ticket delivery', 'Support available'],
  },
  {
    id: 'case_atm_1043', merchantId: 'merchant_atmsphr_demo', merchantName: 'ATMSPHR',
    customerLabel: 'Sample customer 1043', claim: 'The ticket email never arrived. I contacted support before the event.',
    reason: 'Ticket not received', amount: 7500, currency: 'USD', eventName: 'Warehouse Sessions',
    purchasedAt: '2026-11-04T02:24:00Z', openedAt: '2026-11-06T18:42:00Z', dueAt: '2026-11-11T07:59:00Z',
    sourceMode: 'synthetic', status: 'needs_review',
    summary: 'A paid order with failed delivery attempts and an unresolved support request.',
    orderRef: 'ATM-1043', paymentRef: 'pi_demo_atm_1043', tags: ['Ticket delivery', 'Delivery errors'],
  },
  {
    id: 'case_atm_1044', merchantId: 'merchant_atmsphr_demo', merchantName: 'ATMSPHR',
    customerLabel: 'Sample customer 1044', claim: 'I was charged, but I cannot find any tickets or confirmation.',
    reason: 'Ticket not received', amount: 11800, currency: 'USD', eventName: 'The Late Set',
    purchasedAt: '2026-11-01T21:11:00Z', openedAt: '2026-11-05T16:10:00Z', dueAt: '2026-11-09T07:59:00Z',
    sourceMode: 'synthetic', status: 'needs_review',
    summary: 'Payment and ticket issuance are recorded; the delivery history is incomplete.',
    orderRef: 'ATM-1044', paymentRef: 'pi_demo_atm_1044', tags: ['Ticket delivery', 'Evidence gaps'],
  },
];

function record(id: string, source: string, sourceId: string, occurredAt: string, title: string, detail: string, fields: EvidenceRecord['fields']): EvidenceRecord {
  return { id, source, sourceId, occurredAt, title, detail, fields };
}

type SectionData = Pick<EvidenceEnvelope, 'status' | 'records' | 'limitations'>;
const available = (records: EvidenceRecord[], limitations: string[] = []): SectionData => ({ status: limitations.length ? 'partial' : 'available', records, limitations });
const unavailable = (limitation: string): SectionData => ({ status: 'unavailable', records: [], limitations: [limitation] });

const commonSections = (item: CaseRecord): Partial<Record<EvidenceSection, SectionData>> => ({
  summary: available([
    record(`${item.id}:payment`, 'Stripe test fixture', item.paymentRef, item.purchasedAt,
      'Payment captured', `A fictional ${item.currency.toUpperCase()} ${(item.amount / 100).toFixed(2)} payment maps to order ${item.orderRef}.`,
      { chargeCaptured: true, refundAmount: 0, disputeStatus: 'needs_response', orderRef: item.orderRef, paymentRef: item.paymentRef, amount: item.amount, currency: item.currency, stripeAccount: 'acct_demo_atmsphr', liveMode: false }),
    record(`${item.id}:dispute`, 'Stripe test fixture', `dp_demo_${item.orderRef.toLowerCase()}`, item.openedAt,
      'Dispute requires a response', item.claim,
      { disputeStatus: 'needs_response', reason: 'product_not_received', evidenceDueAt: item.dueAt, amount: item.amount, currency: item.currency }),
  ]),
  attendance: unavailable('No case-linked scan records are available in this fixture. Scanning coverage is unknown; this does not establish nonattendance.'),
  policy: unavailable('An immutable purchase-time policy and acceptance record are not available. Current terms cannot establish what this customer saw.'),
});

const cases: Record<string, Record<EvidenceSection, SectionData>> = {
  case_atm_1042: {
    ...commonSections(demoCases[0]),
    order: available([
      record('case_atm_1042:order', 'ATMSPHR order fixture', 'order_demo_1042', '2026-11-02T18:03:00Z',
        'Order confirmed for two tickets', 'Order ATM-1042 contains two general-admission tickets to After Hours: Fall Session.',
        { orderRef: 'ATM-1042', paymentRef: 'pi_demo_atm_1042', quantity: 2, subtotal: 8000, fees: 1200, total: 9200, currency: 'USD', status: 'paid', eventStartsAt: '2026-11-07T05:00:00Z', eventTimezone: 'America/Los_Angeles' }),
    ]),
    tickets: available([
      record('case_atm_1042:ticket-1', 'ATMSPHR ticket fixture', 'ticket_demo_1042_a', '2026-11-02T18:03:04Z',
        'First ticket issued', 'A ticket was created and linked to order ATM-1042. Issuance alone does not establish delivery.',
        { orderRef: 'ATM-1042', ticketStatus: 'issued', transferredFrom: null, transferredTo: null, scanRecorded: false }),
      record('case_atm_1042:ticket-2', 'ATMSPHR ticket fixture', 'ticket_demo_1042_b', '2026-11-02T18:03:04Z',
        'Second ticket issued', 'A second ticket was created for the same order.',
        { orderRef: 'ATM-1042', ticketStatus: 'issued', transferredFrom: null, transferredTo: null, scanRecorded: false }),
    ]),
    delivery: available([
      record('case_atm_1042:email', 'Resend delivery fixture', 'email_demo_1042', '2026-11-02T18:03:12Z',
        'Confirmation email accepted', 'The email provider accepted the confirmation for processing. Inbox delivery and reading are not recorded.',
        { channel: 'email', providerStatus: 'accepted', delivered: null, read: null, errorCode: null, orderRef: 'ATM-1042' }),
      record('case_atm_1042:sms', 'Twilio delivery fixture', 'sms_demo_1042', '2026-11-02T18:04:02Z',
        'Ticket-link SMS marked delivered', 'The SMS provider returned delivered for the order-linked message. Reading is not established.',
        { channel: 'sms', providerStatus: 'delivered', delivered: true, read: null, errorCode: null, orderRef: 'ATM-1042' }),
    ], ['Email acceptance does not prove inbox delivery. An SMS delivery status does not prove the message was read.']),
    history: available([
      record('case_atm_1042:recovery', 'ATMSPHR recovery fixture', 'recovery_demo_1042', '2026-11-02T18:10:41Z',
        'Ticket recovery completed', 'An order-linked recovery flow completed. This records account access, not physical event attendance.',
        { orderRef: 'ATM-1042', recoveryCompleted: true, recoveredTicketCount: 2 }),
    ]),
    support: available([
      record('case_atm_1042:support-1', 'Matched support export fixture', 'thread_demo_1042:message_1', '2026-11-02T18:08:10Z',
        'Customer asked for help finding tickets', 'Fictional customer message: "My payment went through, but I cannot see the tickets for order ATM-1042."',
        { orderRef: 'ATM-1042', messageRole: 'customer', customerAcknowledgedReceipt: false, threadMatch: 'explicit_order_reference' }),
      record('case_atm_1042:support-2', 'Matched support export fixture', 'thread_demo_1042:message_2', '2026-11-02T18:09:20Z',
        'Organizer explained ticket recovery', 'Fictional organizer message: "Please open the ticket recovery link for order ATM-1042 and sign in with the purchase address."',
        { orderRef: 'ATM-1042', messageRole: 'organizer', customerAcknowledgedReceipt: false, threadMatch: 'explicit_order_reference' }),
      record('case_atm_1042:support-3', 'Matched support export fixture', 'thread_demo_1042:message_3', '2026-11-02T18:12:18Z',
        'Customer acknowledged finding both tickets', 'Fictional customer message: "Found both tickets in my account for ATM-1042. Thank you."',
        { orderRef: 'ATM-1042', messageRole: 'customer', customerAcknowledgedReceipt: true, threadMatch: 'explicit_order_reference' }),
    ], ['This is a fictional conversation for the demo. Acknowledged access does not establish attendance or determine a bank decision.']),
  } as Record<EvidenceSection, SectionData>,
  case_atm_1043: {
    ...commonSections(demoCases[1]),
    order: available([
      record('case_atm_1043:order', 'ATMSPHR order fixture', 'order_demo_1043', '2026-11-04T02:24:00Z',
        'Paid order for one ticket', 'Order ATM-1043 contains one general-admission ticket to Warehouse Sessions.',
        { orderRef: 'ATM-1043', paymentRef: 'pi_demo_atm_1043', quantity: 1, subtotal: 7000, fees: 500, total: 7500, currency: 'USD', status: 'paid', eventStartsAt: '2026-11-06T05:00:00Z', eventTimezone: 'America/Los_Angeles' }),
    ]),
    tickets: available([
      record('case_atm_1043:ticket', 'ATMSPHR ticket fixture', 'ticket_demo_1043', '2026-11-04T02:24:05Z',
        'Ticket issued in the application', 'The ticket exists in the order record. The application has no recorded customer acknowledgement of access.',
        { orderRef: 'ATM-1043', ticketStatus: 'issued', transferredFrom: null, transferredTo: null, scanRecorded: false }),
    ]),
    delivery: available([
      record('case_atm_1043:email', 'Resend delivery fixture', 'email_demo_1043', '2026-11-04T02:24:35Z',
        'Confirmation email bounced', 'The email delivery attempt returned a permanent mailbox error.',
        { channel: 'email', providerStatus: 'bounced', delivered: false, read: null, errorCode: 'mailbox_unavailable', orderRef: 'ATM-1043' }),
      record('case_atm_1043:sms', 'Twilio delivery fixture', 'sms_demo_1043', '2026-11-04T02:25:12Z',
        'Ticket-link SMS was undelivered', 'The SMS provider returned an undelivered result. No successful SMS attempt is present in the case records.',
        { channel: 'sms', providerStatus: 'undelivered', delivered: false, read: null, errorCode: '30003', orderRef: 'ATM-1043' }),
      record('case_atm_1043:retry', 'Resend delivery fixture', 'email_demo_1043_retry', '2026-11-04T12:05:18Z',
        'Resent email also bounced', 'A later resend to the same recipient returned another permanent failure.',
        { channel: 'email', providerStatus: 'bounced', delivered: false, read: null, errorCode: 'mailbox_unavailable', orderRef: 'ATM-1043' }),
    ], ['These records cover the listed delivery attempts. They do not prove that every possible delivery route failed.']),
    history: available([
      record('case_atm_1043:resend', 'ATMSPHR delivery history fixture', 'resend_demo_1043', '2026-11-04T12:05:00Z',
        'Organizer requested a resend', 'A resend was requested after the support complaint. Its provider outcome is recorded in delivery evidence.',
        { orderRef: 'ATM-1043', action: 'resend_requested', deliverySourceId: 'email_demo_1043_retry', recoveryCompleted: false }),
    ], ['No successful order-recovery record is available. Missing recovery history does not prove the customer never accessed the account.']),
    support: available([
      record('case_atm_1043:support-1', 'Matched support export fixture', 'thread_demo_1043:message_1', '2026-11-04T11:40:00Z',
        'Customer reported missing delivery before the event', 'Fictional customer message: "Order ATM-1043 was charged, but I have not received an email or text. Can you help before tomorrow?"',
        { orderRef: 'ATM-1043', messageRole: 'customer', customerAcknowledgedReceipt: false, threadMatch: 'explicit_order_reference' }),
      record('case_atm_1043:support-2', 'Matched support export fixture', 'thread_demo_1043:message_2', '2026-11-04T12:04:00Z',
        'Organizer promised another delivery attempt', 'Fictional organizer message: "I will resend the ticket confirmation for ATM-1043 now." No later receipt acknowledgement is in this export.',
        { orderRef: 'ATM-1043', messageRole: 'organizer', customerAcknowledgedReceipt: false, threadMatch: 'explicit_order_reference' }),
    ], ['The selected export contains two messages. Other conversations have not been verified.']),
  } as Record<EvidenceSection, SectionData>,
  case_atm_1044: {
    ...commonSections(demoCases[2]),
    order: available([
      record('case_atm_1044:order', 'ATMSPHR order fixture', 'order_demo_1044', '2026-11-01T21:11:00Z',
        'Paid order for two tickets', 'Order ATM-1044 is linked to the captured payment and two tickets to The Late Set.',
        { orderRef: 'ATM-1044', paymentRef: 'pi_demo_atm_1044', quantity: 2, subtotal: 10000, fees: 1800, total: 11800, currency: 'USD', status: 'paid', eventStartsAt: '2026-11-04T05:00:00Z', eventTimezone: 'America/Los_Angeles' }),
    ]),
    tickets: available([
      record('case_atm_1044:ticket-1', 'ATMSPHR ticket fixture', 'ticket_demo_1044_a', '2026-11-01T21:11:06Z',
        'First ticket issued', 'The application contains an issued ticket linked to the order.',
        { orderRef: 'ATM-1044', ticketStatus: 'issued', transferredFrom: null, transferredTo: null, scanRecorded: false }),
      record('case_atm_1044:ticket-2', 'ATMSPHR ticket fixture', 'ticket_demo_1044_b', '2026-11-01T21:11:06Z',
        'Second ticket issued', 'The application contains a second issued ticket. No receipt acknowledgement accompanies it.',
        { orderRef: 'ATM-1044', ticketStatus: 'issued', transferredFrom: null, transferredTo: null, scanRecorded: false }),
    ]),
    delivery: unavailable('Historical delivery records have not been recovered for this case. Neither delivery success nor failure can be established.'),
    history: unavailable('No complete resend or recovery history is available for the selected order.'),
    support: unavailable('No support conversation has been matched to this order. The complaint is available only in the dispute summary.'),
  } as Record<EvidenceSection, SectionData>,
};

export function getDemoEvidence(caseId: string, section: EvidenceSection): EvidenceEnvelope {
  const evidence = cases[caseId];
  if (!evidence) throw new Error('Case not found');
  if (!EVIDENCE_SECTIONS.includes(section)) throw new Error('Evidence section is not allowed');
  return structuredClone({ caseId, section, sourceMode: 'synthetic' as const, fetchedAt: new Date().toISOString(), ...evidence[section] });
}
