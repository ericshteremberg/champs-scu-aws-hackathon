import {requireApiUser,requireWorkspace,errorResponse} from '@/lib/server/auth';
import {configuration,listStripeIntegration} from '@/lib/stripe/service';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await requireApiUser();const workspace=await requireWorkspace(user.userId);return Response.json({...configuration(workspace.id),integration:await listStripeIntegration(workspace.id)},{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
