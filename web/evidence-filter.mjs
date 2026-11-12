import {isProviderRead} from './event-origin.mjs';
// Filter only the visible history, never the diagnosis or exported evidence.
export function matchingEvidence(records,query='',kind='all'){
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return records.filter(e=>{
  const captureRead=e.kind==='capture_read',refundRead=e.kind==='refund_read',read=e.kind==='order_read'||captureRead||refundRead,apiRead=isProviderRead(e),apiClaim=apiRead||(e.source==='imported_packet'&&e.reported_source==='sandbox_event_api'),unverified=!read&&!apiRead&&(!e.verified||e.sample||e.source==='imported_packet');
  if(kind==='reads'&&e.kind!=='order_read'||kind==='capture_reads'&&!captureRead||kind==='refund_reads'&&!refundRead||kind==='api_events'&&!apiRead||kind==='webhooks'&&(read||apiClaim)||kind==='unverified'&&!unverified)return false;
  const values=[e.id,e.reported_read_id,e.event_id,e.provider_observed_at,e.type,e.resource_id,e.capture_id,e.refund_id,e.order_id,e.transmission_id,e.status,e.refund_status,e.source,e.reported_source,e.occurred,e.received,e.observed_at,e.requested_at,e.reported_requested_at,...(e.captures||[]).flatMap(c=>[c.id,c.status])].filter(Boolean).map(x=>String(x).toLowerCase());
  return terms.every(term=>values.some(value=>value.includes(term)));
 });
}
// Explain identifier matches without loading the original customer payload.
export function matchingReferences(record,query=''){
 const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
 if(!terms.length)return [];
 const refs=[[record.kind==='refund_read'?'Refund read':record.kind==='capture_read'?'Capture read':record.kind==='order_read'?'Order read':'Event',record.id],['Shared read reference',record.reported_read_id],['Resource',record.resource_id],['Capture',record.capture_id],['Refund',record.refund_id],['Transmission',record.transmission_id],...(record.captures||[]).map(c=>['Capture',c.id])];
 return refs.filter(([,value])=>value&&terms.some(term=>String(value).toLowerCase().includes(term)));
}
export function evidenceFinder(target,onChange){
 const box=document.createElement('div');box.className='evidence-finder';
 const label=document.createElement('label');label.htmlFor='evidence-search';label.textContent='Search activity';
 const controls=document.createElement('div');controls.className='evidence-filter-controls';
 const input=document.createElement('input');input.id='evidence-search';input.type='search';input.placeholder='Event, read, capture, refund or transmission ID';input.autocomplete='off';input.setAttribute('aria-describedby','evidence-search-summary');
 const select=document.createElement('select');select.id='evidence-kind';select.setAttribute('aria-label','Evidence kind');
 for(const [value,title] of [['all','All evidence'],['webhooks','Webhook events'],['reads','Order reads'],['capture_reads','Capture reads'],['refund_reads','Refund reads'],['api_events','PayPal event reads'],['unverified','Unverified events']]){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}
 const clear=document.createElement('button');clear.type='button';clear.className='secondary';clear.textContent='Clear';clear.hidden=true;
 const summary=document.createElement('p');summary.id='evidence-search-summary';summary.setAttribute('role','status');
 controls.append(input,select,clear);box.append(label,controls,summary);target.before(box);
 let lastSelection,exact=null;
 const changed=()=>{exact=null;onChange();};
 input.addEventListener('input',changed);select.addEventListener('change',changed);clear.onclick=()=>{input.value='';select.value='all';exact=null;onChange();input.focus();};
 const filter=(records,selection)=>{
  if(selection!==lastSelection){input.value='';select.value='all';exact=null;lastSelection=selection;}
  input.disabled=select.disabled=!selection;
  const filtered=exact?records.filter(e=>e.id===exact.id&&e.kind===exact.kind):matchingEvidence(records,input.value,select.value),active=!!exact||!!input.value.trim()||select.value!=='all';
  clear.hidden=!active;summary.textContent=selection?(active?filtered.length+' of '+records.length+' records':records.length+' records'):'Choose an investigation.';
  return {records:filtered,active,query:input.value};
 };
 filter.showRecord=(id,kind)=>{exact={id,kind};input.value=id;select.value='all';onChange();};
 filter.showAll=()=>{exact=null;input.value='';select.value='all';onChange();};
 return filter;
}
