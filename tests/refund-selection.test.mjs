import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCaptureRefunds} from '../web/refund-selection.mjs';
const r=(extra={})=>({refund_id:'R1',capture_id:'C1',order_id:'O1',source:'sandbox_refund_api',requested_at:'2026-11-10T12:00:00Z',observed_at:'2026-11-10T12:00:02Z',...extra});
test('refund selector retains later request when older response arrives last',()=>{
 const older=r({observed_at:'2026-11-10T12:00:05Z'}),newer=r({requested_at:'2026-11-10T12:00:01Z'});
 const result=selectCaptureRefunds([newer,older],'C1','O1');assert.equal(result[0].read,newer);assert.equal(result[0].history.length,2);
});
test('different captures/orders and future imported timestamps cannot replace exact local refund',()=>{
 const local=r(),rows=selectCaptureRefunds([local,r({source:'imported_packet',requested_at:null,reported_requested_at:'2099-01-01'}),r({capture_id:'C2'}),r({order_id:'O2'})],'C1','O1');assert.equal(rows.length,1);assert.equal(rows[0].read,local);assert.equal(rows[0].local,true);
});
test('shared only remains shared and separate refund IDs remain separate',()=>{
 const rows=selectCaptureRefunds([r({source:'imported_packet'}),r({refund_id:'R2',source:'imported_packet'})],'C1','O1');assert.equal(rows.length,2);assert.ok(rows.every(x=>!x.local));
});
