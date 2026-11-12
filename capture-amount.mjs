import {hasEventAuthority} from './web/event-origin.mjs';
// Compare gross resource.amount only, never seller net proceeds or order totals.
// PayPal example: https://developer.paypal.com/api/rest/webhooks/rest/
const decimal=value=>{
 if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');
 return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.replace(/0+$/,'');
};
// null means the retained fields cannot support a monetary comparison.
export function compareCaptureAmounts(left,right){
 if(!left||!right||!/^[A-Z]{3}$/.test(left.currency)||!/^[A-Z]{3}$/.test(right.currency))return null;
 const a=decimal(left.value),b=decimal(right.value);
 if(a===null||b===null)return null;
 return left.currency===right.currency&&a===b?'same':'different';
}
export function captureAmountConflicts(order,events=[],orderId=order?.id){
 if(!order||order.sample||order.imported)return [];
 const captures=new Map((order.units??[]).flatMap(u=>u.captures??[]).map(c=>[c.id,c]));
 const conflicts=[];
 for(const e of events){
  if(e.order_id!==orderId||!hasEventAuthority(e)||e.source==='imported_packet'||e.type!=='PAYMENT.CAPTURE.COMPLETED')continue;
  const api=captures.get(e.resource_id)?.amount,event=e.capture_amount;
  if(compareCaptureAmounts(api,event)==='different')conflicts.push({capture_id:e.resource_id,event_id:e.id,api,event});
 }
 return conflicts;
}
