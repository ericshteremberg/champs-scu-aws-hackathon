import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { evidence } from '@/db/schema';
import { requireApiUser, requireWorkspace, errorResponse, ApiError } from '@/lib/server/auth';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const user=await requireApiUser();const workspace=await requireWorkspace(user.userId);const {id}=await params;
  const record=await getDb().select().from(evidence).where(and(eq(evidence.id,id),eq(evidence.workspaceId,workspace.id))).get();
  if(!record?.fileKey)throw new ApiError(404,'Attachment not found.');
  if(!env.BUCKET)throw new ApiError(503,'Attachment storage is unavailable.');
  const object=await env.BUCKET.get(record.fileKey);if(!object)throw new ApiError(404,'Attachment not found.');
  return new Response(object.body,{headers:{'Content-Type':record.mimeType||'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(record.fileName||'attachment')}`,'Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch(error){return errorResponse(error);}
}
