import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { evidence, cases, auditLogs } from '@/db/schema';
import { requireApiUser, requireWorkspace, assertSameOrigin, errorResponse, readLimitedBody, ApiError } from '@/lib/server/auth';
import { ownedCase, assertMutableCase, mutableCaseId, mutableCaseGuard, newId, now, resetDraft, auditValues, getWorkspaceState } from '@/lib/server/workspace';
import { validateUpload, UploadValidationError } from '@/lib/server/uploads';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 try{
  assertSameOrigin(request);const user=await requireApiUser();const workspace=await requireWorkspace(user.userId);
  if(!env.BUCKET)throw new ApiError(503,'Attachment storage is not configured. Add a text evidence record instead.','storage_unavailable');
  const data=await readLimitedBody(request,10*1024*1024+65536);
  let form:FormData;try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')||''},body:data.buffer as ArrayBuffer}).formData();}catch{throw new ApiError(400,'Send the attachment using multipart form data.');}
  const caseId=String(form.get('caseId')||'');const row=await ownedCase(workspace.id,caseId);assertMutableCase(row);
  const file=form.get('file');if(!(file instanceof File))throw new ApiError(400,'Choose a file to attach.');
  const bytes=new Uint8Array(await file.arrayBuffer());let checked;try{checked=validateUpload(file.name,file.type,bytes);}catch(e){if(e instanceof UploadValidationError)throw new ApiError(400,e.message,'invalid_attachment');throw e;}
  const title=String(form.get('title')||checked.fileName).trim().slice(0,160);if(title.length<2)throw new ApiError(400,'Give this evidence a title.');
  const sourceInput=String(form.get('source')||'manual');const source=['stripe','gmail','database','policy','manual'].includes(sourceInput)?sourceInput:'manual';
  const id=newId('ev');const fileKey=`${workspace.id}/${row.id}/${id}`;const timestamp=now();
  await env.BUCKET.put(fileKey,bytes,{httpMetadata:{contentType:checked.mimeType}});
  try{
   const db=getDb();await db.batch([
    db.insert(evidence).values({id,workspaceId:workspace.id,caseId:mutableCaseId(workspace.id,row.id),source,title,content:checked.textContent||'Attachment uploaded. Review the original file; its contents have not been extracted.',occurredAt:timestamp,reference:`Uploaded file · ${checked.fileName}`,fileKey,fileName:checked.fileName,mimeType:checked.mimeType,createdAt:timestamp}),
    resetDraft(workspace.id,row.id),
    db.update(cases).set({status:'needs_review',updatedAt:timestamp}).where(and(eq(cases.workspaceId,workspace.id),eq(cases.id,row.id),mutableCaseGuard(workspace.id,row.id))),
    db.insert(auditLogs).values(auditValues(workspace.id,user,'evidence.uploaded','Attached a file; draft approval cleared.',row.id)),
   ]);
  }catch(e){await env.BUCKET.delete(fileKey);throw e;}
  return Response.json(await getWorkspaceState(user),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
