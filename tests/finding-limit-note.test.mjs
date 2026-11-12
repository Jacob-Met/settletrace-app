import test from 'node:test';import assert from 'node:assert/strict';
import {findingQuestionNote,findingLimitationNote,findingRefusalText} from '../web/finding-search.mjs';
import {handoffExplanation} from '../web/incident-summary.mjs';
const packet={order_id:'ORDER-LIMIT-17'};
for(const [reason,question]of[['recipient_posting_not_recorded','Has the buyer received the refund?'],['refundable_balance_not_recorded','How much remains refundable?']]){
 test('retains the explicit limitation through Share: '+reason,()=>{
  const text=findingLimitationNote(question,{checks:[],reason},packet);
  assert.ok(text.startsWith('Saved limitation: ORDER-LIMIT-17\nQuestion: '+question+'\nResult: Question not answered.\n'));
  assert.ok(text.includes('Limitation: '+findingRefusalText[reason]));
  assert.ok(text.includes('Search scope: retained records for ORDER-LIMIT-17'));
  assert.ok(text.includes('not a fresh provider check'));
  assert.doesNotMatch(text,/Finding source|Saved finding:/);
  const explanation=handoffExplanation({...packet,operator_notes:[{text,source:'shared'}]});
  assert.equal(explanation.question,question);assert.equal(explanation.result,'Question not answered.');
  assert.equal(explanation.shared,true);assert.ok(explanation.detail.includes(findingRefusalText[reason]));
  assert.ok(explanation.detail.includes('Search scope: retained records for ORDER-LIMIT-17'));
  assert.equal(handoffExplanation({order_id:'ANOTHER-ORDER',operator_notes:[{text}]}).detail,undefined);
 });
}
test('limitation note preserves the original and refined questions',()=>{
 const text=findingLimitationNote('Has the buyer received the refund?',{checks:[],reason:'recipient_posting_not_recorded'},packet,{originalQuestion:'What happened?',reason:'unsupported_record_detail'});
 const explanation=handoffExplanation({...packet,operator_notes:[{text}]});
 assert.equal(explanation.question,'What happened?');assert.equal(explanation.followup,'Has the buyer received the refund?');
 assert.equal(explanation.result,findingRefusalText.unsupported_record_detail);
 assert.ok(explanation.detail.includes(findingRefusalText.recipient_posting_not_recorded));
});
test('unknown refusal, no investigation, and oversized question stay unsaveable',()=>{
 for(const [result,p]of[[{checks:[],reason:'invented_reason'},packet],[{checks:[],reason:'recipient_posting_not_recorded'},{}],[{checks:[],reason:'question_too_long'},packet]]){
 assert.throws(()=>findingLimitationNote('Question',result,p),/known limitation/);
 }
});
test('no-match result remains a scoped search result',()=>{
 const text=findingQuestionNote('Failed refund',{checks:[],reason:'no_matching_resource_facts',conditions:['Status: FAILED']},packet);
 assert.ok(text.includes('Result: No matching retained records.'));
 assert.doesNotMatch(text,/Saved limitation:/);assert.ok(text.includes('does not establish that a payment action never happened'));
});

const balance={checks:[],reason:'refundable_balance_not_recorded'};
const balanceNote=(question,p)=>findingLimitationNote(question,balance,p);
const scopedPacket=(captures=['CAPTURE-A-123'])=>({order_id:'ORDER-SCOPE-123',order:{id:'ORDER-SCOPE-123',imported:true},captures:captures.map(id=>({id})),snapshots:[],refund_observations:[]});
test('balance limitation carries one retained capture reference without answering the balance',()=>{
 const p=scopedPacket(),text=balanceNote('How much remains refundable?',p);
 assert.match(text,/Capture reference to check: CAPTURE-A-123/);
 assert.match(text,/retained association only; confirm its order and refund history in PayPal/);
 assert.match(text,/Result: Question not answered/);assert.doesNotMatch(text,/Finding source/);
 const shared=handoffExplanation({...p,operator_notes:[{text,source:'shared'}]});
 assert.equal(shared.shared,true);assert.match(shared.detail,/CAPTURE-A-123/);
});
test('multiple captures require selection unless the question names an exact retained capture',()=>{
 const p=scopedPacket(['CAPTURE-A-123','CAPTURE-B-456']);
 assert.match(balanceNote('How much remains refundable?',p),/Capture selection needed/);
 const exact=balanceNote('How much remains refundable for capture-b-456?',p);
 assert.match(exact,/Capture reference to check: CAPTURE-B-456/);assert.doesNotMatch(exact,/Capture reference to check: CAPTURE-A-123/);
 assert.match(balanceNote('How much remains refundable for ORDER-SCOPE-123?',p),/Capture selection needed/);
});
test('unknown and contradictory references cannot silently select another capture',()=>{
 const p=scopedPacket(['CAPTURE-A-123','CAPTURE-B-456']);
 p.refund_observations=[{id:'READ-REFUND-123',order_id:p.order_id,refund_id:'REFUND-A-123',capture_id:'CAPTURE-A-123',source:'imported_packet',status:'COMPLETED'}];
 assert.match(balanceNote('How much remains refundable for CAPTURE-MISSING-999?',p),/Capture reference not established/);
 assert.match(balanceNote('How much remains refundable for CAPTURE-B-456 and REFUND-A-123?',p),/Capture reference not established/);
 assert.match(balanceNote('How much remains refundable for REFUND-A-123?',p),/Capture reference to check: CAPTURE-A-123/);
});
test('conflicting refund associations remain ambiguous and unrelated orders supply no reference',()=>{
 const p=scopedPacket([]);
 p.refund_observations=['CAPTURE-A-123','CAPTURE-B-456'].map((capture_id,i)=>({id:'READ-REFUND-'+i,order_id:p.order_id,refund_id:'REFUND-A-123',capture_id,source:'imported_packet',status:'COMPLETED'}));
 assert.match(balanceNote('How much remains refundable for REFUND-A-123?',p),/Capture selection needed/);
 p.refund_observations.forEach(r=>r.order_id='OTHER-ORDER-999');
 assert.match(balanceNote('How much remains refundable?',p),/Capture reference not established/);
});
test('capture reference context does not claim a buyer-receipt answer',()=>{
 const text=findingLimitationNote('Has the buyer received the refund?',{checks:[],reason:'recipient_posting_not_recorded'},scopedPacket());
 assert.doesNotMatch(text,/Capture reference|Capture selection/);assert.match(text,/does not establish when the buyer received/);
});
