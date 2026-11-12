import {isProviderRead} from './event-origin.mjs';
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
// A private request inspector. Imported packets never acquire a source action.
export function createDeliveryInspector({call,getState,onVerified}){
 const views=new Map();
 return function appendOriginalDelivery(item,event){
  if(event.sample||isProviderRead(event)||['manual','imported_packet'].includes(event.source))return;
  const identity=JSON.stringify([event.received,event.transmission_id,event.type,event.resource_id,event.source_available,event.source_raw_available,event.source_headers_complete]);
  const prior=views.get(event.id);
  const view=prior?.identity===identity?prior:{identity,open:prior?.open??false,tab:'body',data:null,pending:false,result:'',missing:false};
  views.set(event.id,view);
  const unavailable=event.source_available===false,incomplete=event.source_headers_complete===false;
  const detail=node('details','event-source delivery-inspector');
  const summary=node('summary','','Original request');
  const badge=node('span','delivery-source-state',unavailable?'Unavailable':event.verified?'Signature verified':incomplete?'Incomplete headers':'Unverified');
  summary.append(badge);detail.append(summary);detail.open=view.open;
  const content=node('div','delivery-inspector-content');
  const privacy=node('p','quiet','Private source · excluded from shared files');
  const toolbar=node('div','delivery-source-toolbar');
  const body=node('button','secondary','Body'),headers=node('button','secondary','Signature headers');
  body.type=headers.type='button';body.setAttribute('aria-label','Show exact original request body');headers.setAttribute('aria-label','Show original signature headers');
  const output=node('pre','delivery-source-output');
  const feedback=node('p','verification-result');feedback.setAttribute('role','status');
  const inspect=node('button','secondary','Load original delivery');inspect.type='button';
  const retry=node('button','secondary','Recheck PayPal signature');retry.type='button';retry.dataset.eventId=event.id;
  const readiness=node('p','source-readiness');
  const render=()=>{
   const state=getState();
   readiness.textContent=unavailable?'Original delivery unavailable. Receive a fresh signed delivery.':incomplete?'Signature headers incomplete. Receive a fresh signed delivery.':event.source_raw_available===false?'Parsed delivery retained; exact original text unavailable.':'';
   readiness.hidden=!readiness.textContent;
   body.setAttribute('aria-pressed',String(view.tab==='body'));headers.setAttribute('aria-pressed',String(view.tab==='headers'));
   toolbar.hidden=!view.data;
   output.hidden=!view.data;output.setAttribute('aria-label',view.tab==='body'?'Original request body':'Original signature headers');
   if(view.data)output.textContent=view.tab==='headers'?JSON.stringify(view.data.headers,null,2):typeof view.data.raw_event==='string'?view.data.raw_event:JSON.stringify(view.data.event,null,2);
   inspect.hidden=!!view.data;inspect.disabled=unavailable||view.pending;
   inspect.textContent=view.pending?'Loading original delivery…':'Load original delivery';
   retry.disabled=unavailable||incomplete||view.missing||view.pending||!state.connected||!state.webhook_configured;
   feedback.textContent=view.result||event.error||(!state.connected||!state.webhook_configured?'Connect Sandbox and this webhook subscription to recheck.':event.verified?'PayPal signature verified.':'');
   feedback.hidden=!feedback.textContent;
  };
  body.onclick=()=>{view.tab='body';render();};headers.onclick=()=>{view.tab='headers';render();};
  inspect.onclick=async()=>{
   if(view.pending)return;view.pending=true;render();
   try{view.data=await call('/api/event/source?event_id='+encodeURIComponent(event.id));view.missing=Object.keys(view.data.headers).length!==5||Object.values(view.data.headers).some(value=>!value);if(view.missing)view.result='Original signature headers missing. Receive a fresh signed delivery.';}
   catch(error){view.result=error.message;}finally{view.pending=false;render();}
  };
  retry.onclick=async()=>{
   if(view.pending)return;view.open=true;view.pending=true;view.result='Checking original signature with PayPal…';render();
   const focused=document.activeElement===retry;
   try{const result=await call('/api/event/reverify','POST',{event_id:event.id});view.result=result.verified?'PayPal verified this original delivery.':'PayPal rejected this signature. The event remains unverified.';view.pending=false;await onVerified();if(focused)[...document.querySelectorAll('[data-event-id]')].find(button=>button.dataset.eventId===event.id)?.focus({preventScroll:true});}
   catch(error){view.result=error.message;view.missing=/headers missing|delivery unavailable/.test(error.message);}
   finally{view.pending=false;render();}
  };
  detail.ontoggle=()=>{view.open=detail.open;};
  toolbar.append(body,headers);content.append(privacy,readiness,toolbar,output,inspect,retry,feedback);detail.append(content);item.append(detail);render();
 };
}
