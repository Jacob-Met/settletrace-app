import test from 'node:test';
import assert from 'node:assert/strict';
import {captureEvidence,reconcile} from '../server.mjs';
// PayPal event catalogue: https://developer.paypal.com/api/rest/webhooks/event-names/
// PAYMENT.CAPTURE.REVERSED means PayPal reverses a payment capture.
const order={id:'ORDER-REVERSAL',status:'COMPLETED',units:[{captures:[{id:'CAP-A',status:'COMPLETED'},{id:'CAP-B',status:'COMPLETED'}]}]};
const event=(id,type,resource_id='CAP-A',verified=true)=>({id,type:'PAYMENT.CAPTURE.'+type,resource_id,order_id:order.id,verified,sample:false});
test('reversal supersedes corroborated-completion assessment for its exact capture',()=>{
 const events=[event('DONE','COMPLETED'),event('REVERSE','REVERSED'),event('OTHER-DONE','COMPLETED','CAP-B')];
 const rows=captureEvidence(order,events);
 assert.match(rows.find(x=>x.id==='CAP-A').assessment,/reversal/);
 assert.match(rows.find(x=>x.id==='CAP-B').assessment,/Completion corroborated/);
 const note=reconcile(order,events).notes.find(x=>x.title==='Capture reversal evidence');
 assert.deepEqual(note.ids,['REVERSE']); assert.match(note.detail,/CAP-A/);
 assert.ok(!reconcile(order,events).notes.some(x=>x.level==='clear'));
});
test('event-only reversal remains visible before any order read',()=>{
 assert.ok(reconcile(null,[event('REVERSE','REVERSED')],[],order.id).notes.some(x=>x.title==='Capture reversal evidence'));
});
test('unverified, sample, or other-order reversals never establish reversal',()=>{
 for(const e of [event('R','REVERSED','CAP-A',false),{...event('R','REVERSED'),sample:true},{...event('R','REVERSED'),order_id:'OTHER'}]){
 assert.ok(!reconcile(order,[e]).notes.some(x=>x.title==='Capture reversal evidence'));
 assert.ok(!captureEvidence(order,[e]).some(x=>/Verified capture reversal/.test(x.assessment)));
 }
});

test('direct PayPal reversal is authoritative without claiming a signed delivery',()=>{
 const read={...event('EVENTREAD-REVERSAL','REVERSED','CAP-A',false),source:'sandbox_event_api',event_id:'WH-REVERSAL',provider_observed_at:'2026-11-10T20:00:00Z',received:null};
 const row=captureEvidence(order,[event('DONE','COMPLETED'),read]).find(x=>x.id==='CAP-A');
 assert.match(row.assessment,/PayPal reports capture reversal/);
 assert.doesNotMatch(row.assessment,/Verified|corroborated/);
 assert.equal(row.events.find(x=>x.id===read.id).verified,false);
 assert.deepEqual(reconcile(order,[read]).notes.find(x=>x.title==='Capture reversal evidence').ids,[read.id]);
 const imported={...read,source:'imported_packet',reported_source:read.source,provider_observed_at:null};
 assert.ok(!reconcile(order,[imported]).notes.some(x=>x.title==='Capture reversal evidence'));
 const report=reconcile(order,[imported]).notes.find(x=>x.title==='Unverified capture reversal report');
 assert.equal(report.level,'caution');assert.deepEqual(report.ids,[read.id]);
 assert.match(report.detail,/CAP-A/);assert.doesNotMatch(report.detail,/CAP-B/);
 assert.match(report.detail,/does not establish current payment state/);
 assert.match(reconcile(order,[imported]).actions[0],/Verify the reported reversal/);
 assert.equal(imported.verified,false);
});
test('HTTP verified reversal survives packet export and shared import loses authority',async()=>{
 const {startServer}=await import('../server.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const dir=await mkdtemp('/tmp/sable-reversal-http-');
 const response=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
 const app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture',PAYPAL_WEBHOOK_ID:'fixture'},dataFile:dir+'/state.json',fetchImpl:async url=>{
 if(url.endsWith('/token'))return response({access_token:'fixture',expires_in:100});
 if(url.includes('/v2/checkout/orders/'))return response({id:order.id,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAP-A',status:'COMPLETED'}]}}]});
 if(url.endsWith('/verify-webhook-signature'))return response({verification_status:'SUCCESS'});
 throw Error('Unexpected fixture URL');
 }});
 const post=(path,body,headers={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
 assert.equal((await post('/api/order/inspect',{order_id:order.id})).status,200);
 for(const type of ['COMPLETED','REVERSED']){
 const r=await post('/api/webhooks/ingest',{id:'HTTP-'+type,event_type:'PAYMENT.CAPTURE.'+type,resource:{id:'CAP-A',supplementary_data:{related_ids:{order_id:order.id}}}},{'paypal-transmission-id':'fixture-'+type,'paypal-transmission-time':'2026-11-10T00:00:00Z','paypal-cert-url':'https://api.sandbox.paypal.com/fixture','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'fixture'});
 assert.equal(r.status,202);
 }
 const packet=await (await fetch(app.url+'/api/packet?order_id='+order.id)).json();
 assert.match(packet.captures[0].assessment,/reversal/);
 assert.ok(packet.diagnosis.notes.some(x=>x.title==='Capture reversal evidence'));
 const {admitSharedPacket}=await import('../server.mjs');
 const shared=admitSharedPacket(packet);
 assert.ok(shared.events.every(e=>!e.verified));
 assert.ok(!reconcile(shared.order,shared.events).notes.some(x=>x.title==='Capture reversal evidence'));
 const concern=reconcile(shared.order,shared.events).notes.find(x=>x.title==='Unverified capture reversal report');
 assert.deepEqual(concern.ids,['HTTP-REVERSED']);
 assert.match(concern.detail,/CAP-A/);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
