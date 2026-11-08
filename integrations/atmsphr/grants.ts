import { open } from 'node:fs/promises';
import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const grantSchema = z.object({
  caseId: id, merchantId: z.string().uuid(), orderId: z.string().uuid(), orderRef: z.string().min(1).max(200),
  paymentRef: z.string().regex(/^pi_[A-Za-z0-9]+$/), disputeId: z.string().regex(/^du_[A-Za-z0-9]+$/),
  stripeAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), stripePlatform: z.enum(['legacy', 'atmsphr']),
  livemode: z.boolean(), expiresAt: z.string().datetime({ offset: true }), revoked: z.boolean(),
  customerLabel: z.string().min(1).max(200), claim: z.string().min(1).max(6000),
}).strict();
export type CaseGrant = z.infer<typeof grantSchema>;
const fileSchema = z.array(z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), grant: grantSchema }).strict()).max(1000)
  .refine(rows => new Set(rows.map(row => row.digest)).size === rows.length, 'Duplicate digest');
/** Operator-managed private grant file. No cache: removal, edits and revocation take effect per request. */
export function fileGrantLookup(path: string) {
  return async (digest: string, signal: AbortSignal): Promise<CaseGrant | null> => {
    signal.throwIfAborted();
    const file = await open(path, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) throw new Error('Invalid private grant file');
      const data = await file.readFile({ encoding: 'utf8', signal });
      if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('Grant file exceeds bound');
      const rows = fileSchema.parse(JSON.parse(data));
      return rows.find(row => row.digest === digest)?.grant ?? null;
    } finally { await file.close(); }
  };
}
