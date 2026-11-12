import test from 'node:test';
import assert from 'node:assert/strict';
import {findingNoteSources} from '../web/investigation-notes.mjs';
const event=(id,received,extra={})=>({id,order_id:'ORDER-R',event_id:'EVENT-R',type:'PAYMENT.CAPTURE.REFUNDED',source:'imported_packet',reported_source:'webhook',occurred:'2026-11-10T10:13:00Z',received,...extra});
const note={order_id:'ORDER-R',source:'shared',text:'Saved finding: ORDER-R\nSource group: Refund REFUND-R\nFinding source webhook RECEIPT-A · shared observation\nFinding source webhook RECEIPT-B · shared observation'};
const refs=events=>findingNoteSources(note,{events},'ORDER-R');
test('same-event note sources distinguish the actual receipt clocks without changing identities',()=>{
 const r=refs([event('RECEIPT-A','2026-11-10T10:13:04Z'),event('RECEIPT-B','2026-11-10T10:16:08Z')]);
 assert.deepEqual(r.map(x=>x.id),['RECEIPT-A','RECEIPT-B']);
 assert.match(r[0].label,/Shared receipt.*10:13:04/);assert.match(r[1].label,/Shared receipt.*10:16:08/);
 assert.ok(r.every(x=>x.kind==='webhook'&&x.group==='Refund REFUND-R'));
});
test('missing or tied receipt clocks do not borrow occurrence time or invent an ordering',()=>{
 let r=refs([event('RECEIPT-A',null),event('RECEIPT-B','2026-11-10T10:16:08Z')]);
 assert.match(r[0].label,/Receipt time not recorded.*RECEIPT-A/);assert.doesNotMatch(r[0].label,/10:13:00/);
 r=refs([event('RECEIPT-A','2026-11-10T10:16:08Z'),event('RECEIPT-B','2026-11-10T10:16:08Z')]);
 assert.match(r[0].label,/10:16:08.*RECEIPT-A/);assert.match(r[1].label,/10:16:08.*RECEIPT-B/);
 r=refs([event('RECEIPT-A','2026-11-10T10:16:08.100Z'),event('RECEIPT-B','2026-11-10T10:16:08.200Z')]);assert.match(r[0].label,/10:16:08\.100/);assert.match(r[1].label,/10:16:08\.200/);
});
test('provider event reads and ambiguous source references never acquire receipt navigation',()=>{
 let r=refs([event('RECEIPT-A','2026-11-10T10:13:04Z'),event('RECEIPT-B','2026-11-10T10:16:08Z',{reported_source:'sandbox_event_api'})]);
 assert.ok(r.every(x=>x.label.startsWith('Shared event · ')));
 const first=event('RECEIPT-A','2026-11-10T10:13:04Z');r=refs([first,{...first},event('RECEIPT-B','2026-11-10T10:16:08Z')]);
 assert.equal(r[0].id,null);assert.match(r[0].reason,/Several retained observations/);
});
