import {randomUUID} from 'node:crypto';
const ID=/^[A-Z0-9-]{6,64}$/i;
const clean=(v,n=120)=>String(v??'').replace(/[<>\x00-\x1f]/g,'').slice(0,n);
const date=v=>v===null||v===undefined||v===''?null:Number.isNaN(new Date(v).getTime())?null:new Date(v).toISOString();
const amount=a=>a&&typeof a==='object'?{currency:clean(a.currency??a.currency_code,3),value:clean(a.value,32)}:null;
const invalid=(message,status=502)=>Object.assign(Error(message),{status});
export function disputeCaptures(order){return [...new Set((order?.units??[]).flatMap(u=>(u.captures??[]).map(c=>c.id)))];}
export function disputeCaptureIds(raw,requestedId){
 if(!raw||raw.dispute_id!==requestedId||!ID.test(requestedId)||typeof raw.status!=='string'||!Array.isArray(raw.disputed_transactions))throw invalid('Returned dispute record is incomplete or its ID differs; saved evidence is unchanged');
 const captureIds=[...new Set(raw.disputed_transactions.map(t=>t?.seller_transaction_id))];
 if(!captureIds.length||captureIds.length>64||captureIds.some(id=>!ID.test(id??'')))throw invalid('Dispute has no usable seller transaction association; saved evidence is unchanged');
 return captureIds;
}
export function normalizeDispute(raw,requestedId,order,requestedAt=null,observedAt=new Date().toISOString()){
 const captureIds=disputeCaptureIds(raw,requestedId);
 const matched=captureIds.filter(id=>disputeCaptures(order).includes(id));
 if(!order||order.imported||order.sample||!matched.length)throw invalid('This dispute does not reference a capture in the locally read order. Read its exact order first; no relationship has been guessed.',409);
 return {id:'DISPUTEREAD-'+randomUUID(),dispute_id:requestedId,order_id:order.id,capture_ids:captureIds,matched_capture_ids:matched,status:clean(raw.status,40),stage:clean(raw.dispute_life_cycle_stage,40),channel:clean(raw.dispute_channel,40),reason:clean(raw.reason,100),amount:amount(raw.dispute_amount),created:date(raw.create_time),updated:date(raw.update_time),requested_at:date(requestedAt),observed_at:date(observedAt),source:'sandbox_dispute_api'};
}
export function admitDisputes(raw,orderId,order,snapshots=[]){
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>2000)throw invalid('Shared dispute observations are invalid',422);
 const known=new Set([...disputeCaptures(order),...snapshots.flatMap(r=>r.captures??[]).map(c=>c.id)]);
 return raw.map(r=>{
  if(!r||r.order_id!==orderId||!ID.test(r.dispute_id??'')||typeof r.status!=='string'||!Array.isArray(r.capture_ids)||!r.capture_ids.length||r.capture_ids.length>64||r.capture_ids.some(id=>!ID.test(id??'')))throw invalid('Shared dispute association is invalid',422);
  const capture_ids=[...new Set(r.capture_ids)],matched_capture_ids=capture_ids.filter(id=>known.has(id));
  if(!matched_capture_ids.length)throw invalid('Shared dispute does not identify a capture in this investigation',422);
  return {id:'IMPORTED-DISPUTE-'+randomUUID(),dispute_id:r.dispute_id,order_id:orderId,capture_ids,matched_capture_ids,status:clean(r.status,40),stage:clean(r.stage,40),channel:clean(r.channel,40),reason:clean(r.reason,100),amount:amount(r.amount),created:date(r.created),updated:date(r.updated),reported_requested_at:date(r.reported_requested_at??r.requested_at),observed_at:date(r.observed_at),source:'imported_packet',reported_source:clean(r.reported_source||r.source,80),imported_at:new Date().toISOString()};
 });
}
export const disputeKey=r=>JSON.stringify([r.dispute_id,r.order_id,[...r.capture_ids].sort(),r.status,r.stage,r.channel,r.reason,r.amount,r.created,r.updated,r.reported_requested_at??r.requested_at,r.observed_at,r.reported_source||r.source]);
export function disputeFindings(records=[],orderId){
 const latest=new Map();
 for(const r of records.filter(r=>r.order_id===orderId)){
  const prior=latest.get(r.dispute_id),trusted=r.source==='sandbox_dispute_api',priorTrusted=prior?.source==='sandbox_dispute_api';
  if(!prior||(trusted&&!priorTrusted)||(trusted===priorTrusted&&String(r.requested_at||r.reported_requested_at||r.observed_at||'')>=String(prior.requested_at||prior.reported_requested_at||prior.observed_at||'')))latest.set(r.dispute_id,r);
 }
 const notes=[],actions=[];
 for(const r of latest.values()){
  const trusted=r.source==='sandbox_dispute_api',resolved=r.status==='RESOLVED',ids=r.matched_capture_ids||r.capture_ids;
  notes.push({kind:'dispute',review_required:!resolved||!trusted,action:'Review dispute '+r.dispute_id+' and its exact capture in PayPal; re-read the case before deciding how to handle the payment.',level:trusted&&!resolved?'investigate':resolved&&trusted?'info':'caution',title:trusted?'Dispute read reports '+r.status:'Shared dispute report: '+r.status,detail:(trusted?'PayPal Sandbox read':'Shared file')+' reports dispute '+r.dispute_id+' '+r.status+(r.stage?' ('+r.stage+')':'')+' for capture '+ids.join(', ')+'. '+(r.amount?'Case amount '+r.amount.currency+' '+r.amount.value+'. ':'')+'A completed capture and a dispute can coexist; this record does not establish a refund or capture reversal.'+(!trusted?' The shared claim has not been re-read in this workspace.':''),ids:[r.id]});
  if(!resolved||!trusted)actions.push('Review dispute '+r.dispute_id+' and its exact capture in PayPal; re-read the case before deciding how to handle the payment.');
 }
 return {notes,actions};
}
