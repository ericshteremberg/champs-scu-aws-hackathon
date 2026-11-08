import { createHmac } from 'node:crypto';
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
    expect(result.content).toContain(`Latest provider event: ${status}`);
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
