import { z } from 'zod';
import { requireApiUser,requireWorkspace,assertSameOrigin,errorResponse,readLimitedBody,ApiError } from '@/lib/server/auth';
import { submitStripe } from '@/lib/stripe/service';
export async function POST(request:Request){
 try {
  assertSameOrigin(request);const user=await requireApiUser(),workspace=await requireWorkspace(user.userId);
  const schema=z.object({caseId:z.string().min(1).max(250),confirmed:z.literal(true),draftRevision:z.number().int().positive()});
  let parsed;try{parsed=schema.safeParse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request,8192))));}catch{throw new ApiError(400,'Invalid submission request.');}
  if(!parsed.success)throw new ApiError(400,'Confirm the approved draft revision before submission.');
  return Response.json(await submitStripe(workspace.id,user.displayName,parsed.data),{headers:{'Cache-Control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
