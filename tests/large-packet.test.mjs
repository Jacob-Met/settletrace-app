import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../server.mjs';

test('a long incident exports and reopens without losing event identities or provenance',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-long-handoff-'));
 const sender=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'sender.json')});
 const receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json')});
 const post=(app,uri,data)=>fetch(app.url+uri,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const orderId='ORDER-LONG-HANDOFF';
  const events=Array.from({length:1800},(_,i)=>({id:'WH-LONG-'+i,type:'PAYMENT.CAPTURE.PENDING',order_id:orderId,resource_id:'CAPTURE-LONG-HANDOFF',occurred:new Date(Date.UTC(2026,10,9,0,i)).toISOString(),received:null,verified:false}));
  assert.equal((await post(sender,'/api/packet/import',{packet:{order_id:orderId,order:null,events,snapshots:[]}})).status,201);
  const packet=await(await fetch(sender.url+'/api/packet?order_id='+orderId)).json();
  assert.ok(Buffer.byteLength(JSON.stringify({packet}))>512*1024,'actual exported packet crosses old HTTP limit');
  const reopened=await post(receiver,'/api/packet/import',{packet});assert.equal(reopened.status,201);
  const state=await(await fetch(receiver.url+'/api/state')).json();
  assert.deepEqual(state.events.map(e=>e.id),events.map(e=>e.id));
  assert.equal(state.orders.length,0);
  assert.ok(state.events.every(e=>!e.verified&&e.source==='imported_packet'&&e.received===null));
  const additional={...packet,events:Array.from({length:2001},(_,i)=>({...packet.events[0],id:'WH-EXCESS-'+i}))};
  assert.equal((await post(receiver,'/api/packet/import',{packet:additional})).status,201);
  const continued=await(await fetch(receiver.url+'/api/state')).json();
  assert.equal(continued.events.length,3801);
  assert.deepEqual(continued.events.slice(0,1800).map(e=>e.id),events.map(e=>e.id));
  const before=JSON.stringify(continued);
  assert.equal((await post(receiver,'/api/packet/import',{packet,padding:'x'.repeat(8*1024*1024)})).status,413);
  assert.equal((await post(receiver,'/api/events/import',{event:{id:'WH-LARGE',event_type:'PAYMENT.CAPTURE.PENDING',resource:{id:'CAPTURE-LONG',supplementary_data:{related_ids:{order_id:orderId}}}},padding:'x'.repeat(512*1024)})).status,413);
  assert.equal(JSON.stringify(await(await fetch(receiver.url+'/api/state')).json()),before,'failed imports leave the existing investigation intact');
 }finally{await Promise.all([new Promise(r=>sender.server.close(r)),new Promise(r=>receiver.server.close(r))]);await rm(dir,{recursive:true,force:true});}
});
