import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOrderReads,readChangeNote,comparisonNote,savedReadState,previousChangedReadPair} from '../web/read-comparison.mjs';
import {admitSharedPacket} from '../server.mjs';
const orderId='ORDER-DELTA-123';
const capture=(status,amount={currency:'USD',value:'10.00'})=>({id:'CAPTURE-ONE',status,amount});
const read=(id,status,captures,extra={})=>({id,order_id:orderId,status,captures,source:'sandbox_api',observed_at:'2026-11-10T20:00:00.000Z',...extra});
test('same order status still exposes capture progression and amount difference',()=>{
 const c=compareOrderReads([read('R1','COMPLETED',[capture('PENDING')]),read('R2','COMPLETED',[capture('COMPLETED',{currency:'USD',value:'12.50'})])],orderId);
 assert.deepEqual(c.changes.map(x=>x.kind),['capture_status','capture_amount']);
 assert.equal(c.changes[1].before,'USD 10.00');assert.equal(c.changes[1].after,'USD 12.50');
 assert.equal(readChangeNote(c).level,'investigate');assert.deepEqual(readChangeNote(c).ids,['R1','R2']);
});
test('legacy amounts stay unknown and never become zero or amount changes',()=>{
 const c=compareOrderReads([read('R1','COMPLETED',[{id:'CAPTURE-ONE',status:'COMPLETED'}]),read('R2','COMPLETED',[capture('COMPLETED')])],orderId);
 assert.equal(c.changes.length,0);assert.equal(c.unknown_amount_captures,1);
});
test('shared, sample and other-order reads never create a local comparison',()=>{
 assert.equal(compareOrderReads([read('S','COMPLETED',[],{source:'imported_packet'}),read('X','COMPLETED',[],{source:'authored_sample'}),read('Y','COMPLETED',[],{order_id:'ORDER-OTHER'})],orderId).state,'unavailable');
 const c=compareOrderReads([read('R1','APPROVED',[]),read('I','COMPLETED',[capture('COMPLETED')],{source:'imported_packet'}),read('R2','COMPLETED',[capture('COMPLETED')])],orderId);
 assert.equal(c.before.id,'R1');assert.equal(c.after.id,'R2');
});
test('disappearing capture is absence from response, never an inferred refund',()=>{
 const c=compareOrderReads([read('R1','COMPLETED',[capture('COMPLETED')]),read('R2','COMPLETED',[])],orderId);
 assert.equal(c.changes[0].kind,'capture_absent');assert.match(c.changes[0].caution,/does not establish a refund/);
});
test('equal decimal amounts compare without floating point and currency changes remain visible',()=>{
 const a=capture('COMPLETED',{currency:'USD',value:'0010.000'});
 const b=capture('COMPLETED',{currency:'USD',value:'10.00'});
 assert.equal(compareOrderReads([read('R1','COMPLETED',[a]),read('R2','COMPLETED',[b])],orderId).changes.length,0);
 b.amount.currency='EUR';
 assert.equal(compareOrderReads([read('R1','COMPLETED',[a]),read('R2','COMPLETED',[b])],orderId).changes[0].kind,'capture_amount');
});
test('packet admission retains historical amounts without trusting sender comparison or provenance',()=>{
 const raw={order_id:orderId,order:{id:orderId,status:'COMPLETED',units:[{amount:{currency:'USD',value:'10.00'},captures:[capture('COMPLETED')]}]},events:[],snapshots:[read('R1','COMPLETED',[capture('COMPLETED')])],read_comparison:{state:'ready',trusted:true}};
 const result=admitSharedPacket(raw);
 assert.deepEqual(result.snapshots[0].captures[0].amount,{currency:'USD',value:'10.00'});
 assert.equal(result.snapshots[0].source,'imported_packet');
 assert.equal(compareOrderReads(result.snapshots,orderId).state,'unavailable');
 assert.equal('read_comparison' in result,false);
});

test('a delayed older response remains in history without becoming the comparison after-state',()=>{
 const before=read('R0','COMPLETED',[capture('PENDING')]);
 const selected=read('NEW','COMPLETED',[capture('COMPLETED')],{requested_at:'2026-11-10T20:02:00.000Z'});
 const delayed=read('OLD','COMPLETED',[capture('PENDING')],{requested_at:'2026-11-10T20:01:00.000Z',superseded_by:'NEW'});
 const comparison=compareOrderReads([before,selected,delayed],orderId);
 assert.equal(comparison.read_count,3);assert.equal(comparison.comparable_read_count,2);
 assert.equal(comparison.before.id,'R0');assert.equal(comparison.after.id,'NEW');
 assert.equal(comparison.changes[0].before,'PENDING');assert.equal(comparison.changes[0].after,'COMPLETED');
 assert.equal(comparison.overlapping_read_count,1);assert.equal(readChangeNote(comparison),null);
 const refreshed=compareOrderReads([before,selected,delayed,read('FRESH','COMPLETED',[capture('COMPLETED')])],orderId);
 assert.equal(refreshed.before.id,'NEW');assert.equal(refreshed.after.id,'FRESH');assert.equal(refreshed.changes.length,0);
 assert.equal(refreshed.overlapping_read_count,0);assert.equal(refreshed.read_count,4);
});
test('one applied read and a delayed overlapping response do not manufacture a state transition',()=>{
 const comparison=compareOrderReads([read('NEW','COMPLETED',[capture('COMPLETED')]),read('OLD','CREATED',[],{superseded_by:'NEW'})],orderId);
 assert.equal(comparison.state,'unavailable');assert.equal(comparison.read_count,2);
 assert.equal(comparison.comparable_read_count,1);assert.equal(comparison.overlapping_read_count,1);
 assert.deepEqual(comparison.changes,[]);assert.equal(readChangeNote(comparison),null);
});
test('comparison excludes superseded late responses and direct capture reads',()=>{
 const read=(id,status,extra={})=>({id,order_id:'ORDER-1',source:'sandbox_api',status:'COMPLETED',captures:[{id:'CAP-1',status,amount:{currency:'USD',value:'5.00'}}],...extra});
 const reads=[read('READ-1','PENDING'),read('READ-2','COMPLETED'),read('LATE','PENDING',{superseded_by:'READ-2'}),read('CAPTURE-ONLY','REFUNDED',{resource_kind:'capture'}),read('IMPORTED','REFUNDED',{source:'imported_packet'})];
 const result=compareOrderReads(reads,'ORDER-1');assert.equal(result.before.id,'READ-1');assert.equal(result.after.id,'READ-2');assert.equal(result.read_count,3);assert.equal(result.comparable_read_count,2);assert.equal(result.changes[0].after,'COMPLETED');
});


test('explicit saved pair exposes an earlier transition after unchanged refreshes',()=>{
 const snapshots=[read('R1','COMPLETED',[capture('PENDING')]),read('R2','COMPLETED',[capture('COMPLETED')]),read('R3','COMPLETED',[capture('COMPLETED')]),read('R4','COMPLETED',[capture('COMPLETED')])];
 assert.equal(compareOrderReads(snapshots,orderId).changes.length,0);
 const selected=compareOrderReads(snapshots,orderId,{before:'R1',after:'R4'});
 assert.equal(selected.before.id,'R1');assert.equal(selected.after.id,'R4');
 assert.equal(selected.changes[0].before,'PENDING');assert.equal(selected.changes[0].after,'COMPLETED');
 assert.equal(compareOrderReads(snapshots,orderId).before.id,'R3');
});
test('explicit comparison refuses foreign, imported, superseded and reversed selections',()=>{
 const snapshots=[read('R1','COMPLETED',[capture('PENDING')]),read('R2','COMPLETED',[capture('COMPLETED')]),read('IMPORT','COMPLETED',[],{source:'imported_packet'}),read('FOREIGN','COMPLETED',[],{order_id:'OTHER'}),read('LATE','COMPLETED',[],{superseded_by:'R2'})];
 for(const before of ['IMPORT','FOREIGN','LATE','MISSING','R2']){
  const c=compareOrderReads(snapshots,orderId,{before,after:'R2'});
  assert.equal(c.state,'unavailable');assert.deepEqual(c.changes,[]);
 }
 assert.equal(compareOrderReads(snapshots,orderId,{before:'R2',after:'R1'}).state,'unavailable');
});

test('comparison draft preserves selected sources, qualifications and unknown amounts',()=>{
 const c=compareOrderReads([read('R1','COMPLETED',[capture('PENDING')]),read('R2','COMPLETED',[capture('PARTIALLY_REFUNDED',{currency:'USD',value:'12.50'})])],orderId);
 const text=comparisonNote(c,orderId);assert.match(text,/Earlier read R1/);assert.match(text,/Later read R2/);assert.match(text,/PENDING → PARTIALLY_REFUNDED/);assert.ok(text.includes(c.changes[1].caution));
 const absent=compareOrderReads([read('R1','COMPLETED',[capture('COMPLETED')]),read('R2','COMPLETED',[])],orderId);
 assert.ok(comparisonNote(absent,orderId).includes(absent.changes[0].caution));
 const unknown=compareOrderReads([read('R1','COMPLETED',[{id:'CAPTURE-ONE',status:'PENDING'}]),read('R2','COMPLETED',[capture('COMPLETED')])],orderId);
 assert.match(comparisonNote(unknown,orderId),/Amount unavailable for 1/);
 assert.throws(()=>comparisonNote({state:'unavailable'},orderId));
 const large=comparisonNote({...c,changes:[{label:'x'.repeat(4001)}]},orderId);assert.ok(large.length<=4000);assert.match(large,/1 additional changes/);assert.match(large,/Earlier read R1/);
});

test('saved choices reveal capture state even when order status is unchanged',()=>{
 assert.equal(savedReadState(read('P','COMPLETED',[capture('PENDING')])),'Capture PENDING');
 assert.equal(savedReadState(read('R','COMPLETED',[capture('PARTIALLY_REFUNDED')])),'Capture PARTIALLY_REFUNDED');
 assert.equal(savedReadState(read('EMPTY','COMPLETED',[])),'Order COMPLETED · No captures');
 assert.equal(savedReadState(read('M','COMPLETED',[capture('COMPLETED'),capture('PENDING'),capture('COMPLETED')])),'3 captures · 2 COMPLETED / 1 PENDING');
});
test('previous change skips quiet refreshes and walks exact older transitions',()=>{
 const snapshots=[read('R1','COMPLETED',[capture('PENDING')]),read('R2','COMPLETED',[capture('COMPLETED')]),read('R3','COMPLETED',[capture('COMPLETED')]),read('R4','COMPLETED',[capture('REFUNDED')]),read('R5','COMPLETED',[capture('REFUNDED')]),read('IMPORTED','COMPLETED',[capture('FAILED')],{source:'imported_packet'}),read('LATE','COMPLETED',[capture('FAILED')],{superseded_by:'R5'})];
 assert.deepEqual(previousChangedReadPair(snapshots,orderId),{before:'R3',after:'R4'});
 assert.deepEqual(previousChangedReadPair(snapshots,orderId,'R4'),{before:'R1',after:'R2'});
 assert.equal(previousChangedReadPair(snapshots,orderId,'R2'),null);
 assert.equal(previousChangedReadPair(snapshots,orderId,'FOREIGN'),null);
 assert.equal(previousChangedReadPair([read('R1','COMPLETED',[capture('COMPLETED')]),read('R2','COMPLETED',[capture('COMPLETED')])],orderId),null);
});

test('large comparison notes keep complete qualified changes and source links within the note limit',()=>{
 const c=compareOrderReads([read('R1','COMPLETED',Array.from({length:40},(_,i)=>({...capture('COMPLETED'),id:'CAPTURE-'+i}))),read('R2','COMPLETED',[])],orderId);
 const note=comparisonNote(c,orderId);
 assert.ok(note.length<=4000);assert.match(note,/Earlier read R1/);assert.match(note,/Later read R2/);assert.match(note,/additional changes/);
 const included=(note.match(/Capture absent from later read/g)||[]).length;
 assert.ok(included>0&&included<40);
 assert.equal((note.match(/Absence from this read does not establish a refund/g)||[]).length,included);
 assert.ok(note.includes(String(40-included)+' additional changes'));
});
