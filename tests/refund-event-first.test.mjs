import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent,captureEvidence,reconcile} from '../server.mjs';
for(const linked of [true,false])test('event-first refund retains guidance with '+(linked?'known':'unknown')+' capture association',()=>{
 const event=normalizeEvent({id:'EVENT-RETURN-FIRST',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'REFUND-SEPARATE',supplementary_data:{related_ids:{order_id:'ORDER-BEFORE-READ',...(linked?{capture_id:'CAPTURE-ORIGINAL'}:{})}}}});
 const result=reconcile(null,[event],[],event.order_id);
 assert.equal(result.notes[0].title,'No order observation');
 const note=result.notes.find(n=>n.title==='Refund evidence needs its own review');assert.ok(note);assert.match(note.detail,linked?/CAPTURE-ORIGINAL/:/association unavailable/);
 assert.ok(result.actions.some(x=>x.includes('do not issue another refund')));
 assert.equal(captureEvidence(null,[event],event.order_id).length,linked?1:0);
});

test('verified refund replaces earlier corroborated-completion headline',()=>{
 const order={id:'ORDER-HISTORY',units:[{captures:[{id:'CAPTURE-HISTORY',status:'COMPLETED'}]}]};
 const events=[{id:'COMPLETE-HISTORY',type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAPTURE-HISTORY',order_id:order.id,verified:true},{id:'REFUND-HISTORY',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-RESOURCE',capture_id:'CAPTURE-HISTORY',order_id:order.id,verified:true}];
 const assessment=captureEvidence(order,events)[0].assessment;
 assert.match(assessment,/Verified refund/);assert.doesNotMatch(assessment,/Completion corroborated/);
});


test('exact local refund read advances the next check without promoting shared claims',async()=>{
 const {exactPaymentFindings}=await import('../payment-findings.mjs');
 const order={id:'ORDER',status:'COMPLETED'};
 const read={id:'READ',refund_id:'REFUND',capture_id:'CAPTURE',order_id:'ORDER',source:'sandbox_refund_api',status:'COMPLETED',amount:{currency:'USD',value:'0.25'}};
 const rows=[{id:'CAPTURE',api_status:'PARTIALLY_REFUNDED'}];
 const action=(reads,events=[])=>exactPaymentFindings(order,events,rows,[],reads,'ORDER').actions[0];
 assert.match(action([read]),/^Re-read the order/);
 assert.doesNotMatch(action([read]),/Inspect the exact refund/);
 assert.match(action([{...read,source:'imported_packet'}]),/^Inspect the exact refund/);
 assert.match(action([{...read,sample:true}]),/^Inspect the exact refund/);
 assert.match(action([read],[{order_id:'ORDER',capture_id:'CAPTURE',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'OTHER-REFUND'}]),/^Inspect the exact refund/);
 assert.match(action([read],[{order_id:'ORDER',capture_id:'OTHER-CAPTURE',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND'}]),/^Inspect the exact refund/);
});
