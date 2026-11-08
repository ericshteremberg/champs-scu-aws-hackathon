import { z } from 'zod';
import type { Pool } from 'pg';
import { buildReadPlan, connectorManifestSchema, envelopeToWire, normalizeConnectorSection } from '../../lib/evidence-connectors/core.ts';
import type { ConnectorCase, ConnectorGrant, ConnectorManifest } from '../../lib/evidence-connectors/types.ts';
import { sections, type Repository, type VerifiedCase } from '../atmsphr/adapter.ts';
import { stripeVerifier, type PaymentEvidence } from '../atmsphr/stripe.ts';
import { runtimeGrantSchema, type RuntimeGrant } from './grants.ts';

export type GenericPaymentVerifier = (grant: RuntimeGrant, signal: AbortSignal) => Promise<PaymentEvidence>;
export function verifyStripePayment(key: string | undefined): GenericPaymentVerifier {
  const verify = stripeVerifier({ atmsphr: key });
  return (grant, signal) => verify({ ...grant, stripePlatform: 'atmsphr' }, signal);
}
const timestamp = (value: unknown) => z.string().datetime({ offset: true }).parse(value instanceof Date ? value.toISOString() : value);

/** A single adapter executes approved mappings for any supported schema. It never accepts SQL from a request. */
export function mappedRepository(input: ConnectorManifest, pool: Pick<Pool, 'connect'>, findGrant: Repository['findGrant'], verify: GenericPaymentVerifier,
  now: () => Date = () => new Date()): Repository {
  const manifest = connectorManifestSchema.parse(input);
  return { findGrant, async readCase(inputGrant, signal): Promise<VerifiedCase | null> {
    const grant = runtimeGrantSchema.parse(inputGrant);
    signal.throwIfAborted();
    const payment = await verify(grant, signal);
    if (payment.disputeId !== grant.disputeId || payment.paymentRef !== grant.paymentRef || payment.accountId !== grant.stripeAccountId || payment.livemode !== grant.livemode) throw new Error('Payment verification scope mismatch');
    const metadata: ConnectorCase = {
      id: grant.caseId, merchantId: grant.merchantId, merchantName: manifest.name,
      customerLabel: grant.customerLabel, claim: grant.claim, reason: payment.reason,
      amount: payment.disputedAmount, currency: payment.currency.toUpperCase(), eventName: grant.eventName,
      purchasedAt: payment.openedAt, openedAt: payment.openedAt, dueAt: payment.dueAt, sourceMode: 'live',
      summary: 'Merchant-approved case scope. Stripe verifies the dispute and payment; mapped source records corroborate the purchase. Customer label, claim and event name come from the approved case grant.',
      orderRef: grant.orderRef, paymentRef: grant.paymentRef, tags: [manifest.businessType === 'tickets' ? 'Ticket dispute' : 'Rental dispute'],
    };
    const coreGrant: ConnectorGrant = { caseId: grant.caseId, merchantId: grant.merchantId, orderId: grant.orderId, orderRef: grant.orderRef,
      paymentRef: grant.paymentRef, expiresAt: grant.expiresAt, revoked: grant.revoked, case: metadata };
    const rootPlan = buildReadPlan(manifest, coreGrant, 'order', now());
    if (!rootPlan) throw new Error('Order mapping is required');
    signal.throwIfAborted();
    const client = await pool.connect();
    let failed = false;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '4000ms'");
      const query = async (sql: string, params: string[]) => {
        signal.throwIfAborted();
        const result = await client.query(sql, params);
        signal.throwIfAborted();
        return result.rows as Record<string, unknown>[];
      };
      const roots = await query(rootPlan.sql, rootPlan.params);
      if (!roots.length) { await client.query('ROLLBACK'); return null; }
      if (roots.length !== 1 || roots[0].amount !== payment.paymentAmount || String(roots[0].currency).toUpperCase() !== payment.currency.toUpperCase()) throw new Error('Purchase does not match the verified payment');
      metadata.purchasedAt = timestamp(roots[0].purchasedAt);
      // Validate root identity before issuing any linked-record query.
      normalizeConnectorSection(manifest, coreGrant, 'order', roots, { sourceMode: 'live', now: now() });
      const output = {} as VerifiedCase['sections'];
      for (const section of sections) {
        const plan = buildReadPlan(manifest, coreGrant, section, now());
        const rows = section === 'summary' || section === 'order' ? roots : plan ? await query(plan.sql, plan.params) : [];
        const envelope = normalizeConnectorSection(manifest, coreGrant, section, rows, { sourceMode: 'live', now: now() });
        output[section] = envelopeToWire(envelope, section === 'summary' ? metadata : undefined);
      }
      await client.query('COMMIT');
      return { metadata: { ...metadata, sourceMode: 'live' }, stripeAccountId: payment.accountId, livemode: payment.livemode, mappingVerified: true, sections: output };
    } catch (error) {
      failed = true;
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(failed); }
  } };
}
