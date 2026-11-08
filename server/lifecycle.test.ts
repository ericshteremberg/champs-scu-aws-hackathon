import { afterEach, describe, expect, it, vi } from 'vitest';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { S3Client } from '@aws-sdk/client-s3';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { demoCases, getDemoEvidence } from './fixtures.js';
import { Store } from './store.js';
import { HttpError } from './errors.js';
import { buildDemoReport, finalizeReport } from './report.js';
import { EVIDENCE_SECTIONS, type CaseRecord, type InvestigationRun } from '../shared/types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });

async function workspace(env: NodeJS.ProcessEnv = {}, seeds = demoCases) {
  const store = new Store(':memory:', seeds);
  const scope = createApp(loadConfig({ DEMO_STEP_MS: '0', ...env }), store);
  const server: Server = await new Promise(resolve => { const server = scope.app.listen(0, '127.0.0.1', () => resolve(server)); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local test server.');
  cleanups.push(async () => { await scope.close(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  return { ...scope, base: `http://127.0.0.1:${address.port}` };
}

function seedReport(store: Store) {
  const item = structuredClone(demoCases[0]);
  const run: InvestigationRun = { id: 'review_run', caseId: item.id, status: 'completed', mode: 'demo', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), events: [], evidence: EVIDENCE_SECTIONS.map(section => getDemoEvidence(item.id, section)) };
  const input = buildDemoReport(item, run.evidence);
  input.findings = input.findings.slice(0, 1);
  input.responseDraft = `The payment record is available. [${input.findings[0].evidenceIds[0]}]`;
  run.report = finalizeReport(input, run);
  item.latestRunId = run.id; item.status = 'ready'; store.saveCase(item); store.saveRun(run);
  return { item, run };
}

describe('review and archive lifecycle', () => {
  it('refreshes the evidence index when the reviewer adds another retrieved citation', async () => {
    const app = await workspace();
    const { item, run } = seedReport(app.store);
    const added = run.evidence.flatMap(section => section.records).find(record => !run.report!.evidenceIds.includes(record.id))!;
    const response = await fetch(`${app.base}/api/cases/${item.id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.id, responseDraft: `${run.report!.responseDraft}\n${added.detail} [${added.id}]` }) });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.run.report.evidenceIds).toContain(added.id);
    expect(app.store.getRun(run.id)!.report!.evidenceIds).toContain(added.id);
  });

  it('keeps GET exports read-only and archives identical reviewed packets under the same S3 key', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const app = await workspace({ S3_EVIDENCE_BUCKET: 'casework-test-bucket' });
    const { item, run } = seedReport(app.store);
    run.report!.reviewedAt = '2026-11-07T20:00:00.000Z'; app.store.saveRun(run);
    expect((await fetch(`${app.base}/api/cases/${item.id}/export?format=json&runId=${run.id}`)).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    const archive = async () => {
      const response = await fetch(`${app.base}/api/cases/${item.id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.id }) });
      expect(response.status).toBe(200);
      return response.json();
    };
    const first = await archive(); const second = await archive();
    expect(first.key).toBe(second.key);
    expect(first.sha256).toHaveLength(64);
    expect(send).toHaveBeenCalledTimes(2);
    const command = send.mock.calls[0][0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({ Bucket: 'casework-test-bucket', ServerSideEncryption: 'AES256', ContentType: 'application/json' });
  });

  it('checks live summary mapping before returning a model-selected delivery section', async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockResolvedValue({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'delivery_first', name: 'get_evidence', input: { section: 'delivery' } } }] } } } as never);
    const item: CaseRecord = { ...demoCases[0], sourceMode: 'live' };
    const app = await workspace({ INVESTIGATION_MODE: 'bedrock', BEDROCK_MODEL_ID: 'test-model' }, [item]);
    const read = vi.spyOn(app.investigator.provider, 'read').mockRejectedValue(new HttpError(502, 'The merchant mapping changed.', 'MAPPING_MISMATCH'));
    const run = app.investigator.start(item);
    await vi.waitFor(() => expect(app.store.getRun(run.id)!.status).toBe('failed'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]).toBe('summary');
    expect(app.store.getRun(run.id)!.evidence).toEqual([]);
  });

  it('drains cancelled investigations without persisting a late source response', async () => {
    const app = await workspace();
    let resolveRead!: (value: ReturnType<typeof getDemoEvidence>) => void;
    vi.spyOn(app.investigator.provider, 'read').mockImplementation(() => new Promise(resolve => { resolveRead = resolve; }));
    const run = app.investigator.start(structuredClone(demoCases[0]));
    const closing = app.investigator.shutdown();
    resolveRead(getDemoEvidence(demoCases[0].id, 'summary'));
    await closing;
    const saved = app.store.getRun(run.id)!;
    expect(saved.status).toBe('stopped');
    expect(saved.evidence).toEqual([]);
    expect(saved.events.at(-1)?.type).toBe('stopped');
  });
});
