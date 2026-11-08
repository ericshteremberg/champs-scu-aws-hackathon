import { errorResponse,readLimitedBody,ApiError } from '@/lib/server/auth';
import { handleStripeWebhook } from '@/lib/stripe/service';
export async function POST(request:Request){try{
 const signature=request.headers.get('stripe-signature');
 if(!signature)throw new ApiError(400,'Missing webhook signature.');
 const raw=new TextDecoder().decode(await readLimitedBody(request,2*1024*1024));
 return Response.json(await handleStripeWebhook(raw,signature));
}catch(error){return errorResponse(error);}}
