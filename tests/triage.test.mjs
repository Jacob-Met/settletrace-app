import test from 'node:test';import assert from 'node:assert/strict';
import {supportedChecks,applyTriageOrder} from '../triage.mjs';
const checks=supportedChecks({notes:[{title:'No order observation',detail:'Payment state unknown.',ids:[]},{title:'Unverified event',detail:'Imported evidence cannot establish settlement.',ids:['EVENT-1']}],actions:['Fetch the authoritative order read.']});
test('model may reorder canonical checks but cannot change their words or source IDs',()=>{
 const ranked=applyTriageOrder('{"order":["A1","F2","F1"],"invented":"paid"}',checks);
 assert.deepEqual(ranked.map(c=>c.id),['A1','F2','F1']);assert.equal(ranked[1].text,checks[1].text);assert.deepEqual(ranked[1].source_ids,['EVENT-1']);assert.doesNotMatch(JSON.stringify(ranked),/paid/);
});
test('model cannot omit, duplicate, or invent a supported check',()=>{
 for(const order of [['F1'],['F1','F1','A1'],['F1','F2','Z9']])assert.throws(()=>applyTriageOrder(JSON.stringify({order}),checks),/every supported/);
 assert.throws(()=>applyTriageOrder('Payment is complete',checks),/JSON/);
});
