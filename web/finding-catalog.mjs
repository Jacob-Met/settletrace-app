export const findingFollowupResultText={records:'Records gathered; not a supported answer.',answer:'Supported answer to the follow-up question.'};
export const refundEvidenceLimits=['The retained records do not establish why this refund or its amount was chosen.','A completed refund observation does not establish when the buyer received or could use the money.','These records do not establish a complete refund history or the remaining refundable amount.'];
import {selectCaptureRefunds} from './refund-selection.mjs';
import {isProviderRead,hasEventAuthority} from './event-origin.mjs';

const money=a=>a?.currency&&a?.value!==undefined&&a?.value!==''?a.currency+' '+a.value:'amount not supplied';
const time=r=>r.observed_at||r.provider_observed_at||r.reported_provider_observed_at||r.occurred||null;
const stamp=r=>time(r)||'time not supplied';
const basis=r=>r.sample?'Authored example':r.source==='imported_packet'?'Shared claim, not locally revalidated':r.source==='sandbox_refund_api'?'PayPal refund read':r.source==='sandbox_capture_api'?'PayPal capture read':r.source==='sandbox_api'?'PayPal order read':isProviderRead(r)?'PayPal event read, not delivery proof':hasEventAuthority(r)?'Signature-verified delivery':'Unverified observation';
const isEventRead=r=>isProviderRead(r)||r.source==='imported_packet'&&r.reported_source==='sandbox_event_api';
const isDeliveryObservation=r=>!!r.type&&!isEventRead(r)&&(r.verified===true||r.source==='webhook'||r.source==='imported_packet'&&r.reported_source==='webhook');
const unique=xs=>[...new Set(xs.filter(Boolean))];
const references=records=>unique(records.flatMap(r=>[r.id,r.event_id,r.reported_read_id,r.refund_id,r.resource_id,r.capture_id]));
const chronological=records=>[...records].sort((a,b)=>(Date.parse(time(a))||0)-(Date.parse(time(b))||0));
const ids=records=>unique(records.map(r=>r.id));
const statusObservation=(r,kind,status,amount)=>({
 source_id:r.id,kind,status:status||null,amount:amount||null,source:r.source||null,sample:!!r.sample,
 occurred_at:kind==='event'?r.occurred||null:null,
 observed_at:kind==='event'?r.provider_observed_at||r.reported_provider_observed_at||null:r.observed_at||r.provider_observed_at||r.reported_provider_observed_at||null,
 received_at:kind==='event'?r.received||null:null
});

// Receipt intervals are grouped by provider event identity, never by refund alone.
export function retainedDeliveryGroups(records){
 const groups=new Map();
 for(const record of records.filter(isDeliveryObservation)){
  if(!record.event_id||!record.id)continue;
  if(!groups.has(record.event_id))groups.set(record.event_id,new Map());
  const rows=groups.get(record.event_id),prior=rows.get(record.id);
  if(prior){if(prior.received_at!==record.received)prior.received_at=null;continue;}
  rows.set(record.id,{source_id:record.id,received_at:record.received||null,source:record.source,sample:!!record.sample});
 }
 return [...groups].map(([event_id,rows])=>{
  const deliveries=[...rows.values()],known=deliveries.every(r=>r.received_at&&Number.isFinite(Date.parse(r.received_at)));
  if(known)deliveries.sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at));
  return {event_id,count:deliveries.length,deliveries,elapsed_ms:known&&deliveries.length>1?Date.parse(deliveries.at(-1).received_at)-Date.parse(deliveries[0].received_at):null};
 });
}

// Resource relationships come from normalized fields, never from co-occurring
// words in an aggregate finding. All history remains available behind the answer.
export function resourceFindingCatalog(packet){
 const orderId=packet.order_id||packet.order?.id;
 const events=(packet.events||[]).filter(e=>e.order_id===orderId);
 const snapshots=(packet.snapshots||[]).filter(r=>r.order_id===orderId);
 const refundReads=(packet.refund_observations||[]).filter(r=>r.order_id===orderId);
 const refundEvents=events.filter(e=>e.type==='PAYMENT.CAPTURE.REFUNDED').map(e=>({...e,refund_id:e.resource_id,amount:e.refund_amount,status:e.refund_status,observed_at:time(e)}));
 const refundObservations=[...refundEvents,...refundReads].map(r=>({...r,capture_id:r.capture_id||null}));
 const rows=packet.captures||[];
 const captureIds=unique([...rows.map(r=>r.id),...refundObservations.map(r=>r.capture_id),...snapshots.flatMap(r=>(r.captures||[]).map(c=>c.id))]);
 const result=[];
 const add=(id,type,resourceId,refs,note,extra={})=>result.push({id,kind:'finding',resource_type:type,resource_id:resourceId,references:unique(refs),source_kind:note.kind||null,title:note.title,text:note.detail,source_ids:note.ids,priority:note.priority||null,note,...extra});
 for(const captureId of new Set(refundObservations.map(r=>r.capture_id))){
  for(const group of selectCaptureRefunds(refundObservations,captureId,orderId)){
   const history=chronological(group.history),read=group.read;
   const delivery=history.filter(isDeliveryObservation);
   const lines=history.map(r=>basis(r)+' at '+stamp(r)+' reports '+(r.status||'status not supplied')+' / '+money(r.amount)+
    (r.type?(isEventRead(r)?' in event read ':isDeliveryObservation(r)?' in delivery observation ':' in event observation ')+r.id+(r.event_id?' (reported event '+r.event_id+')':''):' in observation '+r.id)+'.');
   const capture=rows.find(c=>c.id===captureId);
   if(capture?.api_status)lines.push('Capture '+captureId+' / '+money(capture.amount)+': '+(packet.order?.imported?'Shared order claim, not locally revalidated':'Saved order observation')+' reports '+capture.api_status+'.');
   const captureReads=snapshots.filter(r=>r.resource_kind==='capture'&&r.capture_id===captureId);
   for(const r of chronological(captureReads))lines.push(basis(r)+' at '+stamp(r)+' reports capture '+captureId+' '+r.status+' / '+money(r.amount)+'.');
   if(delivery.length>1)lines.push(delivery.length+' delivery observations name refund '+read.refund_id+'. They are observations of that identity, not amounts to add. Reported event identities: '+unique(delivery.map(r=>r.event_id||r.id)).join(', ')+'.');
   lines.push(...refundEvidenceLimits);
   lines.push('Refund '+read.refund_id+' is associated with '+(captureId?'capture '+captureId:'no retained capture reference')+'. Repeated observations are not additional refunds. These records do not establish current available funds or a complete refund history.');
   const qualifier=read.sample?'Authored example · ':read.source==='imported_packet'?'Shared claim · ':!hasEventAuthority(read)&&read.source!=='sandbox_refund_api'?'Unverified claim · ':'';
   add('R'+result.length,'refund',read.refund_id,[read.refund_id,captureId,...references(history)],{
    level:'caution',kind:'refund_evidence',resource_id:read.refund_id,title:'Refund '+read.refund_id,
    history_summary:[!captureId?'Capture association is not recorded.':null,history.length>1?'1 refund · '+history.length+' observations. Repeated observations are not additional refunds.':null].filter(Boolean).join(' ')||null,
    observations:history.map(r=>({id:r.id,label:'Refund',status:r.status||'Status unavailable',amount:money(r.amount)})),
    answer:qualifier+'Refund '+money(read.amount)+' · '+(read.status||'Status unavailable'),
    detail:lines.join('\n'),ids:ids([...history,...captureReads])
   },{capture_id:captureId,amount:unique(history.map(r=>r.amount?.currency+' '+r.amount?.value)).length===1?read.amount:null,observed_statuses:unique(history.map(r=>r.status)),status_observations:history.map(r=>statusObservation(r,r.type?'event':'refund_read',r.status,r.amount)),observation_count:history.length,delivery_count:delivery.length,delivery_groups:retainedDeliveryGroups(delivery)});
  }
 }
 for(const captureId of captureIds){
  const row=rows.find(r=>r.id===captureId);
  const observations=snapshots.filter(r=>(r.captures||[]).some(c=>c.id===captureId));
  const relatedEvents=events.filter(e=>e.type==='PAYMENT.CAPTURE.REFUNDED'?e.capture_id===captureId:e.resource_id===captureId);
  const relatedRefunds=refundReads.filter(r=>r.capture_id===captureId);
  const lines=[];
  for(const r of chronological(observations)){
   const c=r.captures.find(c=>c.id===captureId);
   lines.push(basis(r)+' '+(r.resource_kind==='capture'?'capture':'order')+' observation at '+stamp(r)+' reports '+c.status+' / '+money(c.amount||r.amount)+'.'+(r.reported_read_id?' Original source '+r.reported_read_id+'.':''));
  }
  if(row?.api_status&&!observations.some(r=>r.resource_kind!=='capture'&&r.captures.some(c=>c.id===captureId&&c.status===row.api_status)))
   lines.push((packet.order?.imported?'Shared order claim, not locally revalidated':packet.order?.sample?'Authored order example':'Saved order observation')+' reports '+row.api_status+' / '+money(row.amount)+'.');
  for(const e of chronological(relatedEvents))lines.push(basis(e)+' at '+stamp(e)+' records '+e.type+(e.type==='PAYMENT.CAPTURE.REFUNDED'?' for refund '+e.resource_id+' / '+money(e.refund_amount):'')+'; source '+e.id+'.');
  for(const r of chronological(relatedRefunds))lines.push(basis(r)+' at '+stamp(r)+' reports refund '+r.refund_id+' '+r.status+' / '+money(r.amount)+'.');
  lines.push('These observations describe capture '+captureId+'. Completion for another capture does not establish completion of this capture. Compare the dated sources and refresh this exact capture before treating a saved state as current funds.');
  const sources=[...observations,...relatedEvents,...relatedRefunds];
  const completionEvents=relatedEvents.filter(e=>e.type==='PAYMENT.CAPTURE.COMPLETED');
  const completionRecords=completionEvents.map(e=>({id:e.id,time:e.occurred})).filter(r=>r.time);
  const completionObservations=[...observations.filter(r=>r.captures.some(c=>c.id===captureId&&c.status==='COMPLETED')).map(r=>({id:r.id,time:time(r)})),...completionEvents.map(e=>({id:e.id,time:isEventRead(e)?e.provider_observed_at||e.reported_provider_observed_at:e.received||e.occurred}))].filter(r=>r.time);
  add('C'+result.length,'capture',captureId,[captureId,...references(sources)],{
   level:'info',kind:'capture_observations',resource_id:captureId,title:'Capture '+captureId,
   observations:chronological([...observations,...relatedEvents]).map(r=>{const c=r.captures?.find(c=>c.id===captureId);return {id:r.id,label:r.type==='PAYMENT.CAPTURE.REFUNDED'?'Refund':r.type?'Event':r.resource_kind==='capture'?'Capture read':'Order read',status:c?.status||r.refund_status||r.type?.split('.').at(-1)||r.status||'Status unavailable',amount:money(c?.amount||r.refund_amount||r.capture_amount||r.amount)};}),
   answer:(packet.order?.imported?'Shared observations · ':'')+(row?.amount_difference?'Capture amounts differ':money(row?.amount||observations.at(-1)?.amount)),
   detail:lines.join('\n'),ids:ids(sources)
  },{amount:row?.amount_difference?null:row?.amount,observed_statuses:unique([...observations.map(r=>r.captures.find(c=>c.id===captureId)?.status),...relatedEvents.filter(e=>e.type!=='PAYMENT.CAPTURE.REFUNDED').map(e=>e.type.split('.').at(-1))]),status_observations:[...observations.map(r=>{const c=r.captures.find(c=>c.id===captureId);return statusObservation(r,r.resource_kind==='capture'?'capture_read':'order_read',c.status,c.amount||r.amount);}),...relatedEvents.filter(e=>e.type!=='PAYMENT.CAPTURE.REFUNDED').map(e=>statusObservation(e,'event',e.type.split('.').at(-1),e.capture_amount||e.amount))],completion_records:completionRecords,completion_observations:completionObservations,completion_times:completionRecords.map(r=>r.time),completion_observation_times:completionObservations.map(r=>r.time)});

  const orderScope=observations.filter(r=>r.resource_kind!=='capture'&&r.status==='COMPLETED');
  const captureScope=observations.filter(r=>r.resource_kind==='capture'&&r.capture_id===captureId&&r.status==='PARTIALLY_REFUNDED');
  result.at(-1).order_capture_scope={order_id:orderId,order_reads:orderScope.map(r=>({id:r.id,description:basis(r)+' at '+stamp(r)+' reports order '+orderId+' COMPLETED.'})),capture_reads:captureScope.map(r=>({id:r.id,description:basis(r)+' at '+stamp(r)+' reports capture '+captureId+' PARTIALLY_REFUNDED / '+money(r.amount)+'.'}))};

 }
 const verification=(observations,scope=null)=>{
  const verified=observations.filter(e=>e.verified&&!e.sample&&e.source!=='imported_packet'&&!isProviderRead(e));
  const lines=observations.map(e=>e.id+' / '+(e.type==='PAYMENT.CAPTURE.REFUNDED'?e.capture_id:e.resource_id)+': '+
   (e.source==='imported_packet'?(e.reported_verified?'Reported verified by the sender; ':'')+'not signature-verified in this workspace':isProviderRead(e)?'Provider API observation; not proof of delivery or signature verification':e.sample?'Authored example; no verified delivery':e.verified?'Signature verified in this workspace':'No verified signature retained')+'.');
  add('V'+result.length,'verification',scope,[...references(observations),scope].filter(Boolean),{
   level:'caution',kind:'signature_observations',title:scope?'Delivery signatures for '+scope:'Delivery signature evidence',
   answer:observations.length?verified.length+' of '+observations.length+' event observations have a locally verified signature':'No event observations are retained for this resource',
   detail:lines.join('\n')+'\nShared claims and provider event reads do not establish locally verified webhook delivery.',ids:ids(observations)
  },{verification_scope:scope});
 };
 if(events.length)verification(events);
 for(const captureId of captureIds)verification(events.filter(e=>e.type==='PAYMENT.CAPTURE.REFUNDED'?e.capture_id===captureId:e.resource_id===captureId),captureId);
 for(const refundId of unique(refundObservations.map(r=>r.refund_id)))verification(events.filter(e=>e.type==='PAYMENT.CAPTURE.REFUNDED'&&e.resource_id===refundId),refundId);

 return [...result,...orderReadFindingCatalog(packet)];
}

export function orderReadFindingCatalog(packet){
 const orderId=packet.order_id||packet.order?.id;
 const reads=(packet.snapshots||[]).filter(r=>r.order_id===orderId&&r.resource_kind!=='capture'&&r.id);
 if(!orderId||!reads.length)return [];
 const observations=chronological(reads),sourceIds=ids(observations);
 const detail=observations.map(r=>basis(r)+' at '+stamp(r)+' reports order '+orderId+' '+(r.status||'status not supplied')+'.').join('\n');
 return [{id:'ORDER-READS-'+orderId,kind:'finding',resource_type:'order',resource_id:orderId,
  references:unique([orderId,...references(observations)]),source_kind:'order_observations',title:'Order '+orderId,text:detail,source_ids:sourceIds,
  amount:null,observed_statuses:unique(observations.map(r=>r.status)),status_observations:observations.map(r=>statusObservation(r,'order_read',r.status,null)),
  note:{level:'info',kind:'order_observations',resource_id:orderId,title:'Order '+orderId,answer:'Retained order observations',detail,
   observations:observations.map(r=>({id:r.id,label:'Order read',status:r.status||'Status unavailable',amount:'Order amount unavailable'})),ids:sourceIds}
 }];
}

export const orderCaptureScopeCopy=Object.freeze({
 title:'Order and capture statuses have different scopes',
 explanation:Object.freeze(['Order COMPLETED describes completion of the order intent and creation of a payment resource; it does not mean every capture remains unrefunded.','Capture PARTIALLY_REFUNDED describes a refund smaller than that capture amount. These statuses concern different resources, so they can coexist.']),
 limits:'These are retained observations, not a fresh provider check. The records do not establish why the refund amount was chosen or when the buyer received or could use the money.'
});
export function orderCaptureScopeFindings(resources){
 return resources.filter(f=>f.order_capture_scope?.order_reads.length&&f.order_capture_scope?.capture_reads.length).map(f=>{
  const scope=f.order_capture_scope,sources=[...scope.order_reads,...scope.capture_reads];
  const text=[...orderCaptureScopeCopy.explanation,...sources.map(r=>r.description),orderCaptureScopeCopy.limits].join('\n');
  const note={level:'info',kind:'order_capture_scope',title:orderCaptureScopeCopy.title,answer:'Order COMPLETED can coexist with capture PARTIALLY_REFUNDED',detail:text,ids:sources.map(r=>r.id)};
  return {id:'SCOPE-'+f.resource_id,kind:'finding',resource_type:'status_scope',resource_id:f.resource_id,title:note.title,text,note,source_ids:note.ids};
 });
}

// Offer a clock only from a retained source; choosing it is an explicit
// refinement, never an inferred interpretation of an unanchored "later".
export function retainedTimeBoundaries(resources,direction='later'){
 if(!['later','earlier'].includes(direction))return [];
 const choices=new Map(),clocks=new Map(),conflicts=new Set();
 for(const resource of resources)for(const observation of resource.status_observations||[]){
  if(!observation.source_id)continue;const stamp=observation.kind==='event'?observation.occurred_at:observation.observed_at,time=Date.parse(stamp),signature=observation.kind+':'+(Number.isFinite(time)?new Date(time).toISOString():'unavailable');
  if(clocks.has(observation.source_id)&&clocks.get(observation.source_id)!==signature)conflicts.add(observation.source_id);else clocks.set(observation.source_id,signature);
 }
 for(const resource of resources){
  const targets=resource.matching_observations||[];
  for(const observation of resource.status_observations||[]){
   const clock=observation.kind==='event'?'occurred_at':'observed_at',stamp=observation[clock],time=Date.parse(stamp);
   if(!observation.source_id||conflicts.has(observation.source_id)||!stamp||!Number.isFinite(time))continue;
   const relevant=targets.some(target=>{const targetTime=Date.parse(target.kind==='event'?target.occurred_at:target.observed_at);return target.source_id!==observation.source_id&&Number.isFinite(targetTime)&&(direction==='earlier'?targetTime<time:targetTime>time);});
   if(!relevant)continue;
   const previous=choices.get(observation.source_id);
   if(previous){
    if(previous.stamp!==new Date(time).toISOString()||previous.kind!==observation.kind){previous.conflicting=true;continue;}
    if(!previous.resource_ids.includes(resource.resource_id))previous.resource_ids.push(resource.resource_id);
   }else choices.set(observation.source_id,{source_id:observation.source_id,kind:observation.kind,stamp:new Date(time).toISOString(),clock:clock==='occurred_at'?'occurrence':'observation',source:observation.source,sample:observation.sample,resource_ids:[resource.resource_id]});
  }
 }
 return [...choices.values()].filter(choice=>!choice.conflicting).sort((a,b)=>a.stamp.localeCompare(b.stamp)||a.source_id.localeCompare(b.source_id));
}
