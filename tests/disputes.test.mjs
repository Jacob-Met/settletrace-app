import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
import {presentCase} from '../web/case-presentation.mjs';
import {normalizeDispute,admitDisputes,disputeFindings} from '../dispute-evidence.mjs';
const order={id:'ORDER-DISPUTE',status:'COMPLETED',units:[{captures:[{id:'CAPTURE-EXACT',status:'COMPLETED',amount:{currency:'USD',value:'18.00'}},{id:'CAPTURE-OTHER',status:'COMPLETED'}]}]};
const raw={dispute_id:'PP-R-CASE-1',status:'OPEN',dispute_life_cycle_stage:'CHARGEBACK',dispute_channel:'EXTERNAL',dispute_amount:{currency_code:'USD',value:'5.00'},disputed_transactions:[{seller_transaction_id:'CAPTURE-EXACT',buyer:{email:'private@example.test'}}],messages:[{content:'private message'}],create_time:null};
test('a dispute names exact captures without changing capture state or leaking buyer data',()=>{
 const r=normalizeDispute(raw,raw.dispute_id,order,null);
 assert.deepEqual(r.matched_capture_ids,['CAPTURE-EXACT']);assert.equal(r.created,null);assert.equal(r.requested_at,null);
 assert.ok(!JSON.stringify(r).includes('private'));assert.equal(order.units[0].captures[0].status,'COMPLETED');
 const d=disputeFindings([r],order.id);assert.equal(d.notes[0].level,'investigate');assert.match(d.notes[0].detail,/CAPTURE-EXACT/);assert.doesNotMatch(d.notes[0].detail,/CAPTURE-OTHER/);const view=presentCase({order,diagnosis:d});assert.equal(view.status.label,'Captured');assert.equal(view.summary,'Dispute needs review');assert.match(view.nextSteps[0].action,/PP-R-CASE-1/);assert.match(d.notes[0].detail,/does not establish a refund or capture reversal/);
 assert.throws(()=>normalizeDispute({...raw,dispute_id:'PP-R-WRONG'},raw.dispute_id,order),/ID differs/);
 assert.throws(()=>normalizeDispute({...raw,disputed_transactions:[{seller_transaction_id:'CAPTURE-UNRELATED'}]},raw.dispute_id,order),/does not reference/);
 assert.throws(()=>normalizeDispute(raw,raw.dispute_id,{...order,imported:true}),/locally read/);
});
test('shared claims stay unvalidated, unknown times stay unknown and foreign association is rejected',()=>{
 const r=normalizeDispute(raw,raw.dispute_id,order,null);
 const [shared]=admitDisputes([{...r,verified:true,observed_at:null}],order.id,order);
 assert.equal(shared.source,'imported_packet');assert.equal(shared.reported_source,'sandbox_dispute_api');assert.equal(shared.observed_at,null);assert.equal(shared.reported_requested_at,null);assert.equal(shared.verified,undefined);
 assert.equal(disputeFindings([shared],order.id).notes[0].level,'caution');
 assert.throws(()=>admitDisputes([{...r,capture_ids:['CAPTURE-UNRELATED']}],order.id,order),/does not identify/);
 const resolved={...r,id:'LATER',status:'RESOLVED',requested_at:'2026-11-11T02:00:00Z'};
 const lateArrival={...r,id:'EARLIER',requested_at:'2026-11-11T01:00:00Z',observed_at:'2026-11-11T03:00:00Z'};
 assert.equal(disputeFindings([resolved,lateArrival],order.id).notes[0].level,'info');
 assert.equal(disputeFindings([r,{...shared,status:'RESOLVED',reported_requested_at:'2099-01-01T00:00:00Z'}],order.id).notes[0].level,'investigate');
});
test('actual read routes preserve dispute history through restart, exact file handoff and failed reads',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dispute-course-'));let sender,receiver;const calls=[];let current='OPEN';
 const fetchImpl=async(url,options)=>{calls.push({url,method:options.method});if(url.endsWith('/token'))return Response.json({access_token:'fixture',expires_in:3600});
 if(url.endsWith('/orders/'+order.id))return Response.json({id:order.id,status:'COMPLETED',purchase_units:[{payments:{captures:order.units[0].captures.map(c=>({...c,amount:{currency_code:'USD',value:'18.00'}}))}}]});
 if(url.endsWith('/disputes/'+raw.dispute_id))return Response.json({...raw,status:current});
 if(url.endsWith('/disputes/PP-R-FOREIGN'))return Response.json({...raw,dispute_id:'PP-R-FOREIGN',disputed_transactions:[{seller_transaction_id:'CAPTURE-UNRELATED'}]});
 return new Response('{}',{status:404});};
 const env={PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},opts={env,fetchImpl,dataFile:path.join(dir,'sender.json')};
 const post=async(app,route,value)=>{const r=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
 const packet=async app=>(await fetch(app.url+'/api/packet?order_id='+order.id)).json();
 try{
  sender=await startServer(opts);assert.equal((await post(sender,'/api/dispute/inspect',{dispute_id:raw.dispute_id,order_id:order.id})).status,409);assert.equal(calls.length,0);
  assert.equal((await post(sender,'/api/order/inspect',{order_id:order.id})).status,200);
  const state=await (await fetch(sender.url+'/api/state')).json();assert.equal((await post(sender,'/api/investigation/archive',{order_id:order.id,archived:true,evidence_version:state.investigation_work[order.id].evidence_version})).status,200);
  assert.equal((await post(sender,'/api/dispute/inspect',{dispute_id:raw.dispute_id,order_id:order.id})).status,201);
  const changed=await (await fetch(sender.url+'/api/state')).json();assert.equal(changed.investigation_work[order.id].new_evidence,true);assert.equal(changed.investigation_work[order.id].changed_sources.records[0].kind,'dispute_read');
  let p=await packet(sender);assert.equal(p.order.units[0].captures[0].status,'COMPLETED');assert.equal(p.dispute_observations[0].status,'OPEN');assert.equal(p.diagnosis.notes[0].title,'Dispute read reports OPEN');
  assert.ok(!JSON.stringify(p).includes('private'));assert.equal(p.events.length,0);assert.ok(calls.filter(c=>!c.url.endsWith('/token')).every(c=>c.method==='GET'));
  assert.equal((await post(sender,'/api/dispute/inspect',{dispute_id:'PP-R-FOREIGN',order_id:order.id})).status,409);
  assert.equal((await post(sender,'/api/dispute/inspect',{dispute_id:'PP-R-MISSING',order_id:order.id})).status,502);
  assert.equal((await packet(sender)).dispute_observations.length,1);
  await new Promise(r=>sender.server.close(r));sender=await startServer(opts);assert.deepEqual((await packet(sender)).dispute_observations,p.dispute_observations);
  receiver=await startServer({env:{PORT:'0'},dataFile:path.join(dir,'receiver.json'),fetchImpl:()=>{throw Error('recipient must not call provider');}});
  assert.equal((await post(receiver,'/api/packet/import',{packet:p})).status,201);assert.equal((await post(receiver,'/api/packet/import',{packet:p})).status,201);
  const shared=await packet(receiver);assert.equal(shared.dispute_observations.length,1);assert.equal(shared.dispute_observations[0].source,'imported_packet');assert.match(shared.diagnosis.notes.find(n=>n.title.startsWith('Shared dispute')).detail,/not been re-read/);
  assert.equal((await post(receiver,'/api/dispute/inspect',{order_id:order.id,dispute_id:raw.dispute_id})).status,409);
 }finally{if(sender)await new Promise(r=>sender.server.close(r));if(receiver)await new Promise(r=>receiver.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
