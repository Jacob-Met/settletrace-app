import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,normalizeOrder,admitSharedPacket} from '../server.mjs';
const id='ORDER-EXACT-123',cap='CAPTURE-EXACT-123';
const money=value=>({currency:'USD',value});
const order=(status,captures=[])=>({id,status,units:[{amount:money('100.00'),captures}]});
const text=d=>d.notes.map(n=>n.title+' '+n.detail).join('\n');
test('approval without capture explains collection and unknown refund amount',()=>{
 const d=reconcile(order('APPROVED'));
 assert.match(text(d),/approval.*does not establish.*captur/i);
 assert.match(text(d),/refunded amount.*unknown.*not zero/i);
 assert.ok(!d.notes.some(n=>n.level==='clear'));
});
test('different capture amounts cannot borrow another capture completion',()=>{
 const o=order('COMPLETED',[{id:cap,status:'COMPLETED',amount:money('80.00')},{id:'CAPTURE-SECOND',status:'PENDING',amount:money('20.00')}]);
 const d=reconcile(o,[{id:'WH-EXACT-123',order_id:id,type:'PAYMENT.CAPTURE.COMPLETED',resource_id:cap,verified:true}]);
 const finding=d.notes.find(n=>n.kind==='capture_state');
 assert.ok(finding);assert.match(finding.detail,/CAPTURE-SECOND.*USD 20.00.*PENDING/);
 assert.match(finding.detail,/another capture.*does not/i);
});
test('shared partial refund includes exact amounts, later claim and source limits',()=>{
 const o=order('COMPLETED',[{id:cap,status:'COMPLETED',amount:money('100.00')}]);
 const shared=admitSharedPacket({order:o,events:[{id:'WH-REFUND-123',type:'PAYMENT.CAPTURE.REFUNDED',order_id:id,resource_id:'REFUND-EXACT-123',capture_id:cap,refund_amount:money('30.00'),refund_status:'COMPLETED',verified:true}],snapshots:[{id:'CAPTURE-READ',order_id:id,resource_kind:'capture',capture_id:cap,status:'PARTIALLY_REFUNDED',amount:money('100.00'),observed_at:'2026-11-10T23:00:00Z',captures:[{id:cap,status:'PARTIALLY_REFUNDED',amount:money('100.00')}]}]});
 const d=reconcile(shared.order,shared.events,shared.snapshots);
 const f=d.notes.find(n=>n.title==='Refund evidence needs its own review');
 assert.match(f.detail,/REFUND-EXACT-123.*USD 30.00/);assert.match(f.detail,/CAPTURE-EXACT-123.*USD 100.00/);
 assert.match(f.detail,/PARTIALLY_REFUNDED/);assert.match(f.detail,/shared|Shared/);assert.match(f.detail,/not locally revalidated/);
 assert.doesNotMatch(f.detail,/remaining.*70|refunded.*100.00/);
});
test('refund API records participate without needing a webhook',()=>{
 const o=order('COMPLETED',[{id:cap,status:'COMPLETED',amount:money('100.00')}]);
 const read={id:'READ-REFUND-123',order_id:id,capture_id:cap,refund_id:'REFUND-EXACT-123',source:'sandbox_refund_api',status:'COMPLETED',amount:money('30.00'),observed_at:'2026-11-11T00:00:00Z'};
 const f=reconcile(o,[],[],id,[],[read]).notes.find(n=>n.title==='Refund evidence needs its own review');
 assert.ok(f);assert.match(f.detail,/USD 30.00/);assert.match(f.detail,/PayPal refund read/);assert.deepEqual(f.ids,[read.id]);
});
test('missing and cross-currency amounts never become a computed balance',()=>{
 const o=order('COMPLETED',[{id:cap,status:'COMPLETED',amount:money('100.00')}]);
 const event={id:'REF-EVENT',order_id:id,type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REF-ID',capture_id:cap,verified:false};
 const missing=reconcile(o,[event]).notes.find(n=>n.title==='Refund evidence needs its own review');
 assert.match(missing.detail,/amount not supplied/);assert.match(missing.detail,/unverified/i);
 const d=reconcile(o,[{...event,refund_amount:{currency:'EUR',value:'30.00'}}]);
 assert.match(text(d),/EUR 30.00/);assert.doesNotMatch(text(d),/USD 70|remaining.*70/);
});
test('independent completed capture prevents a stale pending order claim becoming pending conclusion',()=>{
 const o=order('COMPLETED',[{id:cap,status:'PENDING',amount:money('100.00')}]);
 const read={id:'CAP-READ',order_id:id,resource_kind:'capture',capture_id:cap,status:'COMPLETED',amount:money('100.00'),source:'sandbox_capture_api',observed_at:'2026-11-11T00:00:00Z',captures:[{id:cap,status:'COMPLETED',amount:money('100.00')}]};
 assert.equal(reconcile(o,[],[read]).notes.some(n=>n.kind==='capture_state'),false);
});
