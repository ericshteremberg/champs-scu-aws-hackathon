import type { DisputeCase, Evidence, Finding } from '../domain';
import { formatMoney } from '../money.ts';
export function buildFindings(evidence: Evidence[]): Finding[] {
 const findings: Finding[]=[];
 if (!evidence.length) return [{kind:'missing',title:'No evidence attached',detail:'Add relevant records before preparing a response.',evidenceIds:[]}];
 findings.push({kind:'supported',title:'Source records collected',detail:`${evidence.length} record${evidence.length===1?' is':'s are'} available for review. Source statements still need verification.`,evidenceIds:evidence.map(e=>e.id)});
 const delivery=evidence.filter(e=>/marked delivered|delivery scan|delivery recorded/i.test(e.title+' '+e.content));
 const denial=evidence.filter(e=>/never arrived|not received|did not receive|denies receipt/i.test(e.title+' '+e.content));
 if(delivery.length&&denial.length) findings.push({kind:'conflict',title:'Delivery and receipt accounts differ',detail:'A delivery record and a customer denial appear in the evidence. A carrier scan alone does not establish receipt by the customer.',evidenceIds:[...delivery,...denial].map(e=>e.id)});
 const confirmation=evidence.filter(e=>/signed by|recipient signature attached|delivery photograph attached/i.test(e.content));
 if(delivery.length&&!confirmation.length) findings.push({kind:'missing',title:'Recipient confirmation is unresolved',detail:'No attached record explicitly identifies a recipient signature or delivery photograph. Request confirmation before deciding how to respond.',evidenceIds:delivery.map(e=>e.id)});
 if(!evidence.some(e=>e.source==='stripe')) findings.push({kind:'missing',title:'Payment source is missing',detail:'Attach the relevant payment or dispute record.',evidenceIds:[]});
 return findings;
}
export function buildReport(caseData: Pick<DisputeCase,'title'|'customerName'|'amount'|'currency'|'reason'|'orderRef'|'evidence'>): string {
 const {evidence}=caseData;
 const amount=formatMoney(caseData.amount,caseData.currency);
 const findings=buildFindings(evidence);
 const timeline=[...evidence].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
 return [`MERCHANT REVIEW DRAFT — NOT SUBMITTED`,`${caseData.title}\nCustomer: ${caseData.customerName}\nOrder: ${caseData.orderRef||'Not specified'}\nAmount disputed: ${amount}\nReason: ${caseData.reason}`,
 'This draft was assembled from the attached records using an evidence template. It has not been independently verified or analyzed by a language model.',
 'SOURCE TIMELINE\n'+timeline.map((e,i)=>`[${i+1}] ${e.occurredAt} · ${e.title} · ${e.source}\nReference: ${e.reference||e.id}\n${e.content.slice(0,4000)||'Attachment requires manual review; its contents have not been extracted.'}`).join('\n\n'),
 'FINDINGS AND OPEN QUESTIONS\n'+findings.map(f=>`${f.kind.toUpperCase()}: ${f.title}\n${f.detail}${f.evidenceIds.length?'\nSources: '+f.evidenceIds.map(id=>'['+(timeline.findIndex(e=>e.id===id)+1)+']').join(', '):''}`).join('\n\n'),
 'MERCHANT REVIEW\nCheck each statement against the original source, resolve contradictions, and include the necessary supporting attachments. Approval does not submit the response. The issuing bank decides the dispute outcome.'
 ].join('\n\n');
}
