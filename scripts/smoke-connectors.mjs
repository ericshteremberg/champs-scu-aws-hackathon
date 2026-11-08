import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { loadAwsSession } from './load-aws-session.mjs';

// Explicitly writes fictional configuration and cases to isolated AWS test workspaces.
loadAwsSession();
const deployment = JSON.parse(readFileSync('.aws-build/deployment.json', 'utf8'));
assert.equal(deployment.FunctionName, 'causality-hackathon-backend');
assert.equal(deployment.region, 'us-east-1');
const client = new LambdaClient({ region: deployment.region });
const stamp = crypto.randomUUID();
const actor = { userId: `connector-smoke-${stamp}`, email: 'synthetic-connector@example.test', displayName: 'Connector verification' };
const other = { userId: `connector-other-${stamp}`, email: 'other-connector@example.test', displayName: 'Other workspace' };
async function api(path, body, user = actor) {
  const response = await client.send(new InvokeCommand({ FunctionName: deployment.FunctionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ kind: 'api', method: body ? 'POST' : 'GET', path, user, body })) }));
  assert.equal(response.FunctionError, undefined);
  return JSON.parse(new TextDecoder().decode(response.Payload));
}
async function ok(path, body, user) {
  const result = await api(path, body, user);
  assert.ok(result.status >= 200 && result.status < 300, `${path}: ${JSON.stringify(result)}`);
  return result.body;
}
await ok('/api/workspace', { action: 'createWorkspace', name: 'Synthetic connector verification' });
await ok('/api/workspace', { action: 'createWorkspace', name: 'Other connector verification' }, other);
const list = await ok('/api/connectors');
assert.equal(list.storage, 'aws'); assert.equal(list.templates.length, 2);
const results = [];
for (const template of list.templates) {
  const { preview } = await ok('/api/connectors', { action: 'preview', templateId: template.id, manifest: template.manifest });
  assert.equal(preview.sourceMode, 'synthetic');
  assert.ok(preview.checks.length > 0 && preview.checks.every(check => check.passed));
  const { connection } = await ok('/api/connectors', { action: 'save', name: `Verification ${template.name}`, templateId: template.id, manifest: template.manifest });
  assert.equal(connection.status, 'demo_ready');
  assert.equal((await api('/api/connectors', { action: 'import_demo', connectionId: connection.id }, other)).status, 404);
  assert.equal((await api(`/api/connectors/install?connectionId=${connection.id}`, undefined, other)).status, 404);
  const files = await ok(`/api/connectors/install?connectionId=${connection.id}`);
  assert.ok(files.files.some(file => file.name === 'manifest.json'));
  const { caseId, state } = await ok('/api/connectors', { action: 'import_demo', connectionId: connection.id });
  assert.equal((await ok('/api/connectors', { action: 'import_demo', connectionId: connection.id })).caseId, caseId);
  const imported = state.cases.find(item => item.id === caseId);
  assert.equal(imported.source, 'demo');
  assert.ok(imported.evidence.every(item => item.provenance.sourceMode === 'synthetic'));
  const started = await api('/api/investigations', { action: 'start', caseId, mode: 'bedrock' });
  assert.equal(started.status, 202);
  const deadline = Date.now() + 150_000;
  let run;
  while (Date.now() < deadline) {
    run = (await ok(`/api/investigations?caseId=${caseId}`)).run;
    if (run && run.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(run?.status, 'completed', JSON.stringify(run));
  const saved = (await ok('/api/workspace')).cases.find(item => item.id === caseId);
  assert.equal(saved.draft.method, 'bedrock'); assert.equal(saved.draft.status, 'draft');
  assert.ok(saved.draft.analysis.metrics.modelCalls > 0);
  assert.ok(saved.draft.analysis.evidenceIds.length > 0);
  assert.ok(saved.draft.analysis.evidenceIds.every(id => saved.evidence.some(record => record.id === id)));
  await ok('/api/connectors', { action: 'revoke', connectionId: connection.id });
  assert.equal((await api('/api/connectors', { action: 'import_demo', connectionId: connection.id })).status, 409);
  assert.equal((await api(`/api/connectors/install?connectionId=${connection.id}`)).status, 409);
  results.push({ template: template.id, caseId, runId: run.id, modelCalls: saved.draft.analysis.metrics.modelCalls, citations: saved.draft.analysis.evidenceIds.length });
  console.log(`PASS: ${template.id}, scoped preview, DynamoDB configuration, isolation, installation files, real Bedrock investigation, and revocation.`);
}
writeFileSync('.aws-build/connector-smoke.json', `${JSON.stringify({ verifiedAt: new Date().toISOString(), backend: deployment.FunctionName, results }, null, 2)}\n`);
