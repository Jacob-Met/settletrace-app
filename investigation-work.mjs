import {createHash} from 'node:crypto';

// Local work organization never changes payment evidence or travels in packets.
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const orderValue=order=>order?[order.status,order.units,!!order.sample,!!order.imported]:null;
// Format-two archives cannot reconstruct omitted receipt/source details.
// Preserve their comparison until the operator archives the case again.
const previousEventValue=e=>[e.id,e.type,e.resource_id,e.capture_id,e.refund_amount,e.refund_status,
 e.occurred,!!e.verified,!!e.sample,e.source,e.transmission_id,e.error];
const eventValue=e=>[...previousEventValue(e),e.received,e.event_id,e.capture_amount,e.reported_source,e.provider_observed_at,e.reported_provider_observed_at,e.reported_verified];
const readValue=r=>[r.resource_kind,r.capture_id,r.status,r.source,r.reported_source,r.requested_at,r.reported_requested_at,r.observed_at,r.amount,r.created,r.updated,r.captures];
const sorted=rows=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function investigationIds(state) {
 return [...new Set([...state.orders.map(o=>o.id), ...state.events.map(e=>e.order_id).filter(Boolean), ...state.snapshots.filter(r=>r.resource_kind==='capture').map(r=>r.order_id).filter(Boolean)])];
}
function versionFor(state,id,value) {
 return hash([orderValue(state.orders.find(o=>o.id===id)),
  sorted(state.events.filter(e=>e.order_id===id).map(value)),
  sorted(state.snapshots.filter(r=>r.order_id===id).map(readValue)),...(state.dispute_observations?.some(r=>r.order_id===id)?[state.dispute_observations.filter(r=>r.order_id===id)]:[]),...(state.refund_observations?.some(r=>r.order_id===id)?[state.refund_observations.filter(r=>r.order_id===id)]:[])]);
}
export const evidenceVersion=(state,id)=>versionFor(state,id,eventValue);
function evidenceBaseline(state,id) {
 return {version:2,order:hash(orderValue(state.orders.find(o=>o.id===id))),
  refunds:Object.fromEntries((state.refund_observations??[]).filter(r=>r.order_id===id&&r.id).map(r=>[r.id,hash(r)])),
  disputes:Object.fromEntries((state.dispute_observations??[]).filter(r=>r.order_id===id&&r.id).map(r=>[r.id,hash(r)])),
  events:Object.fromEntries(state.events.filter(e=>e.order_id===id&&e.id).map(e=>[e.id,hash(eventValue(e))])),
  reads:Object.fromEntries(state.snapshots.filter(r=>r.order_id===id&&r.id).map(r=>[r.id,hash(readValue(r))]))};
}
function changedSources(state,id,baseline) {
 if(![1,2].includes(baseline?.version)||!baseline.events||!baseline.reads)return null;
 const current=evidenceBaseline(state,id),records=[];
 for(const event of state.events.filter(e=>e.order_id===id&&e.id).reverse()){
  if(baseline.events[event.id]===(baseline.version===1?hash(previousEventValue(event)):current.events[event.id]))continue;
  records.push({kind:'webhook',id:event.id,change:Object.hasOwn(baseline.events,event.id)?'changed':'added',
   label:event.type,reference:event.capture_id||event.resource_id||event.event_id||event.id,
   receipt:event.source!=='sandbox_event_api'&&!(event.source==='imported_packet'&&event.reported_source==='sandbox_event_api')&&(event.verified===true||event.source==='webhook'||event.source==='imported_packet'&&event.reported_source==='webhook')?{at:event.received??null,shared:event.source==='imported_packet'}:null});
 }
 for(const read of state.snapshots.filter(r=>r.order_id===id&&r.id).reverse()){
  if(baseline.reads[read.id]===current.reads[read.id])continue;
  records.push({kind:read.resource_kind==='capture'?'capture_read':'order_read',id:read.id,change:Object.hasOwn(baseline.reads,read.id)?'changed':'added',
   label:(read.resource_kind==='capture'?'Capture read':'Order read')+' · '+read.status,reference:read.resource_kind==='capture'?read.capture_id:read.observed_at||'Observation time unknown'});
 }
 for(const r of (state.dispute_observations??[]).filter(r=>r.order_id===id&&r.id).reverse()){
  if(baseline.disputes?.[r.id]===current.disputes[r.id])continue;
  records.push({kind:'dispute_read',id:r.id,change:Object.hasOwn(baseline.disputes??{},r.id)?'changed':'added',label:'Dispute read · '+r.status,reference:r.dispute_id});
 }
 // Older baselines did not record refund reads. Keep their fallback truthful
 // rather than presenting all existing refunds as newly added.
 if(baseline.refunds)for(const r of (state.refund_observations??[]).filter(r=>r.order_id===id&&r.id).reverse()){
  if(baseline.refunds[r.id]===current.refunds[r.id])continue;
  records.push({kind:'refund_read',id:r.id,change:Object.hasOwn(baseline.refunds,r.id)?'changed':'added',label:'Refund read · '+r.status,reference:r.refund_id});
 }
 const removed=Object.keys(baseline.events).filter(key=>!Object.hasOwn(current.events,key)).length+
  Object.keys(baseline.reads).filter(key=>!Object.hasOwn(current.reads,key)).length+Object.keys(baseline.disputes??{}).filter(key=>!Object.hasOwn(current.disputes,key)).length+
  Object.keys(baseline.refunds??{}).filter(key=>!Object.hasOwn(current.refunds,key)).length;
 return {records,removed,order_changed:baseline.order!==current.order};
}
// Older releases hashed order reads before capture/request metadata existed.
// Accept that exact format only for untouched legacy records; new metadata must
// still reopen the case rather than disappearing from the comparison.
function matchesLegacyArchive(state,id,saved) {
 if((state.dispute_observations??[]).some(r=>r.order_id===id)||saved?.evidence_baseline||saved?.evidence_version_format||(state.refund_observations??[]).some(r=>r.order_id===id))return false;
 const reads=state.snapshots.filter(r=>r.order_id===id);
 if(reads.some(r=>r.resource_kind||r.capture_id||r.requested_at||r.reported_requested_at||r.amount||r.created||r.updated))return false;
 return saved?.evidence_version===hash([orderValue(state.orders.find(o=>o.id===id)),
  sorted(state.events.filter(e=>e.order_id===id).map(previousEventValue)),
  sorted(reads.map(r=>[r.status,r.source,r.reported_source,r.observed_at,r.captures]))]);
}
export function investigationWork(state) {
 return Object.fromEntries(investigationIds(state).map(id=>{
  const version=evidenceVersion(state,id), saved=state.investigation_work?.[id];
  const archived=!!saved?.archived_at&&(saved.evidence_version===version||(saved.evidence_version_format===2&&saved.evidence_version===versionFor(state,id,previousEventValue))||matchesLegacyArchive(state,id,saved));
  const newEvidence=!!saved?.archived_at&&!archived;
  return [id,{evidence_version:version,archived,archived_at:saved?.archived_at??null,
   ...(typeof saved?.name==='string'&&saved.name?{name:saved.name}:{}),new_evidence:newEvidence,changed_sources:newEvidence?changedSources(state,id,saved.evidence_baseline):null}];
 }));
}
export function setInvestigationArchive(state,{order_id:id,archived,evidence_version:version}) {
 if(typeof archived!=='boolean')throw Object.assign(Error('Choose archive or reopen'),{status:400});
 if(!investigationIds(state).includes(id))throw Object.assign(Error('Investigation not found'),{status:404});
 if(archived&&version!==evidenceVersion(state,id))
  throw Object.assign(Error('Evidence changed. Refresh and review the new evidence before archiving.'),{status:409});
 const work={...state.investigation_work};
 if(archived)work[id]={...(work[id]?.name?{name:work[id].name}:{}),archived_at:new Date().toISOString(),evidence_version:version,evidence_version_format:3,evidence_baseline:evidenceBaseline(state,id)};
 else if(work[id]?.name)work[id]={name:work[id].name};else delete work[id];
 return {...state,investigation_work:work};
}

export function setInvestigationName(state,{order_id:id,name}) {
 if(!investigationIds(state).includes(id))throw Object.assign(Error('Investigation not found'),{status:404});
 if(typeof name!=='string'||name.trim().length>100||/[\x00-\x1f\x7f]/.test(name))throw Object.assign(Error('Use a local name of up to 100 characters on one line.'),{status:400});
 const work={...state.investigation_work},saved={...work[id]};
 if(name.trim())saved.name=name.trim();else delete saved.name;
 if(Object.keys(saved).length)work[id]=saved;else delete work[id];
 return {...state,investigation_work:work};
}
