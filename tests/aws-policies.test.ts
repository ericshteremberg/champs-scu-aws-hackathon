import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), payment: vi.fn(), mail: vi.fn(), source: vi.fn() }));
vi.mock('../aws/store.ts', async original => {
  const actual = await original<typeof import('../aws/store.ts')>(); const { ConflictError } = await import('../aws/types.ts');
  return { ...actual, getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null), queryItems: async (wid: string, prefix: string) => [...fixture.rows].filter(([k]) => k.startsWith(`${wid}|${prefix}`)).map(([, v]) => structuredClone(v)), commit: async (wid: string, changes: StoreChange[]) => {
    for (const c of changes) if ((fixture.rows.get(`${wid}|${c.key}`)?.version ?? null) !== c.expectedVersion) throw new ConflictError();
    for (const c of changes) { if (c.check) continue; if (c.delete) fixture.rows.delete(`${wid}|${c.key}`); else fixture.rows.set(`${wid}|${c.key}`, structuredClone({ key: c.key, version: (c.expectedVersion ?? 0) + 1, data: c.data })); }
  } };
});
vi.mock('../aws/stripe-originals.ts', () => ({ verifiedCasePayment: fixture.payment }));
vi.mock('../aws/supabase-originals.ts', () => ({ captureOriginalDatabaseRows: async () => ({ configured: false, unavailable: [] }) }));
vi.mock('../aws/gmail-provider.ts', () => ({ gmailProviderAction: fixture.mail }));
vi.mock('../aws/imap-provider.ts', () => ({ imapProviderAction: fixture.mail }));
vi.mock('../aws/policy-source.ts', async original => ({ ...await original<typeof import('../aws/policy-source.ts')>(), fetchPolicyUrl: fixture.source }));
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: async () => ({ url: 'https://synthetic.s3.amazonaws.com/', fields: { key: 'synthetic' } }) }));
import { policyAction } from '../aws/policies.ts';
import { policyText } from '../aws/policy-source.ts';
import { collectPolicyEvidence, collectPolicyMail } from '../aws/policy-collection.ts';
import { selectPolicies, exactOrderMention, policyRelatedRecords } from '../lib/policies/matching.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser } from '../aws/store.ts';
const user: TrustedUser = { userId: 'policy-owner', email: 'owner@example.test', displayName: 'Owner' }, other = { ...user, userId: 'other' };
const wid = workspaceIdForUser(user.userId), metadata = { name: 'Refund policy', kind: 'refund', effectiveDate: '2026-01-01' };
const save = (extra = {}) => policyAction(user, { action: 'save', metadata, sourceType: 'text', text: 'Refund requests must be made within 14 days. Cancellation terms apply.', ...extra });
let caseId: string;
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks(); vi.stubEnv('EVIDENCE_BUCKET', 'synthetic-policy-bucket');
  vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  fixture.payment.mockResolvedValue({ charge: { created: Date.parse('2026-06-01T12:00:00Z') / 1000 }, checks: [] });
  await executeAction(user, { action: 'createWorkspace', name: 'Policy test' }); await executeAction(other, { action: 'createWorkspace', name: 'Other' });
  await executeAction(user, { action: 'addCase', title: 'Policy test', customerName: 'Customer', email: 'customer@example.test', amount: 4200, reason: 'Canceled', orderRef: 'ORDER-42', dueAt: '2026-12-01' });
  caseId = (await getWorkspaceState(user)).cases[0].id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('dated policy library and automatic collection', () => {
  it('retains originals, dates and immutable versions and never leaks storage keys', async () => {
    const result = await save(); if (!result.policy) throw new Error('Missing policy');
    const second = await save({ metadata: { ...metadata, previousVersionId: result.policy.id, effectiveDate: '2026-07-01' } });
    expect(second).toMatchObject({ policy: { version: 2, familyId: result.policy.familyId } });
    const state = await getWorkspaceState(user); expect(state.policies).toHaveLength(2);
    expect(JSON.stringify(state)).not.toContain('fileKey'); expect(JSON.stringify(state)).not.toContain('synthetic-policy-bucket');
    const command = vi.mocked(S3Client.prototype.send).mock.calls[0][0] as PutObjectCommand;
    const bytes = command.input.Body as Uint8Array;
    expect(result.policy.fileSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(JSON.parse(Buffer.from(bytes).toString())).toMatchObject({ original: expect.stringContaining('Refund requests'), effectiveDate: '2026-01-01' });
    const matched = await collectPolicyEvidence(user, caseId);
    expect(matched).toMatchObject({ captured: 1, policies: [{ id: result.policy.id, capturedAfterPurchase: true }] });
    const evidence = (await getWorkspaceState(user)).cases[0].evidence[0];
    expect(evidence.content).toContain('not verified checkout acceptance'); expect(evidence.downloadUrl).toBe(`/api/evidence/${evidence.id}`);
    expect(evidence.provenance?.fields.customerAcceptanceVerified).toBe(false);
    expect(await collectPolicyEvidence(user, caseId)).toMatchObject({ captured: 0, alreadySaved: 1 });
  });
  it('does not use the case date or substitute a policy effective after the purchase', async () => {
    await save({ metadata: { ...metadata, effectiveDate: '2026-07-01' } });
    expect(await collectPolicyEvidence(user, caseId)).toMatchObject({ captured: 0 });
    fixture.payment.mockRejectedValue(new Error('No verified payment'));
    expect(await collectPolicyEvidence(user, caseId)).toMatchObject({ captured: 0, purchaseAt: undefined });
  });
  it('rejects cross-workspace version references and case access', async () => {
    const result = await save(); if (!result.policy) throw new Error('Missing');
    await expect(policyAction(other, { action: 'save', metadata: { ...metadata, previousVersionId: result.policy.id }, sourceType: 'text', text: 'Refund policy text' })).rejects.toMatchObject({ status: 404 });
    await expect(collectPolicyEvidence(other, caseId)).rejects.toMatchObject({ status: 404 });
    await expect(save({ metadata: { ...metadata, effectiveDate: '2026-02-30' } })).rejects.toMatchObject({ status: 400 });
  });
  it('captures a URL as today’s source, preserving HTML separately from extracted clauses', async () => {
    fixture.source.mockResolvedValue({ url: 'https://merchant.com/terms', mimeType: 'text/html', bytes: Buffer.from('<h1>Terms</h1><p>No refunds after the event.</p><script>secret()</script>') });
    const result = await save({ sourceType: 'url', text: undefined, url: 'https://merchant.com/terms' });
    expect(result).toMatchObject({ policy: { sourceType: 'url', sourceUrl: 'https://merchant.com/terms', content: expect.stringContaining('No refunds') } });
    if (result.policy) expect(result.policy.content).not.toContain('secret()');
  });
  it('finalizes a validated original PDF upload idempotently and extracts its real text', async () => {
    const doc = await PDFDocument.create(); doc.addPage().drawText('Refund requests within 14 days.'); const bytes = await doc.save();
    const prepared = await policyAction(user, { action: 'prepare-upload', metadata, fileName: 'terms.pdf', mimeType: 'application/pdf', size: bytes.length });
    if (!('uploadId' in prepared)) throw new Error('Missing upload');
    vi.mocked(S3Client.prototype.send).mockImplementation(async command => command instanceof GetObjectCommand ? { ContentLength: bytes.length, Body: { transformToWebStream: () => new Response(new Uint8Array(bytes)).body } } as never : {} as never);
    const done = await policyAction(user, { action: 'finalize-upload', uploadId: prepared.uploadId });
    expect(done).toMatchObject({ policy: { mimeType: 'application/pdf', content: expect.stringContaining('Refund requests within 14 days.') } });
    expect(await policyAction(user, { action: 'finalize-upload', uploadId: prepared.uploadId })).toEqual(done);
    await expect(policyAction(other, { action: 'finalize-upload', uploadId: prepared.uploadId })).rejects.toMatchObject({ status: 404 });
    expect((await policyText(Buffer.from('Refund policy text'), 'text/plain')).text).toBe('Refund policy text');
  });
  it('attaches exact-order refund messages only, preserving requests as requests', async () => {
    const key = 'provider#gmail'; fixture.rows.set(`${wid}|${key}`, { key, version: 1, data: { status: 'authorized', email: 'merchant@example.test' } });
    fixture.mail.mockImplementation(async (_user, input) => input.action === 'search' ? { messages: [{ id: '1' }, { id: '2' }], moreAvailable: false } : { preview: { id: input.messageId, from: 'customer@example.test', to: 'merchant@example.test', occurredAt: '2026-06-02T00:00:00Z', subject: 'Refund request', text: input.messageId === '1' ? 'Please refund ORDER-42.' : 'Please refund ORDER-420.' } });
    expect(await collectPolicyMail(user, caseId, 'gmail')).toMatchObject({ captured: 1, candidates: 1 });
    const evidence = (await getWorkspaceState(user)).cases[0].evidence[0];
    expect(evidence.content).toContain('not evidence that a refund');
    expect(await collectPolicyMail(user, caseId, 'gmail')).toMatchObject({ captured: 0 });
    expect(policyRelatedRecords([evidence])).toHaveLength(1);
  });
  it('preserves ambiguous same-date versions, exclusive end dates and exact order boundaries', () => {
    const p = { id: 'a', name: 'Terms', familyId: 'family', effectiveDate: '2026-01-01', content: 'Terms', createdAt: '2026-08-01' };
    expect(selectPolicies([p, { ...p, id: 'b' }], '2026-06-01T00:00:00Z').every(m => m.ambiguous && m.capturedAfterPurchase)).toBe(true);
    expect(selectPolicies([{ ...p, endsAt: '2026-06-01' }], '2026-06-01T00:00:00Z')).toEqual([]);
    expect(selectPolicies([{ ...p, effectiveDate: '2025-01-01' }, { ...p, id: 'new', endsAt: '2026-05-01' }], '2026-06-01T00:00:00Z')).toEqual([]);
    expect(exactOrderMention('Please refund ORDER-420', 'ORDER-42')).toBe(false);
  });
});
