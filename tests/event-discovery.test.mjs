import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../server.mjs';
test('recent provider references are bounded, private and do not mutate investigations',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'settle-event-discovery-'));const urls=[];let fail=false;
 const service=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},dataFile:path.join(dir,'state.json'),fetchImpl:async(url)=>{
  urls.push(url);if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'fixture-token',expires_in:3600});
  return fail?Response.json({}, {status:503}):Response.json({events:Array.from({length:25},(_,i)=>({id:'WH-DISCOVER-'+i,event_type:'PAYMENT.CAPTURE.PENDING',create_time:'2026-11-10T10:00:00Z',resource:{id:'CAPTURE-'+i,payer:{email_address:'private@example.invalid'}},summary:'Private person name'})),links:[{rel:'next',href:'https://untrusted.invalid/next'}]});
 }});
 try{
  const before=await service.app.read(),r=await fetch(service.url+'/api/events/recent'),j=await r.json();assert.equal(r.status,200);assert.equal(j.events.length,20);assert.equal(j.more_available,true);assert.equal(j.next_cursor,null);assert.doesNotMatch(JSON.stringify(j),/private|payer|summary|fixture-token|untrusted/);
  assert.equal(new Date(j.end_time)-new Date(j.start_time),86400000);const u=new URL(urls[1]);assert.equal(u.origin,'https://api-m.sandbox.paypal.com');assert.equal(u.searchParams.get('page_size'),'20');assert.equal(u.searchParams.get('start_time'),j.start_time);assert.match(j.start_time,/T\d{2}:\d{2}:\d{2}Z$/);assert.match(j.end_time,/T\d{2}:\d{2}:\d{2}Z$/);assert.deepEqual(await service.app.read(),before);
  assert.equal((await fetch(service.url+'/event-discovery.mjs')).status,200);
  fail=true;assert.equal((await fetch(service.url+'/api/events/recent')).status,502);assert.deepEqual(await service.app.read(),before);assert.equal(urls.length,3);
 }finally{await new Promise(r=>service.server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('provider continuation uses a server handle, preserves search window and permits failed-read retry',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'settle-event-pages-'));const urls=[];let fail=true;
 const next='https://api.sandbox.paypal.com/v1/notifications/webhooks-events?opaque=provider-second';
 const service=await startServer({env:{PORT:'0',PAYPAL_CLIENT_ID:'fixture',PAYPAL_CLIENT_SECRET:'fixture'},dataFile:path.join(dir,'state.json'),fetchImpl:async url=>{
  urls.push(url);if(url.endsWith('/v1/oauth2/token'))return Response.json({access_token:'fixture-token',expires_in:3600});
  if(url.endsWith('?opaque=provider-second'))return fail?Response.json({}, {status:503}):Response.json({events:[{id:'WH-SECOND-PAGE',event_type:'PAYMENT.CAPTURE.COMPLETED'}],links:[]});
  return Response.json({events:[{id:'WH-FIRST-PAGE',event_type:'PAYMENT.CAPTURE.PENDING'}],links:[{rel:'next',href:next,method:'GET'}]});
 }});
 try{
  const before=await service.app.read(),first=await fetch(service.url+'/api/events/recent').then(r=>r.json());assert.ok(first.next_cursor);assert.doesNotMatch(JSON.stringify(first),/opaque|https:/);
  const route=service.url+'/api/events/recent?cursor='+first.next_cursor;assert.equal((await fetch(route)).status,502);fail=false;
  const second=await fetch(route).then(r=>r.json());assert.equal(second.events[0].id,'WH-SECOND-PAGE');assert.equal(second.next_cursor,null);assert.equal(second.start_time,first.start_time);assert.equal(second.end_time,first.end_time);assert.equal(urls.at(-1),'https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events?opaque=provider-second');
  const count=urls.length;assert.equal((await fetch(service.url+'/api/events/recent?cursor=https://untrusted.invalid')).status,410);assert.equal(urls.length,count);assert.deepEqual(await service.app.read(),before);
 }finally{await new Promise(r=>service.server.close(r));await rm(dir,{recursive:true,force:true});}
});
