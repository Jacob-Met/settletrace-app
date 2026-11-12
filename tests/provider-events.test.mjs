import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer,admitSharedPacket,reconcile} from '../server.mjs';
import {hasEventAuthority,isProviderRead} from '../web/event-origin.mjs';

const eid='WH-9R583449JU321501K-7W938161K0208451F',oid='ORDER-7834592',cid='CAPTURE-78120';
const rawEvent=()=>({id:eid,event_type:'PAYMENT.CAPTURE.COMPLETED',create_time:'2026-11-10T10:00:00Z',resource:{id:cid,payer:{email_address:'private@example.invalid'},links:[{rel:'up',method:'GET',href:'https://api-m.sandbox.paypal.com/v2/checkout/orders/'+oid}]}});
const rawOrder=()=>({id:oid,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:cid,status:'COMPLETED',amount:{currency_code:'USD',value:'24.95'}}]}}]});
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
async function course(fn,{event=rawEvent(),status=200}={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-event-read-')),requests=[];
 const service=await startServer({dataFile:path.join(dir,'state.json'),env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture-client',PAYPAL_CLIENT_SECRET:'fixture-secret'},fetchImpl:async(url,options)=>{
  requests.push({url,method:options.method});
  if(url.endsWith('/v1/oauth2/token'))return response({access_token:'fixture-token',expires_in:3600});
  if(url.includes('/v1/notifications/webhooks-events/'))return response(event,status);
  if(url.includes('/v2/payments/captures/'))return response({id:cid,supplementary_data:{related_ids:{order_id:oid}}});
  if(url.includes('/v2/checkout/orders/'))return response(rawOrder());
  throw Error('Unexpected fixture URL: '+url);
 }});
 const api=async(route,method='GET',payload)=>{
  const r=await fetch(service.url+route,{method,headers:{'content-type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  return {status:r.status,body:await r.json()};
 };
 try{await fn({api,requests,service});}finally{await new Promise(resolve=>service.server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
test('event read uses official Sandbox GET without webhook ID and never invents a delivery',async()=>{
 await course(async({api,requests})=>{
  const r=await api('/api/events/inspect','POST',{event_id:eid});
  assert.equal(r.status,201);assert.equal(r.body.order_id,oid);
  assert.equal(r.body.event.event_id,eid);assert.notEqual(r.body.event.id,eid);
  assert.equal(r.body.event.verified,false);assert.equal(r.body.event.received,null);
  assert.equal(r.body.event.transmission_id,null);assert.equal(isProviderRead(r.body.event),true);
  assert.doesNotMatch(JSON.stringify(r.body),/private@example|payer|fixture-secret|fixture-token/);
  assert.deepEqual(requests.map(x=>x.method),['POST','GET']);
  assert.equal(requests[1].url,'https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events/'+eid);
  const p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.order,null);
  assert.equal(p.captures[0].assessment,'PayPal reports capture completion; order capture not yet observed');
  assert.ok(p.diagnosis.notes.some(n=>n.title==='No order observation'));
  assert.ok(p.diagnosis.notes.some(n=>n.title==='PayPal event read is not delivery proof'));
  assert.equal(p.diagnosis.notes.some(n=>n.title==='Unverified event evidence'),false);
  assert.equal((await api('/api/event/source?event_id='+r.body.event.id)).status,404);
 });
});
test('exact-capture corroboration remains separate from missing received webhook',async()=>{
 await course(async({api})=>{
  await api('/api/order/inspect','POST',{order_id:oid});
  await api('/api/events/inspect','POST',{event_id:eid});
  const p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.captures[0].assessment,'Completion corroborated for this capture');
  assert.ok(p.diagnosis.notes.some(n=>n.title==='Completed capture without a verified delivery'));
  assert.ok(p.captures[0].events.every(e=>e.verified===false&&isProviderRead(e)));
 });
});
test('repeated event reads retain local original delivery and separate observed times',async()=>{
 await course(async({api})=>{
  const received=rawEvent();received.resource.supplementary_data={related_ids:{order_id:oid}};
  await api('/api/webhooks/ingest','POST',received);
  const a=(await api('/api/events/inspect','POST',{event_id:eid})).body.event;
  const b=(await api('/api/events/inspect','POST',{event_id:eid})).body.event;
  assert.notEqual(a.id,b.id);
  const s=(await api('/api/state')).body;
  assert.equal(s.events.length,3);assert.ok(s.events.find(e=>e.id===eid).received);
  assert.equal((await api('/api/event/source?event_id='+eid)).body.event.id,eid);
  const overwrite=await api('/api/events/import','POST',{event:{...received,id:a.id}});
  assert.equal(overwrite.status,409);assert.equal((await api('/api/state')).body.events.length,3);
 });
});
test('sharing keeps event identity and reported origin while dropping API authority',async()=>{
 await course(async({api})=>{
  await api('/api/events/inspect','POST',{event_id:eid});
  const p=(await api('/api/packet?order_id='+oid)).body;
  const imported=admitSharedPacket(p);
  assert.equal(imported.events[0].event_id,eid);
  assert.equal(imported.events[0].source,'imported_packet');
  assert.equal(imported.events[0].reported_source,'sandbox_event_api');
  assert.equal(imported.events[0].provider_observed_at,undefined);
  assert.equal(hasEventAuthority(imported.events[0]),false);
  assert.ok(reconcile(null,imported.events,[],oid).notes.some(n=>n.title==='Unverified event evidence'));
  const reopened=admitSharedPacket({...p,events:imported.events});
  assert.equal(reopened.events[0].reported_source,'sandbox_event_api');
  assert.equal(reopened.events[0].event_id,eid);
 });
});
test('manual JSON cannot forge API-read provenance',async()=>{
 await course(async({api})=>{
  const raw=rawEvent();raw.resource.supplementary_data={related_ids:{order_id:oid}};
  Object.assign(raw,{source:'sandbox_event_api',provider_observed_at:new Date().toISOString(),verified:true});
  const r=await api('/api/events/import','POST',{event:raw});
  assert.equal(r.status,201);assert.equal(hasEventAuthority(r.body.event),false);
  assert.equal(r.body.event.source,'manual');
 });
});
test('mismatched returned event ID leaves saved investigation unchanged',async()=>{
 await course(async({api})=>{
  await api('/api/sample','POST',{});
  const before=(await api('/api/state')).body;
  const r=await api('/api/events/inspect','POST',{event_id:eid});
  assert.equal(r.status,502);assert.match(r.body.error,/different event ID/);
  assert.deepEqual((await api('/api/state')).body,before);
 },{event:{...rawEvent(),id:'WH-WRONG-785937'}});
});
test('foreign or ambiguous order links are never followed or guessed',async()=>{
 const raw=rawEvent();raw.resource.links=[{rel:'up',method:'GET',href:'https://attacker.invalid/v2/checkout/orders/'+oid}];
 await course(async({api,requests})=>{
  assert.equal((await api('/api/events/inspect','POST',{event_id:eid})).status,201);
  const saved=(await api('/api/state')).body;assert.equal(saved.events.length,1);assert.equal(saved.events[0].order_id,null);assert.equal(saved.orders.length,0);
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.startsWith('https://api-m.sandbox.paypal.com/')));
 },{event:raw});
});
test('invalid identifiers make no provider request',async()=>{
 await course(async({api,requests})=>{
  for(const event_id of ['https://example.invalid/WH-test','../../private','','a'.repeat(101)])
   assert.equal((await api('/api/events/inspect','POST',{event_id})).status,400);
  assert.equal(requests.length,0);
 });
});
test('provider errors never insert event observations',async()=>{
 await course(async({api})=>{
  assert.ok((await api('/api/events/inspect','POST',{event_id:eid})).status>=400);
  assert.equal((await api('/api/state')).body.events.length,0);
 },{status:503,event:{name:'SERVICE_UNAVAILABLE'}});
});

test('gross capture conflict survives HTTP observation and packet handoff without promoting imported authority',async()=>{
 const event=rawEvent();
 event.resource.amount={currency_code:'USD',value:'25.95'};
 event.resource.seller_receivable_breakdown={net_amount:{currency_code:'USD',value:'24.95'}};
 await course(async({api})=>{
  assert.equal((await api('/api/order/inspect','POST',{order_id:oid})).status,200);
  assert.equal((await api('/api/events/inspect','POST',{event_id:eid})).status,201);
  const p=(await api('/api/packet?order_id='+oid)).body;
  const note=p.diagnosis.notes.find(n=>n.title==='Same capture has conflicting amounts');
  assert.ok(note);assert.match(note.detail,/USD 24\.95/);assert.match(note.detail,/USD 25\.95/);
  assert.doesNotMatch(note.detail,/verified event/);
  assert.match(p.captures[0].assessment,/conflicting amounts/);
  assert.equal(p.captures[0].events.length,1);
  assert.equal(p.events[0].verified,false);
  assert.equal(p.events[0].event_id,eid);
  assert.deepEqual(p.events[0].capture_amount,{currency:'USD',value:'25.95'});
  assert.deepEqual(p.captures[0].events[0].capture_amount,p.events[0].capture_amount);
  const imported=admitSharedPacket(p);
  assert.deepEqual(imported.events[0].capture_amount,p.events[0].capture_amount);
  assert.equal(hasEventAuthority(imported.events[0]),false);
  assert.equal(reconcile(imported.order,imported.events,imported.snapshots,oid).notes.some(n=>n.title==='Same capture has conflicting amounts'),false);
 },{event});
});
test('provider refund without an order stays available for exact capture lookup',async()=>{
 const refund={id:eid,event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND-78345',amount:{currency_code:'USD',value:'7.25'},status:'COMPLETED',links:[{rel:'up',method:'GET',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+cid}]}};
 await course(async({api,requests})=>{
  const read=await api('/api/events/inspect','POST',{event_id:eid});
  assert.equal(read.status,201);assert.equal(read.body.order_id,null);
  const saved=(await api('/api/state')).body.events[0];
  assert.equal(saved.capture_id,cid);assert.equal(saved.resource_id,'REFUND-78345');
  assert.deepEqual(saved.refund_amount,{currency:'USD',value:'7.25'});
  assert.equal(isProviderRead(saved),true);assert.equal(saved.verified,false);
  assert.equal(saved.received,null);assert.equal(saved.transmission_id,null);
  const joined=await api('/api/refund/resolve','POST',{event_id:saved.id});
  assert.equal(joined.status,200);assert.equal(joined.body.order_id,oid);
  const event=(await api('/api/packet?order_id='+oid)).body.events[0];
  assert.equal(event.source,'sandbox_event_api');assert.equal(event.event_id,eid);
  assert.equal(event.verified,false);assert.equal(event.capture_id,cid);
  assert.deepEqual(requests.map(x=>x.method),['POST','GET','GET','GET']);
 },{event:refund});
});


test('gross capture conflict survives HTTP observation and packet handoff without promoting imported authority',async()=>{
 const event=rawEvent();
 event.resource.amount={currency_code:'USD',value:'25.95'};
 event.resource.seller_receivable_breakdown={net_amount:{currency_code:'USD',value:'24.95'}};
 await course(async({api})=>{
  assert.equal((await api('/api/order/inspect','POST',{order_id:oid})).status,200);
  assert.equal((await api('/api/events/inspect','POST',{event_id:eid})).status,201);
  const p=(await api('/api/packet?order_id='+oid)).body;
  const note=p.diagnosis.notes.find(n=>n.title==='Same capture has conflicting amounts');
  assert.ok(note);assert.match(note.detail,/USD 24\.95/);assert.match(note.detail,/USD 25\.95/);
  assert.doesNotMatch(note.detail,/verified event/);
  assert.match(p.captures[0].assessment,/conflicting amounts/);
  assert.equal(p.captures[0].events.length,1);
  assert.equal(p.events[0].verified,false);
  assert.equal(p.events[0].event_id,eid);
  assert.deepEqual(p.events[0].capture_amount,{currency:'USD',value:'25.95'});
  assert.deepEqual(p.captures[0].events[0].capture_amount,p.events[0].capture_amount);
  const imported=admitSharedPacket(p);
  assert.deepEqual(imported.events[0].capture_amount,p.events[0].capture_amount);
  assert.equal(hasEventAuthority(imported.events[0]),false);
  assert.equal(reconcile(imported.order,imported.events,imported.snapshots,oid).notes.some(n=>n.title==='Same capture has conflicting amounts'),false);
 },{event});
});