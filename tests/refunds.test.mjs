import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeEvent,normalizeOrder,associateRefund,captureEvidence,reconcile,admitSharedPacket,startServer} from '../server.mjs';
const capture='CAPTURE-7788',orderId='ORDER-778899';
const rawOrder=status=>({id:orderId,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:capture,status,amount:{currency_code:'USD',value:'50.00'}}]}}]});
const refund=(links=[{rel:'up',method:'GET',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+capture}])=>({id:'EVENT-REFUND-1',event_type:'PAYMENT.CAPTURE.REFUNDED',resource_type:'refund',resource:{id:'REFUND-9900',status:'COMPLETED',amount:{value:'12.00',currency_code:'USD'},links}});
test('refund and capture identities remain distinct through normalization and shared packet',()=>{
 const order=normalizeOrder(rawOrder('PARTIALLY_REFUNDED')),event=associateRefund(normalizeEvent(refund(),true),[order]);
 assert.equal(event.resource_id,'REFUND-9900');assert.equal(event.capture_id,capture);assert.equal(event.order_id,orderId);assert.deepEqual(event.refund_amount,{currency:'USD',value:'12.00'});assert.equal(event.refund_status,'COMPLETED');
 const rows=captureEvidence(order,[event]);assert.equal(rows.length,1);assert.equal(rows[0].id,capture);assert.equal(rows[0].events[0].refund_id,'REFUND-9900');
 assert.match(rows[0].assessment,/PARTIALLY_REFUNDED/);
 const shared=admitSharedPacket({order,events:[event],snapshots:[]});assert.equal(shared.events[0].capture_id,capture);assert.equal(shared.events[0].verified,false);assert.equal(shared.events[0].refund_amount.value,'12.00');assert.equal(shared.events[0].refund_status,'COMPLETED');assert.match(reconcile(shared.order,shared.events).notes.find(n=>n.title==='Capture has a later refund status').detail,/^Shared packet claims/);
 assert.equal(captureEvidence(shared.order,shared.events)[0].events[0].refund_id,'REFUND-9900');
});
test('refund association never guesses absent, conflicting, arbitrary-host or ambiguous captures',()=>{
 for(const links of [[],[{rel:'up',href:'https://attacker.example/v2/payments/captures/'+capture}],[{rel:'up',href:'https://api.paypal.com/v2/payments/captures/'+capture},{rel:'up',href:'https://api.paypal.com/v2/payments/captures/CAPTURE-OTHER'}]]){
  const event=normalizeEvent(refund(links));assert.equal(event.capture_id,null);assert.equal(captureEvidence(null,[{...event,order_id:orderId}],orderId).length,0);
 }
 const event=normalizeEvent(refund());
 const order=normalizeOrder(rawOrder('COMPLETED'));
 assert.equal(associateRefund(event,[]).order_id,null);
 assert.equal(associateRefund(event,[order,{...order,id:'ORDER-OTHER'}]).order_id,null);
});
test('historical completion with later refund is not a capture identity mismatch',()=>{
 const done={id:'EVENT-DONE',type:'PAYMENT.CAPTURE.COMPLETED',order_id:orderId,resource_id:capture,verified:true};
 for(const status of ['PARTIALLY_REFUNDED','REFUNDED']){
  const order=normalizeOrder(rawOrder(status)),event=associateRefund(normalizeEvent(refund(),true),[order]),result=reconcile(order,[done,event]);
  assert.ok(result.notes.some(n=>n.title==='Capture has a later refund status'));
  assert.ok(result.notes.some(n=>n.title==='Refund evidence needs its own review'));
  assert.equal(result.notes.some(n=>n.title==='Capture event differs from order read'),false);
  assert.doesNotMatch(captureEvidence(order,[done,event])[0].assessment,/Completion corroborated/);
 }
});
test('legacy refund with missing capture association never creates a false capture row',()=>{
 const order=normalizeOrder(rawOrder('COMPLETED'));
 const event={id:'OLD-REFUND',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-OLD',order_id:orderId,verified:true};
 const rows=captureEvidence(order,[event]);assert.equal(rows.length,1);assert.equal(rows[0].events.length,0);
 assert.match(reconcile(order,[event]).notes.find(n=>n.title==='Refund evidence needs its own review').detail,/association unavailable/);
});
test('HTTP receives refund first then joins inspected order; import and restart retain identity',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-refund-'));
 const dataFile=path.join(dir,'journal.json');let instance;
 const env={PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'};
 const fetchImpl=async url=>new Response(JSON.stringify(url.endsWith('/v1/oauth2/token')?{access_token:'fixture',expires_in:3600}:rawOrder('PARTIALLY_REFUNDED')));
 const api=async(uri,body)=>{const r=await fetch(instance.url+uri,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 try{
  instance=await startServer({env,fetchImpl,dataFile});
  let r=await api('/api/events/import',{event:refund()});assert.equal(r.status,201);assert.equal(r.body.event.order_id,null);
  r=await api('/api/webhooks/ingest',refund());assert.equal(r.status,202);assert.equal(r.body.event.order_id,null);
  await api('/api/order/inspect',{order_id:orderId});
  r=await api('/api/packet?order_id='+orderId);assert.equal(r.body.events.length,1);assert.equal(r.body.events[0].capture_id,capture);assert.equal(r.body.events[0].verified,false);
  assert.equal(r.body.captures.length,1);assert.equal(r.body.captures[0].id,capture);
  r=await api('/api/events/import',{event:{...refund(),id:'MANUAL-REFUND'}});assert.equal(r.status,201);assert.equal(r.body.event.order_id,orderId);
  await new Promise(resolve=>instance.server.close(resolve));
  instance=await startServer({env,fetchImpl,dataFile});
  r=await api('/api/packet?order_id='+orderId);assert.equal(r.body.events.length,2);assert.ok(r.body.events.every(e=>e.resource_id==='REFUND-9900'&&e.capture_id===capture));
 }finally{if(instance)await new Promise(resolve=>instance.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
