import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, chmod, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { ConnectorManifest } from '../../lib/evidence-connectors/types.ts';
import { normalizeMerchantSection } from '../../lib/investigation/merchant.ts';
import { createEvidenceHandler } from '../atmsphr/adapter.ts';
import { fileGrantLookup, type RuntimeGrant } from './grants.ts';
import { mappedRepository } from './repository.ts';
import { buildConnectorInstallFiles, buildReadRoleSql } from './install-files.ts';
import { setupConnector } from './setup.ts';
import { checkDatabase } from './check.ts';
import { createDatabasePool, createHttpServer } from './server.ts';

const now = new Date('2026-11-07T12:00:00Z');
const token = 'a'.repeat(43);
const digest = createHash('sha256').update(token).digest('hex');
const manifest: ConnectorManifest = {
  version: 1, id: 'merchant-example', name: 'Fictional merchant', businessType: 'tickets', schema: 'public',
  order: { table: 'orders', id: 'id', merchantId: 'merchant_id', orderRef: 'reference', paymentRef: 'payment_id', amount: 'total', currency: 'currency', purchasedAt: 'created_at' },
  sections: { delivery: { table: 'deliveries', id: 'id', orderId: 'order_id', merchantId: 'merchant_id', occurredAt: 'created_at', title: 'Email processing', detail: 'A recorded send does not establish receipt.', fields: { state: 'status' }, limit: 2 } },
};
const grant: RuntimeGrant = {
  caseId: 'CASE_1', merchantId: 'merchant_1', orderId: 'order_1', orderRef: 'ORDER-1', paymentRef: 'pi_payment1',
  disputeId: 'du_dispute1', stripeAccountId: 'acct_account1', livemode: false, expiresAt: '2026-11-08T12:00:00Z', revoked: false,
  customerLabel: 'Customer alias', claim: 'Ticket not received', eventName: 'Fictional event',
};
const payment = { disputeId: grant.disputeId, chargeId: 'ch_charge1', paymentRef: grant.paymentRef, accountId: grant.stripeAccountId, livemode: false,
  paymentAmount: 5000, disputedAmount: 3000, currency: 'USD', reason: 'product_not_received', openedAt: now.toISOString(), dueAt: '2026-11-14T12:00:00Z' };
const root = { __scope_orderId: grant.orderId, __scope_merchantId: grant.merchantId, __scope_orderRef: grant.orderRef, __scope_paymentRef: grant.paymentRef,
  id: grant.orderId, merchantId: grant.merchantId, orderRef: grant.orderRef, paymentRef: grant.paymentRef, amount: 5000, currency: 'usd', purchasedAt: new Date('2026-11-05T12:00:00Z') };
const delivered = { __scope_orderId: grant.orderId, __scope_merchantId: grant.merchantId, __scope_orderRef: grant.orderRef, __scope_paymentRef: grant.paymentRef,
  id: 'delivery_1', occurredAt: new Date('2026-11-05T12:01:00Z'), f_0: 'accepted', private_email: 'must-not-be-returned@example.test' };

function fakeDatabase(rootRows = [root], childRows = [delivered]) {
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? sql.includes('"deliveries"') ? childRows : rootRows : [] }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect } as unknown as Pick<Pool, 'connect'>, query, release, connect };
}
const request = (caseId = grant.caseId, section = 'summary', bearer = token) => new Request(`https://merchant.example/v1/cases/${caseId}/evidence?section=${section}`, { headers: { Authorization: `Bearer ${bearer}` } });
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temporary() { const directory = await mkdtemp(join(tmpdir(), 'causality-connector-')); directories.push(directory); return directory; }

describe('reusable live connector boundary', () => {
  it('verifies Stripe, uses bounded case queries, and emits the existing contract for partial disputes', async () => {
    const db = fakeDatabase(); const verify = vi.fn(async () => payment);
    const lookup = vi.fn(async (input: string) => input === digest ? grant : null);
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, lookup, verify, () => now), () => now);
    const response = await handler(request());
    expect(response.status).toBe(200);
    const result = normalizeMerchantSection(await response.json(), grant.caseId, 'summary');
    expect(result.case?.amount).toBe(3000);
    expect(result.evidence.records[0].fields.totalMinorUnits).toBe(5000);
    expect(verify).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0][0]).toContain('REPEATABLE READ READ ONLY');
    for (const [sql, values] of db.query.mock.calls as unknown as [string, string[]][]) if (sql.startsWith('SELECT')) {
      expect(values).toEqual([grant.merchantId, grant.orderId, grant.orderRef, grant.paymentRef]);
      expect(sql).toContain('LIMIT'); expect(sql).not.toContain('SELECT *');
    }
    expect(db.query).toHaveBeenCalledWith('COMMIT');
    expect(db.release).toHaveBeenCalledWith(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('emits only selected fields and keeps delivery limitations', async () => {
    const db = fakeDatabase();
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, async () => grant, async () => payment, () => now), () => now);
    const response = await handler(request(grant.caseId, 'delivery'));
    const body = normalizeMerchantSection(await response.json(), grant.caseId, 'delivery').evidence;
    expect(response.status).toBe(200);
    expect(body.records[0].fields.state).toBe('accepted');
    expect(JSON.stringify(body)).not.toContain('must-not-be-returned');
    expect(body.status).toBe('partial');
    expect(body.limitations.join(' ')).toContain('does not establish inbox delivery');
  });

  it.each(['wrong-case', 'revoked', 'expired', 'invalid-token'])('denies %s before querying or verifying payment', async mode => {
    const db = fakeDatabase(); const verify = vi.fn(async () => payment);
    const changed = { ...grant, ...(mode === 'revoked' ? { revoked: true } : mode === 'expired' ? { expiresAt: now.toISOString() } : {}) };
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, async () => mode === 'invalid-token' ? null : changed, verify, () => now), () => now);
    const response = await handler(request(mode === 'wrong-case' ? 'CASE_2' : grant.caseId));
    expect([401, 403]).toContain(response.status); expect(db.connect).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a payment mismatch before opening a database transaction', async () => {
    const db = fakeDatabase();
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, async () => grant, async () => ({ ...payment, paymentRef: 'pi_other' }), () => now), () => now);
    expect((await handler(request())).status).toBe(502); expect(db.connect).not.toHaveBeenCalled();
  });

  it('rejects cross-merchant root records before reading child tables', async () => {
    const db = fakeDatabase([{ ...root, __scope_merchantId: 'another_merchant' }]);
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, async () => grant, async () => payment, () => now), () => now);
    expect((await handler(request())).status).toBe(502);
    expect(db.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT'))).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith('ROLLBACK'); expect(db.release).toHaveBeenCalledWith(true);
  });

  it('rechecks grant revocation after reading', async () => {
    const db = fakeDatabase(); const lookup = vi.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, revoked: true });
    const handler = createEvidenceHandler(mappedRepository(manifest, db.pool, lookup, async () => payment, () => now), () => now);
    expect((await handler(request())).status).toBe(403);
  });
});

describe('guided installer', () => {
  it('generates column permissions without secret values or SQL write access', () => {
    const files = buildConnectorInstallFiles(manifest);
    expect(files.files.map(file => file.name)).toEqual(['manifest.json', 'read-role.sql', 'INSTALL.md']);
    const sql = buildReadRoleSql(manifest);
    expect(sql).toContain('NOLOGIN'); expect(sql).toContain('NOBYPASSRLS');
    expect(sql).toContain('GRANT SELECT ('); expect(sql).not.toContain('GRANT SELECT ON'); expect(sql).not.toMatch(/GRANT (?:ALL|UPDATE|INSERT|DELETE)/);
    expect(sql).not.toContain('PASSWORD');
    expect(() => buildReadRoleSql({ ...manifest, schema: 'public; DROP TABLE orders' })).toThrow();
  });

  it('creates private files and only hashes the server credential, with no active grants by default', async () => {
    const base = await temporary(); const source = join(base, 'download.json');
    await writeFile(source, JSON.stringify(manifest));
    const empty = join(base, 'empty');
    await setupConnector({ manifest: source, out: empty }, now);
    expect(JSON.parse(await readFile(join(empty, 'grants.json'), 'utf8'))).toEqual([]);
    const input = join(base, 'approved.json'); await writeFile(input, JSON.stringify(grant), { mode: 0o600 });
    const out = join(base, 'active');
    await setupConnector({ manifest: source, out, grant: input }, now);
    const issued = (await readFile(join(out, 'case-token.secret'), 'utf8')).trim();
    expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hashes = await readFile(join(out, 'grants.json'), 'utf8'); expect(hashes).not.toContain(issued);
    for (const name of ['case-token.secret', 'grants.json', 'connector.env']) expect((await stat(join(out, name))).mode & 0o077).toBe(0);
    const lookup = fileGrantLookup(join(out, 'grants.json'));
    expect(await lookup(createHash('sha256').update(issued).digest('hex'), new AbortController().signal)).toEqual(grant);
    await expect(setupConnector({ manifest: source, out, grant: input }, now)).rejects.toThrow();
    await chmod(join(out, 'grants.json'), 0o644);
    await expect(lookup(digest, new AbortController().signal)).rejects.toThrow('private');
  });

  it('blocks revoked grants and TLS bypass configurations', async () => {
    const base = await temporary(); const source = join(base, 'manifest.json'); const input = join(base, 'grant.json');
    await writeFile(source, JSON.stringify(manifest)); await writeFile(input, JSON.stringify({ ...grant, revoked: true }));
    await expect(setupConnector({ manifest: source, out: join(base, 'output'), grant: input }, now)).rejects.toThrow('approved');
    expect(() => createDatabasePool({ ...process.env, EVIDENCE_DATABASE_URL: 'postgres://reader:secret@localhost/db?sslmode=no-verify' })).toThrow('TLS');
  });

  it.each([
    'postgres://reader:secret@database.example/db?host=%2Ftmp',
    'postgres://reader:secret@%2Ftmp/db',
    'postgres://reader:secret@database.example/db?options=-c%20default_transaction_read_only%3Doff',
    'postgres://reader:secret@database.example/db?statement_timeout=0',
  ])('rejects connection-string host and policy overrides', url => {
    expect(() => createDatabasePool({ ...process.env, EVIDENCE_DATABASE_URL: url })).toThrow();
  });

  it.each(['superuser', 'writes'])('fails the installation check for %s permissions', async failure => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('pg_roles') ? [{ rolsuper: failure === 'superuser', rolbypassrls: false, rolcreaterole: false, rolcreatedb: false }] : sql.includes('has_table_privilege') ? [{ can_write: failure === 'writes' }] : [] }));
    const release = vi.fn(); const pool = { connect: async () => ({ query, release }) } as unknown as Pick<Pool, 'connect'>;
    await expect(checkDatabase(manifest, pool)).rejects.toThrow(); expect(query).toHaveBeenCalledWith('ROLLBACK'); expect(release).toHaveBeenCalledWith(true);
  });

  it('checks schema using zero-row queries', async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('pg_roles') ? [{ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false }] : sql.includes('has_table_privilege') ? [{ can_write: false }] : [] }));
    const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pick<Pool, 'connect'>;
    expect(await checkDatabase(manifest, pool)).toMatchObject({ tableCount: 2, readOnly: true });
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM "public"')).every(([sql]) => sql.endsWith('WHERE FALSE'))).toBe(true);
  });

  it('serves the packaged HTTP route and rejects unsupported methods', async () => {
    const handler = vi.fn(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const server = createHttpServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server port');
      const url = `http://127.0.0.1:${address.port}/v1/cases/CASE_1/evidence?section=summary`;
      expect((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
      expect((await fetch(url, { method: 'POST' })).status).toBe(405);
      expect((await fetch(url)).status).toBe(401);
      expect(handler).toHaveBeenCalledOnce();
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
