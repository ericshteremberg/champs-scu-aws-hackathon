import { requireApiUser, assertSameOrigin, errorResponse, readLimitedBody, ApiError } from '@/lib/server/auth';
import { getWorkspaceState, executeAction } from '@/lib/server/workspace';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await requireApiUser();return Response.json(await getWorkspaceState(user),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireApiUser();let input:unknown;try{input=JSON.parse(new TextDecoder().decode(await readLimitedBody(request,65536)));}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'Send a valid JSON request.');}return Response.json(await executeAction(user,input),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
