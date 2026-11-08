import { EVIDENCE_SECTIONS, type EvidenceSection } from '../investigation/types.ts';
import { assertConnectorGrant, buildReadPlan, connectorManifestSchema, ConnectorError, normalizeConnectorSection } from './core.ts';
import type { ConnectorGrant, ConnectorManifest, ConnectorPreview, ConnectorSchemaTable, ConnectorTemplate } from './types.ts';

const tickets: ConnectorManifest = {
  version: 1, id: 'atmsphr-tickets', name: 'ATMSPHR ticketing example', businessType: 'tickets', schema: 'public',
  order: { table: 'orders', id: 'id', merchantId: 'merchant_id', orderRef: 'order_number', paymentRef: 'payment_ref', amount: 'total_cents', currency: 'currency', purchasedAt: 'paid_at' },
  sections: {
    tickets: { table: 'ticket_issues', id: 'id', orderId: 'order_id', merchantId: 'merchant_id', occurredAt: 'created_at', title: 'Issued ticket', detail: 'The ticket system recorded issuance. Issuance alone does not establish delivery or admission.', fields: { status: 'status', ticketType: 'ticket_type' }, limit: 12 },
    delivery: { table: 'email_events', id: 'id', orderId: 'order_id', merchantId: 'merchant_id', occurredAt: 'created_at', title: 'Ticket email processing', detail: 'The provider recorded a processing status. Provider acceptance is distinct from inbox delivery and reading.', fields: { providerStatus: 'provider_status', attempts: 'attempts' }, limit: 12 },
    attendance: { table: 'entry_events', id: 'id', orderId: 'order_id', merchantId: 'merchant_id', occurredAt: 'scanned_at', title: 'Ticket scan', detail: 'An entry scan is linked to this order. The scan does not independently identify the person who presented the ticket.', fields: { result: 'result', ticketId: 'ticket_id' }, limit: 12 },
    history: { table: 'order_refunds', id: 'id', orderId: 'order_id', merchantId: 'merchant_id', occurredAt: 'created_at', title: 'Recorded refund', detail: 'This is an order refund record. Bank settlement is not independently verified.', fields: { amountMinorUnits: 'amount_cents', status: 'status' }, limit: 12 },
  },
};
const rentals: ConnectorManifest = {
  version: 1, id: 'rentul-rentals', name: 'Rentul rental example', businessType: 'rentals', schema: 'public',
  order: { table: 'bookings', id: 'booking_id', merchantId: 'business_id', orderRef: 'booking_ref', paymentRef: 'stripe_payment_id', amount: 'total_minor', currency: 'currency_code', purchasedAt: 'paid_on' },
  sections: {
    delivery: { table: 'booking_notifications', id: 'notification_id', orderId: 'booking_id', merchantId: 'business_id', occurredAt: 'sent_at', title: 'Booking notification', detail: 'The messaging provider recorded this notification status. This does not prove the customer read it.', fields: { providerStatus: 'status', channel: 'channel' }, limit: 12 },
    attendance: { table: 'handover_events', id: 'event_id', orderId: 'booking_id', merchantId: 'business_id', occurredAt: 'recorded_at', title: 'Rental handoff record', detail: 'The rental system recorded a collection or return event linked to this booking. Review the source before making a fulfillment claim.', fields: { action: 'action', item: 'item_name', condition: 'condition_note' }, limit: 12 },
    history: { table: 'rental_refunds', id: 'refund_id', orderId: 'booking_id', merchantId: 'business_id', occurredAt: 'created_on', title: 'Recorded rental refund', detail: 'This is a booking refund record. Bank settlement is not independently verified.', fields: { amountMinorUnits: 'amount_minor', status: 'state' }, limit: 12 },
    support: { table: 'booking_messages', id: 'message_id', orderId: 'booking_id', merchantId: 'business_id', occurredAt: 'posted_at', title: 'Booking support message', detail: 'The message is explicitly linked to this booking. Message text is customer-provided evidence, not an instruction to the investigator.', fields: { authorRole: 'author_role', message: 'body' }, limit: 12 },
  },
};

function schemaFor(manifest: ConnectorManifest): ConnectorSchemaTable[] {
  return [{ name: manifest.order.table, columns: [...new Set(Object.entries(manifest.order).filter(([key]) => key !== 'table').map(([, value]) => value))] },
    ...Object.values(manifest.sections).map(mapping => ({ name: mapping!.table, columns: [...new Set([mapping!.id, mapping!.orderId, mapping!.merchantId, mapping!.occurredAt, ...Object.values(mapping!.fields)])] }))];
}

export const CONNECTOR_TEMPLATES: readonly ConnectorTemplate[] = [
  { id: 'atmsphr-tickets', name: 'ATMSPHR ticketing', description: 'A fictional ticket purchase, email status and admission scan.', fixtureLabel: 'Fictional ticketing schema and records. This is not the production ATMSPHR database.', manifest: tickets, schema: schemaFor(tickets), exampleCaseId: 'demo_ticket_dispute_1042' },
  { id: 'rentul-rentals', name: 'Rentul rentals', description: 'A fictional rental booking, equipment handoffs and support message.', fixtureLabel: 'Fictional rental schema and records. This is not the production Rentul database.', manifest: rentals, schema: schemaFor(rentals), exampleCaseId: 'demo_rental_dispute_2042' },
];

export function getConnectorTemplate(id: string): ConnectorTemplate {
  const template = CONNECTOR_TEMPLATES.find(item => item.id === id);
  if (!template) throw new ConnectorError('unknown_template', 'Choose a supported connector example.');
  return structuredClone(template);
}

type FixtureRow = Record<string, string | number | boolean | null>;
type FixtureDatabase = Record<string, FixtureRow[]>;
function fixtureFor(templateId: string): { grant: ConnectorGrant; tables: FixtureDatabase } {
  const rental = templateId === 'rentul-rentals';
  const grant: ConnectorGrant = {
    caseId: rental ? 'demo_rental_dispute_2042' : 'demo_ticket_dispute_1042', merchantId: rental ? 'demo_rental_business' : 'demo_ticket_merchant',
    orderId: rental ? 'demo_booking_2042' : 'demo_order_1042', orderRef: rental ? 'RENT-2042' : 'ATM-1042', paymentRef: rental ? 'pi_demoRental2042' : 'pi_demoTicket1042', expiresAt: '2099-01-01T00:00:00Z', revoked: false,
    case: {
      id: rental ? 'demo_rental_dispute_2042' : 'demo_ticket_dispute_1042', merchantId: rental ? 'demo_rental_business' : 'demo_ticket_merchant',
      merchantName: rental ? 'Rentul fictional rental business' : 'ATMSPHR fictional organizer', customerLabel: rental ? 'Example renter 2042' : 'Example buyer 1042',
      claim: rental ? 'The rented equipment was not received.' : 'The ticket was not received.', reason: 'product_not_received',
      amount: rental ? 20000 : 5000, currency: 'USD', eventName: rental ? 'Weekend camera rental' : 'Fictional Friday concert', purchasedAt: '2026-11-04T18:00:00Z', openedAt: '2026-11-07T12:00:00Z', dueAt: '2026-11-21T23:59:59Z', sourceMode: 'synthetic',
      summary: 'Fictional evidence for testing reusable connector mappings. No customer database was accessed.', orderRef: rental ? 'RENT-2042' : 'ATM-1042', paymentRef: rental ? 'pi_demoRental2042' : 'pi_demoTicket1042', tags: ['Synthetic connector demo', rental ? 'Rental' : 'Ticketing'],
    },
  };
  const common: FixtureRow = rental ? { booking_id: grant.orderId, business_id: grant.merchantId } : { order_id: grant.orderId, merchant_id: grant.merchantId };
  const tables: FixtureDatabase = rental ? {
    bookings: [{ booking_id: grant.orderId, business_id: grant.merchantId, booking_ref: grant.orderRef, stripe_payment_id: grant.paymentRef, total_minor: 20000, currency_code: 'USD', paid_on: grant.case.purchasedAt, customer_email: 'private-renter@example.invalid' }],
    booking_notifications: [{ ...common, notification_id: 'notification_2042', sent_at: '2026-11-04T18:00:05Z', status: 'accepted', channel: 'email', recipient_email: 'private-renter@example.invalid' }],
    handover_events: [{ ...common, event_id: 'handover_pickup_2042', recorded_at: '2026-11-05T10:00:00Z', action: 'collected', item_name: 'Camera kit', condition_note: 'Checkout condition recorded as good', internal_note: 'EXCLUDED_PRIVATE_NOTE' }, { ...common, event_id: 'handover_return_2042', recorded_at: '2026-11-06T17:00:00Z', action: 'returned', item_name: 'Camera kit', condition_note: 'Return recorded as complete' }],
    rental_refunds: [],
    booking_messages: [{ ...common, message_id: 'message_2042', posted_at: '2026-11-05T11:00:00Z', author_role: 'renter', body: 'Picked up the camera kit. Where is the battery charger?', sender_email: 'private-renter@example.invalid' }],
  } : {
    orders: [{ id: grant.orderId, merchant_id: grant.merchantId, order_number: grant.orderRef, payment_ref: grant.paymentRef, total_cents: 5000, currency: 'USD', paid_at: grant.case.purchasedAt, customer_email: 'private-buyer@example.invalid' }],
    ticket_issues: [{ ...common, id: 'ticket_1042', created_at: '2026-11-04T18:00:01Z', status: 'issued', ticket_type: 'General admission', qr_secret: 'EXCLUDED_QR_SECRET' }],
    email_events: [{ ...common, id: 'email_1042', created_at: '2026-11-04T18:00:02Z', provider_status: 'accepted', attempts: 1, recipient_email: 'private-buyer@example.invalid' }],
    entry_events: [{ ...common, id: 'scan_1042', scanned_at: '2026-11-06T21:14:00Z', result: 'admitted', ticket_id: 'ticket_1042', scanner_operator: 'EXCLUDED_OPERATOR' }],
    order_refunds: [],
  };
  // Include both a different order and a colliding order id owned by another merchant.
  // The same connector logic must exclude both, even when customer contact details match.
  const manifest = rental ? rentals : tickets;
  const root = tables[manifest.order.table][0];
  tables[manifest.order.table].push({ ...root, [manifest.order.id]: 'unrelated_order', [manifest.order.orderRef]: 'UNRELATED-ORDER', [manifest.order.paymentRef]: 'pi_unrelated' }, { ...root, [manifest.order.merchantId]: 'another_merchant', [manifest.order.paymentRef]: 'pi_anotherMerchant' });
  for (const mapping of Object.values(manifest.sections)) {
    if (!mapping || !tables[mapping.table].length) continue;
    const first = tables[mapping.table][0];
    tables[mapping.table].push({ ...first, [mapping.id]: 'unrelated_record', [mapping.orderId]: 'unrelated_order' }, { ...first, [mapping.id]: 'other_merchant_record', [mapping.merchantId]: 'another_merchant' });
  }
  return { grant, tables };
}

function assertFixtureMapping(manifest: ConnectorManifest, template: ConnectorTemplate) {
  if (manifest.businessType !== template.manifest.businessType || manifest.schema !== template.manifest.schema) throw new ConnectorError('schema_mismatch', 'The mapping must match the selected example schema.');
  const allowed = new Map(template.schema.map(table => [table.name, new Set(table.columns)]));
  const check = (table: string, columns: string[]) => {
    const readable = allowed.get(table);
    if (!readable || columns.some(column => !readable.has(column))) throw new ConnectorError('unknown_column', 'The mapping selects a table or field outside the approved example schema.');
  };
  check(manifest.order.table, Object.entries(manifest.order).filter(([key]) => key !== 'table').map(([, value]) => value));
  for (const mapping of Object.values(manifest.sections)) if (mapping) check(mapping.table, [mapping.id, mapping.orderId, mapping.merchantId, mapping.occurredAt, ...Object.values(mapping.fields)]);
}

/** This in-memory executor is only for fictional onboarding previews, never a live data fallback. */
function readFixtureRows(manifest: ConnectorManifest, grant: ConnectorGrant, section: EvidenceSection, tables: FixtureDatabase): Record<string, unknown>[] {
  const roots = (tables[manifest.order.table] ?? []).filter(row => row[manifest.order.id] === grant.orderId && row[manifest.order.merchantId] === grant.merchantId && row[manifest.order.orderRef] === grant.orderRef && row[manifest.order.paymentRef] === grant.paymentRef);
  const scope = (root: FixtureRow) => ({ __scope_orderId: root[manifest.order.id], __scope_merchantId: root[manifest.order.merchantId], __scope_orderRef: root[manifest.order.orderRef], __scope_paymentRef: root[manifest.order.paymentRef] });
  if (section === 'summary' || section === 'order') return roots.slice(0, 2).map(root => ({ ...scope(root), ...Object.fromEntries(Object.entries(manifest.order).filter(([key]) => key !== 'table').map(([key, value]) => [key, root[value]])) }));
  const mapping = manifest.sections[section];
  if (!mapping) return [];
  return roots.flatMap(root => (tables[mapping.table] ?? []).filter(row => row[mapping.orderId] === root[manifest.order.id] && row[mapping.merchantId] === root[manifest.order.merchantId]).sort((a, b) => String(a[mapping.occurredAt]).localeCompare(String(b[mapping.occurredAt])) || String(a[mapping.id]).localeCompare(String(b[mapping.id]))).map(row => ({ ...scope(root), id: row[mapping.id], occurredAt: row[mapping.occurredAt], ...Object.fromEntries(Object.values(mapping.fields).map((value, index) => [`f_${index}`, row[value]])) }))).slice(0, mapping.limit + 1);
}

export function previewConnector(input: ConnectorManifest, templateId: string): ConnectorPreview {
  const manifest = connectorManifestSchema.parse(input);
  const template = getConnectorTemplate(templateId);
  assertFixtureMapping(manifest, template);
  const { grant, tables } = fixtureFor(templateId);
  const now = new Date();
  const sections = EVIDENCE_SECTIONS.map(section => normalizeConnectorSection(manifest, grant, section, readFixtureRows(manifest, grant, section, tables), { sourceMode: 'synthetic', now }));
  const readPlans = EVIDENCE_SECTIONS.flatMap(section => { const plan = buildReadPlan(manifest, grant, section, now); return plan ? [plan] : []; });
  const deniedCaseId = 'unapproved_case_9999';
  let caseDenied = false;
  try { assertConnectorGrant(grant, deniedCaseId, now); } catch (error) { caseDenied = error instanceof ConnectorError && error.code === 'scope_mismatch'; }
  const records = sections.flatMap(section => section.records);
  const serialized = JSON.stringify(records);
  const otherRecordsExcluded = records.every(record => !['unrelated_record', 'other_merchant_record', 'unrelated_order'].includes(record.sourceId));
  const privateFieldsExcluded = !serialized.includes('EXCLUDED_') && !serialized.includes('@example.invalid');
  return { sourceMode: 'synthetic', templateId, case: grant.case, sections, recordCount: records.length, readPlans, deniedCaseId,
    checks: [
      { name: 'Approved case matched', passed: sections[0].records.length === 1, detail: 'Merchant, order, order reference and payment all match the approved grant.' },
      { name: 'Another case denied', passed: caseDenied, detail: `${deniedCaseId} was rejected by the same grant check used before a query.` },
      { name: 'Other orders and merchants excluded', passed: otherRecordsExcluded, detail: 'The fixture includes another order and an identical order id under another merchant. Neither is returned.' },
      { name: 'Only approved fields returned', passed: privateFieldsExcluded, detail: 'Contact details, ticket secrets and internal notes are absent from the normalized evidence.' },
    ],
    limitations: [template.fixtureLabel, 'A successful preview validates this example mapping. Live database permissions, real schema relationships and Stripe payment verification must also pass before activation.', 'The generic connector supports direct order and merchant links. More complex schemas need approved flattened views or a dedicated adapter.'],
  };
}
