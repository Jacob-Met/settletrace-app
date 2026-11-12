import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {startServer} from '../server.mjs';
test('local names survive archive and restart without changing notes or shared evidence',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-local-name-'));let app;
 const open=async()=>{app=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'state.json')});};
 const close=()=>new Promise(resolve=>app.server.close(resolve));
 const api=async(route,input)=>{const r=await fetch(app.url+route,input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
 const id='ORDER-LOCAL-NAME',packet={order:null,order_id:id,snapshots:[],events:[{id:'EVENT-NAME',type:'PAYMENT.CAPTURE.PENDING',order_id:id,resource_id:'CAPTURE-NAME',occurred:'2026-11-10T10:00:00Z'}]};
 await open();
 try{
  assert.equal((await api('/api/packet/import',{packet})).status,201);
  const before=(await api('/api/state')).body,sharedBefore=(await api('/api/packet?order_id='+id)).body;
  assert.equal((await api('/api/investigation/name',{order_id:id,name:'  Support case 42  '})).status,200);
  let state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].name,'Support case 42');
  assert.equal(state.investigation_work[id].evidence_version,before.investigation_work[id].evidence_version);
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:true,evidence_version:state.investigation_work[id].evidence_version})).status,200);
  await close();await open();state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].name,'Support case 42');assert.equal(state.investigation_work[id].archived,true);
  const sharedAfter=(await api('/api/packet?order_id='+id)).body;delete sharedBefore.generated;delete sharedAfter.generated;assert.deepEqual(sharedAfter,sharedBefore);
  assert.deepEqual(state.operator_notes,before.operator_notes);
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:false})).status,200);
  state=(await api('/api/state')).body;assert.equal(state.investigation_work[id].name,'Support case 42');assert.equal(state.investigation_work[id].archived,false);
  await api('/api/packet/import',{packet:{...packet,investigation_work:{[id]:{name:'Shared sender name'}}}});
  assert.equal((await api('/api/state')).body.investigation_work[id].name,'Support case 42');
  assert.equal((await api('/api/investigation/name',{order_id:id,name:'x'.repeat(101)})).status,400);
  assert.equal((await api('/api/investigation/name',{order_id:id,name:null})).status,400);
  assert.equal((await api('/api/investigation/name',{order_id:'UNKNOWN-NAME',name:'Case'})).status,404);
  state=(await api('/api/state')).body;await api('/api/investigation/archive',{order_id:id,archived:true,evidence_version:state.investigation_work[id].evidence_version});
  assert.equal((await api('/api/investigation/name',{order_id:id,name:''})).status,200);
  state=(await api('/api/state')).body;assert.equal(state.investigation_work[id].name,undefined);assert.equal(state.investigation_work[id].archived,true);
 }finally{await close();await rm(dir,{recursive:true,force:true});}
});