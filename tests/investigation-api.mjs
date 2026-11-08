import assert from 'node:assert/strict';
const base=process.env.CAUSALITY_API_TEST_BASEURL;
if(!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Set CAUSALITY_API_TEST_BASEURL to a loopback preview. Never run against production.');
const stamp=crypto.randomUUID(),owner=`investigation-${stamp}`,other=`other-${stamp}`;
async function api(user,body,path='/api/investigations') {
 const headers=user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@example.test`}:{};
 if(body){headers['Content-Type']='application/json';headers.Origin=base;}
 const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
const workspace=(user,body)=>api(user,body,'/api/workspace');
const find=(state,order)=>state.cases.find(item=>item.orderRef===order);
async function activeRun(caseId) {
 for(let attempt=0;attempt<100;attempt++) {
  const result=await api(owner,null,`/api/investigations?caseId=${encodeURIComponent(caseId)}`);
  if(result.data.run?.status==='running') return result.data.run;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error('Investigation never entered running state.');
}
assert.equal((await api(null)).status,401);
await workspace(owner,{action:'createWorkspace',name:'Investigation verification'});
await workspace(other,{action:'createWorkspace',name:'Isolated verification'});
const seeded=await workspace(owner,{action:'seedDemo'});assert.equal(seeded.status,200);assert.equal(seeded.data.cases.length,6);
assert.equal((await workspace(owner,{action:'seedDemo'})).data.cases.length,6);
const good=find(seeded.data,'ATM-1042'),failed=find(seeded.data,'ATM-1043'),missing=find(seeded.data,'ATM-1044');
assert.ok(good.evidence.some(record=>record.provenance?.fields.customerAcknowledgedReceipt));
assert.equal((await api(other,{action:'start',caseId:good.id,mode:'sample'})).status,404);
assert.equal((await api(other,null,`/api/investigations?caseId=${encodeURIComponent(good.id)}`)).status,404);
assert.equal((await api(owner,{action:'start',caseId:good.id,mode:'sample',workspaceId:'spoof'})).status,400);
const config=await api(owner);assert.equal(config.status,200);assert.equal(config.data.config.bedrockConfigured,false,'Run the integration suite without AWS credentials.');
assert.equal((await api(owner,{action:'start',caseId:good.id,mode:'bedrock'})).data.code,'bedrock_not_configured');
assert.equal((await api(owner,{action:'import',externalCaseId:'case_external'})).data.code,'merchant_not_configured');
assert.equal((await api(owner,{action:'import',externalCaseId:'../escape'})).status,400);
const crossOrigin=await fetch(base+'/api/investigations',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({action:'start',caseId:good.id,mode:'sample'})});assert.equal(crossOrigin.status,403);
const manual=await workspace(owner,{action:'addCase',title:'Manual case',customerName:'Synthetic reviewer',amount:100,currency:'usd',reason:'product_not_received',dueAt:'2026-12-01'});
assert.equal((await api(owner,{action:'start',caseId:manual.data.cases.find(c=>c.source==='manual').id,mode:'sample'})).data.code,'sample_only');
console.log('PASS: investigation identity, tenant, origin, strict input, case scope, and missing configuration gates.');
for(const [item,expected] of [[good,'supported'],[failed,'mixed'],[missing,'insufficient']]) {
 const result=await api(owner,{action:'start',caseId:item.id,mode:'sample'});
 assert.equal(result.status,200);assert.equal(result.data.run.status,'completed',JSON.stringify(result.data.run));
 const saved=result.data.state.cases.find(c=>c.id===item.id);
 assert.equal(saved.draft.method,'sample_investigator');assert.equal(saved.draft.analysis.assessment,expected);
 assert.equal(saved.draft.sourceStale,false);assert.equal(saved.draft.status,'draft');assert.equal(saved.draft.analysis.metrics.modelCalls,0);
 assert.ok(result.data.run.events.some(event=>event.type==='tool_completed'));
 const ids=new Set(saved.evidence.map(e=>e.id));assert.ok(saved.draft.analysis.evidenceIds.every(id=>ids.has(id)));
 assert.match(saved.draft.content,/not establish|do not establish/);
}
console.log('PASS: all three ticket investigations, persisted traces, source-linked findings, honest sample labels and limitation text.');
const current=()=>workspace(owner);
const draftFor=async id=>(await current()).data.cases.find(c=>c.id===id).draft;
let prior=await draftFor(good.id);
const startCancel=api(owner,{action:'start',caseId:good.id,mode:'sample'});
let run=await activeRun(good.id);
assert.equal((await api(other,{action:'cancel',runId:run.id})).status,404);
assert.equal((await api(owner,{action:'start',caseId:good.id,mode:'sample'})).status,409);
assert.equal((await api(owner,{action:'cancel',runId:run.id})).data.run.status,'cancelled');
assert.equal((await startCancel).data.run.status,'cancelled');
assert.deepEqual(await draftFor(good.id),prior);
const startEvidenceRace=api(owner,{action:'start',caseId:failed.id,mode:'sample'});await activeRun(failed.id);
const evidenceUpdate=await workspace(owner,{action:'addEvidence',caseId:failed.id,source:'manual',title:'Late support record',content:'New synthetic evidence supplied during investigation.',occurredAt:'2026-11-07'});assert.equal(evidenceUpdate.status,200);
assert.equal((await startEvidenceRace).data.run.status,'stale');
assert.equal((await draftFor(failed.id)).sourceStale,true);
assert.equal((await workspace(owner,{action:'approveDraft',caseId:failed.id,revision:(await draftFor(failed.id)).revision})).status,409);
prior=await draftFor(good.id);
const startEditRace=api(owner,{action:'start',caseId:good.id,mode:'sample'});await activeRun(good.id);
const content=prior.content+'\n\nReviewer added a note during investigation.';
assert.equal((await workspace(owner,{action:'saveDraft',caseId:good.id,revision:prior.revision,content})).status,200);
assert.equal((await startEditRace).data.run.status,'stale');assert.equal((await draftFor(good.id)).content,content);
prior=await draftFor(good.id);
const startApprovalRace=api(owner,{action:'start',caseId:good.id,mode:'sample'});await activeRun(good.id);
assert.equal((await workspace(owner,{action:'approveDraft',caseId:good.id,revision:prior.revision})).status,200);
assert.equal((await startApprovalRace).data.run.status,'stale');assert.equal((await draftFor(good.id)).status,'approved');
const badCitation=await workspace(owner,{action:'saveDraft',caseId:good.id,revision:prior.revision,content:'Unsupported invented citation [foreign_record]'});assert.equal(badCitation.status,422);
assert.equal((await api(other,{caseId:good.id,revision:prior.revision},'/api/investigations/archive')).status,404);
assert.equal((await api(owner,{caseId:good.id,revision:prior.revision},'/api/investigations/archive')).data.code,'archive_not_configured');
assert.equal((await api(owner,{caseId:good.id,revision:prior.revision+1},'/api/investigations/archive')).data.code,'stale_archive');
assert.equal((await api(null,{caseId:good.id,revision:prior.revision},'/api/investigations/archive')).status,401);
console.log('PASS: cancellation, one active run, evidence/draft/approval race protection, citation validation, and archive ownership/approval gates.');
