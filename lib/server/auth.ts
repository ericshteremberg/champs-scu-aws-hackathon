import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { workspaces } from '@/db/schema';
import { eq } from 'drizzle-orm';
export class ApiError extends Error { constructor(public status: number, message: string, public code = 'request_failed') { super(message); } }
export async function requireApiUser() {
 const user = await getChatGPTUser();
 if (!user) throw new ApiError(401, 'Sign in to continue.', 'unauthenticated');
 return user;
}
export async function requireWorkspace(userId: string) {
 const workspace = await getDb().select().from(workspaces).where(eq(workspaces.ownerId,userId)).get();
 if (!workspace) throw new ApiError(409, 'Create your workspace first.', 'workspace_required');
 return workspace;
}
export function assertSameOrigin(request: Request) {
 const origin = request.headers.get('origin');
 if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403,'This request must originate from Causality.','origin_rejected');
}
export function errorResponse(error: unknown) {
 if (error instanceof ApiError) return Response.json({error:error.message,code:error.code},{status:error.status,headers:{'Cache-Control':'no-store'}});
 return Response.json({error:'The request could not be completed. Please try again.',code:'server_error'},{status:500,headers:{'Cache-Control':'no-store'}});
}
export async function readLimitedBody(request: Request, limit: number) {
 if (Number(request.headers.get('content-length') || 0) > limit) throw new ApiError(413,'The request is too large.');
 if (!request.body) return new Uint8Array();
 const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let total=0;
 while (true) { const {done,value}=await reader.read(); if(done)break; total+=value.length;if(total>limit){await reader.cancel();throw new ApiError(413,'The request is too large.');}chunks.push(value); }
 const data=new Uint8Array(total);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}return data;
}
