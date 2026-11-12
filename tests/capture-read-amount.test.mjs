import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,captureEvidence,admitSharedPacket} from '../server.mjs';
import {presentCase} from '../web/case-presentation.mjs';
const id='ORDER-AMOUNT-613',capture='CAPTURE-AMOUNT-613';
const money=(value,currency='USD')=>({currency,value});
const order={id,status:'COMPLETED',read_id:'ORDER-READ-613',inspected:'2026-11-11T01:00:00Z',units:[{captures:[{id:capture,status:'COMPLETED',amount:money('100.00')}]}]};
const before={id:order.read_id,order_id:id,source:'sandbox_api',status:'COMPLETED',observed_at:order.inspected,captures:order.units[0].captures};
const read={id:'CAPTURE-READ-613',order_id:id,resource_kind:'capture',capture_id:capture,status:'COMPLETED',source:'sandbox_capture_api',observed_at:'2026-11-11T01:01:00Z',amount:money('120.00'),captures:[{id:capture,status:'COMPLETED',amount:money('120.00')}]};
const packet=(o=order,r=read,refunds=[])=>({order:o,order_id:id,events:[],snapshots:[before,r],captures:captureEvidence(o,[],id,[before,r]),diagnosis:reconcile(o,[],[before,r],id,[],refunds)});
test('same-capture gross disagreement keeps both sources and does not silently choose an amount',()=>{
 const p=packet(),finding=p.diagnosis.notes.find(n=>n.kind==='capture_amount');
 assert.ok(finding);assert.equal(finding.level,'investigate');
 assert.match(finding.detail,/USD 100.00/);assert.match(finding.detail,/USD 120.00/);
 assert.deepEqual(new Set(finding.ids),new Set([before.id,read.id]));
 assert.ok(p.captures[0].amount_conflict);
 const view=presentCase(p);assert.notEqual(view.amount,'120.00');assert.match(view.summary,/amounts differ/i);assert.notEqual(view.status.tone,'success');
});
test('cross-currency capture disagreement cannot be treated as equal numeric amounts',()=>{
 const p=packet(order,{...read,amount:money('100.00','EUR')});
 assert.ok(p.diagnosis.notes.some(n=>n.kind==='capture_amount'));assert.notEqual(presentCase(p).amount,'100.00');
});
test('equivalent decimals and missing amounts do not invent a contradiction',()=>{
 for(const amount of [money('0100.000'),null,{currency:'USD',value:'invalid'}]){
  const p=packet(order,{...read,amount});assert.equal(p.diagnosis.notes.some(n=>n.kind==='capture_amount'),false);
 }
});
test('shared order amount stays an unvalidated claim against a local capture read',()=>{
 const p=packet({...order,imported:true});
 const finding=p.diagnosis.notes.find(n=>n.kind==='capture_amount');
 assert.ok(finding);assert.equal(finding.level,'caution');assert.match(finding.detail,/shared|Shared/);assert.match(finding.detail,/not locally revalidated/);
 assert.equal(presentCase(p).amount,'120.00');
});
test('a shared capture read cannot overrule the local order amount',()=>{
 const p=packet(order,{...read,source:'imported_packet'});
 assert.equal(p.captures[0].amount_conflict,undefined);assert.equal(presentCase(p).amount,'100.00');
});
test('refund headline does not pick a disputed original capture amount',()=>{
 const refund={id:'REFUND-READ-613',order_id:id,capture_id:capture,refund_id:'REFUND-AMOUNT-613',source:'sandbox_refund_api',status:'COMPLETED',amount:money('30.00'),observed_at:'2026-11-11T01:02:00Z'};
 const p=packet(order,read,[refund]),finding=p.diagnosis.notes.find(n=>n.kind==='refund_evidence');
 assert.match(finding.answer,/capture amounts differ/i);assert.doesNotMatch(finding.answer,/Capture USD 120.00/);
});

test('file receiving preserves amount disagreement without promoting either shared claim',()=>{
 const shared=admitSharedPacket({order,order_id:id,events:[],snapshots:[before,read]});
 const p={...shared,captures:captureEvidence(shared.order,[],id,shared.snapshots),diagnosis:reconcile(shared.order,[],shared.snapshots,id)};
 const finding=p.diagnosis.notes.find(n=>n.kind==='capture_amount_claim');
 assert.ok(finding);assert.equal(finding.level,'caution');assert.match(finding.detail,/USD 100.00/);assert.match(finding.detail,/USD 120.00/);
 assert.match(finding.detail,/not locally revalidated/);assert.equal(finding.ids.length,2);
 const view=presentCase(p);assert.notEqual(view.amount,'120.00');assert.equal(view.sourceKind,'shared');assert.equal(view.status.tone,'neutral');
});
