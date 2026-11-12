import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonNoteSources} from '../web/investigation-notes.mjs';
const note={order_id:'ORDER-1',source:'operator',text:'Saved order-read comparison: ORDER-1\nEarlier read READ-1 · time\nLater read READ-2 · time'};
test('saved comparison links only resolve exact retained order reads',()=>{
 const reads=[{id:'READ-1',order_id:'ORDER-1'},{id:'READ-2',order_id:'OTHER'},{id:'READ-2',order_id:'ORDER-1',resource_kind:'capture'}];
 const refs=comparisonNoteSources(note,reads,'ORDER-1');assert.equal(refs[0].id,'READ-1');assert.equal(refs[1].id,null);
 assert.deepEqual(comparisonNoteSources(note,reads,'OTHER'),[]);
 assert.deepEqual(comparisonNoteSources({...note,text:'Earlier read READ-1 · time'},reads,'ORDER-1'),[]);
});
test('shared notes resolve unique shared aliases without upgrading to local evidence',()=>{
 const shared={...note,source:'shared'};
 const reads=[{id:'READ-1',order_id:'ORDER-1',source:'sandbox_api'},{id:'IMPORT-1',order_id:'ORDER-1',source:'imported_packet',reported_read_id:'READ-1'}];
 assert.equal(comparisonNoteSources(shared,reads,'ORDER-1')[0].id,'IMPORT-1');
 reads.push({...reads[1],id:'IMPORT-2'});
 assert.equal(comparisonNoteSources(shared,reads,'ORDER-1')[0].id,null);
 assert.match(comparisonNoteSources(shared,reads,'ORDER-1')[0].reason,/Several/);
});
