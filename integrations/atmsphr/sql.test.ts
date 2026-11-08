import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { queries } from './repository.ts';
let db: PGlite;
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const args = [id(1), id(11), 'FICT-1', 'pi_fictional1'];
beforeAll(async () => {
  db = await PGlite.create();
  // Minimal schema projection from the inspected definitions. Fictional records only.
  await db.exec(`
    CREATE TABLE organizers (id uuid PRIMARY KEY,name text);
    CREATE TABLE events (id uuid PRIMARY KEY,organizer_id uuid,title text,starts_at timestamptz,ends_at timestamptz);
    CREATE TABLE orders (id uuid PRIMARY KEY,event_id uuid,order_number text,payment_ref text,payment_provider text,status text,
      total_cents int,refunded_cents int,channel text,terms_version text,age_ack boolean,created_at timestamptz,paid_at timestamptz);
    CREATE TABLE atmsphr_stripe_objects (id text PRIMARY KEY,platform text);
    CREATE TABLE atmsphr_legacy_fee_orders (order_id uuid);
    CREATE TABLE atmsphr_member_redemptions (order_id uuid);
    CREATE TABLE atmsphr_membership_ticket_bundles (order_id uuid);
    CREATE TABLE order_items (id uuid,order_id uuid,qty int,unit_price_cents int,unit_fee_cents int,tier_id uuid);
    CREATE TABLE tickets (id uuid PRIMARY KEY,order_id uuid,event_id uuid,status text,tier_id uuid,face_value_cents int,created_at timestamptz,
      scanned_at timestamptz,transferred_from uuid,transferred_to uuid);
    CREATE TABLE scans (id uuid,ticket_id uuid,event_id uuid,result text,created_at timestamptz);
    CREATE TABLE order_email_queue (order_id uuid,state text,attempts int,first_attempt_at timestamptz,created_at timestamptz);
    CREATE TABLE refunds (id uuid,order_id uuid,amount_cents int,fee_withheld_cents int,created_at timestamptz);
  `);
  for (let n = 1; n <= 2; n++) {
    await db.query('INSERT INTO organizers VALUES ($1,$2)', [id(n + 10), `Fictional merchant ${n}`]);
    await db.query("INSERT INTO events VALUES ($1,$2,'Fictional show',now(),now())", [id(n + 20), id(n + 10)]);
    await db.query("INSERT INTO orders VALUES ($1,$2,$3,$4,'stripe','paid',5000,0,'app','v1',true,now(),now())", [id(n), id(n + 20), `FICT-${n}`, `pi_fictional${n}`]);
    await db.query("INSERT INTO atmsphr_stripe_objects VALUES ($1,'atmsphr')", [`pi_fictional${n}`]);
    await db.query('INSERT INTO order_items VALUES ($1,$2,1,5000,0,$3)', [id(n + 30), id(n), id(n + 40)]);
    await db.query("INSERT INTO tickets VALUES ($1,$2,$3,'issued',$4,5000,now(),NULL,NULL,NULL)", [id(n + 50), id(n), id(n + 20), id(n + 40)]);
    await db.query("INSERT INTO scans VALUES ($1,$2,$3,'valid',now())", [id(n + 60), id(n + 50), id(n + 20)]);
    await db.query("INSERT INTO order_email_queue VALUES ($1,'accepted',1,now(),now())", [id(n)]);
    await db.query('INSERT INTO refunds VALUES ($1,$2,100,0,now())', [id(n + 70), id(n)]);
  }
  // A wrongly attributed event must not contribute attendance.
  await db.query("INSERT INTO scans VALUES ($1,$2,$3,'valid',now())", [id(99), id(51), id(22)]);
}, 20000);
afterAll(async () => { await db?.close(); });
describe('actual PostgreSQL query isolation', () => {
  it.each(Object.keys(queries) as (keyof typeof queries)[])('%s selects only approved rows', async key => {
    const result = await db.query(queries[key], key === 'order' ? [...args, 'atmsphr'] : args);
    expect(result.rows).toHaveLength(1);
    expect(JSON.stringify(result.rows)).not.toContain('Fictional merchant 2');
    if (key === 'scans') expect((result.rows[0] as Record<string, unknown>).id).toBe(id(61));
  });
  it.each(Object.keys(queries) as (keyof typeof queries)[])('%s returns nothing for a changed merchant', async key => {
    const changed = [args[0], id(12), args[2], args[3]];
    expect((await db.query(queries[key], key === 'order' ? [...changed, 'atmsphr'] : changed)).rows).toEqual([]);
  });
  it.each([0, 2, 3])('a changed order binding at index %s cannot retrieve another case', async index => {
    const changed = [...args]; changed[index] = index === 0 ? id(2) : index === 2 ? 'FICT-2' : 'pi_fictional2';
    for (const key of Object.keys(queries) as (keyof typeof queries)[]) {
      expect((await db.query(queries[key], key === 'order' ? [...changed, 'atmsphr'] : changed)).rows).toEqual([]);
    }
  });
  it('rejects a different Stripe platform', async () => {
    expect((await db.query(queries.order, [...args, 'legacy'])).rows).toEqual([]);
  });
  it('excludes imported and membership orders', async () => {
    for (const table of ['atmsphr_legacy_fee_orders', 'atmsphr_member_redemptions', 'atmsphr_membership_ticket_bundles']) {
      await db.query(`INSERT INTO ${table} VALUES ($1)`, [id(1)]);
      expect((await db.query(queries.order, [...args, 'atmsphr'])).rows).toEqual([]);
      await db.exec(`DELETE FROM ${table}`);
    }
  });
  it('the proposed reader role can execute queries but cannot read ungranted columns', async () => {
    await db.exec(await readFile(new URL('./read-role.sql', import.meta.url), 'utf8'));
    await db.exec('ALTER TABLE tickets ADD COLUMN fictional_secret text');
    await db.exec('SET ROLE atmsphr_evidence_reader');
    try {
      for (const key of Object.keys(queries) as (keyof typeof queries)[]) {
        expect((await db.query(queries[key], key === 'order' ? [...args, 'atmsphr'] : args)).rows).toHaveLength(1);
      }
      await expect(db.query('SELECT fictional_secret FROM tickets')).rejects.toThrow(/permission denied/i);
      await expect(db.query('DELETE FROM orders')).rejects.toThrow(/permission denied/i);
    } finally { await db.exec('RESET ROLE'); }
  });
  it('prevents writes inside the production transaction mode', async () => {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try { await expect(db.query('DELETE FROM orders')).rejects.toThrow(/read-only/i); }
    finally { await db.query('ROLLBACK'); }
  });
});
