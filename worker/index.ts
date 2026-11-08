import handler from 'vinext/server/fetch-handler';
import { runWithConnectorBinding } from '../lib/connector-context';
import type { ConnectorBinding } from '../lib/connector-contract.mjs';
import { authenticateDevelopmentRequest } from '../lib/server/dev-auth';
import { proxyAwsApi } from '../lib/server/aws-bridge';

export default {
 async fetch(request:Request, env:Cloudflare.Env, ctx:ExecutionContext<{CONNECTORS?:ConnectorBinding}>) {
  const standalone=env.DEPLOYMENT_MODE==='standalone-dev';
  let bucketOrigin='';
  try { const target=new URL(env.EVIDENCE_BUCKET_ORIGIN || ''); if(target.protocol==='https:' && target.hostname.endsWith('.amazonaws.com')) bucketOrigin=target.origin; } catch { /* No browser upload target configured. */ }
  const secure=(response:Response)=>{
   const result=new Response(response.body,response);
   result.headers.set('X-Content-Type-Options','nosniff');
   result.headers.set('Referrer-Policy',new URL(request.url).pathname.startsWith('/api/providers')?'no-referrer':'strict-origin-when-cross-origin');
   result.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
   if(standalone || new URL(request.url).pathname.startsWith('/api/')) result.headers.set('Cache-Control','private, no-store');
   if(!import.meta.env.DEV && !result.headers.has('Content-Security-Policy')) result.headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${bucketOrigin}; object-src 'none'; base-uri 'self'; form-action 'self'`);
   return result;
  };
  const authenticated=await authenticateDevelopmentRequest(request,env);
  if(authenticated instanceof Response)return secure(authenticated);
  request=authenticated;
  if(env.DATA_BACKEND==='aws' && new URL(request.url).pathname.startsWith('/api/'))return secure(await proxyAwsApi(request,env));
  if(standalone && env.ASSETS && ['GET','HEAD'].includes(request.method) && !new URL(request.url).pathname.startsWith('/api/')) {
   const asset=await env.ASSETS.fetch(request);
   if(asset.status!==404)return secure(asset);
  }
  let binding=ctx.props?.CONNECTORS;
  // Local preview emulates the request-scoped Sites capability. Production has no auxiliary service.
  if(import.meta.env.DEV && !binding && env.CONNECTORS){
   const preview=env.CONNECTORS,expiresAt=Date.now()+60_000;
   binding={
    async getContext(){if(Date.now()>=expiresAt)return {status:'request_context_expired'};return preview.getContext?.() ?? {status:'binding_unavailable'};},
    async invoke(connectorId,actionName,args){if(Date.now()>=expiresAt)return {status:'request_context_expired',message:'This request has expired. Please try again.'};return preview.invoke(connectorId,actionName,args);},
   };
  }
  return secure(await runWithConnectorBinding(binding,()=>handler.fetch(request,env,ctx)));
 },
};
