import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
if(existsSync('.dev.vars'))process.loadEnvFile('.dev.vars');
const deployment=JSON.parse(readFileSync('.aws-build/deployment.json','utf8'));
if(deployment.FunctionName!=='causality-hackathon-backend'||deployment.region!=='us-east-1')throw new Error('This smoke test targets only the named hackathon development backend.');
const client=new LambdaClient({region:deployment.region});
const stamp=crypto.randomUUID();
const user={userId:`aws-smoke-${stamp}`,email:'synthetic-reviewer@example.test',displayName:'Synthetic AWS verification'};
const other={userId:`aws-other-${stamp}`,email:'synthetic-other@example.test',displayName:'Other synthetic reviewer'};
async function api(path,body,actor=user){
 const response=await client.send(new InvokeCommand({FunctionName:deployment.FunctionName,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({kind:'api',method:body?'POST':'GET',path,user:actor,body}))}));
 assert.equal(response.FunctionError,undefined,'Lambda must return a handled API response');
 return JSON.parse(new TextDecoder().decode(response.Payload));
}
const state=()=>api('/api/workspace');
async function waitRun(caseId,deadline=150000){
 const start=Date.now();
 while(Date.now()-start<deadline){const value=await api(`/api/investigations?caseId=${encodeURIComponent(caseId)}`);assert.equal(value.status,200);if(value.body.run && value.body.run.status!=='running')return value.body.run;await new Promise(resolve=>setTimeout(resolve,500));}
 throw new Error('Investigation did not finish before the smoke test deadline');
}
assert.equal((await api('/api/workspace',undefined,undefined)).status,200);
assert.equal((await api('/api/workspace',{action:'createWorkspace',name:'AWS synthetic verification'})).status,200);
assert.equal((await api('/api/workspace',{action:'createWorkspace',name:'Other AWS synthetic verification'},other)).status,200);
let value=await api('/api/workspace',{action:'seedDemo'});assert.equal(value.status,200,JSON.stringify(value));assert.equal(value.body.cases.length,6);
const initial=value.body;const ticket=order=>initial.cases.find(item=>item.orderRef===order);
assert.equal((await api(`/api/investigations?caseId=${ticket('ATM-1042').id}`,undefined,other)).status,404);
assert.equal((await api('/api/investigations',{action:'start',caseId:ticket('ATM-1042').id,mode:'sample'},other)).status,404);
console.log('PASS: native DynamoDB workspace, six samples, and ownership isolation.');
for(const [order,assessment] of [['ATM-1042','supported'],['ATM-1043','mixed'],['ATM-1044','insufficient']]){
 const item=ticket(order);value=await api('/api/investigations',{action:'start',caseId:item.id,mode:'sample'});assert.equal(value.status,202,JSON.stringify(value));
 const run=await waitRun(item.id);assert.equal(run.status,'completed',JSON.stringify(run));
 const saved=(await state()).body.cases.find(item=>item.id===ticket(order).id);assert.equal(saved.draft.analysis.assessment,assessment);assert.equal(saved.draft.method,'sample_investigator');assert.ok(run.events.length>5);
}
console.log('PASS: asynchronous Lambda investigations and all three persisted ticket outcomes.');
let prepared=await api('/api/evidence/prepare-upload',{caseId:ticket('ATM-1044').id,title:'Synthetic uploaded receipt',source:'manual',fileName:'synthetic-receipt.txt',mimeType:'text/plain',size:25});
assert.equal(prepared.status,200,JSON.stringify(prepared));
const payload='Synthetic receipt record.';assert.equal(Buffer.byteLength(payload),25);
const form=new FormData();for(const [key,value] of Object.entries(prepared.body.fields))form.set(key,value);form.set('file',new Blob([payload],{type:'text/plain'}),'synthetic-receipt.txt');
const uploaded=await fetch(prepared.body.uploadUrl,{method:'POST',body:form});assert.ok(uploaded.ok,`S3 upload status ${uploaded.status}`);
value=await api('/api/evidence/finalize-upload',{uploadId:prepared.body.uploadId});assert.equal(value.status,200,JSON.stringify(value));
const attachment=value.body.cases.find(item=>item.id===ticket('ATM-1044').id).evidence.find(record=>record.fileName==='synthetic-receipt.txt');assert.ok(attachment);
const download=await api(`/api/evidence/${encodeURIComponent(attachment.id)}`);assert.equal(download.status,302);assert.equal(await (await fetch(download.redirect)).text(),payload);
assert.equal((await api(`/api/evidence/${encodeURIComponent(attachment.id)}`,undefined,other)).status,404);
console.log('PASS: private S3 upload, validation, download, and ownership isolation.');
const good=ticket('ATM-1042');
value=await api('/api/investigations',{action:'start',caseId:good.id,mode:'sample'});assert.equal(value.status,202);const cancel=await api('/api/investigations',{action:'cancel',runId:value.body.run.id});assert.equal(cancel.body.run.status,'cancelled');assert.equal((await waitRun(good.id)).status,'cancelled');
value=await api('/api/investigations',{action:'start',caseId:good.id,mode:'sample'});assert.equal(value.status,202);
const prior=(await state()).body.cases.find(item=>item.id===good.id).draft;
assert.equal((await api('/api/workspace',{action:'approveDraft',caseId:good.id,revision:prior.revision})).status,200);
assert.equal((await waitRun(good.id)).status,'stale');
assert.equal((await state()).body.cases.find(item=>item.id===good.id).draft.status,'approved');
const archive=await api('/api/investigations/archive',{caseId:good.id,revision:prior.revision});assert.equal(archive.status,200,JSON.stringify(archive));assert.equal(archive.body.archived,true);
console.log('PASS: cancellation, concurrent approval preservation, and private approved-revision S3 archive.');
value=await api('/api/investigations',{action:'start',caseId:good.id,mode:'bedrock'});assert.equal(value.status,202,JSON.stringify(value));
const live=await waitRun(good.id);assert.equal(live.status,'completed',JSON.stringify(live));
const finalState=(await state()).body;const result=finalState.cases.find(item=>item.id===good.id);
assert.equal(result.draft.method,'bedrock');assert.ok(result.draft.analysis.metrics.modelCalls>0);assert.ok(result.draft.analysis.evidenceIds.length>0);assert.equal(result.draft.status,'draft');
writeFileSync('.aws-build/smoke-result.json',JSON.stringify({verifiedAt:new Date().toISOString(),functionName:deployment.FunctionName,workspaceId:finalState.workspace.id,caseId:good.id,modelId:result.draft.analysis.modelId,metrics:result.draft.analysis.metrics,assessment:result.draft.analysis.assessment},null,2)+'\n');
console.log('PASS: real Bedrock investigation, validated source citations, saved draft, and renewed human approval requirement.');
