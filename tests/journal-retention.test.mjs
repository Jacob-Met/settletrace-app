import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../server.mjs';

test('continued operation retains earlier orders and complete multi-incident history across restart and handoff',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-journal-'));
 let app=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'state.json')});
 const api=async(route,data)=>{
  const r=await fetch(app.url+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {status:r.status,body:await r.json()};
 };
 const packet=id=>({order:{id,status:'APPROVED',units:[]},events:[],snapshots:[]});
 try{
  const first='ORDER-KEPT-000';
  assert.equal((await api('/api/packet/import',{packet:packet(first)})).status,201);
  const originalWork=(await api('/api/state')).body.investigation_work[first];
  assert.equal((await api('/api/investigation/archive',{order_id:first,archived:true,evidence_version:originalWork.evidence_version})).status,200);
  for(let i=1;i<=100;i++)assert.equal((await api('/api/packet/import',{packet:packet('ORDER-LATER-'+i)})).status,201);
  assert.equal((await api('/api/packet?order_id='+first)).status,200);
  const bulk=packet('ORDER-MANY-EVENTS');
  bulk.events=Array.from({length:2001},(_,i)=>({
   id:'EVENT-KEPT-'+i,type:'CHECKOUT.ORDER.APPROVED',order_id:bulk.order.id,
   resource_id:bulk.order.id,occurred:new Date(1794340000000+i*1000).toISOString(),verified:false
  }));
  bulk.snapshots=Array.from({length:2001},(_,i)=>({
   order_id:bulk.order.id,status:'APPROVED',source:'sandbox_api',
   observed_at:new Date(1794340000000+i*1000).toISOString(),captures:[]
  }));
  assert.ok(Buffer.byteLength(JSON.stringify({packet:bulk}))<8*1024*1024);
  assert.equal((await api('/api/packet/import',{packet:bulk})).status,201);
  assert.equal((await api('/api/packet/import',{packet:packet('ORDER-AFTER-BULK')})).status,201);
  await new Promise(r=>app.server.close(r));
  app=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'state.json')});
  const state=(await api('/api/state')).body;
  assert.equal(state.orders.length,103);
  assert.ok(state.orders.some(o=>o.id===first));
  assert.equal(state.investigation_work[first].archived,true);
  assert.equal((await api('/api/investigation/archive',{order_id:first,archived:false})).status,200);
  assert.equal((await api('/api/packet?order_id='+first)).status,200);
  assert.ok(state.snapshots.some(o=>o.order_id===first));
  assert.equal(state.events.length,2001);
  assert.ok(state.events.some(e=>e.id==='EVENT-KEPT-0'));
  const exported=(await api('/api/packet?order_id='+bulk.order.id)).body;
  assert.equal(exported.events.length,2001);
  assert.equal(exported.snapshots.length,2001);
  assert.ok(exported.events.every(e=>!e.verified&&e.source==='imported_packet'));
  const receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json')});
  try{
   const response=await fetch(receiver.url+'/api/packet/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packet:exported})});
   assert.equal(response.status,201);
   const received=await fetch(receiver.url+'/api/packet?order_id='+bulk.order.id).then(r=>r.json());
   assert.equal(received.events.length,2001);assert.equal(received.snapshots.length,2001);
   assert.ok(received.events.every(e=>!e.verified));
  }finally{await new Promise(r=>receiver.server.close(r));}
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
