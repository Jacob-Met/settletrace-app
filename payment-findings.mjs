import {hasEventAuthority,isProviderRead} from './web/event-origin.mjs';
const money=a=>a?.currency&&a?.value!==undefined&&a?.value!==null&&a.value!==''?a.currency+' '+a.value:'amount not supplied';
const orderBasis=o=>o?.sample?'Authored order example':o?.imported?'Shared order claim, not locally revalidated':'Saved PayPal order read';
const source=r=>r.sample?'Authored example; no payment established':r.source==='imported_packet'?'Shared claim, not locally revalidated':r.source==='sandbox_refund_api'?'PayPal refund read':isProviderRead(r)?'PayPal event read; not delivery proof':hasEventAuthority(r)?'Signature-verified event':'Unverified event claim';
const when=r=>r.observed_at||r.provider_observed_at||r.reported_provider_observed_at||r.occurred||null;
// Describe saved evidence; never total repeated refund observations or infer a balance.
// PayPal approval precedes capture: https://developer.paypal.com/api/rest/integration/orders-api
export function exactPaymentFindings(order,events,rows,snapshots,refundReads,orderId){
 const notes=[],actions=[];
 const ownEvents=events.filter(e=>e.order_id===orderId);
 const refunds=[...ownEvents.filter(e=>e.type==='PAYMENT.CAPTURE.REFUNDED').map(e=>({...e,refund_id:e.resource_id,amount:e.refund_amount,status:e.refund_status})),...refundReads.filter(r=>r.order_id===orderId)];
 if(order?.status==='APPROVED'&&!rows.length){
  notes.push({level:'unknown',kind:'capture_state',title:'Approval does not establish collected funds',detail:orderBasis(order)+' reports APPROVED for '+order.id+'. Buyer approval alone does not establish a completed capture. No capture observation is retained in this investigation.'+(!refunds.length?' No refund record is retained; the refunded amount is unknown, not zero.':''),ids:snapshots.filter(s=>s.order_id===orderId&&s.resource_kind!=='capture').map(s=>s.id).filter(Boolean)});
  actions.push('Read the order and its exact captures in PayPal before deciding whether funds were collected; do not initiate another payment from missing evidence.');
 }
 for(const row of rows){
  const read=row.latest_capture_read;
  const status=read?.status||row.api_status;
  if(!status||['COMPLETED','REFUNDED','PARTIALLY_REFUNDED'].includes(status))continue;
  const basis=read?'Saved PayPal capture read':orderBasis(order);
  notes.push({level:'caution',kind:'capture_state',title:'Capture '+row.id+' is reported '+status,detail:'Capture '+row.id+' / '+money(read?.amount||row.amount)+' is reported '+status+' by '+basis+(read?.observed_at?' at '+read.observed_at:'')+'. This observation does not establish a completed capture. Completion for another capture does not establish payment for this capture. Compare this exact capture with its own event history.',ids:read?.id?[read.id]:snapshots.filter(s=>s.order_id===orderId&&s.resource_kind!=='capture'&&s.captures?.some(c=>c.id===row.id)).map(s=>s.id).filter(Boolean)});
 }
 if(refunds.length){
  const retained=[];
  for(const captureId of new Set(refunds.map(r=>r.capture_id))){
   const grouped=refunds.filter(r=>r.capture_id===captureId);
   const keys=new Map();
   for(const r of grouped){const key=JSON.stringify([r.refund_id,r.source||'received']);if(!keys.has(key))keys.set(key,[]);keys.get(key).push(r);}
   for(const history of keys.values())retained.push([...history].sort((a,b)=>(Date.parse(a.requested_at||when(a))||0)-(Date.parse(b.requested_at||when(b))||0)).at(-1));
  }
  const shown=retained.slice(-6);
  const headlineRefund=shown.length===1?shown[0]:null;
  const headlineCapture=headlineRefund?rows.find(c=>c.id===headlineRefund.capture_id):null;
  const answer=headlineRefund?(headlineRefund.sample?'Authored example · ':headlineRefund.source==='imported_packet'?'Shared claim · ':!hasEventAuthority(headlineRefund)&&headlineRefund.source!=='sandbox_refund_api'?'Unverified claim · ':'')+'Refund '+money(headlineRefund.amount)+' · '+(headlineCapture?.amount_conflict?'Capture amounts differ':'Capture '+money(headlineCapture?.latest_capture_read?.amount||headlineCapture?.amount)):null;
  const details=shown.map(r=>{
   const row=rows.find(c=>c.id===r.capture_id);
   let detail='Refund '+(r.refund_id||'ID unavailable')+' / '+money(r.amount)+' / '+(r.status||'status not supplied')+' → '+(r.capture_id?'capture '+r.capture_id:'capture association unavailable')+'.\n'+source(r)+(when(r)?' at '+when(r):'')+'.';
   if(row){
    if(row.api_status)detail+='\nCapture '+row.id+' / '+money(row.amount)+': '+orderBasis(order)+' reports '+row.api_status+'.';
    const read=row.latest_capture_read;
    if(read)detail+='\nIndependent capture read reports '+read.status+' / '+money(read.amount)+' at '+read.observed_at+'.';
    else for(const claim of row.capture_reads?.filter(c=>c.source==='imported_packet').slice(-1)||[])detail+='\nShared capture claim reports '+claim.status+' / '+money(claim.amount)+' at '+(claim.observed_at||'unknown time')+'; not locally revalidated.';
   }
   if(r.total_refunded_amount)detail+=' '+source(r)+' reports the original capture’s refunded total as '+money(r.total_refunded_amount)+'; this is a reported total, not a sum of these observations.';
   return detail;
  });
  notes.push({level:'caution',kind:'refund_evidence',answer,title:'Refund evidence needs its own review',detail:details.join('\n\n')+(retained.length>6?' Showing six of '+retained.length+' distinct refund/source groups.':'')+' Refund IDs are separate from capture IDs. Repeated observations are not additional refunds. These records do not establish a complete refund history or the remaining refundable amount.',ids:[...new Set(shown.flatMap(r=>[r.id,...(rows.find(c=>c.id===r.capture_id)?.capture_reads||[]).map(c=>c.id)]).filter(Boolean))]});
  const unreadRefunds=refunds.some(r=>!r.refund_id||!r.capture_id||!refundReads.some(read=>read.source==='sandbox_refund_api'&&!read.sample&&read.order_id===orderId&&read.capture_id===r.capture_id&&read.refund_id===r.refund_id));
  actions.push((unreadRefunds?'Inspect the exact refund in PayPal and re-read the order':'Re-read the order to compare its current capture status with the saved refund')+'; do not issue another refund from this evidence alone.');
 }
 return {notes,actions};
}
