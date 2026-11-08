import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { connectorManifestSchema } from '../../lib/evidence-connectors/core.ts';
import { createEvidenceHandler } from '../atmsphr/adapter.ts';
import { fileGrantLookup } from './grants.ts';
import { mappedRepository, verifyStripePayment } from './repository.ts';
import { parseArgs, readBoundedJson } from './setup.ts';
import { checkDatabase } from './permissions.ts';

export function createDatabasePool(env: NodeJS.ProcessEnv) {
  if (!env.EVIDENCE_DATABASE_URL) throw new Error('A restricted database login is required');
  const database = new URL(env.EVIDENCE_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('Invalid database URL');
  const hostname = decodeURIComponent(database.hostname);
  if (!hostname || /[\/\\\s]/.test(hostname)) throw new Error('A TCP database hostname is required for verified TLS');
  // pg merges connection-string query options over Pool settings, including host,
  // ssl, options and timeouts. Disallow them so a URL cannot weaken this policy.
  if (database.search || database.hash) throw new Error('Connection URL overrides are not allowed; use EVIDENCE_DATABASE_CA for verified TLS');
  const pool = new pg.Pool({ connectionString: database.toString(), max: 4, connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000, statement_timeout: 4000, query_timeout: 4500,
    options: '-c default_transaction_read_only=on', ssl: { rejectUnauthorized: true, ...(env.EVIDENCE_DATABASE_CA ? { ca: env.EVIDENCE_DATABASE_CA } : {}) } });
  pool.on('error', () => console.error('Evidence database connection error'));
  return pool;
}

export function createHttpServer(handler: (request: Request) => Promise<Response>) {
  let active = 0;
  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    const deny = (status: number) => { outgoing.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); outgoing.end('{"error":"evidence_unavailable"}'); };
    if (active >= 8) { deny(503); return; }
    if (incoming.method !== 'GET') { deny(405); return; }
    if (incoming.headers['transfer-encoding'] || (incoming.headers['content-length'] && incoming.headers['content-length'] !== '0')) { deny(400); return; }
    if (incoming.rawHeaders.filter((_, index) => index % 2 === 0 && incoming.rawHeaders[index].toLowerCase() === 'authorization').length !== 1) { deny(401); return; }
    active++;
    const controller = new AbortController();
    outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { deny(404); return; }
      const response = await handler(new Request(`http://localhost${incoming.url}`, { method: 'GET', headers: { authorization: incoming.headers.authorization ?? '' }, signal: controller.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { deny(502); }
    finally { active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  return server;
}

export async function startServer(env: NodeJS.ProcessEnv = process.env) {
  if (!env.EVIDENCE_MANIFEST_FILE || !env.EVIDENCE_GRANTS_FILE || !env.EVIDENCE_STRIPE_READ_KEY) throw new Error('Manifest, private grants, and restricted Stripe read key are required');
  const manifest = connectorManifestSchema.parse(await readBoundedJson(env.EVIDENCE_MANIFEST_FILE));
  const port = Number(env.PORT ?? 8789);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const pool = createDatabasePool(env);
  const lookup = fileGrantLookup(env.EVIDENCE_GRANTS_FILE);
  // Validate file mode and schema at startup, even if the file currently has no active grants.
  try {
    await lookup('0'.repeat(64), new AbortController().signal);
    await checkDatabase(manifest, pool);
  }
  catch (error) { await pool.end(); throw error; }
  const server = createHttpServer(createEvidenceHandler(mappedRepository(manifest, pool, lookup, verifyStripePayment(env.EVIDENCE_STRIPE_READ_KEY))));
  server.on('close', () => { void pool.end(); });
  server.listen(port, env.HOST ?? '127.0.0.1', () => console.log('Causality evidence connector listening'));
  return server;
}

export function loadConnectorEnv(args: string[]) {
  const options = parseArgs(args, ['env-file']);
  if (options['env-file']) process.loadEnvFile(options['env-file']);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    loadConnectorEnv(process.argv.slice(2));
    const server = await startServer();
    for (const event of ['SIGINT', 'SIGTERM'] as const) process.once(event, () => server.close());
  } catch {
    console.error('Connector configuration is incomplete or invalid. Review the private environment file and setup guide.');
    process.exitCode = 1;
  }
}
