import {requireApiUser,requireWorkspace,assertSameOrigin,errorResponse} from '@/lib/server/auth';
import {disconnectStripe} from '@/lib/stripe/service';
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireApiUser();const workspace=await requireWorkspace(user.userId);return Response.json(await disconnectStripe(workspace.id,user.displayName),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
