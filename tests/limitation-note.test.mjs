import test from 'node:test';import assert from 'node:assert/strict';
import {parseLimitationNote} from '../web/limitation-note.mjs';
import {findingLimitationNote,limitationCaptureCopy} from '../web/finding-search.mjs';
const packet={order_id:'ORDER-READER-17',captures:[{id:'CAPTURE-READER-17'}]};
const make=(reason='refundable_balance_not_recorded',recovery={})=>({order_id:packet.order_id,source:'shared',text:findingLimitationNote(reason==='recipient_posting_not_recorded'?'Has the buyer received the refund?':'How much remains refundable?',{checks:[],reason},packet,recovery)});
test('known limitation preserves unanswered result and a retained reference, not an observation',()=>{
 const note=make(),value=parseLimitationNote(note,packet.order_id);
 assert.equal(value.question,'How much remains refundable?');assert.equal(value.result,'Question not answered.');
 assert.equal(value.nextCheck.captureId,'CAPTURE-READER-17');assert.match(value.nextCheck.text,/retained association only/);
 assert.equal(value.source_ids,undefined);assert.equal(value.observations,undefined);assert.equal(note.source,'shared');
});
test('buyer receipt has no invented next check and legacy balance notes remain readable',()=>{
 const buyer=parseLimitationNote(make('recipient_posting_not_recorded'),packet.order_id);assert.equal(buyer.nextCheck,null);assert.match(buyer.limitation,/does not establish when the buyer received/);
 const old=make();old.text=old.text.split('\n').filter(line=>!line.startsWith(limitationCaptureCopy.singlePrefix)).join('\n');assert.equal(parseLimitationNote(old,packet.order_id).nextCheck,null);
});
test('multiple or absent capture scope remains an explicit selection, never a selected ID',()=>{
 for(const captures of [[],[{id:'CAPTURE-A-123'},{id:'CAPTURE-B-456'}]]){
  const p={...packet,captures},note={order_id:p.order_id,text:findingLimitationNote('How much remains refundable?',{checks:[],reason:'refundable_balance_not_recorded'},p)};
  const value=parseLimitationNote(note,p.order_id);assert.equal(value.nextCheck.captureId,null);assert.match(value.nextCheck.text,/Records/);
 }
});
test('original question and refusal survive a saved limitation refinement',()=>{
 const note=make('recipient_posting_not_recorded',{originalQuestion:'What happened?',reason:'unsupported_record_detail'});
 const value=parseLimitationNote(note,packet.order_id);assert.equal(value.previous.question,'What happened?');assert.match(value.previous.result,/not established/);assert.equal(value.result,'Question not answered.');
});
test('another order, repeated fields, extra prose and source-like additions keep raw fallback',()=>{
 const note=make();
 assert.equal(parseLimitationNote(note,'ANOTHER-ORDER'),null);
 for(const text of [note.text+'\nOperator addition',note.text+'\nFinding source capture_read invented · saved observation',note.text.replace('Question: ','Question: Duplicate\nQuestion: '),note.text.replace('Search scope: retained records for '+packet.order_id,'Search scope: retained records for ANOTHER-ORDER'),note.text.replace('Result: Question not answered.','Result: Refund available.')]){
  assert.equal(parseLimitationNote({...note,text},packet.order_id),null);
 }
});
test('unrecognized capture guidance and conflicting next-check lines keep raw fallback',()=>{
 const note=make();assert.equal(parseLimitationNote({...note,text:note.text.replace('confirm its order','confirmed its order')},packet.order_id),null);
 assert.equal(parseLimitationNote({...note,text:note.text.replace('Search scope:',limitationCaptureCopy.multiple+'\nSearch scope:')},packet.order_id),null);
});
