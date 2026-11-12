import test from 'node:test';
import assert from 'node:assert/strict';
import {presentCase} from '../web/case-presentation.mjs';

function packet({imported=false,sample=false}={}){
 return {order_id:'ORDER-7',order:{id:'ORDER-7',status:'COMPLETED',imported,sample,units:[{captures:[{id:'CAP-3',status:'PARTIALLY_REFUNDED',amount:{currency:'USD',value:'1.00'}}]}]},events:[],snapshots:[],refund_observations:[]};
}
test('first-screen shared capture status is explicitly reported and unverified',()=>{
 const view=presentCase(packet({imported:true}));
 assert.equal(view.sourceKind,'shared');
 assert.equal(view.sourceLabel,'Shared file · not verified');
 assert.equal(view.displayStatus,'Reported · Partially refunded');
 assert.equal(view.status.label,'Partially refunded');
});
test('local provider observation is not mislabeled as a shared report',()=>{
 const view=presentCase(packet());
 assert.equal(view.sourceKind,'provider');
 assert.equal(view.sourceLabel,null);
 assert.equal(view.displayStatus,'Partially refunded');
});
test('authored example retains its distinct example status',()=>{
 const view=presentCase(packet({sample:true}));
 assert.equal(view.sourceKind,'example');
 assert.equal(view.sourceLabel,null);
 assert.equal(view.displayStatus,'Partially refunded');
});
