import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('aws4fetch',()=>({AwsClient:class{fetch=mocks.send;}}));
import {proxyAwsApi} from '../lib/server/aws-bridge';
const env={DATA_BACKEND:'aws',AWS_BACKEND_FUNCTION:'fixture-function',AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic',AWS_SESSION_TOKEN:'synthetic'};
const headers={'oai-authenticated-user-id':'trusted-reviewer','oai-authenticated-user-email':'reviewer@example.test'};
const origin='https://dev.example.test';
const request=(path='/api/workspace',body?:unknown)=>new Request(origin+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
beforeEach(()=>{mocks.send.mockReset();mocks.send.mockImplementation(async()=>Response.json({status:200,body:{ok:true}}));});
describe('private AWS API bridge',()=>{
 it('rejects anonymous access before invoking Lambda',async()=>{expect((await proxyAwsApi(new Request(origin+'/api/workspace'),env)).status).toBe(401);expect(mocks.send).not.toHaveBeenCalled();});
 it('checks browser origin on mutation',async()=>{const value=request('/api/workspace',{action:'seedDemo'});value.headers.set('Origin','https://untrusted.test');expect((await proxyAwsApi(value,env)).status).toBe(403);expect(mocks.send).not.toHaveBeenCalled();});
 it('fails explicitly without configured temporary credentials',async()=>{expect((await proxyAwsApi(request(),{...env,AWS_SESSION_TOKEN:''})).status).toBe(503);expect(mocks.send).not.toHaveBeenCalled();});
 it('forwards only the server-authenticated identity, exact route, and JSON body',async()=>{const value=request('/api/workspace',{action:'seedDemo',user:{userId:'spoof'}});const response=await proxyAwsApi(value,env);expect(response.status).toBe(200);const payload=JSON.parse(mocks.send.mock.calls[0][1].body);expect(payload.user.userId).toBe('trusted-reviewer');expect(payload.path).toBe('/api/workspace');expect(payload.body.action).toBe('seedDemo');expect(payload).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');});
 it('bounds request size before invoking AWS',async()=>{expect((await proxyAwsApi(request('/api/workspace',{content:'x'.repeat(70000)}),env)).status).toBe(413);expect(mocks.send).not.toHaveBeenCalled();});
 it('hides AWS exception details and expired credentials',async()=>{mocks.send.mockRejectedValue(new Error('synthetic backend secret detail'));const response=await proxyAwsApi(request(),env);expect(response.status).toBe(502);expect(await response.text()).not.toContain('secret detail');});
 it('allows only HTTPS signed download redirects and never caches API responses',async()=>{mocks.send.mockResolvedValue(Response.json({status:302,redirect:'https://bucket.s3.us-east-1.amazonaws.com/private'}));const response=await proxyAwsApi(request('/api/evidence/evidence_fixture'),env);expect(response.status).toBe(302);expect(response.headers.get('Cache-Control')).toContain('no-store');mocks.send.mockResolvedValue(Response.json({status:302,redirect:'javascript:alert(1)'}));expect((await proxyAwsApi(request(),env)).status).toBe(502);});
 it('advertises S3 uploads without invoking business APIs',async()=>{const response=await proxyAwsApi(request('/api/runtime'),env);expect(await response.json()).toEqual({storage:'aws',uploads:'presigned'});expect(mocks.send).not.toHaveBeenCalled();});
 it('issues a secure browser binding only after an authenticated same-origin OAuth start',async()=>{
  const response=await proxyAwsApi(request('/api/providers/supabase/start',{}),env);
  const payload=JSON.parse(mocks.send.mock.calls[0][1].body);
  expect(payload.oauthBinding).toMatch(/^[a-f0-9]{64}$/);
  expect(response.headers.get('Set-Cookie')).toBe(`__Host-causality-supabase=${payload.oauthBinding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
 });
 it('forwards only the callback binding cookie and strips it on return',async()=>{
  const binding='a'.repeat(64); const value=request('/api/providers/supabase/callback?state=synthetic&code=synthetic');
  value.headers.set('Cookie',`unrelated=private; __Host-causality-supabase=${binding}`);
  value.headers.set('x-oauth-binding','spoof');
  mocks.send.mockResolvedValue(Response.json({status:302,redirect:origin+'/workspace?view=integrations&provider_result=authorized'}));
  const response=await proxyAwsApi(value,env);const payload=JSON.parse(mocks.send.mock.calls[0][1].body);
  expect(payload.oauthBinding).toBe(binding);expect(JSON.stringify(payload)).not.toContain('unrelated');
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect(response.headers.get('Location')).not.toContain('code=');
  mocks.send.mockResolvedValue(Response.json({status:302,redirect:'https://untrusted.test/workspace'}));
  expect((await proxyAwsApi(value,env)).status).toBe(502);
 });
 it('does not accept a callback binding supplied through query parameters or headers',async()=>{
  const value=request('/api/providers/supabase/callback?oauthBinding='+ 'a'.repeat(64));value.headers.set('x-oauth-binding','a'.repeat(64));
  await proxyAwsApi(value,env);expect(JSON.parse(mocks.send.mock.calls[0][1].body).oauthBinding).toBeUndefined();
 });
 it('keeps Stripe and Supabase browser bindings separate',async()=>{
  const started=await proxyAwsApi(request('/api/providers/stripe/start',{}),env);
  expect(started.headers.get('Set-Cookie')).toContain('__Host-causality-stripe=');
  const callback=request('/api/providers/stripe/callback?state=synthetic');callback.headers.set('Cookie','__Host-causality-supabase='+ 'a'.repeat(64));
  await proxyAwsApi(callback,env);expect(JSON.parse(mocks.send.mock.calls.at(-1)![1].body).oauthBinding).toBeUndefined();
  callback.headers.set('Cookie','__Host-causality-stripe='+ 'b'.repeat(64));
  mocks.send.mockResolvedValue(Response.json({status:302,redirect:origin+'/workspace?view=integrations&provider_result=stripe_denied'}));
  const finished=await proxyAwsApi(callback,env);expect(JSON.parse(mocks.send.mock.calls.at(-1)![1].body).oauthBinding).toBe('b'.repeat(64));expect(finished.headers.get('Set-Cookie')).toContain('__Host-causality-stripe=;');
 });
});
