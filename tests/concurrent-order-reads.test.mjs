import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
import {overlappingReadFinding} from '../order-observations.mjs';

const ORDER='OVERLAP-ORDER-700';
const order=(status,id=ORDER)=>({id,status,purchase_units:[{amount:{currency_code:'USD',value:'19.50'},payments:{captures:status==='COMPLETED'?[{id:'CAPTURE-700',status:'COMPLETED',amount:{currency_code:'USD',value:'19.50'}}]:[]}}]});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function harness(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-read-race-'));
 const pending=[];
 const app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'controlled',PAYPAL_CLIENT_SECRET:'controlled'},dataFile:path.join(dir,'journal.json'),fetchImpl:async(url)=>{
  if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'fixture-token',expires_in:3600});
  const wait=defer();pending.push({url,...wait});return wait.promise;
 }});
 t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 async function inspect(id=ORDER){const response=await fetch(app.url+'/api/order/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:id})});return {status:response.status,...await response.json()};}
 async function waitFor(count){for(let i=0;i<200&&pending.length<count;i++)await new Promise(r=>setTimeout(r,5));assert.equal(pending.length,count);}
 return {app,pending,inspect,waitFor,dir};
}

test('two real HTTP refreshes retain both responses and never roll back the newer successful read',async t=>{
 const h=await harness(t);
 const first=h.inspect();await h.waitFor(1);
 const second=h.inspect();await h.waitFor(2);
 h.pending[1].resolve(Response.json(order('COMPLETED')));
 const newer=await second;assert.equal(newer.status,200);assert.equal(newer.applied,true);
 h.pending[0].resolve(Response.json(order('CREATED')));
 const older=await first;assert.equal(older.status,200);assert.equal(older.applied,false);assert.equal(older.reason,'superseded');
 assert.equal(older.order.status,'COMPLETED');assert.equal(older.observation.status,'CREATED');
 const state=await(await fetch(h.app.url+'/api/state')).json();
 assert.equal(state.orders[0].status,'COMPLETED');assert.equal(state.snapshots.length,2);
 assert.equal(state.snapshots[1].superseded_by,state.snapshots[0].id);
 assert.ok(state.snapshots.every(x=>x.requested_at&&x.observed_at));
 assert.equal('orderReadHeads' in state,false);
 const packet=await(await fetch(h.app.url+'/api/packet?order_id='+ORDER)).json();
 assert.equal(packet.snapshots.length,2);
 assert.equal(packet.read_comparison.state,'unavailable');
 assert.equal(packet.read_comparison.read_count,2);
 assert.equal(packet.read_comparison.comparable_read_count,1);
 assert.equal(packet.read_comparison.overlapping_read_count,1);
 assert.ok(!packet.diagnosis.notes.some(x=>x.title==='Capture evidence changed between API reads'));
 assert.ok(packet.diagnosis.notes.some(x=>x.title==='Overlapping order reads disagree'));
 assert.ok(!packet.diagnosis.notes.some(x=>x.title==='Order status changed between API reads'));
 const disk=JSON.parse(await readFile(path.join(h.dir,'journal.json'),'utf8'));
 assert.equal(disk.orders[0].read_id,newer.observation.id);
 const third=h.inspect();await h.waitFor(3);h.pending[2].resolve(Response.json(order('COMPLETED')));
 await third;
 const fresh=await(await fetch(h.app.url+'/api/packet?order_id='+ORDER)).json();
 assert.equal(fresh.snapshots.length,3);
 assert.equal(fresh.read_comparison.state,'ready');
 assert.equal(fresh.read_comparison.before.id,newer.observation.id);
 assert.equal(fresh.read_comparison.changes.length,0);
 assert.equal(fresh.read_comparison.overlapping_read_count,0);
 assert.ok(!fresh.diagnosis.notes.some(x=>x.title==='Overlapping order reads disagree'));
});

test('a failed newer request does not discard a successful older response',async t=>{
 const h=await harness(t);const first=h.inspect();await h.waitFor(1);
 const second=h.inspect();await h.waitFor(2);h.pending[1].resolve(new Response('{}',{status:503}));
 assert.equal((await second).status,502);h.pending[0].resolve(Response.json(order('APPROVED')));
 const earlier=await first;assert.equal(earlier.applied,true);assert.equal(earlier.order.status,'APPROVED');
});

test('parallel different orders remain independent and every completed read is retained',async t=>{
 const h=await harness(t);const first=h.inspect();await h.waitFor(1);
 const other=h.inspect('OTHER-ORDER-701');await h.waitFor(2);
 h.pending[1].resolve(Response.json(order('COMPLETED','OTHER-ORDER-701')));assert.equal((await other).applied,true);
 h.pending[0].resolve(Response.json(order('APPROVED')));assert.equal((await first).applied,true);
 const state=await(await fetch(h.app.url+'/api/state')).json();assert.equal(state.orders.length,2);assert.equal(state.snapshots.length,2);
});

test('imported history cannot invent an authoritative overlap finding',()=>{
 const o={id:ORDER,status:'COMPLETED',read_id:'NEW',imported:true};
 const reads=[{id:'NEW',order_id:ORDER,source:'sandbox_api',status:'COMPLETED',captures:[]},{id:'OLD',order_id:ORDER,source:'sandbox_api',status:'CREATED',captures:[],superseded_by:'NEW'}];
 assert.equal(overlappingReadFinding(o,reads),null);
});

test('capture-event resolution and direct refresh share ordering without losing the association',async t=>{
 const h=await harness(t);
 const seeded=await fetch(h.app.url+'/api/events/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:{id:'EVENT-OVERLAP-700',event_type:'PAYMENT.CAPTURE.PENDING',resource:{id:'CAPTURE-700'}}})});
 assert.equal(seeded.status,201);
 const first=h.inspect();await h.waitFor(1);
 const resolved=fetch(h.app.url+'/api/event/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:'EVENT-OVERLAP-700'})});
 await h.waitFor(2);
 h.pending[1].resolve(Response.json({id:'CAPTURE-700',supplementary_data:{related_ids:{order_id:ORDER}}}));
 await h.waitFor(3);
 h.pending[2].resolve(Response.json(order('COMPLETED')));
 assert.equal((await resolved).status,200);
 h.pending[0].resolve(Response.json(order('CREATED')));
 assert.equal((await first).applied,false);
 const state=await(await fetch(h.app.url+'/api/state')).json();
 assert.equal(state.orders[0].status,'COMPLETED');assert.equal(state.events[0].order_id,ORDER);
 assert.equal(state.snapshots.length,2);assert.ok(state.snapshots[1].superseded_by);
});
