import test from 'node:test';import assert from 'node:assert/strict';import {presentCase,presentTimelineRecord,formatTimelineClock,presentOrderReadCaptures,overviewTimeline,presentSavedObservationRow} from '../web/case-presentation.mjs';
const order={id:'ORDER-123',status:'COMPLETED',units:[{captures:[{id:'CAP-1',status:'COMPLETED',amount:{currency:'USD',value:'12.34'}}]}]};
test('saved genuine refund row presents its exact reported amount, status and read clock',()=>{
 const row='refund_read · COMPLETED · USD 0.25 · 2026-11-11T01:26:48.577Z';
 assert.deepEqual(presentSavedObservationRow(row),{original:row,kind:'refund_read',label:'Refund read',status:'COMPLETED',amount:'USD 0.25',time:'2026-11-11T01:26:48.577Z',timeLabel:'Observed'});
});
test('saved explicit-time capture answer stays distinct from the selected boundary',()=>{
 const row='capture_read · COMPLETED · USD 88.00 · 2026-11-10T10:20:00.000Z';
 const answer=presentSavedObservationRow(row);
 assert.equal(answer.amount,'USD 88.00');assert.equal(answer.time,'2026-11-10T10:20:00.000Z');assert.equal(answer.label,'Capture read');assert.equal(answer.original,row);
 assert.equal(presentSavedObservationRow('Chosen time boundary: observation at 2026-11-10T10:12:00.000Z; explicitly selected after the original question was unanswered.'),null);
 assert.equal(presentSavedObservationRow('Condition: Capture read observed after: 2026-11-10T10:12:00.000Z'),null);
});
test('saved rows keep read, occurrence and delivery clocks distinct without inventing an amount',()=>{
 for(const [type,kind,label,clock] of [['order_read','order_read','Order read','Observed'],['event','event','Event','Occurred'],['Delivery received','delivery','Event delivery','Received']]){
  const row=type+' · PENDING · Amount unavailable · 2026-11-10T10:20:00Z';
  assert.deepEqual(presentSavedObservationRow(row),{original:row,kind,label,status:'PENDING',amount:null,time:'2026-11-10T10:20:00Z',timeLabel:clock});
 }
});
test('unknown or ambiguous saved-row shapes retain the plain-text fallback',()=>{
 const valid='refund_read · COMPLETED · USD 0.25 · 2026-11-11T01:26:48.577Z';
 for(const row of [null,valid+'\n',valid+'\n'+valid,valid+' · buyer credited',valid.replace('refund_read','provider_read'),valid.replace('0.25','0.25 / 0.50'),valid.replace('2026-11-11','2026-02-30'),valid.replace('48.577Z','48.577'),valid.replace('COMPLETED','completed')])assert.equal(presentSavedObservationRow(row),null);
});
test('case source stays separate from exact amount and reported capture state',()=>{for(const flags of [{},{sample:true},{imported:true}]){const p=presentCase({order:{...order,...flags}});assert.equal(p.amount,'12.34');assert.equal(p.currency,'USD');assert.equal(p.status.label,'Captured');if(flags.sample||flags.imported)assert.equal(p.status.tone,'neutral');}});
test('completed order is not silently described as a capture; multiple amounts are not summed',()=>{assert.equal(presentCase({order:{...order,units:[]}}).status.label,'Order completed');assert.equal(presentTimelineRecord({kind:'order_read',status:'COMPLETED',captures:[]}).title,'Order observed');assert.equal(presentCase({order:{...order,units:[...order.units,...order.units]}}).amount,'—');});
test('authoritative reversal cannot be hidden by stale completed capture',()=>{const event={id:'E1',order_id:order.id,resource_id:'CAP-1',type:'PAYMENT.CAPTURE.REVERSED',source:'sandbox_event_api',provider_observed_at:'2026-11-10T22:00:00Z',verified:false};assert.equal(presentCase({order,events:[event]}).status.label,'Review reversal');assert.equal(presentCase({order,events:[{...event,source:'imported_packet'}]}).status.label,'Captured');assert.equal(presentCase({order,events:[{...event,resource_id:'OTHER'}]}).status.label,'Captured');assert.equal(presentCase({order}).primaryAction.kind,'refresh');});


test('direct capture observations retain their resource identity and provider source in the overview',()=>{
 const read={id:'CAPREAD-71',order_id:order.id,resource_kind:'capture',capture_id:'CAP-1',status:'PARTIALLY_REFUNDED',source:'sandbox_capture_api',amount:{currency:'USD',value:'12.34'},captures:[{id:'CAP-1',status:'PARTIALLY_REFUNDED'}]};
 const actual=presentCase({order,snapshots:[read]}).timeline[0];
 assert.equal(actual.title,'Capture observed');assert.equal(actual.detail,'Partially refunded · USD 12.34');assert.equal(actual.sourceKind,'provider');
 const shared=presentTimelineRecord({...read,source:'imported_packet',reported_source:'sandbox_capture_api'});
 assert.equal(shared.title,'Capture observed');assert.equal(shared.sourceKind,'shared');assert.equal(shared.tone,'neutral');
});

const laterCapture={id:'CAPREAD-LATER',resource_kind:'capture',order_id:order.id,capture_id:'CAP-1',status:'PARTIALLY_REFUNDED',source:'sandbox_capture_api',amount:{currency:'USD',value:'12.34'},requested_at:'2026-11-10T22:47:45.342Z',observed_at:'2026-11-10T22:47:45.900Z'};
const captureRow=read=>({id:'CAP-1',amount:{currency:'USD',value:'12.34'},api_status:'COMPLETED',capture_reads:[read],latest_capture_read:read.source==='sandbox_capture_api'?read:null});
test('overview reflects an exact local capture read and retains the earlier order disagreement',()=>{
 const packet={order,captures:[captureRow(laterCapture)],snapshots:[laterCapture],diagnosis:{notes:[{level:'investigate',title:'Capture statuses differ',ids:['CAP-1']}],actions:[]}};
 const before=JSON.stringify(packet),view=presentCase(packet);
 assert.equal(view.status.label,'Partially refunded');assert.equal(view.sourceKind,'provider');assert.equal(view.amount,'12.34');
 assert.match(view.summary,/Capture CAP-1 · In order read: Captured/);assert.match(view.summary,/Capture read: Partially refunded/);assert.equal(JSON.stringify(packet),before);
});
test('shared capture claims never outrank a local order, but remain visible in shared-only cases',()=>{
 const shared={...laterCapture,source:'imported_packet',reported_source:'sandbox_capture_api'};
 const local=presentCase({order,captures:[captureRow(shared)]});assert.equal(local.status.label,'Captured');assert.equal(local.sourceKind,'provider');
 const imported=presentCase({order:{...order,imported:true},captures:[captureRow(shared)]});assert.equal(imported.status.label,'Partially refunded');assert.equal(imported.sourceKind,'shared');assert.equal(imported.status.tone,'neutral');assert.match(imported.summary,/Capture CAP-1 · In shared order: Captured/);assert.match(imported.summary,/Shared capture read: Partially refunded/);
});
test('capture state is matched by exact ID and cannot replace an authored example',()=>{
 assert.equal(presentCase({order,captures:[captureRow({...laterCapture,capture_id:'OTHER'})]}).status.label,'Captured');
 assert.equal(presentCase({order:{...order,sample:true},captures:[captureRow(laterCapture)]}).status.label,'Captured');
});
test('capture-only local evidence supplies state without inventing an order',()=>{
 const packet={order:null,order_id:order.id,captures:[captureRow(laterCapture)]},view=presentCase(packet);
 assert.equal(view.status.label,'Partially refunded');assert.equal(view.sourceKind,'provider');assert.equal(view.amount,'12.34');assert.equal(view.metrics.captures,1);assert.equal(packet.order,null);
});
test('independent capture states stay separate in a multiple-capture payment',()=>{
 const multi={...order,units:[{captures:[...order.units[0].captures,{id:'CAP-2',status:'COMPLETED',amount:{currency:'USD',value:'8.00'}}]}]};
 const view=presentCase({order:multi,captures:[captureRow(laterCapture)]});assert.equal(view.status.label,'Mixed captures');assert.equal(view.metrics.captures,2);assert.equal(view.amount,'—');assert.match(view.summary,/Capture CAP-1 · In order read: Captured/);assert.doesNotMatch(view.summary,/CAP-2/);
});

test('a local capture amount replaces a differing shared order amount without changing the imported record',()=>{
 const imported={...order,imported:true,units:[{captures:[{id:'CAP-1',status:'COMPLETED',amount:{currency:'EUR',value:'99.00'}}]}]};
 const before=JSON.stringify(imported),view=presentCase({order:imported,captures:[captureRow(laterCapture)]});
 assert.equal(view.sourceKind,'provider');assert.equal(view.status.label,'Partially refunded');assert.equal(view.amount,'12.34');assert.equal(view.currency,'USD');assert.equal(JSON.stringify(imported),before);
});

test('repeated reads do not displace the received event or create payment occurrences',()=>{
 const event=presentTimelineRecord({id:'SIGNED',kind:'webhook',type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAP-1',verified:true,occurred:'2026-11-10T12:00:00Z',received:'2026-11-10T12:00:20Z'});
 const reads=Array.from({length:8},(_,n)=>presentTimelineRecord({id:'READ-'+n,kind:'capture_read',capture_id:'CAP-1',source:'sandbox_capture_api',status:'COMPLETED',observed_at:'2026-11-11T00:0'+n+':00Z'}));
 const before=JSON.stringify([event,...reads]),view=overviewTimeline([event,...reads]);
 assert.equal(view.length,2);assert.equal(view[0].id,'READ-7');assert.equal(view[0].readCount,8);
 assert.equal(view[0].title,'Capture observed');assert.equal(view[0].timeLabel,'Observed');
 assert.equal(view[1].id,'SIGNED');assert.equal(view[1].time,'2026-11-10T12:00:00Z');assert.equal(view[1].timeLabel,'Occurred');assert.equal(view[1].received,'2026-11-10T12:00:20Z');
 assert.equal(JSON.stringify([event,...reads]),before);
});
test('overview keeps distinct capture identity and does not promote transferred evidence',()=>{
 const make=(id,capture,source,time)=>presentTimelineRecord({id,kind:'capture_read',capture_id:capture,source,status:'COMPLETED',observed_at:time});
 const records=[make('LOCAL-A','A','sandbox_capture_api','2026-11-11T02:00:00Z'),make('SHARED-A','A','imported_packet','2026-11-11T03:00:00Z'),make('LOCAL-B','B','sandbox_capture_api','2026-11-11T01:00:00Z')];
 const view=overviewTimeline(records);assert.equal(view.length,3);assert.deepEqual(new Set(view.map(x=>x.id)),new Set(records.map(x=>x.id)));
 assert.equal(view[0].provenance,'Shared claim · unverified');assert.equal(view[0].timeLabel,'Reported read');assert.equal(view[0].tone,'neutral');
});
test('event read and event occurrence stay distinct, including unknown occurrence times',()=>{
 const known=presentTimelineRecord({id:'API-E',kind:'webhook',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REF-1',capture_id:'CAP-1',refund_amount:{currency:'USD',value:'0.30'},source:'sandbox_event_api',occurred:'2026-11-10T12:00:00Z',provider_observed_at:'2026-11-11T03:00:00Z'});
 assert.equal(known.time,'2026-11-11T03:00:00Z');assert.equal(known.timeLabel,'Read');assert.equal(known.occurred,'2026-11-10T12:00:00Z');assert.match(known.provenance,/no delivery signature/);assert.equal(known.resourceId,'CAP-1');assert.equal(known.detail,'Refund recorded · USD 0.30');assert.equal(known.reference,'Refund REF-1 · Capture CAP-1');
 const unknown=presentTimelineRecord({id:'M',kind:'webhook',type:'PAYMENT.CAPTURE.COMPLETED',source:'manual'});
 assert.equal(unknown.time,null);assert.equal(unknown.provenance,'Imported event · unverified');
});

test('reading an existing event through the API remains an observation beside its signed delivery',()=>{
 const event={id:'SIGNED',kind:'webhook',type:'PAYMENT.CAPTURE.COMPLETED',resource_id:'CAP-1',verified:true,occurred:'2026-11-10T12:00:00Z',received:'2026-11-10T12:00:20Z'};
 const api=presentTimelineRecord({...event,id:'EVENTREAD-1',event_id:'SIGNED',source:'sandbox_event_api',verified:false,received:null,provider_observed_at:'2026-11-11T10:00:00Z'});
 assert.equal(api.observation,true);assert.equal(api.title,'Event observed');assert.equal(api.timeLabel,'Read');assert.equal(api.time,'2026-11-11T10:00:00Z');
 const reads=[presentTimelineRecord(event),api,presentTimelineRecord({id:'ORDERREAD',kind:'order_read',order_id:'ORDER-1',source:'sandbox_api',status:'COMPLETED',observed_at:'2026-11-11T11:00:00Z'})];
 assert.ok(overviewTimeline(reads).some(r=>r.id==='SIGNED'));
 const shared=presentTimelineRecord({...event,id:'SHARED-API',source:'imported_packet',reported_source:'sandbox_event_api',event_id:'SIGNED',verified:false,reported_verified:false,received:null,reported_provider_observed_at:'2026-11-11T10:00:00Z'});
 assert.equal(shared.observation,true);assert.equal(shared.timeLabel,'Reported read');assert.equal(shared.provenance,'Shared claim · unverified');
});

test('late superseded order reads remain counted but never replace the accepted observation in the overview',()=>{
 const read=(id,at,extra={})=>presentTimelineRecord({id,kind:'order_read',order_id:'ORDER-1',source:'sandbox_api',status:'COMPLETED',observed_at:at,...extra});
 const selected=read('ACCEPTED','2026-11-11T10:00:00Z');
 const delayed=read('DELAYED','2026-11-11T11:00:00Z',{status:'PENDING',superseded_by:'ACCEPTED'});
 const view=overviewTimeline([selected,delayed]);
 assert.equal(view.length,1);assert.equal(view[0].id,'ACCEPTED');assert.equal(view[0].readCount,2);
 assert.equal(delayed.superseded,true);
});

test('exact refund observations count as reads and retain individual amount, source and resource identity',()=>{
 const refund={id:'REFREAD-1',refund_id:'REFUND-A',capture_id:'CAP-1',order_id:order.id,status:'COMPLETED',amount:{currency:'USD',value:'0.25'},total_refunded_amount:{currency:'USD',value:'0.75'},source:'sandbox_refund_api',requested_at:'2026-11-11T09:00:00Z',observed_at:'2026-11-11T09:00:01Z',updated:'2026-11-10T20:00:00Z'};
 const packet={order,refund_observations:[refund]},before=JSON.stringify(packet),view=presentCase(packet),record=view.timeline[0];
 assert.deepEqual(view.metrics,{captures:1,events:0,reads:1});assert.equal(view.amount,'12.34');
 assert.equal(record.kind,'refund_read');assert.equal(record.title,'Refund observed');assert.equal(record.detail,'Completed · USD 0.25');
 assert.equal(record.resourceId,'REFUND-A');assert.equal(record.reference,'Refund REFUND-A · Capture CAP-1');
 assert.equal(record.time,refund.observed_at);assert.equal(record.timeLabel,'Observed');assert.equal(record.observation,true);
 assert.equal(record.sourceKind,'provider');assert.equal(record.occurred,null);
 const shared=presentTimelineRecord({...refund,source:'imported_packet',reported_source:'sandbox_refund_api',requested_at:undefined,reported_requested_at:refund.requested_at});
 assert.equal(shared.kind,'refund_read');assert.equal(shared.sourceKind,'shared');assert.equal(shared.tone,'neutral');
 assert.equal(shared.timeLabel,'Reported read');assert.equal(shared.selectionAt,refund.requested_at);
 assert.equal(JSON.stringify(packet),before);
});
test('refund overview selects the newest request while retaining distinct refunds on one capture',()=>{
 const make=(id,refund,requested,observed,source='sandbox_refund_api')=>presentTimelineRecord({id,kind:'refund_read',refund_id:refund,capture_id:'CAP-1',status:'COMPLETED',source,requested_at:requested,observed_at:observed,amount:{currency:'USD',value:'0.25'}});
 const accepted=make('LATEST-A','REFUND-A','2026-11-11T09:00:02Z','2026-11-11T09:00:03Z');
 const delayed=make('LATE-A','REFUND-A','2026-11-11T09:00:00Z','2026-11-11T09:00:05Z');
 const second=make('REF-B','REFUND-B','2026-11-11T09:00:04Z','2026-11-11T09:00:06Z');
 const shared=make('SHARED-A','REFUND-A','2026-11-11T09:00:07Z','2026-11-11T09:00:08Z','imported_packet');
 const records=[accepted,delayed,second,shared],before=JSON.stringify(records),view=overviewTimeline(records);
 assert.deepEqual(view.map(r=>r.id),['SHARED-A','REF-B','LATEST-A']);
 assert.equal(view.find(r=>r.id==='LATEST-A').readCount,2);assert.equal(view[0].sourceKind,'shared');
 assert.equal(JSON.stringify(records),before);
});
test('refund reads remain observations beside an actual refund event',()=>{
 const event=presentTimelineRecord({id:'REF-EVENT',kind:'webhook',type:'PAYMENT.CAPTURE.REFUNDED',resource_id:'REFUND-A',capture_id:'CAP-1',verified:true,occurred:'2026-11-10T20:00:00Z',received:'2026-11-10T20:00:02Z'});
 const read=presentTimelineRecord({id:'REF-READ',kind:'refund_read',refund_id:'REFUND-A',capture_id:'CAP-1',source:'sandbox_refund_api',status:'COMPLETED',observed_at:'2026-11-11T09:00:00Z'});
 const view=overviewTimeline([event,read]);assert.deepEqual(view.map(r=>r.id),['REF-READ','REF-EVENT']);
 assert.equal(view[0].timeLabel,'Observed');assert.equal(view[1].timeLabel,'Occurred');assert.equal(view[1].received,'2026-11-10T20:00:02Z');
});

test('refund amount summary selects one exact refund without adding repeated or unrelated reads',()=>{
 const base={order:{id:'O',imported:true,units:[{captures:[{id:'C',status:'PARTIALLY_REFUNDED',amount:{currency:'USD',value:'1.00'}}]}]},refund_observations:[{refund_id:'R',order_id:'O',capture_id:'C',source:'imported_packet',observed_at:'2026-11-11T01:00:00Z',amount:{currency:'USD',value:'0.25'}},{refund_id:'R',order_id:'O',capture_id:'C',source:'imported_packet',observed_at:'2026-11-11T02:00:00Z',amount:{currency:'USD',value:'0.30'}},{refund_id:'FOREIGN',order_id:'OTHER',capture_id:'C',source:'sandbox_refund_api',amount:{currency:'USD',value:'8.00'}}]};
 assert.equal(presentCase(base).refundAmount,'USD 0.30');
 assert.equal(presentCase({...base,refund_observations:[...base.refund_observations,{refund_id:'R2',order_id:'O',capture_id:'C',amount:{currency:'USD',value:'0.15'}}]}).refundAmount,null);
 assert.equal(presentCase({...base,refund_observations:[]}).refundAmount,null);
});

test('opened order source preserves each capture observation without borrowing an amount',()=>{
 const row={kind:'order_read',status:'COMPLETED',source:'imported_packet',captures:[{id:'A',status:'PARTIALLY_REFUNDED'},{id:'B',status:'COMPLETED',amount:{currency:'EUR',value:'8.00'}}]};
 const before=JSON.stringify(row);
 assert.deepEqual(presentOrderReadCaptures(row),[{id:'A',status:'Partially refunded',amount:null},{id:'B',status:'Captured',amount:'EUR 8.00'}]);
 assert.deepEqual(presentOrderReadCaptures({...row,kind:'capture_read'}),[]);
 assert.deepEqual(presentOrderReadCaptures({...row,captures:[]}),[]);
 assert.equal(JSON.stringify(row),before);
});
test('canonical saved scope rows keep exact resource, amount, clock and stated basis',()=>{
 const order='Shared claim, not locally revalidated at 2026-11-11T02:32:49.690Z reports order ORDER-2846 COMPLETED.';
 assert.deepEqual(presentSavedObservationRow(order),{original:order,kind:'order_read',label:'Order read',resourceId:'ORDER-2846',status:'COMPLETED',amount:null,time:'2026-11-11T02:32:49.690Z',timeLabel:'Reported read',basis:'Shared claim, not locally revalidated'});
 const capture='PayPal capture read at 2026-11-11T02:32:50Z reports capture CAPTURE-2846 PARTIALLY_REFUNDED / USD 0.00.';
 assert.equal(presentSavedObservationRow(capture).amount,'USD 0.00');
 assert.equal(presentSavedObservationRow(capture.replace('USD 0.00','amount not supplied')).amount,null);
 for(const invalid of [capture+' Extra claim',capture+'\n',capture.replace('PayPal capture read','PayPal order read'),capture.replace('PARTIALLY_REFUNDED','COMPLETED'),order.replace('COMPLETED.','COMPLETED / USD 1.20.'),capture.replace('2026-11-11','2026-02-30'),capture.replace('USD 0.00','USD -2')])assert.equal(presentSavedObservationRow(invalid),null,invalid);
});

test('a delivery keeps its occurrence and receipt clocks separate in the source card',()=>{
 const row={kind:'webhook',type:'PAYMENT.CAPTURE.REFUNDED',verified:true,occurred:'2026-11-10T10:13:00Z',received:'2026-11-10T10:16:08.125Z'};
 const view=presentTimelineRecord(row);
 assert.equal(view.time,row.occurred);assert.equal(view.timeLabel,'Occurred');
 assert.equal(view.received,row.received);assert.equal(view.receiptTimeLabel,'Received');
 assert.equal(formatTimelineClock(view.received),'10 Nov, 10:16:08.125 UTC');
 const shared=presentTimelineRecord({...row,source:'imported_packet',verified:false});
 assert.equal(shared.receiptTimeLabel,'Reported receipt');assert.equal(shared.sourceKind,'shared');
});
test('provider event reads and resource reads do not acquire a delivery receipt clock',()=>{
 for(const row of [
  {kind:'webhook',source:'sandbox_event_api'},
  {kind:'webhook',source:'imported_packet',reported_source:'sandbox_event_api'},
  {kind:'order_read',source:'sandbox_api',captures:[]},
  {kind:'capture_read',source:'sandbox_capture_api'},
  {kind:'refund_read',source:'sandbox_refund_api'}
 ])assert.equal(presentTimelineRecord({...row,received:'2026-11-10T10:16:08Z'}).receiptTimeLabel,null);
});
test('a missing shared delivery receipt is explicit without substituting occurrence time',()=>{
 const view=presentTimelineRecord({kind:'webhook',source:'imported_packet',occurred:'2026-11-10T10:13:00Z'});
 assert.equal(view.received,null);assert.equal(view.receiptTimeLabel,'Reported receipt');
 assert.equal(formatTimelineClock(view.received),'Time unknown');
 assert.equal(formatTimelineClock('not-a-time'),'Time unknown');
});
