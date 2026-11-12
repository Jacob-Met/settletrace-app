// Payments v2 captured payment details: keep only investigation evidence.
// https://developer.paypal.com/api/payments/v2/captures-get
const ID=/^[A-Za-z0-9-]{3,64}$/;
const clean=(s,n)=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,n):'';
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
export function normalizeCaptureRead(raw,requestedId){
 if(!ID.test(requestedId??'')||!raw||raw.id!==requestedId)throw Object.assign(Error('PayPal capture response does not match the requested capture ID'),{status:502});
 const related=raw.supplementary_data?.related_ids?.order_id;
 const amount=raw.amount;
 return {capture_id:requestedId,status:clean(raw.status,40)||'UNKNOWN',amount:amount&&/^[A-Z]{3}$/.test(amount.currency_code??'')&&typeof amount.value==='string'&&/^\d+(?:\.\d+)?$/.test(amount.value)?{currency:amount.currency_code,value:amount.value}:null,created:date(raw.create_time),updated:date(raw.update_time),order_id:typeof related==='string'&&ID.test(related)?related:null};
}

// Accept only an exact related order supplied by PayPal, never an arbitrary URL.
// The returned identifier is read through the configured provider transport.
export function captureRelatedOrderId(raw){
 const ids=new Set(),related=raw?.supplementary_data?.related_ids?.order_id;
 if(/^[A-Za-z0-9-]{6,64}$/.test(related??''))ids.add(related);
 for(const link of Array.isArray(raw?.links)?raw.links:[]){
  if(link?.rel!=='up'||(link.method&&link.method!=='GET'))continue;
  try{const target=new URL(link.href),match=target.pathname.match(/^\/v2\/checkout\/orders\/([A-Za-z0-9-]{6,64})$/);
   if(target.protocol==='https:'&&['api.paypal.com','api-m.paypal.com','api.sandbox.paypal.com','api-m.sandbox.paypal.com'].includes(target.hostname)&&!target.username&&!target.password&&!target.port&&!target.search&&!target.hash&&match)ids.add(match[1]);
  }catch{}
 }
 if(ids.size!==1)throw Object.assign(Error('PayPal capture did not identify one exact order. Saved evidence is unchanged; inspect the capture in PayPal.'),{status:422});
 return [...ids][0];
}
