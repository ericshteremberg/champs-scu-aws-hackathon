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
import { createHash } from 'node:crypto';
import { LambdaClient, InvokeCommand, GetFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

const deployment = JSON.parse(readFileSync('.aws-build/deployment.json', 'utf8'));
if (deployment.FunctionName !== 'causality-hackathon-backend' || deployment.InvestigatorFunctionName !== 'causality-hackathon-investigator' || deployment.region !== 'us-east-1') {
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
if (wanted.some(order => !['ATM-1042', 'ATM-1043', 'ATM-1044'].includes(order))) throw new Error('Select only the three fictional ticket cases.');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const appCommit = git(['rev-parse', 'HEAD']);
const sourceFiles = git(['ls-files', 'aws', 'lib/investigation', 'lib/domain.ts', 'lib/ticket-demo.ts', 'package.json', 'package-lock.json', 'scripts/build-aws.mjs']).split('\n').filter(Boolean);
const sourceHash = createHash('sha256');
for (const file of sourceFiles) sourceHash.update(file + '\0').update(readFileSync(file)).update('\0');
const localSource = {
  commit: appCommit, sourceTreeSha256: sourceHash.digest('hex'),
  hashMethod: 'SHA-256 of sorted tracked path + NUL + working file bytes + NUL', files: sourceFiles,
  applicationDiff: git(['diff', 'HEAD', '--', ...sourceFiles]),
};
// Whitelist metadata; GetFunctionConfiguration also returns environment secrets.
async function artifacts() {
  const read = async name => {
    const config = await client.send(new GetFunctionConfigurationCommand({ FunctionName: name }));
    return { name, lastModified: config.LastModified, codeSha256: config.CodeSha256, revisionId: config.RevisionId, version: config.Version };
  };
  const [api, investigator] = await Promise.all([read(deployment.FunctionName), read(deployment.InvestigatorFunctionName)]);
  return { api, investigator };
}

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
  const before = await artifacts();
  value = await api('/api/investigations', { action: 'start', caseId: item.id, mode: 'bedrock' });
  if (value.status !== 202) throw new Error(`start failed for ${order}: ${JSON.stringify(value)}`);
  const run = await waitRun(item.id);
  const state = (await api('/api/workspace')).body;
  const saved = state.cases.find(entry => entry.id === item.id);
  const after = await artifacts();
  const deploymentStable = JSON.stringify(before) === JSON.stringify(after);
  const out = {
    order,
    caseId: item.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    repoCommit: appCommit,
    backendLambda: before.api,
    backendArtifacts: { before, after, deploymentStable },
    localSource,
    backendSourceCommitVerified: false,
    sourceMappingNote: 'Local source fingerprint is not proof of deployed source. Both Lambda artifacts are recorded; establish source mapping from a verified deployment record before claiming a post-fix rerun.',
    inputProvenance: 'synthetic fixture (lib/ticket-demo.ts) seeded into a fresh throwaway workspace',
    run,
    draft: saved.draft,
    evidence: saved.evidence,
  };
  const file = `docs/evaluation/runs/${order}-${run.id}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`${order}: run ${run.id} -> ${run.status}; method=${saved.draft?.method}; assessment=${saved.draft?.analysis?.assessment}; saved ${file}`);
  if (!deploymentStable) throw new Error(`Deployment changed during ${run.id}; result saved for diagnosis, not a stable release evaluation.`);
  if (run.status !== 'completed' || !saved.draft || saved.draft.method !== 'bedrock') throw new Error(`Investigation failed for ${order}; raw result saved.`);
}
