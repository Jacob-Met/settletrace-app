import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createService,startServer} from '../server.mjs';
test('public demo refuses provider configuration before startup',()=>{
 for(const key of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','AI_BASE_URL','AI_MODEL','AI_API_KEY']){
  assert.throws(()=>createService({env:{SETTLETRACE_DEMO_READ_ONLY:'1',[key]:'fixture-config'}}),/must not have provider or model/);
 }
});
test('actual public demo HTTP permits reviewed reads but never mutates or contacts providers',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'settle-demo-'));let upstream=0;
 const app=await startServer({env:{PORT:'0',SETTLETRACE_DEMO_READ_ONLY:'1'},dataFile:path.join(dir,'state.json'),starterCase:true,fetchImpl:async()=>{upstream++;throw Error('unexpected provider request');}});
 try{
  const get=pathname=>fetch(app.url+pathname,{signal:AbortSignal.timeout(3000)});
  const before=await (await get('/api/state')).json();
  assert.equal(before.read_only_demo,true);assert.equal(before.connected,false);assert.equal(before.ai_connected,false);
  assert.equal((await get('/')).status,200);
  assert.equal((await get('/api/packet?order_id='+encodeURIComponent(before.orders[0].id))).status,200);
  for(const [method,url] of [['POST','/api/packet/import'],['POST','/api/investigation/archive'],['POST','/api/investigation/note'],['POST','/api/refund/inspect'],['POST','/api/ai/investigate'],['POST','/api/webhooks/paypal'],['PUT','/api/state'],['DELETE','/api/state'],['GET','/api/events/recent'],['GET','/api/event/source?event_id=fixture']]){
   const response=await fetch(app.url+url,{method,signal:AbortSignal.timeout(3000),...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:'{}'})});
   assert.equal(response.status,403,method+' '+url);assert.match((await response.json()).error,/read-only/);
  }
  assert.deepEqual(await (await get('/api/state')).json(),before);
  assert.equal(upstream,0);assert.deepEqual(await readdir(dir),[]);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
