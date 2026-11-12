import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer,associateRefund} from '../server.mjs';
const event={id:'PENDING-CAPTURE-EVENT',event_type:'PAYMENT.CAPTURE.PENDING',resource:{id:'CAPTURE-ONLY-12'}};
const order={id:'ORDER-LATER-12',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE-ONLY-12',status:'PENDING'}]}}]};
const env={PORT:'0',PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic'};
const response=v=>new Response(JSON.stringify(v));
async function run(fn,mode='resolve'){
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-capture-only-'));
 const instance=await startServer({env,fetchImpl:async url=>url.endsWith('/token')?response({access_token:'synthetic',expires_in:300}):url.includes('/webhooks-events/')?response(event):url.includes('/v2/payments/captures/')?response({id:mode==='wrong-capture'?'CAPTURE-WRONG':'CAPTURE-ONLY-12',supplementary_data:mode==='no-order'?{}:{related_ids:{order_id:order.id}}}):response(mode==='wrong-order'?{...order,purchase_units:[{payments:{captures:[{id:'CAPTURE-WRONG',status:'PENDING'}]}}]}:order),dataFile:path.join(dir,'state.json')});
 const post=async(route,payload)=>{const r=await fetch(instance.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,data:await r.json()};};
 try{await fn({instance,post});}finally{await new Promise(r=>instance.server.close(r));await rm(dir,{recursive:true,force:true});}
}
test('received capture without order joins later exact authoritative capture read',()=>run(async({instance,post})=>{
 assert.equal((await post('/api/webhooks/ingest',event)).status,202);
 assert.equal((await instance.app.read()).events[0].order_id,null);
 assert.equal((await post('/api/order/inspect',{order_id:order.id})).status,200);
 const stored=(await instance.app.read()).events[0];
 assert.equal(stored.order_id,order.id);assert.equal(stored.verified,false);
 assert.equal((await instance.app.read()).sources[event.id].event.resource.id,event.resource.id);
}));
test('manual capture-only event remains actionable through exact capture lookup',()=>run(async({instance,post})=>{
 const imported=await post('/api/events/import',{event});assert.equal(imported.status,201);
 const result=await post('/api/event/resolve',{event_id:event.id});assert.equal(result.status,200);
 assert.equal((await instance.app.read()).events[0].order_id,order.id);
 assert.equal((await instance.app.read()).events[0].source,'manual');
}));

test('association requires one authoritative local capture observation',()=>{
 const e={id:'CAPTURE-EVENT',type:'PAYMENT.CAPTURE.PENDING',resource_id:'CAPTURE-ONLY-12',order_id:null};
 const local={id:'ORDER-LOCAL-12',units:[{captures:[{id:'CAPTURE-ONLY-12'}]}]};
 assert.equal(associateRefund(e,[{...local,imported:true}]).order_id,null);
 assert.equal(associateRefund(e,[{...local,sample:true}]).order_id,null);
 assert.equal(associateRefund(e,[local,{...local,id:'ORDER-OTHER-12'}]).order_id,null);
 assert.equal(associateRefund(e,[local]).order_id,local.id);
 assert.equal(associateRefund({...e,order_id:'ORDER-EXPLICIT-12'},[local]).order_id,'ORDER-EXPLICIT-12');
 assert.equal(associateRefund({...e,type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'CAPTURE-ONLY-12',capture_id:null},[local]).order_id,null);
});

test('provider capture-only observation stays retained without inventing delivery verification',()=>run(async({instance,post})=>{
 const read=await post('/api/events/inspect',{event_id:event.id});assert.equal(read.status,201);assert.equal(read.data.order_id,null);
 const observed=(await instance.app.read()).events[0];assert.equal(observed.source,'sandbox_event_api');assert.equal(observed.verified,false);
 const linked=await post('/api/event/resolve',{event_id:observed.id});assert.equal(linked.status,200);
 assert.equal((await instance.app.read()).events[0].order_id,order.id);assert.equal((await instance.app.read()).events[0].verified,false);
}));
for(const mode of ['wrong-capture','wrong-order','no-order'])test('capture lookup keeps evidence unresolved for '+mode,()=>run(async({instance,post})=>{
 assert.equal((await post('/api/events/import',{event})).status,201);
 assert.ok((await post('/api/event/resolve',{event_id:event.id})).status>=400);
 const state=await instance.app.read();assert.equal(state.events[0].order_id,null);assert.equal(state.orders.length,0);
},mode));

test('received capture joins an already observed exact order without an extra read',()=>run(async({instance,post})=>{
 await post('/api/order/inspect',{order_id:order.id});
 const receipt=await post('/api/webhooks/ingest',event);
 assert.equal(receipt.status,202);assert.equal(receipt.data.event.order_id,order.id);
 const saved=await instance.app.read();assert.equal(saved.events[0].order_id,order.id);assert.equal(saved.events[0].verified,false);assert.equal(saved.snapshots.length,1);assert.deepEqual(saved.sources[event.id].event,event);
}));
