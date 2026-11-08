import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { disputeStatus,submissionEligibility } from '../lib/stripe/model.ts';
test('dispute terminal states stay terminal; review is not recovered revenue',()=>{
 assert.equal(disputeStatus('won'),'won');assert.equal(disputeStatus('lost'),'lost');assert.equal(disputeStatus('under_review'),'submitted');assert.equal(disputeStatus('needs_response'),'needs_review');
});
test('submission requires real Stripe source, explicit confirmation, and approved immutable revision',()=>{
 const valid={source:'stripe',status:'ready',draftStatus:'approved',revision:3,requestedRevision:3,confirmed:true};
 assert.equal(submissionEligibility(valid),null);
 for(const change of [{source:'demo'},{confirmed:false},{requestedRevision:2},{draftStatus:'draft'},{status:'submitted'}])assert.ok(submissionEligibility({...valid,...change}));
});
test('webhook verification rejects tampering and stale signatures',async()=>{
 const stripe=new Stripe('unit-test-only');const secret='unit-test-signing-secret';const payload=JSON.stringify({id:'evt_fixture',type:'charge.dispute.created'});
 const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
 assert.equal((await stripe.webhooks.constructEventAsync(payload,signature,secret)).id,'evt_fixture');
 await assert.rejects(stripe.webhooks.constructEventAsync(payload+' ',signature,secret));
 const old=stripe.webhooks.generateTestHeaderString({payload,secret,timestamp:1});await assert.rejects(stripe.webhooks.constructEventAsync(payload,old,secret));
});
test('concurrent submit attempts send only the claimed immutable snapshot',async()=>{
 const {performClaimedSubmission}=await import('../lib/stripe/model.ts');let claimed=false,sends=0,settles=0;
 const ops={claim:async()=>{if(claimed)return false;claimed=true;return true;},send:async()=>{sends++;await new Promise(r=>setTimeout(r,10));return {status:'under_review'};},settle:async()=>{settles++;},uncertain:async()=>{throw new Error('unexpected');}};
 const results=await Promise.all([performClaimedSubmission(ops),performClaimedSubmission(ops)]);assert.equal(sends,1);assert.equal(settles,1);assert.equal(results.filter(r=>r.claimed).length,1);
});
test('ambiguous submission failure retains the claim and requests verification',async()=>{
 const {performClaimedSubmission}=await import('../lib/stripe/model.ts');let locked=false,uncertain=false;
 await assert.rejects(performClaimedSubmission({claim:async()=>{locked=true;return true;},send:async()=>{throw new Error('network timeout');},settle:async()=>{},uncertain:async()=>{uncertain=true;}}));assert.equal(locked,true);assert.equal(uncertain,true);
});
test('account and environment changes are rejected before using stored disputes',async()=>{
 const {accountBindingError}=await import('../lib/stripe/model.ts');const stored={accountId:'acct_fixture',mode:'test'};
 assert.equal(accountBindingError(stored,'acct_fixture','test'),null);assert.ok(accountBindingError(stored,'acct_other','test'));assert.ok(accountBindingError(stored,'acct_fixture','live'));
});
