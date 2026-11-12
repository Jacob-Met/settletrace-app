import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRefund,admitSharedPacket} from '../server.mjs';
test('refund amount and provider cumulative total survive normalization distinctly',()=>{
 const read=normalizeRefund({id:'REFUND-123',status:'COMPLETED',amount:{currency_code:'USD',value:'0.25'},seller_payable_breakdown:{total_refunded_amount:{currency_code:'USD',value:'0.75'},net_amount:{currency_code:'USD',value:'0.20'}}},'REFUND-123','2026-11-10T12:00:00Z');
 assert.equal(read.amount.value,'0.25');assert.equal(read.total_refunded_amount.value,'0.75');assert.equal(read.requested_at,'2026-11-10T12:00:00.000Z');assert.equal(read.net_amount,undefined);
 const packet={order_id:'ORDER-123',order:null,events:[],snapshots:[],refund_observations:[{...read,order_id:'ORDER-123'}]};
 const imported=admitSharedPacket(packet).refund_observations[0];
 assert.equal(imported.total_refunded_amount.value,'0.75');assert.equal(imported.source,'imported_packet');assert.equal(imported.reported_requested_at,read.requested_at);assert.equal(imported.requested_at,undefined);
});
test('absent cumulative field is unknown, never inferred from this refund',()=>{
 const read=normalizeRefund({id:'REFUND-123',status:'COMPLETED',amount:{currency_code:'USD',value:'0.25'}},'REFUND-123');assert.equal(read.total_refunded_amount,null);
});
