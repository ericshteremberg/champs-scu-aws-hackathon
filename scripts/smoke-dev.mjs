import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
const base='https://causality-hackathon-dev.slidah60.workers.dev';
const password=readFileSync('.dev-worker-access.txt','utf8').match(/^Password: (.+)$/m)?.[1];
if(!password)throw new Error('The ignored private development access file is required.');
const Authorization='Basic '+Buffer.from('dev:'+password).toString('base64');
async function api(path,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization,...(body?{'Content-Type':'application/json',Origin:base}:{})},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,`Development API ${path} returned ${response.status}`);return response.json();}
assert.equal((await fetch(base+'/api/workspace')).status,401);
assert.equal((await fetch(base+'/favicon.svg')).status,401);
assert.deepEqual(await api('/api/runtime'),{storage:'aws',uploads:'presigned'});
let state=await api('/api/workspace');
assert.equal(state.user.id,'causality-development-reviewer');
if(!state.workspace)state=await api('/api/workspace',{action:'createWorkspace',name:'ATMSPHR demo',industry:'Ticketing',website:'https://atmsphr.club'});
state=await api('/api/workspace',{action:'seedDemo'});
const supported=state.cases.find(item=>item.orderRef==='ATM-1042'),incomplete=state.cases.find(item=>item.orderRef==='ATM-1044');
assert.ok(supported && incomplete);
const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});
try{
 const context=await browser.newContext({httpCredentials:{username:'dev',password,origin:base},viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.name));
 await page.goto(`${base}/workspace?view=cases&case=${encodeURIComponent(supported.id)}`);
 await expect(page.getByRole('button',{name:'Investigate with AWS',exact:true})).toBeVisible();
 const startResponse=page.waitForResponse(response=>response.url()===base+'/api/investigations' && response.request().method()==='POST');
 await page.getByRole('button',{name:'Investigate with AWS',exact:true}).click({timeout:150000});
 const accepted=await startResponse;assert.equal(accepted.status(),202);
 const acceptedRun=(await accepted.json()).run;assert.equal(acceptedRun.mode,'bedrock');
 const runId=acceptedRun.id;
 const started=Date.now();
 while(true){
  if(Date.now()-started>150000)throw new Error('Published investigation timed out.');
  const progress=await api('/api/investigations?caseId='+encodeURIComponent(supported.id));
  if(progress.run?.id!==runId){await new Promise(resolve=>setTimeout(resolve,500));continue;}
  if(progress.run?.status==='completed')break;
  if(progress.run && ['failed','stale','cancelled'].includes(progress.run.status))throw new Error(`Published investigation ${progress.run.status}: ${progress.run.error}`);
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 const investigated=(await api('/api/workspace')).cases.find(item=>item.id===supported.id);
 assert.equal(investigated.draft.method,'bedrock');
 assert.equal(investigated.draft.status,'draft');
 assert.ok(investigated.draft.analysis.metrics.modelCalls>0);
 assert.ok(investigated.draft.analysis.evidenceIds.length>0);
 const retrievedIds=new Set(investigated.evidence.map(item=>item.id));
 assert.ok(investigated.draft.analysis.evidenceIds.every(id=>retrievedIds.has(id)),'Every report citation must resolve to saved case evidence.');
 await expect(page.getByRole('heading',{name:'Investigation complete',exact:true})).toBeVisible({timeout:10000});
 await page.getByRole('tab',{name:'Report',exact:true}).click();
 await expect(page.getByRole('textbox',{name:/Merchant response draft/})).toHaveValue(/SOURCE LIMITATIONS/);
 await page.getByRole('button',{name:'Approve draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Export report',exact:true})).toBeEnabled();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export report',exact:true}).click();await download;
 await page.getByRole('button',{name:/Archive.*S3/}).click();
 await expect(page.getByText('Approved evidence packet archived to your private S3 bucket.',{exact:true})).toBeVisible({timeout:30000});
 await page.screenshot({path:'/tmp/causality-live-aws.png',fullPage:true});
 console.log('PASS: published browser -> signed AWS bridge -> Lambda/Bedrock -> reviewed response/export/S3 archive.');
 await page.goto(`${base}/workspace?view=cases&case=${encodeURIComponent(incomplete.id)}`);
 const uploadMarker=crypto.randomUUID(),uploadTitle=`Synthetic browser verification ${uploadMarker}`,uploadName=`browser-verification-${uploadMarker}.txt`,uploadContent=`Synthetic browser verification receipt ${uploadMarker}.`;
 await page.getByRole('button',{name:'Add evidence',exact:true}).click();await page.getByRole('button',{name:'Upload a file',exact:true}).click();
 await page.getByRole('textbox',{name:'Evidence title',exact:true}).fill(uploadTitle);
 await page.getByLabel('Evidence file').setInputFiles({name:uploadName,mimeType:'text/plain',buffer:Buffer.from(uploadContent)});
 await page.getByRole('button',{name:'Upload evidence',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:30000});
 await expect(page.getByRole('button',{name:new RegExp(uploadMarker)}).first()).toBeVisible();
 const updated=await api('/api/workspace');const evidence=updated.cases.find(item=>item.id===incomplete.id).evidence.find(item=>item.fileName===uploadName);assert.ok(evidence?.downloadUrl);
 const response=await fetch(base+evidence.downloadUrl,{headers:{Authorization}});assert.equal(response.status,200);assert.equal(await response.text(),uploadContent);
 assert.deepEqual(errors,[]);
 writeFileSync('.aws-build/browser-smoke.json',JSON.stringify({verifiedAt:new Date().toISOString(),url:base,awsInvestigation:true,s3BrowserUpload:true,approvalExportArchive:true},null,2)+'\n');
 console.log('PASS: real browser S3 cross-origin upload/finalization, private download, and no JavaScript errors.');
}finally{await browser.close();}
