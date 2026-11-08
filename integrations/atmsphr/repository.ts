import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { grantSchema, type CaseGrant } from './grants.ts';
import type { Grant, Repository, VerifiedCase, Section } from './adapter.ts';
import type { PaymentVerifier } from './stripe.ts';

type Row = Record<string, unknown>;
const time = (value: unknown): string => z.string().datetime({ offset: true }).parse(value instanceof Date ? value.toISOString() : value);
const string = (value: unknown): string => z.string().min(1).parse(value);
const number = (value: unknown): number => z.number().int().nonnegative().safe().parse(value);
/** All child queries rejoin the approved order and merchant before selecting bounded rows. */
export const scope = `FROM public.orders o JOIN public.events e ON e.id=o.event_id
 WHERE o.id=$1::uuid AND e.organizer_id=$2::uuid AND o.order_number=$3 AND o.payment_ref=$4
 AND o.payment_provider='stripe'`;
export const queries = {
  order: `SELECT o.id,o.order_number,o.event_id,o.status,o.total_cents,o.refunded_cents,o.channel,o.terms_version,o.age_ack,
 o.created_at,o.paid_at,o.payment_ref,e.title,e.starts_at,e.ends_at,m.name AS merchant_name
 FROM public.orders o JOIN public.events e ON e.id=o.event_id JOIN public.organizers m ON m.id=e.organizer_id
 JOIN public.atmsphr_stripe_objects s ON s.id=o.payment_ref AND s.platform=$5
 WHERE o.id=$1::uuid AND e.organizer_id=$2::uuid AND o.order_number=$3 AND o.payment_ref=$4
 AND o.payment_provider='stripe' AND o.status IN ('paid','partially_refunded','refunded')
 AND NOT EXISTS (SELECT 1 FROM public.atmsphr_legacy_fee_orders l WHERE l.order_id=o.id)
 AND NOT EXISTS (SELECT 1 FROM public.atmsphr_member_redemptions r WHERE r.order_id=o.id)
 AND NOT EXISTS (SELECT 1 FROM public.atmsphr_membership_ticket_bundles b WHERE b.order_id=o.id) LIMIT 1`,
  items: `SELECT i.id,i.qty,i.unit_price_cents,i.unit_fee_cents,i.tier_id FROM public.order_items i
 WHERE i.order_id IN (SELECT o.id ${scope}) ORDER BY i.id LIMIT 13`,
  tickets: `SELECT t.id,t.status,t.tier_id,t.face_value_cents,t.created_at,t.scanned_at,t.transferred_from,t.transferred_to
 FROM public.tickets t WHERE t.order_id IN (SELECT o.id ${scope})
 AND t.event_id=(SELECT o.event_id ${scope}) ORDER BY t.id LIMIT 26`,
  scans: `SELECT s.id,s.ticket_id,s.result,s.created_at FROM public.scans s JOIN public.tickets t ON t.id=s.ticket_id
 WHERE t.order_id IN (SELECT o.id ${scope}) AND s.event_id=t.event_id
 AND t.event_id=(SELECT o.event_id ${scope}) ORDER BY s.created_at,s.id LIMIT 21`,
  email: `SELECT q.order_id,q.state,q.attempts,q.first_attempt_at,q.created_at FROM public.order_email_queue q
 WHERE q.order_id IN (SELECT o.id ${scope}) LIMIT 1`,
  refunds: `SELECT r.id,r.amount_cents,r.fee_withheld_cents,r.created_at FROM public.refunds r
 WHERE r.order_id IN (SELECT o.id ${scope}) ORDER BY r.created_at,r.id LIMIT 11`,
};
export function postgresRepository(pool: Pick<Pool, 'connect'>, findGrant: Repository['findGrant'], verify: PaymentVerifier,
  now: () => Date = () => new Date()): Repository {
  return { findGrant, async readCase(input: Readonly<Grant>, signal: AbortSignal): Promise<VerifiedCase | null> {
    const grant = grantSchema.parse(input); signal.throwIfAborted();
    const client = await pool.connect();
    let failed = false;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '4000ms'");
      const values = [grant.orderId, grant.merchantId, grant.orderRef, grant.paymentRef];
      const query = async (sql: string, args = values) => { signal.throwIfAborted(); const result = await client.query(sql, args); signal.throwIfAborted(); return result.rows as Row[]; };
      const rows = await query(queries.order, [...values, grant.stripePlatform]);
      if (!rows.length) { await client.query('ROLLBACK'); return null; }
      const order = rows[0];
      // Stripe confirms the actual account/mode/dispute/charge/payment relationship, not the host payout account.
      const payment = await verify(grant, signal);
      if (payment.paymentRef !== grant.paymentRef || payment.accountId !== grant.stripeAccountId || payment.livemode !== grant.livemode
        || payment.disputeId !== grant.disputeId || payment.paymentAmount !== number(order.total_cents)) throw new Error('Verified payment changed');
      const items = await query(queries.items); const tickets = await query(queries.tickets);
      const scans = await query(queries.scans); const email = await query(queries.email); const refunds = await query(queries.refunds);
      await client.query('COMMIT');
      return buildCase(grant, order, payment, { items, tickets, scans, email, refunds }, now());
    } catch (error) { failed = true; await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { (client as PoolClient).release(failed); }
  } };
}
function buildCase(grant: CaseGrant, order: Row, payment: Awaited<ReturnType<PaymentVerifier>>,
  rows: Record<'items' | 'tickets' | 'scans' | 'email' | 'refunds', Row[]>, fetched: Date): VerifiedCase {
  type Fields = Record<string, string | number | boolean | null>;
  const record = (section: Section, sourceId: string, at: unknown, title: string, detail: string, fields: Fields) => ({
    evidence_id: `${grant.caseId}:${section}:${createHash('sha256').update(sourceId).digest('hex').slice(0, 40)}`, source: section === 'summary' ? 'Stripe dispute and public.orders' : `ATMSPHR ${section}`,
    source_id: sourceId, occurred_at: time(at), data: { title, detail, fields: { orderRef: grant.orderRef, ...fields } },
  });
  const unavailable = (section: Section, limitation: string) => envelope(section, [], [limitation], 'unavailable');
  function envelope(section: Section, records: ReturnType<typeof record>[], limitations: string[] = [], status = limitations.length ? 'partial' : 'available') {
    return { case_id: grant.caseId, section, source_mode: 'live', fetched_at: fetched.toISOString(), records, limitations, status };
  }
  const metadata = { id: grant.caseId, merchantId: grant.merchantId, merchantName: string(order.merchant_name), customerLabel: grant.customerLabel,
    claim: grant.claim, reason: payment.reason, amount: payment.disputedAmount, currency: payment.currency,
    eventName: string(order.title), purchasedAt: time(order.paid_at ?? order.created_at), openedAt: payment.openedAt, dueAt: payment.dueAt,
    sourceMode: 'live' as const, summary: 'Approved ticket dispute with verified organizer, order, Stripe account, mode, charge and payment.',
    orderRef: grant.orderRef, paymentRef: grant.paymentRef, tags: ['Ticket dispute'] };
  const orderRecord = record('order', `public.orders/${grant.orderId}`, metadata.purchasedAt, 'Ticket purchase',
    'Recorded order totals and status; this record alone does not establish ticket delivery.', {
      paymentRef: grant.paymentRef, totalMinorUnits: number(order.total_cents), refundedMinorUnits: number(order.refunded_cents), status: string(order.status), channel: string(order.channel) });
  const itemRecords = rows.items.slice(0, 12).map(r => record('order', `public.order_items/${string(r.id)}`, metadata.purchasedAt, 'Purchased ticket line', 'Price and quantity recorded on this order.', {
    quantity: number(r.qty), unitPriceMinorUnits: number(r.unit_price_cents), unitFeeMinorUnits: number(r.unit_fee_cents), tierId: string(r.tier_id) }));
  const ticketRecords = rows.tickets.slice(0, 25).map(r => record('tickets', `public.tickets/${string(r.id)}`, r.created_at, 'Issued ticket', 'Ticket state is distinct from delivery and admission.', {
    status: string(r.status), tierId: string(r.tier_id), faceValueMinorUnits: number(r.face_value_cents), scannedAt: r.scanned_at ? time(r.scanned_at) : null,
    transferredFrom: r.transferred_from ? string(r.transferred_from) : null, transferredTo: r.transferred_to ? string(r.transferred_to) : null }));
  const scanRecords = rows.scans.slice(0, 20).map(r => record('attendance', `public.scans/${string(r.id)}`, r.created_at, 'Ticket scan result',
    'Only the recorded result is asserted; a missing scan does not establish nonattendance.', { ticketId: string(r.ticket_id), result: string(r.result) }));
  const emailRecords = rows.email.map(r => record('delivery', `public.order_email_queue/${grant.orderId}`, r.first_attempt_at ?? r.created_at,
    'Order email processing', 'Accepted means provider acceptance; inbox delivery and reading are unknown.', {
      state: string(r.state), attempts: number(r.attempts), delivered: null, read: null }));
  const refundRecords = rows.refunds.slice(0, 10).map(r => record('history', `public.refunds/${string(r.id)}`, r.created_at, 'Recorded order refund',
    'Database refund record; settlement is not independently verified by this section.', { amountMinorUnits: number(r.amount_cents), feeWithheldMinorUnits: number(r.fee_withheld_cents) }));
  return { metadata, stripeAccountId: payment.accountId, livemode: payment.livemode, mappingVerified: true,
    sections: {
      summary: { ...envelope('summary', [record('summary', `stripe.disputes/${payment.disputeId}`, payment.openedAt, 'Verified disputed ticket purchase',
        'Claim text and customer label come from the approved grant; dispute metadata is retrieved from Stripe. Source records are fetched on this request.', {
          paymentRef: grant.paymentRef, chargeId: payment.chargeId, disputeId: payment.disputeId, stripeAccountId: payment.accountId, livemode: payment.livemode,
          orderId: grant.orderId, disputedMinorUnits: payment.disputedAmount, paymentMinorUnits: payment.paymentAmount })]), mapping_verified: true, case: metadata },
      order: envelope('order', [orderRecord, ...itemRecords], rows.items.length > 12 ? ['Only the first 12 order lines are included.'] : []),
      tickets: ticketRecords.length ? envelope('tickets', ticketRecords, rows.tickets.length > 25 ? ['Only the first 25 tickets are included.'] : []) : unavailable('tickets', 'No issued ticket rows were found for the approved order.'),
      attendance: scanRecords.length ? envelope('attendance', scanRecords, ['Missing scans cannot establish nonattendance.', ...(rows.scans.length > 20 ? ['Only the first 20 scans are included.'] : [])]) : unavailable('attendance', 'No scan records were found for tickets on this order. This does not establish nonattendance.'),
      delivery: emailRecords.length ? envelope('delivery', emailRecords, ['No inbox delivery or read events are verified.', 'SMS order-to-provider matching is not verified and is excluded.']) : unavailable('delivery', 'No email queue row was found; SMS order-to-provider matching is not verified.'),
      history: refundRecords.length ? envelope('history', refundRecords, ['History is limited to this order’s refund rows.', ...(rows.refunds.length > 10 ? ['Only the first 10 refunds are included.'] : [])]) : unavailable('history', 'No refund history rows were found; other customer history is outside this grant.'),
      support: unavailable('support', 'Organizer messages have no order foreign key. No manually corroborated thread is configured.'),
      policy: envelope('policy', [record('policy', `public.orders/${grant.orderId}/terms`, metadata.purchasedAt, 'Recorded checkout terms version',
        'The order stores a terms version and age acknowledgement. Historical policy text and proof of its presentation are not available.', {
          termsVersion: string(order.terms_version), ageAcknowledged: z.boolean().parse(order.age_ack) })], ['No immutable customer-facing policy text is verified.']),
    } };
}
