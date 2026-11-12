import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPayPalTransport} from '../paypal-transport.mjs';
const env={PAYPAL_CLIENT_ID:'test',PAYPAL_CLIENT_SECRET:'test'};
const response=(status,data)=>({status,ok:status<300,json:async()=>data});
test('concurrent reads share authentication and recover rejected bearer once',async()=>{
 let auth=0,reads=0;
 const paypal=createPayPalTransport({env,base:'http://fixture',fetchImpl:async(url,o)=>{
  if(url.endsWith('/token')){auth++;await new Promise(r=>setTimeout(r,5));return response(200,{access_token:'token'+auth,expires_in:300});}
  reads++;return o.headers.Authorization==='Bearer token1'?response(401):response(200,{id:'ok'});
 }});
 assert.deepEqual(await Promise.all([paypal('/order'),paypal('/event')]),[{id:'ok'},{id:'ok'}]);assert.equal(auth,2);assert.equal(reads,4);
});
test('persistent rejection is bounded and next explicit request can recover',async()=>{
 let auth=0,fail=true;
 const paypal=createPayPalTransport({env,base:'http://fixture',fetchImpl:async(url)=>url.endsWith('/token')?response(200,{access_token:'token'+(++auth)}):fail?response(401):response(200,{ok:true})});
 await assert.rejects(paypal('/order'),/Authentication was rejected/);assert.equal(auth,2);fail=false;assert.deepEqual(await paypal('/order'),{ok:true});assert.equal(auth,3);
});
test('deadline covers response body and releases caller for retry',async()=>{
 let fail=true;
 const paypal=createPayPalTransport({env,base:'http://fixture',timeoutMs:15,fetchImpl:async(url,{signal})=>{
  if(fail)return {status:200,ok:true,json:()=>new Promise((resolve,reject)=>{const hold=setTimeout(resolve,200);signal.addEventListener('abort',()=>{clearTimeout(hold);reject(Error('secret'));});})};
  return response(200,url.endsWith('/token')?{access_token:'token'}:{ok:true});
 }});
 await assert.rejects(paypal('/order'),e=>e.status===504&&!e.message.includes('secret'));fail=false;assert.deepEqual(await paypal('/order'),{ok:true});
});
test('resource failure is useful and excludes provider payload',async()=>{
 const paypal=createPayPalTransport({env,base:'http://fixture',fetchImpl:async(url)=>url.endsWith('/token')?response(200,{access_token:'token'}):response(404,{secret:'private'})});
 await assert.rejects(paypal('/order'),/Resource not found/);
});
test('signature verification retains exact serialized webhook bytes through token retry',async()=>{
 const payload='{"webhook_event": { "amount":1.00, "label":"\\u0041" }}';let auth=0;const sent=[];
 const paypal=createPayPalTransport({env,base:'http://fixture',fetchImpl:async(url,opts)=>{
  if(url.endsWith('/token'))return response(200,{access_token:'token'+(++auth)});
  sent.push(opts.body);return sent.length===1?response(401):response(200,{verification_status:'SUCCESS'});
 }});
 assert.deepEqual(await paypal('/v1/notifications/verify-webhook-signature','POST',payload),{verification_status:'SUCCESS'});
 assert.deepEqual(sent,[payload,payload]);assert.equal(auth,2);
});
