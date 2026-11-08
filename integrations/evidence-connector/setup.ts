import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectorManifestSchema } from '../../lib/evidence-connectors/core.ts';
import { runtimeGrantSchema } from './grants.ts';
import { buildConnectorInstallFiles } from './install-files.ts';

export function parseArgs(args: string[], allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || result[key]) throw new Error('Invalid command arguments');
    result[key] = args[i + 1];
  }
  return result;
}

export async function readBoundedJson(path: string, maxBytes = 256 * 1024): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > maxBytes) throw new Error('Input file is too large');
    const text = await file.readFile('utf8');
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Input file is too large');
    return JSON.parse(text);
  } finally { await file.close(); }
}

export async function setupConnector(options: { manifest: string; out: string; grant?: string }, now = new Date()) {
  const manifest = connectorManifestSchema.parse(await readBoundedJson(options.manifest));
  const grant = options.grant ? runtimeGrantSchema.parse(await readBoundedJson(options.grant)) : null;
  if (grant && (grant.revoked || Date.parse(grant.expiresAt) <= now.getTime() || Date.parse(grant.expiresAt) > now.getTime() + 30 * 86400000)) throw new Error('Grant must be approved, active, and expire within 30 days');
  const directory = resolve(options.out);
  // Exclusive directory creation prevents accidental replacement of an active grant or token.
  await mkdir(directory, { mode: 0o700 });
  const output = buildConnectorInstallFiles(manifest);
  for (const file of output.files) await writeFile(resolve(directory, file.name), file.content, { mode: 0o600, flag: 'wx' });
  const example = {
    caseId: 'REPLACE_APPROVED_CASE_ID', merchantId: 'REPLACE_MERCHANT_ID', orderId: 'REPLACE_ORDER_ID', orderRef: 'REPLACE_ORDER_REFERENCE',
    paymentRef: 'pi_REPLACE', disputeId: 'du_REPLACE', stripeAccountId: 'acct_REPLACE', livemode: false,
    expiresAt: new Date(now.getTime() + 86400000).toISOString(), revoked: true,
    customerLabel: 'Customer alias', claim: 'Approved customer claim', eventName: 'Approved event or rental name',
  };
  await writeFile(resolve(directory, 'case-grant.example.json'), `${JSON.stringify(example, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  const token = grant ? randomBytes(32).toString('base64url') : null;
  const grants = token && grant ? [{ digest: createHash('sha256').update(token).digest('hex'), grant }] : [];
  await writeFile(resolve(directory, 'grants.json'), `${JSON.stringify(grants, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  if (token) await writeFile(resolve(directory, 'case-token.secret'), `${token}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(directory, 'connector.env'), [
    '# Private local configuration. Never commit this file.',
    `EVIDENCE_MANIFEST_FILE=${JSON.stringify(resolve(directory, 'manifest.json'))}`,
    `EVIDENCE_GRANTS_FILE=${JSON.stringify(resolve(directory, 'grants.json'))}`,
    'EVIDENCE_DATABASE_URL=', 'EVIDENCE_STRIPE_READ_KEY=', 'HOST=127.0.0.1', 'PORT=8789', '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  return { directory, grantCreated: Boolean(grant), files: output.files.map(file => file.name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2), ['manifest', 'out', 'grant']);
    if (!args.manifest || !args.out) throw new Error('Both manifest and out paths are required');
    const result = await setupConnector({ manifest: args.manifest, out: args.out, grant: args.grant });
    console.log(`Connector files created in ${result.directory}.`);
    console.log(result.grantCreated ? 'A private case token was written to case-token.secret. No credential was printed.' : 'No live case grant was created. Complete and approve the grant example before connecting.');
  } catch {
    console.error('Setup could not complete. Use --manifest FILE --out NEW_PRIVATE_DIRECTORY [--grant APPROVED_CASE_FILE]. Check the mapping, grant expiry, and output directory.');
    process.exitCode = 1;
  }
}
