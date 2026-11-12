import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../server.mjs';

test('archive comparison identifies exact added and changed records without exporting its baseline',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-changed-source-'));
 const dataFile=path.join(dir,'state.json');
 let app=await startServer({env:{PORT:'0'},dataFile});
 const api=async(route,data)=>{const r=await fetch(app.url+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.ok(r.ok,route+' '+r.status);return r.json();};
 const order='ORDER-SOURCE-731';
 const event=(id,type,cap)=>({id,event_type:'PAYMENT.CAPTURE.'+type,resource:{id:cap,private_note:'fixture-private-source-marker',supplementary_data:{related_ids:{order_id:order}}}});
 const work=async()=>(await api('/api/state')).investigation_work[order];
 const archive=async()=>api('/api/investigation/archive',{order_id:order,archived:true,evidence_version:(await work()).evidence_version});
 try{
  await api('/api/webhooks/ingest',event('EVENT-FOCUS-1','PENDING','CAP-OLD-731'));
  await archive();
  let saved=JSON.parse(await readFile(dataFile,'utf8'));
  assert.equal(saved.investigation_work[order].evidence_baseline.version,2);
  assert.doesNotMatch(JSON.stringify(saved.investigation_work),/fixture-private-source-marker|private_note/);
  await api('/api/webhooks/ingest',event('EVENT-FOCUS-1','DENIED','CAP-OLD-731'));
  await api('/api/webhooks/ingest',event('EVENT-FOCUS-10','COMPLETED','CAP-NEW-842'));
  let change=(await work()).changed_sources;
  assert.deepEqual(change.records.map(r=>[r.id,r.change,r.reference]),[
   ['EVENT-FOCUS-10','added','CAP-NEW-842'],['EVENT-FOCUS-1','changed','CAP-OLD-731']]);
  const packet={order:{id:order,status:'APPROVED',units:[]},events:[],snapshots:[]};
  await api('/api/packet/import',{packet});
  change=(await work()).changed_sources;
  assert.equal(change.records.filter(r=>r.kind==='order_read').length,1);
  const readId=change.records.find(r=>r.kind==='order_read').id;
  assert.ok((await api('/api/state')).snapshots.some(r=>r.id===readId));
  await api('/api/packet/import',{packet});
  assert.deepEqual((await work()).changed_sources,change,'repeat packet does not invent another changed source');
  await new Promise(r=>app.server.close(r));app=await startServer({env:{PORT:'0'},dataFile});
  assert.deepEqual((await work()).changed_sources,change);
  const exported=await api('/api/packet?order_id='+order);
  assert.doesNotMatch(JSON.stringify(exported),/evidence_baseline|changed_sources|fixture-private-source-marker/);
  assert.equal(exported.events.length,2);assert.ok(exported.events.every(e=>!e.verified));
  await archive();
  assert.equal((await work()).archived,true);assert.equal((await work()).changed_sources,null);
  await new Promise(r=>app.server.close(r));
  saved=JSON.parse(await readFile(dataFile,'utf8'));delete saved.investigation_work[order].evidence_baseline;await writeFile(dataFile,JSON.stringify(saved));
  app=await startServer({env:{PORT:'0'},dataFile});
  assert.equal((await work()).archived,true,'legacy archive fingerprint remains compatible');
  await api('/api/webhooks/ingest',event('EVENT-LEGACY-NEW','DENIED','CAP-NEW-842'));
  assert.equal((await work()).new_evidence,true);assert.equal((await work()).changed_sources,null,'legacy archive never invents a record baseline');
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});}
});


test('capture-only archive identifies a changed amount and its exact capture record',async()=>{
 const {investigationWork,setInvestigationArchive,evidenceVersion}=await import('../investigation-work.mjs');
 let state={orders:[],events:[],snapshots:[{id:'READ-CAPTURE-71',order_id:'ORDER-CAPTURE-71',resource_kind:'capture',capture_id:'CAP-71',status:'COMPLETED',source:'sandbox_capture_api',amount:{currency:'USD',value:'41.00'}}],investigation_work:{}};
 state=setInvestigationArchive(state,{order_id:'ORDER-CAPTURE-71',archived:true,evidence_version:evidenceVersion(state,'ORDER-CAPTURE-71')});
 assert.equal(investigationWork(state)['ORDER-CAPTURE-71'].archived,true);
 state.snapshots[0].amount={currency:'USD',value:'42.00'};
 const change=investigationWork(state)['ORDER-CAPTURE-71'];
 assert.equal(change.new_evidence,true);
 assert.deepEqual(change.changed_sources.records,[{kind:'capture_read',id:'READ-CAPTURE-71',change:'changed',label:'Capture read · COMPLETED',reference:'CAP-71'}]);
});


test('published legacy archive stays archived on upgrade but actual added metadata reopens it',async()=>{
 const {createHash}=await import('node:crypto');
 const {investigationWork}=await import('../investigation-work.mjs');
 const order={id:'OLD-ORDER-71',status:'COMPLETED',units:[]};
 const read={id:'OLD-READ-71',order_id:order.id,status:'COMPLETED',source:'sandbox_api',observed_at:'2026-11-10T12:00:00Z',captures:[]};
 const oldVersion=createHash('sha256').update(JSON.stringify([[order.status,order.units,false,false],[],[[read.status,read.source,undefined,read.observed_at,read.captures]]])).digest('hex');
 const state={orders:[order],events:[],snapshots:[read],investigation_work:{[order.id]:{archived_at:'2026-11-10T13:00:00Z',evidence_version:oldVersion}}};
 assert.equal(investigationWork(state)[order.id].archived,true);
 assert.equal(investigationWork(state)[order.id].new_evidence,false);
 for(const updated of [
  {...read,requested_at:'2026-11-10T11:59:59Z'},
  {...read,status:'REFUNDED'},
  {...read,resource_kind:'capture',capture_id:'CAP-71',amount:{currency:'USD',value:'1.00'}}
 ]){
  const changed=investigationWork({...state,snapshots:[updated]})[order.id];
  assert.equal(changed.archived,false);assert.equal(changed.new_evidence,true);assert.equal(changed.changed_sources,null);
 }
 assert.equal(investigationWork({...state,snapshots:[read,{...read,id:'NEW-READ-72',observed_at:'2026-11-10T14:00:00Z'}]})[order.id].new_evidence,true);
});

test('archived refund changes identify exact scoped reads and preserve legacy uncertainty',async()=>{
 const {investigationWork,setInvestigationArchive,evidenceVersion}=await import('../investigation-work.mjs');
 const order='ORDER-REFUND-ARCHIVE';
 let state={orders:[{id:order,status:'COMPLETED',units:[]}],events:[],snapshots:[],refund_observations:[],investigation_work:{}};
 const archive=()=>{state=setInvestigationArchive(state,{order_id:order,archived:true,evidence_version:evidenceVersion(state,order)});};
 const work=()=>investigationWork(state)[order];
 archive();
 const refund={id:'REFUND-READ-ONE',order_id:order,refund_id:'REFUND-ONE',capture_id:'CAPTURE-ONE',status:'COMPLETED',amount:{currency:'USD',value:'0.25'},source:'imported_packet'};
 state.refund_observations.push(refund,{...refund,id:'OTHER-READ',order_id:'OTHER-ORDER'});
 assert.equal(work().new_evidence,true);
 assert.deepEqual(work().changed_sources.records,[{kind:'refund_read',id:refund.id,change:'added',label:'Refund read · COMPLETED',reference:refund.refund_id}]);
 archive();assert.equal(work().archived,true);
 refund.status='FAILED';
 assert.equal(work().changed_sources.records[0].change,'changed');
 assert.equal(work().changed_sources.records[0].label,'Refund read · FAILED');
 archive();state.refund_observations=state.refund_observations.filter(r=>r!==refund);
 assert.equal(work().changed_sources.removed,1);
 state.refund_observations.push(refund);archive();
 delete state.investigation_work[order].evidence_baseline.refunds;
 assert.equal(work().archived,true,'legacy baseline does not reopen unchanged evidence');
 state.refund_observations.push({...refund,id:'REFUND-READ-TWO',status:'COMPLETED'});
 assert.equal(work().new_evidence,true);
 assert.deepEqual(work().changed_sources.records,[],'legacy baselines cannot identify which refund read is new');
});

test('receipt clocks and retained event identity reopen exact sources without import-time noise',async()=>{
 const {investigationWork,setInvestigationArchive,evidenceVersion}=await import('../investigation-work.mjs');
 const id='ORDER-RECEIPTS',event={id:'RECEIPT-ONE',order_id:id,type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-ONE',source:'imported_packet',reported_source:'webhook',occurred:'2026-11-10T10:12:00Z',received:null,event_id:'EVENT-ONE'};
 let state={orders:[{id,status:'COMPLETED',units:[],imported:true}],events:[event],snapshots:[],investigation_work:{}};
 const archive=()=>{state=setInvestigationArchive(state,{order_id:id,archived:true,evidence_version:evidenceVersion(state,id)});};
 archive();const before=evidenceVersion(state,id);event.received='2026-11-10T10:13:04Z';
 assert.notEqual(evidenceVersion(state,id),before);assert.throws(()=>setInvestigationArchive(state,{order_id:id,archived:true,evidence_version:before}),/Evidence changed/);
 let work=investigationWork(state)[id];assert.equal(work.new_evidence,true);assert.equal(work.changed_sources.records[0].id,event.id);assert.equal(work.changed_sources.records[0].change,'changed');assert.deepEqual(work.changed_sources.records[0].receipt,{at:event.received,shared:true});
 archive();event.imported_at='2026-11-11T23:00:00Z';assert.equal(investigationWork(state)[id].archived,true);
 event.event_id='EVENT-TWO';assert.equal(investigationWork(state)[id].new_evidence,true);
 event.type='PAYMENT.CAPTURE.COMPLETED';archive();event.capture_amount={currency:'USD',value:'5.00'};assert.equal(investigationWork(state)[id].new_evidence,true);
 event.source='sandbox_event_api';event.provider_observed_at='2026-11-10T10:20:00Z';archive();event.received='2026-11-10T10:16:08Z';assert.equal(investigationWork(state)[id].changed_sources.records[0].receipt,null);
});
test('format-two archives retain their original comparison until explicitly archived again',async()=>{
 const {createHash}=await import('node:crypto'),{investigationWork,setInvestigationArchive,evidenceVersion}=await import('../investigation-work.mjs');
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),id='ORDER-LEGACY-EVENT';
 const order={id,status:'COMPLETED',units:[],imported:true},event={id:'EVENT-OLD',order_id:id,type:'PAYMENT.CAPTURE.COMPLETED',source:'imported_packet',received:'2026-11-10T10:13:04Z'};
 const ov=[order.status,order.units,false,true],ev=[event.id,event.type,event.resource_id,event.capture_id,event.refund_amount,event.refund_status,event.occurred,false,false,event.source,event.transmission_id,event.error];
 let state={orders:[order],events:[event],snapshots:[],investigation_work:{[id]:{archived_at:'2026-11-10T12:00:00Z',evidence_version_format:2,evidence_version:hash([ov,[ev],[]]),evidence_baseline:{version:1,order:hash(ov),events:{[event.id]:hash(ev)},reads:{},disputes:{}}}}};
 assert.equal(investigationWork(state)[id].archived,true);
 state.events.push({...event,id:'EVENT-NEW'});let work=investigationWork(state)[id];assert.equal(work.new_evidence,true);assert.deepEqual(work.changed_sources.records.map(r=>r.id),['EVENT-NEW']);
 state=setInvestigationArchive(state,{order_id:id,archived:true,evidence_version:evidenceVersion(state,id)});
 event.received='2026-11-10T10:16:08Z';assert.equal(investigationWork(state)[id].new_evidence,true);
});
