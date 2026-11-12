import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server.mjs';
const fixture=id=>({order:{id,status:'COMPLETED',units:[{amount:{currency:'USD',value:'89.80'},captures:[{id:'CAPTURE-LAMP-8041',status:'PARTIALLY_REFUNDED',amount:{currency:'USD',value:'64.90'}},{id:'CAPTURE-CABLE-8042',status:'COMPLETED',amount:{currency:'USD',value:'24.90'}}]}]},events:[],snapshots:[]});
test('merchant context survives retry, restart and shared handoff without becoming payment evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'settletrace-notes-')),dataFile=path.join(dir,'sender.json');
 let app=await startServer({env:{PORT:'0'},dataFile}),receiver;
 const post=async(url,route,body)=>{const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
 const get=async(url,route)=>fetch(url+route).then(r=>r.json());
 try{
  const id='NOTE-ORDER-8041';assert.equal((await post(app.url,'/api/packet/import',{packet:fixture(id)})).status,201);
  const before=await get(app.url,'/api/state');
  const note={order_id:id,note_id:'note-'+randomUUID(),text:'Customer asks where the $10 lampshade refund went. Cable is unaffected.\nTicket <L-84> & callback tomorrow.'};
  assert.equal((await post(app.url,'/api/investigation/note',note)).status,201);
  assert.equal((await post(app.url,'/api/investigation/note',note)).status,201);
  assert.equal((await post(app.url,'/api/investigation/note',{...note,text:'Changed after response lost'})).status,409);
  const after=await get(app.url,'/api/state');assert.equal(after.operator_notes.length,1);assert.equal(after.operator_notes[0].text,note.text);
  for(const key of ['orders','events','snapshots'])assert.deepEqual(after[key],before[key]);
  assert.equal(after.investigation_work[id].evidence_version,before.investigation_work[id].evidence_version);
  await new Promise(r=>app.server.close(r));app=await startServer({env:{PORT:'0'},dataFile});
  const packet=await get(app.url,'/api/packet?order_id='+id);assert.equal(packet.operator_notes[0].text,note.text);
  receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json')});
  assert.equal((await post(receiver.url,'/api/packet/import',{packet})).status,201);
  assert.equal((await post(receiver.url,'/api/packet/import',{packet})).status,201);
  const received=await get(receiver.url,'/api/state');assert.equal(received.operator_notes.length,1);assert.equal(received.operator_notes[0].source,'shared');assert.equal(received.operator_notes[0].text,note.text);
  const returned=await get(receiver.url,'/api/packet?order_id='+id);assert.deepEqual(returned.operator_notes,packet.operator_notes.map(n=>({...n,source:'shared'})));
  const own={order_id:id,note_id:'note-'+randomUUID(),text:'Asked the customer to check the original payment method.'};
  assert.equal((await post(receiver.url,'/api/investigation/note',own)).status,201);
  await post(receiver.url,'/api/packet/import',{packet});assert.equal((await get(receiver.url,'/api/state')).operator_notes.length,2);
  assert.equal((await post(app.url,'/api/investigation/note',{...note,note_id:'note-'+randomUUID(),order_id:'MISSING-ORDER'})).status,404);
  const bad={...packet,operator_notes:[{...packet.operator_notes[0],order_id:'OTHER-ORDER'}]};
  assert.equal((await post(receiver.url,'/api/packet/import',{packet:bad})).status,422);
  assert.equal((await get(receiver.url,'/api/state')).operator_notes.length,2);
 }finally{await new Promise(r=>app.server.close(r));if(receiver)await new Promise(r=>receiver.server.close(r));await rm(dir,{recursive:true,force:true});}
});
