import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, buildReport } from '../lib/server/report.ts';
import { validateUpload } from '../lib/server/uploads.ts';
import { actionSchema, canReviewAccess } from '../lib/server/validation.ts';
const record=(id,source,title,content)=>({id,caseId:'case-1',source,title,content,occurredAt:'2026-10-17T10:00:00.000Z',reference:id});
test('carrier delivery and a customer denial remain conflicting evidence',()=>{
 const evidence=[record('e1','database','Carrier marked delivered','No recipient signature is attached.'),record('e2','gmail','Customer email','My order never arrived.')];
 const findings=buildFindings(evidence);
 assert.equal(findings.filter(f=>f.kind==='conflict').length,1);
 assert.deepEqual(findings.find(f=>f.kind==='conflict').evidenceIds,['e1','e2']);
 assert.ok(findings.some(f=>f.kind==='missing'&&f.title.includes('Recipient')));
 const draft=buildReport({title:'Product not received',customerName:'Alex',amount:24800,currency:'usd',reason:'product_not_received',orderRef:'#1048',evidence});
 assert.match(draft,/\$248\.00/);assert.match(draft,/NOT SUBMITTED/);assert.match(draft,/has not been independently verified/);assert.match(draft,/Sources: \[1\], \[2\]/);
});
test('no evidence produces a missing finding rather than invented support',()=>{assert.deepEqual(buildFindings([]),[{kind:'missing',title:'No evidence attached',detail:'Add relevant records before preparing a response.',evidenceIds:[]}]);});
test('access request cannot be self-reviewed',()=>{assert.equal(canReviewAccess('alice','alice'),false);assert.equal(canReviewAccess('alice','bob'),true);});
test('mutations reject invalid money, dates, closed status and stale-approval missing revision',()=>{
 const valid={action:'addCase',title:'A dispute',customerName:'Alex',amount:100,currency:'USD',reason:'duplicate',dueAt:'2026-11-15'};
 assert.equal(actionSchema.safeParse(valid).success,true);
 assert.equal(actionSchema.safeParse({...valid,amount:-100}).success,false);
 assert.equal(actionSchema.safeParse({...valid,dueAt:'not-a-date'}).success,false);
 assert.equal(actionSchema.safeParse({action:'updateCase',caseId:'a',status:'submitted'}).success,false);
 assert.equal(actionSchema.safeParse({action:'approveDraft',caseId:'a'}).success,false);
});
test('file upload validates actual content instead of trusting MIME claims',()=>{
 assert.throws(()=>validateUpload('bad.html','application/pdf',new TextEncoder().encode('<script>alert(1)</script>')));
 assert.throws(()=>validateUpload('bad.pdf','application/pdf',new TextEncoder().encode('not a PDF')));
 assert.throws(()=>validateUpload('bad.json','application/json',new TextEncoder().encode('{bad')));
 assert.throws(()=>validateUpload('large.txt','text/plain',new Uint8Array(10*1024*1024+1)));
 const text=validateUpload('../order.txt','image/png',new TextEncoder().encode('Approved shipment record'));
 assert.equal(text.fileName,'.._order.txt');assert.equal(text.mimeType,'text/plain');assert.equal(text.textContent,'Approved shipment record');
});
