import {suggestReportLookups,REPORT_LIMIT} from './incident-report.mjs';

export function mountReportIntake(anchor,{matches,open,prepare,inspectCapture,inspectRefund}){
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const panel=make('details',null,'report-intake tool-section');
 panel.id='report-intake';
 panel.append(make('summary','Find evidence in a report'));
 const content=make('div',null,'stack-form');
 const label=make('label','Checkout or support report');label.htmlFor='incident-report';
 const input=make('textarea');input.id='incident-report';input.rows=4;
 input.placeholder='Paste a report containing an order, capture, refund or PayPal event ID';
 const find=make('button','Find identifiers','primary');find.type='button';
 const clear=make('button','Clear report','text-button');clear.type='button';
 const feedback=make('p',null,'form-feedback');feedback.id='report-feedback';feedback.setAttribute('role','status');input.setAttribute('aria-describedby',feedback.id);
 const list=make('ol',null,'report-suggestions');
 const actions=make('div',null,'report-actions');actions.append(find,clear);
 content.append(label,input,actions,feedback,list);panel.append(content);
 anchor.after(panel);
 const reset=()=>{list.replaceChildren();feedback.textContent='';input.removeAttribute('aria-invalid');};
 const tooLong=()=>{
  if(input.value.length<=REPORT_LIMIT)return false;
  input.setAttribute('aria-invalid','true');
  feedback.textContent='Report has '+input.value.length.toLocaleString('en-US')+' characters. Shorten it to '+REPORT_LIMIT.toLocaleString('en-US')+' or fewer to find identifiers.';
  return true;
 };
 input.addEventListener('input',()=>{reset();tooLong();});
 clear.onclick=()=>{input.value='';reset();input.focus();};
 find.onclick=()=>{
  reset();
  if(tooLong()){input.focus();return;}
  const report=input.value.trim();
  if(!report){feedback.textContent='Paste a report to look for identifiers.';input.focus();return;}
  const result=suggestReportLookups(report);
  feedback.textContent=result.lookups.length?
   result.lookups.length+' reference'+(result.lookups.length===1?'':'s')+' found.'+(result.uncertain?' Some references are ambiguous or missing.':''):
   'No clear supported identifier found. Ask for the PayPal order, capture, refund or event ID, or use the existing ID fields.';
  for(const lookup of result.lookups){
   const row=make('li');
   row.append(make('strong',lookup.kind[0].toUpperCase()+lookup.kind.slice(1)+' · '+lookup.id));
   const quote=make('blockquote',lookup.quote);row.append(quote);
   const found=matches(lookup);
   if(found.length){
    for(const id of found){
     const action=make('button','Open investigation '+id,'secondary');action.type='button';
     action.onclick=()=>open(id);row.append(action);
    }
   }else if(lookup.kind==='order'||lookup.kind==='event'){
    const action=make('button','Use '+lookup.kind+' ID in inspection','secondary');action.type='button';
    action.onclick=()=>{panel.open=false;prepare(lookup);};row.append(action);
   }else if((lookup.kind==='capture'&&inspectCapture)||(lookup.kind==='refund'&&inspectRefund)){
    const inspect=lookup.kind==='refund'?inspectRefund:inspectCapture;
    const action=make('button','Read '+lookup.kind+' in Sandbox','secondary');action.type='button';
    const status=make('p',null,'form-feedback');status.setAttribute('role','status');
    action.onclick=async()=>{action.disabled=true;status.textContent='Reading the '+lookup.kind+' and its related payment…';try{const result=await inspect(lookup);status.textContent=result?.message||'Evidence saved.';}catch(error){status.textContent=error.message;}finally{action.disabled=false;}};
    row.append(action,status);
   }else row.append(make('p','This reference is not in saved evidence. Read its related payment to establish the association.','quiet'));
   list.append(row);
  }
 };
 return panel;
}

