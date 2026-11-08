import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { buildReadPlan, normalizeConnectorSection, quoteIdentifier as q } from '../../lib/evidence-connectors/core.ts';
import { CONNECTOR_TEMPLATES, previewConnector } from '../../lib/evidence-connectors/templates.ts';
import type { ConnectorGrant, ConnectorManifest } from '../../lib/evidence-connectors/types.ts';
import { EVIDENCE_SECTIONS } from '../../lib/investigation/types.ts';
import { buildReadRoleSql } from './install-files.ts';
import { checkDatabase } from './permissions.ts';

async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
  const fields = Object.keys(values);
  await db.query(`INSERT INTO public.${q(table)} (${fields.map(q).join(',')}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(values));
}
async function seed(db: PGlite, manifest: ConnectorManifest, grant: ConnectorGrant) {
  const o = manifest.order;
  const rootColumns = [...new Set(Object.entries(o).filter(([key]) => key !== 'table').map(([, value]) => value))];
  await db.exec(`CREATE TABLE public.${q(o.table)} (${rootColumns.map(column => `${q(column)} ${column === o.amount ? 'integer' : column === o.purchasedAt ? 'timestamptz' : 'text'}`).join(',')}, private_contact text)`);
  const root = { [o.id]: grant.orderId, [o.merchantId]: grant.merchantId, [o.orderRef]: grant.orderRef, [o.paymentRef]: grant.paymentRef, [o.amount]: grant.case.amount,
    [o.currency]: grant.case.currency, [o.purchasedAt]: grant.case.purchasedAt, private_contact: 'never-return@example.invalid' };
  await insert(db, o.table, root);
  await insert(db, o.table, { ...root, [o.id]: 'another_order', [o.orderRef]: 'ANOTHER', [o.paymentRef]: 'pi_another' });
  await insert(db, o.table, { ...root, [o.merchantId]: 'another_merchant' });
  for (const mapping of Object.values(manifest.sections)) {
    if (!mapping) continue;
    const columns = [...new Set([mapping.id, mapping.orderId, mapping.merchantId, mapping.occurredAt, ...Object.values(mapping.fields)])];
    await db.exec(`CREATE TABLE public.${q(mapping.table)} (${columns.map(column => `${q(column)} ${column === mapping.occurredAt ? 'timestamptz' : 'text'}`).join(',')}, private_note text)`);
    const child = { [mapping.id]: 'approved_record', [mapping.orderId]: grant.orderId, [mapping.merchantId]: grant.merchantId,
      [mapping.occurredAt]: grant.case.purchasedAt, ...Object.fromEntries(Object.values(mapping.fields).map(field => [field, 'approved_value'])), private_note: 'NEVER_RETURN' };
    await insert(db, mapping.table, child);
    await insert(db, mapping.table, { ...child, [mapping.id]: 'other_order_record', [mapping.orderId]: 'another_order' });
    await insert(db, mapping.table, { ...child, [mapping.id]: 'other_merchant_record', [mapping.merchantId]: 'another_merchant' });
  }
}

describe('real PostgreSQL execution for both reusable schemas', () => {
  it.each(CONNECTOR_TEMPLATES)('$id excludes unrelated rows and unapproved fields with the generated read role', async template => {
    const db = new PGlite();
    try {
      const metadata = previewConnector(template.manifest, template.id).case;
      const grant: ConnectorGrant = { caseId: metadata.id, merchantId: metadata.merchantId, orderId: 'approved_order', orderRef: metadata.orderRef,
        paymentRef: metadata.paymentRef, expiresAt: '2099-01-01T00:00:00Z', revoked: false, case: metadata };
      await seed(db, template.manifest, grant);
      await db.exec(buildReadRoleSql(template.manifest));
      await db.exec('SET ROLE causality_evidence_reader');
      const pool = { connect: async () => ({ query: db.query.bind(db), release: () => {} }) } as unknown as Pick<Pool, 'connect'>;
      expect(await checkDatabase(template.manifest, pool)).toMatchObject({ readOnly: true });
      for (const section of EVIDENCE_SECTIONS) {
        const plan = buildReadPlan(template.manifest, grant, section);
        if (!plan) continue;
        const result = await db.query<Record<string, unknown>>(plan.sql, plan.params);
        expect(result.rows).toHaveLength(1);
        const normalized = normalizeConnectorSection(template.manifest, grant, section, result.rows, { sourceMode: 'synthetic' });
        expect(normalized.records).toHaveLength(1);
        expect(JSON.stringify(normalized)).not.toContain('other_order_record');
        expect(JSON.stringify(normalized)).not.toContain('other_merchant_record');
        expect(JSON.stringify(normalized)).not.toContain('NEVER_RETURN');
        expect(JSON.stringify(normalized)).not.toContain('never-return@example.invalid');
      }
      await expect(db.query(`SELECT private_contact FROM public.${q(template.manifest.order.table)}`)).rejects.toThrow('permission denied');
      await expect(db.query(`DELETE FROM public.${q(template.manifest.order.table)}`)).rejects.toThrow('permission denied');
      const plan = buildReadPlan(template.manifest, grant, 'order')!;
      const denied = await db.query(plan.sql, ['wrong_merchant', ...plan.params.slice(1)]);
      expect(denied.rows).toEqual([]);
      const injected = await db.query(plan.sql, [grant.merchantId, "x' OR true --", grant.orderRef, grant.paymentRef]);
      expect(injected.rows).toEqual([]);
    } finally { await db.close(); }
  });
});
