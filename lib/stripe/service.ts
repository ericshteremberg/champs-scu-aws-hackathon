import Stripe from 'stripe';
import { env } from 'cloudflare:workers';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { cases,evidence,drafts,stripeConnections,stripeEvents,auditLogs } from '@/db/schema';
import type { Integration } from '@/lib/domain';
import { ApiError } from '@/lib/server/auth';
import { normalizeDispute, submissionEligibility, accountBindingError, performClaimedSubmission } from './model';

type StripeEnv={STRIPE_RESTRICTED_KEY?:string;STRIPE_WORKSPACE_ID?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_ALLOW_LIVE?:string;STRIPE_ENABLE_SUBMISSION?:string};
const settings=()=>env as Cloudflare.Env & StripeEnv;
const configuredMode=()=>settings().STRIPE_RESTRICTED_KEY?.startsWith('rk_live_')?'live':'test';
export function configuration(workspaceId:string) {
 const e=settings();const missing=[] as string[];
 if(!e.STRIPE_RESTRICTED_KEY)missing.push('STRIPE_RESTRICTED_KEY');
 if(e.STRIPE_WORKSPACE_ID!==workspaceId)missing.push('STRIPE_WORKSPACE_ID');
 return {configured:missing.length===0,requiredConfiguration:missing,submissionEnabled:e.STRIPE_ENABLE_SUBMISSION==='true',webhookConfigured:!!e.STRIPE_WEBHOOK_SECRET,workspaceId};
}
function stripeClient(workspaceId:string) {
 const e=settings();
 if(!configuration(workspaceId).configured)throw new ApiError(503,'Stripe is not connected. Configure a restricted API key and this workspace ID on the server.','stripe_configuration_required');
 const key=e.STRIPE_RESTRICTED_KEY!;
 if(!/^rk_(test|live)_/.test(key))throw new ApiError(503,'Use a restricted Stripe API key for this integration.','stripe_configuration_required');
 if(key.startsWith('rk_live_')&&e.STRIPE_ALLOW_LIVE!=='true')throw new ApiError(403,'Live Stripe access is disabled for this deployment.','stripe_live_disabled');
 return new Stripe(key,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2,timeout:15000});
}
export async function listStripeIntegration(workspaceId:string):Promise<Integration> {
 const connection=await getDb().select().from(stripeConnections).where(eq(stripeConnections.workspaceId,workspaceId)).get();
 const connected=connection?.connected&&configuration(workspaceId).configured&&connection.mode===configuredMode();
 return {id:'stripe',provider:'stripe',name:'Stripe',status:connected?'connected':'configuration_required',mode:connected?connection.mode as 'test'|'live':undefined,accountName:connected?connection.accountName:undefined,lastSyncAt:connection?.lastSyncAt??undefined,description:connected?'Dispute records are imported from your connected account.':'Connect your Stripe account when you are ready. Server configuration is required; no account is connected.'};
}
export async function connectStripe(workspaceId:string,actor:string) {
 const stripe=stripeClient(workspaceId);const account=await stripe.accounts.retrieveCurrent();const mode=configuredMode();
 const existing=await getDb().select().from(stripeConnections).where(eq(stripeConnections.workspaceId,workspaceId)).get();
 if(existing&&(existing.accountId!==account.id||existing.mode!==mode))throw new ApiError(409,'This workspace is already bound to a different Stripe account or environment. Use a separate workspace.','stripe_account_mismatch');
 await stripe.disputes.list({limit:1});
 const value={workspaceId,accountId:account.id,accountName:account.business_profile?.name||account.settings?.dashboard?.display_name||'Stripe account',mode,connected:true,createdAt:new Date().toISOString()};
 await getDb().insert(stripeConnections).values(value).onConflictDoUpdate({target:stripeConnections.workspaceId,set:value});
 await audit(workspaceId,actor,'stripe.connected',`Connected ${mode} Stripe account.`);return {connected:true};
}
async function connectionFor(workspaceId:string) {
 const connection=await getDb().select().from(stripeConnections).where(and(eq(stripeConnections.workspaceId,workspaceId),eq(stripeConnections.connected,true))).get();
 if(!connection)throw new ApiError(409,'Connect Stripe before importing disputes.','stripe_not_connected');return connection;
}
async function verifiedConnection(workspaceId:string) {
 const connection=await connectionFor(workspaceId),stripe=stripeClient(workspaceId);
 const account=await stripe.accounts.retrieveCurrent();const invalid=accountBindingError(connection,account.id,configuredMode());
 if(invalid)throw new ApiError(409,invalid,'stripe_account_mismatch');return {connection,stripe};
}
function disputeWrites(dispute:Stripe.Dispute,workspaceId:string,accountId:string,eventId?:string) {
 const db=getDb(),value=normalizeDispute(dispute,workspaceId,accountId),evidenceId=`${value.id}_stripe`;
 const content=`Stripe dispute ${dispute.id}\nDisputed amount: ${dispute.amount} minor units ${dispute.currency.toUpperCase()}\nReason: ${dispute.reason}\nStripe status: ${dispute.status}\nCharge: ${typeof dispute.charge==='string'?dispute.charge:dispute.charge?.id??'Unavailable'}\nThis record establishes the payment dispute, not proof of delivery.`;
 const notProcessed=eventId?sql`NOT EXISTS (SELECT 1 FROM stripe_events WHERE id = ${eventId})`:sql`1 = 1`;
 const changed=sql`NOT EXISTS (SELECT 1 FROM evidence WHERE id = ${evidenceId} AND content = ${content})`;
 return [
  // This runs before replacing the original source, so unchanged syncs do not revoke approval.
  db.update(drafts).set({status:'draft',approvedBy:null,approvedAt:null,revision:sql`${drafts.revision} + 1`}).where(and(eq(drafts.workspaceId,workspaceId),eq(drafts.caseId,value.id),notProcessed,changed,sql`${value.status} NOT IN ('submitted','won','lost')`,sql`EXISTS (SELECT 1 FROM cases WHERE id = ${value.id} AND workspace_id = ${workspaceId} AND status IN ('needs_review','investigating','ready'))`)),
  db.insert(cases).values(value).onConflictDoUpdate({target:[cases.workspaceId,cases.stripeDisputeId],set:{amount:value.amount,currency:value.currency,dueAt:value.dueAt,updatedAt:value.updatedAt,status:sql`CASE WHEN ${cases.status} IN ('won','lost') THEN ${cases.status} WHEN ${value.status} IN ('submitted','won','lost') THEN ${value.status} WHEN ${cases.status} IN ('submitting','submitted') THEN ${cases.status} WHEN ${changed} THEN ${value.status} ELSE ${cases.status} END`},setWhere:notProcessed}),
  db.insert(evidence).values({id:evidenceId,workspaceId,caseId:value.id,source:'stripe',title:'Stripe dispute record',content,occurredAt:value.createdAt,reference:dispute.id,createdAt:value.updatedAt}).onConflictDoUpdate({target:evidence.id,set:{content},setWhere:and(notProcessed,sql`EXISTS (SELECT 1 FROM cases WHERE id = ${value.id} AND status != 'submitting')`)}),
 ] as const;
}
export async function syncStripe(workspaceId:string,actor:string) {
 const {connection,stripe}=await verifiedConnection(workspaceId);
 const page=await stripe.disputes.list({limit:50,...(connection.nextCursor?{starting_after:connection.nextCursor}:{})});
 for(const dispute of page.data){if(dispute.livemode!==(connection.mode==='live'))throw new ApiError(409,'Stripe environment does not match the connected account.');await getDb().batch(disputeWrites(dispute,workspaceId,connection.accountId));}
 await getDb().update(stripeConnections).set({lastSyncAt:new Date().toISOString(),nextCursor:page.has_more?page.data.at(-1)!.id:null}).where(eq(stripeConnections.workspaceId,workspaceId));
 await audit(workspaceId,actor,'stripe.synced',`Imported ${page.data.length} dispute records${page.has_more?'; another page is available':''}.`);return {imported:page.data.length,hasMore:page.has_more};
}
export async function disconnectStripe(workspaceId:string,actor:string) {
 await getDb().update(stripeConnections).set({connected:false,nextCursor:null}).where(eq(stripeConnections.workspaceId,workspaceId));
 await audit(workspaceId,actor,'stripe.disconnected','Disconnected Stripe. Previously imported evidence is retained.');return {disconnected:true};
}
export async function submitStripe(workspaceId:string,actor:string,input:{caseId:string;confirmed:boolean;draftRevision:number}) {
 if(settings().STRIPE_ENABLE_SUBMISSION!=='true')throw new ApiError(409,'Stripe submission is disabled. Export the reviewed response for now.','submission_disabled');
 const db=getDb(),{connection,stripe}=await verifiedConnection(workspaceId);
 const row=await db.select().from(cases).where(and(eq(cases.id,input.caseId),eq(cases.workspaceId,workspaceId))).get();if(!row)throw new ApiError(404,'Case not found.');
 const draft=await db.select().from(drafts).where(and(eq(drafts.caseId,row.id),eq(drafts.workspaceId,workspaceId))).get();
 const invalid=submissionEligibility({source:row.source,status:row.status,draftStatus:draft?.status,revision:draft?.revision,requestedRevision:input.draftRevision,confirmed:input.confirmed});if(invalid)throw new ApiError(409,invalid);
 if(!row.stripeDisputeId||row.stripeAccountId!==connection.accountId)throw new ApiError(409,'The case belongs to a different Stripe account.');
 if(draft!.content.length>20000)throw new ApiError(409,'Stripe accepts at most 20,000 characters in this text response. Shorten and review the draft again.');
 const attachment=await db.select({id:evidence.id}).from(evidence).where(and(eq(evidence.workspaceId,workspaceId),eq(evidence.caseId,row.id),sql`${evidence.fileKey} IS NOT NULL`)).limit(1);
 if(attachment.length)throw new ApiError(409,'This integration currently submits text responses only. Export this case and include its supporting files in Stripe Dashboard.','attachment_submission_required');
 const disputeId=row.stripeDisputeId;
 const current=await stripe.disputes.retrieve(disputeId);
 if(current.livemode!==(connection.mode==='live'))throw new ApiError(409,'Stripe environment does not match the connected account.');
 if(!['needs_response','warning_needs_response'].includes(current.status)||current.evidence_details.past_due)throw new ApiError(409,'Stripe is no longer accepting this dispute response.');
 try{
  const result=await performClaimedSubmission({
   claim:async()=>{
    const claimed=await db.update(cases).set({status:'submitting',updatedAt:new Date().toISOString()}).where(and(eq(cases.id,row.id),eq(cases.workspaceId,workspaceId),eq(cases.status,'ready'),sql`EXISTS (SELECT 1 FROM drafts WHERE case_id = ${row.id} AND workspace_id = ${workspaceId} AND status = 'approved' AND revision = ${input.draftRevision})`)).returning({id:cases.id});return claimed.length===1;
   },
   send:()=>stripe.disputes.update(disputeId,{evidence:{uncategorized_text:draft!.content},submit:true},{idempotencyKey:`causality:${workspaceId}:${row.id}:revision:${input.draftRevision}`}),
   settle:async(updated)=>{await db.batch(disputeWrites(updated,workspaceId,connection.accountId));await audit(workspaceId,actor,'stripe.submitted',`Submitted approved response revision ${input.draftRevision}.`,row.id);},
   uncertain:()=>audit(workspaceId,actor,'stripe.submission_verification_required',`Could not confirm the result for revision ${input.draftRevision}. Case stays locked until Stripe status is verified.`,row.id),
  });
  if(!result.claimed)throw new ApiError(409,'This case changed or another submission started. Refresh and review its current status.','stale_submission');
  return {submitted:true,stripeStatus:result.result.status};
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(502,'The submission result could not be confirmed. The case is locked to prevent duplicate or changed submissions. Check Stripe Dashboard and sync its status.','submission_verification_required');}
}
export async function handleStripeWebhook(body:string,signature:string) {
 const e=settings(),workspaceId=e.STRIPE_WORKSPACE_ID;
 if(!workspaceId||!e.STRIPE_WEBHOOK_SECRET)throw new ApiError(503,'Webhook configuration is incomplete.');
 const stripe=stripeClient(workspaceId);let event:Stripe.Event;
 try{event=await stripe.webhooks.constructEventAsync(body,signature,e.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());}catch{throw new ApiError(400,'Invalid webhook signature.','invalid_signature');}
 if(!event.type.startsWith('charge.dispute.'))return {received:true,ignored:true};
 const {connection}=await verifiedConnection(workspaceId);
 if((event.account&&event.account!==connection.accountId)||event.livemode!==(connection.mode==='live'))throw new ApiError(400,'Webhook account or environment mismatch.');
 const db=getDb();if(await db.select().from(stripeEvents).where(eq(stripeEvents.id,event.id)).get())return {received:true,duplicate:true};
 const object=event.data.object as Stripe.Dispute;const latest=await stripe.disputes.retrieve(object.id);
 if(latest.livemode!==(connection.mode==='live'))throw new ApiError(400,'Stripe environment mismatch.');
 // D1 batches are atomic. Every write is guarded by the event ID, inserted last,
 // so concurrent delivery cannot invalidate the same draft revision twice.
 await db.batch([...disputeWrites(latest,workspaceId,connection.accountId,event.id),db.insert(stripeEvents).values({id:event.id,workspaceId,accountId:connection.accountId,eventType:event.type,processedAt:new Date().toISOString()}).onConflictDoNothing()]);
 return {received:true};
}
async function audit(workspaceId:string,actor:string,action:string,detail:string,caseId?:string){await getDb().insert(auditLogs).values({id:crypto.randomUUID(),workspaceId,actor,action,detail,caseId,createdAt:new Date().toISOString()});}
