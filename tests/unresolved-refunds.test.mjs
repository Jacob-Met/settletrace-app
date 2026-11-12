import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {startServer} from '../server.mjs';
const event={id:'REFUND-EVENT-EXACT',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND-30',amount:{value:'20.00',currency_code:'USD'},status:'COMPLETED',links:[{rel:'up',method:'GET',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-60'}]}};
for(const mode of ['resolve','wrong-capture','wrong-order','no-order','unavailable'])test('retained refund lookup '+mode,async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-unresolved-'));let requests=[];
 const fetchImpl=async(url,options)=>{
  requests.push([url,options.method]);
  if(url.endsWith('/v1/oauth2/token'))return new Response(JSON.stringify({access_token:'synthetic',expires_in:3600}));
  if(mode==='unavailable')return new Response('{}',{status:503});
  if(url.includes('/v2/payments/captures/'))return new Response(JSON.stringify({id:mode==='wrong-capture'?'CAPTURE-WRONG':'CAPTURE-60',links:mode==='no-order'?[]:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-60'}]}));
  return new Response(JSON.stringify({id:'ORDER-60',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:mode==='wrong-order'?'CAPTURE-WRONG':'CAPTURE-60',status:'PARTIALLY_REFUNDED',amount:{currency_code:'USD',value:'60.00'}}]}}]}));
 };
 const config={env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture-only',PAYPAL_CLIENT_SECRET:'fixture-only'},fetchImpl,dataFile:path.join(dir,'state.json')};
 let app=await startServer(config);
 const post=async(route,body)=>{let r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 try{
  let r=await post('/api/events/import',{event});assert.equal(r.status,201);assert.equal(r.body.event.order_id,null);
  await new Promise(resolve=>app.server.close(resolve));app=await startServer(config);
  let state=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(state.events[0].refund_amount.value,'20.00');assert.equal(state.events[0].order_id,null);
  r=await post('/api/refund/resolve',{event_id:event.id});
  state=await fetch(app.url+'/api/state').then(r=>r.json());
  if(mode==='resolve'){assert.equal(r.status,200);assert.equal(r.body.order_id,'ORDER-60');assert.equal(state.events[0].order_id,'ORDER-60');assert.equal(state.events[0].verified,false);assert.equal(state.snapshots.length,1);}
  else{assert.ok(r.status>=400);assert.equal(state.events[0].order_id,null);assert.equal(state.orders.length,0);}
  assert.ok(requests.filter(([url])=>!url.endsWith('/oauth2/token')).every(([,method])=>method==='GET'));
  assert.equal(requests.some(([url])=>url.endsWith('/refund')),false);
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
