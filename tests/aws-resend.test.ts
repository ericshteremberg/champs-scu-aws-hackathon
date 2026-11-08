import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stored, StoreChange, TrustedUser } from '../aws/types.ts';
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
import { workspaceIdForUser } from '../aws/store.ts';
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
