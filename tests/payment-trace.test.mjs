import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentTraceModel,comparedCaptureFacts} from '../web/payment-trace.mjs';

test('trace preserves source authority, every observation and exact conflict identities',()=>{
 const packet={order_id:'ORDER-TRACE',events:[{id:'EVENT-TRACE',order_id:'ORDER-TRACE',type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAPTURE-TRACE',occurred:'2026-11-10T12:00:00Z',source:'imported_packet',reported_verified:true,verified:false}],
 snapshots:[
  {id:'READ-ONE',order_id:'ORDER-TRACE',source:'sandbox_api',status:'COMPLETED',observed_at:'2026-11-10T12:01:01Z',requested_at:'2026-11-10T12:01:00Z',captures:[{id:'CAPTURE-TRACE',status:'COMPLETED',amount:{currency:'USD',value:'8.00'}}]},
  {id:'READ-TWO',order_id:'ORDER-TRACE',source:'sandbox_capture_api',resource_kind:'capture',capture_id:'CAPTURE-TRACE',status:'COMPLETED',observed_at:'2026-11-10T12:01:04Z',requested_at:'2026-11-10T12:01:02Z',amount:{currency:'USD',value:'9.00'}}
 ],diagnosis:{notes:[{kind:'capture_amount',level:'investigate',title:'Capture amounts differ',ids:['READ-ONE','READ-TWO']}]}};
 const model=paymentTraceModel(packet);
 assert.equal(model.rows.length,3);
 assert.equal(model.rows.find(r=>r.id==='EVENT-TRACE').origin.tone,'unverified');
 assert.equal(model.rows.find(r=>r.id==='EVENT-TRACE').conflict,null);
 assert.deepEqual(model.rows.filter(r=>r.conflict).map(r=>r.id),['READ-ONE','READ-TWO']);
 assert.deepEqual(model.rows.filter(r=>r.origin.tone==='provider').map(r=>r.duration),[1000,2000]);
 assert.equal(model.rows[1].raw,packet.snapshots[0]);
});

test('unknown and invalid clocks do not become invented spans',()=>{
 const model=paymentTraceModel({snapshots:[
  {id:'UNKNOWN-TIME',source:'sandbox_api',status:'CREATED',captures:[]},
  {id:'REVERSE-TIME',source:'sandbox_api',status:'COMPLETED',captures:[],requested_at:'2026-11-10T12:02:00Z',observed_at:'2026-11-10T12:01:00Z'},
  {id:'BAD-TIME',source:'imported_packet',status:'COMPLETED',captures:[],observed_at:'not a date'}
 ]});
 assert.equal(model.rows.find(r=>r.id==='UNKNOWN-TIME').at,null);
 assert.equal(model.rows.find(r=>r.id==='BAD-TIME').at,null);
 assert.equal(model.rows.find(r=>r.id==='REVERSE-TIME').duration,null);
 assert.equal(model.min,Date.parse('2026-11-10T12:01:00Z'));
 assert.equal(model.max,model.min);
 assert.equal(paymentTraceModel().min,null);
});

test('same-value refunds and repeated reads retain separate identities without summing money',()=>{
 const base={source:'sandbox_refund_api',order_id:'ORDER-TRACE',capture_id:'CAPTURE-TRACE',status:'COMPLETED',amount:{currency:'USD',value:'1.00'},observed_at:'2026-11-10T12:00:00Z'};
 const model=paymentTraceModel({refund_observations:[
  {...base,id:'OBS-A',refund_id:'REFUND-A'},
  {...base,id:'OBS-B',refund_id:'REFUND-B'},
  {...base,id:'OBS-A2',refund_id:'REFUND-A',observed_at:'2026-11-10T12:01:00Z',source:'imported_packet',reported_source:'sandbox_refund_api'}
 ]});
 assert.equal(model.rows.length,3);
 assert.equal(new Set(model.rows.map(r=>r.key)).size,3);
 assert.ok(model.rows.every(r=>r.detail.includes('USD 1.00')));
 assert.equal(model.rows.find(r=>r.id==='OBS-A2').origin.tone,'unverified');
 assert.equal(model.rows.find(r=>r.id==='OBS-A2').timeLabel,'Reported read');
});

test('comparison facts bind only the same capture across multi-capture observations',()=>{
 const first={id:'CAPTURE-A',status:'COMPLETED',amount:{currency:'USD',value:'8.00'}};
 const unrelated={id:'CAPTURE-B',status:'COMPLETED',amount:{currency:'USD',value:'9.00'}};
 const second={id:'CAPTURE-A',status:'COMPLETED',amount:{currency:'USD',value:'9.00'}};
 const selected={raw:{captures:[first,unrelated]}},other={raw:{captures:[second]}};
 const facts=comparedCaptureFacts(selected,other);
 assert.deepEqual(facts,[{id:'CAPTURE-A',selected:first,compared:second}]);
 assert.equal(facts[0].selected,first);assert.equal(facts[0].compared,second);
 assert.deepEqual(comparedCaptureFacts({raw:{captures:[unrelated]}},other),[]);
 assert.deepEqual(comparedCaptureFacts({raw:{}},other),[]);
});

test('trace identifies retained receipts of one event without counting provider reads or equal refund amounts',()=>{
 const base={order_id:'ORDER-TRACE',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-A',capture_id:'CAPTURE-A',event_id:'PROVIDER-EVENT-A',source:'imported_packet',reported_source:'webhook',refund_status:'COMPLETED',refund_amount:{currency:'USD',value:'12.50'},occurred:'2026-11-10T12:00:00Z'};
 const packet={order_id:'ORDER-TRACE',events:[
  {...base,id:'RECEIPT-A',received:'2026-11-10T12:00:04Z'},
  {...base,id:'RECEIPT-B',received:'2026-11-10T12:03:08Z'},
  {...base,id:'API-READ',reported_source:'sandbox_event_api',reported_provider_observed_at:'2026-11-10T12:04:00Z'},
  {...base,id:'OTHER-EVENT',event_id:'PROVIDER-EVENT-B',received:'2026-11-10T12:05:00Z'},
  {...base,id:'MANUAL-CLAIM',reported_source:'manual',received:'2026-11-10T12:06:00Z'}
 ]};
 const model=paymentTraceModel(packet);
 assert.equal(model.rows.length,5);
 assert.deepEqual(model.rows.filter(row=>row.deliveryGroup).map(row=>row.id).sort(),['RECEIPT-A','RECEIPT-B']);
 for(const row of model.rows.filter(row=>row.deliveryGroup)){
  assert.equal(row.deliveryGroup.event_id,'PROVIDER-EVENT-A');assert.equal(row.deliveryGroup.count,2);
  assert.equal(row.deliveryGroup.elapsed_ms,184000);assert.equal(row.origin.tone,'unverified');
  assert.ok(row.detail.includes('12.50'));assert.ok(!row.detail.includes('25.00'));
 }
 assert.equal(model.rows.find(row=>row.id==='API-READ').deliveryGroup,null);
});
