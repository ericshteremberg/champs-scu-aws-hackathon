import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { connectorManifestSchema } from '../../lib/evidence-connectors/core.ts';
import { fileGrantLookup } from './grants.ts';
import { createDatabasePool, loadConnectorEnv } from './server.ts';
import { readBoundedJson } from './setup.ts';
import { checkDatabase } from './permissions.ts';
export { checkDatabase } from './permissions.ts';


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool: Pool | undefined;
  try {
    loadConnectorEnv(process.argv.slice(2));
    if (!process.env.EVIDENCE_MANIFEST_FILE || !process.env.EVIDENCE_GRANTS_FILE) throw new Error('Private manifest and grants paths are required');
    const manifest = connectorManifestSchema.parse(await readBoundedJson(process.env.EVIDENCE_MANIFEST_FILE));
    await fileGrantLookup(process.env.EVIDENCE_GRANTS_FILE)('0'.repeat(64), new AbortController().signal);
    pool = createDatabasePool(process.env);
    const result = await checkDatabase(manifest, pool);
    console.log(`Verified read access to ${result.checkedColumns} approved columns across ${result.tableCount} mapped tables. No customer rows were fetched.`);
    console.log('This checks the login and schema. A live case still needs Stripe verification, matching records, and a valid case grant.');
  } catch {
    console.error('Connector check failed. Review the restricted login, TLS, table and column names, RLS, and private grant file permissions. No credentials or records were printed.');
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
