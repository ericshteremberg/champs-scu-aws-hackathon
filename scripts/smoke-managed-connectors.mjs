import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { loadAwsSession, projectRoot } from './load-aws-session.mjs';
import fixture from './managed-connector-fixture.mjs';

// Explicit remote smoke test. The fixture has no storage and no real customer
// data. The app, connection credentials, evidence and investigation stay on AWS.
// Run with --dry-run for local fixture checks and Wrangler bundling only.
const dryRun = process.argv.includes('--dry-run');
const skipBedrock = process.argv.includes('--skip-bedrock');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = randomUUID();
const workerName = `causality-connector-fixture-${stamp.replaceAll('-', '')}`;
const token = randomBytes(32).toString('hex');
const externalCaseId = 'fixture_ticket_missing';
const actor = { userId: `managed-live-smoke-${stamp}`, email: 'fictional-managed@example.test', displayName: 'Fictional managed connector verification' };
const other = { userId: `managed-live-other-${stamp}`, email: 'fictional-other@example.test', displayName: 'Fictional other workspace' };
const directory = path.join(projectRoot, '.aws-build', `managed-smoke-${stamp}`);
const configPath = path.join(directory, 'wrangler.jsonc');
const config = JSON.parse(readFileSync(path.join(projectRoot, 'wrangler.dev.jsonc'), 'utf8'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(configPath, JSON.stringify({
  name: workerName, account_id: config.account_id,
  main: path.join(projectRoot, 'scripts/managed-connector-fixture.mjs'),
  compatibility_date: new Date().toISOString().slice(0, 10), compatibility_flags: ['nodejs_compat'],
  workers_dev: true, preview_urls: false,
  // A disposable credential-bearing verification fixture should not retain logs.
  observability: { enabled: false },
}, null, 2), { mode: 0o600 });

let stage = 'local fixture validation';
let deployment, lambda, dynamo;
let deploymentAttempted = false;
let connectionId, caseId, runId;
let remoteWorkspaces = false;
let failed = false;
let cleanupFailed = false;
const results = { sections: 0, modelCalls: 0, citations: 0, removedItems: 0, checks: [] };

function wrangler(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), ...args, '--config', configPath], {
      cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' },
    });
    let output = ''; let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) reject(error); else resolve(output);
    };
    const timeout = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Wrangler command timed out.')); }, 120_000);
    const receive = chunk => {
      if (output.length + chunk.length > 1024 * 1024) { child.kill('SIGTERM'); finish(new Error('Wrangler output exceeded its limit.')); return; }
      output += chunk.toString();
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.on('error', () => finish(new Error('Wrangler could not start.')));
    child.on('close', code => finish(code === 0 ? undefined : new Error(`Wrangler command failed with exit status ${Number.isInteger(code) ? code : 'unknown'}.`)));
    child.stdin.on('error', () => {});
    // Secret JSON uses stdin, never argv, shell history, a source file or config vars.
    child.stdin.end(input);
  });
}

async function api(route, body, user = actor) {
  const response = await lambda.send(new InvokeCommand({ FunctionName: deployment.FunctionName, InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ kind: 'api', method: body ? 'POST' : 'GET', path: route, user, body })) }), { abortSignal: AbortSignal.timeout(40_000) });
  check(!response.FunctionError, 'Lambda returned an unhandled failure.');
  const value = JSON.parse(new TextDecoder().decode(response.Payload));
  check(!JSON.stringify(value).includes(token), 'A private credential escaped the public API boundary.');
  return value;
}

async function ok(route, body, user) {
  const response = await api(route, body, user);
  check(response.status >= 200 && response.status < 300, `API request failed with HTTP ${Number(response.status)}.`);
  return response.body;
}

const partition = user => `ws_${createHash('sha256').update(user.userId).digest('hex').slice(0, 40)}`;
async function rowsFor(user) {
  const rows = []; let cursor;
  do {
    const page = await dynamo.send(new QueryCommand({ TableName: deployment.TableName, KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'pk' }, ExpressionAttributeValues: { ':pk': partition(user) },
      ConsistentRead: true, ExclusiveStartKey: cursor }), { abortSignal: AbortSignal.timeout(15_000) });
    rows.push(...page.Items ?? []); cursor = page.LastEvaluatedKey;
    check(rows.length < 1000, 'The isolated fixture workspace exceeded the cleanup limit.');
  } while (cursor);
  return rows;
}

async function cleanupWorkspace(user) {
  // Never scan a table or delete a caller-selected partition. These two IDs are
  // freshly generated above and must still belong to their exact synthetic actor.
  check([actor.userId, other.userId].includes(user.userId), 'Refusing cleanup outside this test run.');
  const rows = await rowsFor(user);
  const metadata = rows.find(row => row.sk === 'meta');
  check(!metadata || metadata.data.ownerId === user.userId, 'Refusing cleanup with mismatched workspace ownership.');
  for (let index = 0; index < rows.length; index += 25) {
    const chunk = rows.slice(index, index + 25);
    check(chunk.every(row => row.pk === partition(user)), 'Refusing cross-workspace cleanup.');
    let requests = chunk.map(row => ({ DeleteRequest: { Key: { pk: row.pk, sk: row.sk } } }));
    for (let attempt = 0; requests.length && attempt < 5; attempt++) {
      const response = await dynamo.send(new BatchWriteCommand({ RequestItems: { [deployment.TableName]: requests } }), { abortSignal: AbortSignal.timeout(15_000) });
      requests = response.UnprocessedItems?.[deployment.TableName] ?? [];
      if (requests.length) await sleep(250 * (attempt + 1));
    }
    check(!requests.length, 'Some isolated fixture records could not be removed.');
  }
  check((await rowsFor(user)).length === 0, 'Isolated workspace cleanup did not complete.');
  results.removedItems += rows.length;
}

try {
  for (const section of ['summary', 'order', 'tickets', 'delivery', 'history', 'support', 'attendance', 'policy']) {
    const request = new Request(`https://fixture.invalid/v1/cases/${externalCaseId}/evidence?section=${section}`, { headers: { Authorization: `Bearer ${token}` } });
    const response = await fixture.fetch(request, { FIXTURE_TOKEN: token });
    const body = await response.json();
    check(response.status === 200 && body.case_id === externalCaseId && body.section === section, 'Local fixture contract failed.');
    check(body.records[0].data.fields.fictional === true && !JSON.stringify(body).includes(token), 'Fixture evidence must be fictional and secret-free.');
    if (section === 'summary') check(body.mapping_verified && body.case.orderRef === body.records[0].data.fields.orderRef, 'Fixture mapping failed.');
    results.sections++;
  }
  check((await fixture.fetch(new Request('https://fixture.invalid/v1/cases/unapproved/evidence?section=summary', { headers: { Authorization: `Bearer ${token}` } }), { FIXTURE_TOKEN: token })).status === 403, 'Fixture must deny other cases.');
  check((await fixture.fetch(new Request(`https://fixture.invalid/v1/cases/${externalCaseId}/evidence?section=summary`), { FIXTURE_TOKEN: token })).status === 403, 'Fixture must deny missing credentials.');
  check((await fixture.fetch(new Request(`https://fixture.invalid/v1/cases/${externalCaseId}/evidence?section=summary`, { headers: { Authorization: `Bearer ${token}` } }), {})).status === 403, 'Fixture must fail closed before its secret exists.');
  stage = 'fixture bundle validation';
  await wrangler(['deploy', '--dry-run', '--outdir', path.join(directory, 'bundle')]);
  console.log('PASS: fictional fixture, eight sections, denied access and Worker bundle.');
  if (!dryRun) {
    loadAwsSession();
    deployment = JSON.parse(readFileSync(path.join(projectRoot, '.aws-build/deployment.json'), 'utf8'));
    check(deployment.FunctionName === 'causality-hackathon-backend' && deployment.region === 'us-east-1' && /^causality-hackathon-dev-/.test(deployment.TableName), 'This smoke test only targets the named hackathon development backend and table.');
    lambda = new LambdaClient({ region: deployment.region, maxAttempts: 1 });
    dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: deployment.region, maxAttempts: 2 }));
    stage = 'temporary fixture deployment';
    deploymentAttempted = true;
    const output = await wrangler(['deploy']);
    const baseUrl = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/g)?.find(value => new URL(value).hostname.startsWith(`${workerName}.`));
    check(baseUrl, 'The temporary Worker URL was not found in deployment output.');
    stage = 'fixture secret provisioning';
    await wrangler(['secret', 'bulk'], JSON.stringify({ FIXTURE_TOKEN: token }));
    stage = 'fixture readiness';
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await fetch(`${baseUrl}/v1/cases/${externalCaseId}/evidence?section=summary`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
        ready = response.status === 200; await response.body?.cancel();
        if (ready) break;
      } catch { /* A new workers.dev name can need a moment to propagate. */ }
      await sleep(1000);
    }
    check(ready, 'The temporary fixture did not become ready.');
    console.log('PASS: temporary public HTTPS fixture with private bearer secret.');
    stage = 'isolated AWS workspace setup';
    remoteWorkspaces = true;
    await ok('/api/workspace', { action: 'createWorkspace', name: 'Fictional managed connector smoke test' });
    await ok('/api/workspace', { action: 'createWorkspace', name: 'Fictional isolation check' }, other);
    stage = 'real HTTPS connector verification';
    const saved = await ok('/api/connectors/live', { action: 'connect', name: 'Fictional HTTPS fixture', baseUrl, externalCaseId, token });
    connectionId = saved.connection.id;
    check(saved.connection.status === 'connected', 'Connection verification did not succeed.');
    const list = await ok('/api/connectors/live');
    check(list.storage === 'aws' && list.connections.length === 1, 'Saved connection did not persist in AWS.');
    const privateRows = (await rowsFor(actor)).filter(row => JSON.stringify(row).includes(token));
    check(privateRows.length === 1 && privateRows[0].sk === `connector-credential#${connectionId}`, 'Only the separate private credential row may contain the bearer token.');
    for (const action of ['recheck', 'disconnect', 'import']) check((await api('/api/connectors/live', { action, connectionId }, other)).status === 404, 'A second workspace could access the connection.');
    check((await ok('/api/connectors/live', undefined, other)).connections.length === 0, 'The second workspace could list the connection.');
    stage = 'case import and recheck';
    const imported = await ok('/api/connectors/live', { action: 'import', connectionId }); caseId = imported.caseId;
    check((await ok('/api/connectors/live', { action: 'import', connectionId })).caseId === caseId, 'Repeated import must be idempotent.');
    const item = imported.state.cases.find(entry => entry.id === caseId);
    check(item?.source === 'merchant' && item.evidence.length > 0 && item.evidence.every(entry => entry.provenance.sourceMode === 'live'), 'The real HTTPS import did not preserve live-wire provenance.');
    await ok('/api/connectors/live', { action: 'recheck', connectionId });
    results.checks.push('https_verification', 'private_credential', 'workspace_isolation', 'idempotent_import', 'recheck');
    console.log('PASS: AWS connection registry, real HTTPS verification, import, isolation and credential separation.');
    if (!skipBedrock) {
      stage = 'real Bedrock investigation';
      const started = await api('/api/investigations', { action: 'start', caseId, mode: 'bedrock' });
      check(started.status === 202, 'AWS investigation could not start.'); runId = started.body.run.id;
      const deadline = Date.now() + 150_000; let run;
      while (Date.now() < deadline) {
        run = (await ok(`/api/investigations?caseId=${caseId}`)).run;
        if (run && run.status !== 'running') break;
        await sleep(1000);
      }
      check(run?.status === 'completed', 'The real Bedrock investigation did not complete.');
      const savedCase = (await ok('/api/workspace')).cases.find(entry => entry.id === caseId);
      check(savedCase?.draft?.method === 'bedrock' && savedCase.draft.status === 'draft', 'A reviewable Bedrock draft was not saved.');
      results.modelCalls = savedCase.draft.analysis.metrics.modelCalls;
      results.citations = savedCase.draft.analysis.evidenceIds.length;
      check(results.modelCalls > 0 && results.citations > 0 && savedCase.draft.analysis.evidenceIds.every(id => savedCase.evidence.some(entry => entry.id === id)), 'Bedrock output did not retain verified source citations.');
      results.checks.push('bedrock', 'verified_citations');
      console.log(`PASS: real Bedrock investigation, ${results.modelCalls} model calls and ${results.citations} verified citations.`);
    }
    stage = 'disconnection enforcement';
    check((await ok('/api/connectors/live', { action: 'disconnect', connectionId })).connection.status === 'disconnected', 'Disconnect did not persist.');
    for (const action of ['import', 'recheck']) check((await api('/api/connectors/live', { action, connectionId })).status === 409, 'A disconnected connection still allowed evidence access.');
    check((await api('/api/investigations', { action: 'start', caseId, mode: 'bedrock' })).status === 409, 'A disconnected case still allowed investigation.');
    check(!(await rowsFor(actor)).some(row => JSON.stringify(row).includes(token)), 'The disconnected credential was not deleted.');
    check((await ok('/api/workspace')).cases.some(entry => entry.id === caseId && entry.evidence.length), 'Disconnect removed previously imported evidence.');
    results.checks.push('disconnect', 'credential_deleted', 'subsequent_reads_blocked');
    console.log('PASS: disconnection deletes credentials, blocks future reads and retains imported evidence.');
  }
} catch (error) {
  failed = true;
  // No raw provider errors, response bodies, tokens or headers enter terminal logs.
  const detail = error instanceof Error && !error.message.includes(token) && (error.message.startsWith('API request failed with HTTP ') || error.message.startsWith('Wrangler command failed with exit status ')) ? ` ${error.message}` : '';
  console.error(`FAIL: ${stage}.${detail}`);
} finally {
  if (remoteWorkspaces) {
    try {
      if (runId) await api('/api/investigations', { action: 'cancel', runId });
      if (connectionId) await api('/api/connectors/live', { action: 'disconnect', connectionId });
      await cleanupWorkspace(actor); await cleanupWorkspace(other);
      console.log(`CLEANUP: removed ${results.removedItems} records from this run's two isolated AWS workspaces.`);
    } catch { cleanupFailed = true; console.error('CLEANUP FAILED: isolated AWS test records may remain.'); }
  }
  if (deploymentAttempted) {
    try { await wrangler(['delete', workerName]); console.log('CLEANUP: temporary fixture Worker deleted.'); }
    catch { cleanupFailed = true; console.error(`CLEANUP FAILED: delete only temporary Worker ${workerName} using ${configPath}.`); }
  }
  lambda?.destroy(); dynamo?.destroy();
  writeFileSync(path.join(projectRoot, '.aws-build/managed-connector-smoke.json'), JSON.stringify({
    verifiedAt: new Date().toISOString(), success: !failed && !cleanupFailed, dryRun, skippedBedrock: skipBedrock,
    fixture: workerName, workspaceIds: remoteWorkspaces ? [partition(actor), partition(other)] : [], stage, cleanupComplete: !cleanupFailed, ...results,
  }, null, 2) + '\n');
  if (!cleanupFailed) rmSync(directory, { recursive: true, force: true });
  if (failed || cleanupFailed) process.exitCode = 1;
}
