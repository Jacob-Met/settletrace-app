import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeOrder,normalizeEvent,reconcile,startServer,captureEvidence} from '../server.mjs';
const orderFixture=(captures=[])=>({id:'ORDER-12345678',status:captures.length?'COMPLETED':'APPROVED',update_time:'2026-11-10T04:00:00Z',payer:{email_address:'must-not-appear@example.com'},purchase_units:[{amount:{currency_code:'USD',value:'42.00'},payments:{captures}}]});
const eventFixture=(type='PAYMENT.CAPTURE.COMPLETED',id='E-1')=>({id,event_type:type,create_time:'2026-11-10T04:01:00Z',resource:{id:'CAPTURE-7',payer:{email_address:'redact@example.com'},supplementary_data:{related_ids:{order_id:'ORDER-12345678'}}}});
const jsonResponse=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
async function run(app,fn) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-test-'));
 const instance=await startServer({env:{PORT:'0',...app.env},dataFile:path.join(dir,'state.json'),fetchImpl:app.fetchImpl??fetch});
 async function api(url,method='GET',payload,headers={}) {
  let r=await fetch(instance.url+url,{method,headers:{...headers,...(payload!==undefined?{'Content-Type':'application/json'}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  return {status:r.status,body:await r.json()};
 }
 try{await fn({api,instance,dir});}finally{await new Promise(resolve=>instance.server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
const env={PAYPAL_CLIENT_ID:'synthetic-client',PAYPAL_CLIENT_SECRET:'synthetic-secret',PAYPAL_WEBHOOK_ID:'WEBHOOK-TEST'};
function mockPaypal(url,opts) {
 if(url.endsWith('/v1/oauth2/token'))return Promise.resolve(jsonResponse({access_token:'synthetic-token',expires_in:3600}));
 if(url.includes('/v2/checkout/orders/'))return Promise.resolve(jsonResponse(orderFixture()));
 if(url.endsWith('/v1/notifications/verify-webhook-signature'))return Promise.resolve(jsonResponse({verification_status:'SUCCESS'}));
 if(url.endsWith('/v1/chat/completions'))return Promise.resolve(jsonResponse({choices:[{message:{content:'Order approved [O1]. The capture event was independently verified [E1]. Re-fetch the order.'}}]}));
 throw Error('unexpected network '+url);
}
const sig={'paypal-transmission-id':'SYNTH-1','paypal-transmission-time':'2026-11-10T04:00:00Z','paypal-cert-url':'https://api.sandbox.paypal.com/invalid','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'SYNTHETIC'};
test('sanitizes order and webhook without payer data',()=>{
 let o=normalizeOrder(orderFixture([{id:'C1',status:'COMPLETED',amount:{currency_code:'USD',value:'42.00'}}]));assert.equal(o.units[0].captures[0].status,'COMPLETED');assert.doesNotMatch(JSON.stringify(o),/example.com|payer/);
 let e=normalizeEvent(eventFixture(),true);assert.equal(e.order_id,'ORDER-12345678');assert.equal(e.verified,true);assert.doesNotMatch(JSON.stringify(e),/redact@example.com|payer/);
});
test('deterministic finding refuses to trust unsigned or sample completion',()=>{
 const o=normalizeOrder(orderFixture());
 const unverified=normalizeEvent(eventFixture(),false,true,'sample');
 const a=reconcile(o,[unverified]);assert.ok(a.notes.some(x=>x.title==='Unverified event evidence'));assert.equal(a.notes.some(x=>x.level==='investigate'),false);
 const verified=normalizeEvent(eventFixture(),true);
 const b=reconcile(o,[verified]);assert.ok(b.notes.some(x=>x.level==='investigate'));assert.ok(b.actions.some(x=>x.includes('Re-fetch')));
});
test('separates completed snapshot from missing webhook and captures denial',()=>{
 const o=normalizeOrder(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}]));
 let a=reconcile(o,[]);assert.ok(a.notes.some(x=>x.title.includes('without a verified delivery')));
 let b=reconcile(o,[normalizeEvent(eventFixture('PAYMENT.CAPTURE.DENIED'),true)]);
 assert.ok(b.notes.some(x=>x.title==='Same capture has failure and completion'&&x.detail.includes('CAPTURE-7')));
});
test('actual HTTP sample course marks example as untrusted and persists packet',async()=>{
 await run({},async({api,dir})=>{
  let initial=await api('/api/state');assert.equal(initial.status,200);assert.equal(initial.body.orders.length,0);
  const sample=await api('/api/sample','POST',{});assert.equal(sample.status,200);
  const state=await api('/api/state');assert.equal(state.body.orders[0].sample,true);assert.equal(state.body.events[0].verified,false);
  const packet=await api('/api/packet?order_id=SAMPLE-ORDER-105');assert.equal(packet.status,200);assert.equal(packet.body.order.id,'SAMPLE-ORDER-105');assert.equal(packet.body.diagnosis.notes.some(x=>x.level==='investigate'),false);
  const file=await readFile(path.join(dir,'state.json'),'utf8');assert.match(file,/SAMPLE-ORDER-105/);
 });
});
test('order inspection performs real OAuth + sandbox GET through injected upstream and isolates PII',async()=>{
 let requests=[];
 await run({env,fetchImpl:async(url,options)=>{requests.push({url,method:options.method,auth:options.headers.Authorization?.startsWith('Bearer ')});return mockPaypal(url,options);}},async({api})=>{
  let x=await api('/api/order/inspect','POST',{order_id:'order-12345678'});assert.equal(x.status,200);assert.equal(x.body.order.status,'APPROVED');assert.doesNotMatch(JSON.stringify(x.body),/example.com/);
  assert.equal(requests.length,2);assert.ok(requests[0].url.includes('/v1/oauth2/token'));assert.ok(requests[1].url.includes('/v2/checkout/orders/ORDER-12345678'));assert.equal(requests[1].auth,true);
  let bad=await api('/api/order/inspect','POST',{order_id:'?bad'});assert.equal(bad.status,400);assert.equal(requests.length,2);
 });
});
test('webhook is only trusted after PayPal verification, then detects genuine contrast',async()=>{
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  let order=await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});assert.equal(order.status,200);
  let missing=await api('/api/webhooks/ingest','POST',eventFixture());assert.equal(missing.status,202);assert.equal(missing.body.verified,false);
  let packet=await api('/api/packet?order_id=ORDER-12345678');assert.ok(packet.body.diagnosis.notes.some(x=>x.level==='caution'));assert.equal(packet.body.diagnosis.notes.some(x=>x.level==='investigate'),false);
  let signed=await api('/api/webhooks/ingest','POST',eventFixture(),sig);assert.equal(signed.status,202);assert.equal(signed.body.verified,true);
  packet=await api('/api/packet?order_id=ORDER-12345678');assert.equal(packet.body.events.length,1);assert.ok(packet.body.diagnosis.notes.some(x=>x.level==='investigate'));
 });
});
test('verification denial is retained but never counted as trusted',async()=>{
 await run({env,fetchImpl:async(url,options)=>url.endsWith('/verify-webhook-signature')?jsonResponse({verification_status:'FAILURE'}):mockPaypal(url,options)},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const e=await api('/api/webhooks/ingest','POST',eventFixture(),sig);assert.equal(e.status,202);assert.equal(e.body.verified,false);
  const p=await api('/api/packet?order_id=ORDER-12345678');assert.equal(p.body.events[0].verified,false);assert.equal(p.body.diagnosis.notes.some(x=>x.level==='investigate'),false);
 });
});
test('model call is refused without connected real model',async()=>{
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  let x=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});assert.equal(x.status,503);assert.match(x.body.error,/not configured/);
 });
});
test('actual model-compatible HTTP response requires existing citations',async()=>{
 const withModel={...env,AI_BASE_URL:'http://127.0.0.1:11501/v1/',AI_MODEL:'test-model'};
 await run({env:withModel,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  let x=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});assert.equal(x.status,502);assert.match(x.body.error,/citations/);
 });
 await run({env:withModel,fetchImpl:async(url,opts)=>url.endsWith('/v1/chat/completions')?jsonResponse({choices:[{message:{content:'The current order reports APPROVED [O1]. No verified webhook is present in this view [O1].'}}]}):mockPaypal(url,opts)},async({api})=>{
  await api('/order/nowhere');await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  let x=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});assert.equal(x.status,200);assert.deepEqual(x.body.citations,['O1']);assert.equal(x.body.model,'test-model');
 });
});
test('rejects cross-site writes and serves CSP-protected real entry point',async()=>{
 await run({},async({api,instance})=>{
  const bad=await api('/api/sample','POST',{}, {Origin:'https://not-your-tool.example'});assert.equal(bad.status,403);
  const r=await fetch(instance.url+'/');assert.equal(r.status,200);assert.match(await r.text(),/id="payment-workspace"/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
  const js=await fetch(instance.url+'/app.js');assert.equal(js.status,200);assert.match(await js.text(),/loadPacket/);
 });
});

test('unsigned duplicate cannot erase a previously verified event',async()=>{
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const verified=await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  assert.equal(verified.body.verified,true);
  const attacker=await api('/api/webhooks/ingest','POST',eventFixture());
  assert.equal(attacker.body.verified,false);
  const packet=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(packet.body.events.length,1);
  assert.equal(packet.body.events[0].verified,true);
  assert.ok(packet.body.diagnosis.notes.some(x=>x.level==='investigate'));
 });
});
test('restart recovers the actual normalized incident without re-admitting sample as verified',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settletrace-restart-'));
 const dataFile=path.join(dir,'state.json');
 const make=()=>startServer({env:{PORT:'0'},dataFile});
 let a=await make();
 try{
  let r=await fetch(a.url+'/api/sample',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,200);
 }finally{await new Promise(done=>a.server.close(done));}
 let b=await make();
 try{
  let r=await fetch(b.url+'/api/packet?order_id=SAMPLE-ORDER-105');
  assert.equal(r.status,200);
  let j=await r.json();
  assert.equal(j.events.length,1);
  assert.equal(j.events[0].verified,false);
  assert.equal(j.order.sample,true);
 }finally{await new Promise(done=>b.server.close(done));await rm(dir,{force:true,recursive:true});}
});

test('retains two authoritative order read snapshots and explains observed transition',async()=>{
 let n=0;
 const alternate=async(url,opts)=>{
  if(url.includes('/v2/checkout/orders/'))return jsonResponse(orderFixture(++n===1?[]:[{id:'CAPTURE-7',status:'COMPLETED',amount:{currency_code:'USD',value:'42.00'}}]));
  return mockPaypal(url,opts);
 };
 await run({env,fetchImpl:alternate},async({api})=>{
  const one=await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const two=await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  assert.equal(one.body.order.status,'APPROVED');
  assert.equal(two.body.order.status,'COMPLETED');
  const state=await api('/api/state');
  assert.deepEqual(state.body.snapshots.map(x=>x.status),['APPROVED','COMPLETED']);
  assert.deepEqual(state.body.snapshots.map(x=>x.source),['sandbox_api','sandbox_api']);
  const packet=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(packet.body.snapshots.length,2);
  assert.ok(packet.body.diagnosis.notes.some(x=>x.title==='Order status changed between API reads'));
  assert.doesNotMatch(JSON.stringify(packet.body),/must-not-appear@example.com/);
 });
});
test('sample historical read stays authored and is never misrepresented as Sandbox API',async()=>{
 await run({},async({api})=>{
  await api('/api/sample','POST',{});
  let state=await api('/api/state');
  assert.equal(state.body.snapshots.length,1);
  assert.equal(state.body.snapshots[0].source,'authored_sample');
  assert.equal(state.body.events[0].verified,false);
  assert.equal(state.body.snapshots[0].status,'APPROVED');
 });
});
test('AI may cite indexed order snapshots but rejects made-up history identifiers',async()=>{
 const aiEnv={...env,AI_BASE_URL:'http://127.0.0.1:11501/v1/',AI_MODEL:'test-model'};
 await run({env:aiEnv,fetchImpl:async(url,opts)=>url.endsWith('/v1/chat/completions')?jsonResponse({choices:[{message:{content:'The historical API snapshot reported APPROVED [S1]. The current order remains APPROVED [O1].'}}]}):mockPaypal(url,opts)},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const a=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});
  assert.equal(a.status,200);
  assert.deepEqual(a.body.citations,['S1','O1']);
 });
 await run({env:aiEnv,fetchImpl:async(url,opts)=>url.endsWith('/v1/chat/completions')?jsonResponse({choices:[{message:{content:'Nonexistent third observation [S3].'}}]}):mockPaypal(url,opts)},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const a=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});
  assert.equal(a.status,502);
 });
});

test('manual import is explicitly unverified, drops customer PII and upgrades only after real verifier confirms',async()=>{
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  let imported=await api('/api/events/import','POST',{event:eventFixture()});
  assert.equal(imported.status,201);
  assert.equal(imported.body.event.verified,false);
  assert.equal(imported.body.event.source,'manual');
  let first=await api('/api/packet?order_id=ORDER-12345678');
  assert.ok(first.body.diagnosis.notes.some(x=>x.level==='caution'));
  assert.equal(first.body.diagnosis.notes.some(x=>x.level==='investigate'),false);
  assert.doesNotMatch(JSON.stringify(first.body),/redact@example.com|payer/);
  const signed=await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  assert.equal(signed.body.verified,true);
  const after=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(after.body.events.length,1);
  assert.equal(after.body.events[0].verified,true);
  assert.ok(after.body.diagnosis.notes.some(x=>x.level==='investigate'));
  const attacker=await api('/api/events/import','POST',{event:eventFixture()});
  assert.equal(attacker.status,409);
  const final=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(final.body.events[0].verified,true);
 });
});
test('manual import rejects payload with no recognizable order and malformed events',async()=>{
 await run({},async({api})=>{
  let missing=await api('/api/events/import','POST',{event:{id:'ONE',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'C1'}}});
  assert.equal(missing.status,422);
  let malformed=await api('/api/events/import','POST',{event:{id:'ONE',resource:{id:'ORDER-12345678'}}});
  assert.equal(malformed.status,400);
  const state=await api('/api/state');
  assert.equal(state.body.events.length,0);
 });
});
test('rejects model prose that makes an uncited second factual claim',async()=>{
 const aiEnv={...env,AI_BASE_URL:'http://127.0.0.1:11501/v1/',AI_MODEL:'test-model'};
 await run({env:aiEnv,fetchImpl:async(url,opts)=>url.endsWith('/v1/chat/completions')?jsonResponse({choices:[{message:{content:'The inspected order is APPROVED [O1]. Customer has paid in full.'}}]}):mockPaypal(url,opts)},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const bad=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});
  assert.equal(bad.status,502);
  assert.match(bad.body.error,/sentence-level/);
 });
});

test('verified completion for another capture cannot corroborate a settled order capture',()=>{
 const o=normalizeOrder(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}, {id:'CAPTURE-8',status:'DENIED'}]));
 const other=normalizeEvent({...eventFixture(),resource:{...eventFixture().resource,id:'CAPTURE-9'}},true);
 const result=reconcile(o,[other]);
 assert.ok(result.notes.some(n=>n.title==='Capture event differs from order read'),JSON.stringify(result));
 assert.ok(result.notes.some(n=>n.title==='Completed capture without a verified delivery'),JSON.stringify(result));
 assert.ok(result.actions.some(a=>a.includes('capture IDs')),JSON.stringify(result));
 const matching=reconcile(o,[normalizeEvent(eventFixture(),true)]);
 assert.equal(matching.notes.some(n=>n.title==='Capture event differs from order read'),false);
 assert.equal(matching.notes.some(n=>n.title==='Completed capture without a verified delivery'),false);
});

test('real HTTP reconciliation refuses a signed, unrelated capture as corroboration',async()=>{
 await run({env,fetchImpl:async(url,opts)=>url.includes('/v2/checkout/orders/')?jsonResponse(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}])):mockPaypal(url,opts)},async({api})=>{
  assert.equal((await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'})).status,200);
  const signed=await api('/api/webhooks/ingest','POST',{...eventFixture(),resource:{...eventFixture().resource,id:'CAPTURE-9'}},sig);
  assert.equal(signed.body.verified,true);
  const packet=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(packet.status,200);
  assert.ok(packet.body.diagnosis.notes.some(n=>n.title==='Capture event differs from order read'),JSON.stringify(packet.body.diagnosis));
  assert.ok(packet.body.diagnosis.notes.some(n=>n.title==='Completed capture without a verified delivery'),JSON.stringify(packet.body.diagnosis));
 });
});

test('capture matrix separates attempts and never promotes imported or sample events',()=>{
 const order=normalizeOrder(orderFixture([{id:'CAPTURE-7',status:'COMPLETED',amount:{currency_code:'USD',value:'42.00'}},{id:'CAPTURE-8',status:'DENIED'}]));
 const matching=normalizeEvent(eventFixture(),true);
 const other=normalizeEvent({...eventFixture('PAYMENT.CAPTURE.COMPLETED','E-OTHER'),resource:{...eventFixture().resource,id:'CAPTURE-9'}},true);
 const imported=normalizeEvent({...eventFixture('PAYMENT.CAPTURE.COMPLETED','E-IMPORT'),resource:{...eventFixture().resource,id:'CAPTURE-8'}},false);
 const rows=captureEvidence(order,[matching,other,imported]);
 assert.equal(rows.length,3);
 assert.match(rows.find(r=>r.id==='CAPTURE-7').assessment,/corroborated/);
 assert.equal(rows.find(r=>r.id==='CAPTURE-7').amount.value,'42.00');
 assert.match(rows.find(r=>r.id==='CAPTURE-8').assessment,/DENIED/);
 assert.equal(rows.find(r=>r.id==='CAPTURE-9').api_status,null);
 assert.match(rows.find(r=>r.id==='CAPTURE-9').assessment,/differs/);
 assert.match(captureEvidence({...order,sample:true},[matching])[0].assessment,/Authored sample/);
 assert.equal(captureEvidence(order,[{...other,order_id:'OTHER-ORDER'}]).length,2);
});
test('HTTP packet exports exact capture matrix with event provenance',async()=>{
 await run({env,fetchImpl:async(url,opts)=>url.includes('/v2/checkout/orders/')?jsonResponse(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}])):mockPaypal(url,opts)},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  await api('/api/events/import','POST',{event:eventFixture()});
  let p=await api('/api/packet?order_id=ORDER-12345678');
  assert.match(p.body.captures[0].assessment,/matching verified completion absent/);
  assert.equal(p.body.captures[0].events[0].verified,false);
  await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  p=await api('/api/packet?order_id=ORDER-12345678');
  assert.match(p.body.captures[0].assessment,/corroborated/);
 });
});

test('capture rows preserve their own mixed provenance within a sample order',()=>{
 const order={...normalizeOrder(orderFixture()),sample:true};
 const sample=normalizeEvent(eventFixture(),false,true);
 const imported=normalizeEvent({...eventFixture('PAYMENT.CAPTURE.COMPLETED','IMPORT'),resource:{...eventFixture().resource,id:'CAPTURE-IMPORTED'}},false,false);
 const rows=captureEvidence(order,[sample,imported]);
 assert.match(rows.find(r=>r.id==='CAPTURE-7').assessment,/Authored sample/);
 const row=rows.find(r=>r.id==='CAPTURE-IMPORTED');
 assert.equal(row.sample,false);
 assert.equal(row.events[0].sample,false);
 assert.match(row.assessment,/Unverified event; no authoritative/);
 assert.doesNotMatch(row.assessment,/Authored/);
});

test('event-first incident exports unknown order, preserves trust, then joins authoritative read',async()=>{
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/events/import','POST',{event:eventFixture()});
  const before=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(before.status,200);assert.equal(before.body.order,null);assert.equal(before.body.order_id,'ORDER-12345678');
  assert.equal(before.body.events.length,1);assert.equal(before.body.snapshots.length,0);
  assert.equal(before.body.captures.length,1);assert.equal(before.body.captures[0].api_status,null);assert.equal(before.body.captures[0].events[0].verified,false);assert.match(before.body.captures[0].assessment,/Unverified event/);
  assert.ok(before.body.diagnosis.notes.some(x=>x.title==='No order observation'));
  assert.ok(before.body.diagnosis.notes.some(x=>x.title==='Unverified event evidence'));
  assert.doesNotMatch(JSON.stringify(before.body),/redact@example.com|payer/);
  const missing=await api('/api/packet?order_id=UNSEEN-ORDER');assert.equal(missing.status,404);
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const after=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(after.body.order.status,'APPROVED');assert.equal(after.body.events.length,1);
  assert.equal(after.body.events[0].verified,false);assert.equal(after.body.snapshots.length,1);
 });
});
test('event-only AI can cite event evidence but cannot cite nonexistent order observation',async()=>{
 const aiEnv={AI_BASE_URL:'http://127.0.0.1:11501/v1/',AI_MODEL:'test-model'};
 for(const [note,status] of [['An unverified completion event was imported [E1].',200],['The order is paid [O1].',502]]){
  await run({env:aiEnv,fetchImpl:async(url,opts)=>{
   assert.match(opts.body,/No order API observation exists/);
   return jsonResponse({choices:[{message:{content:note}}]});
  }},async({api})=>{
   await api('/api/events/import','POST',{event:eventFixture()});
   const answer=await api('/api/ai/explain','POST',{order_id:'ORDER-12345678'});
   assert.equal(answer.status,status);
  });
 }
});

test('shared incident packet can be reopened but never reattests signed webhook evidence',async()=>{
 let exported;
 await run({env,fetchImpl:async(url,opts)=>url.includes('/v2/checkout/orders/')?jsonResponse(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}])):mockPaypal(url,opts)},async({api})=>{
  assert.equal((await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'})).status,200);
  assert.equal((await api('/api/webhooks/ingest','POST',eventFixture(),sig)).body.verified,true);
  exported=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(exported.events[0].verified,true);
 });
 await run({},async({api})=>{
  const incoming=await api('/api/packet/import','POST',{packet:exported});
  assert.equal(incoming.status,201,JSON.stringify(incoming.body));
  const state=(await api('/api/state')).body;
  assert.equal(state.orders[0].imported,true);
  assert.equal(state.events[0].verified,false);
  assert.equal(state.events[0].reported_verified,true);
  assert.equal(state.events[0].source,'imported_packet');
  assert.equal(state.snapshots[0].source,'imported_packet');
  assert.equal(state.snapshots[0].reported_source,'sandbox_api');
  const p=await api('/api/packet?order_id=ORDER-12345678');
  assert.equal(p.status,200);
  assert.ok(p.body.diagnosis.notes.some(n=>n.title==='Imported order is not a fresh Sandbox read'));
  assert.equal(p.body.diagnosis.notes.some(n=>n.title==='No contradiction among available records'),false);
  assert.equal(p.body.events[0].verified,false);
  assert.ok(p.body.captures.some(c=>c.id==='CAPTURE-7'&&c.assessment.includes('not locally revalidated')),JSON.stringify(p.body.captures));
 });
});

test('a shared packet cannot replace a locally received unsigned webhook with the same event ID',async()=>{
 const packet={order:{id:'ORDER-12345678',status:'APPROVED',units:[{amount:{currency:'USD',value:'42.00'},captures:[]}]},events:[{id:'E-1',type:'PAYMENT.CAPTURE.COMPLETED',order_id:'ORDER-12345678',resource_id:'CAPTURE-7',verified:true}],snapshots:[]};
 await run({},async({api})=>{
  const local=await api('/api/webhooks/ingest','POST',eventFixture());
  assert.equal(local.status,202);
  assert.equal(local.body.verified,false);
  const incoming=await api('/api/packet/import','POST',{packet});
  assert.equal(incoming.status,409);
  const state=(await api('/api/state')).body;
  assert.equal(state.events.length,1);
  assert.equal(state.events[0].source,undefined);
  assert.equal(state.events[0].verified,false);
  assert.equal(state.orders.length,0);
 });
});

test('forwarding a normalized shared packet keeps the reported upstream source without promoting trust',async()=>{
 const one={generated:'2026-11-09T12:00:00Z',order:{id:'ORDER-12345678',status:'COMPLETED',units:[{amount:{currency:'USD',value:'42.00'},captures:[{id:'CAPTURE-7',status:'COMPLETED'}]}]},events:[{id:'WH-ORIGINAL',type:'PAYMENT.CAPTURE.COMPLETED',order_id:'ORDER-12345678',resource_id:'CAPTURE-7',verified:true}],snapshots:[{id:'ORIGIN-S1',order_id:'ORDER-12345678',status:'COMPLETED',source:'sandbox_api',observed_at:'2026-11-09T12:01:00Z',captures:[{id:'CAPTURE-7',status:'COMPLETED'}]}]};
 let middle;
 await run({},async({api})=>{
  assert.equal((await api('/api/packet/import','POST',{packet:one})).status,201);
  middle=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(middle.events[0].verified,false);
  assert.equal(middle.events[0].reported_verified,true);
 });
 await run({},async({api})=>{
  assert.equal((await api('/api/packet/import','POST',{packet:middle})).status,201);
  const final=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(final.events[0].verified,false);
  assert.equal(final.events[0].reported_verified,true);
  assert.equal(final.snapshots[0].source,'imported_packet');
  assert.equal(final.snapshots[0].reported_source,'sandbox_api');
 });
});

test('packet import rejects overriding local Sandbox reads and removes unexpected payer data',async()=>{
 const injected={order:{id:'ORDER-12345678',status:'COMPLETED',payer:{email_address:'secret-payer@example.com'},units:[{amount:{currency:'USD',value:'42.00'},captures:[{id:'CAPTURE-7',status:'COMPLETED',payer:{email_address:'bad@example.com'}}]}]},events:[{id:'WH-IMPORTED',type:'PAYMENT.CAPTURE.COMPLETED',order_id:'ORDER-12345678',resource_id:'CAPTURE-7',verified:true,payer:{email_address:'bad@example.com'}}],snapshots:[]};
 await run({},async({api})=>{
  const bad=await api('/api/packet/import','POST',{packet:{...injected,events:[{id:'mismatch',type:'PAYMENT.CAPTURE.COMPLETED',order_id:'OTHER-ORDER',verified:true}]}});
  assert.equal(bad.status,422);
  const admitted=await api('/api/packet/import','POST',{packet:injected});
  assert.equal(admitted.status,201,JSON.stringify(admitted.body));
  const state=(await api('/api/state')).body;
  assert.doesNotMatch(JSON.stringify(state),/secret-payer@example.com|bad@example.com/);
  assert.equal(state.events[0].verified,false);
  assert.equal(state.snapshots[0].source,'imported_packet');
  assert.equal(state.snapshots[0].reported_source,'packet_order');
  assert.equal(state.snapshots[0].captures[0].id,'CAPTURE-7');
 });
 await run({env,fetchImpl:mockPaypal},async({api})=>{
  await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
  const conflict=await api('/api/packet/import','POST',{packet:injected});
  assert.equal(conflict.status,409);
  const state=(await api('/api/state')).body;
  assert.equal(state.orders[0].imported,undefined);
  assert.equal(state.events.length,0);
 });
});

test('actual model HTTP prioritization returns only canonical evidence checks',async()=>{
 const aiEnv={AI_BASE_URL:'http://127.0.0.1:11501/v1/',AI_MODEL:'test-model'};
 await run({env:aiEnv,fetchImpl:async(url,opts)=>{
  const request=JSON.parse(opts.body);assert.equal(request.response_format.type,'json_object');
  const input=JSON.parse(request.messages[1].content);
  return jsonResponse({choices:[{message:{content:JSON.stringify({order:input.checks.map(c=>c.id).reverse(),invented:'The buyer has paid.'})}}]});
 }},async({api})=>{
  await api('/api/events/import','POST',{event:eventFixture()});
  const result=await api('/api/ai/prioritize','POST',{order_id:'ORDER-12345678'});
  assert.equal(result.status,200);assert.equal(result.body.wording,'deterministic_evidence_review');assert.equal(result.body.checks.length,3);
  assert.doesNotMatch(JSON.stringify(result.body),/buyer has paid/);assert.ok(result.body.checks.some(c=>c.title==='No order observation'));
 });
});
test('original signed delivery survives outage and can be explicitly reverified without leaking private source',async()=>{
 let fail=true,verifiedPayload;
 await run({env,fetchImpl:async(url,opts)=>{
  if(url.endsWith('/verify-webhook-signature')){
   verifiedPayload=JSON.parse(opts.body);
   if(fail)throw Error('offline');
   return jsonResponse({verification_status:'SUCCESS'});
  }
  return mockPaypal(url,opts);
 }},async({api,dir})=>{
  const initial=await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  assert.equal(initial.body.verified,false);
  const source=await api('/api/event/source?event_id=E-1');
  assert.equal(source.status,200);
  assert.deepEqual(source.body.event,eventFixture());
  assert.equal(source.body.headers.transmission_sig,'SYNTHETIC');
  assert.match(await readFile(path.join(dir,'state.json'),'utf8'),/redact@example.com/);
  assert.doesNotMatch(JSON.stringify((await api('/api/state')).body),/redact@example.com|SYNTHETIC/);
  assert.doesNotMatch(JSON.stringify((await api('/api/packet?order_id=ORDER-12345678')).body),/redact@example.com|SYNTHETIC/);
  assert.equal((await api('/api/event/reverify','POST',{event_id:'E-1'})).status,503);
  fail=false;
  const retry=await api('/api/event/reverify','POST',{event_id:'E-1'});
  assert.equal(retry.body.status,'verified');
  assert.deepEqual(verifiedPayload.webhook_event,eventFixture());
  assert.equal((await api('/api/state')).body.events[0].verified,true);
 });
});
test('reverification distinguishes invalid signature from missing source',async()=>{
 await run({env,fetchImpl:async(url,opts)=>url.endsWith('/verify-webhook-signature')?jsonResponse({verification_status:'FAILURE'}):mockPaypal(url,opts)},async({api})=>{
  await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  const retry=await api('/api/event/reverify','POST',{event_id:'E-1'});
  assert.equal(retry.status,200);assert.equal(retry.body.status,'invalid');
  assert.equal((await api('/api/state')).body.events[0].verified,false);
  await api('/api/events/import','POST',{event:eventFixture('PAYMENT.CAPTURE.PENDING','MANUAL')});
  assert.equal((await api('/api/event/reverify','POST',{event_id:'MANUAL'})).status,409);
 });
});

test('manual replacement is rejected while original delivery verification is in flight',async()=>{
 let release,entered;
 const began=new Promise(resolve=>entered=resolve);
 let retry=false;
 await run({env,fetchImpl:async(url,opts)=>{
  if(url.endsWith('/verify-webhook-signature')){
   if(!retry)throw Error('offline');
   entered();return await new Promise(resolve=>release=()=>resolve(jsonResponse({verification_status:'SUCCESS'})));
  }
  return mockPaypal(url,opts);
 }},async({api})=>{
  await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  retry=true;
  const pending=api('/api/event/reverify','POST',{event_id:'E-1'});
  await began;
  const replacement=await api('/api/events/import','POST',{event:eventFixture('PAYMENT.CAPTURE.DENIED')});
  release();
  assert.equal(replacement.status,409);
  assert.equal((await pending).status,200);
  const retained=(await api('/api/state')).body.events[0];
  assert.equal(retained.verified,true);
  assert.equal(retained.type,'PAYMENT.CAPTURE.COMPLETED');
  assert.deepEqual((await api('/api/event/source?event_id=E-1')).body.event,eventFixture());
 });
});
test('exported event-first incidents reopen in another workspace without inventing order reads',async()=>{
 let shared;
 await run({},async({api})=>{
  const event=await api('/api/events/import','POST',{event:eventFixture()});
  assert.equal(event.status,201);
  shared=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(shared.order,null);
  assert.equal(shared.order_id,'ORDER-12345678');
  assert.equal(shared.events.length,1);
 });
 await run({},async({api})=>{
  const opened=await api('/api/packet/import','POST',{packet:shared});
  assert.equal(opened.status,201,JSON.stringify(opened.body));
  assert.equal(opened.body.order_id,'ORDER-12345678');
  const s=(await api('/api/state')).body;
  assert.equal(s.orders.length,0);
  assert.equal(s.events.length,1);
  assert.equal(s.events[0].source,'imported_packet');
  assert.equal(s.events[0].verified,false);
  const p=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(p.order,null);
  assert.ok(p.diagnosis.notes.some(n=>n.title==='No order observation'));
  assert.match(p.captures[0].assessment,/Unverified event/);
 });
});



test('decisive missing observations and capture contradictions precede contextual cautions',()=>{
 const untrusted=normalizeEvent(eventFixture(),false);
 const missing=reconcile(null,[untrusted],[],'ORDER-12345678');
 assert.equal(missing.notes[0].title,'No order observation');
 assert.ok(missing.notes.some(n=>n.title==='Unverified event evidence'));
 const imported={...normalizeOrder(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}])),imported:true};
 assert.equal(reconcile(imported,[untrusted]).notes[0].title,'Imported order is not a fresh Sandbox read');
 const other=normalizeOrder(orderFixture([{id:'CAPTURE-OTHER',status:'COMPLETED'}]));
 const contradiction=reconcile(other,[untrusted,normalizeEvent(eventFixture('PAYMENT.CAPTURE.COMPLETED','SIGNED-OTHER'),true)]);
 assert.equal(contradiction.notes[0].title,'Capture event differs from order read');
 assert.ok(contradiction.notes.some(n=>n.title==='Unverified event evidence'));
 assert.ok(contradiction.actions.some(a=>a.includes('never recapture')));
});

test('a singleton supported check returns immediately without contacting a model',async()=>{
 for(const configured of [false,true]){
  let modelCalls=0;
  await run({env:{...env,...(configured?{AI_BASE_URL:'https://model.invalid/v1/',AI_MODEL:'unneeded'}:{})},fetchImpl:async(url,opts)=>{
   if(url.includes('model.invalid')){modelCalls++;throw Error('Singleton must not contact model');}
   if(url.includes('/v2/checkout/orders/'))return new Response(JSON.stringify({id:'ORDER-12345678',status:'CREATED',purchase_units:[]}));
   return mockPaypal(url,opts);
  }},async({api})=>{
   await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'});
   const response=await api('/api/ai/prioritize','POST',{order_id:'ORDER-12345678'});
   assert.equal(response.status,200);assert.equal(response.body.mode,'no_ranking_needed');
   assert.equal(response.body.model,null);assert.equal(response.body.checks.length,1);
   assert.equal(response.body.checks[0].title,'No contradiction among available records');
   assert.equal(modelCalls,0);
  });
 }

});


test('unknown event times survive a real exported incident round trip',async()=>{
 let shared;
 await run({},async({api})=>{
  const event=eventFixture();delete event.create_time;
  assert.equal((await api('/api/events/import','POST',{event})).status,201);
  shared=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(shared.events[0].occurred,null);
 });
 await run({},async({api})=>{
  assert.equal((await api('/api/packet/import','POST',{packet:shared})).status,201);
  const reopened=(await api('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(reopened.events[0].occurred,null);
  assert.equal(reopened.events[0].received,shared.events[0].received);
  assert.equal(reopened.order,null);
 });

});

test('reopening shared packets retains unique observations without multiplying history',async()=>{
 await run({},async({api})=>{
  const packet={order:normalizeOrder(orderFixture()),events:[],snapshots:[{order_id:'ORDER-12345678',status:'APPROVED',source:'sandbox_api',observed_at:'2026-11-10T04:00:00Z',captures:[]}]};
  assert.equal((await api('/api/packet/import','POST',{packet})).status,201);
  const before=(await api('/api/state')).body.snapshots;
  const again=await api('/api/packet/import','POST',{packet});
  assert.equal(again.status,201);
  assert.deepEqual((await api('/api/state')).body.snapshots,before);
  assert.equal(again.body.snapshots,0);assert.equal(again.body.snapshots_already_present,1);
  packet.snapshots.push({...packet.snapshots[0],observed_at:'2026-11-10T05:00:00Z'});
  const changed=await api('/api/packet/import','POST',{packet});
  assert.equal(changed.body.snapshots,1);
  assert.equal((await api('/api/state')).body.snapshots.length,2);
  packet.snapshots.push({...packet.snapshots[1],captures:[{id:'CAPTURE-7',status:'PENDING'}]});
  await api('/api/packet/import','POST',{packet});
  assert.equal((await api('/api/state')).body.snapshots.length,3);
 });
});

test('v2 DECLINED and legacy DENIED cannot corroborate the same completed capture through HTTP',async()=>{
 for(const type of ['PAYMENT.CAPTURE.DECLINED','PAYMENT.CAPTURE.DENIED']){
  await run({env,fetchImpl:(url,opts)=>url.includes('/v2/checkout/orders/')?Promise.resolve(jsonResponse(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}]))):mockPaypal(url,opts)},async({api})=>{
   assert.equal((await api('/api/order/inspect','POST',{order_id:'ORDER-12345678'})).status,200);
   await api('/api/webhooks/ingest','POST',eventFixture('PAYMENT.CAPTURE.COMPLETED','WH-FINISHED'),sig);
   const failed=eventFixture(type,'WH-FAILURE');failed.resource_type='capture';failed.resource_version='2.0';failed.create_time='2026-11-10T04:02:00Z';
   assert.equal((await api('/api/webhooks/ingest','POST',failed,sig)).body.verified,true);
   const {body}=await api('/api/packet?order_id=ORDER-12345678');
   assert.equal(body.diagnosis.notes[0].title,'Same capture has failure and completion');
   assert.match(body.diagnosis.notes[0].detail,/CAPTURE-7/);
   assert.ok(body.diagnosis.notes[0].detail.includes(type.split('.').at(-1)));
   assert.deepEqual(body.diagnosis.notes[0].ids,['WH-FAILURE']);
   assert.ok(body.diagnosis.actions.some(x=>x.includes('timestamps')));
   assert.doesNotMatch(body.captures[0].assessment,/corroborated/);
   assert.match(body.captures[0].assessment,/Same capture/);
  });
 }
});
test('decline from another capture or an unverified source is not a same-capture conflict',()=>{
 const order=normalizeOrder(orderFixture([{id:'CAPTURE-7',status:'COMPLETED'}]));
 const completed=normalizeEvent(eventFixture('PAYMENT.CAPTURE.COMPLETED','WH-COMPLETE'),true);
 const other=normalizeEvent({...eventFixture('PAYMENT.CAPTURE.DECLINED','WH-OTHER'),resource:{id:'CAPTURE-OTHER',supplementary_data:{related_ids:{order_id:order.id}}}},true);
 const separate=reconcile(order,[completed,other]);
 assert.equal(separate.notes[0].title,'Different capture attempts have failure and completion');
 assert.ok(separate.notes[0].detail.includes('CAPTURE-OTHER')&&separate.notes[0].detail.includes('CAPTURE-7'));
 assert.match(captureEvidence(order,[completed,other])[0].assessment,/corroborated/);
 for(const failure of [normalizeEvent(eventFixture('PAYMENT.CAPTURE.DECLINED','WH-UNVERIFIED'),false),normalizeEvent(eventFixture('PAYMENT.CAPTURE.DECLINED','WH-SAMPLE'),true,true)]){
  const diagnosis=reconcile(order,[completed,failure]);
  assert.ok(diagnosis.notes.some(x=>x.title==='Unverified event evidence'));
  assert.ok(!diagnosis.notes.some(x=>x.title==='Same capture has failure and completion'));
  assert.match(captureEvidence(order,[completed,failure])[0].assessment,/corroborated/);
 }
});

test('own exported incident above 250 observations reopens within the file limit',async()=>{
 await run({},async({api:sender})=>{
  for(let i=0;i<251;i++)assert.equal((await sender('/api/events/import','POST',{event:eventFixture('PAYMENT.CAPTURE.PENDING','LONG-EVENT-'+i)})).status,201);
  const packet=(await sender('/api/packet?order_id=ORDER-12345678')).body;
  assert.equal(packet.events.length,251);
  assert.ok(Buffer.byteLength(JSON.stringify({packet}))<512*1024);
  await run({},async({api:receiver})=>{
   const imported=await receiver('/api/packet/import','POST',{packet});
   assert.equal(imported.status,201);assert.equal(imported.body.events,251);
   const recovered=(await receiver('/api/packet?order_id=ORDER-12345678')).body;
   assert.deepEqual(recovered.events.map(e=>e.id),packet.events.map(e=>e.id));
   assert.ok(recovered.events.every(e=>e.verified===false&&e.source==='imported_packet'));
   assert.equal(recovered.order,null);
  });
 });
});

test('conflicting imported status claims are explicit without trusting their chronology',()=>{
 const order={...normalizeOrder(orderFixture()),imported:true};
 const snapshots=[{id:'NEWER',order_id:order.id,source:'imported_packet',status:'COMPLETED',observed_at:'2026-11-10T10:00:00Z'},{id:'OLDER',order_id:order.id,source:'imported_packet',status:'APPROVED',observed_at:'2026-11-09T10:00:00Z'}];
 const finding=reconcile(order,[],snapshots).notes.find(n=>n.title==='Imported observations report different order statuses');
 assert.ok(finding);assert.match(finding.detail,/last opened packet/);assert.match(finding.detail,/do not establish/);assert.deepEqual(finding.ids,['NEWER','OLDER']);
 assert.equal(reconcile(order,[],[snapshots[1]]).notes.some(n=>n.title==='Imported observations report different order statuses'),false);
});

// A duplicate paste must not destroy the only original delivery available for later verification.
test('manual duplicate preserves unverified original delivery and its retry path',async()=>{
 await run({},async({api})=>{
  const received=await api('/api/webhooks/ingest','POST',eventFixture(),sig);
  assert.equal(received.body.verified,false);
  const before=await api('/api/event/source?event_id=E-1');
  const duplicate=await api('/api/events/import','POST',{event:eventFixture()});
  assert.equal(duplicate.status,409);
  assert.match(duplicate.body.error,/Original delivery already retained/);
  assert.deepEqual((await api('/api/event/source?event_id=E-1')).body,before.body);
  const state=(await api('/api/state')).body;
  assert.equal(state.events.length,1);assert.equal(state.events[0].verified,false);
  assert.equal(state.events[0].transmission_id,'SYNTH-1');
  assert.notEqual(state.events[0].source,'manual');
  assert.doesNotMatch(JSON.stringify((await api('/api/packet?order_id=ORDER-12345678')).body),/SYNTHETIC|redact@example.com/);
 });
});
