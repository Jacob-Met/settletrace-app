import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';

test('archive survives restart, preserves packet and reopens on new evidence only',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-archive-'));
 let app=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'state.json')});
 const api=async(route,data)=>{
  const r=await fetch(app.url+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {status:r.status,body:await r.json()};
 };
 const id='ORDER-ARCHIVE';
 const packet={order:null,order_id:id,snapshots:[],events:[{id:'EVENT-FIRST',type:'PAYMENT.CAPTURE.PENDING',order_id:id,resource_id:'CAPTURE-ARCHIVE',occurred:'2026-11-10T10:00:00Z',received:'2026-11-10T10:01:00Z'}]};
 try{
  assert.equal((await api('/api/packet/import',{packet})).status,201);
  let state=(await api('/api/state')).body;
  const before=(await api('/api/packet?order_id='+id)).body;
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:true,evidence_version:state.investigation_work[id].evidence_version})).status,200);
  await new Promise(r=>app.server.close(r));
  app=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'state.json')});
  state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].archived,true);
  const after=(await api('/api/packet?order_id='+id)).body;
  delete before.generated;delete after.generated;
  assert.deepEqual(after,before);
  assert.equal('investigation_work' in after,false);
  await api('/api/packet/import',{packet});
  state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].archived,true,'repeat packet is not new evidence');
  const oldVersion=state.investigation_work[id].evidence_version;
  packet.events.push({...packet.events[0],id:'EVENT-LATER',type:'PAYMENT.CAPTURE.COMPLETED'});
  await api('/api/packet/import',{packet});
  state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].archived,false);
  assert.equal(state.investigation_work[id].new_evidence,true);
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:true,evidence_version:oldVersion})).status,409);
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:true,evidence_version:state.investigation_work[id].evidence_version})).status,200);
  assert.equal((await api('/api/investigation/archive',{order_id:id,archived:false})).status,200);
  state=(await api('/api/state')).body;
  assert.equal(state.investigation_work[id].archived,false);
  assert.equal(state.investigation_work[id].new_evidence,false);
  assert.equal(state.events.length,2);
  assert.ok(state.events.every(e=>!e.verified));
  assert.equal((await api('/api/investigation/archive',{order_id:'UNKNOWN-ID',archived:true})).status,404);
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});
