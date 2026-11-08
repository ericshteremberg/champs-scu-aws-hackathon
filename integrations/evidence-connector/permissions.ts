import type { Pool } from 'pg';
import { connectorManifestSchema, quoteIdentifier } from '../../lib/evidence-connectors/core.ts';
import type { ConnectorManifest } from '../../lib/evidence-connectors/types.ts';

/** Read-only metadata and zero-row reads. No customer rows or credentials are printed. */
export async function checkDatabase(input: ConnectorManifest, pool: Pick<Pool, 'connect'>) {
  const manifest = connectorManifestSchema.parse(input);
  const tables = new Map<string, Set<string>>();
  const add = (name: string, columns: string[]) => {
    const found = tables.get(name) ?? new Set<string>();
    columns.forEach(column => found.add(column)); tables.set(name, found);
  };
  const order = manifest.order;
  add(order.table, [order.id, order.merchantId, order.orderRef, order.paymentRef, order.amount, order.currency, order.purchasedAt]);
  for (const mapping of Object.values(manifest.sections)) if (mapping) add(mapping.table, [mapping.id, mapping.orderId, mapping.merchantId, mapping.occurredAt, ...Object.values(mapping.fields)]);
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '4000ms'");
    const role = await client.query('SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_catalog.pg_roles WHERE rolname = current_user');
    if (role.rows.length !== 1 || Object.values(role.rows[0]).some(value => value !== false)) throw new Error('An unprivileged database login is required');
    for (const [name, columns] of tables) {
      const qualified = `${quoteIdentifier(manifest.schema)}.${quoteIdentifier(name)}`;
      const privileges = await client.query("SELECT has_table_privilege(current_user, $1, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR has_any_column_privilege(current_user, $1, 'INSERT,UPDATE,REFERENCES') AS can_write", [qualified]);
      if (privileges.rows.length !== 1 || privileges.rows[0].can_write !== false) throw new Error('The connector login has write privileges on a mapped table');
      await client.query(`SELECT ${[...columns].map(quoteIdentifier).join(', ')} FROM ${qualified} WHERE FALSE`);
    }
    await client.query('COMMIT');
    return { tableCount: tables.size, readOnly: true, checkedColumns: [...tables.values()].reduce((sum, fields) => sum + fields.size, 0) };
  } catch (error) {
    failed = true; await client.query('ROLLBACK').catch(() => {}); throw error;
  } finally { client.release(failed); }
}
