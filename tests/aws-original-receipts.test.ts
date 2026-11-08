import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture = vi.hoisted(() => ({ rows: new Map<string, Stored<unknown>>(), dispute: vi.fn(), charge: vi.fn(), schema: vi.fn(), query: vi.fn() }));
vi.mock('../aws/store.ts', async original => {
  const actual = await original<typeof import('../aws/store.ts')>(); const { ConflictError } = await import('../aws/types.ts');
  return { ...actual, getItem: async (wid: string, key: string) => structuredClone(fixture.rows.get(`${wid}|${key}`) ?? null), queryItems: async (wid: string, prefix: string) => [...fixture.rows].filter(([k]) => k.startsWith(`${wid}|${prefix}`)).map(([, v]) => structuredClone(v)), commit: async (wid: string, changes: StoreChange[]) => {
    for (const c of changes) if ((fixture.rows.get(`${wid}|${c.key}`)?.version ?? null) !== c.expectedVersion) throw new ConflictError();
    for (const c of changes) { if (c.check) continue; if (c.delete) fixture.rows.delete(`${wid}|${c.key}`); else fixture.rows.set(`${wid}|${c.key}`, structuredClone({ key: c.key, version: (c.expectedVersion ?? 0) + 1, data: c.data })); }
  } };
});
vi.mock('../aws/stripe-oauth-api.ts', async original => ({ ...await original<typeof import('../aws/stripe-oauth-api.ts')>(), readStripeOAuthDispute: fixture.dispute, readStripeReceiptSource: fixture.charge }));
vi.mock('../aws/supabase-api.ts', async original => ({ ...await original<typeof import('../aws/supabase-api.ts')>(), fetchSupabaseSchema: fixture.schema, querySupabaseReadOnly: fixture.query }));
vi.mock('../aws/original-evidence.ts', () => ({ captureOriginalEmails: async () => ({ configured: true, captured: 0, alreadySaved: 0, remaining: 0, unavailable: [{ emailId: 'missing', reason: 'Original email unavailable' }] }) }));
import { fetchStripeReceiptPdf } from '../aws/stripe-receipt-file.ts';
import { captureOriginalStripeReceipt } from '../aws/stripe-originals.ts';
import { captureOriginalEvidence } from '../aws/capture-originals.ts';
import { captureOriginalDatabaseRows } from '../aws/supabase-originals.ts';
import { executeAction, getWorkspaceState } from '../aws/workspace.ts';
import { workspaceIdForUser, keys } from '../aws/store.ts';
const user: TrustedUser = { userId: 'receipt-owner', email: 'owner@example.test', displayName: 'Owner' }, other = { ...user, userId: 'other' };
const wid = workspaceIdForUser(user.userId), receipt = 'https://pay.stripe.com/receipts/payment/synthetic', pdf = Buffer.from('%PDF-1.7\nSynthetic original source bytes');
const charge = () => ({ id: 'ch_payment', object: 'charge', paid: true, livemode: true, amount: 4200, currency: 'usd', created: 1793505600, payment_intent: 'pi_payment', receipt_url: receipt, metadata: { order_number: 'ORDER-42' } });
let caseId: string;
const fetchReceipt = vi.fn(async (url: string) => url === receipt ? new Response('<a href="https://dashboard.stripe.com/receipts/synthetic/pdf"> Download receipt </a>') : new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
beforeEach(async () => {
  fixture.rows.clear(); vi.clearAllMocks(); vi.stubEnv('EVIDENCE_BUCKET', 'synthetic-bucket'); vi.stubGlobal('fetch', fetchReceipt);
  fixture.dispute.mockResolvedValue({ id: 'du_dispute', accountId: 'acct_customer', mode: 'live', chargeId: 'ch_payment', paymentIntentId: 'pi_payment', amount: 4200, currency: 'usd' }); fixture.charge.mockResolvedValue(charge());
  await executeAction(user, { action: 'createWorkspace', name: 'Receipt test' }); await executeAction(other, { action: 'createWorkspace', name: 'Other' });
  await executeAction(user, { action: 'addCase', title: 'Receipt test', customerName: 'Customer', email: 'customer@example.test', amount: 4200, reason: 'Not received', orderRef: 'ORDER-42', dueAt: '2026-12-01' });
  caseId = (await getWorkspaceState(user)).cases[0].id;
  await executeAction(user, { action: 'addEvidence', caseId, source: 'stripe', title: 'Dispute', content: 'Saved dispute', reference: 'du_dispute', occurredAt: '2026-11-01' });
  for (const [key, data] of Object.entries({ 'provider#stripe': { status: 'authorized', accountId: 'acct_customer', mode: 'live' }, 'provider-token#stripe': { accessToken: 'synthetic_private', refreshToken: 'synthetic_refresh', accountId: 'acct_customer', mode: 'live', expiresAt: Date.now() + 3600000 } })) fixture.rows.set(`${wid}|${key}`, { key, version: 1, data });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('native Stripe receipt download', () => {
  it('follows the provider link and bounded redirects without forwarding OAuth credentials', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<a href="https://dashboard.stripe.com/receipts/native/pdf">Download receipt</a>'))
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://pay.stripe.com/receipts/native/pdf' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://files.stripe.com/receipts/native.pdf' } }))
      .mockResolvedValueOnce(new Response(pdf));
    expect(Buffer.from(await fetchStripeReceiptPdf(receipt, request))).toEqual(pdf);
    for (const [, init] of request.mock.calls) expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(JSON.stringify(request.mock.calls)).not.toContain('Authorization');
  });
  it('rejects external or credential-bearing URLs before fetching them', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    await expect(fetchStripeReceiptPdf(receipt, request)).rejects.toMatchObject({ code: 'receipt_url_invalid' }); expect(request).toHaveBeenCalledOnce();
    request.mockClear();
    await expect(fetchStripeReceiptPdf('https://secret@pay.stripe.com/receipts/payment/x', request)).rejects.toMatchObject({ code: 'receipt_url_invalid' }); expect(request).not.toHaveBeenCalled();
  });
  it('requires an actual native PDF and rejects pages without a unique download link', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<p>Receipt unavailable</p>'));
    await expect(fetchStripeReceiptPdf(receipt, request)).rejects.toMatchObject({ code: 'receipt_download_missing' });
    request.mockResolvedValueOnce(new Response('<a href="https://files.stripe.com/file">Download receipt</a>')).mockResolvedValueOnce(new Response('<html>Sign in</html>'));
    await expect(fetchStripeReceiptPdf(receipt, request)).rejects.toMatchObject({ code: 'receipt_format_invalid' });
  });
  it('bounds redirects and PDF sizes', async () => {
    const loop = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: receipt } }));
    await expect(fetchStripeReceiptPdf(receipt, loop)).rejects.toThrow('redirects'); expect(loop).toHaveBeenCalledTimes(5);
    const large = vi.fn().mockResolvedValueOnce(new Response('<a href="https://files.stripe.com/file">Download receipt</a>')).mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1)));
    await expect(fetchStripeReceiptPdf(receipt, large)).rejects.toMatchObject({ status: 413 });
  });
});

describe('automatic original receipt evidence', () => {
  it('saves the provider bytes and fingerprint, clears approval and deduplicates later collection', async () => {
    await executeAction(user, { action: 'generateDraft', caseId });
    await executeAction(user, { action: 'approveDraft', caseId, revision: 1 });
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalStripeReceipt(user, caseId)).toMatchObject({ captured: 1 });
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(Buffer.from(command.input.Body as Uint8Array)).toEqual(pdf);
    const item = (await getWorkspaceState(user)).cases[0], original = item.evidence.find(e => e.originalDocument)!;
    expect(original).toMatchObject({ mimeType: 'application/pdf', fileSha256: createHash('sha256').update(pdf).digest('hex'), originalDocument: { provider: 'stripe', kind: 'receipt', sourceId: 'ch_payment' } });
    expect(item.draft).toMatchObject({ status: 'draft', sourceStale: true });
    expect(JSON.stringify(item)).not.toContain(receipt); expect(JSON.stringify(item)).not.toContain('synthetic_private');
    expect(await captureOriginalStripeReceipt(user, caseId)).toMatchObject({ alreadySaved: 1, captured: 0 }); expect(send).toHaveBeenCalledOnce();
  });
  it('fails closed on a different order, payment, amount or workspace', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    for (const change of [{ metadata: { order_number: 'ORDER-420' } }, { amount: 4300 }, { payment_intent: 'pi_other' }, { paid: false }]) {
      fixture.charge.mockResolvedValueOnce({ ...charge(), ...change }); await expect(captureOriginalStripeReceipt(user, caseId)).rejects.toMatchObject({ code: 'payment_case_mismatch' });
    }
    await expect(captureOriginalStripeReceipt(other, caseId)).rejects.toMatchObject({ status: 404 }); expect(send).not.toHaveBeenCalled(); expect(fetchReceipt).not.toHaveBeenCalled();
  });
  it('rejects concurrent changes and disconnected grants before attaching any original', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockImplementationOnce(async () => { const key = `${wid}|provider#stripe`, row = fixture.rows.get(key)!; fixture.rows.set(key, { ...row, version: row.version + 1, data: { status: 'disconnected' } }); return {} as never; });
    await expect(captureOriginalStripeReceipt(user, caseId)).rejects.toMatchObject({ code: 'conflict' });
    expect((await getWorkspaceState(user)).cases[0].evidence.some(e => e.originalDocument)).toBe(false);
    fixture.dispute.mockClear(); expect(await captureOriginalStripeReceipt(user, caseId)).toMatchObject({ configured: false }); expect(fixture.dispute).not.toHaveBeenCalled();
  });
  it('collects the original receipt even when the historical email body is unavailable', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalEvidence(user, caseId)).toMatchObject({ captured: 1, unavailable: [{ provider: 'Resend' }] });
    expect((await getWorkspaceState(user)).cases[0].evidence.some(e => e.originalDocument)).toBe(true);
  });
  it('does not attach a reference for a different Stripe account or ambiguous dispute', async () => {
    const row = fixture.rows.get(`${wid}|${keys.case(caseId)}`)!;
    fixture.rows.set(`${wid}|${row.key}`, { ...row, data: { ...(row.data as object), stripeAccountId: 'acct_other' } });
    await expect(captureOriginalStripeReceipt(user, caseId)).rejects.toMatchObject({ code: 'payment_case_mismatch' });
    await executeAction(user, { action: 'addEvidence', caseId, source: 'stripe', title: 'Other dispute', content: 'Different', reference: 'du_other', occurredAt: '2026-11-01' });
    await expect(captureOriginalStripeReceipt(user, caseId)).rejects.toMatchObject({ code: 'payment_link_required' }); expect(fetchReceipt).not.toHaveBeenCalled();
  });
});

describe('original database query results', () => {
  function seed(key: string, data: unknown) { fixture.rows.set(`${wid}|${key}`, { key, version: 1, data }); }
  function database() {
    const tables = [{ name: 'orders', columns: ['id', 'name', 'email'] }];
    seed('provider#supabase', { status: 'authorized', project: { ref: 'abcdefghijklmnopqrst', name: 'Orders' }, approvedTables: tables });
    seed('provider-token#supabase', { accessToken: 'synthetic_supabase_private', refreshToken: 'synthetic_refresh', expiresAt: Date.now() + 3600000 });
    seed('provider-customer-mapping#supabase', { mapping: { table: 'orders', idColumn: 'id', nameColumn: 'name', emailColumn: 'email' }, projectRef: 'abcdefghijklmnopqrst', connectionVersion: 1 });
    fixture.schema.mockResolvedValue(tables);
    fixture.charge.mockResolvedValue({ ...charge(), metadata: { order_number: 'ORDER-42', order_id: 'order_42' } });
    fixture.query.mockResolvedValue([{ id: 'order_42', name: 'Customer', email: 'customer@example.test' }]);
  }
  it('preserves exact approved rows and parameterized query, not a description of the row', async () => {
    database(); const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalDatabaseRows(user, caseId)).toMatchObject({ captured: 1 });
    expect(fixture.query).toHaveBeenCalledWith('synthetic_supabase_private', 'abcdefghijklmnopqrst', 'SELECT "id", "name", "email" FROM public."orders" WHERE "id"::text = $1 LIMIT 2', ['order_42']);
    const command = send.mock.calls[0][0] as PutObjectCommand, original = JSON.parse(Buffer.from(command.input.Body as Uint8Array).toString());
    expect(original.rows).toEqual([{ id: 'order_42', name: 'Customer', email: 'customer@example.test' }]);
    expect(original.query.parameters).toEqual(['order_42']);
    const item = (await getWorkspaceState(user)).cases[0];
    expect(item.evidence.find(e => e.originalRows)).toMatchObject({ fileSha256: createHash('sha256').update(command.input.Body as Uint8Array).digest('hex'), originalRows: { table: 'orders', rowCount: 1 } });
    expect(JSON.stringify(item)).not.toContain('synthetic_supabase_private');
    expect(await captureOriginalDatabaseRows(user, caseId)).toMatchObject({ captured: 0, alreadySaved: 1 }); expect(send).toHaveBeenCalledOnce();
  });
  it('does not capture a mismatched recipient, extra fields or revoked column scope', async () => {
    database(); const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    fixture.query.mockResolvedValueOnce([{ id: 'order_42', name: 'Customer', email: 'other@example.test' }]);
    expect(await captureOriginalDatabaseRows(user, caseId)).toMatchObject({ captured: 0 });
    fixture.query.mockResolvedValueOnce([{ id: 'order_42', name: 'Customer', email: 'customer@example.test', secret: 'must-not-store' }]);
    await expect(captureOriginalDatabaseRows(user, caseId)).rejects.toMatchObject({ status: 502 });
    const key = `${wid}|provider#supabase`, row = fixture.rows.get(key)!;
    fixture.rows.set(key, { ...row, data: { ...(row.data as object), approvedTables: [{ name: 'orders', columns: ['id'] }] } });
    await expect(captureOriginalDatabaseRows(user, caseId)).rejects.toMatchObject({ code: 'mapping_scope_denied' }); expect(send).not.toHaveBeenCalled();
  });
  it('collects approved order-linked tables and preserves returned email identifiers for the next collector', async () => {
    database();
    const tables = [{ name: 'orders', columns: ['id', 'payment_ref'] }, { name: 'message_log', columns: ['order_id', 'provider_id', 'channel'] }];
    seed('provider#supabase', { status: 'authorized', project: { ref: 'abcdefghijklmnopqrst', name: 'Orders' }, approvedTables: tables });
    seed('provider-mapping#supabase', { mapping: { order: { table: 'orders', idColumn: 'id', paymentColumn: 'payment_ref', paymentKind: 'payment_intent', columns: ['id', 'payment_ref'] }, related: [{ section: 'delivery', table: 'message_log', orderColumn: 'order_id', columns: ['order_id', 'provider_id', 'channel'] }] }, projectRef: 'abcdefghijklmnopqrst', supabaseVersion: 1, stripeAccountId: 'acct_customer', mode: 'live' });
    fixture.schema.mockResolvedValue(tables);
    fixture.query.mockImplementation(async (_t: string, _p: string, sql: string) => sql.includes('message_log') ? [{ order_id: 'order_42', provider_id: '11111111-1111-4111-8111-111111111111', channel: 'email' }] : [{ id: 'order_42', payment_ref: 'pi_payment' }]);
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalDatabaseRows(user, caseId)).toMatchObject({ captured: 2 });
    const evidence = (await getWorkspaceState(user)).cases[0].evidence;
    expect(evidence.find(e => e.originalRows?.table === 'message_log')?.originalRows?.linkedEmailIds).toEqual(['11111111-1111-4111-8111-111111111111']);
  });
});
