import { z } from 'zod';
import type { CaseGrant } from './grants.ts';
const ref = z.union([z.string(), z.object({ id: z.string() })]).transform(value => typeof value === 'string' ? value : value.id);
const disputeSchema = z.object({ id: z.string(), charge: ref, amount: z.number().int().nonnegative(), currency: z.string(),
  livemode: z.boolean(), reason: z.string(), created: z.number().int(), evidence_details: z.object({ due_by: z.number().int().positive() }) });
const chargeSchema = z.object({ id: z.string(), payment_intent: ref, amount: z.number().int().nonnegative(), currency: z.string(),
  livemode: z.boolean(), paid: z.boolean() });
export interface PaymentEvidence {
  disputeId: string; chargeId: string; paymentRef: string; accountId: string; livemode: boolean;
  paymentAmount: number; disputedAmount: number; currency: string; reason: string; openedAt: string; dueAt: string;
}
export type PaymentVerifier = (grant: CaseGrant, signal: AbortSignal) => Promise<PaymentEvidence>;
/** Only GETs to Stripe; the grant determines account context, never a query or model argument. */
export function stripeVerifier(keys: Partial<Record<CaseGrant['stripePlatform'], string>>, request: typeof fetch = fetch): PaymentVerifier {
  return async (grant, signal) => {
    const key = keys[grant.stripePlatform];
    if (!key || !key.startsWith(grant.livemode ? 'rk_live_' : 'rk_test_')) throw new Error('Restricted read key not configured for grant mode');
    async function get(path: string): Promise<unknown> {
      const response = await request(`https://api.stripe.com/v1/${path}`, { method: 'GET', redirect: 'error', signal,
        headers: { authorization: `Bearer ${key}`, 'Stripe-Account': grant.stripeAccountId, 'Stripe-Version': '2026-10-28.endive' } });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Stripe read failed'); }
      if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Invalid Stripe response');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Stripe response too large'); } chunks.push(value);
      } } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const dispute = disputeSchema.parse(await get(`disputes/${grant.disputeId}`));
    if (dispute.id !== grant.disputeId || dispute.livemode !== grant.livemode || !/^(?:ch|py)_[A-Za-z0-9]+$/.test(dispute.charge)) throw new Error('Dispute scope mismatch');
    const charge = chargeSchema.parse(await get(`charges/${dispute.charge}`));
    if (charge.id !== dispute.charge || charge.payment_intent !== grant.paymentRef || charge.livemode !== grant.livemode
      || !charge.paid || charge.currency !== dispute.currency || dispute.amount > charge.amount) throw new Error('Payment mapping mismatch');
    return { disputeId: dispute.id, chargeId: charge.id, paymentRef: charge.payment_intent, accountId: grant.stripeAccountId,
      livemode: charge.livemode, paymentAmount: charge.amount, disputedAmount: dispute.amount, currency: charge.currency.toUpperCase(),
      reason: dispute.reason, openedAt: new Date(dispute.created * 1000).toISOString(), dueAt: new Date(dispute.evidence_details.due_by * 1000).toISOString() };
  };
}
