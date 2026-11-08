import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { captureOriginalEmails } from '../aws/original-evidence.ts';
import { startInvestigation } from '../aws/investigations.ts';
import { createHmac, createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceDoc, Stored, StoreChange, TrustedUser } from '../aws/types.ts';
const fixture=vi.hoisted(()=>({rows:new Map<string,Stored<unknown>>(),read:vi.fn()}));
vi.mock('../aws/store.ts',async original=>{
  const actual=await original<typeof import('../aws/store.ts')>();const {ConflictError}=await import('../aws/types.ts');
  return {...actual,getItem:async(wid:string,key:string)=>structuredClone(fixture.rows.get(`${wid}|${key}`)??null),queryItems:async(wid:string,prefix:string)=>[...fixture.rows].filter(([k])=>k.startsWith(`${wid}|${prefix}`)).map(([,v])=>structuredClone(v)),commit:async(wid:string,changes:StoreChange[])=>{
    for(const c of changes)if((fixture.rows.get(`${wid}|${c.key}`)?.version??null)!==c.expectedVersion)throw new ConflictError();
    for(const c of changes){if(c.check)continue;if(c.delete)fixture.rows.delete(`${wid}|${c.key}`);else fixture.rows.set(`${wid}|${c.key}`,structuredClone({key:c.key,version:(c.expectedVersion??0)+1,data:c.data}));}
  }};
});
vi.mock('../aws/resend-api.ts',async original=>({...await original<typeof import('../aws/resend-api.ts')>(),readResend:fixture.read,loadResendSecret:async()=>({apiKey:'re_synthetic',webhookSecret:'whsec_c3ludGhldGljLW9ubHktc2VjcmV0'})}));
import { verifyResendWebhook } from '../aws/resend-api.ts';
import { receiveResendWebhook,resendAction,resendStatus,resendWebhookHandler } from '../aws/resend.ts';
import { executeAction,getWorkspaceState } from '../aws/workspace.ts';
import { keys, workspaceIdForUser } from '../aws/store.ts';
import { localEvidence } from '../aws/investigations.ts';
import { runInvestigation } from '../lib/investigation/engine.ts';
import type { CaseDoc } from '../aws/types.ts';
const user:TrustedUser={userId:'resend-owner',email:'owner@example.test',displayName:'Owner'},other={...user,userId:'someone-else'};
const wid=workspaceIdForUser(user.userId),emailId='11111111-1111-4111-8111-111111111111';
let caseId:string;
const email=()=>({id:emailId,from:'Tickets <receipts@send.example.test>',to:['buyer@example.test'],subject:'Tickets for ORDER-42',created_at:'2026-11-01T12:00:00Z',last_event:'delivered',text:'Order ORDER-42',html:null});
const payload=()=>JSON.stringify({type:'email.delivered',created_at:'2026-11-01T12:01:00Z',data:{email_id:emailId,from:email().from,to:['private@example.test'],subject:'Not stored',html:'Not stored'}});
const headers=(body:string,timestamp=String(Math.floor(Date.now()/1000)))=>({'svix-id':'msg_synthetic_1','svix-timestamp':timestamp,'svix-signature':'v1,'+createHmac('sha256',Buffer.from('synthetic-only-secret')).update(`msg_synthetic_1.${timestamp}.${body}`).digest('base64')});
beforeEach(async()=>{
  fixture.rows.clear();vi.clearAllMocks();process.env.RESEND_SECRET_ARN='synthetic-arn';process.env.RESEND_WORKSPACE_ID=wid;process.env.RESEND_ALLOWED_DOMAINS='send.example.test';
  await executeAction(user,{action:'createWorkspace',name:'Resend test'});await executeAction(other,{action:'createWorkspace',name:'Other'});
  await executeAction(user,{action:'addCase',title:'Real record test',customerName:'Buyer',email:'buyer@example.test',amount:4200,reason:'Not received',orderRef:'ORDER-42',dueAt:'2026-12-01'});
  caseId=(await getWorkspaceState(user)).cases[0].id;fixture.read.mockResolvedValue(email());
});
describe('Resend evidence boundaries',()=>{
  it('rejects other workspaces and cases before reading Resend',async()=>{
    expect(await resendStatus(other)).toMatchObject({configured:false});
    await expect(resendAction(other,{action:'preview',caseId,emailId})).rejects.toMatchObject({status:403});
    await expect(resendAction(user,{action:'preview',caseId:'missing',emailId})).rejects.toMatchObject({status:404});expect(fixture.read).not.toHaveBeenCalled();
  });
  it('rejects wrong recipient, domain, mismatched ID and prefix-only order matches',async()=>{
    for(const change of [{to:['other@example.test']},{from:'receipts@evil.test'},{id:'22222222-2222-4222-8222-222222222222'},{subject:'ORDER-420',text:'ORDER-420'},{to:['buyer@example.test','unrelated@example.test']}]){
      fixture.read.mockResolvedValue({...email(),...change});await expect(resendAction(user,{action:'preview',caseId,emailId})).rejects.toMatchObject({status:409});
    }
    expect((await getWorkspaceState(user)).cases[0].evidence).toHaveLength(0);
  });
  it('previews without writes, imports minimal metadata once and preserves evidence limitations',async()=>{
    const initial=fixture.rows.size;
    expect(await resendAction(user,{action:'preview',caseId,emailId})).toHaveProperty('preview');expect(fixture.rows.size).toBe(initial);
    await resendAction(user,{action:'import',caseId,emailId,confirmed:true});
    expect(await resendAction(user,{action:'import',caseId,emailId,confirmed:true})).toMatchObject({unchanged:true});
    const record=(await getWorkspaceState(user)).cases[0].evidence[0];expect(record.provenance?.section).toBe('delivery');expect(record.content).toContain('not inbox placement');expect(record.content).not.toContain('re_synthetic');
  });
  it.each(['delivered', 'bounced'])('compiles imported %s email evidence with source citations and delivery limitations', async status => {
    fixture.read.mockResolvedValue({ ...email(), last_event: status });
    await resendAction(user, { action: 'import', caseId, emailId, confirmed: true });
    const item = (await getWorkspaceState(user)).cases[0];
    const record = item.evidence[0];
    expect(record.provenance?.fields).toMatchObject({ provider: 'Resend', emailId, providerStatus: status });
    const result = await runInvestigation({
      case: item, mode: 'sample', region: 'us-east-1', signal: AbortSignal.timeout(10000),
      readEvidence: async section => localEvidence({ ...item, workspaceId: wid, dataRevision: 1 } as CaseDoc, item.evidence, section),
      assertActive: async () => {}, onEvent: async () => {},
    });
    expect(result.evidenceIds).toContain(record.id);
    expect(result.content).toContain(`[${record.id}]`);
    expect(result.content).toContain(`Resend delivery record · ${status}`);
    expect(result.findings.find(f => f.evidenceIds.includes(record.id))?.detail).toContain(`Latest provider event: ${status}`);
    expect(result.gaps.join(' ')).toContain('not inbox placement');
    expect(result.metrics.recordCount).toBe(1);
    if (status === 'bounced') expect(result.findings.some(f => f.kind === 'conflict' && f.evidenceIds.includes(record.id))).toBe(true);
  });
  it('upgrades older imported records with compiler status without creating duplicates', async () => {
    await resendAction(user, { action: 'import', caseId, emailId, confirmed: true });
    const entry = [...fixture.rows].find(([, row]) => (row.data as { provenance?: { fields?: { provider?: string } } }).provenance?.fields?.provider === 'Resend');
    if (!entry) throw new Error('Missing fixture record');
    const data = entry[1].data as { provenance: { fields: Record<string, unknown> } };
    delete data.provenance.fields.providerStatus;
    expect(await resendAction(user, { action: 'import', caseId, emailId, confirmed: true })).toMatchObject({ imported: true });
    const records = (await getWorkspaceState(user)).cases[0].evidence;
    expect(records).toHaveLength(1);
    expect(records[0].provenance?.fields.providerStatus).toBe('delivered');
  });
  it('refreshes changed status once and invalidates the previously approved draft', async () => {
    await resendAction(user, { action: 'import', caseId, emailId, confirmed: true });
    await executeAction(user, { action: 'generateDraft', caseId });
    let item = (await getWorkspaceState(user)).cases[0];
    await executeAction(user, { action: 'approveDraft', caseId, revision: item.draft!.revision });
    fixture.read.mockResolvedValue({ ...email(), last_event: 'bounced' });
    await resendAction(user, { action: 'import', caseId, emailId, confirmed: true });
    item = (await getWorkspaceState(user)).cases[0];
    expect(item.evidence).toHaveLength(1);
    expect(item.evidence[0].provenance?.fields.providerStatus).toBe('bounced');
    expect(item.draft?.status).toBe('draft');
    expect(item.draft?.approvedAt).toBeFalsy();
    expect(item.draft?.sourceStale).toBe(true);
  });
  it('rejects stale writes when the case changes during the provider read',async()=>{
    fixture.read.mockImplementationOnce(async()=>{await executeAction(user,{action:'updateCase',caseId,title:'Changed'});return email();});
    await expect(resendAction(user,{action:'import',caseId,emailId,confirmed:true})).rejects.toMatchObject({status:409});expect((await getWorkspaceState(user)).cases[0].evidence).toHaveLength(0);
  });
  it('verifies access without sending or listing customer messages',async()=>{
    fixture.read.mockResolvedValue({data:[{name:'send.example.test',status:'verified'}]});await resendAction(user,{action:'verify'});expect(fixture.read).toHaveBeenCalledWith('/domains');expect(await resendStatus(user)).toMatchObject({configured:true,verifiedAt:expect.any(String)});
  });
});
describe('Signed Resend webhook',()=>{
  it('matches the published Svix vector',()=>{
    expect(verifyResendWebhook('{"event_type":"ping","data":{"success":true}}',{'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='},'whsec_plJ3nmyCDGBKInavdOK15jsl',1731705121000)).toBe('msg_loFOjxBNrRLzqYUf');
  });
  it('rejects unsigned, altered, old and future requests without storing data',async()=>{
    const body=payload();for(const h of [{},headers(body+'x'),headers(body,String(Math.floor(Date.now()/1000)-301)),headers(body,String(Math.floor(Date.now()/1000)+301))])await expect(receiveResendWebhook(body,h)).rejects.toMatchObject({status:400});
    expect([...fixture.rows.keys()].some(k=>k.includes('resend-event#'))).toBe(false);
  });
  it('deduplicates retries and stores only minimal event facts with expiry',async()=>{
    const body=payload();await receiveResendWebhook(body,headers(body));expect(await receiveResendWebhook(body,headers(body))).toMatchObject({duplicate:true});
    const rows=[...fixture.rows].filter(([k])=>k.includes('resend-event#'));expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain('private@example.test');expect(JSON.stringify(rows)).not.toContain('Not stored');
    expect((rows[0][1].data as {ttlEpochSeconds:number}).ttlEpochSeconds).toBeGreaterThan(Date.now()/1000);
  });
  it('ignores unrelated domains and unsupported event types',async()=>{
    for(const raw of [{...JSON.parse(payload()),type:'email.opened'},{...JSON.parse(payload()),data:{email_id:emailId,from:'other@unrelated.test'}}]){const body=JSON.stringify(raw);expect(await receiveResendWebhook(body,headers(body))).toMatchObject({ignored:true});}
    expect([...fixture.rows.keys()].some(k=>k.includes('resend-event#'))).toBe(false);
  });
  it('exposes no reads through the public function URL',async()=>{expect(await resendWebhookHandler({requestContext:{http:{method:'GET'}},rawPath:'/'})).toMatchObject({statusCode:404});expect(await resendWebhookHandler({requestContext:{http:{method:'POST'}},rawPath:'/api/workspace',body:'{}'})).toMatchObject({statusCode:404});});
});

function savedLog(overrides: Record<string, unknown> = {}) {
  const id = 'supabase_email_log';
  const data: EvidenceDoc = { id, caseId, source: 'database', title: 'delivery: message_log',
    reference: 'supabase:test-project:public.message_log:row-one', occurredAt: '2026-11-08T00:00:00Z', createdAt: '2026-11-08T00:00:00Z',
    content: 'Original merchant record: confirmation sent in August. Saved content remains available.',
    provenance: { section: 'delivery', sourceMode: 'supabase_oauth', originalSourceId: 'row-one',
      fields: { order_id: 'ORDER-42', channel: 'email', kind: 'order_confirmation', status: 'sent', provider_id: emailId, created_at: '2026-08-21T00:00:00Z' }, limitations: [] }, ...overrides };
  const key = keys.evidence(caseId, id);
  fixture.rows.set(`${wid}|${key}`, { key, version: 1, data });
  return data;
}
describe('Retained order email history', () => {
  it('discovers old logs without an API call, even when the Resend credential is absent', async () => {
    savedLog(); delete process.env.RESEND_SECRET_ARN;
    expect(await resendAction(user, {action:'discover', caseId})).toMatchObject({records:[{emailId, logStatus:'sent', occurredAt:'2026-08-21T00:00:00Z'}]});
    expect(fixture.read).not.toHaveBeenCalled();
    await expect(resendAction(other,{action:'discover',caseId})).rejects.toMatchObject({status:404});
  });
  it('uses a retained log after a provider 404 without creating duplicate evidence or claiming delivery', async () => {
    const record = savedLog(); const { ApiError } = await import('../aws/types.ts');
    fixture.read.mockRejectedValue(new ApiError(404, 'Expired'));
    expect(await resendAction(user,{action:'preview_log',caseId,evidenceId:record.id})).toMatchObject({preview:{savedLog:true,logStatus:'sent',lastEvent:'unavailable',content:expect.stringContaining('Saved content remains available')}});
    expect(await resendAction(user,{action:'import_log',caseId,evidenceId:record.id,confirmed:true})).toMatchObject({unchanged:true,evidenceId:record.id});
    expect((await getWorkspaceState(user)).cases[0].evidence).toHaveLength(1);
    // Legacy ID lookup uses the same saved proof, not a failed import.
    expect(await resendAction(user,{action:'preview',caseId,emailId})).toMatchObject({preview:{savedLog:true}});
  });
  it('retains logs with a missing UUID and does not invent an API lookup', async () => {
    const record = savedLog(); record.provenance!.fields.provider_id = null;
    const key=keys.evidence(caseId,record.id); fixture.rows.set(`${wid}|${key}`,{key,version:1,data:record});
    expect(await resendAction(user,{action:'preview_log',caseId,evidenceId:record.id})).toMatchObject({preview:{savedLog:true,emailId:''}});
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('does not promote manually entered, unrelated, or non-email rows to verified order logs', async () => {
    const record = savedLog(); const key=keys.evidence(caseId,record.id);
    for (const change of [ {sourceMode:'manual'}, {fields:{...record.provenance!.fields,order_id:'OTHER'}}, {fields:{...record.provenance!.fields,channel:'sms'}} ]) {
      fixture.rows.set(`${wid}|${key}`,{key,version:1,data:{...record,provenance:{...record.provenance,...change}}});
      expect(await resendAction(user,{action:'discover',caseId})).toMatchObject({records:[]});
      await expect(resendAction(user,{action:'preview_log',caseId,evidenceId:record.id})).rejects.toMatchObject({status:404});
    }
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('uses the verified order-log linkage for reminders without an order number in their body', async () => {
    const record = savedLog(); fixture.read.mockResolvedValue({...email(),subject:'Tomorrow',text:'Doors at ten'});
    expect(await resendAction(user,{action:'preview_log',caseId,evidenceId:record.id})).toMatchObject({preview:{lastEvent:'delivered'}});
    fixture.read.mockResolvedValue({...email(),to:['someone-else@example.test']});
    await expect(resendAction(user,{action:'preview_log',caseId,evidenceId:record.id})).rejects.toMatchObject({status:409});
  });
  it.each(['sent','failed','delivered'])('compiles old merchant %s logs with source and status distinctions', async status => {
    const record=savedLog(); record.provenance!.fields.status=status;
    const item=(await getWorkspaceState(user)).cases[0];
    const envelope=localEvidence({...item,workspaceId:wid,dataRevision:1} as CaseDoc,[record],'delivery');
    expect(envelope.records[0].fields.merchantEmailStatus).toBe(status);
    expect(envelope.records[0].fields.providerStatus).toBe(status==='failed'?'failed':null);
    expect(envelope.records[0].detail).toContain('Saved content remains available');
    expect(envelope.limitations.join(' ')).toContain('does not confirm recipient-server delivery');
    const result=await runInvestigation({case:item,mode:'sample',region:'us-east-1',signal:AbortSignal.timeout(10000),
      readEvidence:async section=>localEvidence({...item,workspaceId:wid,dataRevision:1} as CaseDoc,[record],section),assertActive:async()=>{},onEvent:async()=>{}});
    expect(result.content).toContain(`[${record.id}]`);
    if(status==='failed') expect(result.findings.some(f=>f.kind==='conflict'&&f.evidenceIds.includes(record.id))).toBe(true);
  });
});

describe('Resend lookup from case context', () => {
  it('discovers explicit Resend and message-log IDs without asking for a UUID or listing unrelated mail', async () => {
    const evidenceId = 'linked';
    fixture.rows.set(`${wid}|evidence#${caseId}#${evidenceId}`, { key: `evidence#${caseId}#${evidenceId}`, version: 1, data: { id: evidenceId, caseId, source: 'database', title: 'Ticket receipt', content: `Order UUID 22222222-2222-4222-8222-222222222222.`, reference: `Resend ${emailId} / message_log`, occurredAt: '2026-11-01', createdAt: '2026-11-01' } });
    const result = await resendAction(user, { action: 'find', caseId });
    expect(result).toMatchObject({ candidates: [{ emailId, source: 'case_reference' }], searchedEmail: 'buyer@example.test' });
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it('filters recent metadata to the case recipient and allowed sender, then paginates explicitly', async () => {
    fixture.read.mockResolvedValue({ has_more: true, data: [email(), { ...email(), id: '22222222-2222-4222-8222-222222222222', to: ['other@example.test'] }, { ...email(), id: '33333333-3333-4333-8333-333333333333', from: 'bad@unrelated.test' }] });
    const result = await resendAction(user, { action: 'find', caseId });
    expect(result).toMatchObject({ candidates: [{ emailId, source: 'resend_recipient' }], moreAvailable: true, nextCursor: '33333333-3333-4333-8333-333333333333' });
    expect(fixture.read).toHaveBeenCalledWith('/emails?limit=100');
    await resendAction(user, { action: 'find', caseId, after: emailId });
    expect(fixture.read).toHaveBeenLastCalledWith(`/emails?limit=100&after=${emailId}`);
    fixture.read.mockResolvedValue({ ...email(), subject: 'Other order', text: 'Other order' });
    await expect(resendAction(user, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 409 });
  });
  it('fails closed on malformed lists, case changes and unrelated workspace reads', async () => {
    fixture.read.mockResolvedValue({ has_more: true, data: [] });
    await expect(resendAction(user, { action: 'find', caseId })).rejects.toMatchObject({ status: 502 });
    fixture.read.mockImplementationOnce(async () => { await executeAction(user, { action: 'updateCase', caseId, title: 'Changed' }); return { has_more: false, data: [email()] }; });
    await expect(resendAction(user, { action: 'find', caseId })).rejects.toMatchObject({ status: 409 });
    await expect(resendAction(other, { action: 'find', caseId })).rejects.toMatchObject({ status: 403 });
  });
});

describe('saved evidence when a live Resend record is unavailable', () => {
  const savedId = 'historical-email';
  const savedKey = () => `evidence#${caseId}#${savedId}`;
  function save(fields = {}) {
    const data = { id: savedId, caseId, source: 'gmail', title: 'Previously captured receipt', content: 'Original captured email text. Delivery status was not independently verified.', reference: `Resend ${emailId} / message_log historical`, occurredAt: '2026-08-21T01:19:00Z', createdAt: '2026-11-01T00:00:00Z', ...fields };
    fixture.rows.set(`${wid}|${savedKey()}`, { key: savedKey(), version: 1, data });
  }
  it('shows explicitly linked saved evidence on 404 without changing the case, evidence or approved draft', async () => {
    const { ApiError } = await import('../aws/types.ts');
    save(); await executeAction(user, { action: 'generateDraft', caseId });
    const state = await getWorkspaceState(user); await executeAction(user, { action: 'approveDraft', caseId, revision: state.cases[0].draft!.revision });
    const before = structuredClone(fixture.rows);
    fixture.read.mockRejectedValue(new ApiError(404, 'Not found'));
    const result = await resendAction(user, { action: 'preview', caseId, emailId });
    expect(result).toMatchObject({ preview: { savedEvidence: true, liveVerified: false, evidenceIds: [savedId], lastEvent: 'unavailable', eventCount: 0, content: expect.stringContaining('Original captured email text') } });
    expect(await resendAction(user, { action: 'import', caseId, emailId, confirmed: true })).toMatchObject({ imported: false, unchanged: true, savedEvidence: true });
    expect(fixture.rows).toEqual(before);
  });
  it('labels temporary provider failure separately and keeps conflicting saved records', async () => {
    const { ApiError } = await import('../aws/types.ts');
    save(); const secondKey = `evidence#${caseId}#failed-email`;
    fixture.rows.set(`${wid}|${secondKey}`, { key: secondKey, version: 1, data: { ...(fixture.rows.get(`${wid}|${savedKey()}`)!.data as object), id: 'failed-email', content: 'Delivery failed according to the captured source.' } });
    fixture.read.mockRejectedValue(new ApiError(502, 'Provider unavailable'));
    const result = await resendAction(user, { action: 'preview', caseId, emailId });
    expect(result).toMatchObject({ preview: { savedEvidence: true, notice: expect.stringContaining('temporarily unavailable'), evidenceIds: [savedId,'failed-email'], content: expect.stringContaining('Delivery failed') } });
  });
  it('does not fall back for unrelated UUIDs, wrong provider matches or another workspace', async () => {
    const { ApiError } = await import('../aws/types.ts');
    save({ reference: 'Order UUID 22222222-2222-4222-8222-222222222222' });
    fixture.read.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    await expect(resendAction(user, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 404 });
    save(); fixture.read.mockResolvedValueOnce({ ...email(), to: ['other@example.test'] });
    await expect(resendAction(user, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 409 });
    await expect(resendAction(other, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a fallback if the case or saved evidence changes during the request', async () => {
    const { ApiError } = await import('../aws/types.ts'); save();
    fixture.read.mockImplementationOnce(async () => { await executeAction(user, { action: 'updateCase', caseId, title: 'Changed' }); throw new ApiError(404,'Not found'); });
    await expect(resendAction(user, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 409 });
    fixture.read.mockImplementationOnce(async () => { fixture.rows.delete(`${wid}|${savedKey()}`); throw new ApiError(404,'Not found'); });
    await expect(resendAction(user, { action: 'preview', caseId, emailId })).rejects.toMatchObject({ status: 409 });
  });
  it('bounds excerpts without modifying saved evidence or claiming a recovered email body', async () => {
    const { ApiError } = await import('../aws/types.ts'); save({ content: 'x'.repeat(25000) });
    fixture.read.mockRejectedValue(new ApiError(404,'Not found'));
    expect(await resendAction(user, { action: 'preview', caseId, emailId })).toMatchObject({ preview: { savedEvidence: true, truncated: true, content: expect.stringContaining('Full original remains on the case') } });
    expect((fixture.rows.get(`${wid}|${savedKey()}`)!.data as { content: string }).content).toHaveLength(25000);
  });
  it('preserves merchant-log limitations without upgrading merchant delivered status to provider confirmation', async () => {
    const { withSavedEmailContext } = await import('../aws/resend-history.ts');
    const record = { id: 'log', caseId, source: 'database' as const, title: 'Merchant email log', content: 'Saved merchant row', occurredAt: '2026-08-21', reference: 'supabase:project:public.message_log:row', provenance: { sourceMode: 'supabase_oauth', section: 'delivery', fields: { order_id: 'ORDER-42', channel: 'email', provider_id: emailId, status: 'delivered' }, limitations: [], originalSourceId: 'row' } };
    expect(withSavedEmailContext(record, 'ORDER-42').provenance?.fields).toMatchObject({ providerStatus: null, merchantEmailStatus: 'delivered', statusSource: 'merchant_email_log' });
    expect(withSavedEmailContext({ ...record, provenance: { ...record.provenance, fields: { ...record.provenance.fields, status: 'failed' } } }, 'ORDER-42').provenance?.fields.providerStatus).toBe('failed');
    expect(withSavedEmailContext(record, 'OTHER-ORDER')).toEqual(record);
  });
});


describe('automatic original email collection', () => {
  async function linked() {
    process.env.EVIDENCE_BUCKET = 'synthetic-private-bucket';
    await executeAction(user, { action: 'addEvidence', caseId, source: 'database', title: 'Order email reference', content: 'Order ORDER-42 email reference', occurredAt: '2026-11-01T12:00:00Z', reference: `Resend email ${emailId}` });
  }
  it('preserves exact provider HTML in S3 with a server-recorded fingerprint before investigating', async () => {
    await linked();
    const html = '<h1>Original ticket ORDER-42</h1><p>Purchased ticket</p>';
    fixture.read.mockResolvedValue({ ...email(), html });
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalEmails(user, caseId)).toMatchObject({ captured: 1, unavailable: [] });
    const put = send.mock.calls.find(([command]) => command instanceof PutObjectCommand)![0] as PutObjectCommand;
    const snapshot = JSON.parse(Buffer.from(put.input.Body as Uint8Array).toString());
    expect(snapshot.message.html).toBe(html);
    const record = (await getWorkspaceState(user)).cases[0].evidence.find(e => e.originalEmail)!;
    expect(record.originalEmail?.emailId).toBe(emailId);
    expect(record.fileSha256).toBe(createHash('sha256').update(put.input.Body as Uint8Array).digest('hex'));
    expect(record.downloadUrl).toContain(record.id);
    fixture.read.mockClear();
    expect(await captureOriginalEmails(user, caseId)).toMatchObject({ captured: 0, alreadySaved: 1 });
    expect(fixture.read).not.toHaveBeenCalled();
    send.mockRestore();
  });
  it('automatically captures linked originals before taking the investigation source snapshot', async () => {
    await linked();
    process.env.AWS_REGION = 'us-east-1'; process.env.BEDROCK_MODEL_ID = 'test-model'; process.env.FUNCTION_NAME = 'test-worker';
    const s3 = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const lambda = vi.spyOn(LambdaClient.prototype, 'send').mockResolvedValue({ StatusCode: 202 } as never);
    const run = await startInvestigation(user, caseId, 'bedrock');
    expect(run.status).toBe('running');
    expect((await getWorkspaceState(user)).cases[0].evidence.some(e => e.originalEmail)).toBe(true);
    expect(lambda).toHaveBeenCalledOnce();
    s3.mockRestore(); lambda.mockRestore();
  });
  it('does not manufacture original files when the provider has no message', async () => {
    await linked(); fixture.read.mockRejectedValue(new Error('Unavailable'));
    const before = (await getWorkspaceState(user)).cases[0];
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalEmails(user, caseId)).toMatchObject({ captured: 0, unavailable: [{ emailId, reason: expect.any(String) }] });
    expect((await getWorkspaceState(user)).cases[0]).toEqual(before);
    expect(send).not.toHaveBeenCalled(); send.mockRestore();
  });
  it('uses retained order-linked database IDs for reminder bodies without an order number', async () => {
    await linked();
    const id = 'trusted_query', key = `evidence#${caseId}#${id}`;
    fixture.rows.set(`${wid}|${key}`, { key, version: 1, data: { id, caseId, source: 'database', title: 'Original message rows', content: 'Original query', reference: 'supabase:message_log', occurredAt: '2026-11-01', fileKey: 'private/original', fileSha256: 'a'.repeat(64), originalRows: { provider: 'supabase', projectRef: 'synthetic', table: 'message_log', rowCount: 1, linkedEmailIds: [emailId] } } });
    fixture.read.mockResolvedValue({ ...email(), subject: 'Tonight', text: 'Doors at 10 PM' });
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    expect(await captureOriginalEmails(user, caseId)).toMatchObject({ captured: 1 });
    send.mockRestore();
  });
  it('rejects mismatched customer and order content before preserving a provider body', async () => {
    await linked();
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    for (const change of [{ to: ['unrelated@example.test'] }, { subject: 'ORDER-420', text: 'ORDER-420' }, { from: 'other@unrelated.test' }]) {
      fixture.read.mockResolvedValue({ ...email(), ...change });
      expect(await captureOriginalEmails(user, caseId)).toMatchObject({ captured: 0 });
    }
    expect(send).not.toHaveBeenCalled(); send.mockRestore();
    await expect(captureOriginalEmails(other, caseId)).rejects.toMatchObject({ status: 404 });
  });
  it('does not attach captured content to a case that changed during collection', async () => {
    await linked();
    fixture.read.mockImplementationOnce(async () => { await executeAction(user, { action: 'updateCase', caseId, title: 'Concurrent edit' }); return email(); });
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await expect(captureOriginalEmails(user, caseId)).rejects.toMatchObject({ status: 409 });
    const item = (await getWorkspaceState(user)).cases[0];
    expect(item.title).toBe('Concurrent edit');
    expect(item.evidence.some(record => record.originalEmail)).toBe(false);
    send.mockRestore();
  });
});

describe('merged retained and captured email history', () => {
  it('keeps conflicting manual captures alongside the structured order log', async () => {
    const { ApiError } = await import('../aws/types.ts');
    savedLog();
    const id = 'manual-conflict', key = keys.evidence(caseId, id);
    fixture.rows.set(`${wid}|${key}`, { key, version: 1, data: {
      id, caseId, source: 'manual', title: 'Captured failure', content: 'Conflicting captured failure must remain visible.',
      reference: `Resend ${emailId}`, occurredAt: '2026-08-21', createdAt: '2026-08-21',
    } });
    fixture.read.mockRejectedValue(new ApiError(404, 'Not found'));
    const result = await resendAction(user, { action: 'preview', caseId, emailId });
    expect(result).toMatchObject({ preview: { savedEvidence: true, liveVerified: false, content: expect.stringContaining('Conflicting captured failure') } });
    expect(result).toMatchObject({ preview: { content: expect.stringContaining('Original merchant record') } });
  });
});
