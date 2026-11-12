const el=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
export function mountDisputeStart(host,{call,onBegin,onRead}){
 const panel=el('details','','tool-section'),summary=el('summary','Start from a dispute'),form=el('form','','stack-form'),label=el('label','PayPal dispute ID'),input=el('input'),choiceLabel=el('label','Which capture do you want to investigate?'),choice=el('select'),button=el('button','Find payment','secondary'),status=el('p','','form-feedback'),scope=el('p','Reads the case and its exact payment. No dispute response or payment action is sent.','source-notice');
 input.id='start-dispute-id';input.required=true;input.autocomplete='off';input.pattern='[A-Za-z0-9-]{6,64}';input.placeholder='PP-…';label.htmlFor=input.id;
 choice.id='start-dispute-capture';choiceLabel.htmlFor=choice.id;choice.hidden=choiceLabel.hidden=true;
 form.id='start-dispute-form';button.type='submit';status.id='start-dispute-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');input.setAttribute('aria-describedby',status.id);
 form.append(label,input,choiceLabel,choice,button);panel.append(summary,scope,form,status);host.replaceChildren(panel);
 let connected=false,pending=false;
 const availability=()=>{button.disabled=!connected||pending;input.disabled=pending;choice.disabled=pending;button.textContent=pending?'Reading case and payment…':'Find payment';};
 input.oninput=()=>{choice.replaceChildren();choice.hidden=choiceLabel.hidden=true;choice.required=false;status.textContent='';};
 form.onsubmit=async event=>{
  event.preventDefault();if(pending||!connected)return;
  const navigation=onBegin(),disputeId=input.value.trim().toUpperCase();pending=true;availability();status.textContent='Reading '+disputeId+' from PayPal Sandbox…';
  try{
   const result=await call('/api/dispute/inspect','POST',{dispute_id:disputeId,...(!choice.hidden?{capture_id:choice.value}:{})});
   if(result.selection_required){
    choice.replaceChildren(el('option','Choose an exact capture'));choice.firstChild.value='';
    for(const id of result.capture_ids){const option=el('option',id);option.value=id;choice.append(option);}
    choice.hidden=choiceLabel.hidden=false;choice.required=true;
    status.textContent='This case lists multiple transactions. Choose the capture to open; nothing has been saved yet.';
   }else{await onRead(result,navigation);status.textContent='Saved '+disputeId+' with payment '+result.order_id+'.';}
  }catch(error){status.textContent=error.message+' Existing evidence is unchanged.';}
  finally{pending=false;availability();}
 };
 return {update(value){connected=!!value;availability();if(!connected&&!pending)status.textContent='Connect PayPal in Settings to look up a dispute.';}};
}
