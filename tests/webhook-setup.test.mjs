import test from 'node:test';
import assert from 'node:assert/strict';
import {readWebhookSetup} from '../webhook-setup.mjs';
test('real empty-list shape proves authentication only, never registration or signature',async()=>{
 const calls=[];const r=await readWebhookSetup(async(...args)=>{calls.push(args);return {webhooks:[]};},'configured');
 assert.deepEqual(calls,[['/v1/notifications/webhooks']]);assert.equal(r.status,'no_registration');assert.equal(r.authenticated,true);assert.equal(r.signature_verification,'not_tested');assert.equal(r.listener_reachability,'not_tested');
});
test('registration check distinguishes missing and wrong-app IDs',async()=>{
 const get=async()=>({webhooks:[{id:'WH-OWN',url:'https://example.test/receive',event_types:[{name:'PAYMENT.CAPTURE.COMPLETED'}]}]});
 assert.equal((await readWebhookSetup(get)).status,'missing_webhook_id');
 assert.equal((await readWebhookSetup(get,'WH-OTHER')).status,'webhook_id_not_found');
 const r=await readWebhookSetup(get,'WH-OWN');assert.equal(r.status,'registered');assert.equal(r.listener.host,'example.test');assert.deepEqual(r.event_types,['PAYMENT.CAPTURE.COMPLETED']);
});
test('registration diagnostics do not expose URL credentials, query credentials, or unrelated listener URLs',async()=>{
 const r=await readWebhookSetup(async()=>({webhooks:[{id:'WH-OWN',url:'https://user:private@example.test/receive?token=private',event_types:[{name:'*'}]},{id:'OTHER',url:'https://other-private.test/'}]}),'WH-OWN');
 assert.equal(r.listener.query_omitted,true);assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(r.registration_count,2);
});
test('malformed provider response is unavailable, not a false missing registration',async()=>{
 await assert.rejects(()=>readWebhookSetup(async()=>({})),/no usable webhook/);
});
