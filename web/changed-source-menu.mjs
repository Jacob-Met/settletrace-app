// The archive comparison opens existing records; it never loads private payloads.
export function changedSourceMenu(target,{openRecord,openHistory,openSummary}){
 const node=(tag,className,text)=>{const value=document.createElement(tag);if(className)value.className=className;if(text!==undefined)value.textContent=text;return value;};
 return work=>{
  const wasOpen=target.querySelector('details')?.open;
  target.replaceChildren();target.hidden=!work?.new_evidence;
  if(!work?.new_evidence)return;
  const sources=work.changed_sources,records=sources?.records||[];
  if(!records.length){
   const action=node('button','secondary',sources?.order_changed?'Review order':'Review history');
   action.type='button';action.onclick=sources?.order_changed?openSummary:openHistory;target.append(action);return;
  }
  const menu=node('details','changed-source-menu');menu.open=!!wasOpen;
  const summary=node('summary','','Review changes · '+records.length);
  const list=node('ul','changed-source-list');let populated=false;
  const populate=()=>{
   if(!menu.open||populated)return;populated=true;
   for(const record of records){
    const row=node('li'),button=node('button','changed-source');button.type='button';button.dataset.changedId=record.id;
    const title=record.kind!=='webhook'?record.label:record.reference;
    const detail=(record.change==='added'?'New':'Changed')+(record.kind!=='webhook'?(record.reference==='Observation time unknown'?'':' · '+record.reference):' · '+record.label.replace(/^PAYMENT\.CAPTURE\./,''));
    button.append(node('strong','',title),node('span','',detail));
    if(record.kind==='webhook'){
     const at=record.receipt?.at,date=new Date(at),known=!!at&&Number.isFinite(date.getTime());
     const same=records.filter(r=>r.kind==='webhook'&&r.reference===record.reference);
     const tied=known&&same.filter(r=>r.receipt?.at&&Date.parse(r.receipt.at)===date.getTime()).length>1;
     const clock=known?(record.receipt.shared?'Shared receipt':'Receipt')+' · '+new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',...(date.getUTCMilliseconds()?{fractionalSecondDigits:3}:{}),timeZone:'UTC'}).format(date)+' UTC':'';
     const reference=!known&&same.length>1||tied?'Record · '+record.id:'';
     const context=[clock,reference].filter(Boolean).join(' · ');
     if(context)button.append(node('span','',context));
    }

    button.setAttribute('aria-label',[...button.children].map(child=>child.textContent).join(' · '));
    button.onclick=()=>{menu.open=false;openRecord(record);};row.append(button);list.append(row);
   }
  };
  menu.addEventListener('toggle',populate);
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();}});
  menu.append(summary,list);populate();target.append(menu);
 };
}
