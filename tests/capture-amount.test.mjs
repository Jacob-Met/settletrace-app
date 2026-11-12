import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrder,normalizeEvent,reconcile,captureEvidence} from '../server.mjs';
const order=normalizeOrder({id:'ORDER-12345',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE-12345',status:'COMPLETED',amount:{currency_code:'USD',value:'500.00'}}]}}]});
const event=(value='501.00',currency='USD')=>normalizeEvent({id:'EVENT-12345',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE-12345',amount:{currency_code:currency,value},supplementary_data:{related_ids:{order_id:order.id}}}},true);
const conflicts=(o,e)=>reconcile(o,[e]).notes.filter(n=>n.title==='Same capture has conflicting amounts');
test('same capture amount contradiction is cited and never corroborated',()=>{
 const e=event();assert.equal(conflicts(order,e).length,1);
 assert.deepEqual(conflicts(order,e)[0].ids,[e.id]);
 assert.match(captureEvidence(order,[e])[0].assessment,/conflicting amounts/);
 assert.equal(conflicts(order,event('500.00','EUR')).length,1);
});
test('decimal equality is exact, missing evidence is unknown and provenance remains bounded',()=>{
 for(const value of ['500','0500.000'])assert.equal(conflicts(order,event(value)).length,0);
 for(const value of ['',null,'5e2','NaN'])assert.equal(conflicts(order,event(value)).length,0);
 for(const o of [{...order,sample:true},{...order,imported:true}])assert.equal(conflicts(o,event()).length,0);
 for(const change of [{verified:false},{sample:true},{resource_id:'OTHER-CAPTURE'},{source:'imported_packet'},{type:'PAYMENT.CAPTURE.REFUNDED'}])assert.equal(conflicts(order,{...event(),...change}).length,0);
});

test('direct provider reads support amount conflict without becoming verified deliveries',()=>{
 const provider={...event(),verified:false,source:'sandbox_event_api',provider_observed_at:'2026-11-10T20:00:00Z'};
 assert.equal(conflicts(order,provider).length,1);
 assert.equal(provider.verified,false);
 assert.equal(conflicts(order,{...provider,provider_observed_at:null}).length,0);
 assert.equal(conflicts(order,{...provider,source:'imported_packet'}).length,0);
 assert.equal(conflicts(order,{...provider,sample:true}).length,0);
});
