import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createEvidenceHandler } from './adapter.ts';
import { fileGrantLookup } from './grants.ts';
import { postgresRepository } from './repository.ts';
import { stripeVerifier } from './stripe.ts';

export function createHttpServer(handler: (request: Request) => Promise<Response>) {
  let active = 0;
  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    const deny = (status: number) => { outgoing.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); outgoing.end('{"error":"evidence_unavailable"}'); };
    if (active >= 8) { deny(503); return; }
    if (incoming.method !== 'GET') { deny(405); return; }
    if (incoming.headers['transfer-encoding'] || (incoming.headers['content-length'] && incoming.headers['content-length'] !== '0')) { deny(400); return; }
    const authorizationHeaders = incoming.rawHeaders.filter((_, i) => i % 2 === 0 && incoming.rawHeaders[i].toLowerCase() === 'authorization');
    if (authorizationHeaders.length !== 1) { deny(401); return; }
    active++;
    const controller = new AbortController();
    outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { deny(404); return; }
      const response = await handler(new Request(`http://localhost${incoming.url}`, {
        method: 'GET', headers: { authorization: incoming.headers.authorization ?? '' }, signal: controller.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { deny(502); }
    finally { active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}

export function startServer(env: NodeJS.ProcessEnv = process.env) {
  if (!env.ATMSPHR_DATABASE_URL || !env.ATMSPHR_GRANTS_FILE) throw new Error('Database connection and private grant file are required');
  const database = new URL(env.ATMSPHR_DATABASE_URL);
  // Supabase SSL is verified. Never permit sslmode=no-verify or certificate bypass options.
  if (database.protocol !== 'postgres:' && database.protocol !== 'postgresql:') throw new Error('Invalid database protocol');
  for (const key of database.searchParams.keys()) if (/ssl/i.test(key)) throw new Error('Configure database TLS using ATMSPHR_DATABASE_CA instead of URL SSL options');
  const pool = new pg.Pool({ connectionString: database.toString(), max: 4, connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000, statement_timeout: 4000, query_timeout: 4500,
    options: '-c default_transaction_read_only=on', ssl: { rejectUnauthorized: true, ...(env.ATMSPHR_DATABASE_CA ? { ca: env.ATMSPHR_DATABASE_CA } : {}) } });
  pool.on('error', () => { console.error('Evidence database connection error'); });
  const lookup = fileGrantLookup(env.ATMSPHR_GRANTS_FILE);
  const handler = createEvidenceHandler(postgresRepository(pool, lookup,
    stripeVerifier({ legacy: env.ATMSPHR_STRIPE_LEGACY_READ_KEY, atmsphr: env.ATMSPHR_STRIPE_READ_KEY })));
  const server = createHttpServer(handler);
  server.on('close', () => { void pool.end(); });
  const port = Number(env.PORT ?? 8788);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { void pool.end(); throw new Error('Invalid port'); }
  server.listen(port, env.HOST ?? '127.0.0.1', () => console.log('Merchant evidence API listening'));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const server = startServer(); for (const event of ['SIGINT', 'SIGTERM'] as const) process.once(event, () => server.close()); }
  catch { console.error('Evidence API configuration is incomplete or invalid'); process.exitCode = 1; }
}
