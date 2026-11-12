import {addInvestigationNote,admitNotes,mergeNotes,exportNotes} from './investigation-notes.mjs';
import {exactPaymentFindings} from './payment-findings.mjs';
import {disputeCaptureIds,normalizeDispute,admitDisputes,disputeKey,disputeFindings} from './dispute-evidence.mjs';
import {operatorOriginAllowed} from './operator-origin.mjs';
import {starterCase as makeStarterCase} from './starter-case.mjs';
import {investigationWork,setInvestigationArchive,setInvestigationName} from './investigation-work.mjs';
import {createPayPalTransport} from './paypal-transport.mjs';
import {captureAmountConflicts} from './capture-amount.mjs';
import http from 'node:http';
import {compareOrderReads,readChangeNote} from './web/read-comparison.mjs';
import {normalizeCaptureRead,captureRelatedOrderId} from './paypal-resources.mjs';
import {reviewCaptureReads} from './capture-read-review.mjs';
import {retainOrderRead,overlappingReadFinding} from './order-observations.mjs';
import {readWebhookSetup} from './webhook-setup.mjs';
import {isProviderRead,hasEventAuthority} from './web/event-origin.mjs';
import {supportedChecks,applyTriageOrder} from './triage.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const ORDER=/^[A-Z0-9-]{6,64}$/i;
const SANDBOX='https://api-m.sandbox.paypal.com';
// Match the existing shared snapshot bound without silently losing captures.
const MAX_ORDER_CAPTURES=512;
// PayPal names v2 capture failure DECLINED, while v1 uses DENIED.
// https://developer.paypal.com/api/rest/webhooks/event-names/
const captureFailure=e=>e.type==='PAYMENT.CAPTURE.DECLINED'||e.type==='PAYMENT.CAPTURE.DENIED';
const clean=(v,n=120)=>String(v??'').replace(/[<>\x00-\x1f]/g,'').slice(0,n);
const date=v=>{if(v===null||v===undefined||v==='')return null;let d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();};
const money=a=>a?{currency:clean(a.currency_code,3),value:clean(a.value,32)}:null;
const refundEvent=e=>e.type==='PAYMENT.CAPTURE.REFUNDED';
const refundedStatus=s=>s==='REFUNDED'||s==='PARTIALLY_REFUNDED';
// The refund resource has its own ID. Its PayPal "up" relation identifies
// the captured payment; never use the refund ID as a capture ID.
function refundCapture(resource){
 const ids=new Set();
 const related=resource?.supplementary_data?.related_ids?.capture_id;
 if(ORDER.test(related??''))ids.add(related);
 for(const link of resource?.links??[]){
  if(link.rel!=='up'||(link.method&&link.method!=='GET'))continue;
  try{const u=new URL(link.href),m=u.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9-]{6,64})$/i);
   if(u.protocol==='https:'&&['api.paypal.com','api-m.paypal.com','api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&m)ids.add(m[1]);
  }catch{}
 }
 return ids.size===1?[...ids][0]:null;
}
export function captureReference(event){
 const id=refundEvent(event)?event.capture_id:event.type?.startsWith('PAYMENT.CAPTURE.')?event.resource_id:null;
 return ORDER.test(id??'')?id:null;
}
export function associateCaptureEvent(event,orders=[]){
 const captureId=captureReference(event);
 if(event.sample||event.order_id||!captureId)return event;
 const matches=orders.filter(o=>!o.sample&&!o.imported&&o.units.some(u=>u.captures.some(c=>c.id===captureId)));
 return matches.length===1?{...event,order_id:matches[0].id,association:'capture_in_order_snapshot'}:event;
}

export const associateRefund=associateCaptureEvent;

export function normalizeRefund(raw,requestedId,requestedAt=null) {
 if(!raw||raw.id!==requestedId||!ORDER.test(raw.id)||typeof raw.status!=='string')throw Object.assign(Error('Returned refund record invalid or ID mismatch'),{status:502});
 return {id:'REFUNDREAD-'+randomUUID(),refund_id:raw.id,capture_id:refundCapture(raw),order_id:null,status:clean(raw.status,40),amount:money(raw.amount),total_refunded_amount:money(raw.seller_payable_breakdown?.total_refunded_amount),requested_at:date(requestedAt),updated:date(raw.update_time),observed_at:new Date().toISOString(),source:'sandbox_refund_api'};
}
function associateRefundRead(record,orders) {
 if(record.order_id||!record.capture_id)return record;
 const matches=orders.filter(o=>!o.sample&&!o.imported&&o.units.some(u=>u.captures.some(c=>c.id===record.capture_id)));
 return matches.length===1?{...record,order_id:matches[0].id}:record;
}
export function normalizeOrder(o) {
 if(!o||!ORDER.test(o.id??''))throw Error('Invalid PayPal order response');
 const units=o.purchase_units??[];
 if(!Array.isArray(units)||units.length>16||units.some(u=>!u||!Array.isArray(u.payments?.captures??[])))throw Object.assign(Error('PayPal order payment collection is invalid'),{status:502});
 if(units.reduce((count,u)=>count+(u.payments?.captures?.length??0),0)>MAX_ORDER_CAPTURES)throw Object.assign(Error('PayPal order exceeds the supported 512-capture investigation size. Saved evidence was not replaced.'),{status:422});
 return {id:clean(o.id,64),status:clean(o.status,40),updated:date(o.update_time),units:units.map(u=>({amount:money(u.amount),captures:(u.payments?.captures??[]).map(c=>({id:clean(c.id,64),status:clean(c.status,40),amount:money(c.amount)}))}))};
}
export function normalizeEvent(e,verified=false,sample=false,error=null,transmissionId=null) {
 if(!e||typeof e.id!=='string'||typeof e.event_type!=='string')throw Error('Invalid webhook event');
 let oid=e.resource?.supplementary_data?.related_ids?.order_id;
 if(!oid&&e.event_type.startsWith('CHECKOUT.ORDER.'))oid=e.resource?.id;
 return {id:clean(e.id,100),type:clean(e.event_type,100),order_id:ORDER.test(oid??'')?clean(oid,64):null,resource_id:clean(e.resource?.id,100),...(e.event_type?.startsWith('PAYMENT.CAPTURE.')&&e.event_type!=='PAYMENT.CAPTURE.REFUNDED'?{capture_amount:money(e.resource?.amount)}:{}),...(e.event_type==='PAYMENT.CAPTURE.REFUNDED'?{capture_id:refundCapture(e.resource),refund_amount:money(e.resource?.amount),refund_status:clean(e.resource?.status,40)}:{}),occurred:date(e.create_time),received:new Date().toISOString(),verified:!!verified,sample:!!sample,transmission_id:clean(transmissionId,120)||null,error:clean(error,180)||null};
}
// Official Notifications GET provides an event observation, not delivery headers.
// Keep a distinct observation ID so an API read cannot replace a received delivery.
export function normalizeProviderEvent(raw, requestedId) {
 if(raw?.id!==requestedId)throw Object.assign(Error('PayPal returned a different event ID; existing evidence is unchanged'),{status:502});
 const event=normalizeEvent(raw,false,false,null);
 if(!event.type||!event.resource_id)throw Object.assign(Error('PayPal returned an incomplete event; existing evidence is unchanged'),{status:502});
 // Capture payloads sometimes identify their order only through the documented
 // up relation. Read the identifier; never follow a URL supplied by the payload.
 if(!event.order_id&&event.type.startsWith('PAYMENT.CAPTURE.')&&event.type!=='PAYMENT.CAPTURE.REFUNDED'){
  const orderIds=new Set();
  for(const link of raw.resource?.links??[]){
   if(link.rel!=='up'||(link.method&&link.method!=='GET'))continue;
   try{const u=new URL(link.href),m=u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9-]{6,64})$/i);
    if(u.protocol==='https:'&&['api.paypal.com','api-m.paypal.com','api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&m)orderIds.add(m[1]);
   }catch{}
  }
  if(orderIds.size===1)event.order_id=[...orderIds][0];
 }
 return {...event,id:'EVENTREAD-'+randomUUID(),event_id:requestedId,source:'sandbox_event_api',provider_observed_at:new Date().toISOString(),received:null,transmission_id:null};
}
// Keep each capture attempt distinct, including event-only evidence.
// A shared packet is a CLAIM from another operator, not a new local PayPal
// observation. Reconstruct only our normalized fields; never trust uploaded
// verification flags, source labels, raw customer details or diagnoses.
export function admitSharedPacket(raw) {
 const malformed=()=>{throw Object.assign(Error('Incident packet structure or order association invalid'),{status:422});};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!('order' in raw)||(raw.order!==null&&typeof raw.order!=='object'))malformed();
 const o=raw.order,orderId=o?.id??raw.order_id;
 if(!ORDER.test(orderId??'')||!Array.isArray(raw.events)||!Array.isArray(raw.snapshots))malformed();
 if(o&&(!Array.isArray(o.units)||o.units.length>16))malformed();
 if(!o&&raw.snapshots.some(x=>x?.resource_kind!=='capture'))malformed();
 const amount=x=>x&&typeof x==='object'?{currency:clean(x.currency??x.currency_code,3),value:clean(x.value,32)}:null;
 const units=(o?.units??[]).map(u=>{
  if(!u||!Array.isArray(u.captures)||u.captures.length>MAX_ORDER_CAPTURES)malformed();
  return {amount:amount(u.amount),captures:u.captures.map(c=>{
   if(!c||!c.id||typeof c.id!=='string')malformed();
   return {id:clean(c.id,64),status:clean(c.status,40),amount:amount(c.amount)};
  })};
 });
 if(units.reduce((count,u)=>count+u.captures.length,0)>MAX_ORDER_CAPTURES)malformed();
 const now=new Date().toISOString(),order=o?{id:clean(orderId,64),status:clean(o.status,40),updated:date(o.updated),units,imported:true,sample:!!o.sample,imported_at:now,packet_generated:date(raw.generated)}:null;
 const events=raw.events.map(e=>{
  if(!e||typeof e.id!=='string'||!e.id||typeof e.type!=='string'||!e.type||e.order_id!==orderId)malformed();
  return {id:clean(e.id,100),type:clean(e.type,100),order_id:orderId,resource_id:clean(e.resource_id,100),...(e.type?.startsWith('PAYMENT.CAPTURE.')&&e.type!=='PAYMENT.CAPTURE.REFUNDED'?{capture_amount:amount(e.capture_amount)}:{}),...(e.type==='PAYMENT.CAPTURE.REFUNDED'?{capture_id:ORDER.test(e.capture_id??'')?clean(e.capture_id,64):null,refund_amount:amount(e.refund_amount),refund_status:clean(e.refund_status,40)}:{}),occurred:date(e.occurred),received:date(e.received),verified:false,reported_verified:!!(e.reported_verified||e.verified),sample:!!e.sample,source:'imported_packet',event_id:clean(e.event_id,100)||null,reported_source:clean(e.reported_source||e.source,80)||null,reported_provider_observed_at:date(e.reported_provider_observed_at||e.provider_observed_at),transmission_id:clean(e.transmission_id,120)||null,error:'Shared packet: signature not reverified on this machine',imported_at:now};
 });
 const snapshots=raw.snapshots.map(x=>{
  if(!x||x.order_id!==orderId||!Array.isArray(x.captures)||x.captures.length>MAX_ORDER_CAPTURES)malformed();
  const captureRead=x.resource_kind==='capture';
  if(captureRead&&(!/^[A-Za-z0-9-]{3,64}$/.test(x.capture_id??'')||x.captures.length!==1||x.captures[0]?.id!==x.capture_id))malformed();
  return {id:'IMPORTED-'+randomUUID(),order_id:orderId,status:clean(x.status,40),source:'imported_packet',reported_source:clean(x.reported_source||x.source,80),reported_read_id:clean(x.reported_read_id||x.id,100)||null,reported_requested_at:date(x.reported_requested_at||x.requested_at),reported_superseded_by:clean(x.reported_superseded_by||x.superseded_by,100)||null,observed_at:date(x.observed_at),imported_at:now,...(captureRead?{resource_kind:'capture',capture_id:clean(x.capture_id,64),amount:amount(x.amount),created:date(x.created),updated:date(x.updated),reported_association:clean(x.reported_association||x.association,80)||null}:{}),captures:x.captures.map(c=>{
   if(!c||typeof c.id!=='string')malformed();
   return {id:clean(c.id,64),status:clean(c.status,40),amount:amount(c.amount)};
  })};
 });
 // Some exported/hand-authored packets carry only the current normalized
 // order. Show that as an imported claim in the timeline rather than silently
 // omitting the order observation altogether.
 if(order&&!snapshots.length)snapshots.push({id:'IMPORTED-'+randomUUID(),order_id:order.id,status:order.status,source:'imported_packet',reported_source:'packet_order',observed_at:date(raw.generated),imported_at:now,captures:order.units.flatMap(u=>u.captures.map(c=>({id:c.id,status:c.status,amount:c.amount??null})))});
 const refund_observations=(raw.refund_observations??[]);
 if(!Array.isArray(refund_observations)||refund_observations.length>2000)malformed();
 const refunds=refund_observations.map(r=>{
  if(!r||r.order_id!==orderId||!ORDER.test(r.refund_id??'')||(r.capture_id&&!ORDER.test(r.capture_id)))malformed();
  return {id:'IMPORTED-REFUND-'+randomUUID(),reported_read_id:clean(r.reported_read_id||r.id,100)||null,refund_id:r.refund_id,capture_id:r.capture_id||null,order_id:orderId,status:clean(r.status,40),amount:amount(r.amount),total_refunded_amount:amount(r.total_refunded_amount),reported_requested_at:date(r.reported_requested_at||r.requested_at),updated:date(r.updated),observed_at:date(r.observed_at),source:'imported_packet',reported_source:clean(r.reported_source||r.source,80),imported_at:now};
 });
 return {operator_notes:admitNotes(raw.operator_notes,orderId),order,order_id:orderId,events,snapshots,refund_observations:refunds,dispute_observations:admitDisputes(raw.dispute_observations,orderId,order,snapshots)};
}
function baseCaptureEvidence(order, events=[], orderId=order?.id) {
 const rows=new Map();
 const row=id=>{if(!rows.has(id))rows.set(id,{id,api_status:null,amount:null,sample:false,events:[]});return rows.get(id);};
 for(const unit of order?.units??[])for(const capture of unit.captures??[]){
  if(!capture.id)continue;
  Object.assign(row(capture.id),{api_status:capture.status,api_source:order?.sample?'authored_sample':order?.imported?'imported_packet':'sandbox_api',api_observed_at:order?.inspected??null,api_read_id:order?.read_id??null,amount:capture.amount??null,sample:!!order?.sample});
 }
 for(const event of events){
  if(event.order_id!==orderId||!event.type.startsWith('PAYMENT.CAPTURE.')||!event.resource_id)continue;
  const captureId=refundEvent(event)?event.capture_id:event.resource_id;
  if(!captureId)continue;
  row(captureId).events.push({id:event.id,type:event.type,capture_amount:event.capture_amount??null,...(refundEvent(event)?{refund_id:event.resource_id,refund_amount:event.refund_amount??null,refund_status:event.refund_status||null}:{}),verified:!!event.verified&&!event.sample,sample:!!event.sample,source:event.source,event_id:event.event_id||null,provider_observed_at:event.provider_observed_at||null,occurred:event.occurred,received:event.received});
 }
 const conflictingCaptureIds=new Set(captureAmountConflicts(order,events,orderId).map(x=>x.capture_id));
 return [...rows.values()].map(r=>{
  const verified=r.events.filter(hasEventAuthority),completed=verified.some(e=>e.type==='PAYMENT.CAPTURE.COMPLETED');
  let assessment='No authoritative capture observation';
  if(r.sample||(!r.api_status&&r.events.length&&r.events.every(e=>e.sample)))assessment='Authored sample; no payment established';
  else if(!r.api_status&&r.events.length&&!verified.length)assessment='Unverified event; no authoritative capture observation';
  else if(r.api_status==='COMPLETED'&&completed)assessment='Completion corroborated for this capture';
  else if(r.api_status==='COMPLETED')assessment='API completed; matching verified completion absent';
  else if(completed&&!order)assessment=(verified.some(e=>e.type==='PAYMENT.CAPTURE.COMPLETED'&&isProviderRead(e))?'PayPal reports capture completion':'Signed event reports capture completion')+'; order capture not yet observed';
  else if(completed)assessment=(verified.some(e=>e.type==='PAYMENT.CAPTURE.COMPLETED'&&isProviderRead(e))?'PayPal event completion':'Verified completion')+' differs from current API observation';
  else if(r.api_status)assessment='API reports '+r.api_status+'; no completion established';
  if(!r.sample&&r.api_status==='COMPLETED'&&verified.some(captureFailure))assessment='Same capture has '+(verified.some(e=>e.type==='PAYMENT.CAPTURE.DECLINED')?'decline':'denial')+' and API completion; compare event timing';
  if(!r.sample&&refundedStatus(r.api_status))assessment='API reports '+r.api_status+'; original completion is historical';
  if(!r.sample&&verified.some(refundEvent))assessment=(verified.some(e=>refundEvent(e)&&isProviderRead(e))?'PayPal refund event observed':'Verified refund event received')+'; latest API status '+(r.api_status||'unknown')+'. Earlier completion is historical; inspect refund amount and current capture status';
  if(!r.sample&&verified.some(e=>e.type==='PAYMENT.CAPTURE.REVERSED'))assessment=(verified.some(e=>e.type==='PAYMENT.CAPTURE.REVERSED'&&isProviderRead(e))?'PayPal reports capture reversal':'Verified capture reversal')+'; earlier completion does not establish current funds. Refresh this capture in PayPal';
  if(conflictingCaptureIds.has(r.id))assessment=(assessment==='Completion corroborated for this capture'?'Completion reported':assessment)+'; same capture has conflicting amounts. Compare supported observations';
  if(order?.imported)assessment='Shared packet claims '+(r.api_status||'unknown capture status')+'; not locally revalidated';
  return {...r,assessment};
 });
}
export function captureEvidence(order,events=[],orderId=order?.id,snapshots=[]) {
 return reviewCaptureReads(baseCaptureEvidence(order,events,orderId),snapshots,orderId).rows;
}
export function reconcile(order,events=[],snapshots=[],orderId=order?.id,disputes=[],refundReads=[]) {
 const rank=n=>n.priority==='authoritative_observation'?0:n.level==='investigate'?1:n.level==='caution'?2:n.level==='info'?3:4;
 const result=()=>({notes:notes.sort((a,b)=>rank(a)-rank(b)),actions});
 const notes=reviewCaptureReads(baseCaptureEvidence(order,events,orderId),snapshots,orderId).notes,actions=[],e=events.filter(x=>x.order_id===orderId),trusted=e.filter(hasEventAuthority),untrusted=e.filter(x=>!hasEventAuthority(x));
 if(notes.some(n=>n.kind==='capture_amount'&&n.level==='investigate'))actions.push('Re-read this exact capture and the order before quoting a reconciled gross amount; do not initiate another charge from conflicting observations.');
 const disputeReview=disputeFindings(disputes,orderId);notes.push(...disputeReview.notes);actions.push(...disputeReview.actions);
 const overlap=overlappingReadFinding(order,snapshots);if(overlap)notes.push(overlap);
 const reportedReversals=untrusted.filter(x=>x.type==='PAYMENT.CAPTURE.REVERSED'&&!x.sample);
 if(reportedReversals.length){
  notes.push({level:'caution',title:'Unverified capture reversal report',detail:'Unverified evidence reports a reversal for capture '+[...new Set(reportedReversals.map(x=>x.resource_id||'(missing ID)'))].slice(0,4).join(', ')+'. This report does not establish current payment state. Check the original event and this exact capture in PayPal before accepting or dismissing the concern; other captures remain separate.',ids:reportedReversals.map(x=>x.id)});
  actions.push('Verify the reported reversal against the original PayPal event and exact capture; an imported or unsigned report is not payment authority.');
 }
 if(untrusted.length)notes.push({level:'caution',title:'Unverified event evidence',detail:String(untrusted.length)+' event(s) cannot establish a payment state. Inspect signature verification and subscription.',ids:untrusted.map(x=>x.id)});
 const providerReads=e.filter(isProviderRead);
 if(providerReads.length)notes.push({level:'info',title:'PayPal event read is not delivery proof',detail:'These event records were read directly from PayPal Sandbox. An API read establishes what PayPal returned at the recorded time; it does not establish receipt by your application or verify a delivery signature.',ids:providerReads.map(x=>x.id)});
 if(order?.imported)notes.push({level:'caution',priority:'authoritative_observation',title:'Imported order is not a fresh Sandbox read',detail:'Order and capture statuses came from a shared file, not from a PayPal API read in this workspace. Re-read the order in Sandbox before accepting settlement evidence.',ids:[]});
 const reversals=trusted.filter(x=>x.type==='PAYMENT.CAPTURE.REVERSED');
 if(reversals.length){
  notes.push({level:'investigate',title:'Capture reversal evidence',detail:'PayPal reversal evidence references capture '+[...new Set(reversals.map(x=>x.resource_id||'(missing ID)'))].slice(0,4).join(', ')+'. Earlier completion does not establish current funds for these captures. Compare event occurrence times and refresh the exact capture; a reversal for another capture does not reverse every attempt on the order.',ids:reversals.map(x=>x.id)});
  actions.push('Inspect the reversed capture in PayPal and refresh the order before accepting a current payment conclusion.');
 }
 const exact=exactPaymentFindings(order,events,captureEvidence(order,events,orderId,snapshots),snapshots,refundReads,orderId);
 notes.push(...exact.notes);actions.push(...exact.actions);
 if(order?.imported){
  const claims=[...new Map(snapshots.filter(x=>x.order_id===orderId&&x.source==='imported_packet'&&x.resource_kind!=='capture').map(x=>[x.status,x])).values()];
  if(new Set([order.status,...claims.map(x=>x.status)]).size>1)notes.push({level:'investigate',title:'Imported observations report different order statuses',detail:'The displayed status '+order.status+' comes from the last opened packet. Imported observations report '+claims.slice(-6).map(x=>x.status+' at '+(x.observed_at||'unknown time')).join('; ')+'. These are unverified observations that may come from the same shared file. Different reported statuses do not establish a payment regression; arrival order and reported dates do not establish the current PayPal state. Re-read Sandbox before acting.',ids:claims.slice(-6).map(x=>x.id)});
 }
 if(!order){notes.push({level:'unknown',priority:'authoritative_observation',title:'No order observation',detail:'Inspect an order in PayPal Sandbox before deciding whether it settled.',ids:[]});actions.push('Fetch the authoritative Orders v2 snapshot.');return result();}
 const completed=trusted.filter(x=>x.type==='PAYMENT.CAPTURE.COMPLETED'),denied=trusted.filter(captureFailure),pending=trusted.filter(x=>x.type==='PAYMENT.CAPTURE.PENDING');
 const amountConflicts=captureAmountConflicts(order,events,orderId);
 for(const conflict of amountConflicts)notes.push({level:'investigate',title:'Same capture has conflicting amounts',detail:'Capture '+conflict.capture_id+' reports '+conflict.api.currency+' '+conflict.api.value+' in the order read and '+conflict.event.currency+' '+conflict.event.value+' in the event observation '+conflict.event_id+'. Compare the exact capture in PayPal and refresh the order before accepting a payment conclusion.',ids:[conflict.event_id]});
 if(amountConflicts.length)actions.push('Re-read the exact capture and compare currency and gross capture amount; do not infer payment or initiate another charge from this conflict.');
 const captures=order.units.flatMap(u=>u.captures),settled=captures.filter(x=>x.status==='COMPLETED');
 // Order association alone cannot corroborate a specific capture: one order
 // can contain distinct capture attempts with conflicting final states.
 const completedIds=new Set(completed.map(x=>x.resource_id).filter(Boolean));
 const settledIds=new Set(settled.map(x=>x.id).filter(Boolean));
 const historicalRefundIds=new Set(captures.filter(x=>refundedStatus(x.status)).map(x=>x.id));
 const unmatchedEvents=completed.filter(x=>!x.resource_id||(!settledIds.has(x.resource_id)&&!historicalRefundIds.has(x.resource_id)));
 const receivedCompletedIds=new Set(completed.filter(x=>x.verified&&!isProviderRead(x)).map(x=>x.resource_id).filter(Boolean));
 const withoutMatchingEvent=settled.filter(x=>!x.id||!receivedCompletedIds.has(x.id));
 if(historicalRefundIds.size)notes.push({level:'info',title:'Capture has a later refund status',detail:(order.imported?'Shared packet claims ':'Current order read reports ')+captures.filter(x=>refundedStatus(x.status)).map(x=>x.id+' '+x.status).join(', ')+'. Earlier completion events describe capture history, not current unrefunded funds.',ids:[]});
 if(unmatchedEvents.length){
  notes.push({level:'investigate',title:'Capture event differs from order read',detail:(unmatchedEvents.some(isProviderRead)?'PayPal event completion':'Verified completion')+' references capture '+unmatchedEvents.map(x=>x.resource_id||'(missing ID)').slice(0,4).join(', ')+' with no matching COMPLETED capture in the latest order snapshot. It may be another attempt or a timing gap; matching an order ID alone is insufficient.',ids:unmatchedEvents.map(x=>x.id)});
  actions.push('Re-fetch order and compare capture IDs before changing local paid state.');
 }
 if(withoutMatchingEvent.length){
  notes.push({level:'caution',title:'Completed capture without a verified delivery',detail:(order.imported?'Imported packet reports completed capture ':'Order read reports completed capture ')+withoutMatchingEvent.map(x=>x.id||'(missing ID)').slice(0,4).join(', ')+' without a matching verified completion event. A signed event for a different capture is not corroboration; absence of delivery records does not disprove payment.',ids:[]});
  actions.push('Inspect PayPal webhook delivery history for the exact capture IDs; never recapture an already completed payment.');
 }
 if(denied.length&&settled.length){
  const same=denied.filter(x=>x.resource_id&&settledIds.has(x.resource_id)),other=denied.filter(x=>!x.resource_id||!settledIds.has(x.resource_id));
  if(same.length){notes.push({level:'investigate',title:'Same capture has failure and completion',detail:'Capture '+[...new Set(same.map(x=>x.resource_id))].slice(0,4).join(', ')+' is '+(order.imported?'claimed COMPLETED by a shared packet':'COMPLETED in the latest order read')+' but has '+(same.some(isProviderRead)?'PayPal-observed ':'verified ')+[...new Set(same.map(x=>x.type.split('.').at(-1)))].join(' / ')+' event evidence. These are the same capture, not separate attempts. Compare event timing and refresh the authoritative read before accepting a current payment conclusion.',ids:same.map(x=>x.id)});actions.push('Re-fetch the order and compare the same capture failure/completion timestamps.');}
  if(other.length){notes.push({level:'investigate',title:'Different capture attempts have failure and completion',detail:(other.some(isProviderRead)?'PayPal event failure':'Verified failure')+' references capture '+other.map(x=>x.resource_id||'(missing ID)').slice(0,4).join(', ')+' while '+(order.imported?'the shared packet claims':'the order read reports')+' completed capture '+[...settledIds].slice(0,4).join(', ')+'. These do not establish a same-capture contradiction. Inspect each attempt independently.',ids:other.map(x=>x.id)});actions.push('Inspect each capture attempt independently.');}
 }
 if(pending.length&&!settled.length){notes.push({level:'caution',title:'Pending capture evidence',detail:'A pending capture does not establish settlement.',ids:pending.map(x=>x.id)});actions.push('Wait for a terminal verification or refresh order.');}
 const reads=snapshots.filter(x=>x.order_id===orderId && x.source==='sandbox_api'&&!x.superseded_by).sort((a,b)=>a.observed_at.localeCompare(b.observed_at));
 const changes=[];
 for(let i=1;i<reads.length;i++)if(reads[i].status!==reads[i-1].status)changes.push(reads[i-1].status+' → '+reads[i].status);
 if(changes.length)notes.push({level:'info',title:'Order status changed between API reads',detail:'Observed Sandbox order transitions: '+changes.slice(-4).join(' / ')+'. Previous reads do not represent the present state.',ids:reads.slice(-2).map(x=>x.id)});
 const readChange=readChangeNote(compareOrderReads(snapshots,orderId));if(readChange)notes.push(readChange);
 if(!notes.length)notes.push({level:'clear',title:'No contradiction among available records',detail:'Available records do not establish complete delivery.',ids:[]});
 return result();
}
async function body(req,limit=512*1024,{raw=false}={}){
 const bytes=await new Promise((resolve,reject)=>{
  let n=0,chunks=[],exceeded=false;
  // Keep consuming without buffering after refusal so the 413 response can
  // reach the client; breaking an async request iterator destroys its socket.
  req.on('data',chunk=>{if(exceeded)return;n+=chunk.length;if(n>limit){exceeded=true;chunks=[];reject(Object.assign(Error('Request too large'),{status:413}));}else chunks.push(chunk);});
  req.on('end',()=>{if(!exceeded)resolve(Buffer.concat(chunks));});
  req.on('error',reject);
 });
 try{const text=bytes.toString('utf8'),value=JSON.parse(text);return raw?{value,text}:value;}catch{throw Object.assign(Error('Expected JSON'),{status:400});}
}
function send(res,status,json){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(json));}
const observeOrder=(order,source)=>({id:'READ-'+randomUUID(),order_id:order.id,status:order.status,source,observed_at:new Date().toISOString(),captures:order.units.flatMap(u=>u.captures.map(c=>({id:c.id,status:c.status,amount:c.amount??null})))});
const observeCapture=(capture,orderId,association,observedAt=new Date().toISOString(),requestedAt=observedAt)=>({
 id:'CAPTURE-READ-'+randomUUID(),resource_kind:'capture',capture_id:capture.capture_id,order_id:orderId,
 status:capture.status,amount:capture.amount??null,created:capture.created??null,updated:capture.updated??null,
 source:'sandbox_capture_api',association,requested_at:requestedAt,observed_at:observedAt,
 captures:[{id:capture.capture_id,status:capture.status,amount:capture.amount??null}]
});
function knownCaptureAssociation(state,orderId,captureId){
 if(state.orders.some(o=>o.id===orderId&&!o.sample&&!o.imported&&o.units.some(u=>u.captures.some(c=>c.id===captureId))))return 'local_order_capture';
 if(state.events.some(e=>e.order_id===orderId&&hasEventAuthority(e)&&e.type.startsWith('PAYMENT.CAPTURE.')&&(refundEvent(e)?e.capture_id:e.resource_id)===captureId))return 'local_authoritative_event';
 return null;
}
const packet=(order,events,snapshots=[],orderId=order?.id,refund_observations=[],dispute_observations=[],operator_notes=[])=>({operator_notes,refund_observations,dispute_observations,generated:new Date().toISOString(),order_id:orderId,order:order??null,events,snapshots,captures:captureEvidence(order,events,orderId,snapshots),read_comparison:compareOrderReads(snapshots,orderId),diagnosis:reconcile(order,events,snapshots,orderId,dispute_observations,refund_observations),limits:['Sandbox only, not real money.','Event absence is not proof of delivery failure.','Model explanation is advisory.']});
export function resolveDataFile(env=process.env) {
 const directory=env.SETTLETRACE_DATA_DIR?.trim();
 return path.join(directory?path.resolve(directory):path.join(ROOT,'.settletrace'),'state.json');
}
// The journal is evidence storage, not a rolling cache. Retain earlier cases
// when admitting new observations; request size is bounded before admission.
export function createService({env=process.env,fetchImpl=fetch,dataFile=resolveDataFile(env),starterCase=false,demo=null}={}) {
 const readOnlyDemo=env.SETTLETRACE_DEMO_READ_ONLY==='1';
 if(readOnlyDemo&&['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','AI_BASE_URL','AI_MODEL','AI_API_KEY'].some(key=>env[key]))throw Error('Read-only demo must not have provider or model credentials/configuration');
 const acceptsOperatorOrigin=operatorOriginAllowed(env.SETTLETRACE_ORIGIN);
 const base=env.ALLOW_TEST_PAYPAL_BASE==='1'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.PAYPAL_BASE_URL??'')?env.PAYPAL_BASE_URL:SANDBOX;
 let chain=Promise.resolve();
 const orderReadSession=randomUUID();let orderReadSequence=0;
 const beginOrderRead=()=>({session:orderReadSession,sequence:++orderReadSequence,requested_at:new Date().toISOString()});
 let statePromise=fs.readFile(dataFile,'utf8').then(raw=>{
   const s=JSON.parse(raw);
   if(!Array.isArray(s.orders)||!Array.isArray(s.events))throw Error('Existing incident journal is invalid');
   return {...s,dispute_observations:Array.isArray(s.dispute_observations)?s.dispute_observations:[],refund_observations:Array.isArray(s.refund_observations)?s.refund_observations:[],sources:s.sources??{},snapshots:Array.isArray(s.snapshots)?s.snapshots:[]};
 }).catch(e=>{if(e.code==='ENOENT')return starterCase?makeStarterCase():{orders:[],events:[],snapshots:[],sources:{}};throw e;});
 function update(fn){const op=chain.then(async()=>{const state=fn(structuredClone(await statePromise));state.events=state.events.map(e=>associateCaptureEvent(e,state.orders));state.refund_observations=(state.refund_observations??[]).map(r=>associateRefundRead(r,state.orders));const temp=dataFile+'.'+randomUUID();await fs.mkdir(path.dirname(dataFile),{recursive:true});await fs.writeFile(temp,JSON.stringify(state,null,2),{mode:0o600});await fs.rename(temp,dataFile);statePromise=Promise.resolve(state);return state;});chain=op.catch(()=>{});return op;}
 const paypal=createPayPalTransport({env,base,fetchImpl});
 const eventPages=new Map(); // Short-lived provider continuation handles; never journal evidence.
 // PayPal postback requires the original JSON text without reserialization.
 // Older journals have only parsed JSON; preserve their existing retry behavior.
 const verificationPayload=(source)=>JSON.stringify({...source.headers,webhook_id:env.PAYPAL_WEBHOOK_ID}).slice(0,-1)+',"webhook_event":'+(source.raw_event??JSON.stringify(source.event))+'}';
 const completeHeaders=h=>['transmission_id','transmission_time','cert_url','auth_algo','transmission_sig'].every(k=>typeof h?.[k]==='string'&&h[k].length>0);
 async function route(req,res){
  const u=new URL(req.url,'http://localhost'),key=req.method+' '+u.pathname;
  if(demo&&await demo.handle(req,res,u.pathname))return;
  if(readOnlyDemo&&(req.method!=='GET'||(u.pathname.startsWith('/api/')&&!['/api/state','/api/packet'].includes(u.pathname)))){send(res,403,{error:'This demo is read-only. Run your own workspace to import evidence or contact providers.'});return;}
  if(req.method==='POST'&&!acceptsOperatorOrigin(req.headers.origin)){send(res,403,{error:'Cross-origin write denied'});return;}
  try {
   if(key==='POST /api/webhooks/check-setup'){await body(req);send(res,200,await readWebhookSetup(paypal,env.PAYPAL_WEBHOOK_ID));return;}
   if(key==='GET /api/state'){let s=await statePromise;const {sources,orderReadHeads,...publicState}=s;send(res,200,{...publicState,investigation_work:investigationWork(s),events:publicState.events.map(e=>({...e,source_available:!!sources[e.id],source_raw_available:typeof sources[e.id]?.raw_event==='string',source_headers_complete:completeHeaders(sources[e.id]?.headers)})),connected:!!(env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET),webhook_configured:!!env.PAYPAL_WEBHOOK_ID,ai_connected:!!(env.AI_BASE_URL&&env.AI_MODEL),sandbox:base===SANDBOX,read_only_demo:readOnlyDemo});return;}
   if(key==='POST /api/investigation/note'){const input=await body(req);await update(state=>addInvestigationNote(state,input));send(res,201,{saved:true});return;}
   if(key==='POST /api/investigation/name'){const input=await body(req);const s=await update(state=>setInvestigationName(state,input));send(res,200,{work:investigationWork(s)[input.order_id]});return;}
   if(key==='POST /api/investigation/archive'){
    const input=await body(req);const s=await update(state=>setInvestigationArchive(state,input));
    send(res,200,{work:investigationWork(s)[input.order_id]});return;
   }
   if(key==='POST /api/sample'){
    const o={...normalizeOrder({id:'SAMPLE-ORDER-105',status:'APPROVED',purchase_units:[{amount:{currency_code:'USD',value:'48.00'},payments:{captures:[]}}]}),sample:true};
    const e=normalizeEvent({id:'SAMPLE-EVENT-2',event_type:'PAYMENT.CAPTURE.COMPLETED',create_time:'2026-11-09T16:02:00Z',resource:{id:'SAMPLE-CAPTURE-7',supplementary_data:{related_ids:{order_id:o.id}}}},false,true,'Authored sample, not signed');
    await update(s=>({...s,orders:[...s.orders.filter(x=>x.id!==o.id),o],events:[...s.events.filter(x=>x.id!==e.id),e],snapshots:[...s.snapshots,observeOrder(o,'authored_sample')]}));
    send(res,200,{sample:true});return;
   }
   if(key==='POST /api/dispute/inspect'){
    const input=await body(req),id=String(input?.dispute_id??'').trim().toUpperCase(),orderId=String(input?.order_id??'').trim().toUpperCase();
    if(!ORDER.test(id)||(orderId&&!ORDER.test(orderId)))throw Object.assign(Error('Choose the exact dispute ID and, if known, its locally read order'),{status:400});
    const before=orderId?(await statePromise).orders.find(o=>o.id===orderId):null;
    if(orderId&&(!before||before.imported||before.sample))throw Object.assign(Error('Read this order from Sandbox before linking a dispute'),{status:409});
    const requestedAt=new Date().toISOString(),raw=await paypal('/v1/customer/disputes/'+encodeURIComponent(id)),observedAt=new Date().toISOString();
    const captureIds=disputeCaptureIds(raw,id);
    if(!orderId){
     const selectedCapture=String(input?.capture_id??'').trim();
     if(selectedCapture&&!captureIds.includes(selectedCapture))throw Object.assign(Error('The chosen capture is not listed in this PayPal dispute; no relationship has been guessed'),{status:409});
     if(!selectedCapture&&captureIds.length>1){send(res,200,{selection_required:true,dispute_id:id,capture_ids:captureIds});return;}
     const captureId=selectedCapture||captureIds[0],captureRequestedAt=new Date().toISOString();
     const rawCapture=await paypal('/v2/payments/captures/'+encodeURIComponent(captureId)),capture=normalizeCaptureRead(rawCapture,captureId),captureObservedAt=new Date().toISOString();
     const resolvedId=captureRelatedOrderId(rawCapture),request=beginOrderRead();
     const order=normalizeOrder(await paypal('/v2/checkout/orders/'+encodeURIComponent(resolvedId)));
     if(order.id!==resolvedId||!order.units.some(u=>u.captures.some(c=>c.id===captureId)))throw Object.assign(Error('Returned order does not contain the exact disputed capture; saved evidence is unchanged'),{status:502});
     const dispute=normalizeDispute(raw,id,order,requestedAt,observedAt),observation=observeCapture(capture,resolvedId,'fresh_order_capture',captureObservedAt,captureRequestedAt);
     let retained;
     await update(state=>{retained=retainOrderRead({...state,dispute_observations:[...(state.dispute_observations??[]),dispute],snapshots:[...state.snapshots,observation]},order,observeOrder(order,'sandbox_api'),request);return retained.state;});
     send(res,201,{dispute,order_id:resolvedId,capture_id:captureId,association:'dispute_capture_api_related_order',applied:retained.applied});return;
    }
    let saved;
    await update(s=>{saved=normalizeDispute(raw,id,s.orders.find(o=>o.id===orderId),requestedAt,observedAt);return {...s,dispute_observations:[...(s.dispute_observations??[]),saved]};});
    send(res,201,{dispute:saved,order_id:orderId});return;
   }
   if(key==='POST /api/refund/inspect'){
    const input=await body(req),id=String(input?.refund_id??'').trim().toUpperCase();
    if(!ORDER.test(id))throw Object.assign(Error('Refund ID format invalid'),{status:400});
    const requestedAt=new Date().toISOString();
    const refund=normalizeRefund(await paypal('/v2/payments/refunds/'+encodeURIComponent(id)),id,requestedAt);
    let saved;
    await update(s=>{saved=associateRefundRead(refund,s.orders);return {...s,refund_observations:[...(s.refund_observations??[]),saved]};});
    let resolution_error=null;
    if(input.resolve_order===true&&!saved.order_id&&saved.capture_id){
     try{
      const captureRequestedAt=new Date().toISOString(),capture=await paypal('/v2/payments/captures/'+encodeURIComponent(saved.capture_id)),captureObservedAt=new Date().toISOString();
      const normalized=normalizeCaptureRead(capture,saved.capture_id),orderId=captureRelatedOrderId(capture),request=beginOrderRead();
      const order=normalizeOrder(await paypal('/v2/checkout/orders/'+encodeURIComponent(orderId)));
      if(order.id!==orderId||!order.units.some(u=>u.captures.some(c=>c.id===saved.capture_id)))throw Object.assign(Error('Returned order does not contain the exact refund capture'),{status:502});
      const observation=observeCapture(normalized,orderId,'fresh_order_capture',captureObservedAt,captureRequestedAt);
      await update(state=>{const next=retainOrderRead({...state,snapshots:[...state.snapshots,observation]},order,observeOrder(order,'sandbox_api'),request).state;
       saved={...saved,order_id:orderId,association:'capture_api_related_order'};
       return {...next,refund_observations:next.refund_observations.map(r=>r.id===saved.id?saved:r)};
      });
     }catch(error){resolution_error=error.status?error.message:'Could not resolve the refund order; the refund observation is retained.';}
    }
    send(res,200,{refund:saved,observation:saved,order_id:saved.order_id,capture_id:saved.capture_id,resolution_error});return;
   }
   if(key==='POST /api/order/inspect'){
    const x=await body(req),id=String(x?.order_id??'').trim().toUpperCase();
    if(!ORDER.test(id))throw Object.assign(Error('Order ID format invalid'),{status:400});
    const request=beginOrderRead();
    const o=normalizeOrder(await paypal('/v2/checkout/orders/'+encodeURIComponent(id)));
    if(o.id!==id)throw Object.assign(Error('Returned order ID mismatch'),{status:502});
    let recorded;
    const observation=observeOrder(o,'sandbox_api');
    await update(s=>{recorded=retainOrderRead(s,o,observation,request);return recorded.state;});
    const {state:stored,...response}=recorded;send(res,200,response);return;
   }
   if(key==='POST /api/capture/inspect'){
    const input=await body(req),orderId=String(input?.order_id??'').trim().toUpperCase(),captureId=String(input?.capture_id??'').trim();
    if((orderId&&!ORDER.test(orderId))||!/^[A-Za-z0-9-]{3,64}$/.test(captureId))throw Object.assign(Error('Choose an exact capture ID and, if known, its order ID'),{status:400});
    const requestedAt=new Date().toISOString();
    const rawCapture=await paypal('/v2/payments/captures/'+encodeURIComponent(captureId)),capture=normalizeCaptureRead(rawCapture,captureId),observedAt=new Date().toISOString();
    if(!orderId){
     const resolvedId=captureRelatedOrderId(rawCapture),request=beginOrderRead();
     const order=normalizeOrder(await paypal('/v2/checkout/orders/'+encodeURIComponent(resolvedId)));
     if(order.id!==resolvedId||!order.units.some(u=>u.captures.some(c=>c.id===captureId)))throw Object.assign(Error('Returned order does not contain the exact capture; saved evidence is unchanged'),{status:502});
     const observation=observeCapture(capture,resolvedId,'fresh_order_capture',observedAt,requestedAt);
     let retained;
     await update(state=>{
      retained=retainOrderRead({...state,snapshots:[...state.snapshots,observation]},order,observeOrder(order,'sandbox_api'),request);
      return retained.state;
     });
     send(res,201,{observation,order_id:resolvedId,capture_id:captureId,association:'capture_api_related_order',applied:retained.applied,reason:retained.reason});return;
    }
    if(capture.order_id&&capture.order_id!==orderId)throw Object.assign(Error('PayPal associates this capture with a different order; this investigation is unchanged'),{status:409});
    let observation;
    await update(state=>{
     const association=capture.order_id===orderId?'provider_order_reference':knownCaptureAssociation(state,orderId,captureId);
     if(!association)throw Object.assign(Error('This capture read has no order reference. Read the order first to establish its exact capture association; no relationship has been guessed.'),{status:422});
     observation=observeCapture(capture,orderId,association,observedAt,requestedAt);
     return {...state,snapshots:[...state.snapshots,observation]};
    });
    send(res,201,{observation,order_id:orderId,capture_id:captureId});return;
   }
   if(key==='POST /api/refund/resolve'||key==='POST /api/event/resolve'){
    const input=await body(req),prior=(await statePromise).events.find(e=>e.id===input?.event_id);
    const captureId=prior&&captureReference(prior);
    if(!captureId)throw Object.assign(Error('Choose a retained capture event with an explicit capture ID'),{status:400});
    if(prior.order_id){send(res,200,{order_id:prior.order_id,already_associated:true});return;}
    const captureRequestedAt=new Date().toISOString();
    const capture=await paypal('/v2/payments/captures/'+encodeURIComponent(captureId));
    const captureObservedAt=new Date().toISOString();
    if(capture.id!==captureId)throw Object.assign(Error('Returned capture ID mismatch; event remains unresolved'),{status:502});
    const id=captureRelatedOrderId(capture),request=beginOrderRead(),order=normalizeOrder(await paypal('/v2/checkout/orders/'+encodeURIComponent(id)));
    if(order.id!==id||!order.units.some(u=>u.captures.some(c=>c.id===captureId)))throw Object.assign(Error('Returned order does not contain the exact capture; event remains unresolved'),{status:502});
    const captureObservation=typeof capture.status==='string'&&capture.status?observeCapture(normalizeCaptureRead(capture,captureId),id,'fresh_order_capture',captureObservedAt,captureRequestedAt):null;
    await update(state=>{
     const current=state.events.find(e=>e.id===prior.id);
     if(!current||captureReference(current)!==captureId||current.order_id)throw Object.assign(Error('Event evidence changed during lookup. Refresh before trying again.'),{status:409});
     const associated={...state,events:state.events.map(e=>e.id===prior.id?{...e,order_id:id,association:'capture_api_related_order'}:e),snapshots:[...state.snapshots,...(captureObservation?[captureObservation]:[])]};
     return retainOrderRead(associated,order,observeOrder(order,'sandbox_api'),request).state;
    });
    send(res,200,{order_id:id,capture_id:captureId});return;
   }
   if(key==='POST /api/webhooks/ingest'){
    const {value:e,text:rawEvent}=await body(req,undefined,{raw:true}),h=req.headers,headers={transmission_id:h['paypal-transmission-id'],transmission_time:h['paypal-transmission-time'],cert_url:h['paypal-cert-url'],auth_algo:h['paypal-auth-algo'],transmission_sig:h['paypal-transmission-sig']};
    const canVerify=!!env.PAYPAL_WEBHOOK_ID&&completeHeaders(headers);
    let verified=false,error=canVerify?'Verification pending; original delivery retained.':'Subscription ID or signature headers missing';
    let normalized=normalizeEvent(e,false,false,error,headers.transmission_id);
    const source={event:e,headers,raw_event:rawEvent};
    let retained=false,expectedSource,expectedCheck;
    const save=s=>{
      normalized=associateCaptureEvent(normalized,s.orders);
      const events=[...s.events.filter(x=>x.id!==normalized.id),normalized];
      const sources={...s.sources,[normalized.id]:source};
      for(const id of Object.keys(sources))if(!events.some(x=>x.id===id))delete sources[id];
      return {...s,events,sources};
    };
    // Persist the received source before contacting PayPal, so an outage or
    // process restart cannot remove the operator's only verification input.
    await update(s=>{
      const current=s.events.find(x=>x.id===normalized.id);
      if(current?.verified||(completeHeaders(s.sources?.[normalized.id]?.headers)&&!completeHeaders(headers))){
        retained=true;expectedSource=s.sources?.[normalized.id];expectedCheck=current?.verification_checked;return s;
      }
      expectedSource=source;expectedCheck=undefined;return save(s);
    });
    if(canVerify){
      try{const verdict=await paypal('/v1/notifications/verify-webhook-signature','POST',verificationPayload(source));verified=verdict.verification_status==='SUCCESS';error=verified?null:verdict.verification_status==='FAILURE'?'PayPal did not verify signature':'Verification unavailable: PayPal returned no verification verdict';}
      catch(err){error='Verification unavailable: '+clean(err.message,120);}
      normalized={...normalized,verified,error};
      await update(s=>{
        const current=s.events.find(x=>x.id===normalized.id);
        // A newer delivery or an explicit retry owns its own verdict.
        if(JSON.stringify(s.sources?.[normalized.id])!==JSON.stringify(expectedSource)||current?.verification_checked!==expectedCheck){retained=true;return s;}
        if(retained&&!verified)return s;
        retained=false;return save(s);
      });
    }
    send(res,202,{accepted:true,verified,event:normalized,retained_existing:retained});return;
   }
   if(key==='GET /api/events/recent'){
    // The real endpoint rejects fractional seconds; retain whole-second boundaries.
    const stamp=d=>d.toISOString().replace(/\.\d{3}Z$/,'Z');
    for(const [token,page] of eventPages)if(page.expires<Date.now())eventPages.delete(token);
    const cursor=u.searchParams.get('cursor');let page;
    if(cursor){page=eventPages.get(cursor);if(!page)throw Object.assign(Error('This event search expired. Find events again; saved investigations remain unchanged.'),{status:410});}
    else{
     const end=new Date(),start=new Date(end.getTime()-24*60*60*1000),start_time=stamp(start),end_time=stamp(end);
     page={uri:'/v1/notifications/webhooks-events?'+new URLSearchParams({page_size:'20',start_time,end_time}),start_time,end_time,seen:[]};
    }
    const raw=await paypal(page.uri);
    if(!Array.isArray(raw.events))throw Object.assign(Error('PayPal returned no usable event list. Retry the read.'),{status:502});
    const events=raw.events.slice(0,20).map(e=>({id:clean(e.id,100),type:clean(e.event_type,100),occurred:date(e.create_time),resource_id:clean(e.resource?.id,100)||null}));
    if(events.some(e=>!/^[A-Za-z0-9-]{6,100}$/.test(e.id)))throw Object.assign(Error('PayPal returned an event without a usable ID. Read a known event ID instead.'),{status:502});
    const next=(raw.links??[]).find(x=>x.rel==='next');let next_cursor=null;
    // Follow the provider's link, never a caller-supplied URL or guessed page number.
    if(next&&(!next.method||next.method==='GET'))try{
     const target=new URL(next.href),uri=target.pathname+target.search,seen=[...page.seen,page.uri];
     if(['https://api-m.sandbox.paypal.com','https://api.sandbox.paypal.com'].includes(target.origin)&&target.pathname==='/v1/notifications/webhooks-events'&&!target.username&&!target.password&&!target.hash&&!seen.includes(uri)){
      next_cursor=randomUUID();eventPages.set(next_cursor,{uri,start_time:page.start_time,end_time:page.end_time,seen,expires:Date.now()+15*60*1000});
      while(eventPages.size>200)eventPages.delete(eventPages.keys().next().value);
     }
    }catch{}
    send(res,200,{events,start_time:page.start_time,end_time:page.end_time,observed_at:new Date().toISOString(),more_available:raw.events.length>20||!!next,next_cursor,source:'sandbox_event_list'});return;
   }
   if(key==='POST /api/events/inspect'){
    const input=await body(req),id=String(input?.event_id??'').trim();
    if(!/^[A-Za-z0-9-]{6,100}$/.test(id))throw Object.assign(Error('Enter a PayPal event ID, not a URL or order ID'),{status:400});
    const raw=await paypal('/v1/notifications/webhooks-events/'+encodeURIComponent(id));
    let observation=normalizeProviderEvent(raw,id);
    observation=associateCaptureEvent(observation,(await statePromise).orders);
    if(!observation.order_id&&!captureReference(observation))throw Object.assign(Error('This PayPal event does not identify a supported order. Inspect the related capture order first; no association has been guessed.'),{status:422});
    await update(s=>({...s,events:[...s.events,observation]}));
    send(res,201,{event:observation,order_id:observation.order_id,signature_verified:false,source:'sandbox_event_api'});return;
   }
   if(key==='POST /api/events/import'){
    const input=await body(req),event=input?.event;
    let normalized;
    try{normalized={...normalizeEvent(event,false,false,'Manual import; signature has not been verified'),source:'manual'};}
    catch{throw Object.assign(Error('Expected PayPal webhook JSON with id and event_type'),{status:400});}
    normalized=associateCaptureEvent(normalized,(await statePromise).orders);
    if(!normalized.order_id&&!captureReference(normalized))throw Object.assign(Error(normalized.capture_id?'Refund references capture '+normalized.capture_id+'. Inspect its order in Sandbox first, then import this refund again.':'This event has no recognizable order association: expected Checkout resource.id or Capture resource.supplementary_data.related_ids.order_id'),{status:422});
    await update(s=>{
      if(s.events.some(x=>x.id===normalized.id&&hasEventAuthority(x)))throw Object.assign(Error('Cannot replace verified or provider-read evidence with a manual import'),{status:409});
      if(s.sources?.[normalized.id])throw Object.assign(Error('Original delivery already retained for this event ID. Inspect that delivery or retry its verification; manual import cannot replace it.'),{status:409});
      const sources={...s.sources};
      return {...s,sources,events:[...s.events.filter(x=>x.id!==normalized.id),normalized]};
    });
    send(res,201,{accepted:true,verified:false,event:normalized});return;
   }
   if(key==='POST /api/packet/import'){
    const input=await body(req,8*1024*1024+1024),admitted=admitSharedPacket(input?.packet);
    let addedSnapshots=0;
    await update(s=>{
     if(admitted.order&&s.orders.some(o=>o.id===admitted.order_id&&!o.imported))throw Object.assign(Error('A local order read exists; shared files cannot replace it'),{status:409});
     for(const e of admitted.events)if(s.events.some(x=>x.id===e.id&&(x.source!=='imported_packet'||x.order_id!==admitted.order_id)))throw Object.assign(Error('Packet collides with locally received or differently associated event'),{status:409});
     // Compare normalized observation content, not locally generated import IDs.
     // The same shared observation retains its first receipt and timeline row.
     const key=x=>JSON.stringify([x.order_id,x.resource_kind||'order',x.capture_id||null,x.status,x.reported_source,x.observed_at,x.reported_requested_at??null,x.amount??null,x.created??null,x.updated??null,x.captures.map(c=>[c.id,c.status,c.amount??null]).sort()]);
     const seen=new Set(s.snapshots.filter(x=>x.source==='imported_packet').map(key));
     const fresh=admitted.snapshots.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});
     addedSnapshots=fresh.length;
     const refundKey=r=>JSON.stringify([r.refund_id,r.capture_id,r.order_id,r.status,r.amount,r.total_refunded_amount??null,r.reported_requested_at??null,r.observed_at,r.updated,r.reported_source]);
     const knownRefunds=new Set((s.refund_observations??[]).filter(r=>r.source==='imported_packet').map(refundKey));
     const newRefunds=admitted.refund_observations.filter(r=>{const k=refundKey(r);if(knownRefunds.has(k))return false;knownRefunds.add(k);return true;});
     const knownDisputes=new Set((s.dispute_observations??[]).filter(r=>r.source==='imported_packet').map(disputeKey));
     const newDisputes=admitted.dispute_observations.filter(r=>{const k=disputeKey(r);if(knownDisputes.has(k))return false;knownDisputes.add(k);return true;});
     return {...s,operator_notes:mergeNotes(s.operator_notes??[],admitted.operator_notes),dispute_observations:[...(s.dispute_observations??[]),...newDisputes],refund_observations:[...(s.refund_observations??[]),...newRefunds],orders:admitted.order?[...s.orders.filter(o=>o.id!==admitted.order_id),admitted.order]:s.orders,events:[...s.events.filter(e=>!admitted.events.some(x=>x.id===e.id)),...admitted.events],snapshots:[...s.snapshots,...fresh]};
    });
    send(res,201,{accepted:true,order_id:admitted.order_id,verified:false,events:admitted.events.length,snapshots:addedSnapshots,snapshots_already_present:admitted.snapshots.length-addedSnapshots});
    return;
   }
   if(key==='GET /api/event/source'){
    const id=u.searchParams.get('event_id'),s=await statePromise,source=s.sources?.[id];
    if(!source)throw Object.assign(Error('Original signed delivery unavailable. Older records and manual imports require a fresh signed delivery.'),{status:404});
    send(res,200,{event:source.event,headers:source.headers,raw_event:source.raw_event??null,private:true});return;
   }
   if(key==='POST /api/event/reverify'){
    const {event_id:id}=await body(req),s=await statePromise,source=s.sources?.[id],prior=s.events.find(e=>e.id===id);
    if(!source||!prior)throw Object.assign(Error('Original signed delivery unavailable; receive a fresh signed delivery.'),{status:409});
    if(!env.PAYPAL_WEBHOOK_ID||Object.values(source.headers).length!==5||Object.values(source.headers).some(v=>!v))throw Object.assign(Error('Subscription ID or original signature headers missing; receive a fresh signed delivery.'),{status:409});
    let status,error=null;
    try{
     const result=await paypal('/v1/notifications/verify-webhook-signature','POST',verificationPayload(source));
     status=result.verification_status==='SUCCESS'?'verified':result.verification_status==='FAILURE'?'invalid':'unavailable';
     error=status==='invalid'?'PayPal did not verify signature':status==='unavailable'?'PayPal returned no verification verdict':null;
    }catch{status='unavailable';error='PayPal verification unavailable; retained evidence is unchanged. Retry when connection is restored.';}
    if(status==='unavailable'){send(res,503,{error,status});return;}
    let applied=false;
    await update(current=>{
     if(JSON.stringify(current.sources?.[id])!==JSON.stringify(source))return current;
     applied=true;
     return {...current,events:current.events.map(e=>e.id===id?{...e,verified:status==='verified',error,verification_checked:new Date().toISOString()}:e)};
    });
    if(!applied)throw Object.assign(Error('A newer delivery arrived during verification. Review it and retry.'),{status:409});
    send(res,200,{status,verified:status==='verified',error});return;
   }
   if(key==='GET /api/packet'){
    const id=u.searchParams.get('order_id'),s=await statePromise,o=s.orders.find(x=>x.id===id);if(!o&&!s.events.some(x=>x.order_id===id)&&!s.snapshots.some(x=>x.order_id===id&&x.resource_kind==='capture')){send(res,404,{error:'No evidence for this order ID'});return;}
    send(res,200,packet(o,s.events.filter(x=>x.order_id===id),s.snapshots.filter(x=>x.order_id===id),id,(s.refund_observations??[]).filter(x=>x.order_id===id),(s.dispute_observations??[]).filter(x=>x.order_id===id),exportNotes(s.operator_notes??[],id)));return;
   }
   if(key==='POST /api/ai/prioritize'){
    const input=await body(req),id=String(input?.order_id??''),s=await statePromise,o=s.orders.find(x=>x.id===id);
    const e=s.events.filter(x=>x.order_id===id),snapshots=s.snapshots.filter(x=>x.order_id===id);
    if(!o&&!e.length&&!snapshots.length)throw Object.assign(Error('Import evidence or inspect an order first'),{status:400});
    const checks=supportedChecks(reconcile(o,e,snapshots,id,(s.dispute_observations??[]).filter(r=>r.order_id===id),(s.refund_observations??[]).filter(r=>r.order_id===id)));
    if(checks.length<2){send(res,200,{checks,model:null,mode:'no_ranking_needed',advisory:true,wording:'deterministic_evidence_review'});return;}
    if(!env.AI_BASE_URL||!env.AI_MODEL)throw Object.assign(Error('Real model not configured; no simulated ranking'),{status:503});
    const baseUrl=new URL(env.AI_BASE_URL);
    if(!['http:','https:'].includes(baseUrl.protocol))throw Object.assign(Error('Invalid model endpoint'),{status:503});
    const api=new URL('chat/completions',baseUrl.toString().replace(/\/?$/,'/'));
    const answer=await fetchImpl(api.toString(),{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...(env.AI_API_KEY?{Authorization:'Bearer '+env.AI_API_KEY}:{})},body:JSON.stringify({
      model:env.AI_MODEL,temperature:0,max_tokens:200,response_format:{type:'json_object'},
      messages:[{role:'system',content:'You prioritize checks in a PayPal Sandbox investigation. The supplied checks are already computed from evidence. Rank ALL check IDs in the order most useful for the operator to act. Return only JSON with one order array, for example {"order":["F2","A1","F1"]}. Include every supplied ID exactly once. Do not invent IDs, conclusions, or payment actions. Put missing authoritative observations and consequential contradictions before contextual cautions.'},{role:'user',content:JSON.stringify({incident:id,checks})}]
    })});
    if(!answer.ok)throw Object.assign(Error('Real model API failed ('+answer.status+')'),{status:502});
    const response=await answer.json();let ranked;
    try{ranked=applyTriageOrder(String(response?.choices?.[0]?.message?.content??''),checks);}
    catch(error){throw Object.assign(Error(error.message),{status:502});}
    send(res,200,{checks:ranked,model:clean(env.AI_MODEL,80),mode:'supported_check_ordering',advisory:true,wording:'deterministic_evidence_review'});return;
   }
   if(key==='POST /api/ai/explain'){
    const input=await body(req),id=String(input?.order_id??''),s=await statePromise,o=s.orders.find(x=>x.id===id);
    if(!o&&!s.events.some(x=>x.order_id===id)&&!s.snapshots.some(x=>x.order_id===id))throw Object.assign(Error('Import evidence or inspect an order first'),{status:400});
    if(!env.AI_BASE_URL||!env.AI_MODEL)throw Object.assign(Error('Real model not configured; no simulated inference'),{status:503});
    const e=s.events.filter(x=>x.order_id===id),snapshots=s.snapshots.filter(x=>x.order_id===id).slice(-25),evidence=[...(o?['O1 '+JSON.stringify(o)]:['No order API observation exists for '+id+'. Payment state is unknown.']),...snapshots.map((x,i)=>'S'+(i+1)+' '+JSON.stringify(x)),...e.map((x,i)=>'E'+(i+1)+' '+JSON.stringify(x))];
    const baseUrl=new URL(env.AI_BASE_URL);if(!['http:','https:'].includes(baseUrl.protocol))throw Object.assign(Error('Invalid model endpoint'),{status:503});
    const api=new URL('chat/completions',baseUrl.toString().replace(/\/?$/,'/'));
    const answer=await fetchImpl(api.toString(),{method:'POST',headers:{'Content-Type':'application/json',...(env.AI_API_KEY?{Authorization:'Bearer '+env.AI_API_KEY}:{})},body:JSON.stringify({model:env.AI_MODEL,temperature:0.1,max_tokens:400,messages:[{role:'system',content:'Diagnose PayPal sandbox observations. Cite existing [O1], [S#] or [E#] evidence in EVERY sentence, including recommendations; avoid headings without references. Never treat sample or unverified event as proof of payment. Separate hypotheses from facts. Never recommend duplicate capture. Give 3-6 actionable sentences, each factual assertion evidence-cited.'},{role:'user',content:evidence.join('\n')+'\nDeterministic check: '+JSON.stringify(reconcile(o,e,snapshots,id,(s.dispute_observations??[]).filter(r=>r.order_id===id),(s.refund_observations??[]).filter(r=>r.order_id===id)))}]})});
    if(!answer.ok)throw Object.assign(Error('Real model API failed ('+answer.status+')'),{status:502});
    const response=await answer.json(),note=String(response?.choices?.[0]?.message?.content??'').slice(0,3500),refs=[...note.matchAll(/\[(O1|S\d+|E\d+)\]/g)].map(m=>m[1]),valid=new Set([...(o?['O1']:[]),...snapshots.map((_,i)=>'S'+(i+1)),...e.map((_,i)=>'E'+(i+1))]);
    const sentences=note.split(/(?<=[.!?])\s+|\n+/).map(x=>x.trim()).filter(Boolean);
    if(!refs.length||refs.some(x=>!valid.has(x))||sentences.some(x=>!/\[(O1|S\d+|E\d+)\]/.test(x)))throw Object.assign(Error('Model response lacked valid sentence-level evidence citations'),{status:502});
    send(res,200,{note,model:clean(env.AI_MODEL,80),citations:[...new Set(refs)],advisory:true});return;
   }
   if(req.method==='GET'&&['/','/theme.js','/style.light.css','/polish.css','/app.js','/startup.js','/finding-search.mjs','/finding-catalog.mjs','/finding-query.mjs','/payment-trace.mjs','/fonts/InterTight-Variable.ttf','/fonts/JetBrainsMono-Regular.woff2','/investigation-notes.mjs','/limitation-note.mjs','/capture-reference.mjs','/dispute-evidence.mjs','/dispute-start.mjs','/case-presentation.mjs','/workspace-shell.mjs','/evidence-filter.mjs','/changed-source-menu.mjs','/style.css','/event-origin.mjs','/read-comparison.mjs','/incident-summary.mjs','/event-discovery.mjs','/webhook-setup-ui.mjs','/delivery-inspector.mjs','/report-intake.mjs','/incident-report.mjs','/refund-selection.mjs'].includes(u.pathname)){
    const file=u.pathname==='/'?'index.html':u.pathname.slice(1),contents=await fs.readFile(path.join(ROOT,'web',file));
    res.writeHead(200,{'Content-Type':(file.endsWith('.js')||file.endsWith('.mjs'))?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':file.endsWith('.ttf')?'font/ttf':'text/html','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(demo&&file==='index.html'?demo.decorateHtml(contents):contents);return;
   }
   send(res,404,{error:'Not found'});
  }catch(e){send(res,e.status||500,{error:e.status?e.message:'Unexpected server error'});}
 }
 return {route,read:()=>statePromise,paypal};
}
export async function startServer(options={}){
 const app=createService(options),server=http.createServer(app.route),port=Number(options.env?.PORT??process.env.PORT??4179);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,app,url:'http://127.0.0.1:'+server.address().port};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer({starterCase:process.env.SETTLETRACE_STARTER_CASE!=='0'}).then(x=>console.log('SettleTrace '+x.url)).catch(e=>{console.error(e);process.exitCode=1;});
