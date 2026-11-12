import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer,normalizeOrder,admitSharedPacket} from '../server.mjs';
const captures=n=>Array.from({length:n},(_,i)=>({id:'CAPTURE-'+String(i+1).padStart(5,'0'),status:i===32?'PARTIALLY_REFUNDED':'COMPLETED',amount:{currency_code:'USD',value:'1.00'}}));
const order=n=>({id:'ORDER-COMPLETE',status:'COMPLETED',purchase_units:[{payments:{captures:captures(n)}}]});
test('exact thirty-third capture survives refund resolution, restart and file handoff',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'complete-captures-'));let app,receiver;
 const options={env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},dataFile:path.join(dir,'state.json'),fetchImpl:async url=>{
  if(url.endsWith('/token'))return Response.json({access_token:'fixture'});
  if(url.includes('/refunds/'))return Response.json({id:'REFUND-COMPLETE',status:'COMPLETED',amount:{currency_code:'USD',value:'0.25'},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-00033'}]});
  if(url.includes('/captures/'))return Response.json({id:'CAPTURE-00033',status:'PARTIALLY_REFUNDED',amount:{currency_code:'USD',value:'1.00'},supplementary_data:{related_ids:{order_id:'ORDER-COMPLETE'}}});
  return Response.json(order(33));
 }};
 const post=async(target,route,body)=>{const r=await fetch(target.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
 const packet=async target=>(await fetch(target.url+'/api/packet?order_id=ORDER-COMPLETE')).json();
 try{
  app=await startServer(options);
  const read=await post(app,'/api/refund/inspect',{refund_id:'REFUND-COMPLETE',resolve_order:true});
  assert.equal(read.status,200);assert.equal(read.value.resolution_error,null);assert.equal(read.value.order_id,'ORDER-COMPLETE');
  const original=await packet(app);assert.equal(original.order.units[0].captures.length,33);assert.equal(original.refund_observations[0].capture_id,'CAPTURE-00033');
  await new Promise(r=>app.server.close(r));app=await startServer(options);assert.deepEqual((await packet(app)).order,original.order);
  receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json')});
  assert.equal((await post(receiver,'/api/packet/import',{packet:original})).status,201);
  const received=await packet(receiver);assert.equal(received.order.units[0].captures.length,33);assert.equal(received.order.units[0].captures[32].id,'CAPTURE-00033');assert.equal(received.order.imported,true);
 }finally{if(app)await new Promise(r=>app.server.close(r));if(receiver)await new Promise(r=>receiver.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('whole-order bounds reject rather than publish a partial payment collection',()=>{
 const full=normalizeOrder(order(512));assert.equal(full.units[0].captures.length,512);
 assert.equal(admitSharedPacket({order:full,events:[],snapshots:[]}).order.units[0].captures.length,512);
 assert.throws(()=>normalizeOrder(order(513)),/512-capture/);
 const spread=order(257);spread.purchase_units.push({payments:{captures:captures(256)}});assert.throws(()=>normalizeOrder(spread),/512-capture/);
 assert.throws(()=>admitSharedPacket({order:{...full,units:[...full.units,...full.units]},events:[],snapshots:[]}),/invalid/);
});
