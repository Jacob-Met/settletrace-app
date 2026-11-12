import {captureReferenceControl} from './capture-reference.mjs';
import {findingRefusalText,limitationCaptureCopy} from './finding-search.mjs';

export function parseLimitationNote(note,orderId){
 if(!orderId||note?.order_id!==orderId||typeof note.text!=='string')return null;
 const lines=note.text.split('\n'),question=lines[1]?.startsWith('Question: ')?lines[1].slice(10):'';
 if(lines[0]!=='Saved limitation: '+orderId||!question||question.length>600||question!==question.replace(/\s+/g,' ').trim()||lines[2]!=='Result: Question not answered.')return null;
 const reasons=Object.entries(findingRefusalText).filter(([reason,text])=>reason!=='question_too_long'&&lines[3]==='Limitation: '+text);
 if(reasons.length!==1)return null;
 const [reason,limitation]=reasons[0];let index=4,nextCheck=null,previous=null;
 const candidate=lines[index]||'',copy=limitationCaptureCopy;
 if(reason==='refundable_balance_not_recorded'){
  if(candidate.startsWith(copy.singlePrefix)&&candidate.endsWith(copy.singleSuffix)){
   const captureId=candidate.slice(copy.singlePrefix.length,-copy.singleSuffix.length);
   if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(captureId))return null;
   nextCheck={captureId,text:copy.singleSuffix.slice(3)};index++;
  }else if(candidate===copy.multiple||candidate===copy.missing){nextCheck={captureId:null,text:candidate};index++;}
 }
 if(lines[index]?.startsWith('Original question: ')){
  const originalQuestion=lines[index].slice(19),originalResult=lines[index+1]?.startsWith('Original result: ')?lines[index+1].slice(17):'';
  if(!originalQuestion||originalQuestion===question||originalQuestion.length>600||originalQuestion!==originalQuestion.replace(/\s+/g,' ').trim()||!Object.values(findingRefusalText).includes(originalResult))return null;
  previous={question:originalQuestion,result:originalResult};index+=2;
 }
 if(lines[index]!=='Search scope: retained records for '+orderId||lines[index+1]!=='Retained evidence only; not a fresh provider check.'||lines.length!==index+2)return null;
 return {question,result:'Question not answered.',limitation,orderId,nextCheck,previous};
}

export function renderLimitationNote(content,note,orderId,{openQuestion,openCaptureHistory}={}){
 const value=parseLimitationNote(note,orderId);if(!value)return false;
 const element=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 const disclosure=(parent,title,texts,cls='')=>{const el=element('details','note-reading-detail '+cls);el.append(element('summary','',title));for(const text of texts)el.append(element('p','note-text',text));parent.append(el);return el;};
 const reading=element('section','limitation-reading');
 reading.append(element('p','limitation-result',value.result),element('h3','',value.question),element('p','limitation-message',value.limitation));
 if(value.nextCheck){
  const next=element('section','limitation-next-check');next.append(element('h4','','Next check'));
  let copyStatus;
  if(value.nextCheck.captureId){
   const control=captureReferenceControl(value.nextCheck.captureId,{openHistory:openCaptureHistory?opener=>openCaptureHistory(value.nextCheck.captureId,orderId,opener):null});copyStatus=control.status;next.append(control.row);
  }
  next.append(element('p','note-reading-text',value.nextCheck.text));if(copyStatus)next.append(copyStatus);reading.append(next);
 }
 if(value.previous)disclosure(reading,'Original question and result',[value.previous.question,value.previous.result]);
 reading.append(element('p','note-meta','Retained records for '+value.orderId+' · not a fresh provider check.'));
 if(openQuestion){
  const action=element('button','secondary','Reopen question in Records');action.type='button';action.dataset.savedQuestion='';
  const feedback=element('p','note-meta','Search the current retained records. This saved note stays unchanged.');feedback.setAttribute('role','status');
  action.onclick=()=>{if(openQuestion(value.orderId,value.question,action)===false)feedback.textContent='This investigation is still loading. Try again.';};
  reading.append(action,feedback);
 }
 content.append(reading);disclosure(content,'Original saved note',[note.text],'note-reading-original limitation-original');return true;
}
