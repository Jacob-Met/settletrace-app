import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingEvidence,matchingReferences} from '../web/evidence-filter.mjs';
const records=[{id:'E1',kind:'webhook',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-77',capture_id:'CAPTURE-88',verified:false},{id:'E2',kind:'webhook',resource_id:'CAPTURE-22',verified:true},{id:'R1',kind:'order_read',captures:[{id:'CAPTURE-88',status:'PARTIALLY_REFUNDED'}]}];
test('ticket reference narrows exact records across refund linkage and API capture observations',()=>{assert.deepEqual(matchingEvidence(records,'CAPTURE-88').map(x=>x.id),['E1','R1']);assert.deepEqual(matchingEvidence(records,'REFUND-77 CAPTURE-88').map(x=>x.id),['E1']);assert.equal(matchingEvidence(records,'REFUND-77 CAPTURE-22').length,0);});
test('kind and trust filtering never confuses read snapshots with verified webhooks',()=>{assert.deepEqual(matchingEvidence(records,'','unverified').map(x=>x.id),['E1']);assert.deepEqual(matchingEvidence(records,'','reads').map(x=>x.id),['R1']);assert.deepEqual(matchingEvidence(records,'','webhooks').map(x=>x.id),['E1','E2']);assert.equal(records.length,3);});

test('PayPal event reads are searchable by provider ID and distinct from unverified delivery claims',()=>{
 const api={id:'EVENTREAD-local',event_id:'WH-EXACT-55',kind:'webhook',source:'sandbox_event_api',provider_observed_at:'2026-11-10T12:34:56Z',verified:false,received:null};
 const imported={...api,id:'IMPORTED-event',source:'imported_packet',reported_source:'sandbox_event_api',provider_observed_at:undefined};
 const all=[...records,api,imported],ids=(q,kind)=>matchingEvidence(all,q,kind).map(e=>e.id);
 assert.deepEqual(ids('WH-EXACT-55','all'),['EVENTREAD-local','IMPORTED-event']);
 assert.deepEqual(ids('12:34:56','all'),['EVENTREAD-local']);
 assert.deepEqual(ids('','api_events'),['EVENTREAD-local']);
 assert.deepEqual(ids('','webhooks'),['E1','E2']);
 assert.deepEqual(ids('','unverified'),['E1','IMPORTED-event']);
 assert.deepEqual(ids('WH-EXACT-55','unverified'),['IMPORTED-event']);
 assert.equal(all.length,5);
});

test('capture reads keep local and imported snapshots separate from order reads and webhook events',()=>{
 const local={id:'CAPREAD-1',kind:'capture_read',resource_kind:'capture',capture_id:'CAPTURE-88',status:'PARTIALLY_REFUNDED',source:'sandbox_capture_api',observed_at:'2026-11-10T20:00:00Z'};
 const shared={...local,id:'CAPREAD-SHARED',source:'imported_packet',reported_source:'sandbox_capture_api'};
 const all=[...records,local,shared],ids=kind=>matchingEvidence(all,'',kind).map(e=>e.id);
 assert.deepEqual(ids('capture_reads'),['CAPREAD-1','CAPREAD-SHARED']);
 assert.deepEqual(ids('reads'),['R1']);
 assert.deepEqual(ids('webhooks'),['E1','E2']);
 assert.deepEqual(ids('unverified'),['E1']);
 assert.deepEqual(matchingEvidence(all,'CAPTURE-88','capture_reads').map(e=>e.id),['CAPREAD-1','CAPREAD-SHARED']);
 assert.equal(all.length,5);
});

test('refund IDs find exact local and shared reads without turning them into webhook events',()=>{
 const refund={id:'REFREAD-local',kind:'refund_read',refund_id:'REFUND-77',capture_id:'CAPTURE-88',order_id:'ORDER-99',source:'sandbox_refund_api',status:'COMPLETED',requested_at:'2026-11-11T09:00:00Z'};
 const shared={...refund,id:'REFREAD-shared',source:'imported_packet',reported_source:'sandbox_refund_api'};
 const all=[...records,refund,shared],before=JSON.stringify(all);
 assert.deepEqual(matchingEvidence(all,'REFUND-77 CAPTURE-88','refund_reads').map(r=>r.id),['REFREAD-local','REFREAD-shared']);
 assert.deepEqual(matchingEvidence(all,'REFUND-77','webhooks').map(r=>r.id),['E1']);
 assert.deepEqual(matchingEvidence(all,'','unverified').map(r=>r.id),['E1']);
 assert.deepEqual(matchingEvidence(all,'ORDER-99','all').map(r=>r.id),['REFREAD-local','REFREAD-shared']);
 assert.deepEqual(matchingReferences(refund,'REFUND-77'),[['Refund','REFUND-77']]);
 assert.equal(JSON.stringify(all),before);
});
