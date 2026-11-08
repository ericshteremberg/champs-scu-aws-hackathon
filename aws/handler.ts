import { z } from 'zod';
import { ApiError, type TrustedUser } from './types.ts';
import { getWorkspaceState, executeAction, requireWorkspace } from './workspace.ts';
import { getInvestigationConfig, startInvestigation, getLatestInvestigation, cancelInvestigation, processInvestigation, importMerchantCase, importManagedMerchantCase } from './investigations.ts';
import { prepareUpload, completeUpload, getDownload, archiveApprovedCase } from './files.ts';
import { configuration, listStripeIntegration, connectStripe, disconnectStripe, syncStripe, submitStripe, handleStripeWebhook } from './stripe.ts';
import { listEvidenceConnections, executeConnectorAction, getConnectorInstallation } from './connectors.ts';
import { listManagedConnections, executeManagedConnectorAction, parseLiveImport } from './managed-connectors.ts';
import { providerStatus, startSupabase, finishSupabase, supabaseAction } from './providers.ts';
import { startStripeProvider, finishStripeProvider, stripeProviderAction } from './stripe-provider.ts';
import { resendAction, resendStatus } from './resend.ts';
export { resendWebhookHandler } from './resend.ts';

const userSchema=z.object({userId:z.string().min(1).max(200),email:z.string().max(320),displayName:z.string().max(320),fullName:z.string().max(320).nullable().optional()});
const id=z.string().min(1).max(200);
const investigationAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),caseId:id,mode:z.enum(['sample','bedrock'])}).strict(),
 z.object({action:z.literal('cancel'),runId:id}).strict(),
 z.object({action:z.literal('import'),externalCaseId:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/)}).strict(),
]);
const archiveSchema=z.object({caseId:id,revision:z.number().int().positive()}).strict();
const finalizeSchema=z.object({uploadId:id}).strict();
const submissionSchema=z.object({caseId:id,confirmed:z.literal(true),draftRevision:z.number().int().positive()}).strict();
const apiSchema=z.object({kind:z.literal('api'),method:z.enum(['GET','POST']),path:z.string().max(8192),user:userSchema.optional(),body:z.unknown().optional(),rawBody:z.string().max(65536).optional(),stripeSignature:z.string().max(4096).optional(),oauthBinding:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const jobSchema=z.object({kind:z.literal('investigation'),workspaceId:id,caseId:id,runId:id}).strict();
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const value=schema.safeParse(input);if(!value.success)throw new ApiError(400,'The request does not match the API contract.','invalid_request');return value.data;}

async function route(raw:unknown) {
 try {
  if(Buffer.byteLength(JSON.stringify(raw))>128*1024)throw new ApiError(413,'The request is too large.');
  const job=jobSchema.safeParse(raw);
  if(job.success){await processInvestigation(job.data);return {status:200,body:{processed:true}};}
  const event=parse(apiSchema,raw);
  if(!event.path.startsWith('/api/') || event.path.startsWith('//'))throw new ApiError(404,'Endpoint not found.');
  const url=new URL(event.path,'https://private-lambda.invalid');const path=url.pathname;
  // Invocations are protected by AWS IAM. A public HTTP endpoint is deliberately not created.
  if(path==='/api/stripe/webhook' && event.method==='POST')return {status:200,body:await handleStripeWebhook(event.rawBody||'',event.stripeSignature||'')};
  if(!event.user)throw new ApiError(401,'Sign in to continue.','unauthenticated');
  const user=event.user as TrustedUser;
  if(path==='/api/providers/resend')return {status:200,body:event.method==='GET'?await resendStatus(user):await resendAction(user,event.body)};
  if(path==='/api/providers' && event.method==='GET')return {status:200,body:await providerStatus(user)};
  if(path==='/api/providers/stripe/start' && event.method==='POST')return {status:200,body:await startStripeProvider(user,event.oauthBinding)};
  if(path==='/api/providers/stripe/callback' && event.method==='GET')return {status:302,redirect:await finishStripeProvider(user,url,event.oauthBinding)};
  if(path==='/api/providers/stripe' && event.method==='POST')return {status:200,body:await stripeProviderAction(user,event.body)};
  if(path==='/api/providers/supabase/start' && event.method==='POST')return {status:200,body:await startSupabase(user,event.oauthBinding)};
  if(path==='/api/providers/supabase/callback' && event.method==='GET')return {status:302,redirect:await finishSupabase(user,url,event.oauthBinding)};
  if(path==='/api/providers/supabase' && event.method==='POST')return {status:200,body:await supabaseAction(user,event.body)};
  if(path==='/api/runtime' && event.method==='GET')return {status:200,body:{storage:'aws',uploads:'presigned'}};
  if(path==='/api/workspace')return {status:200,body:event.method==='GET'?await getWorkspaceState(user):await executeAction(user,event.body)};
  if(path==='/api/connectors/live'){
   if(event.method==='GET')return {status:200,body:await listManagedConnections(user)};
   if(event.body && typeof event.body==='object' && 'action' in event.body && event.body.action==='import'){
    const action=parseLiveImport(event.body);
    const caseId=await importManagedMerchantCase(user,action.connectionId);
    return {status:200,body:{caseId,state:await getWorkspaceState(user)}};
   }
   return {status:200,body:await executeManagedConnectorAction(user,event.body)};
  }
  if(path==='/api/connectors/install' && event.method==='GET')return {status:200,body:await getConnectorInstallation(user,url.searchParams.get('connectionId')||'')};
  if(path==='/api/connectors'){
   if(event.method==='GET')return {status:200,body:await listEvidenceConnections(user)};
   const result=await executeConnectorAction(user,event.body);
   return {status:200,body:'caseId' in result?{...result,state:await getWorkspaceState(user)}:result};
  }
  if(path==='/api/investigations'){
   if(event.method==='GET')return {status:200,body:url.searchParams.has('caseId')?{run:await getLatestInvestigation(user,parse(id,url.searchParams.get('caseId')))}:{config:await getInvestigationConfig((await requireWorkspace(user)).data.id)}};
   const action=parse(investigationAction,event.body);
   if(action.action==='start')return {status:202,body:{run:await startInvestigation(user,action.caseId,action.mode)}};
   if(action.action==='cancel')return {status:200,body:{run:await cancelInvestigation(user,action.runId)}};
   return {status:200,body:{caseId:await importMerchantCase(user,action.externalCaseId),state:await getWorkspaceState(user)}};
  }
  if(path==='/api/investigations/archive' && event.method==='POST'){const input=parse(archiveSchema,event.body);return {status:200,body:await archiveApprovedCase(user,input.caseId,input.revision)};}
  if(path==='/api/evidence/prepare-upload' && event.method==='POST')return {status:200,body:await prepareUpload(user,event.body)};
  if(path==='/api/evidence/finalize-upload' && event.method==='POST'){const input=parse(finalizeSchema,event.body);await completeUpload(user,input.uploadId);return {status:200,body:await getWorkspaceState(user)};}
  if(path.startsWith('/api/evidence/') && event.method==='GET'){const file=await getDownload(user,parse(id,decodeURIComponent(path.slice('/api/evidence/'.length))));return {status:302,redirect:file.url};}
  if(path.startsWith('/api/stripe/')){
   const workspace=await requireWorkspace(user);const wid=workspace.data.id;
   if(path==='/api/stripe/status' && event.method==='GET')return {status:200,body:{...configuration(wid),integration:await listStripeIntegration(wid)}};
   if(event.method==='POST'){
    if(path==='/api/stripe/connect')return {status:200,body:await connectStripe(wid,user.displayName)};
    if(path==='/api/stripe/disconnect')return {status:200,body:await disconnectStripe(wid,user.displayName)};
    if(path==='/api/stripe/sync')return {status:200,body:await syncStripe(wid,user.displayName)};
    if(path==='/api/stripe/submit')return {status:200,body:await submitStripe(wid,user.displayName,parse(submissionSchema,event.body))};
   }
  }
  throw new ApiError(404,'Endpoint not found.');
 } catch(error) {
  if(error instanceof ApiError)return {status:error.status,body:{error:error.message,code:error.code}};
  console.error(JSON.stringify({event:'request_failed',type:error instanceof Error?error.name:'unknown'}));
  return {status:500,body:{error:'The AWS backend could not complete this request.',code:'server_error'}};
 }
}

export async function handler(raw:unknown) {
 const result=await route(raw);
 if(Buffer.byteLength(JSON.stringify(result))>5*1024*1024)return {status:413,body:{error:'This workspace exceeds the prototype response limit. Narrow the records before loading it.',code:'response_too_large'}};
 return result;
}
