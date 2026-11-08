import { and, eq } from 'drizzle-orm';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { z } from 'zod';
import { getDb } from '@/db';
import { cases, drafts, evidence, auditLogs } from '@/db/schema';
import { ApiError, assertSameOrigin, errorResponse, readLimitedBody, requireApiUser, requireWorkspace } from '@/lib/server/auth';
import { evidenceForClient, readInvestigationSecrets } from '@/lib/server/investigations';

export const dynamic = 'force-dynamic';
const inputSchema = z.object({ caseId:z.string().min(1).max(200), revision:z.number().int().positive() }).strict();

export async function POST(request: Request) {
 try {
  assertSameOrigin(request);
  const user = await requireApiUser();
  const workspace = await requireWorkspace(user.userId);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(await readLimitedBody(request,4096))); }
  catch(error) { if(error instanceof ApiError) throw error; throw new ApiError(400,'Send a valid archive request.'); }
  const parsed = inputSchema.safeParse(body);
  if(!parsed.success) throw new ApiError(400,'Select an approved case and its current response revision.');
  const {caseId,revision} = parsed.data;
  const db = getDb();
  const item = await db.select().from(cases).where(and(eq(cases.id,caseId),eq(cases.workspaceId,workspace.id))).get();
  if(!item) throw new ApiError(404,'Case not found.');
  const draft = await db.select().from(drafts).where(and(eq(drafts.caseId,caseId),eq(drafts.workspaceId,workspace.id))).get();
  if(!draft || draft.status!=='approved' || draft.revision!==revision || (draft.sourceRevision!=null && draft.sourceRevision!==item.dataRevision)) throw new ApiError(409,'Review and approve the current evidence and response before archiving.','stale_archive');
  const settings = readInvestigationSecrets();
  if(!settings.credentials || !settings.archiveBucket || settings.region!=='us-east-1') throw new ApiError(503,'Configure AWS credentials and a private S3 evidence bucket first.','archive_not_configured');
  const records = await db.select().from(evidence).where(and(eq(evidence.caseId,caseId),eq(evidence.workspaceId,workspace.id))).limit(101);
  if(records.length>100) throw new ApiError(409,'This case exceeds the archive record limit. Export and review its complete evidence manually.');
  records.sort((a,b)=>a.id.localeCompare(b.id));
  const packet = {
   schemaVersion:1,workspaceId:workspace.id,case:{id:item.id,title:item.title,source:item.source,reason:item.reason,orderRef:item.orderRef,amount:item.amount,currency:item.currency,dataRevision:item.dataRevision},
   response:{revision:draft.revision,content:draft.content,method:draft.method,approvedAt:draft.approvedAt,approvedBy:draft.approvedBy,analysis:draft.analysisJson?JSON.parse(draft.analysisJson):null},
   evidence:records.map(evidenceForClient),
   limitations:['This is an approved response and evidence metadata snapshot, not a Stripe submission.','Original file bytes remain in private R2 storage; this packet contains attachment references only.'],
  };
  const serialized = JSON.stringify(packet,null,2);
  const bytes = new TextEncoder().encode(serialized);
  if(bytes.byteLength>1_000_000) throw new ApiError(413,'The evidence packet exceeds the 1 MB archive limit.');
  // Check the snapshot after reading all evidence. Any concurrent change invalidates this export.
  const latest = await db.select({dataRevision:cases.dataRevision,revision:drafts.revision,status:drafts.status,approvedAt:drafts.approvedAt}).from(cases).innerJoin(drafts,eq(drafts.caseId,cases.id)).where(and(eq(cases.id,caseId),eq(cases.workspaceId,workspace.id))).get();
  if(!latest || latest.dataRevision!==item.dataRevision || latest.revision!==revision || latest.status!=='approved' || latest.approvedAt!==draft.approvedAt) throw new ApiError(409,'The case changed while preparing its archive. Refresh and review the latest response.','stale_archive');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const key = `workspaces/${encodeURIComponent(workspace.id)}/cases/${encodeURIComponent(caseId)}/revision-${revision}/${sha256}.json`;
  const client = new S3Client({region:settings.region,credentials:settings.credentials,requestHandler:new FetchHttpHandler(),maxAttempts:1});
  try {
   await client.send(new PutObjectCommand({Bucket:settings.archiveBucket,Key:key,Body:bytes,ContentType:'application/json',ServerSideEncryption:'AES256',IfNoneMatch:'*',Metadata:{sha256,revision:String(revision)}}),{abortSignal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
  } catch(error) {
   // A retry of the exact same content-addressed snapshot is already archived.
   if(!(error && typeof error==='object' && '$metadata' in error && (error.$metadata as {httpStatusCode?:number})?.httpStatusCode===412)) throw new ApiError(502,'The archive could not be confirmed. Check the AWS configuration and retry.','archive_failed');
  } finally { client.destroy(); }
  await db.insert(auditLogs).values({id:crypto.randomUUID(),workspaceId:workspace.id,caseId,actor:user.userId,action:'evidence.archived',detail:`Archived approved response revision ${revision} and evidence snapshot to private S3 (${sha256}).`,createdAt:new Date().toISOString()});
  return Response.json({archived:true,key,sha256},{headers:{'Cache-Control':'no-store'}});
 } catch(error) { return errorResponse(error); }
}
