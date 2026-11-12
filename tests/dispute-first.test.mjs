import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {startServer} from '../server.mjs';
const caseId='PP-R-FIRST-73',cap='CAPTURE-FIRST-73',order='ORDER-FIRST-73';
test('case-first lookup follows only exact provider identities and preserves the read chain',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dispute-first-'));let app;const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,method:options.method});if(url.endsWith('/token'))return Response.json({access_token:'fixture',expires_in:3600});
 if(url.endsWith('/disputes/'+caseId))return Response.json({dispute_id:caseId,status:'WAITING_FOR_SELLER_RESPONSE',disputed_transactions:[{seller_transaction_id:cap}],dispute_amount:{currency_code:'USD',value:'6.17'}});
 if(url.endsWith('/captures/'+cap))return Response.json({id:cap,status:'PENDING',amount:{currency_code:'USD',value:'6.17'},supplementary_data:{related_ids:{order_id:order}}});
 if(url.endsWith('/orders/'+order))return Response.json({id:order,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:cap,status:'PENDING',amount:{currency_code:'USD',value:'6.17'}}]}}]});
 throw Error('Unexpected route '+url);};
 try{app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},fetchImpl,dataFile:path.join(dir,'state.json')});
 const response=await fetch(app.url+'/api/dispute/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dispute_id:caseId})});assert.equal(response.status,201);const result=await response.json();assert.equal(result.order_id,order);assert.equal(result.capture_id,cap);
 const packet=await fetch(app.url+'/api/packet?order_id='+order).then(r=>r.json());assert.equal(packet.dispute_observations[0].dispute_id,caseId);assert.deepEqual(packet.dispute_observations[0].matched_capture_ids,[cap]);assert.equal(packet.order.units[0].captures[0].status,'PENDING');assert.equal(packet.snapshots.length,2);assert.equal(packet.events.length,0);assert.ok(packet.dispute_observations[0].observed_at<=packet.snapshots.find(r=>r.resource_kind==='capture').observed_at);
 assert.deepEqual(calls.filter(c=>!c.url.endsWith('/token')).map(c=>c.method),['GET','GET','GET']);
 }finally{if(app)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
for(const mode of ['multiple','foreign-choice','wrong-case','wrong-capture','no-related-order','wrong-order','order-without-capture']){
 test('case-first '+mode+' never saves a guessed association',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dispute-choice-'));let app;const paths=[];
 const fetchImpl=async(url)=>{paths.push(url);if(url.endsWith('/token'))return Response.json({access_token:'fixture'});
 if(url.endsWith('/disputes/'+caseId))return Response.json({dispute_id:mode==='wrong-case'?'PP-R-OTHER':caseId,status:'OPEN',disputed_transactions:[{seller_transaction_id:cap},...(mode==='multiple'||mode==='foreign-choice'?[{seller_transaction_id:'CAPTURE-SECOND-73'}]:[])]});
 if(url.endsWith('/captures/'+cap))return Response.json({id:mode==='wrong-capture'?'CAPTURE-WRONG':cap,status:'COMPLETED',...(mode==='no-related-order'?{}:{supplementary_data:{related_ids:{order_id:order}}})});
 if(url.endsWith('/orders/'+order))return Response.json({id:mode==='wrong-order'?'ORDER-WRONG':order,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:mode==='order-without-capture'?'CAPTURE-WRONG':cap,status:'COMPLETED'}]}}]});
 throw Error('Unexpected route '+url);};
 try{app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},fetchImpl,dataFile:path.join(dir,'state.json')});
 const r=await fetch(app.url+'/api/dispute/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dispute_id:caseId,...(mode==='foreign-choice'?{capture_id:'CAPTURE-NOT-LISTED'}:{})})});const body=await r.json();
 if(mode==='multiple'){assert.equal(r.status,200);assert.equal(body.selection_required,true);assert.deepEqual(body.capture_ids,[cap,'CAPTURE-SECOND-73']);assert.equal(paths.some(p=>p.includes('/captures/')),false);}
 else assert.ok(r.status>=400,JSON.stringify(body));
 const state=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(state.orders.length,0);assert.equal(state.snapshots.length,0);assert.equal((state.dispute_observations??[]).length,0);
 }finally{if(app)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
 });
}
test('multi-transaction choice opens only the chosen exact capture',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dispute-selected-'));let app;const calls=[];
 const selected='CAPTURE-SECOND-73';
 const fetchImpl=async(url)=>{calls.push(url);if(url.endsWith('/token'))return Response.json({access_token:'fixture'});
 if(url.endsWith('/disputes/'+caseId))return Response.json({dispute_id:caseId,status:'OPEN',disputed_transactions:[{seller_transaction_id:cap},{seller_transaction_id:selected}]});
 if(url.endsWith('/captures/'+selected))return Response.json({id:selected,status:'COMPLETED',supplementary_data:{related_ids:{order_id:order}}});
 if(url.endsWith('/orders/'+order))return Response.json({id:order,status:'COMPLETED',purchase_units:[{payments:{captures:[{id:selected,status:'COMPLETED'}]}}]});
 throw Error('Unexpected route '+url);};
 try{app=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},fetchImpl,dataFile:path.join(dir,'state.json')});
 const r=await fetch(app.url+'/api/dispute/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dispute_id:caseId,capture_id:selected})});assert.equal(r.status,201);const body=await r.json();assert.equal(body.capture_id,selected);assert.deepEqual(body.dispute.matched_capture_ids,[selected]);assert.equal(calls.some(p=>p.endsWith('/captures/'+cap)),false);
 }finally{if(app)await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
