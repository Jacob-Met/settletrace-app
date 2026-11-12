import {compareCaptureAmounts} from './capture-amount.mjs';
// Independent capture observations supplement, never replace, order/event evidence.
export function reviewCaptureReads(rows=[],snapshots=[],orderId){
 const readTime=s=>Number.isFinite(Date.parse(s.requested_at))?Date.parse(s.requested_at):Date.parse(s.observed_at);
 const result=rows.map(row=>({...row})),notes=[];
 const byId=new Map(result.map(row=>[row.id,row]));
 const reads=snapshots.filter(s=>s.order_id===orderId&&s.resource_kind==='capture'&&s.capture_id);
 for(const read of reads)if(!byId.has(read.capture_id)){
  const row={id:read.capture_id,api_status:null,amount:null,sample:false,events:[],assessment:'No order capture observation'};
  byId.set(row.id,row);result.push(row);
 }
 for(const row of result){
  row.capture_reads=reads.filter(s=>s.capture_id===row.id);
  const local=row.capture_reads.filter(s=>s.source==='sandbox_capture_api'&&Number.isFinite(Date.parse(s.observed_at))).sort((a,b)=>readTime(a)-readTime(b));
  row.latest_capture_read=local.at(-1)??null;
  const latest=row.latest_capture_read;
  if(!latest){
   if(row.capture_reads.length)row.assessment+='; imported capture reads claim '+[...new Set(row.capture_reads.map(s=>s.status).filter(Boolean))].join(' / ')+' and are not locally revalidated';
   const shared=row.capture_reads.filter(s=>s.source==='imported_packet').at(-1);
   if(row.api_source==='imported_packet'&&shared&&compareCaptureAmounts(row.amount,shared.amount)==='different'){
    row.amount_conflict=true;
    row.amount_difference={order:row.amount,capture:shared.amount,local_order:false,shared_capture:true};
    const orderClaim=snapshots.filter(s=>s.order_id===orderId&&s.source==='imported_packet'&&s.resource_kind!=='capture'&&s.captures?.some(c=>c.id===row.id&&compareCaptureAmounts(c.amount,row.amount)==='same')).at(-1);
    notes.push({level:'caution',kind:'capture_amount_claim',title:'Shared file reports conflicting capture amounts',detail:'Shared order claim for capture '+row.id+' reports '+row.amount.currency+' '+row.amount.value+'; shared capture read claims '+shared.amount.currency+' '+shared.amount.value+(shared.observed_at?' at '+shared.observed_at:'')+'. Both are imported claims, not locally revalidated. Neither value is selected as a reconciled capture amount. Read the exact capture in PayPal before using either claim.',ids:[orderClaim?.id,shared.id].filter(Boolean)});
   }
   continue;
  }
  if(!row.sample&&compareCaptureAmounts(row.amount,latest.amount)==='different'){
   const localOrder=row.api_source==='sandbox_api';
   row.amount_difference={order:row.amount,capture:latest.amount,local_order:localOrder};
   row.amount_conflict=localOrder;
   const basis=localOrder?'saved PayPal order read':'shared order claim, not locally revalidated';
   notes.push({level:localOrder?'investigate':'caution',kind:'capture_amount',title:localOrder?'Same capture has conflicting gross amounts':'Capture amount differs from shared order claim',detail:'Capture '+row.id+': '+basis+' reports '+row.amount.currency+' '+row.amount.value+(row.api_observed_at?' at '+row.api_observed_at:'')+'; independent PayPal capture read reports '+latest.amount.currency+' '+latest.amount.value+' at '+latest.observed_at+'. '+(localOrder?'These saved reads disagree. Neither amount is selected as a reconciled correction. Re-read the exact capture and order before quoting a gross amount.':'The shared value is not local payment authority. Keep its provenance separate from the local capture observation.'),ids:[row.api_read_id,latest.id].filter(Boolean)});
   row.assessment+='; '+(localOrder?'same capture has conflicting gross amounts':'capture amount differs from the shared order claim');
  }
  if(['REFUNDED','PARTIALLY_REFUNDED'].includes(latest.status)&&/^(Completion corroborated for this capture|API completed)/.test(row.assessment))row.assessment='Earlier completion is historical';
  row.assessment+='; independent capture read reports '+latest.status+' at '+latest.observed_at+'. The capture API read alone does not prove webhook delivery';
  if(row.api_status&&row.api_status!==latest.status){
   const localOrder=row.api_source==='sandbox_api';
   notes.push({level:localOrder?'investigate':'caution',title:'Capture read differs from '+(localOrder?'order observation':'order claim'),detail:'Capture '+row.id+' reports '+latest.status+' in the independent capture read at '+latest.observed_at+'; the '+(localOrder?'order observation':'unverified order claim')+' reports '+row.api_status+(row.api_observed_at?' at '+row.api_observed_at:' at an unknown time')+'. Different observation times can explain a transition. Keep reversal and refund history and compare the exact capture before accepting a current payment conclusion.',ids:[latest.id].filter(Boolean)});
  }else notes.push({level:'info',title:'Independent capture observation',detail:'Capture '+row.id+' was read as '+latest.status+' at '+latest.observed_at+'. This observation does not establish webhook delivery or remove earlier reversal/refund evidence.',ids:[latest.id].filter(Boolean)});
 }
 return {rows:result,notes};
}
