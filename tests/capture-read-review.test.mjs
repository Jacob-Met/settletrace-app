import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCaptureReads} from '../capture-read-review.mjs';
const read=(extra={})=>({id:'R1',order_id:'O1',resource_kind:'capture',capture_id:'C1',status:'REFUNDED',source:'sandbox_capture_api',observed_at:'2026-11-10T12:00:00Z',...extra});
const row={id:'C1',api_status:'COMPLETED',api_source:'sandbox_api',assessment:'PayPal reports capture reversal',events:[]};
test('exact capture read supplements order and reversal assessment',()=>{
 const r=reviewCaptureReads([row,{...row,id:'C2'}],[read()],'O1');
 assert.equal(r.rows[0].api_status,'COMPLETED');assert.equal(r.rows[0].latest_capture_read.status,'REFUNDED');
 assert.match(r.rows[0].assessment,/capture reversal/);assert.equal(r.rows[1].latest_capture_read,null);
 assert.equal(r.notes[0].level,'investigate');assert.deepEqual(r.notes[0].ids,['R1']);assert.equal(row.capture_reads,undefined);
});
test('capture-only reads create rows without manufacturing order truth',()=>{
 const r=reviewCaptureReads([],[read()],'O1');assert.equal(r.rows[0].api_status,null);assert.equal(r.rows[0].latest_capture_read.id,'R1');
});
test('imported and foreign order evidence cannot become current capture authority',()=>{
 const r=reviewCaptureReads([],[read({source:'imported_packet',reported_source:'sandbox_capture_api'}),read({order_id:'O2',capture_id:'C2'})],'O1');
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].latest_capture_read,null);assert.equal(r.notes.length,0);
});
test('latest local timestamp wins over arrival, imported timestamps and unknown time',()=>{
 const r=reviewCaptureReads([row],[read({id:'new',observed_at:'2026-11-10T13:00:00Z'}),read(),read({id:'invalid',observed_at:null}),read({id:'claim',source:'imported_packet',observed_at:'2099-01-01T00:00:00Z'})],'O1');
 assert.equal(r.rows[0].latest_capture_read.id,'new');assert.equal(r.rows[0].capture_reads.length,4);
});
test('refund capture read stops presenting historical completion as current corroboration',()=>{
 for(const status of ['REFUNDED','PARTIALLY_REFUNDED'])for(const assessment of ['Completion corroborated for this capture','API completed; matching verified completion absent']){
 const r=reviewCaptureReads([{...row,assessment,events:[{type:'PAYMENT.CAPTURE.COMPLETED',verified:true}]}],[read({status})],'O1');
 assert.match(r.rows[0].assessment,/^Earlier completion is historical/);assert.equal(r.rows[0].api_status,'COMPLETED');assert.equal(r.rows[0].events.length,1);
 }
});
test('later completed capture read cannot erase earlier reversal history',()=>{
 const r=reviewCaptureReads([row],[read({status:'COMPLETED'})],'O1');
 assert.match(r.rows[0].assessment,/PayPal reports capture reversal/);assert.match(r.rows[0].assessment,/independent capture read reports COMPLETED/);
});
test('older request finishing last cannot replace the later requested read',()=>{
 const newer=read({id:'newer-request',requested_at:'2026-11-10T13:01:00Z',observed_at:'2026-11-10T13:01:01Z'});
 const older=read({id:'older-request',status:'COMPLETED',requested_at:'2026-11-10T13:00:00Z',observed_at:'2026-11-10T13:02:00Z'});
 const claim=read({id:'claim',source:'imported_packet',requested_at:'2099-01-01T00:00:00Z',observed_at:'2099-01-01T00:00:01Z'});
 const r=reviewCaptureReads([row],[newer,older,claim],'O1');
 assert.equal(r.rows[0].latest_capture_read.id,'newer-request');assert.equal(r.rows[0].latest_capture_read.observed_at,newer.observed_at);assert.equal(r.rows[0].capture_reads.length,3);
});
test('imported refund concern stays visible without becoming local authority',()=>{
 const r=reviewCaptureReads([{...row,assessment:'Shared packet claims COMPLETED; not locally revalidated'}],[read({source:'imported_packet'})],'O1');
 assert.match(r.rows[0].assessment,/imported capture reads claim REFUNDED/);assert.equal(r.rows[0].latest_capture_read,null);
});
