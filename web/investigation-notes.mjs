import {captureReferenceControl} from './capture-reference.mjs';
import {findingRefusalText} from './finding-search.mjs';
import {renderLimitationNote} from './limitation-note.mjs';
import {refundEvidenceLimits,retainedDeliveryGroups} from './finding-catalog.mjs';
import {presentTimelineRecord,presentSavedObservationRow} from './case-presentation.mjs';
import {handoffExplanation,appendSavedScopeObservations,appendSavedFollowupResult,appendSavedObservation,appendSavedRefundSubtotal} from './incident-summary.mjs';
export function comparisonNoteSources(note,snapshots,orderId){
 if(note.order_id!==orderId||!String(note.text).split('\n').includes('Saved order-read comparison: '+orderId))return [];
 const refs=[],seen=new Set();
 for(const line of String(note.text).split('\n')){
  const match=/^(Earlier|Later) read (\S+) · /.exec(line);if(!match)continue;
  const key=match[1]+':'+match[2];if(seen.has(key))continue;seen.add(key);
  const candidates=snapshots.filter(read=>read.order_id===orderId&&(!read.resource_kind||read.resource_kind==='order')&&(note.source==='shared'?read.source==='imported_packet'&&read.reported_read_id===match[2]:read.id===match[2]));
  refs.push({label:match[1]+' source',id:candidates.length===1?candidates[0].id:null,reference:match[2],reason:candidates.length>1?'Several shared reads have this reference':'Source not included'});
 }
 return refs;
}
export function mountInvestigationNotes({root,getSelected,call,reload,openRecord,openQuestion,openCaptureHistory}) {
 let selected=null,notes=[],busy=false,readOnly=false,renderedState=null;
 const drafts=new Map(),expandedNotes=new Map();
 const element=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
 root.className='investigation-notes';
 const details=document.createElement('details'),summary=element('summary','','Notes'),list=element('div','investigation-note-list',''),form=element('form','stack-form note-composer',''),label=element('label','','Add a note'),input=document.createElement('textarea'),button=element('button','secondary','Save note'),status=element('p','form-feedback',''),guidance=element('p','note-meta','');
 const preview=element('section','note-draft-preview',''),editor=document.createElement('details'),editLabel=element('summary','','Edit note text'),fields=element('div','stack-form',''),actions=element('div','note-draft-actions',''),draftLabel=element('span','note-meta','Review note');
 preview.id='note-draft-preview';preview.tabIndex=-1;preview.setAttribute('aria-label','Draft note');preview.hidden=true;editor.id='note-draft-editor';editor.className='note-draft-editor';editor.open=true;editLabel.hidden=true;draftLabel.hidden=true;
 input.id='investigation-note-text';input.rows=3;input.maxLength=4000;input.required=true;input.placeholder='What needs checking, or what you found';label.htmlFor=input.id;button.type='submit';status.setAttribute('role','status');status.setAttribute('aria-live','polite');fields.append(label,input);editor.append(editLabel,fields);actions.append(draftLabel,button);form.append(actions,preview,editor,status);details.append(summary,list,guidance,form);root.append(details);
 const key=id=>'settletrace:note-draft:'+id;
 const draft=id=>{if(!drafts.has(id)){let d=null;try{d=JSON.parse(sessionStorage.getItem(key(id)))}catch{}drafts.set(id,d&&typeof d.text==='string'&&typeof d.id==='string'?d:{id:'note-'+crypto.randomUUID(),text:''});}return drafts.get(id)};
 function retain(){if(!selected)return;const d=draft(selected);d.text=input.value;try{sessionStorage.setItem(key(selected),JSON.stringify(d))}catch{}}
 input.addEventListener('input',()=>{retain();renderDraft({editing:editor.open});});
 editor.addEventListener('toggle',()=>{if(!preview.hidden&&selected){draft(selected).editing=editor.open;retain();}});
 async function save(){
  if(busy)throw Error('Wait for the current note to finish saving.');if(!selected||readOnly)throw Error('Open an editable investigation to save this note.');if(!input.value.trim())throw Error('Enter a note before saving.');retain();const id=selected,d={...draft(id)};busy=true;button.disabled=true;input.disabled=true;status.textContent='Saving…';
  try{await call('/api/investigation/note','POST',{order_id:id,text:d.text,note_id:d.id});drafts.delete(id);try{sessionStorage.removeItem(key(id))}catch{}if(selected===id){input.value='';input.rows=3;renderDraft();status.textContent='Note saved';}await reload();}
  catch(error){if(selected===id)status.textContent=error.message;throw error;}
  finally{busy=false;button.disabled=false;input.disabled=false;}
 }
 form.addEventListener('submit',async event=>{event.preventDefault();try{await save();}catch{}});
 function readingBody(content,n,state,id,refs,displayText,lead=handoffExplanation({order_id:id,operator_notes:[n]}),{draft=false}={}){
  if(lead?.plainText)return null;
  const lines=displayText.split('\n'),rows=lines.map(presentSavedObservationRow).filter(Boolean);
  const scope=lead?.scope;
  if(!rows.length&&!scope&&!lead?.followupResult)return null;
  const reading=element('div','note-reading',''),groups=new Map(),names=[...new Set(refs.map(ref=>ref.group).filter(Boolean))];
  const paragraph=(host,text,cls='note-reading-text')=>{if(text)host.append(element('p',cls,text));};
  const group=name=>{if(!groups.has(name)){const section=element('section','note-reading-group','');section.append(element('h4','note-reading-resource',name));if(draft){const answer=lead?.observationAnswer||lead?.relatedAnswer||lead?.gatheredObservations;for(const basis of answer?.groups.find(group=>group.name===name)?.sourceBasis||[])paragraph(section,basis,'note-meta');}reading.append(section);groups.set(name,section);}return groups.get(name);};
  const values=value=>Array.isArray(value)?value:typeof value==='string'?[value]:[];
  const disclosure=(host,title,texts)=>{const details=element('details','note-reading-detail','');details.append(element('summary','',title));for(const text of texts)paragraph(details,text);host.append(details);return details;};
  if(lead?.refundSubtotal)appendSavedRefundSubtotal(reading,lead.refundSubtotal);
  if(lead?.followup&&!lead.followupResult){
   if(lead.followupKind==='records'&&lead.gatheredObservations&&Object.values(findingRefusalText).includes(lead.result)){
    const context=element('section','note-reading-original-question','');
    paragraph(context,'Original question · not answered','note-reading-context');
    context.append(element('h4','note-reading-answer',lead.question));paragraph(context,lead.result);
    reading.append(context);paragraph(reading,'Records gathered for follow-up','note-reading-context');
   }else{paragraph(reading,lead.followupKind==='answer'?'Answer to the refined question':lead.followupKind==='records'?'Records for the follow-up question':'Follow-up question','note-reading-context');disclosure(reading,'Original question and result',[lead.question,lead.result]);}
  }
  if(lead?.followupResult){
   if(!draft)paragraph(reading,lead.followup||lead.question,'note-reading-answer');appendSavedFollowupResult(reading,lead.followupResult);if(lead.followup)disclosure(reading,'Original question and result',[lead.question,lead.result]);
  }else if(scope){
   appendSavedScopeObservations(reading,scope,{shared:lead.shared,renderCaptureControl:openCaptureHistory?captureId=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(captureId)?captureReferenceControl(captureId,{openHistory:!draft?opener=>openCaptureHistory(captureId,id,opener):null}):null:null});
   paragraph(reading,scope.explanation,'note-reading-answer');
   for(const text of values(scope.operatorText))paragraph(reading,text,'note-reading-operator');
   if(!scope.observations&&values(scope.reads).length)disclosure(reading,'Retained order and capture observations',values(scope.reads));
   if(values(scope.limits).length)disclosure(reading,'Limits of these observations',values(scope.limits));
  }else{
   let current=null;const conditions=[];
   for(const line of lines){
    if(!line.trim())continue;
    if(lead?.followupKind&&line.startsWith('Follow-up result: '))continue;
    if(line.startsWith('Condition: ')){conditions.push(line.slice(11));continue;}
    if(lead?.followup&&(line==='Original question: '+lead.question||line==='Original result: '+lead.result))continue;
    const named=names.find(name=>line.startsWith(name+': '));
    if(named){current=group(named);const text=line.slice(named.length+2);if(text!=='Matching retained observations')paragraph(current,text);continue;}
    const related=names.find(name=>line==='Related resource: '+name||line.startsWith('Related resource: '+name+' · '));
    if(related){current=group(related);const text=line.slice(('Related resource: '+related).length).replace(/^ · /,'');paragraph(current,text,'note-reading-related');continue;}
    const row=presentSavedObservationRow(line);
    if(row){appendSavedObservation(current||reading,row);continue;}
    const association=/^Associated capture: (\S+) · (.+)$/.exec(line);
    if(association){
     const relation=element('div','note-reading-association','');relation.append(element('span','note-reading-relationship-label','Associated capture'));
     const groupName=current?.querySelector('.note-reading-resource')?.textContent;
     const groups=lead?.gatheredObservations?.groups||lead?.observationAnswer?.groups||[];
     const recognized=groups.filter(group=>group.name===groupName&&group.associatedCapture===association[1]);
     let copyStatus;
     if(recognized.length===1&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(association[1])){
      const control=captureReferenceControl(association[1],{openHistory:!draft&&openCaptureHistory?opener=>openCaptureHistory(association[1],id,opener):null});relation.append(control.row);copyStatus=control.status;
     }else relation.append(element('code','',association[1]));
     disclosure(relation,'About this association',[association[2]]);if(copyStatus)relation.append(copyStatus);(current||reading).append(relation);continue;
    }
    paragraph(current||reading,line);
   }
   if(conditions.length)disclosure(reading,'Saved search conditions',conditions);
  }
  content.append(reading);
  const original=disclosure(content,'Original saved note',[String(n.text)]);original.classList.add('note-reading-original');
  return {groups,reading,original};
 }
 function renderDraft({editing=false}={}){
  preview.replaceChildren();let readable=false;
  if(selected&&renderedState&&input.value.trim()){
   const note={id:draft(selected).id,order_id:selected,text:input.value,source:'operator'},lead=handoffExplanation({order_id:selected,operator_notes:[note]});
   if(lead?.scope||lead?.followupResult||lead?.observationAnswer||lead?.relatedAnswer||lead?.gatheredObservations){
    const refs=findingNoteSources(note,renderedState,selected);
    const draftLimits=refundEvidenceLimits.filter(limit=>note.text.split('\n').includes('Limit: '+limit)),groupedDraftLimits=!lead.scope&&draftLimits.length===refundEvidenceLimits.length?draftLimits:[];
    const displayText=note.text.split('\n').filter(line=>!(lead.refundSubtotal&&line.startsWith('Recorded refund subtotal: '))&&!groupedDraftLimits.some(limit=>line==='Limit: '+limit)&&!/^Finding source (webhook|order_read|capture_read|refund_read) \S+ · /.test(line)&&!line.startsWith('Saved finding: ')&&!line.startsWith('Question: ')&&!line.startsWith('Source group: ')&&line!=='Retained evidence only; not a fresh provider check.').join('\n');
    preview.append(element('h3','finding-note-question',lead.followup||lead.question));
    const reading=readingBody(preview,note,renderedState,selected,refs,displayText,lead,{draft:true});
    if(reading){reading.original.remove();if(groupedDraftLimits.length){const limits=element('details','finding-note-limits','');limits.append(element('summary','','Not established: cause, buyer receipt, refundable balance'),element('p','note-text',groupedDraftLimits.join('\n')));preview.append(limits);}readable=true;}
   }
   if(!readable){preview.replaceChildren();readable=renderLimitationNote(preview,note,selected);preview.querySelector('.note-reading-original')?.remove();}
  }
  if(!readable)preview.replaceChildren();
  preview.hidden=!readable;editLabel.hidden=!readable;draftLabel.hidden=!readable;form.classList.toggle('has-note-preview',readable);button.classList.toggle('primary',readable);button.classList.toggle('secondary',!readable);label.textContent=readable?'Full note text':'Add a note';
  editor.open=!readable||editing||!!(selected&&draft(selected).editing);
 }
 return {
 save,
 pending(){return selected===getSelected()&&!readOnly?input.value.trim():'';},
 prepare(id,text){
  if(!id||id!==selected||id!==getSelected()||readOnly)return 'Open this investigation in an editable workspace to add a note.';
  if(busy)return 'Wait for the current note to finish saving.';
  retain();
  const current=input.value,next=current.includes(text)?current:current.trim()?current+'\n\n'+text:text;
  if(next.length>4000)return 'The combined note exceeds 4,000 characters. Shorten the existing draft first.';
  input.value=next;input.rows=Math.min(12,Math.max(3,next.split('\n').length));draft(id).editing=false;retain();renderDraft();details.open=true;status.textContent='Added to your note draft';return null;
 },
 focus(){if(!preview.hidden&&!editor.open){form.scrollIntoView({block:'start'});preview.focus({preventScroll:true});}else{input.focus({preventScroll:true});input.scrollIntoView({block:'center'});}},
 reveal(noteId){
  if(noteId){
   const article=[...list.children].find(item=>item.dataset.noteId===noteId);if(!article)return false;
   details.open=true;const disclosure=article.querySelector('.note-disclosure');for(const other of list.querySelectorAll('.note-disclosure'))other.open=other===disclosure;
   const anchor=article.querySelector('.note-heading')||article;if(anchor===article)article.tabIndex=-1;
   anchor.focus({preventScroll:true});article.scrollIntoView({block:'start'});return true;
  }
  details.open=true;const latest=list.querySelector('.note-disclosure');if(latest)latest.open=true;summary.focus({preventScroll:true});root.scrollIntoView({block:'start'});return true;
 },
 render(state,id){
  if(state===renderedState&&id===selected)return;
  renderedState=state;
  if(selected!==id){retain();selected=id;input.value=id?draft(id).text:'';status.textContent='';details.open=!!input.value;}
  root.hidden=!id;const sample=!!state.orders.find(o=>o.id===id)?.sample;readOnly=state.read_only_demo===true||sample;form.hidden=readOnly;guidance.hidden=!readOnly;guidance.textContent=state.read_only_demo===true?'This demo is read-only. Run your own workspace to add investigation notes.':sample?'This example is read-only. Open or import your own payment to add notes.':'';
  renderDraft();
  notes=(state.operator_notes??[]).filter(n=>n.order_id===id);summary.textContent='Notes'+(notes.length?' · '+notes.length:'');list.replaceChildren();
  for(const n of [...notes].reverse()){const article=element('article','investigation-note',''),meta=element('p','note-meta',n.source==='shared'?'Shared operator note':'Operator note');article.dataset.noteId=n.id;if(n.recorded_at){const time=element('time','',new Date(n.recorded_at).toLocaleString());time.dateTime=n.recorded_at;meta.append(' · ',time);}const findingRefs=findingNoteSources(n,state,id),lines=String(n.text).split('\n');const knownLimits=lines.filter(line=>refundEvidenceLimits.some(limit=>line==='Limit: '+limit)),groupedLimits=findingRefs.length&&new Set(knownLimits).size===refundEvidenceLimits.length&&lines.filter(line=>line.startsWith('Question: ')).length===1&&lines.filter(line=>line.startsWith('Saved finding: ')).length===1?knownLimits:[];let content=article;if(notes.length>1){const disclosure=element('details','note-disclosure',''),heading=element('summary','note-heading','');const question=lines.find(line=>line.startsWith('Question: '));const title=question?question.slice(10):lines.some(line=>line.startsWith('Saved order-read comparison: '))?'Order-read comparison':lines.find(line=>line.trim())||'Investigation note';heading.append(element('span','note-title',title.length>140?title.slice(0,137)+'…':title));const outcome=savedFindingOutcome(n,id);if(outcome)heading.append(element('span','note-outcome','Saved · '+outcome));heading.append(meta);disclosure.append(heading);content=element('div','note-content','');disclosure.append(content);article.append(disclosure);if(!expandedNotes.has(n.id))expandedNotes.set(n.id,n===notes.at(-1));disclosure.open=expandedNotes.get(n.id);disclosure.addEventListener('toggle',()=>expandedNotes.set(n.id,disclosure.open));}else article.append(meta);const savedLead=handoffExplanation({order_id:id,operator_notes:[n]});let displayText=n.text;if(findingRefs.length&&!savedLead?.plainText){const question=lines.find(line=>line.startsWith('Question: ')),subtotal=lines.find(line=>line.startsWith('Recorded refund subtotal: '));if(question&&notes.length===1)content.append(element('h3','finding-note-question',question.slice(10)));if(subtotal&&!savedLead?.refundSubtotal)content.append(element('p','finding-note-answer',subtotal));displayText=lines.filter(line=>!groupedLimits.includes(line)&&!/^Finding source (webhook|order_read|capture_read|refund_read) \S+ · /.test(line)&&!line.startsWith('Saved finding: ')&&line!==question&&line!==subtotal&&line!=='Retained evidence only; not a fresh provider check.'&&!line.startsWith('Source group: ')).join('\n');}const reading=findingRefs.length||savedLead?.followupResult?readingBody(content,n,state,id,findingRefs,displayText,savedLead):null;if(!reading&&!renderLimitationNote(content,n,id,{openQuestion,openCaptureHistory}))content.append(element('p','note-text',displayText));if(openRecord){
   const groups=new Map();for(const ref of [...comparisonNoteSources(n,state.snapshots??[],id),...findingRefs]){const label=ref.group||'';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(ref);}
   for(const [group,refs] of groups){const section=reading?.groups.get(group)||element('section','finding-note-sources','');section.classList.add('finding-note-sources');if(group&&!reading?.groups.has(group))section.append(element('h4','',group));const sources=element('div','read-source-actions','');
    for(const ref of refs){const action=element('button','secondary',ref.label);action.type='button';action.disabled=!ref.id;action.title=ref.id?ref.reference:ref.reason;action.setAttribute('aria-label',ref.label+(ref.id?'':' · '+ref.reason));if(ref.id)action.onclick=()=>openRecord({id:ref.id,kind:ref.kind||'order_read'},action);sources.append(action);}
    section.append(sources);if(!section.isConnected&&!reading?.groups.has(group)){if(reading)reading.reading.append(section);else content.append(section);}
   }
  }if(groupedLimits.length){const limits=element('details','finding-note-limits','');limits.append(element('summary','','Not established: cause, buyer receipt, refundable balance'),element('p','note-text',groupedLimits.map(line=>line.slice(7)).join('\n')));content.append(limits);}if(reading)content.append(reading.original);
  const savedQuestion=savedFindingQuestion(n,id);
  if(openQuestion&&savedQuestion){
   const action=element('button','secondary','Reopen question in Records');action.type='button';action.dataset.savedQuestion='';
   const feedback=element('p','note-meta','Search the current retained records. This saved note stays unchanged.');feedback.setAttribute('role','status');
   action.onclick=()=>{if(openQuestion(id,savedQuestion,action,savedFindingRecovery(n,id))===false)feedback.textContent='This investigation is still loading. Try again.';};
   content.append(action,feedback);
  }
  list.append(article);}
 }};
}
export function findingNoteSources(note,state,orderId){
 if(note.order_id!==orderId||!String(note.text).split('\n').includes('Saved finding: '+orderId))return [];
 const records=[...(state.events||[]).map(r=>({...r,kind:'webhook'})),...(state.snapshots||[]).map(r=>({...r,kind:r.resource_kind==='capture'?'capture_read':'order_read'})),...(state.refund_observations||[]).map(r=>({...r,kind:'refund_read'}))];
 const deliveryGroups=retainedDeliveryGroups((state.events||[]).filter(r=>r.order_id===orderId)).filter(g=>g.count>1);
 const refs=[],seen=new Set();let group=null;
 for(const line of String(note.text).split('\n')){
  if(line.startsWith('Source group: ')){group=line.slice(14).trim()||null;continue;}
  const match=/^Finding source (webhook|order_read|capture_read|refund_read) (\S+) · /.exec(line);if(!match)continue;
  const [,kind,reference]=match,key=(group||'')+':'+kind+':'+reference;if(seen.has(key))continue;seen.add(key);
  const candidates=records.filter(r=>r.order_id===orderId&&r.kind===kind&&(note.source!=='shared'||r.source==='imported_packet')&&(kind==='webhook'?r.id===reference:note.source==='shared'?r.source==='imported_packet'&&r.reported_read_id===reference:r.id===reference||r.reported_read_id===reference));
  const record=candidates.length===1?candidates[0]:null,type={webhook:'Event',order_read:'Order read',capture_read:'Capture read',refund_read:'Refund read'}[kind];
  const deliveries=record&&kind==='webhook'?deliveryGroups.find(g=>g.event_id===record.event_id&&g.deliveries.some(d=>d.source_id===record.id))?.deliveries:null;
  const receipt=deliveries?.find(d=>d.source_id===record.id);
  const observed=receipt?receipt.received_at:record&&presentTimelineRecord(record).time,date=new Date(observed),knownTime=!!observed&&Number.isFinite(date.getTime());
  const time=knownTime?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',...(receipt&&date.getUTCMilliseconds()?{fractionalSecondDigits:3}:{}),timeZone:'UTC'}).format(date)+' UTC':receipt?'Receipt time not recorded':'Time not recorded';
  const sourceType=receipt?'Receipt':type;
  const sameTime=receipt&&knownTime&&deliveries.filter(d=>d.received_at&&Date.parse(d.received_at)===date.getTime()).length>1;
  const label=record?(record.source==='imported_packet'?'Shared '+sourceType.toLowerCase():sourceType)+' · '+time+(receipt&&(!knownTime||sameTime)?' · '+reference:''):type+' · '+reference;
  refs.push({group,label,id:record?.id??null,kind,reference,reason:candidates.length>1?'Several retained observations have this reference':'Source not included'});
 }
 return refs;
}

// Reopen a recognized saved question without changing its historical answer.
export function savedFindingQuestion(note,orderId){
 if(!orderId||note?.order_id!==orderId||typeof note.text!=='string')return null;
 const lines=note.text.split('\n'),questions=lines.filter(line=>line.startsWith('Question: '));
 if(questions.length!==1)return null;
 const question=questions[0].slice(10);
 if(!question||question.length>600||question!==question.replace(/\s+/g,' ').trim())return null;
 if(lines[0]==='Saved finding: '+orderId&&lines[1]===questions[0]&&lines[2]==='Retained evidence only; not a fresh provider check.')return question;
 const scope='Search scope: retained records for '+orderId,caution='This saved search does not establish that a payment action never happened.';
 if(lines[0]===questions[0]&&lines[1]==='Result: No matching retained records.'&&lines.filter(line=>line.startsWith('Result: ')).length===1&&lines.filter(line=>line.startsWith('Search scope: ')).length===1&&lines.includes(scope)&&lines.includes(caution)&&lines.some(line=>line.startsWith('Condition: ')&&line.slice(11).trim()))return question;
 return null;
}

// A heading is a compact view of the saved text, never a fresh query of the case.
// Unknown or edited formats keep their complete note without a derived outcome.
export function savedFindingOutcome(note,orderId){
 if(!savedFindingQuestion(note,orderId))return null;
 const lines=note.text.split('\n');
 if(lines[0].startsWith('Question: ')){
  const scope='Search scope: retained records for '+orderId,caution='This saved search does not establish that a payment action never happened.';
  if(lines.filter(line=>line===scope).length!==1||lines.filter(line=>line===caution).length!==1||!lines.slice(2).every(line=>line===scope||line===caution||line.startsWith('Condition: ')&&line.slice(11).trim()))return null;
  return 'No matching retained records';
 }
 const lead=handoffExplanation({order_id:orderId,operator_notes:[note]}),answer=lead?.observationAnswer;
 if(answer){
  if(answer.groups.some(group=>!Array.isArray(group.sourceModes)||!group.sourceModes.length))return null;
  const modes=new Set(answer.groups.flatMap(group=>group.sourceModes));
  if([...modes].some(mode=>!['saved','shared','authored'].includes(mode)))return null;
  const shared=lead.shared||modes.has('shared'),authored=modes.has('authored');
  let basis='';
  if(authored)basis=modes.size===1?(lead.shared?'Shared example · ':'Authored example · '):(shared?'Includes shared and example observations · ':'Includes example observations · ');
  else if(shared)basis=lead.shared||modes.size===1?'Shared claim · ':'Includes shared observations · ';
  const rows=answer.groups.flatMap(group=>group.observations),values=new Set(rows.map(row=>JSON.stringify([row.amount,row.status])));
  if(answer.groups.length===1&&values.size===1){const row=rows[0],kind=answer.groups[0].name.split(' ')[0];return basis+kind+(row.amount?' '+row.amount:'')+' · '+row.status.replaceAll('_',' ');}
  return basis+rows.length+' observations';
 }
 let index=3;
 while(lines[index]?.startsWith('Condition: ')){if(!lines[index++].slice(11).trim())return null;}
 for(const limit of refundEvidenceLimits)if(lines[index++]!=='Limit: '+limit)return null;
 const groups=[],names=new Set();
 while(index<lines.length){
  const match=/^Refund ([A-Za-z0-9_-]+): ((?:(?:Shared claim|Authored example|Unverified claim) · )?Refund (?:[A-Z]{3} \d+(?:\.\d+)?|amount not supplied) · (?:[A-Z][A-Z_]*|Status unavailable))$/.exec(lines[index++]||'');
  if(!match||names.has(match[1])||lines[index++]!=='Source group: Refund '+match[1])return null;
  names.add(match[1]);const sources=new Set();let source;
  while((source=/^Finding source (webhook|refund_read) (\S+) · (shared|saved|authored) observation$/.exec(lines[index]||''))){const key=source[1]+':'+source[2];if(sources.has(key))return null;sources.add(key);index++;}
  if(!sources.size||!/^Associated capture: (?:[A-Za-z0-9_-]+|not recorded) · association retained with the refund; not a fresh capture check$/.test(lines[index++]||''))return null;
  groups.push(match[2]);
 }
 return groups.length===1?groups[0]:groups.length?groups.length+' refund records':null;
}

// Restore only a fully recognized gathered-records note. Unknown or edited
// formats keep the existing plain-question replay without inferred context.
export function savedFindingRecovery(note,orderId){
 const question=savedFindingQuestion(note,orderId);if(!question)return null;
 const lead=handoffExplanation({order_id:orderId,operator_notes:[note]});
 if(lead?.followupKind!=='records'||!lead.gatheredObservations||lead.followup!==question)return null;
 const original=lead.question;
 if(!original||original===question||original.length>600||original!==original.replace(/\s+/g,' ').trim())return null;
 const entry=Object.entries(findingRefusalText).find(([reason,text])=>reason!=='question_too_long'&&text===lead.result);
 return entry?{originalQuestion:original,reason:entry[0],recordsOnly:true}:null;
}
