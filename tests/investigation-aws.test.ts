import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConflictError, type CaseDoc, type DraftDoc, type Stored, type StoreChange, type TrustedUser } from '../aws/types.ts';

const state = vi.hoisted(() => ({ items: new Map<string, Stored<unknown>>() }));
vi.mock('../aws/store.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../aws/store.ts')>();
  return { ...actual,
    getItem: vi.fn(async (wid: string, key: string) => structuredClone(state.items.get(`${wid}/${key}`) || null)),
    queryItems: vi.fn(async (wid: string, prefix: string, options: { maxItems?: number } = {}) => {
      const rows = [...state.items.entries()].filter(([key]) => key.startsWith(`${wid}/${prefix}`)).map(([, value]) => structuredClone(value)).sort((a, b) => a.key.localeCompare(b.key));
      if (rows.length > (options.maxItems ?? 5000)) throw new Error('Query limit');
      return rows;
    }),
    commit: vi.fn(async (wid: string, changes: StoreChange[]) => {
      for (const change of changes) if ((state.items.get(`${wid}/${change.key}`)?.version ?? null) !== change.expectedVersion) throw new ConflictError();
      for (const change of changes) {
        if (change.check) continue;
        if (change.delete) state.items.delete(`${wid}/${change.key}`);
        else state.items.set(`${wid}/${change.key}`, { key: change.key, version: (change.expectedVersion ?? 0) + 1, data: structuredClone(change.data) });
      }
    }),
  };
});
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: vi.fn(async () => ({ url: 'https://private.s3.us-east-1.amazonaws.com', fields: { key: 'pending-key', policy: 'signed-policy' } })) }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://private.s3.us-east-1.amazonaws.com/signed-download') }));

import { commit, getItem, keys, workspaceIdForUser } from '../aws/store.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { cancelInvestigation, getLatestInvestigation, importMerchantCase, importManagedMerchantCase, processInvestigation, startInvestigation, type RunDoc } from '../aws/investigations.ts';
import { archiveApprovedCase, completeUpload, getDownload, prepareUpload } from '../aws/files.ts';
import { executeManagedConnectorAction } from '../aws/managed-connectors.ts';
import * as network from '../aws/merchant-network.ts';
import { normalizeMerchantSection } from '../lib/investigation/merchant.ts';
import type { EvidenceSection } from '../lib/investigation/types.ts';

const user: TrustedUser = { userId: 'owner-one', email: 'owner@example.test', displayName: 'Owner' };
const other: TrustedUser = { userId: 'owner-two', email: 'other@example.test', displayName: 'Other' };
const wid = workspaceIdForUser(user.userId);
let caseId: string;

beforeEach(async () => {
  state.items.clear(); vi.clearAllMocks();
  vi.stubEnv('AWS_REGION', 'us-east-1'); vi.stubEnv('FUNCTION_NAME', 'causality-test'); vi.stubEnv('EVIDENCE_BUCKET', 'private-test'); vi.stubEnv('BEDROCK_MODEL_ID', 'test-model');
  vi.spyOn(LambdaClient.prototype, 'send').mockResolvedValue({ StatusCode: 202 } as never);
  await executeAction(user, { action: 'createWorkspace', name: 'Test workspace' });
  await executeAction(user, { action: 'seedDemo' });
  await executeAction(other, { action: 'createWorkspace', name: 'Other workspace' });
  const workspace = await getWorkspaceState(user);
  caseId = workspace.cases.find(item => item.orderRef === 'ATM-1042')!.id;
});

describe('managed live connections used by the AWS harness', () => {
  const token = 'test-case-token-with-at-least-32-characters';
  const externalCaseId = 'approved-case';
  const timestamp = '2026-11-07T10:00:00Z';
  let connectionId: string;
  function section(name: EvidenceSection = 'summary', paymentRef = 'PAYMENT-1') {
    return normalizeMerchantSection({
      case_id: externalCaseId, section: name, source_mode: 'live', fetched_at: timestamp, status: 'available',
      records: [{ evidence_id: `${name}-record`, source: 'Test merchant', source_id: `${name}-source`, occurred_at: timestamp,
        data: { title: `${name} record`, detail: 'Fictional integration-test evidence.', fields: { paymentRef, orderRef: 'ORDER-1' } } }], limitations: [],
      ...(name === 'summary' ? { mapping_verified: true, case: { id: externalCaseId, merchantId: 'merchant-1', merchantName: 'Fictional merchant', customerLabel: 'Test customer', claim: 'Ticket not received', reason: 'Ticket not received', amount: 5000, currency: 'USD', eventName: 'Test event', purchasedAt: timestamp, openedAt: timestamp, dueAt: timestamp, sourceMode: 'live', summary: 'Test summary', orderRef: 'ORDER-1', paymentRef, tags: [] } } : {}),
    }, externalCaseId, name);
  }
  async function connect(owner = user) {
    return (await executeManagedConnectorAction(owner, { action: 'connect', name: 'Test connector', baseUrl: 'https://merchant.example.com', token, externalCaseId })).connection.id;
  }
  async function disconnect() { await executeManagedConnectorAction(user, { action: 'disconnect', connectionId }); }
  function model() {
    return vi.spyOn(BedrockRuntimeClient.prototype, 'send')
      .mockResolvedValueOnce({ output: { message: { role: 'assistant', content: ['order', 'tickets', 'delivery', 'support'].map(name => ({ toolUse: { toolUseId: name, name: 'get_evidence', input: { section: name } } })) } }, stopReason: 'tool_use' } as never)
      .mockResolvedValueOnce({ output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 'finish', name: 'finish_report', input: { content: 'The approved payment maps to this order. [E1]', summary: 'Review the available evidence.', assessment: 'mixed', recommendation: 'Review before submitting.', findings: [{ kind: 'supported', title: 'Payment mapping', detail: 'The summary identifies the approved payment and order.', evidenceIds: ['E1'] }], gaps: ['Cardholder receipt remains unverified.'] } } }] } }, stopReason: 'tool_use' } as never);
  }
  beforeEach(async () => {
    vi.stubEnv('MERCHANT_EVIDENCE_URL', ''); vi.stubEnv('MERCHANT_EVIDENCE_TOKEN', ''); vi.stubEnv('MERCHANT_WORKSPACE_ID', '');
    vi.spyOn(network, 'verifyPublicMerchantConnection').mockResolvedValue(section());
    vi.spyOn(network, 'fetchPublicMerchantSection').mockImplementation(async (_config, _id, name) => section(name));
    connectionId = await connect();
  });
  it('imports only its approved case without operator environment settings and preserves existing edits on repeat import', async () => {
    caseId = await importManagedMerchantCase(user, connectionId);
    expect(network.fetchPublicMerchantSection).toHaveBeenCalledWith({ baseUrl: 'https://merchant.example.com', token }, externalCaseId, 'summary', expect.any(AbortSignal));
    expect((await getItem<CaseDoc>(wid, keys.case(caseId)))?.data.merchantConnectionId).toBe(connectionId);
    await executeAction(user, { action: 'updateCase', caseId, title: 'Human title' });
    expect(await importManagedMerchantCase(user, connectionId)).toBe(caseId);
    expect((await getWorkspaceState(user)).cases.find(item => item.id === caseId)?.title).toBe('Human title');
    expect(network.fetchPublicMerchantSection).toHaveBeenCalledTimes(1);
    await expect(importManagedMerchantCase(other, connectionId)).rejects.toMatchObject({ status: 404 });
    const anotherId = await connect();
    expect(await importManagedMerchantCase(user, anotherId)).not.toBe(caseId);
    expect(JSON.stringify(await getWorkspaceState(user))).not.toContain(token);
  });
  it('runs the actual harness with case-scoped retrieval and never puts the token in model input or public state', async () => {
    caseId = await importManagedMerchantCase(user, connectionId);
    const invoke = model();
    const run = await startInvestigation(user, caseId, 'bedrock'); await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('completed');
    expect((await draft())?.data.content).toContain('approved payment');
    expect(network.fetchPublicMerchantSection).toHaveBeenCalledTimes(6);
    expect(vi.mocked(network.fetchPublicMerchantSection).mock.calls.every(([, approved]) => approved === externalCaseId)).toBe(true);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain(token);
    expect(JSON.stringify(await getWorkspaceState(user))).not.toContain(token);
    expect(JSON.stringify(await getLatestInvestigation(user, caseId))).not.toContain(token);
  });
  it('blocks changed payment mapping before import and before any model request', async () => {
    vi.mocked(network.fetchPublicMerchantSection).mockResolvedValueOnce(section('summary', 'OTHER-PAYMENT'));
    await expect(importManagedMerchantCase(user, connectionId)).rejects.toMatchObject({ code: 'merchant_mapping_changed' });
    caseId = await importManagedMerchantCase(user, connectionId);
    vi.mocked(network.fetchPublicMerchantSection).mockResolvedValueOnce(section('summary', 'OTHER-PAYMENT'));
    const invoke = model();
    const run = await startInvestigation(user, caseId, 'bedrock'); await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('failed');
    expect(invoke).not.toHaveBeenCalled(); expect(await draft()).toBeNull();
  });
  it('does not import if disconnect happens while evidence is in flight', async () => {
    vi.mocked(network.fetchPublicMerchantSection).mockImplementationOnce(async () => { await disconnect(); return section(); });
    await expect(importManagedMerchantCase(user, connectionId)).rejects.toMatchObject({ code: 'connector_disconnected' });
    expect((await getWorkspaceState(user)).cases.some(item => item.source === 'merchant')).toBe(false);
  });
  it('blocks queued and future investigations after disconnect without falling back to an operator endpoint', async () => {
    caseId = await importManagedMerchantCase(user, connectionId);
    const run = await startInvestigation(user, caseId, 'bedrock');
    vi.stubEnv('MERCHANT_EVIDENCE_URL', 'https://legacy.example.com'); vi.stubEnv('MERCHANT_EVIDENCE_TOKEN', 'other-token'); vi.stubEnv('MERCHANT_WORKSPACE_ID', wid);
    await disconnect();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const invoke = model();
    await job(run.id);
    await expect(startInvestigation(user, caseId, 'bedrock')).rejects.toMatchObject({ code: 'connector_disconnected' });
    await expect(importManagedMerchantCase(user, connectionId)).rejects.toMatchObject({ code: 'connector_disconnected' });
    expect(fetcher).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled(); expect(await draft()).toBeNull();
  });
  it('discards evidence that returns after disconnection', async () => {
    caseId = await importManagedMerchantCase(user, connectionId);
    vi.mocked(network.fetchPublicMerchantSection).mockImplementationOnce(async () => { await disconnect(); return section(); });
    const invoke = model(); const run = await startInvestigation(user, caseId, 'bedrock'); await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('failed');
    expect(invoke).not.toHaveBeenCalled(); expect(await draft()).toBeNull();
  });
  it('conditionally blocks publication when disconnect races with the final draft transaction', async () => {
    caseId = await importManagedMerchantCase(user, connectionId);
    model(); const run = await startInvestigation(user, caseId, 'bedrock');
    const apply = vi.mocked(commit).getMockImplementation()!;
    vi.mocked(commit).mockImplementation(async (workspaceId, changes) => {
      if (changes.some(change => change.key === keys.draft(caseId) && 'data' in change)) await disconnect();
      return apply(workspaceId, changes);
    });
    try {
      await job(run.id);
      expect((await getLatestInvestigation(user, caseId))?.status).toBe('stale');
      expect(await draft()).toBeNull();
    } finally { vi.mocked(commit).mockImplementation(apply); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function job(runId: string) { return processInvestigation({ workspaceId: wid, caseId, runId }); }
async function draft() { return getItem<DraftDoc>(wid, keys.draft(caseId)); }

describe('AWS durable investigations', () => {
  it('queues work asynchronously, saves a cited sample draft, and skips duplicate worker deliveries', async () => {
    const run = await startInvestigation(user, caseId, 'sample');
    expect(run.status).toBe('running');
    expect((await getItem<RunDoc>(wid, keys.run(run.id)))?.data.status).toBe('queued');
    expect(await draft()).toBeNull();
    const calls = vi.mocked(LambdaClient.prototype.send).mock.calls;
    expect(JSON.parse(Buffer.from((calls[0][0] as { input: { Payload: Uint8Array } }).input.Payload).toString())).toEqual({ kind: 'investigation', workspaceId: wid, caseId, runId: run.id });
    await job(run.id);
    const completed = await getLatestInvestigation(user, caseId);
    expect(completed?.status).toBe('completed');
    expect(completed?.events.at(-1)?.type).toBe('completed');
    expect((await draft())?.data.analysis?.assessment).toBe('supported');
    expect((await draft())?.data.status).toBe('draft');
    expect((await draft())?.data.content).toContain('not analyzed by a language model');
    const revision = (await draft())!.data.revision;
    await job(run.id);
    expect((await draft())!.data.revision).toBe(revision);
    expect((await getItem<CaseDoc>(wid, keys.case(caseId)))?.data.activeRunId).toBeUndefined();
  });

  it('permits only one active run per case and scopes polling and cancellation to the owner', async () => {
    const run = await startInvestigation(user, caseId, 'sample');
    await expect(startInvestigation(user, caseId, 'sample')).rejects.toMatchObject({ code: 'run_active' });
    await expect(getLatestInvestigation(other, caseId)).rejects.toMatchObject({ status: 404 });
    await expect(cancelInvestigation(other, run.id)).rejects.toMatchObject({ status: 404 });
    await cancelInvestigation(user, run.id); await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('cancelled');
    expect(await draft()).toBeNull();
  });

  it('preserves a human draft saved after a run was queued', async () => {
    const run = await startInvestigation(user, caseId, 'sample');
    await executeAction(user, { action: 'saveDraft', caseId, revision: 0, content: 'A human response prepared while the worker was queued.' });
    await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('stale');
    expect((await draft())?.data.content).toBe('A human response prepared while the worker was queued.');
  });

  it('keeps durable cancellation when a model request returns after the reviewer stops it', async () => {
    const run = await startInvestigation(user, caseId, 'bedrock');
    const invoke = vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockImplementation(async () => {
      await cancelInvestigation(user, run.id);
      return { $metadata: {}, output: { message: { role: 'assistant', content: [{ text: 'Late model response.' }] } }, stopReason: 'end_turn' } as never;
    });
    await job(run.id);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('cancelled');
    expect(await draft()).toBeNull();
  });

  it('never falls back to a sample when a configured Bedrock invocation fails', async () => {
    const run = await startInvestigation(user, caseId, 'bedrock');
    vi.spyOn(BedrockRuntimeClient.prototype, 'send').mockRejectedValue(Object.assign(new Error('private provider details'), { name: 'AccessDeniedException' }));
    await job(run.id);
    const saved = await getLatestInvestigation(user, caseId);
    expect(saved?.status).toBe('failed'); expect(saved?.error).not.toContain('private provider details');
    expect(await draft()).toBeNull();
  });

  it('expires abandoned jobs and releases their case lock', async () => {
    const run = await startInvestigation(user, caseId, 'sample');
    const row = (await getItem<RunDoc>(wid, keys.run(run.id)))!;
    await commit(wid, [{ key: row.key, expectedVersion: row.version, data: { ...row.data, expiresAt: '2020-01-01T00:00:00Z' } }]);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('failed');
    expect((await startInvestigation(user, caseId, 'sample')).id).not.toBe(run.id);
  });

  it('blocks a remapped merchant summary before any other source or model call', async () => {
    vi.stubEnv('MERCHANT_EVIDENCE_URL', 'https://merchant.example.test'); vi.stubEnv('MERCHANT_EVIDENCE_TOKEN', 'test-scoped-token'); vi.stubEnv('MERCHANT_WORKSPACE_ID', wid);
    const timestamp = '2026-11-07T10:00:00Z';
    const metadata = { id: 'external-1', merchantId: 'merchant-1', merchantName: 'Merchant', customerLabel: 'Customer', claim: 'Ticket not received', reason: 'Ticket not received', amount: 5000, currency: 'USD', eventName: 'Event', purchasedAt: timestamp, openedAt: timestamp, dueAt: timestamp, sourceMode: 'live', summary: 'Case summary', orderRef: 'ORDER-1', paymentRef: 'PAYMENT-1', tags: [] };
    const wire = () => ({ case_id: metadata.id, section: 'summary', source_mode: 'live', fetched_at: timestamp, status: 'available', records: [{ evidence_id: 'payment', source: 'Stripe', source_id: metadata.paymentRef, occurred_at: timestamp, data: { title: 'Payment mapping', detail: 'Payment captured.', fields: { paymentRef: metadata.paymentRef, orderRef: metadata.orderRef } } }], limitations: [], mapping_verified: true, case: metadata });
    const fetcher = vi.fn(async () => Response.json(wire())); vi.stubGlobal('fetch', fetcher);
    caseId = await importMerchantCase(user, metadata.id);
    metadata.paymentRef = 'OTHER-PAYMENT';
    const model = vi.spyOn(BedrockRuntimeClient.prototype, 'send');
    const run = await startInvestigation(user, caseId, 'bedrock'); await job(run.id);
    expect((await getLatestInvestigation(user, caseId))?.status).toBe('failed');
    expect(model).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await draft()).toBeNull();
  });
});

function uploadInput(overrides = {}) { return { caseId, title: 'Delivery receipt', source: 'manual', fileName: 'receipt.txt', mimeType: 'text/plain', size: 5, ...overrides }; }
function uploadedObject(value: string) {
  const bytes = new TextEncoder().encode(value);
  return { ContentLength: bytes.length, Body: { transformToWebStream: () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } };
}

describe('private S3 evidence', () => {
  it('signs an exact-size pending upload and prevents another workspace from finalizing it', async () => {
    const prepared = await prepareUpload(user, uploadInput());
    expect(prepared.method).toBe('POST');
    const policy = vi.mocked(createPresignedPost).mock.calls[0][1];
    expect(policy.Conditions).toContainEqual(['content-length-range', 5, 5]);
    expect(policy.Key).toContain(`pending/${wid}/`);
    await expect(completeUpload(other, prepared.uploadId)).rejects.toMatchObject({ status: 404 });
    await expect(prepareUpload(user, uploadInput({ size: 10 * 1024 * 1024 + 1 }))).rejects.toMatchObject({ code: 'invalid_upload' });
  });

  it('validates original bytes, writes a distinct immutable object, and clears approval atomically', async () => {
    await executeAction(user, { action: 'generateDraft', caseId });
    await executeAction(user, { action: 'approveDraft', caseId, revision: (await draft())!.data.revision });
    const prepared = await prepareUpload(user, uploadInput());
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async command => command instanceof GetObjectCommand ? uploadedObject('hello') as never : {} as never);
    await completeUpload(user, prepared.uploadId);
    const stateAfter = await getWorkspaceState(user); const saved = stateAfter.cases.find(item => item.id === caseId)!;
    const file = saved.evidence.find(record => record.fileName === 'receipt.txt')!;
    expect(file.content).toBe('hello'); expect(file.downloadUrl).toContain(file.id);
    expect(saved.draft?.status).toBe('draft'); expect(saved.draft?.sourceStale).toBe(true);
    const put = send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0] as PutObjectCommand;
    expect(put.input.Key).toContain(`evidence/${wid}/${caseId}/`); expect(put.input.IfNoneMatch).toBe('*'); expect(put.input.Body?.toString()).toBe('hello');
    const count = send.mock.calls.length;
    await completeUpload(user, prepared.uploadId);
    expect(send.mock.calls).toHaveLength(count);
    const result = await getDownload(user, file.id);
    expect(result.url).toContain('signed-download');
    expect(vi.mocked(getSignedUrl).mock.calls[0][2]).toEqual({ expiresIn: 60 });
    await expect(getDownload(other, file.id)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects forged size or binary file contents before creating evidence', async () => {
    const prepared = await prepareUpload(user, uploadInput());
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue(uploadedObject('sixsix') as never);
    await expect(completeUpload(user, prepared.uploadId)).rejects.toMatchObject({ code: 'invalid_upload' });
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
    send.mockResolvedValue(uploadedObject('he\0lo') as never);
    await expect(completeUpload(user, prepared.uploadId)).rejects.toMatchObject({ code: 'invalid_upload' });
    expect(send.mock.calls.some(([command]) => command instanceof PutObjectCommand)).toBe(false);
  });

  it('preserves its private copy when a concurrent edit invalidates finalization', async () => {
    const prepared = await prepareUpload(user, uploadInput());
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async command => {
      if (command instanceof GetObjectCommand) return uploadedObject('hello') as never;
      if (command instanceof PutObjectCommand) await executeAction(user, { action: 'updateCase', caseId, title: 'Changed during upload' });
      return {} as never;
    });
    await expect(completeUpload(user, prepared.uploadId)).rejects.toBeInstanceOf(ConflictError);
    expect(send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand && command.input.Key?.startsWith('evidence/'))).toBe(false);
    expect((await getWorkspaceState(user)).cases.find(item => item.id === caseId)?.evidence.some(record => record.fileName === 'receipt.txt')).toBe(false);
  });

  it.each([true, false])('retains committed evidence bytes after a lost response, including when reconciliation succeeds: %s', async reconciliationSucceeds => {
    const prepared = await prepareUpload(user, uploadInput());
    const objects = new Map<string, string>();
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async command => {
      if (command instanceof GetObjectCommand) return uploadedObject('hello') as never;
      if (command instanceof PutObjectCommand) objects.set(command.input.Key!, command.input.Body!.toString());
      if (command instanceof DeleteObjectCommand) objects.delete(command.input.Key!);
      return {} as never;
    });
    const apply = vi.mocked(commit).getMockImplementation()!;
    vi.mocked(commit).mockImplementationOnce(async (workspaceId, changes) => {
      await apply(workspaceId, changes);
      if (!reconciliationSucceeds) vi.mocked(getItem).mockRejectedValueOnce(new Error('The reconciliation read also failed.'));
      throw new Error('The transaction committed, but its response was lost.');
    });
    if (reconciliationSucceeds) await expect(completeUpload(user, prepared.uploadId)).resolves.toBeUndefined();
    else await expect(completeUpload(user, prepared.uploadId)).rejects.toThrow('The transaction committed, but its response was lost.');
    const saved = (await getWorkspaceState(user)).cases.find(item => item.id === caseId)!;
    expect(saved.evidence.filter(record => record.fileName === 'receipt.txt')).toHaveLength(1);
    const put = send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0] as PutObjectCommand;
    expect(objects.get(put.input.Key!)).toBe('hello');
    const count = send.mock.calls.length;
    await completeUpload(user, prepared.uploadId);
    expect(send.mock.calls).toHaveLength(count);
    expect(objects.get(put.input.Key!)).toBe('hello');
  });

  it('archives only an approved current revision and uses a stable immutable content-addressed key', async () => {
    await executeAction(user, { action: 'generateDraft', caseId });
    const revision = (await draft())!.data.revision;
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await expect(archiveApprovedCase(user, caseId, revision)).rejects.toMatchObject({ code: 'stale_archive' });
    expect(send).not.toHaveBeenCalled();
    await executeAction(user, { action: 'approveDraft', caseId, revision });
    const first = await archiveApprovedCase(user, caseId, revision);
    const second = await archiveApprovedCase(user, caseId, revision);
    expect(second.key).toBe(first.key); expect(first.key).toContain(first.sha256);
    expect((send.mock.calls[0][0] as PutObjectCommand).input.IfNoneMatch).toBe('*');
    await executeAction(user, { action: 'addEvidence', caseId, source: 'manual', title: 'New evidence', content: 'A source changed.', occurredAt: new Date().toISOString(), reference: '' });
    await expect(archiveApprovedCase(user, caseId, revision)).rejects.toMatchObject({ code: 'stale_archive' });
  });
});
