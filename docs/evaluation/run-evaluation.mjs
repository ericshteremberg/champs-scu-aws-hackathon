// Runs live Bedrock investigations over the three fictional ticket cases and saves raw results.
//
// Isolation: uses a throwaway synthetic user, so the cases live in a brand-new workspace and the
// shared team workspace is not touched. It does not approve, archive, or upload anything.
// Costs: each run makes real Amazon Bedrock calls. Requires current AWS credentials in us-east-1
// and .aws-build/deployment.json (FunctionName, region).
//
// Usage: node docs/evaluation/run-evaluation.mjs [ATM-1042 ATM-1043 ATM-1044]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LambdaClient, InvokeCommand, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

const deployment = JSON.parse(readFileSync('.aws-build/deployment.json', 'utf8'));
if (deployment.FunctionName !== 'causality-hackathon-backend' || deployment.region !== 'us-east-1') {
  throw new Error('This runner targets only the named hackathon development backend.');
}
const client = new LambdaClient({ region: deployment.region });
const stamp = crypto.randomUUID();
const user = { userId: `eval-${stamp}`, email: 'synthetic-evaluator@example.test', displayName: 'Synthetic evaluation run' };

async function api(path, body) {
  const response = await client.send(new InvokeCommand({
    FunctionName: deployment.FunctionName,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({ kind: 'api', method: body ? 'POST' : 'GET', path, user, body })),
  }));
  if (response.FunctionError) throw new Error(`Lambda error: ${new TextDecoder().decode(response.Payload)}`);
  return JSON.parse(new TextDecoder().decode(response.Payload));
}

async function waitRun(caseId, deadline = 240000) {
  const start = Date.now();
  while (Date.now() - start < deadline) {
    const value = await api(`/api/investigations?caseId=${encodeURIComponent(caseId)}`);
    if (value.status !== 200) throw new Error(`Status poll failed: ${JSON.stringify(value)}`);
    if (value.body.run && value.body.run.status !== 'running') return value.body.run;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Investigation did not finish before the deadline');
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['ATM-1042', 'ATM-1043', 'ATM-1044'];
const config = await client.send(new GetFunctionConfigurationCommand({ FunctionName: deployment.FunctionName }));
const appCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();

let value = await api('/api/workspace', { action: 'createWorkspace', name: 'Evaluation run (synthetic)' });
if (value.status !== 200) throw new Error(`createWorkspace failed: ${JSON.stringify(value)}`);
value = await api('/api/workspace', { action: 'seedDemo' });
if (value.status !== 200) throw new Error(`seedDemo failed: ${JSON.stringify(value)}`);
const seeded = value.body;

mkdirSync('docs/evaluation/runs', { recursive: true });
for (const order of wanted) {
  const item = seeded.cases.find(entry => entry.orderRef === order);
  if (!item) throw new Error(`Case ${order} not found`);
  const startedAt = new Date().toISOString();
  value = await api('/api/investigations', { action: 'start', caseId: item.id, mode: 'bedrock' });
  if (value.status !== 202) throw new Error(`start failed for ${order}: ${JSON.stringify(value)}`);
  const run = await waitRun(item.id);
  const state = (await api('/api/workspace')).body;
  const saved = state.cases.find(entry => entry.id === item.id);
  const out = {
    order,
    caseId: item.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    repoCommit: appCommit,
    backendLambda: { name: deployment.FunctionName, lastModified: config.LastModified, codeSha256: config.CodeSha256 },
    inputProvenance: 'synthetic fixture (lib/ticket-demo.ts) seeded into a fresh throwaway workspace',
    run,
    draft: saved.draft,
    evidence: saved.evidence,
  };
  const file = `docs/evaluation/runs/${order}-${run.id}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`${order}: run ${run.id} -> ${run.status}; method=${saved.draft?.method}; assessment=${saved.draft?.analysis?.assessment}; saved ${file}`);
}
