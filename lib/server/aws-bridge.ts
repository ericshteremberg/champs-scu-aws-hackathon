import { AwsClient } from 'aws4fetch';

export type AwsBridgeEnvironment = {
 DATA_BACKEND?: string; AWS_BACKEND_FUNCTION?: string; AWS_REGION?: string;
 AWS_ACCESS_KEY_ID?: string; AWS_SECRET_ACCESS_KEY?: string; AWS_SESSION_TOKEN?: string;
};
function reply(body: unknown,status=200) { return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}}); }
export async function proxyAwsApi(request: Request, env: AwsBridgeEnvironment): Promise<Response> {
 const url=new URL(request.url);
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email) return reply({error:'Sign in to continue.',code:'unauthenticated'},401);
 if(!['GET','POST'].includes(request.method))return reply({error:'Method not allowed.'},405);
 if(request.method==='POST' && (request.headers.get('origin')!==url.origin || request.headers.get('sec-fetch-site')==='cross-site')) return reply({error:'This request must originate from Causality.',code:'origin_rejected'},403);
 if(url.pathname==='/api/runtime' && request.method==='GET')return reply({storage:'aws',uploads:'presigned'});
 if(!env.AWS_BACKEND_FUNCTION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_SESSION_TOKEN) return reply({error:'The AWS backend connection requires a current workshop session.',code:'aws_backend_not_configured'},503);
 let text='';
 if(request.body) {
  const reader=request.body.getReader();const decoder=new TextDecoder();let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536){await reader.cancel();return reply({error:'Use the signed S3 upload flow for files.',code:'request_too_large'},413);}text+=decoder.decode(next.value,{stream:true});}
  text+=decoder.decode();
 }
 let body:unknown;
 if(text){try{body=JSON.parse(text);}catch{return reply({error:'Send a valid JSON request.'},400);}}
 const oauthRoute=/^\/api\/providers\/(supabase|stripe)\/(start|callback)$/.exec(url.pathname);
 const oauthStart=oauthRoute?.[2]==='start' && request.method==='POST';
 const oauthCallback=oauthRoute?.[2]==='callback' && request.method==='GET';
 const cookieName=`__Host-causality-${oauthRoute?.[1] || 'unused'}`;
 const cookie=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
 const oauthBinding=oauthStart?Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join(''):oauthCallback && /^[a-f0-9]{64}$/.test(cookie||'')?cookie:undefined;
 const finish=(response:Response)=>{
  if(oauthStart && response.ok)response.headers.set('Set-Cookie',`${cookieName}=${oauthBinding}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  if(oauthCallback)response.headers.set('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  if(oauthStart || oauthCallback)response.headers.set('Referrer-Policy','no-referrer');
  return response;
 };
 let fullName=request.headers.get('oai-authenticated-user-full-name');
 if(fullName && request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{fullName=decodeURIComponent(fullName);}catch{fullName=null;}}
 try{
  const region=env.AWS_REGION || 'us-east-1';
  const client=new AwsClient({region,service:'lambda',accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY,sessionToken:env.AWS_SESSION_TOKEN,retries:0});
  const response=await client.fetch(`https://lambda.${region}.amazonaws.com/2015-03-31/functions/${encodeURIComponent(env.AWS_BACKEND_FUNCTION)}/invocations`,{
   method:'POST',headers:{'Content-Type':'application/json','X-Amz-Invocation-Type':'RequestResponse'},
   body:JSON.stringify({kind:'api',method:request.method,path:url.pathname+url.search,user:{userId,email,fullName,displayName:fullName||email},body,oauthBinding,rawBody:url.pathname==='/api/stripe/webhook'?text:undefined,stripeSignature:request.headers.get('stripe-signature')||undefined}),
   signal:AbortSignal.any([request.signal,AbortSignal.timeout(28000)]),
  });
  if(!response.ok || response.headers.has('X-Amz-Function-Error')) return reply({error:'The AWS backend could not complete the request. Check its deployment and workshop session.',code:'aws_backend_failed'},502);
  const result=await response.json() as {status:number;body?:unknown;redirect?:string};
  if(!Number.isInteger(result.status)||result.status<200||result.status>599)throw new Error('Invalid backend response');
  if(result.redirect){const target=new URL(result.redirect);if(target.protocol!=='https:' || (oauthCallback && (target.origin!==url.origin || target.pathname!=='/workspace')))throw new Error('Invalid redirect URL');return finish(new Response(null,{status:302,headers:{Location:target.toString(),'Cache-Control':'private, no-store'}}));}
  return finish(reply(result.body,result.status));
 }catch{
  return reply({error:'The AWS backend is unavailable. Check the deployment and workshop session.',code:'aws_backend_unavailable'},502);
 }
}
