import type Stripe from 'stripe';
import type { CaseStatus } from '@/lib/domain';

export function disputeStatus(status: string): CaseStatus {
 if(status==='won' || status==='warning_closed') return 'won';
 if(status==='lost') return 'lost';
 if(status==='under_review' || status==='warning_under_review' || status==='appeal_under_review') return 'submitted';
 return 'needs_review';
}
export function normalizeDispute(dispute: Stripe.Dispute, workspaceId: string, accountId: string) {
 const timestamp=new Date().toISOString();
 return {
  id:`stripe_${workspaceId}_${dispute.id}`,workspaceId,stripeDisputeId:dispute.id,stripeAccountId:accountId,source:'stripe',
  title:dispute.reason.replaceAll('_',' '),customerName:dispute.evidence.customer_name || 'Stripe customer',
  email:dispute.evidence.customer_email_address || '',amount:dispute.amount,currency:dispute.currency,
  status:disputeStatus(dispute.status),reason:dispute.reason,orderRef:dispute.metadata.order_id || '',
  dueAt:dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by*1000).toISOString() : '',
  createdAt:new Date(dispute.created*1000).toISOString(),updatedAt:timestamp,
 };
}
export function submissionEligibility(input:{source:string;status:string;draftStatus?:string;revision?:number;requestedRevision:number;confirmed:boolean;sourceRevision?:number|null;dataRevision?:number}) {
 if(input.source!=='stripe') return 'Only imported Stripe disputes can be submitted.';
 if(!input.confirmed) return 'Confirm the exact response before submission.';
 if(input.sourceRevision!=null && input.sourceRevision!==input.dataRevision) return 'The evidence changed. Run the investigation again and review the current response.';
 if(input.draftStatus!=='approved') return 'Approve the response before submission.';
 if(input.revision!==input.requestedRevision) return 'The response changed. Review and approve the current revision.';
 if(input.status==='submitting') return 'A submission is being verified. Check its Stripe status before taking further action.';
 if(input.status!=='ready') return 'The reviewed response must be marked ready before submission.';
 return null;
}

export function accountBindingError(stored:{accountId:string;mode:string},actualAccountId:string,actualMode:string){
 if(stored.accountId!==actualAccountId)return 'The configured key belongs to a different Stripe account. Reconnect the correct account.';
 if(stored.mode!==actualMode)return 'The configured Stripe environment changed. Reconnect the correct environment.';
 return null;
}
export async function performClaimedSubmission<T>(operations:{claim:()=>Promise<boolean>;send:()=>Promise<T>;settle:(result:T)=>Promise<void>;uncertain:()=>Promise<void>}) {
 if(!await operations.claim())return {claimed:false as const};
 try { const result=await operations.send();await operations.settle(result);return {claimed:true as const,result}; }
 catch(error){try{await operations.uncertain();}catch{/* Keep the persisted claim even if audit writing fails. */}throw error;}
}
