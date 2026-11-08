import { open } from 'node:fs/promises';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const runtimeGrantSchema = z.object({
  caseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), merchantId: id, orderId: id,
  orderRef: z.string().min(1).max(200),
  paymentRef: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  disputeId: z.string().regex(/^du_[A-Za-z0-9]+$/),
  stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  livemode: z.boolean(), expiresAt: z.string().datetime({ offset: true }), revoked: z.boolean(),
  customerLabel: z.string().min(1).max(200), claim: z.string().min(1).max(6000),
  eventName: z.string().min(1).max(240),
}).strict();
export type RuntimeGrant = z.infer<typeof runtimeGrantSchema>;
export const grantFileSchema = z.array(z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), grant: runtimeGrantSchema }).strict()).max(1000)
  .refine(rows => new Set(rows.map(row => row.digest)).size === rows.length, 'Duplicate credential digest');

/** Fresh read on every request and before responding, so revocation is immediate. */
export function fileGrantLookup(path: string) {
  return async (digest: string, signal: AbortSignal): Promise<RuntimeGrant | null> => {
    signal.throwIfAborted();
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) throw new Error('Grant file must be private and bounded');
      const text = await file.readFile({ encoding: 'utf8', signal });
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Grant file exceeds limit');
      const grants = grantFileSchema.parse(JSON.parse(text));
      return grants.find(entry => entry.digest === digest)?.grant ?? null;
    } finally { await file.close(); }
  };
}
