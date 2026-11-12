export function selectCaptureRefunds(observations=[],captureId,orderId){
 const time=r=>Date.parse(r.requested_at||r.reported_requested_at||r.observed_at)||0;
 const groups=new Map();
 for(const r of observations){
  if(r.capture_id!==captureId||r.order_id!==orderId||!r.refund_id)continue;
  if(!groups.has(r.refund_id))groups.set(r.refund_id,[]);
  groups.get(r.refund_id).push(r);
 }
 return [...groups.values()].map(history=>{
  const local=history.filter(r=>r.source==='sandbox_refund_api');
  return {read:[...(local.length?local:history)].sort((a,b)=>time(a)-time(b)).at(-1),history,local:!!local.length};
 });
}
