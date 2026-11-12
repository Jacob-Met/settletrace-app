import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createService,startServer} from '../server.mjs';
import {STARTER_ORDER_ID} from '../starter-case.mjs';
test('first-use example has no provider authority or calls, and preserves an existing empty journal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'settletrace-starter-'));
 try{
  const dataFile=path.join(dir,'state.json');let calls=0;
  const app=createService({starterCase:true,dataFile,env:{},fetchImpl:async()=>{calls++;throw Error('Unexpected provider call');}});
  const state=await app.read();
  assert.equal(state.orders.length,1);assert.equal(state.orders[0].title,'Example payment');assert.equal(state.orders[0].sample,true);
  assert.equal(state.orders[0].units[0].captures[0].amount.value,'12.34');
  assert.equal(state.events.length,0);assert.equal(state.snapshots.length,2);assert(state.snapshots.every(s=>s.source==='authored_sample'&&s.sample));assert.equal(calls,0);
  await fs.writeFile(dataFile,JSON.stringify({orders:[],events:[],snapshots:[],sources:{}}));
  assert.equal((await createService({starterCase:true,dataFile,env:{}}).read()).orders.length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('explicit provider read replaces example order without promoting copied history',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'settletrace-starter-read-'));let active,calls=0;
 try{
  active=await startServer({starterCase:true,dataFile:path.join(dir,'state.json'),env:{PORT:'0',PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test'},fetchImpl:async url=>{
   calls++;return new Response(JSON.stringify(url.endsWith('/token')?{access_token:'test-token',expires_in:300}:{id:STARTER_ORDER_ID,status:'COMPLETED',purchase_units:[{amount:{currency_code:'USD',value:'12.34'},payments:{captures:[{id:'5M502493PE612220G',status:'COMPLETED',amount:{currency_code:'USD',value:'12.34'}}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  assert.equal(calls,0);
  const before=await(await fetch(active.url+'/api/packet?order_id='+STARTER_ORDER_ID)).json();assert.equal(before.order.sample,true);assert(before.snapshots.every(s=>s.source==='authored_sample'));
  const response=await fetch(active.url+'/api/order/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:STARTER_ORDER_ID})});assert.equal(response.status,200);
  const state=await active.app.read();assert.equal(state.orders[0].sample,false);assert.equal(state.orders[0].starter,undefined);assert.equal(state.snapshots.filter(s=>s.source==='sandbox_api').length,1);assert.equal(state.snapshots.filter(s=>s.source==='authored_sample').length,2);assert.equal(calls,2);
 }finally{if(active)await new Promise(r=>active.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
