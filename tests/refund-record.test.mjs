import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {evidenceVersion} from '../investigation-work.mjs';
import {startServer,normalizeRefund} from '../server.mjs';
test('refund reads remain distinct current observations across restart and shared handoff',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'refund-read-'));let app,receiver;let status='PENDING';const calls=[];
 const env={PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'};
 const fetchImpl=async(url,options)=>{calls.push({url,method:options.method});let value;
 if(url.endsWith('/token'))value={access_token:'fixture',expires_in:3600};
 else if(url.endsWith('/orders/ORDER-REFUND'))value={id:'ORDER-REFUND',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE-REFUND',status:'PARTIALLY_REFUNDED'}]}}]};
 else if(url.endsWith('/refunds/REFUND-RECORD'))value={id:'REFUND-RECORD',status,amount:{currency_code:'USD',value:'2.00'},payer:{email_address:'private@example.test'},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-REFUND'}]};
 else return new Response('{}',{status:404});
 return Response.json(value);};
 const opts={env,fetchImpl,dataFile:path.join(dir,'state.json')};
 const post=async(target,route,value)=>{const r=await fetch(target.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
 try{
 app=await startServer(opts);
 let r=await post(app,'/api/refund/inspect',{refund_id:'REFUND-RECORD'});assert.equal(r.status,200);assert.equal(r.body.refund.order_id,null);assert.equal(r.body.refund.capture_id,'CAPTURE-REFUND');
 await post(app,'/api/order/inspect',{order_id:'ORDER-REFUND'});status='COMPLETED';
 r=await post(app,'/api/refund/inspect',{refund_id:'REFUND-RECORD'});assert.equal(r.body.refund.order_id,'ORDER-REFUND');
 let packet=await (await fetch(app.url+'/api/packet?order_id=ORDER-REFUND')).json();
 assert.deepEqual(packet.refund_observations.map(r=>r.status),['PENDING','COMPLETED']);assert.equal(packet.events.length,0);assert.ok(!JSON.stringify(packet).includes('private@example'));
 assert.ok(calls.filter(c=>!c.url.endsWith('/token')).every(c=>c.method==='GET'));
 await new Promise(r=>app.server.close(r));app=await startServer(opts);
 const restored=await (await fetch(app.url+'/api/packet?order_id=ORDER-REFUND')).json();assert.deepEqual(restored.refund_observations,packet.refund_observations);
 receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json')});
 assert.equal((await post(receiver,'/api/packet/import',{packet})).status,201);
 await post(receiver,'/api/packet/import',{packet});
 const shared=await (await fetch(receiver.url+'/api/packet?order_id=ORDER-REFUND')).json();assert.equal(shared.refund_observations.length,2);assert.ok(shared.refund_observations.every(r=>r.source==='imported_packet'&&r.reported_source==='sandbox_refund_api'));
 assert.equal((await post(app,'/api/refund/inspect',{refund_id:'../../bad'})).status,400);
 assert.equal((await post(app,'/api/refund/inspect',{refund_id:'UNKNOWN-REFUND'})).status,502);
 assert.equal((await app.app.read()).refund_observations.length,2);
 }finally{if(app)await new Promise(r=>app.server.close(r));if(receiver)await new Promise(r=>receiver.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('refund normalization never guesses association or accepts mismatched IDs',()=>{
 assert.throws(()=>normalizeRefund({id:'OTHER-REFUND',status:'COMPLETED'},'REFUND-RECORD'));
 const r=normalizeRefund({id:'REFUND-RECORD',status:'PENDING',links:[{rel:'up',href:'https://evil.test/v2/payments/captures/CAPTURE-REFUND'}]},'REFUND-RECORD');assert.equal(r.capture_id,null);assert.equal(r.amount,null);
});

test('new refund observations change the archived incident evidence version',()=>{const state={orders:[{id:'ORDER-REFUND',units:[]}],events:[],snapshots:[]};const before=evidenceVersion(state,'ORDER-REFUND');state.refund_observations=[{id:'REFUNDREAD-1',order_id:'ORDER-REFUND',refund_id:'REFUND-RECORD',status:'PENDING'}];assert.notEqual(evidenceVersion(state,'ORDER-REFUND'),before);});

test('explicit refund-only lookup follows exact provider relations and retains unlinked failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'refund-resolve-'));let mismatch=true;const calls=[];
 const app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},dataFile:path.join(dir,'state.json'),fetchImpl:async(url,opts)=>{calls.push({url,method:opts.method});if(url.endsWith('/token'))return Response.json({access_token:'fixture'});if(url.includes('/refunds/'))return Response.json({id:url.split('/').at(-1),status:'COMPLETED',amount:{currency_code:'USD',value:'0.25'},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-ONLY'}]});if(url.includes('/captures/'))return Response.json({id:'CAPTURE-ONLY',status:'PARTIALLY_REFUNDED',supplementary_data:{related_ids:{order_id:'ORDER-ONLY'}}});return Response.json({id:'ORDER-ONLY',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:mismatch?'DIFFERENT-CAPTURE':'CAPTURE-ONLY',status:'PARTIALLY_REFUNDED'}]}}]});}});
 const post=async id=>{const r=await fetch(app.url+'/api/refund/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refund_id:id,resolve_order:true})});assert.equal(r.status,200);return r.json();};
 try{const failed=await post('REFUND-ONLY');assert.equal(failed.order_id,null);assert.match(failed.resolution_error,/exact refund capture/);assert.equal((await app.app.read()).orders.length,0);assert.equal((await app.app.read()).refund_observations.length,1);mismatch=false;let r=await post('REFUND-ONLY');assert.equal(r.order_id,'ORDER-ONLY');assert.equal(r.capture_id,'CAPTURE-ONLY');assert.equal(r.observation.amount.value,'0.25');assert.equal(r.resolution_error,null);assert.equal((await app.app.read()).snapshots.filter(x=>x.resource_kind==='capture').length,1);
 // A fresh workspace with no matching order is covered by the exact-relation path;
 // transport never follows arbitrary supplied links or writes payment resources.
 assert.ok(calls.filter(x=>!x.url.endsWith('/token')).every(x=>x.method==='GET'));
 }finally{await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
