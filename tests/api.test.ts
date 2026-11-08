import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { BedrockRuntimeClient, type ConverseCommand, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { buildDemoReport } from '../server/report.js';
import { demoCases, getDemoEvidence } from '../server/fixtures.js';
import { EVIDENCE_SECTIONS, type InvestigationRun } from '../shared/types.js';

const resources: Array<{ server: Server; close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.close();
    await new Promise<void>((resolve, reject) => resource.server.close(error => error ? reject(error) : resolve()));
  }
  vi.restoreAllMocks();
});

async function workspace(env: NodeJS.ProcessEnv = {}) {
  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: ':memory:', DEMO_STEP_MS: '0', ...env }));
  const server = await new Promise<Server>(resolve => {
    const listening = runtime.app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  resources.push({ server, close: runtime.close });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: unknown, headers?: Record<string, string>) => fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function completed(id: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const { run } = await (await request(`/api/runs/${id}`)).json() as { run: InvestigationRun };
      if (run.status !== 'running') return run;
      await delay(10);
    }
    throw new Error('Investigation did not settle');
  }
  return { request, completed, ...runtime };
}

describe('case investigation API', () => {
  it.each([
    ['case_atm_1042', 'supported'], ['case_atm_1043', 'mixed'], ['case_atm_1044', 'insufficient'],
  ])('investigates %s without mixing source records', async (caseId, assessment) => {
    const api = await workspace();
    const response = await api.request(`/api/cases/${caseId}/investigate`, {});
    expect(response.status).toBe(202);
    const { run: started } = await response.json();
    const run = await api.completed(started.id);
    expect(run.status).toBe('completed');
    expect(run.mode).toBe('demo');
    expect(run.report?.assessment).toBe(assessment);
    expect(run.evidence).toHaveLength(EVIDENCE_SECTIONS.length);
    expect(run.evidence.every(section => section.caseId === caseId && section.sourceMode === 'synthetic')).toBe(true);
    const retrieved = new Set(run.evidence.flatMap(section => section.records.map(record => record.id)));
    expect(run.report?.findings.every(finding => finding.evidenceIds.every(id => retrieved.has(id)))).toBe(true);
    expect(run.report?.gaps.some(gap => gap.includes('nonattendance'))).toBe(true);
    const selected = await (await api.request(`/api/cases/${caseId}`)).json();
    expect(selected.case.status).toBe('ready');
    expect(selected.latestRun.id).toBe(run.id);
  });

  it('requires matching human review and preserves the edited response in both exports', async () => {
    const api = await workspace();
    const { run: started } = await (await api.request('/api/cases/case_atm_1042/investigate', {})).json();
    const run = await api.completed(started.id);
    expect((await api.request(`/api/cases/case_atm_1042/export?runId=${run.id}`)).status).toBe(409);
    expect((await api.request('/api/cases/case_atm_1043/review', { runId: run.id, responseDraft: run.report!.responseDraft })).status).toBe(404);
    expect((await api.request('/api/cases/case_atm_1042/review', { runId: run.id, responseDraft: 'Customer entered. [fabricated-record]' })).status).toBe(422);
    const edited = `${run.report!.responseDraft}\n\nReviewed by the event organizer.`;
    const review = await api.request('/api/cases/case_atm_1042/review', { runId: run.id, responseDraft: edited, reviewerNote: 'Checked the matched conversation.' });
    expect(review.status).toBe(200);
    const markdown = await api.request(`/api/cases/case_atm_1042/export?runId=${run.id}&format=markdown`);
    expect(markdown.headers.get('content-disposition')).toContain('attachment');
    expect(await markdown.text()).toContain('Reviewed by the event organizer.');
    const packet = await (await api.request(`/api/cases/case_atm_1042/export?runId=${run.id}&format=json`)).json();
    expect(packet.report.responseDraft).toBe(edited);
    expect(packet.case.sourceMode).toBe('synthetic');
    expect(packet.evidence.every((section: { caseId: string }) => section.caseId === run.caseId)).toBe(true);
    expect((await api.request(`/api/cases/case_atm_1043/export?runId=${run.id}`)).status).toBe(404);
    expect((await api.request(`/api/cases/case_atm_1042/export?format=exe`)).status).toBe(400);
  });

  it('stops real pending retrieval, rejects duplicate runs, and allows a later restart', async () => {
    const api = await workspace({ DEMO_STEP_MS: '80' });
    const { run: started } = await (await api.request('/api/cases/case_atm_1042/investigate', {})).json();
    expect((await api.request('/api/cases/case_atm_1042/investigate', {})).status).toBe(409);
    const { run: stopped } = await (await api.request(`/api/runs/${started.id}/stop`, {})).json();
    expect(stopped.status).toBe('stopped');
    const count = stopped.events.length;
    await delay(130);
    const saved = await api.completed(started.id);
    expect(saved.events).toHaveLength(count);
    expect(saved.evidence).toHaveLength(0);
    expect(saved.report).toBeUndefined();
    expect((await api.request('/api/cases/case_atm_1042/investigate', {})).status).toBe(202);
  });

  it('does not expose secret configuration and returns JSON for unknown API paths', async () => {
    const api = await workspace({ APP_ACCESS_TOKEN: 'operator-test-token-that-is-long-enough', MERCHANT_EVIDENCE_URL: 'https://merchant.example', MERCHANT_EVIDENCE_TOKEN: 'merchant-secret-test-only' });
    const config = await (await api.request('/api/config')).text();
    expect(config).not.toContain('merchant-secret-test-only');
    expect(config).not.toContain('operator-test-token');
    expect(JSON.parse(config).authRequired).toBe(true);
    expect((await api.request('/api/cases')).status).toBe(401);
    const login = await api.request('/api/session', { token: 'operator-test-token-that-is-long-enough' });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const headers = { Cookie: cookie.split(';')[0] };
    expect((await api.request('/api/cases', undefined, headers)).status).toBe(200);
    expect((await api.request('/api/cases/case_atm_1042/investigate', {}, { ...headers, Origin: 'https://untrusted.example' })).status).toBe(403);
    const unknown = await api.request('/api/no-such-route', undefined, headers);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });

  it('rejects public startup without an operator credential', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow('APP_ACCESS_TOKEN');
    expect(() => loadConfig({ INVESTIGATION_MODE: 'bedrock' })).toThrow('BEDROCK_MODEL_ID');
  });

  it('fails visibly when Bedrock is unavailable instead of using sample conclusions', async () => {
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockRejectedValue(Object.assign(new Error('Access denied'), { name: 'AccessDeniedException' }));
    const api = await workspace({ INVESTIGATION_MODE: 'bedrock', BEDROCK_MODEL_ID: 'test-model' });
    const { run: started } = await (await api.request('/api/cases/case_atm_1042/investigate', {})).json();
    const run = await api.completed(started.id);
    expect(run.status).toBe('failed');
    expect(run.mode).toBe('bedrock');
    expect(run.error).toContain('AccessDeniedException');
    expect(run.report).toBeUndefined();
  });

  it('executes Bedrock tool requests, rejects scope expansion, and validates the final report', async () => {
    let sequence = 0;
    const selected = demoCases[0];
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation((async (command: ConverseCommand) => {
      sequence++;
      const received = command.input.messages?.flatMap(message => message.content?.flatMap(block => block.toolResult?.content?.flatMap(content => {
        const json = content.json as unknown as { section?: string };
        return json?.section ? [json.section] : [];
      }) || []) || []) || [];
      const section = EVIDENCE_SECTIONS.find(value => !received.includes(value));
      const tool = sequence === 1
        ? { name: 'get_evidence', input: { section: 'order', caseId: 'case_atm_1043' } }
        : section ? { name: 'get_evidence', input: { section } }
          : { name: 'finish_report', input: buildDemoReport(selected, EVIDENCE_SECTIONS.map(value => getDemoEvidence(selected.id, value))) };
      return { $metadata: {}, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, metrics: { latencyMs: 1 }, output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: `tool_${sequence}`, name: tool.name, input: JSON.parse(JSON.stringify(tool.input)) } }] } }, stopReason: 'tool_use' } satisfies ConverseCommandOutput;
    }) as never);
    const api = await workspace({ INVESTIGATION_MODE: 'bedrock', BEDROCK_MODEL_ID: 'test-model' });
    const { run: started } = await (await api.request('/api/cases/case_atm_1042/investigate', {})).json();
    const run = await api.completed(started.id);
    expect(run.status).toBe('completed');
    expect(run.events.some(event => event.type === 'blocked')).toBe(true);
    expect(run.events.some(event => event.type === 'model_requested')).toBe(true);
    expect(run.evidence.every(section => section.caseId === selected.id)).toBe(true);
    expect(run.report?.assessment).toBe('supported');
    expect(sequence).toBeGreaterThan(2);
  });
});
