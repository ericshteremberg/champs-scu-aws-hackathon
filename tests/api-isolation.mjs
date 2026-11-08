import assert from 'node:assert/strict';
const base=process.env.CAUSALITY_API_TEST_BASEURL;
if(!base||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw new Error('Set CAUSALITY_API_TEST_BASEURL to the local preview origin. This test never runs against production.');
const stamp=crypto.randomUUID();
const userA=`test-a-${stamp}`,userB=`test-b-${stamp}`;
async function api(user,body,path='/api/workspace'){
 const headers={};if(user){headers['oai-authenticated-user-id']=user;headers['oai-authenticated-user-email']=`${user}@example.test`;}
 if(body){headers['Content-Type']='application/json';headers.Origin=base;}
 const r=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
}
assert.equal((await api(null)).status,401);
assert.equal((await api(userA,{action:'createWorkspace',name:'Isolation A'})).status,200);
assert.equal((await api(userB,{action:'createWorkspace',name:'Isolation B'})).status,200);
let result=await api(userA,{action:'addCase',title:'Synthetic isolation case',customerName:'Synthetic Customer',amount:100,currency:'usd',reason:'duplicate',dueAt:'2026-12-01'});assert.equal(result.status,200);const caseId=result.data.cases[0].id;
assert.equal((await api(userB,{action:'addEvidence',caseId,source:'manual',title:'Forbidden evidence',content:'Cannot cross tenant boundary.',occurredAt:'2026-11-07'})).status,404);
assert.equal((await api(userB)).data.cases.length,0);
result=await api(userA,{action:'addEvidence',caseId,source:'manual',title:'Approved evidence',content:'Synthetic transaction record.',occurredAt:'2026-11-07'});assert.equal(result.status,200);
result=await api(userA,{action:'generateDraft',caseId});assert.equal(result.status,200);const revision=result.data.cases[0].draft.revision;
result=await api(userA,{action:'approveDraft',caseId,revision});assert.equal(result.status,200);assert.equal(result.data.cases[0].draft.status,'approved');
await api(userA,{action:'addEvidence',caseId,source:'manual',title:'New evidence',content:'New synthetic information invalidates prior approval.',occurredAt:'2026-11-07'});
assert.equal((await api(userA,{action:'approveDraft',caseId,revision})).status,409);
result=await api(userA,{action:'requestAccess',caseId,scope:'Related records',reason:'Need additional evidence for this synthetic test.'});assert.equal(result.status,200);
assert.equal((await api(userA,{action:'resolveAccess',requestId:result.data.accessRequests[0].id,decision:'approved'})).status,403);
const crossOrigin=await fetch(base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example','oai-authenticated-user-id':userA,'oai-authenticated-user-email':`${userA}@example.test`},body:JSON.stringify({action:'seedDemo'})});assert.equal(crossOrigin.status,403);
console.log('PASS: anonymous denial, tenant isolation, persisted cases/evidence, revision-bound approval, self-approval denial, and CSRF rejection.');
const upload=new FormData();upload.set('caseId',caseId);upload.set('title','Synthetic receipt upload');upload.set('file',new File(['Synthetic receipt record.'], 'receipt.txt',{type:'text/plain'}));
const uploaded=await fetch(base+'/api/evidence/upload',{method:'POST',headers:{Origin:base,'oai-authenticated-user-id':userA,'oai-authenticated-user-email':`${userA}@example.test`},body:upload});
assert.equal(uploaded.status,200,await uploaded.clone().text());const uploadedState=await uploaded.json();const attachment=uploadedState.cases[0].evidence.find(e=>e.fileName==='receipt.txt');assert.ok(attachment?.downloadUrl);
const ownDownload=await fetch(base+attachment.downloadUrl,{headers:{'oai-authenticated-user-id':userA,'oai-authenticated-user-email':`${userA}@example.test`}});assert.equal(ownDownload.status,200);assert.equal(await ownDownload.text(),'Synthetic receipt record.');
const otherDownload=await fetch(base+attachment.downloadUrl,{headers:{'oai-authenticated-user-id':userB,'oai-authenticated-user-email':`${userB}@example.test`}});assert.equal(otherDownload.status,404);
const badUpload=new FormData();badUpload.set('caseId',caseId);badUpload.set('file',new File(['<script>bad</script>'],'exploit.pdf',{type:'application/pdf'}));
assert.equal((await fetch(base+'/api/evidence/upload',{method:'POST',headers:{Origin:base,'oai-authenticated-user-id':userA,'oai-authenticated-user-email':`${userA}@example.test`},body:badUpload})).status,400);
const stripeConnect=await api(userA,{},'/api/stripe/connect');assert.equal(stripeConnect.status,503);assert.equal(stripeConnect.data.code,'stripe_configuration_required');
console.log('PASS: R2 attachment persistence/download, cross-tenant download denial, MIME spoof rejection, missing Stripe configuration gate.');
