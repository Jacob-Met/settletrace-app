const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const time=v=>v?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(v))+' UTC':'unknown time';
const human=v=>({WAITING_FOR_SELLER_RESPONSE:'Awaiting seller response',WAITING_FOR_BUYER_RESPONSE:'Awaiting buyer response',UNDER_REVIEW:'Under review'}[v]||String(v??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()));
export function mountDisputeEvidence(host,{call,onRead}){
 const panel=el('details','','tool-section'),summary=el('summary','Dispute evidence'),list=el('div'),form=el('form','','stack-form'),label=el('label','PayPal dispute ID'),input=el('input'),button=el('button','Read dispute','secondary'),guidance=el('p','','form-feedback'),status=el('p','','form-feedback');
 input.id='dispute-id';input.required=true;input.pattern='[A-Za-z0-9-]{6,64}';input.autocomplete='off';input.placeholder='PP-…';label.htmlFor=input.id;button.type='submit';button.id='dispute-read';status.id='dispute-read-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');input.setAttribute('aria-describedby',status.id);form.id='dispute-inspect-form';form.append(label,input,button);panel.append(summary,list,form,guidance,status);host.replaceChildren(panel);
 let packet=null,connected=false,pending=false;
 const controls=()=>{const allowed=!!packet?.order&&!packet.order.imported&&!packet.order.sample&&connected;button.disabled=!allowed||pending;input.disabled=pending;button.textContent=pending?'Reading dispute…':'Read dispute';guidance.textContent=!connected?'Connect PayPal in Settings to read the case.':!allowed?'Refresh this payment from Sandbox before linking a dispute.':'Reads the case only. No dispute response, refund, or payment action is sent.';};
 form.onsubmit=async e=>{
  e.preventDefault();if(pending||button.disabled)return;const id=packet.order_id,disputeId=input.value.trim().toUpperCase();pending=true;controls();status.textContent='Reading '+disputeId+' from PayPal Sandbox…';
  try{await call('/api/dispute/inspect','POST',{order_id:id,dispute_id:disputeId});await onRead();status.textContent=packet?.order_id===id?'Saved dispute read for '+disputeId+'. Capture status remains a separate observation.':'Saved dispute read for '+disputeId+' in '+id+'.';}
  catch(error){status.textContent=error.message+' Saved evidence is unchanged.';}
  finally{pending=false;controls();}
 };
 return {focus(id){panel.open=true;const row=[...list.children].find(r=>r.dataset.disputeReadId===id);if(row){row.tabIndex=-1;row.focus({preventScroll:true});row.scrollIntoView({block:'start'});}},update(next,isConnected){
  const changed=packet?.order_id!==next?.order_id;packet=next;connected=isConnected;host.hidden=!next?.order_id;if(changed){status.textContent='';input.value='';panel.open=false;}
  list.replaceChildren();const records=next?.dispute_observations??[];
  if(records.length)panel.open=true;
  for(const r of [...records].reverse()){
   const row=el('section','','dispute-record'),shared=r.source!=='sandbox_dispute_api';row.dataset.disputeReadId=r.id;
   const state=el('p',human(r.status),'dispute-status');state.title=r.status;
   row.append(el('h3',r.dispute_id),state,el('p',(shared?'Shared file · Reported read ':'PayPal Sandbox read · ')+time(r.observed_at),'source-notice'));
   const facts=el('dl','','dispute-facts');
   const fact=(label,value)=>{facts.append(el('dt',label),el('dd',value));};
   fact('Capture',(r.matched_capture_ids||r.capture_ids).join(', '));
   if(r.amount)fact('Dispute amount',r.amount.currency+' '+r.amount.value);
   if(r.stage||r.channel)fact('Case type',[r.stage,r.channel].filter(Boolean).map(human).join(' · '));
   row.append(facts,el('p',shared?'Imported case evidence has not been re-read here. It does not establish a refund or reversal.':'This case read is separate from capture status. It does not establish a refund or reversal.','dispute-authority'));
   const read=el('button','Re-read '+r.dispute_id,'text-button');read.type='button';read.disabled=!connected||!next?.order||next.order.imported||next.order.sample||pending;read.onclick=()=>{input.value=r.dispute_id;form.requestSubmit();};row.append(read);list.append(row);
  }
  controls();
 }};
}
