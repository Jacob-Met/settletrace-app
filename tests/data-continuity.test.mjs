import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveDataFile} from '../server.mjs';
test('two extracted releases reopen the same private journal and preserve provenance',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'settletrace-continuity-'));
 let active;
 try{
 const env={PORT:'0',SETTLETRACE_DATA_DIR:path.join(root,'persistent')};
 const start=async name=>{
  const release=path.join(root,name);await fs.mkdir(release);await fs.cp(new URL('../web/',import.meta.url),path.join(release,'web'),{recursive:true});
  for(const file of (await fs.readdir(new URL('../',import.meta.url))).filter(f=>f.endsWith('.mjs')))await fs.copyFile(new URL('../'+file,import.meta.url),path.join(release,file));
  return (await import(pathToFileURL(path.join(release,'server.mjs')))).startServer({env});
 };
 active=await start('old-release');
 const post=async(route,value)=>{const r=await fetch(active.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});assert.ok(r.ok,await r.text());};
 const event=id=>({id,event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:'ORDER-CONTINUITY'}});
 await post('/api/events/import',{event:event('MANUAL-CONTINUITY')});
 await post('/api/webhooks/ingest',event('RECEIVED-CONTINUITY'));
 let packet=await (await fetch(active.url+'/api/packet?order_id=ORDER-CONTINUITY')).json();
 assert.equal(packet.events.length,2);
 await new Promise(r=>active.server.close(r));active=null;
 active=await start('new-release');
 const restored=await (await fetch(active.url+'/api/packet?order_id=ORDER-CONTINUITY')).json();
 assert.deepEqual(restored.events,packet.events);
 assert.equal(restored.order,null);
 assert.equal(restored.events.find(e=>e.id==='MANUAL-CONTINUITY').source,'manual');
 assert.ok(restored.events.every(e=>!e.verified));
 const original=await (await fetch(active.url+'/api/event/source?event_id=RECEIVED-CONTINUITY')).json();
 assert.equal(original.event.id,'RECEIVED-CONTINUITY');
 assert.equal(resolveDataFile(env),path.join(env.SETTLETRACE_DATA_DIR,'state.json'));
 }finally{if(active)await new Promise(r=>active.server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
