import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileGrantLookup } from './grants.ts';
const dirs: string[] = [];
const grant = { caseId: 'fictional_case', merchantId: '10000000-0000-4000-8000-000000000001', orderId: '10000000-0000-4000-8000-000000000002',
  orderRef: 'FICT-123', paymentRef: 'pi_fictional', disputeId: 'du_fictional', stripeAccountId: 'acct_fictional', stripePlatform: 'atmsphr',
  livemode: false, expiresAt: '2026-11-08T18:00:00Z', revoked: false, customerLabel: 'Fictional customer', claim: 'Ticket not received' };
const digest = createHash('sha256').update('fictional_test_token').digest('hex');
async function file(data: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'atmsphr-fictional-')); dirs.push(dir); const path = join(dir, 'grants.json');
  await writeFile(path, JSON.stringify(data), { mode: 0o600 }); return { path, lookup: fileGrantLookup(path) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('private grant lookup', () => {
  it('reloads changes, revocation, and removal without a service restart', async () => {
    const s = await file([{ digest, grant }]); const signal = new AbortController().signal;
    expect((await s.lookup(digest, signal))?.revoked).toBe(false);
    await writeFile(s.path, JSON.stringify([{ digest, grant: { ...grant, revoked: true } }]));
    expect((await s.lookup(digest, signal))?.revoked).toBe(true);
    await writeFile(s.path, '[]'); expect(await s.lookup(digest, signal)).toBeNull();
  });
  it('rejects world-readable grant files', async () => {
    const s = await file([{ digest, grant }]); await chmod(s.path, 0o644);
    await expect(s.lookup(digest, new AbortController().signal)).rejects.toThrow();
  });
  it('returns no grant for an unknown digest', async () => {
    const s = await file([{ digest, grant }]); expect(await s.lookup('0'.repeat(64), new AbortController().signal)).toBeNull();
  });
  it('rejects duplicate credentials', async () => {
    const s = await file([{ digest, grant }, { digest, grant }]); await expect(s.lookup(digest, new AbortController().signal)).rejects.toThrow();
  });
});
