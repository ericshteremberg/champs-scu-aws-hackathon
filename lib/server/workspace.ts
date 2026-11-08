import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { workspaces, cases, evidence, drafts, policies, accessRequests, auditLogs, investigationRuns } from '@/db/schema';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import type { DisputeCase, Evidence, Finding, WorkspaceState, CaseStatus, Draft, InvestigationAnalysis } from '@/lib/domain';
import { DEMO_CASES } from '@/lib/demo';
import { listStripeIntegration } from '@/lib/stripe/service';
import { ApiError, requireWorkspace } from './auth';
import { buildFindings, buildReport } from './report';
import { actionSchema, canReviewAccess } from './validation';
import { evidenceForClient, getInvestigationConfig, serializeInvestigation } from './investigations';
import { reportEvidenceIds } from '@/lib/investigation/report';

export const now = () => new Date().toISOString();
export const newId = (prefix:string) => `${prefix}_${crypto.randomUUID()}`;
export function auditValues(workspaceId:string,user:ChatGPTUser,action:string,detail:string,caseId?:string) { return {id:newId('log'),workspaceId,actor:user.email,action,detail,caseId:caseId??null,createdAt:now()}; }
export async function ownedCase(workspaceId:string,caseId:string) {
 const row=await getDb().select().from(cases).where(and(eq(cases.id,caseId),eq(cases.workspaceId,workspaceId))).get();
 if(!row)throw new ApiError(404,'Case not found.');return row;
}
export function assertMutableCase(row:{status:string}) { if(!['needs_review','investigating','ready'].includes(row.status))throw new ApiError(409,'This case is closed to changes. Its submitted evidence remains unchanged.'); }
export function mutableCaseGuard(workspaceId:string,caseId:string) { return sql`EXISTS (SELECT 1 FROM cases WHERE id = ${caseId} AND workspace_id = ${workspaceId} AND status IN ('needs_review','investigating','ready'))`; }
export function mutableCaseId(workspaceId:string,caseId:string) { return sql`(SELECT id FROM cases WHERE id = ${caseId} AND workspace_id = ${workspaceId} AND status IN ('needs_review','investigating','ready'))`; }
export function resetDraft(workspaceId:string,caseId:string) {
 return getDb().update(drafts).set({status:'draft',approvedAt:null,approvedBy:null,revision:sql`${drafts.revision} + 1`}).where(and(eq(drafts.workspaceId,workspaceId),eq(drafts.caseId,caseId),mutableCaseGuard(workspaceId,caseId)));
}
export async function getWorkspaceState(user:ChatGPTUser):Promise<WorkspaceState> {
 const db=getDb(); const workspace=await db.select().from(workspaces).where(eq(workspaces.ownerId,user.userId)).get();
 const base:WorkspaceState={user:{id:user.userId,email:user.email,name:user.displayName},workspace:workspace??null,cases:[],integrations:[],activity:[],accessRequests:[],policies:[]};
 if(!workspace)return base;
 const [caseRows,evidenceRows,draftRows,policyRows,requestRows,logs,stripe,runRows]=await Promise.all([
 db.select().from(cases).where(eq(cases.workspaceId,workspace.id)).orderBy(desc(cases.createdAt)).limit(500),
 db.select().from(evidence).where(eq(evidence.workspaceId,workspace.id)).limit(5000),
 db.select().from(drafts).where(eq(drafts.workspaceId,workspace.id)).limit(500),
 db.select().from(policies).where(eq(policies.workspaceId,workspace.id)).orderBy(desc(policies.createdAt)).limit(100),
 db.select().from(accessRequests).where(eq(accessRequests.workspaceId,workspace.id)).orderBy(desc(accessRequests.createdAt)).limit(100),
 db.select().from(auditLogs).where(eq(auditLogs.workspaceId,workspace.id)).orderBy(desc(auditLogs.createdAt)).limit(100),
 listStripeIntegration(workspace.id),
 db.select().from(investigationRuns).where(eq(investigationRuns.workspaceId,workspace.id)).orderBy(desc(investigationRuns.startedAt)).limit(500),
 ]);
 base.cases=caseRows.map(row=>{
  const records:Evidence[]=evidenceRows.filter(e=>e.caseId===row.id).map(evidenceForClient);
  const draft=draftRows.find(d=>d.caseId===row.id);
  const latestRun=runRows.find(run=>run.caseId===row.id);
  let analysis:(InvestigationAnalysis & { findings:Finding[] })|undefined;
  if(draft?.analysisJson)try{analysis=JSON.parse(draft.analysisJson);}catch{/* Old or corrupt analysis stays unavailable. */}
  const sourceStale=Boolean(draft && draft.sourceRevision !== null && draft.sourceRevision !== row.dataRevision);
  const findings=analysis && !sourceStale ? analysis.findings : sourceStale ? [{kind:'missing' as const,title:'Source records changed',detail:'Run a new investigation before approving or exporting this draft.',evidenceIds:[]}] : buildFindings(records);
  return {...row,status:row.status as CaseStatus,source:row.source as DisputeCase['source'],stripeDisputeId:row.stripeDisputeId??undefined,evidence:records,findings,
   ...(latestRun?{investigation:serializeInvestigation(latestRun)}:{}),
   ...(draft?{draft:{content:draft.content,status:draft.status as 'draft'|'approved',generatedAt:draft.generatedAt,approvedAt:draft.approvedAt??undefined,approvedBy:draft.approvedBy??undefined,method:draft.method as Draft['method'],revision:draft.revision,analysis,sourceStale}}:{})};
 });
 const investigationConfig=getInvestigationConfig(workspace.id);
 base.integrations=[stripe,
  {id:'bedrock',provider:'bedrock',name:'Amazon Bedrock',status:investigationConfig.bedrockConfigured?'connected':'configuration_required',accountName:investigationConfig.modelId,description:investigationConfig.bedrockConfigured?'Configured for sourced AI investigations. Model access is verified when an investigation runs.':'Configure temporary AWS credentials and a tool-capable model in us-east-1. Sample investigation remains available for sample cases.'},
  {id:'gmail',provider:'gmail',name:'Gmail',status:'configuration_required',description:'Import selected customer emails as evidence. Automatic mailbox access requires a configured OAuth integration.'},
  {id:'database',provider:'database',name:'Company records',status:investigationConfig.merchantConfigured?'connected':'configuration_required',description:investigationConfig.merchantConfigured?'A merchant-owned evidence API is configured for this workspace. Import an approved case to retrieve only its linked records.':'Connect a merchant-owned evidence API with a workspace binding. No database credentials are required.'}];
 base.policies=policyRows;
 base.accessRequests=requestRows.map(r=>({...r,caseId:r.caseId??undefined,status:r.status as 'pending'|'approved'|'denied',reviewedBy:r.reviewedBy??undefined,canReview:r.status==='pending'&&canReviewAccess(r.requestedBy,user.userId)}));
 base.activity=logs.map(l=>({...l,caseId:l.caseId??undefined}));
 return base;
}

export async function executeAction(user:ChatGPTUser,input:unknown):Promise<WorkspaceState> {
 const parsed=actionSchema.safeParse(input);if(!parsed.success)throw new ApiError(400,parsed.error.issues[0]?.message||'Check the submitted fields.','validation_error');
 const action=parsed.data;const db=getDb();
 if(action.action==='createWorkspace'){
  const existing=await db.select().from(workspaces).where(eq(workspaces.ownerId,user.userId)).get();
  if(existing)throw new ApiError(409,'You already have a workspace.');
  const workspaceId=newId('ws');const timestamp=now();
  await db.batch([db.insert(workspaces).values({id:workspaceId,ownerId:user.userId,name:action.name,industry:action.industry,website:action.website,onboardingComplete:true,retentionDays:90,createdAt:timestamp,updatedAt:timestamp}),db.insert(auditLogs).values(auditValues(workspaceId,user,'workspace.created','Workspace created.'))]);
  return getWorkspaceState(user);
 }
 const workspace=await requireWorkspace(user.userId);const wid=workspace.id;
 switch(action.action){
 case 'seedDemo':{
  const existing=await db.select({id:cases.id}).from(cases).where(and(eq(cases.workspaceId,wid),eq(cases.source,'demo')));
  const existingIds=new Set(existing.map(row=>row.id));
  const missing=DEMO_CASES.filter(record=>!existingIds.has(`${wid}_${record.id}`));
  if(!missing.length)break;
  const caseValues=missing.map(c=>({id:`${wid}_${c.id}`,workspaceId:wid,title:c.title,customerName:c.customerName,email:c.email,amount:c.amount,currency:c.currency,status:c.status,reason:c.reason,orderRef:c.orderRef,dueAt:c.dueAt,source:c.source,createdAt:now(),updatedAt:now()}));
  const evidenceValues=missing.flatMap(c=>c.evidence.map(e=>({id:`${wid}_${e.id}`,caseId:`${wid}_${c.id}`,workspaceId:wid,source:e.source,title:e.title,content:e.content,occurredAt:e.occurredAt,reference:e.reference,metadataJson:e.provenance?JSON.stringify(e.provenance):null,createdAt:now()})));
  await db.batch([db.insert(auditLogs).values(auditValues(wid,user,'demo.loaded',`Loaded ${missing.length} clearly labeled synthetic cases.`)),...caseValues.map(value=>db.insert(cases).values(value).onConflictDoNothing()),...evidenceValues.map(value=>db.insert(evidence).values(value).onConflictDoNothing())]);break;
 }
 case 'addCase':{
  const id=newId('case');const timestamp=now();const {action:_action,...fields}=action;
  await db.batch([db.insert(cases).values({...fields,id,workspaceId:wid,source:'manual',status:'needs_review',createdAt:timestamp,updatedAt:timestamp}),db.insert(auditLogs).values(auditValues(wid,user,'case.created','Created a manual case.',id))]);break;
 }
 case 'updateCase':{
  const row=await ownedCase(wid,action.caseId);assertMutableCase(row);
  if(action.status==='ready') { const d=await db.select().from(drafts).where(and(eq(drafts.workspaceId,wid),eq(drafts.caseId,row.id))).get();if(d?.status!=='approved' || (d.sourceRevision!==null && d.sourceRevision!==row.dataRevision))throw new ApiError(409,'Review and approve the draft before marking the case ready.'); }
  await db.batch([db.update(cases).set({...(action.status?{status:action.status}:{}),...(action.title?{title:action.title}:{}),updatedAt:now()}).where(and(eq(cases.workspaceId,wid),eq(cases.id,row.id),mutableCaseGuard(wid,row.id))),db.insert(auditLogs).values(auditValues(wid,user,'case.updated','Updated the case.',row.id))]);break;
 }
 case 'addEvidence':{
  const row=await ownedCase(wid,action.caseId);assertMutableCase(row);const {action:_action,...fields}=action;
  await db.batch([db.insert(evidence).values({...fields,caseId:mutableCaseId(wid,row.id),id:newId('ev'),workspaceId:wid,createdAt:now()}),resetDraft(wid,row.id),db.update(cases).set({status:'needs_review',updatedAt:now()}).where(and(eq(cases.workspaceId,wid),eq(cases.id,row.id),mutableCaseGuard(wid,row.id))),db.insert(auditLogs).values(auditValues(wid,user,'evidence.added','Added a source record; draft approval cleared.',row.id))]);break;
 }
 case 'generateDraft':{
  const row=await ownedCase(wid,action.caseId);assertMutableCase(row);const state=await getWorkspaceState(user);const data=state.cases.find(c=>c.id===row.id)!;
  if(!data.evidence.length)throw new ApiError(409,'Add evidence before assembling a draft.');
  const content=buildReport(data);const generatedAt=now();
  await db.batch([db.insert(drafts).values({caseId:mutableCaseId(wid,row.id),workspaceId:wid,content,status:'draft',generatedAt,method:'evidence_template',revision:1,analysisJson:null,sourceRevision:row.dataRevision}).onConflictDoUpdate({target:drafts.caseId,set:{content,status:'draft',generatedAt,method:'evidence_template',analysisJson:null,sourceRevision:row.dataRevision,approvedAt:null,approvedBy:null,revision:sql`${drafts.revision} + 1`}}),db.update(cases).set({status:'needs_review',updatedAt:now()}).where(and(eq(cases.workspaceId,wid),eq(cases.id,row.id),mutableCaseGuard(wid,row.id))),db.insert(auditLogs).values(auditValues(wid,user,'draft.assembled','Assembled an evidence-template draft for review.',row.id))]);break;
 }
 case 'saveDraft':{
  const row=await ownedCase(wid,action.caseId);assertMutableCase(row);const existing=await db.select().from(drafts).where(and(eq(drafts.workspaceId,wid),eq(drafts.caseId,row.id))).get();
  if(!existing){if(action.revision!==0)throw new ApiError(409,'Refresh the case before saving.');await db.insert(drafts).values({caseId:mutableCaseId(wid,row.id),workspaceId:wid,content:action.content,status:'draft',generatedAt:now(),revision:1,sourceRevision:row.dataRevision});}
  else {
   let analysisJson=existing.analysisJson;
   if(existing.method!=='evidence_template'){
    const attached=await db.select({id:evidence.id}).from(evidence).where(and(eq(evidence.workspaceId,wid),eq(evidence.caseId,row.id)));
    const ids=new Set(attached.map(record=>record.id));
    const analysis=analysisJson?JSON.parse(analysisJson):{findings:[]};
    const citations=reportEvidenceIds({content:action.content,findings:analysis.findings||[]});
    if(citations.some(id=>!ids.has(id)) || (ids.size && !/(?<!\\)\[([^\]\n]{1,240})\]/.test(action.content)))throw new ApiError(422,'Keep valid citations to this case’s evidence in the response.','invalid_citation');
    analysisJson=JSON.stringify({...analysis,evidenceIds:citations,...(analysis.factInventory?{claimControl:'human_edited'}:{})});
   }
   const updated=await db.update(drafts).set({content:action.content,analysisJson,status:'draft',approvedAt:null,approvedBy:null,revision:sql`${drafts.revision} + 1`}).where(and(eq(drafts.workspaceId,wid),eq(drafts.caseId,row.id),eq(drafts.revision,action.revision),mutableCaseGuard(wid,row.id))).returning({id:drafts.caseId});if(!updated.length)throw new ApiError(409,'This draft changed. Refresh it before saving.','stale_draft');}
  await db.batch([db.update(cases).set({status:'needs_review',updatedAt:now()}).where(and(eq(cases.workspaceId,wid),eq(cases.id,row.id),mutableCaseGuard(wid,row.id))),db.insert(auditLogs).values(auditValues(wid,user,'draft.saved','Saved draft changes; prior approval cleared.',row.id))]);break;
 }
 case 'approveDraft':{
  const row=await ownedCase(wid,action.caseId);assertMutableCase(row);const records=await db.select({id:evidence.id}).from(evidence).where(and(eq(evidence.workspaceId,wid),eq(evidence.caseId,row.id))).limit(1);if(!records.length)throw new ApiError(409,'Attach evidence before approval.');
  const approvedAt=now();
  const results=await db.batch([
   db.update(drafts).set({status:'approved',approvedBy:user.userId,approvedAt}).where(and(eq(drafts.workspaceId,wid),eq(drafts.caseId,row.id),eq(drafts.revision,action.revision),sql`(${drafts.sourceRevision} IS NULL OR ${drafts.sourceRevision} = (SELECT data_revision FROM cases WHERE id = ${row.id} AND workspace_id = ${wid}))`,mutableCaseGuard(wid,row.id))).returning({id:drafts.caseId}),
   db.update(cases).set({status:'ready',updatedAt:approvedAt}).where(and(eq(cases.workspaceId,wid),eq(cases.id,row.id),mutableCaseGuard(wid,row.id),sql`EXISTS (SELECT 1 FROM drafts WHERE case_id = ${row.id} AND workspace_id = ${wid} AND revision = ${action.revision} AND status = 'approved' AND approved_at = ${approvedAt})`)),
   db.insert(auditLogs).values(auditValues(wid,user,'draft.approval_requested',`Requested approval of draft revision ${action.revision}. Nothing was submitted to Stripe.`,row.id)),
  ]);
  if(!results[0].length)throw new ApiError(409,'The draft changed or no longer exists. Refresh and review it again.','stale_draft');break;
 }
 case 'requestAccess':{
  if(action.caseId)await ownedCase(wid,action.caseId);
  await db.batch([db.insert(accessRequests).values({id:newId('access'),workspaceId:wid,caseId:action.caseId??null,scope:action.scope,reason:action.reason,status:'pending',requestedBy:user.userId,createdAt:now()}),db.insert(auditLogs).values(auditValues(wid,user,'access.requested','Requested additional access. Independent review is required.',action.caseId))]);break;
 }
 case 'resolveAccess':{
  const request=await db.select().from(accessRequests).where(and(eq(accessRequests.workspaceId,wid),eq(accessRequests.id,action.requestId))).get();if(!request)throw new ApiError(404,'Access request not found.');
  if(!canReviewAccess(request.requestedBy,user.userId))throw new ApiError(403,'You cannot approve or deny your own access request. An independent reviewer is required.','independent_review_required');
  // No reviewer role is provisioned in this initial owner-only workspace model.
  throw new ApiError(403,'Independent reviewer provisioning is required before access can be granted.','reviewer_not_configured');
 }
 case 'saveSettings':{
  await db.batch([db.update(workspaces).set({name:action.name,industry:action.industry,website:action.website,retentionDays:action.retentionDays,updatedAt:now()}).where(and(eq(workspaces.id,wid),eq(workspaces.ownerId,user.userId))),db.insert(auditLogs).values(auditValues(wid,user,'settings.updated','Updated workspace settings and retention preference.'))]);break;
 }
 case 'addPolicy':{
  await db.batch([db.insert(policies).values({id:newId('policy'),workspaceId:wid,name:action.name,content:action.content,effectiveDate:action.effectiveDate,createdAt:now()}),db.insert(auditLogs).values(auditValues(wid,user,'policy.added','Added a versioned policy. This does not grant data access.'))]);break;
 }
 case 'removePolicy':{
  const row=await db.select().from(policies).where(and(eq(policies.workspaceId,wid),eq(policies.id,action.policyId))).get();if(!row)throw new ApiError(404,'Policy not found.');
  await db.batch([db.delete(policies).where(and(eq(policies.workspaceId,wid),eq(policies.id,row.id))),db.insert(auditLogs).values(auditValues(wid,user,'policy.removed','Removed a policy from workspace reference documents.'))]);break;
 }
 }
 return getWorkspaceState(user);
}
