import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';

// Actual local HTTP routes with a controlled provider transport, never live PayPal.
const oid='ORDER-CAPTURE-READ',cid='CAP-ALPHA';
const capture=(extra={})=>({id:cid,status:'REFUNDED',amount:{currency_code:'USD',value:'42.50'},create_time:'2026-11-10T18:00:00Z',update_time:'2026-11-10T19:00:00Z',supplementary_data:{related_ids:{order_id:oid}},payer:{email_address:'private@example.test'},...extra});
const order={id:oid,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:cid,status:'COMPLETED',amount:{currency_code:'USD',value:'42.50'}}]}}]};
const event=(type='COMPLETED',extra={})=>({id:'WH-CAPTURE-READ',event_type:'PAYMENT.CAPTURE.'+type,resource:{id:cid,supplementary_data:{related_ids:{order_id:oid}}},...extra});
const headers={'paypal-transmission-id':'CONTROLLED-TRANSMISSION','paypal-transmission-time':'2026-11-10T19:00:00Z','paypal-cert-url':'https://api.sandbox.paypal.com/cert','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'controlled-signature'};
const response=(x,status=200)=>new Response(JSON.stringify(x),{status});
async function run(options,fn){
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-capture-read-')),requests=[];
 const upstream={capture:capture(),captureStatus:200,...options};
 const env={PORT:'0',PAYPAL_CLIENT_ID:'controlled-id',PAYPAL_CLIENT_SECRET:'controlled-secret',...(options?.verify?{PAYPAL_WEBHOOK_ID:'controlled-webhook'}:{})};
 const instance=await startServer({env,dataFile:path.join(dir,'state.json'),fetchImpl:async(url,init={})=>{
  requests.push({url,method:init.method??'GET'});
  if(url.endsWith('/v1/oauth2/token'))return response({access_token:'controlled-token',expires_in:300});
  if(url.includes('/v2/payments/captures/'))return upstream.captureRead?await upstream.captureRead():response(upstream.capture,upstream.captureStatus);
  if(url.includes('/v2/checkout/orders/'))return upstream.orderRead?await upstream.orderRead():response(upstream.order??order,upstream.orderStatus??200);
  if(url.endsWith('/v1/notifications/verify-webhook-signature'))return response({verification_status:'SUCCESS'});
  throw Error('Unexpected controlled provider route');
 }});
 const api=async(route,body,extra={})=>{
  const r=await fetch(instance.url+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 };
 try{return await fn({api,requests,upstream,instance});}
 finally{await new Promise(r=>instance.server.close(r));await rm(dir,{recursive:true,force:true});}
}
test('capture GET records a separate sanitized observation without manufacturing an order',async()=>{
 await run({},async({api,requests})=>{
  const read=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  assert.equal(read.status,201);assert.equal(read.body.observation.status,'REFUNDED');
  assert.equal(read.body.observation.source,'sandbox_capture_api');
  assert.ok(Date.parse(read.body.observation.observed_at)>=Date.parse(read.body.observation.requested_at));
  assert.equal(read.body.observation.association,'provider_order_reference');
  assert.deepEqual(read.body.observation.amount,{currency:'USD',value:'42.50'});
  const p=await api('/api/packet?order_id='+oid);
  assert.equal(p.status,200);assert.equal(p.body.order,null);assert.equal(p.body.events.length,0);
  assert.equal(p.body.snapshots[0].resource_kind,'capture');
  assert.equal(p.body.snapshots[0].updated,'2026-11-10T19:00:00.000Z');
  assert.ok(p.body.diagnosis.notes.some(n=>n.title==='No order observation'));
  assert.doesNotMatch(JSON.stringify(p.body),/private@example|payer|controlled-secret|controlled-token/);
  assert.deepEqual(requests.filter(r=>r.url.includes('/captures/')),[{url:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+cid,method:'GET'}]);
 });
});
test('missing provider order association needs local authoritative evidence, not an imported claim',async()=>{
 await run({capture:capture({supplementary_data:{}})},async({api})=>{
  await api('/api/events/import',{event:event()});
  const before=(await api('/api/state')).body;
  assert.equal((await api('/api/capture/inspect',{order_id:oid,capture_id:cid})).status,422);
  assert.deepEqual((await api('/api/state')).body,before);
  await api('/api/order/inspect',{order_id:oid});
  const read=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  assert.equal(read.status,201);assert.equal(read.body.observation.association,'local_order_capture');
  const p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.order.units[0].captures[0].status,'COMPLETED');
  assert.equal(p.snapshots.find(s=>s.resource_kind==='capture').status,'REFUNDED');
 });
});
test('a locally verified exact capture relation permits event-first capture inspection',async()=>{
 await run({capture:capture({supplementary_data:{}}),verify:true},async({api})=>{
  assert.equal((await api('/api/webhooks/ingest',event(),headers)).body.verified,true);
  const read=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  assert.equal(read.status,201);assert.equal(read.body.observation.association,'local_authoritative_event');
  assert.equal((await api('/api/packet?order_id='+oid)).body.order,null);
 });
});
test('wrong capture or different provider order does not alter saved investigation',async()=>{
 for(const [raw,status] of [[capture({id:'CAP-OTHER'}),502],[capture({supplementary_data:{related_ids:{order_id:'ORDER-OTHER'}}}),409]]){
  await run({capture:raw},async({api})=>{
   await api('/api/events/import',{event:event()});
   const before=(await api('/api/state')).body;
   assert.equal((await api('/api/capture/inspect',{order_id:oid,capture_id:cid})).status,status);
   assert.deepEqual((await api('/api/state')).body,before);
  });
 }
});
test('capture-only packet reopens as a claim and cannot authorize a subsequent relation',async()=>{
 const packet=await run({},async({api})=>{
  await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  return (await api('/api/packet?order_id='+oid)).body;
 });
 await run({capture:capture({supplementary_data:{}})},async({api})=>{
  assert.equal((await api('/api/packet/import',{packet})).status,201);
  let p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.order,null);assert.equal(p.snapshots.length,1);
  assert.equal(p.snapshots[0].source,'imported_packet');
  assert.equal(p.snapshots[0].reported_source,'sandbox_capture_api');
  assert.equal(p.snapshots[0].resource_kind,'capture');
  assert.equal(p.snapshots[0].reported_requested_at,packet.snapshots[0].requested_at);
  assert.equal(p.snapshots[0].requested_at,undefined);
  assert.deepEqual(p.snapshots[0].amount,{currency:'USD',value:'42.50'});
  assert.equal((await api('/api/capture/inspect',{order_id:oid,capture_id:cid})).status,422);
  const again=await api('/api/packet/import',{packet});
  assert.equal(again.body.snapshots,0);
  p=(await api('/api/packet?order_id='+oid)).body;assert.equal(p.snapshots.length,1);
 });
});
test('repeated direct reads keep history and provider failure leaves it unchanged',async()=>{
 await run({},async({api,upstream})=>{
  const a=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  upstream.capture=capture({status:'COMPLETED'});
  const b=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  assert.notEqual(a.body.observation.id,b.body.observation.id);
  const before=(await api('/api/state')).body;
  assert.deepEqual(before.snapshots.map(s=>s.status),['REFUNDED','COMPLETED']);
  upstream.captureStatus=503;
  assert.equal((await api('/api/capture/inspect',{order_id:oid,capture_id:cid})).status,502);
  assert.deepEqual((await api('/api/state')).body,before);
 });
});
test('refund resolution reuses its existing capture read without an extra GET',async()=>{
 await run({},async({api,requests})=>{
  const refund={id:'WH-UNRESOLVED-REFUND',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND-ALPHA',supplementary_data:{related_ids:{capture_id:cid}},amount:{currency_code:'USD',value:'4.25'}}};
  assert.equal((await api('/api/events/import',{event:refund})).status,201);
  assert.equal((await api('/api/refund/resolve',{event_id:refund.id})).status,200);
  const p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.snapshots.filter(s=>s.resource_kind==='capture').length,1);
  assert.equal(p.snapshots.filter(s=>s.source==='sandbox_api').length,1);
  assert.equal(requests.filter(r=>r.url.includes('/captures/')).length,1);
 });
});

test('a delayed earlier capture response remains history without replacing a later requested read',async()=>{
 let count=0,releaseFirst,started;
 const firstStarted=new Promise(r=>started=r),firstGate=new Promise(r=>releaseFirst=r);
 await run({captureRead:async()=>{
  if(++count===1){started();await firstGate;return response(capture({status:'COMPLETED'}));}
  return response(capture({status:'REFUNDED'}));
 }},async({api})=>{
  const earlier=api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  await firstStarted;
  await new Promise(r=>setTimeout(r,5));
  let later;
  try{later=await api('/api/capture/inspect',{order_id:oid,capture_id:cid});}
  finally{releaseFirst();}
  const delayed=await earlier;
  assert.equal(later.status,201);assert.equal(delayed.status,201);
  assert.ok(later.body.observation.requested_at>delayed.body.observation.requested_at);
  assert.ok(delayed.body.observation.observed_at>=later.body.observation.observed_at);
  const p=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(p.snapshots.length,2);
  assert.deepEqual(new Set(p.snapshots.map(s=>s.status)),new Set(['COMPLETED','REFUNDED']));
  assert.equal(p.captures[0].latest_capture_read.id,later.body.observation.id);
  assert.equal(p.captures[0].latest_capture_read.status,'REFUNDED');
 });
});

test('a capture-only investigation participates in archive and reopens on a fresh read',async()=>{
 await run({},async({api})=>{
  await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  let state=(await api('/api/state')).body;
  assert.ok(state.investigation_work[oid],'capture-only evidence has investigation work state');
  const version=state.investigation_work[oid].evidence_version;
  assert.equal((await api('/api/investigation/archive',{order_id:oid,archived:true,evidence_version:version})).status,200);
  assert.equal((await api('/api/state')).body.investigation_work[oid].archived,true);
  await api('/api/capture/inspect',{order_id:oid,capture_id:cid});
  state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[oid].archived,false);
  assert.equal(state.investigation_work[oid].new_evidence,true);
  assert.equal((await api('/api/packet?order_id='+oid)).body.order,null);
 });
});

test('capture ID alone resolves exact provider order and retains separate capture and order evidence',async()=>{
 await run({},async({api,requests})=>{
  const read=await api('/api/capture/inspect',{capture_id:cid});
  assert.equal(read.status,201);assert.equal(read.body.order_id,oid);assert.equal(read.body.applied,true);
  assert.equal(read.body.observation.association,'fresh_order_capture');
  const packet=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(packet.order.id,oid);assert.equal(packet.order.imported,undefined);
  assert.equal(packet.snapshots.filter(x=>x.resource_kind==='capture').length,1);
  assert.equal(packet.snapshots.filter(x=>x.source==='sandbox_api').length,1);
  assert.equal(packet.captures.find(x=>x.id===cid).latest_capture_read.status,'REFUNDED');
  assert.equal(requests.filter(x=>x.url.includes('/captures/')).length,1);
  assert.equal(requests.filter(x=>x.url.includes('/orders/')).length,1);
  assert.ok(requests.filter(x=>!x.url.endsWith('/token')).every(x=>x.method==='GET'));
  assert.doesNotMatch(JSON.stringify(packet),/private@example|payer|controlled-secret|controlled-token/);
 });
});
test('capture-only entry accepts exact official up relation without following its URL',async()=>{
 await run({capture:capture({supplementary_data:{},links:[{rel:'up',method:'GET',href:'https://api.paypal.com/v2/checkout/orders/'+oid}]})},async({api,requests})=>{
  assert.equal((await api('/api/capture/inspect',{capture_id:cid})).status,201);
  assert.ok(requests.some(x=>x.url==='https://api-m.sandbox.paypal.com/v2/checkout/orders/'+oid));
  assert.ok(requests.every(x=>x.url.startsWith('https://api-m.sandbox.paypal.com/')));
 });
});
test('capture-only entry rejects absent, conflicting or untrusted related orders without guessing from imported evidence',async()=>{
 const cases=[
  capture({supplementary_data:{}}),
  capture({links:[{rel:'up',href:'https://api.paypal.com/v2/checkout/orders/ORDER-CONFLICT'}]}),
  capture({supplementary_data:{},links:[{rel:'up',href:'https://merchant.example/v2/checkout/orders/'+oid}]}),
  capture({supplementary_data:{},links:[{rel:'up',href:'https://api.paypal.com/v2/checkout/orders/'+oid+'?redirect=1'}]})
 ];
 for(const raw of cases)await run({capture:raw},async({api,requests})=>{
  await api('/api/events/import',{event:event()});const before=(await api('/api/state')).body;
  const read=await api('/api/capture/inspect',{capture_id:cid});assert.equal(read.status,422);
  assert.deepEqual((await api('/api/state')).body,before);
  assert.equal(requests.filter(x=>x.url.includes('/orders/')).length,0);
 });
});
test('capture-only lookup failures retain existing evidence without partial association',async()=>{
 const cases=[
  {capture:capture({id:'WRONG-CAPTURE'})},
  {order:{...order,id:'WRONG-ORDER'}},
  {order:{...order,purchase_units:[]}},
  {orderStatus:503}
 ];
 for(const options of cases)await run(options,async({api})=>{
  await api('/api/events/import',{event:event()});const before=(await api('/api/state')).body;
  assert.equal((await api('/api/capture/inspect',{capture_id:cid})).status,502);
  assert.deepEqual((await api('/api/state')).body,before);
 });
});
test('capture-only order lookup cannot roll back a newer direct order refresh',async()=>{
 let n=0,release,started;
 const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 await run({orderRead:async()=>{
  if(++n===1){started();await gate;return response({...order,status:'APPROVED'});}
  return response(order);
 }},async({api})=>{
  const pending=api('/api/capture/inspect',{capture_id:cid});await ready;
  try{assert.equal((await api('/api/order/inspect',{order_id:oid})).status,200);}
  finally{release();}
  const read=await pending;assert.equal(read.status,201);assert.equal(read.body.applied,false);assert.equal(read.body.reason,'superseded');
  const packet=(await api('/api/packet?order_id='+oid)).body;
  assert.equal(packet.order.status,'COMPLETED');assert.equal(packet.snapshots.length,3);
  assert.equal(packet.snapshots.filter(x=>x.superseded_by).length,1);
  assert.equal(packet.snapshots.filter(x=>x.resource_kind==='capture').length,1);
 });
});
