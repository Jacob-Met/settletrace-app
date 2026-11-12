import test from 'node:test';
import assert from 'node:assert/strict';
import {findingQuestionNote} from '../web/finding-search.mjs';
import {handoffExplanation} from '../web/incident-summary.mjs';
import {findingFollowupResultText} from '../web/finding-catalog.mjs';
const packet={order_id:'ORDER-CONTEXT',events:[{id:'EVENT-1',order_id:'ORDER-CONTEXT',source:'webhook'}]};
const result={checks:[{title:'Refund REFUND-1',resource_type:'refund',source_ids:['EVENT-1'],note:{answer:'Matching retained observations'}}],conditions:['Retained refund observations']};
const recovery={originalQuestion:'Which refund also failed?',reason:'delivery_interval_unavailable'};
const make=recordsOnly=>findingQuestionNote('Which refund has duplicate deliveries?',result,packet,{...recovery,...(recordsOnly===undefined?{}:{recordsOnly})});
const lead=text=>handoffExplanation({...packet,operator_notes:[{source:'shared',text}]});
test('saved follow-up preserves the sender choice without deriving it from the original refusal',()=>{
 for(const [flag,kind] of [[true,'records'],[false,'answer']]){
  const text=make(flag),view=lead(text);
  assert.ok(text.includes('Follow-up result: '+findingFollowupResultText[kind]));
  assert.equal(view.followupKind,kind);assert.equal(view.question,recovery.originalQuestion);
  assert.equal(view.followup,'Which refund has duplicate deliveries?');
  assert.ok(view.result.startsWith('This search cannot apply that delivery interval'));
 }
});
test('legacy follow-up is not guessed into a supported answer',()=>{
 assert.equal(lead(make()).followupKind,null);
});
test('edited follow-up classification stays original detail rather than acquiring an answer label',()=>{
 const edited=make(true).replace(findingFollowupResultText.records,'Edited operator wording.');
 const view=lead(edited);assert.equal(view.followupKind,null);assert.ok(view.detail.includes('Edited operator wording.'));
});
test('conflicting classifications do not select an answer',()=>{
 const text=make(true)+'\nFollow-up result: '+findingFollowupResultText.answer;
 const view=lead(text);assert.equal(view.followupKind,null);
 assert.ok(view.detail.includes(findingFollowupResultText.records));assert.ok(view.detail.includes(findingFollowupResultText.answer));
});
