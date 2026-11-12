import test from 'node:test';
import http from 'node:http';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
const headers={'paypal-transmission-id':'TRANSMISSION-ORIGINAL','paypal-transmission-time':'2026-11-10T04:00:00Z','paypal-cert-url':'https://api.sandbox.paypal.com/test-certificate','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'synthetic-signature'};
const event={id:'EVENT-SOURCE-1',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE-123',supplementary_data:{related_ids:{order_id:'ORDER-123456'}}}};
const json=(v)=>new Response(JSON.stringify(v),{status:200});
test('unsigned duplicate cannot destroy original recoverable signature source',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-source-'));
 const env={PORT:'0'};
 let posted;
 const fetchImpl=async(url,options)=>{if(url.endsWith('/token'))return json({access_token:'synthetic',expires_in:300});posted=JSON.parse(options.body);return json({verification_status:'SUCCESS'});};
 const {server,app,url}=await startServer({env,fetchImpl,dataFile:path.join(dir,'state.json')});
 const post=(route,value,h={})=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(value)});
 try{
  assert.equal((await post('/api/webhooks/ingest',event,headers)).status,202);
  const first=(await app.read()).events[0];
  assert.equal(first.verified,false);
  const duplicate={...event,resource:{...event.resource,id:'CAPTURE-OTHER'}};
  const response=await post('/api/webhooks/ingest',duplicate);
  assert.equal(response.status,202);
  assert.deepEqual((await app.read()).events[0],first);
  assert.equal((await app.read()).sources[event.id].headers.transmission_id,'TRANSMISSION-ORIGINAL');
  const visible=await (await fetch(url+'/api/state')).json();
  assert.equal(visible.events[0].source_available,true);
  assert.equal(visible.events[0].source_raw_available,true);
  assert.equal(visible.events[0].source_headers_complete,true);
  assert.equal(visible.sources,undefined);
  Object.assign(env,{PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'});
  const retry=await post('/api/event/reverify',{event_id:event.id});
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).verified,true);
  assert.equal(posted.webhook_event.resource.id,'CAPTURE-123');
  assert.equal(posted.transmission_id,'TRANSMISSION-ORIGINAL');
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('initial postback and retry after restart preserve exact webhook JSON lexemes privately',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-raw-')),dataFile=path.join(dir,'state.json');
 const env={PORT:'0',PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'};
 const raw='  {\n "id": "EVENT-RAW-1", "event_type":"PAYMENT.CAPTURE.COMPLETED", "number": 1.00e+2, "private":"raw-only@example.test", "resource": {"id":"CAPTURE-123", "supplementary_data":{"related_ids":{"order_id":"ORDER-123456"}}}\n}  ';
 const sent=[];
 const fetchImpl=async(url,options)=>{if(url.endsWith('/token'))return json({access_token:'synthetic',expires_in:300});sent.push(options.body);return json({verification_status:'SUCCESS'});};
 let instance=await startServer({env,fetchImpl,dataFile});
 const close=()=>new Promise(r=>instance.server.close(r));
 try{
  const r=await fetch(instance.url+'/api/webhooks/ingest',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:raw});
  assert.equal(r.status,202);assert.equal((await r.json()).verified,true);
  assert.ok(sent[0].endsWith('"webhook_event":'+raw+'}'));
  assert.equal((await instance.app.read()).sources['EVENT-RAW-1'].raw_event,raw);
  const original=await (await fetch(instance.url+'/api/event/source?event_id=EVENT-RAW-1')).json();
  assert.equal(original.raw_event,raw);
  assert.equal(original.private,true);
  for(const route of ['/api/state','/api/packet?order_id=ORDER-123456']){
   const text=await (await fetch(instance.url+route)).text();
   assert.doesNotMatch(text,/raw-only|raw_event|transmission_sig/);
  }
  await close();
  instance=await startServer({env,fetchImpl,dataFile});
  const retry=await fetch(instance.url+'/api/event/reverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:'EVENT-RAW-1'})});
  assert.equal(retry.status,200);
  assert.equal(sent[1],sent[0]);
 }finally{await close();await rm(dir,{recursive:true,force:true});}
});

test('real HTTP verifier receives unchanged raw bytes and can recover after provider outage',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-wire-'));
 const raw=JSON.stringify(event,null,3).replace('"EVENT-SOURCE-1"','"EVENT-WIRE-1"');
 const hash=s=>createHash('sha256').update(s).digest('hex');
 const received=[];let unavailable=true;
 const provider=http.createServer(async(req,res)=>{
  let wire='';for await(const c of req)wire+=c.toString();
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/oauth2/token'){res.end(JSON.stringify({access_token:'synthetic',expires_in:300}));return;}
  if(unavailable){res.writeHead(503);res.end('{}');return;}
  const marker='"webhook_event":',start=wire.indexOf(marker)+marker.length;
  const delivered=wire.slice(start,-1);received.push(hash(delivered));
  res.end(JSON.stringify({verification_status:hash(delivered)===hash(raw)?'SUCCESS':'FAILURE'}));
 });
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+provider.address().port;
 const env={PORT:'0',ALLOW_TEST_PAYPAL_BASE:'1',PAYPAL_BASE_URL:base,PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'};
 const instance=await startServer({env,dataFile:path.join(dir,'state.json')});
 const post=(route,value,h={})=>fetch(instance.url+route,{method:'POST',headers:{'Content-Type':'application/json',...h},body:value});
 try{
  const first=await post('/api/webhooks/ingest',raw,headers);
  assert.equal((await first.json()).verified,false);
  await post('/api/webhooks/ingest',raw);
  unavailable=false;
  const retry=await post('/api/event/reverify',JSON.stringify({event_id:'EVENT-WIRE-1'}));
  assert.equal(retry.status,200);assert.equal((await retry.json()).verified,true);
  assert.deepEqual(received,[hash(raw)]);
  // Negative control: identical parsed data with collapsed formatting is rejected.
  const negative=await fetch(base+'/v1/notifications/verify-webhook-signature',{method:'POST',body:JSON.stringify({webhook_event:JSON.parse(raw)})});
  assert.equal((await negative.json()).verification_status,'FAILURE');
 }finally{await new Promise(r=>instance.server.close(r));await new Promise(r=>provider.close(r));await rm(dir,{recursive:true,force:true});}
});

test('missing provider verdict is unavailable rather than a rejected signature',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-verdict-'));
 const env={PORT:'0',PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'};
 let verdict={};
 const fetchImpl=async url=>url.endsWith('/token')?json({access_token:'synthetic',expires_in:300}):json(verdict);
 const instance=await startServer({env,fetchImpl,dataFile:path.join(dir,'state.json')});
 try{
  const r=await fetch(instance.url+'/api/webhooks/ingest',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(event)});
  const received=await r.json();
  assert.equal(received.verified,false);
  assert.match(received.event.error,/Verification unavailable/);
  verdict={verification_status:'SUCCESS'};
  const retry=await fetch(instance.url+'/api/event/reverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:event.id})});
  assert.equal((await retry.json()).verified,true);
 }finally{await new Promise(r=>instance.server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('receipt is durably available while provider verification is still pending',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-pending-'));
 const env={PORT:'0',PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'};
 let release,entered;
 const waiting=new Promise(r=>entered=r),verdict=new Promise(r=>release=r);
 const instance=await startServer({env,dataFile:path.join(dir,'state.json'),fetchImpl:async url=>{
  if(url.endsWith('/token'))return json({access_token:'synthetic',expires_in:300});
  entered();await verdict;return json({verification_status:'SUCCESS'});
 }});
 let pending;
 try{
  pending=fetch(instance.url+'/api/webhooks/ingest',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(event,null,2)});
  await waiting;
  const source=await fetch(instance.url+'/api/event/source?event_id='+event.id);
  assert.equal(source.status,200);
  assert.equal((await source.json()).raw_event,JSON.stringify(event,null,2));
  const state=await (await fetch(instance.url+'/api/state')).json();
  assert.equal(state.events[0].verified,false);
  assert.match(state.events[0].error,/pending/i);
  const disk=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
  assert.equal(disk.sources[event.id].raw_event,JSON.stringify(event,null,2));
  release();
  assert.equal((await (await pending).json()).verified,true);
 }finally{release();await pending;await new Promise(r=>instance.server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('late initial verdict cannot overwrite a newer explicit retry verdict',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'settle-verdict-race-'));
 const env={PORT:'0',PAYPAL_CLIENT_ID:'synthetic',PAYPAL_CLIENT_SECRET:'synthetic',PAYPAL_WEBHOOK_ID:'WH-TEST'};
 let release,entered,calls=0;
 const waiting=new Promise(r=>entered=r),verdict=new Promise(r=>release=r);
 const instance=await startServer({env,dataFile:path.join(dir,'state.json'),fetchImpl:async url=>{
  if(url.endsWith('/token'))return json({access_token:'synthetic',expires_in:300});
  if(++calls===1){entered();await verdict;return json({verification_status:'FAILURE'});}
  return json({verification_status:'SUCCESS'});
 }});
 let pending;
 try{
  pending=fetch(instance.url+'/api/webhooks/ingest',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(event)});
  await waiting;
  const retry=await fetch(instance.url+'/api/event/reverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:event.id})});
  assert.equal((await retry.json()).verified,true);
  release();await pending;
  const stored=(await instance.app.read()).events[0];
  assert.equal(stored.verified,true);assert.equal(stored.error,null);assert.ok(stored.verification_checked);
 }finally{release();await pending;await new Promise(r=>instance.server.close(r));await rm(dir,{recursive:true,force:true});}
});
