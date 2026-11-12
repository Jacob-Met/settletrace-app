import {mountPaymentTrace} from './payment-trace.mjs';
import {mountFindingSearch} from './finding-search.mjs';
import {resourceFindingCatalog,orderCaptureScopeFindings} from './finding-catalog.mjs';
import {mountInvestigationNotes,savedFindingQuestion,savedFindingOutcome} from './investigation-notes.mjs';
import {mountDisputeStart} from './dispute-start.mjs';
import {mountDisputeEvidence} from './dispute-evidence.mjs';
import {mountReportIntake} from './report-intake.mjs';
import {mountWorkspaceShell} from './workspace-shell.mjs';
import {presentCase,presentTimelineRecord,formatTimelineClock,presentOrderReadCaptures,overviewTimeline,chronologicalActivity} from './case-presentation.mjs';
import {renderReadComparison} from './read-comparison.mjs';
import {mountIncidentSummary,scopePresentation,appendSavedScopeObservations} from './incident-summary.mjs';
import {createDeliveryInspector} from './delivery-inspector.mjs';
import {selectCaptureRefunds} from './refund-selection.mjs';
const refundReadsPending=new Set();
import {changedSourceMenu} from './changed-source-menu.mjs';
import {eventDiscovery} from './event-discovery.mjs';
import {installWebhookSetup} from './webhook-setup-ui.mjs';
import {evidenceFinder,matchingReferences} from './evidence-filter.mjs';
import {isProviderRead,hasEventAuthority} from './event-origin.mjs';
const el=id=>document.getElementById(id);
let state={orders:[],events:[],connected:false,ai_connected:false,webhook_configured:false},selected=null,diagnosis=null,analysisVersion=0;
let restoreInitialSelection=true;
const selectedInvestigationKey='settletrace:selected-investigation';
function rememberSelectedInvestigation(){
 try{if(selected)sessionStorage.setItem(selectedInvestigationKey,selected);else sessionStorage.removeItem(selectedInvestigationKey);}catch{}
}
function restoreSelectedInvestigation(){
 if(!restoreInitialSelection)return;
 restoreInitialSelection=false;
 let retained=null;try{retained=sessionStorage.getItem(selectedInvestigationKey);}catch{}
 if(!selected&&retained&&incidents().some(order=>order.id===retained)){
  selected=retained;
  el('investigation-view').value=state.investigation_work?.[selected]?.archived?'archived':'active';
 }
}
const investigationNotes=mountInvestigationNotes({root:el('investigation-notes'),getSelected:()=>selected,call,reload:load,openRecord:openEvidenceRecord,openQuestion:openSavedQuestion,openCaptureHistory:(captureId,orderId,opener)=>openCaptureHistory(captureId,orderId,opener,{rememberOrigin:true})});
function openSavedQuestion(orderId,question,opener,recovery){
 if(orderId!==selected)return false;
 return findingFinder.openQuestion(orderId,question,()=>{
  workspaceShell.rememberSourceOrigin(opener);
  workspaceShell.closeDialogs();
  workspaceShell.closeInvestigations({restoreFocus:false});
  workspaceShell.showView('records',{resetScroll:false,preserveSourceReturn:true});
 },recovery);
}
const workspaceShell=mountWorkspaceShell({getSelected:()=>selected});
const appendOriginalDelivery=createDeliveryInspector({call,getState:()=>state,onVerified:async()=>{clearExplanation();await load();}});
const paymentTrace=mountPaymentTrace({root:el('overview-activity'),inspector:el('trace-inspector'),onOpenSource:openEvidenceRecord,appendOriginalDelivery});
const captureReadViews=new Map();
const disputeEvidence=mountDisputeEvidence(el('dispute-evidence'),{call,onRead:async()=>{clearExplanation();await load();}});
let orderReadPending=null,navigationVersion=0;
const disputeStart=mountDisputeStart(el('dispute-start'),{call,onBegin:()=>navigationVersion,onRead:async(result,navigation)=>{
 const follow=navigation===navigationVersion;
 if(follow){navigationVersion++;selected=result.order_id;clearExplanation();}
 await load();
 if(follow&&navigationVersion===navigation+1&&selected===result.order_id){workspaceShell.closeDialogs();workspaceShell.showView('records',{resetScroll:false});disputeEvidence.focus(result.dispute.id);}
 else message('Saved dispute '+result.dispute.dispute_id+' in '+result.order_id+'. Your current investigation remains open.',true);
}});

const orderReadStatus=new Map();
for(const [name,anchor] of [['inspect',el('inspect-form')],['reread',el('reread').parentElement]]){
 const status=node('div','order-read-status');status.id=name+'-read-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;anchor.after(status);orderReadStatus.set(name,status);
}
function readFeedback(origin,text,orderId=null){
 const status=orderReadStatus.get(origin);status.hidden=false;status.replaceChildren(node('span','',text));
 if(orderId){const open=node('button','secondary','View '+orderId+' →');open.type='button';open.onclick=()=>choose(orderId);status.append(open);}
}
function readControls(){
 el('inspect-submit').disabled=!state.connected||!!orderReadPending;
 el('inspect-submit').textContent=orderReadPending?.origin==='inspect'?'Reading Sandbox…':'Inspect order ↗';
 const current=state.orders.find(x=>x.id===selected);
 el('reread').disabled=!selected||(!current?.sample&&!state.connected)||!!orderReadPending;
 el('reread').textContent=orderReadPending?.origin==='reread'?'Refreshing…':current?.sample?'Inspect a payment':current?'Refresh payment':'Inspect payment';
 el('inspect-form').setAttribute('aria-busy',String(orderReadPending?.origin==='inspect'));
 el('reread').setAttribute('aria-busy',String(orderReadPending?.origin==='reread'));
}
async function readOrder(id,origin){
 if(orderReadPending)return;
 id=id.trim().toUpperCase();if(!id)return;
 const navigation=++navigationVersion;orderReadPending={id,origin};readControls();
 readFeedback(origin,'Reading '+id+' from PayPal Sandbox… Your saved evidence remains available.');
 try{
  const result=await call('/api/order/inspect','POST',{order_id:id});
  const follow=origin==='inspect'&&navigation===navigationVersion;
  if(follow)selected=result.order.id;
  clearExplanation();await load();if(follow)focusReview();
  readFeedback(origin,result.applied===false?'Earlier request for '+result.order.id+' finished after a newer read. Retained both observations in history; kept the newer requested read ('+result.order.status+').':'Saved Sandbox read for '+result.order.id+': '+result.order.status+'.',selected!==result.order.id?result.order.id:null);
 }catch(error){readFeedback(origin,'Could not read '+id+': '+error.message+'. Saved evidence is unchanged.');}
 finally{orderReadPending=null;readControls();}
}
let readingEvent=false;
const eventBrowser=eventDiscovery(el('event-discovery'),{call,inspect:id=>{el('event-id').value=id;el('event-inspect-form').requestSubmit();}});
const refundDetail=e=>'Refund '+(e.refund_id||e.resource_id)+(e.refund_amount?' · This refund amount: '+e.refund_amount.currency+' '+e.refund_amount.value:' · Amount not supplied')+' · '+(e.refund_status||'Status not supplied');
function message(text,good=false){const b=el('banner');b.textContent=text;b.className='banner'+(good?' success':'');b.hidden=!text;}
async function call(uri,method='GET',data){const r=await fetch(uri,{method,headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j;}
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function put(target,items,empty){target.replaceChildren();if(!items.length){target.append(node('p','empty',empty));return;}for(const item of items)target.append(item);}
function eventReadAvailability(){eventBrowser.update({connected:state.connected,reading:readingEvent});el('event-inspect-submit').disabled=!state.connected||readingEvent;el('event-id').disabled=readingEvent;}
function connections(){document.body.dataset.paypalConnected=String(state.connected);if(el('inspector-connect'))el('inspector-connect').hidden=state.connected;eventReadAvailability();const list=el('connection-list');put(list,[['PayPal Sandbox',state.connected],['Webhook verifier',state.webhook_configured],['AI inference',state.ai_connected]].map(([label,ok])=>{const line=node('div','connection');line.append(node('span','light'+(ok?' ok':'')),node('strong','',label),node('span','',ok?'CONFIGURED':'NOT SET'));return line;}),'');el('ai-status').textContent=state.ai_connected?'READY':'OFFLINE';el('inspect-submit').disabled=!state.connected||!!orderReadPending;el('source-notice').textContent=state.connected?'Sandbox credentials configured · order inspection contacts PayPal':'Sandbox credentials not configured · use Connection settings below';}
function incidents(){const known=new Map(state.orders.map(o=>[o.id,o]));for(const e of state.events)if(e.order_id&&!known.has(e.order_id))known.set(e.order_id,{id:e.order_id,status:'NOT OBSERVED',eventOnly:true});for(const read of state.snapshots||[])if(read.resource_kind==='capture'&&read.order_id&&!known.has(read.order_id))known.set(read.order_id,{id:read.order_id,status:'NOT OBSERVED',captureOnly:true});return [...known.values()];}
function rankingAvailability(){
 const count=diagnosis?diagnosis.notes.length+diagnosis.actions.length:0;
 el('explain').disabled=!selected||!state.ai_connected||!diagnosis||count<2;el('explain').closest('.assistant').hidden=el('explain').disabled;
 el('explain').textContent=diagnosis&&count<2?'No ranking needed':'Prioritize checks';
 if(diagnosis&&count<2)el('explanation').textContent='';
}
function clearExplanation(){findingFinder.clear();disputeEvidence.update(null,state.connected);renderReadComparison(null,el('capture-comparison'));el('payment-amount').textContent='—';el('payment-currency').textContent='';el('case-summary').replaceChildren();paymentTrace.clear();el('payment-facts').replaceChildren();analysisVersion++;diagnosis=null;el('explanation').textContent='';rankingAvailability();}
function focusReview(){workspaceShell.closeDialogs();workspaceShell.closeInvestigations({restoreFocus:false});workspaceShell.showView('overview');el('review-heading').focus({preventScroll:true});}
function choose(id){navigationVersion++;selected=id;message('');clearExplanation();render();const loading=loadPacket();focusReview();return loading;}
function investigationReferences(o){
 const refs=[['Order',o.id],['Local name',state.investigation_work?.[o.id]?.name],['Order status',o.status]];
 for(const u of o.units||[])for(const c of u.captures||[])refs.push(['Capture',c.id],['Capture status',c.status]);
 for(const e of state.events.filter(e=>e.order_id===o.id))refs.push(['Event',e.event_id||e.id],['Observation',e.id],['Resource',e.resource_id],['Capture',e.capture_id],['Transmission',e.transmission_id],['Event type',e.type]);
 for(const read of (state.snapshots||[]).filter(r=>r.order_id===o.id)){refs.push(['Read',read.id],['Shared read reference',read.reported_read_id]);for(const c of read.captures||[])refs.push(['Historical capture',c.id],['Historical capture status',c.status]);}
 for(const refund of (state.refund_observations||[]).filter(r=>r.order_id===o.id))refs.push(['Refund',refund.refund_id],['Refund observation',refund.id],['Shared read reference',refund.reported_read_id],['Refund capture',refund.capture_id],['Recorded refund status',refund.status]);
 for(const dispute of (state.dispute_observations||[]).filter(r=>r.order_id===o.id))refs.push(['Dispute',dispute.dispute_id],['Dispute status',dispute.status]);
 for(const note of [...(state.operator_notes||[])].reverse())if(note.order_id===o.id){
  const question=savedFindingQuestion(note,o.id),source=note.source==='shared'?'Shared ':'Saved ';
  if(question)refs.push([source+'question',question,{noteId:note.id}]);
  refs.push([source+'note',String(note.text),{noteId:note.id}]);
 }
 return refs.filter(([,value])=>value);
}
function investigationSearchMatch(refs,terms,query){
 const exact=refs.find(([,value])=>String(value).toLowerCase()===query);if(exact)return exact;
 const phrase=query.replace(/\s+/g,' '),whole=refs.find(([,value])=>String(value).replace(/\s+/g,' ').toLowerCase().includes(phrase));if(whole)return whole;
 const matching=refs.map(ref=>({ref,count:terms.filter(term=>String(ref[1]).toLowerCase().includes(term)).length})).filter(match=>match.count);
 const secondary=ref=>Number(ref[0].toLowerCase().includes('status')||ref[0]==='Event type');
 matching.sort((a,b)=>b.count-a.count||secondary(a.ref)-secondary(b.ref));
 return matching[0]?.ref;
}
function investigationMatchPreview(value,terms,limit=140){
 const lines=String(value).split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean),phrase=terms.join(' ');
 const score=line=>terms.filter(term=>line.toLowerCase().includes(term)).length;
 lines.sort((a,b)=>Number(b.toLowerCase().includes(phrase))-Number(a.toLowerCase().includes(phrase))||score(b)-score(a));
 const text=lines[0]||'';if(text.length<=limit)return text;
 const lower=text.toLowerCase(),positions=terms.map(term=>lower.indexOf(term)).filter(index=>index>=0);
 let start=Math.max(0,Math.min(positions.length?Math.min(...positions)-32:0,text.length-limit));
 if(start){const boundary=text.indexOf(' ',start);if(boundary>=0&&boundary<Math.min(...positions))start=boundary+1;}
 let end=Math.min(text.length,start+limit);if(end<text.length){const boundary=text.lastIndexOf(' ',end);if(boundary>start+limit/2)end=boundary;}
 return (start?'…':'')+text.slice(start,end).trim()+(end<text.length?'…':'');
}
function renderInvestigations(){
 const query=el('incident-search').value.trim().toLowerCase(),terms=query.split(/\s+/).filter(Boolean),scope=el('investigation-view').value,cases=incidents().reverse(),all=cases.filter(o=>scope==='all'||(scope==='archived')===!!state.investigation_work?.[o.id]?.archived);
 const matches=all.map(o=>({o,refs:investigationReferences(o)})).filter(({refs})=>terms.every(term=>refs.some(([,value])=>String(value).toLowerCase().includes(term))));
 el('order-count').textContent=query?matches.length+' / '+all.length:String(all.length).padStart(2,'0');
 el('clear-incident-search').hidden=!query;
 const hiddenSelection=selected&&!matches.some(({o})=>o.id===selected);
 el('incident-search-summary').textContent=query?matches.length+' of '+all.length+' investigations match.'+(terms.length>1?' Terms may match different records in the same investigation.':'')+(hiddenSelection?' The current investigation remains open.':''):'Search '+scope+' investigations by reference, status or saved note.'+(hiddenSelection?' The current investigation remains open.':'');
 const orders=matches.map(({o,refs})=>{
  const b=node('button','order-item'+(selected===o.id?' active':''));b.type='button';b.setAttribute('aria-pressed',String(selected===o.id));
  b.append(node('span',''));const localName=state.investigation_work?.[o.id]?.name;b.firstChild.append(node('strong','',localName||o.title||o.id));if(localName)b.firstChild.append(node('small','case-local-reference',o.id));b.firstChild.append(node('small','',o.starter?'Example payment':o.imported?'Shared investigation':o.sample?'Example':o.captureOnly?'Capture':o.eventOnly?'Event received':'Payment'));
  const match=query?investigationSearchMatch(refs,terms,query):null;
  if(match&&match[0]!=='Order')b.firstChild.append(node('small','matched-reference',match[0]+': '+investigationMatchPreview(match[1],terms)));
  if(match?.[2]?.noteId){
   const note=(state.operator_notes||[]).find(n=>n.id===match[2].noteId&&n.order_id===o.id),outcome=note&&savedFindingOutcome(note,o.id);
   if(outcome)b.firstChild.append(node('small','matched-outcome','Saved · '+outcome));
  }
  if(state.investigation_work?.[o.id]?.new_evidence)b.firstChild.append(node('small','matched-reference','New evidence since archive'));
  if(state.investigation_work?.[o.id]?.archived)b.firstChild.append(node('small','workflow-state','Archived locally'));
  b.append(node('span','tag'+(o.sample?' sample':''),'Order: '+o.status));b.onclick=async()=>{
   const reads=[...(state.snapshots||[]).map(r=>({...r,kind:r.resource_kind==='capture'?'capture_read':'order_read'})),...(state.refund_observations||[]).map(r=>({...r,kind:'refund_read'}))];
   const exact=query?reads.filter(r=>r.order_id===o.id&&[r.id,r.reported_read_id].some(id=>id&&String(id).toLowerCase()===query)):[];
   const navigation=navigationVersion+1;await choose(o.id);if(selected!==o.id||navigationVersion!==navigation)return;
   if(exact.length===1)openEvidenceRecord(exact[0]);
   else if(match?.[2]?.noteId)investigationNotes.reveal(match[2].noteId);
  };return b;
 });
 put(el('orders'),orders,query?'No '+(scope==='all'?'saved':scope)+' investigation matches this search.':scope==='archived'?'No archived investigations.':incidents().length?'No active investigations. Choose Archived or All to reopen saved evidence.':'No investigations yet. Import a webhook, inspect a Sandbox order ID, or explore the labeled example.');
 const otherScope=scope==='active'?'archived':'active';
 const otherMatches=query&&scope!=='all'?cases.filter(o=>(otherScope==='archived')===!!state.investigation_work?.[o.id]?.archived).filter(o=>{const refs=investigationReferences(o);return terms.every(term=>refs.some(([,value])=>String(value).toLowerCase().includes(term)));}):[];
 if(otherMatches.length){
  const recovery=node('div','scope-search-recovery');
  const count=otherMatches.length,label=count+' matching '+otherScope+' investigation'+(count===1?'':'s');
  recovery.append(node('p','quiet',label+'.'));
  const action=node('button','text-button','Show '+(otherScope==='archived'?'Archived':'Active')+' matches');action.type='button';action.dataset.searchScope=otherScope;
  action.onclick=()=>{el('investigation-view').value=otherScope;renderInvestigations();el('orders').querySelector('.order-item')?.focus();};
  recovery.append(action);el('orders').append(recovery);
 }

}
el('investigation-view').onchange=renderInvestigations;
el('incident-search').addEventListener('input',renderInvestigations);
el('clear-incident-search').onclick=()=>{el('incident-search').value='';renderInvestigations();el('incident-search').focus();};
const unresolvedCapture=e=>e.type==='PAYMENT.CAPTURE.REFUNDED'?e.capture_id:e.type?.startsWith('PAYMENT.CAPTURE.')?e.resource_id:null;
function openEvidenceRecord(record,opener){
 workspaceShell.rememberSourceOrigin(opener);
 workspaceShell.closeDialogs();workspaceShell.showView('activity',{resetScroll:false});
 filterEvidence.showRecord(record.id,record.kind);
 const target=[...el('timeline').children].find(x=>x.dataset.recordId===record.id&&x.dataset.recordKind===record.kind);
 if(target){const details=target.querySelector('.activity-record-details');if(details)details.open=true;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
}
const updateChangedSources=changedSourceMenu(el('changed-sources'),{
 openRecord:record=>{
  if(record.kind==='dispute_read'){workspaceShell.closeDialogs();workspaceShell.showView('records',{resetScroll:false});disputeEvidence.focus(record.id);return;}
  openEvidenceRecord(record);
 },
 openHistory:()=>{workspaceShell.closeDialogs();workspaceShell.showView('activity',{resetScroll:false});filterEvidence.showAll();const target=el('timeline');target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});},
 openSummary:()=>{workspaceShell.closeDialogs();focusReview();}
});
function renderWork(){
 const nameInput=el('investigation-name-input'),localName=state.investigation_work?.[selected]?.name||'';
 if(nameInput.dataset.orderId!==(selected||'')||document.activeElement!==nameInput)nameInput.value=localName;
 nameInput.dataset.orderId=selected||'';nameInput.disabled=!selected||state.read_only_demo===true;
 el('investigation-name-form').hidden=!selected||state.read_only_demo===true;el('save-investigation-name').disabled=savingInvestigationName||!selected;el('clear-investigation-name').disabled=savingInvestigationName||!localName;
 el('investigation-name').textContent=localName?'Local name · '+localName:'';el('investigation-name').hidden=!localName;
 const work=state.investigation_work?.[selected],button=el('archive-investigation');
 button.disabled=!selected;button.textContent=work?.archived?'Return to active investigations':'Archive investigation';
 el('investigation-work-status').textContent=!selected?'':work?.archived?'Archived locally · '+work.archived_at:work?.new_evidence?'New evidence since archive · returned to Active':'Active investigation';
 updateChangedSources(work);
}

let savingInvestigationName=false;
async function saveInvestigationName(event){
 event.preventDefault();if(savingInvestigationName||!selected)return;
 const id=selected,input=el('investigation-name-input'),feedback=el('investigation-name-status'),name=input.value;
 savingInvestigationName=true;el('save-investigation-name').disabled=true;el('clear-investigation-name').disabled=true;feedback.textContent='Saving local name…';
 try{
  await call('/api/investigation/name','POST',{order_id:id,name});await load();
  if(selected===id)feedback.textContent=name.trim()?'Local name saved.':'Local name cleared.';
  else message('Saved local name for '+id+'. Your current investigation remains open.',true);
 }catch(error){if(selected===id)feedback.textContent=error.message;else message(error.message);}
 finally{savingInvestigationName=false;renderWork();}
}
el('investigation-name-form').onsubmit=saveInvestigationName;
el('clear-investigation-name').onclick=()=>{el('investigation-name-input').value='';el('investigation-name-form').requestSubmit();};

el('archive-investigation').onclick=async()=>{
 const id=selected,work=state.investigation_work?.[id],button=el('archive-investigation');
 if(!id)return;button.disabled=true;
 try{await call('/api/investigation/archive','POST',{order_id:id,archived:!work?.archived,evidence_version:work?.evidence_version});await load();if(selected===id){const current=state.investigation_work?.[id];el('investigation-work-status').textContent=current?.new_evidence?'New evidence arrived · investigation is Active':current?.archived?'Archived locally. Evidence is kept and can be reopened from Archived.':'Returned to Active. Evidence unchanged.';button.focus({preventScroll:true});}}
 catch(err){if(selected===id){el('investigation-work-status').textContent=err.message;button.disabled=false;}else message(id+': '+err.message);}
};
const unlinkedRefundBusy=new Set(),unlinkedRefundMessages=new Map();
function renderUnresolvedRefunds(){
 const pending=state.events.filter(e=>!e.order_id&&/^[A-Z0-9-]{6,64}$/i.test(unresolvedCapture(e)||''));
 const section=el('unresolved-refunds');section.hidden=!pending.length;
 put(el('unresolved-refund-list'),pending.map(e=>{
  const item=node('li','unresolved-refund');item.dataset.unlinkedEvent=e.id;
  item.append(node('strong','',e.type==='PAYMENT.CAPTURE.REFUNDED'?refundDetail(e):e.type),node('code','','Capture '+unresolvedCapture(e)),node('small','',isProviderRead(e)?'PayPal event API read · no delivery signature':e.verified?'PayPal signature verified · order unresolved':'Unverified evidence · order unresolved'));
  const action=node('button','secondary',state.connected?'Find order from capture':'Connect PayPal to find order');action.type='button';
  const feedback=node('p','quiet',state.connected?'Reads the capture and its related order from PayPal Sandbox.':'Configure PayPal Sandbox in the setup guide to look up this capture. Evidence is saved.');
  feedback.setAttribute('role','status');
  action.onclick=async()=>{
   if(!state.connected){if(workspaceShell.openDialog('settings-dialog'))el('sandbox-setup').open=true;return;}
   const startVersion=++navigationVersion;action.disabled=true;feedback.textContent='Reading capture and related order…';
   try{const result=await call('/api/event/resolve','POST',{event_id:e.id});const stay=navigationVersion===startVersion;if(stay){selected=result.order_id;clearExplanation();}await load();message('Event joined to '+result.order_id+' from the exact Sandbox capture. Its original verification status is unchanged.',true);if(stay){workspaceShell.closeDialogs();workspaceShell.showView('records');const heading=el('capture-heading');heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}}
   catch(error){feedback.textContent=error.message+' Your event evidence is saved. Try again when the connection is available.';action.disabled=false;}
  };
  item.append(action,feedback);appendOriginalDelivery(item,e);return item;
 }),'');
 const refunds=new Map();
 for(const r of state.refund_observations||[]){if(r.order_id)continue;const old=refunds.get(r.refund_id);if(!old||(r.requested_at||r.observed_at||'')>=(old.requested_at||old.observed_at||''))refunds.set(r.refund_id,r);}
 if(refunds.size)section.hidden=false;
 for(const r of refunds.values()){
  const item=node('li','unresolved-refund');item.dataset.unlinkedRefund=r.refund_id;
  item.append(node('strong','','Refund '+r.refund_id),node('span','',r.status+' · '+(r.amount?r.amount.currency+' '+r.amount.value:'Amount not supplied')),node('code','','Capture '+(r.capture_id||'not supplied')),node('small','',r.source==='sandbox_refund_api'?'PayPal refund read · payment unlinked':'Shared refund claim · payment unlinked'));
  const action=node('button','secondary','Find payment');action.type='button';action.disabled=!state.connected||unlinkedRefundBusy.has(r.refund_id);
  const feedback=node('p','quiet',unlinkedRefundMessages.get(r.refund_id)||(state.connected?'Reads the refund and its exact related payment.':'Connect Sandbox to find this payment. Refund evidence is saved.'));feedback.setAttribute('role','status');
  action.onclick=async()=>{
   const version=++navigationVersion;unlinkedRefundBusy.add(r.refund_id);action.disabled=true;feedback.textContent='Reading refund and related payment…';
   try{const result=await call('/api/refund/inspect','POST',{refund_id:r.refund_id,resolve_order:true});const stay=navigationVersion===version;
    if(result.order_id){unlinkedRefundMessages.delete(r.refund_id);if(stay){selected=result.order_id;clearExplanation();}}
    else unlinkedRefundMessages.set(r.refund_id,result.resolution_error||'Refund saved. No exact payment association was supplied.');
    unlinkedRefundBusy.delete(r.refund_id);await load();if(result.order_id&&stay){workspaceShell.closeDialogs();workspaceShell.showView('records');el('capture-heading').focus({preventScroll:true});}
   }catch(error){unlinkedRefundBusy.delete(r.refund_id);unlinkedRefundMessages.set(r.refund_id,error.message+' Saved refund evidence is unchanged.');renderUnresolvedRefunds();}
  };
  item.append(action,feedback);el('unresolved-refund-list').append(item);
 }
}
const filterEvidence=evidenceFinder(el('timeline'),()=>render());
const findingFinder=mountFindingSearch(el('view-records'),{renderFinding,canDraftNote:()=>!state.read_only_demo&&!state.orders.find(o=>o.id===selected)?.sample,draftNote:text=>{const error=investigationNotes.prepare(selected,text);if(!error){workspaceShell.showView('overview',{resetScroll:false});investigationNotes.focus();}return error;}});
const summaryHandoff=mountIncidentSummary(el('packet'),{getSelected:()=>selected,loadPacket:id=>call('/api/packet?order_id='+encodeURIComponent(id)),pendingNote:()=>investigationNotes.pending(),saveNote:()=>investigationNotes.save()});
const nextStep=el('findings').closest('.next-step');
const traceSide=document.querySelector('.trace-side'),tracePreview=document.querySelector('.trace-workspace>.activity-preview');
const phoneTrace=window.matchMedia('(max-width:760px)');
function placeNextStep(){
 if(phoneTrace.matches)tracePreview.before(nextStep);
 else traceSide.append(nextStep);
}
phoneTrace.addEventListener('change',placeNextStep);
placeNextStep();

el('open-investigation-notes').onclick=()=>{workspaceShell.showView('overview',{resetScroll:false});investigationNotes.reveal();};
function renderFirstUse(){
 const observations=[...incidents(),...state.events,...(state.snapshots||[]),...(state.refund_observations||[]),...(state.dispute_observations||[])];
 el('first-use-entry').hidden=state.read_only_demo===true||observations.some(record=>!record.sample);
}
el('open-first-investigation').onclick=()=>{
 if(!workspaceShell.openDialog('tools-dialog'))return;
 el('packet-file').closest('.tool-section').open=true;
 el('packet-file').focus();
};
function render(){rememberSelectedInvestigation();renderFirstUse();investigationNotes.render(state,selected);const notes=(state.operator_notes||[]).filter(n=>n.order_id===selected);const noteEntry=el('open-investigation-notes');noteEntry.hidden=!notes.length;noteEntry.textContent=(notes.every(n=>n.source==='shared')?'Read shared note':'Read note')+(notes.length===1?'':'s')+' · '+notes.length;disputeStart.update(state.connected);summaryHandoff.update();el('review-context').textContent=selected||'No investigation selected';connections();renderInvestigations();renderWork();renderUnresolvedRefunds();const events=state.events.filter(e=>e.order_id===selected).map(e=>({...e,kind:'webhook',sortAt:e.provider_observed_at||e.received||e.occurred||''}));
const reads=(state.snapshots||[]).filter(x=>x.order_id===selected).map(x=>({...x,kind:x.resource_kind==='capture'?'capture_read':'order_read',sortAt:x.observed_at||x.imported_at||''}));
const refunds=(state.refund_observations||[]).filter(x=>x.order_id===selected).map(x=>({...x,kind:'refund_read',sortAt:x.observed_at||x.imported_at||''}));
const timeline=chronologicalActivity([...events,...reads,...refunds]);el('event-count').textContent=String(timeline.length).padStart(2,'0');
const filtered=filterEvidence(timeline,selected);
put(el('timeline'),filtered.records.map(e=>{
 const trusted=e.kind==='webhook'&&hasEventAuthority(e);
 const item=node('div','timeline-item'+(trusted?' verified':'')+(['order_read','capture_read','refund_read'].includes(e.kind)?' snapshot':''));
 item.dataset.recordId=e.id;item.dataset.recordKind=e.kind;item.tabIndex=-1;
 const view=presentTimelineRecord(e),header=node('div','activity-record-heading');
 const heading=node('div','activity-record-outcome');heading.append(node('h4','',view.title));
 if(view.detail)heading.append(node('span','activity-record-amount',view.detail));
 const authority=node('span','activity-record-origin',({provider:'PayPal API',delivery:'Signed webhook',shared:'Shared · unverified',example:'Example',manual:'Unverified'})[view.sourceKind]);authority.dataset.origin=view.sourceKind;authority.title=view.provenance;
 header.append(heading,authority);item.append(header);
 if(view.reference){
  const reference=node('p','activity-record-resource');
  const captureId=e.kind==='refund_read'||e.type==='PAYMENT.CAPTURE.REFUNDED'?e.capture_id:e.kind==='capture_read'?e.capture_id:e.kind==='webhook'&&e.type?.startsWith('PAYMENT.CAPTURE.')?e.resource_id:null;
  const marker=captureId?'Capture '+captureId:'',at=marker?view.reference.indexOf(marker):-1;
  if(at<0)reference.textContent=view.reference;
  else{
   reference.append(document.createTextNode(view.reference.slice(0,at)));
   const link=node('button','activity-capture-link',marker);link.type='button';link.dataset.activityCapture=captureId;link.setAttribute('aria-label','Open capture '+captureId+' history');
   const orderId=selected,unlinked=e.kind==='webhook'&&!e.order_id&&state.events.some(event=>event.id===e.id&&!event.order_id);
   if(unlinked){
    link.setAttribute('aria-label',(state.connected?'Find order for capture ':'Connect PayPal to find order for capture ')+captureId);
    link.onclick=()=>{
     if(!state.connected){if(workspaceShell.openDialog('settings-dialog'))el('sandbox-setup').open=true;return;}
     const item=[...el('unresolved-refund-list').querySelectorAll('[data-unlinked-event]')].find(item=>item.dataset.unlinkedEvent===e.id);
     if(!item)return;workspaceShell.openInvestigations();const action=item.querySelector('button');action?.focus({preventScroll:true});item.scrollIntoView({block:'center'});
    };
   }else link.onclick=()=>openCaptureHistory(captureId,orderId,link);
   reference.append(link,document.createTextNode(view.reference.slice(at+marker.length)));
  }
  item.append(reference);
 }

 const captures=presentOrderReadCaptures(e);
 if(captures.length){
  const captureSummary=node('div','activity-order-captures');
  captureSummary.append(node('p','quiet',captures.length===1?'Capture in this read':'Captures in this read'));
  for(const capture of captures){
   const row=node('p','activity-record-resource');row.dataset.observedCapture=capture.id||'';
   row.append(node('strong','',capture.status),document.createTextNode(' · '+(capture.amount||'Amount not supplied')),node('br'));
   if(capture.id){
    const link=node('button','activity-capture-link','Capture '+capture.id);link.type='button';link.dataset.activityCapture=capture.id;link.setAttribute('aria-label','Open capture '+capture.id+' history');
    const orderId=selected;link.onclick=()=>openCaptureHistory(capture.id,orderId,link);row.append(link);
   }else row.append(node('span','','Capture ID not supplied'));
   captureSummary.append(row);
  }
  item.append(captureSummary);
 }
 const timing=node('p','activity-record-time');
 const when=formatTimelineClock(view.time);
 timing.textContent=(view.timeLabel==='Received'&&view.receiptTimeLabel?view.receiptTimeLabel:view.timeLabel)+' · '+when;timing.title=view.time||'';item.append(timing);
 if(view.receiptTimeLabel&&(view.timeLabel!=='Received'||view.time!==view.received)){
  const receipt=node('p','activity-record-time',view.receiptTimeLabel+' · '+formatTimelineClock(view.received));receipt.dataset.receiptClock='';receipt.title=view.received||'';item.append(receipt);
 }
 const sourceDetails=node('details','activity-record-details'),sourceSummary=node('summary','','Record details'),rawBody=node('div','activity-record-fields');
 sourceDetails.append(sourceSummary,rawBody);item.append(sourceDetails);
 if(e.source==='imported_packet'&&e.reported_read_id&&['order_read','capture_read','refund_read'].includes(e.kind)){const reference=node('p','shared-read-reference');reference.append(document.createTextNode('Shared read reference: '),node('code','',e.reported_read_id));rawBody.append(reference);}
 if(e.kind==='refund_read'){
   const shared=e.source==='imported_packet',amount=e.amount;
   rawBody.append(node('h4','','Refund read · '+captureStatusLabel(e.status)),node('p','','Refund: '+e.refund_id),node('p','','Capture: '+e.capture_id));
   if(amount)rawBody.append(node('p','refund-amount',(shared?'Shared refund: ':'This refund: ')+amount.currency+' '+amount.value));
   if(e.total_refunded_amount)rawBody.append(node('p','',(shared?'Shared claim · refunded total for the original capture: ':'PayPal-reported refunded total for the original capture: ')+e.total_refunded_amount.currency+' '+e.total_refunded_amount.value));
   rawBody.append(node('p','',shared?'Reported request: '+(e.reported_requested_at||'unknown'):'Requested: '+(e.requested_at||'unknown')),node('p','',shared?'Reported response: '+(e.observed_at||'unknown')+' · Imported: '+(e.imported_at||'unknown'):'Response received: '+(e.observed_at||'unknown')));
   rawBody.append(node('p','trust',shared?'SHARED REFUND READ · UNVERIFIED':e.source==='sandbox_refund_api'?'PAYPAL REFUND API READ':'UNVERIFIED REFUND READ'));
 }else if(e.kind==='capture_read'){
   rawBody.append(node('h4','','CAPTURE READ · '+e.status),node('p','','Capture '+e.capture_id),node('p','',e.source==='imported_packet'?'Reported request: '+(e.reported_requested_at||'unknown'):'Requested at: '+(e.requested_at||'unknown')),node('p','',e.source==='imported_packet'?'Reported response: '+(e.observed_at||'unknown')+' · Imported: '+(e.imported_at||'unknown'):'Response received at: '+(e.observed_at||'unknown')));
   if(e.amount)rawBody.append(node('p','',e.amount.currency+' '+e.amount.value));
   rawBody.append(node('p','trust',e.source==='sandbox_capture_api'?'PAYPAL CAPTURE API SNAPSHOT':'IMPORTED CAPTURE CLAIM · NOT REVALIDATED'));
 }else if(e.kind==='order_read'){
   if(e.source==='imported_packet'&&e.reported_requested_at)rawBody.append(node('p','quiet','Reported request time: '+e.reported_requested_at));
   if(e.source==='imported_packet'&&e.reported_superseded_by)rawBody.append(node('p','read-superseded','Shared file reports that read '+(e.reported_read_id||'(unknown ID)')+' returned after read '+e.reported_superseded_by+' and was retained in history. This timing and selection claim is not locally verified.'));
   if(e.requested_at)rawBody.append(node('p','quiet','Requested: '+e.requested_at));
   if(e.superseded_by)rawBody.append(node('p','read-superseded','Earlier request returned after a newer read; retained in history. This observation did not replace the newer requested read.'));
   rawBody.append(node('h4','','ORDER READ · '+e.status),node('p','',e.source==='imported_packet'?'Reported at: '+(e.observed_at||'unknown')+' · Imported: '+e.imported_at:e.observed_at),node('p','',e.captures.length?'Captured: '+e.captures.map(c=>c.id+' '+c.status).join(', '):'No captures in this snapshot'),node('p','trust',e.source==='sandbox_api'?'PAYPAL SANDBOX API SNAPSHOT':e.source==='imported_packet'?'IMPORTED PACKET · REPORTED '+(e.reported_source||'UNKNOWN'):'AUTHORED SAMPLE'));
 }else{
   rawBody.append(node('h4','',e.type),node('p','','Occurred: '+(e.occurred||'unknown')),node('p','',isProviderRead(e)?'Read from PayPal: '+e.provider_observed_at:'Received: '+(e.received||'unknown')),node('p','',e.type==='PAYMENT.CAPTURE.REFUNDED'?refundDetail(e)+' · Capture '+(e.capture_id||'not associated'):e.resource_id),node('p','trust',isProviderRead(e)?'PAYPAL EVENT API READ · NO DELIVERY SIGNATURE':e.source==='imported_packet'?'IMPORTED PACKET · NOT REVERIFIED':e.sample?'AUTHORED SAMPLE':e.verified?'PAYPAL SIGNATURE VERIFIED':e.source==='manual'?'MANUALLY IMPORTED · UNVERIFIED':'UNVERIFIED'));
   if(e.event_id)rawBody.append(node('p','event-api-reference','PayPal event: '+e.event_id));
   if(e.source==='imported_packet'&&e.reported_source==='sandbox_event_api')rawBody.append(node('p','quiet','Reported PayPal read: '+(e.reported_provider_observed_at||'unknown')+' · shared claim, not revalidated here'));
   appendOriginalDelivery(rawBody,e); }const matches=matchingReferences(e,filtered.query);for(const [label,value] of matches){const existing=[...item.querySelectorAll('p,code')].find(part=>part.textContent.includes(value));if(existing)existing.classList.add('matched-reference');else rawBody.append(node('p','matched-reference',label+': '+value));}return item;
}),filtered.active?'No evidence matches these filters. Clear the filters to see the full history.':selected?'No API reads or webhook evidence associated with this order.':'Choose an order to view the evidence history.');el('packet').disabled=!selected;const current=state.orders.find(x=>x.id===selected);el('reread').disabled=!selected||current?.sample||!state.connected;el('reread').textContent=current?'Re-read PayPal Sandbox ↻':'Fetch PayPal order ↗';el('read-guidance').textContent=!selected?'Select an investigation to read its PayPal evidence.':current?.sample?'This is an authored example. Inspect a real Sandbox order ID to collect authoritative evidence.':!state.connected?'Connect PayPal Sandbox in setup to fetch an authoritative order read. Shared and imported evidence remains unverified.':'Reads this order from PayPal Sandbox and keeps the earlier observations in the chronology.';rankingAvailability();el('ai-status').className='signal'+(state.ai_connected?' good':'');readControls();}
async function openCaptureHistory(captureId,orderId,trigger,{rememberOrigin=false}={}){
 if(selected!==orderId)return;
 const originView=document.body.dataset.view,originNavigation=navigationVersion;
 const find=()=>[...el('capture-comparison').querySelectorAll('[data-capture-id]')].find(record=>record.dataset.captureId===captureId&&record.dataset.captureOrder===orderId);
 let target=find();
 if(!target){const disabled=trigger.disabled;trigger.disabled=true;try{await loadPacket({propagateError:true});}finally{trigger.disabled=disabled;}if(selected!==orderId||navigationVersion!==originNavigation||document.body.dataset.view!==originView)return;target=find();}
 if(!target)return false;
 if(rememberOrigin){workspaceShell.rememberSourceOrigin(trigger);workspaceShell.closeDialogs();workspaceShell.closeInvestigations({restoreFocus:false});}
 workspaceShell.showView('records',{resetScroll:false,preserveSourceReturn:true});const details=target.querySelector('.capture-details');if(details)details.open=true;
 target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});
 return true;
}
function openRefundHistory(refundId,orderId,opener){
 if(!refundId||selected!==orderId)return false;
 const target=[...el('capture-comparison').querySelectorAll('[data-refund-id]')].find(item=>item.dataset.refundId===refundId&&item.closest('[data-capture-order]')?.dataset.captureOrder===orderId);
 if(!target)return false;
 workspaceShell.rememberSourceOrigin(opener);
 workspaceShell.closeDialogs();workspaceShell.closeInvestigations({restoreFocus:false});
 workspaceShell.showView('records',{resetScroll:false,preserveSourceReturn:true});
 target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center'});
 return true;
}
function renderPayment(packet){
 const view=presentCase(packet);
 el('payment-amount').textContent=view.amount??'—';el('payment-currency').textContent=view.currency||'';
 const caseLabel=el('case-label');caseLabel.textContent=view.sourceLabel||packet.order?.title||(packet.order?.imported?'Shared payment':'Payment');caseLabel.classList.toggle('source-unverified',Boolean(view.sourceLabel));
 el('review-context').textContent=selected||'';
 const facts=view.refundAmount?[[view.refundSource==='imported_packet'?'Shared refund':'Refund amount',view.refundAmount],['Captures',view.metrics.captures],['Reads',view.metrics.reads]]:[['Captures',view.metrics.captures],['Events',view.metrics.events],['Reads',view.metrics.reads]];
 put(el('payment-facts'),facts.map(([label,value])=>{const d=node('div','payment-fact'+((label==='Refund amount'||label==='Shared refund')?' payment-fact-money':''));d.append(node('dt','',label),node('dd','',String(value)));return d;}),'');
 el('case-summary').hidden=view.summary===view.status.label;const headline=node('p','case-headline',view.summary);
 if(view.comparisonCaptureId){const marker='Capture '+view.comparisonCaptureId;const link=node('button','activity-capture-link',marker);link.type='button';link.setAttribute('aria-label','Open capture '+view.comparisonCaptureId+' history');link.onclick=()=>openCaptureHistory(view.comparisonCaptureId,packet.order_id,link);headline.replaceChildren(link,document.createTextNode(view.summary.slice(marker.length)));}
 el('case-summary').replaceChildren(headline);
 const recordedCaptures=(packet.order?.units||[]).flatMap(unit=>unit.captures||[]);
 const completions=(packet.events||[]).filter(event=>event.type==='PAYMENT.CAPTURE.COMPLETED'&&event.resource_id&&event.order_id===packet.order_id&&!recordedCaptures.some(capture=>capture.id===event.resource_id)&&!view.timeline.some(record=>record.kind==='capture_read'&&record.resourceId===event.resource_id));
 if(completions.length&&packet.order){
  const read=(packet.snapshots||[]).filter(record=>record.order_id===packet.order_id&&!record.superseded_by&&(!record.resource_kind||record.resource_kind==='order')).at(-1);
  const context=node('div','status-evidence');const captureIds=[...new Set(completions.map(event=>event.resource_id))];context.append(node('strong','',captureIds.length===1?'Completion event · capture absent from order read':captureIds.length+' reported captures absent from order read'));
  const shownCaptures=new Set(),more=node('details','status-evidence-more');let additional=0;
  for(const [record,kind] of [[read,'order_read'],...completions.map(event=>[event,'webhook'])]){if(!record)continue;const shown=presentTimelineRecord({...record,kind});const button=node('button','text-button',shown.provenance+' · '+(kind==='order_read'?'Order '+shown.detail:record.resource_id+' · Completion reported')+' · '+(shown.time?shown.timeLabel+' '+shown.time:'Time not recorded'));button.type='button';button.onclick=()=>openEvidenceRecord({id:record.id,kind});if(kind==='order_read'||(!shownCaptures.has(record.resource_id)&&shownCaptures.size<2)){context.append(button);if(kind!=='order_read')shownCaptures.add(record.resource_id);}else{button.append(node('span','', ' · Observation '+record.id));more.append(button);additional++;}}
  if(additional){more.prepend(node('summary','',additional+' more completion observations'));context.append(more);}
  el('case-summary').hidden=false;el('case-summary').append(context);
 }

 const scopeFindings=orderCaptureScopeFindings(resourceFindingCatalog(packet));
 const extraScopes=node('details','status-evidence-more');
 for(const [index,finding] of scopeFindings.entries()){
  const context=node('section','status-evidence status-scope-context');context.dataset.captureScope=finding.resource_id;
  context.append(node('strong','','Completed order · partially refunded capture'));
  const refunds=selectCaptureRefunds(packet.refund_observations||[],finding.resource_id,packet.order_id).sort((a,b)=>{
   const observed=r=>Date.parse(r.read.requested_at||r.read.reported_requested_at||r.read.observed_at)||0;
   return observed(b)-observed(a);
  });
  if(refunds.length===1){
   const {read:refund,local:isLocal}=refunds[0];
   const amount=refund.amount?.currency&&refund.amount?.value?refund.amount.currency+' '+refund.amount.value:'amount not supplied';
   const origin=refund.source==='imported_packet'?'Shared refund read':refund.sample||refund.source==='authored_sample'?'Example refund read':isLocal?'PayPal refund read':'Unverified refund read';
   context.append(node('p','status-scope-summary',origin+' reports '+(refund.status||'status unavailable')+' · '+amount+'. The completed order does not establish when the buyer received funds or what remains refundable.'),findingSource(refund.id,packet));
  }else if(refunds.length>1){
   context.append(node('p','status-scope-summary',refunds.length+' distinct refund references belong to this capture. Review the relevant refund and its source; these observations do not establish the remaining refundable balance.'));
  }else{
   context.append(node('p','status-scope-summary','The completed order and partially refunded capture describe different resources. Check the exact refund in PayPal before drawing a balance conclusion.'));
  }
  if(refunds.length&&(packet.captures||[]).some(row=>row.id===finding.resource_id)){
   const actions=node('div','status-scope-refund-actions'+(refunds.length===1?' single':''));
   for(const {read:refund,local:isLocal} of refunds){
    const review=node('button','secondary status-scope-refund-link',refunds.length===1?'Review refund':'Review refund '+refund.refund_id);
    review.type='button';review.dataset.scopeRefund=refund.refund_id;
    review.setAttribute('aria-label','Review refund '+refund.refund_id+' in Records');
    if(refunds.length>1){
     const amount=refund.amount?.currency&&refund.amount?.value?refund.amount.currency+' '+refund.amount.value:'Amount not supplied';
     const origin=refund.source==='imported_packet'?'Shared claim':refund.sample||refund.source==='authored_sample'?'Example':isLocal?'PayPal read':'Unverified read';
     review.append(node('span','status-scope-refund-meta',amount+' · '+captureStatusLabel(refund.status)+' · '+origin));
    }
    review.onclick=()=>{if(!openRefundHistory(refund.refund_id,packet.order_id,review))review.textContent='Refund record unavailable';};
    actions.append(review);
   }
   context.append(actions);
  }
  context.append(node('code','status-scope-capture','Capture '+finding.resource_id));
  const seenKinds=new Set(),more=node('details','status-evidence-more');let older=0;
  const observedTime=id=>{const value=Date.parse(packet.snapshots.find(r=>r.id===id)?.observed_at);return Number.isFinite(value)?value:-Infinity;};
  const sourceIds=[...finding.source_ids].sort((a,b)=>observedTime(b)-observedTime(a));
  for(const id of sourceIds){
   const record=packet.snapshots.find(r=>r.id===id),kind=record?.resource_kind==='capture'?'capture':'order',source=findingSource(id,packet);
   if(!seenKinds.has(kind)){context.append(source);seenKinds.add(kind);}else{more.append(source);older++;}
  }
  if(older){more.prepend(node('summary','',older+' other retained reads'));context.append(more);}
  const explanation=node('details','status-scope-explanation');explanation.append(node('summary','','Explanation and limits'),node('p','finding-detail',finding.text));context.append(explanation);
  if(index===0)el('case-summary').append(context);else extraScopes.append(context);
 }
 if(scopeFindings.length>1){extraScopes.prepend(node('summary','',(scopeFindings.length-1)+' more capture status comparisons'));el('case-summary').append(extraScopes);}
 if(scopeFindings.length){el('case-summary').hidden=false;if(view.summary===view.status.label)headline.hidden=true;}
 paymentTrace.update(packet);
}
const openCaptureEvidence=new Set();
function captureStatusLabel(value){return String(value||'Not read').toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());}
function captureReadTime(value){
 if(!value)return '';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
 return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(date)+' UTC';
}
function renderCaptures(rows=[],order=null,refundObservations=[],snapshots=[]){
 const target=el('capture-comparison');el('capture-context').textContent=selected||'No investigation selected';
 if(!rows.length){put(target,[],'No captures in this investigation yet.');return;}
 const list=node('div','capture-list');
 for(const row of rows){
  const local=row.latest_capture_read?.source==='sandbox_capture_api'?row.latest_capture_read:null;
  const shared=(row.capture_reads||[]).filter(read=>read.source==='imported_packet').at(-1);
  const sharedOrder=!!order?.imported||row.api_source==='imported_packet';
  const primaryRead=local||((sharedOrder||!row.api_status)?shared:null);
  const status=primaryRead?.status||row.api_status||'Not read';
  const amount=primaryRead?.amount||row.amount;
  const record=node('article','capture-record');record.dataset.captureId=row.id;record.dataset.captureStatus=status;record.dataset.captureOrder=selected;
  record.setAttribute('aria-label','Capture '+row.id);
  const primary=node('div','capture-primary'),identity=node('div','capture-identity');
  identity.append(node('span','capture-amount-label','Original capture'),node('h3','capture-amount',row.amount_conflict?'Compare amounts':amount?amount.currency+' '+amount.value:'Amount not supplied'),node('code','capture-id',row.id));
  const stateCell=node('div','capture-state'),stateLabel=node('strong','capture-direct-status',captureStatusLabel(status));
  const source=local?'Capture read':row.sample||order?.sample?'Example':primaryRead===shared&&shared?'Shared capture read':sharedOrder?'Shared order read':row.api_status?'Order read':'Event record';
  const at=primaryRead?.observed_at||row.api_observed_at;
  stateCell.append(stateLabel,node('span','capture-source',source+(captureReadTime(at)?' · '+captureReadTime(at):'')));
  primary.append(identity,stateCell,captureReadAction(row,order));
  record.append(primary);
  const reversal=row.events.find(event=>event.type==='PAYMENT.CAPTURE.REVERSED');
  const refund=row.events.find(event=>event.type==='PAYMENT.CAPTURE.REFUNDED');
  let difference='';
  if(row.amount_difference)difference=(row.amount_difference.local_order?'Order amount: ':'Shared order amount: ')+row.amount_difference.order.currency+' '+row.amount_difference.order.value+' · '+(row.amount_difference.shared_capture?'Shared capture: ':'Capture read: ')+row.amount_difference.capture.currency+' '+row.amount_difference.capture.value;
  else if(reversal)difference=hasEventAuthority(reversal)?'Reversal recorded. Compare its time with this read.':'Reversal reported. Confirm the exact capture in PayPal.';
  else if(local&&row.api_status&&local.status!==row.api_status)difference='In order read: '+captureStatusLabel(row.api_status)+' · Capture read: '+captureStatusLabel(local.status);
  else if(!local&&shared&&sharedOrder&&row.api_status&&shared.status!==row.api_status)difference='In shared order: '+captureStatusLabel(row.api_status)+' · Shared capture read: '+captureStatusLabel(shared.status);
  else if(refund&&!['REFUNDED','PARTIALLY_REFUNDED'].includes(status))difference='Refund '+(hasEventAuthority(refund)?'recorded':'reported')+'. Open its record for the amount.';
  if(difference)record.append(node('p','capture-difference',difference));
  const eventRefunds=row.events.filter(e=>e.refund_id).map(e=>({refund_id:e.refund_id,capture_id:row.id,order_id:selected,source:'event_record',status:e.refund_status||'Not read',amount:e.refund_amount,evidence_record:e}));
  const known=new Set(refundObservations.map(r=>r.refund_id));
  const refunds=selectCaptureRefunds([...refundObservations,...eventRefunds.filter(r=>!known.has(r.refund_id))],row.id,selected);
  for(const {read,local:isLocal} of refunds){
   const detail=node('div','capture-refund'),label=isLocal?'This refund':read.source==='event_record'?'Reported refund':'Shared refund claim';
   detail.dataset.refundId=read.refund_id;
   detail.append(node('strong','',label+': '+(read.amount?read.amount.currency+' '+read.amount.value:'Amount not supplied')),node('span','capture-source',captureStatusLabel(read.status)),node('code','capture-id',read.refund_id));
   if(read.total_refunded_amount)detail.append(node('p','capture-source',(isLocal?'PayPal-reported refunded total for the original capture: ':'Shared claim · refunded total for the original capture: ')+read.total_refunded_amount.currency+' '+read.total_refunded_amount.value));
   const sourceRecord=read.evidence_record?{...read.evidence_record,kind:'webhook'}:{...read,kind:'refund_read'};
   const sourceView=presentTimelineRecord(sourceRecord);
   const sourceLabel=sourceView.sourceKind==='example'?'Example refund':sourceView.sourceKind==='shared'?(sourceView.observation?(sourceView.kind==='webhook'?'Shared event read':'Shared refund read'):'Shared refund event'):sourceView.sourceKind==='provider'?(sourceView.kind==='webhook'?'PayPal event read':'PayPal refund read'):sourceView.sourceKind==='delivery'?'Signed refund event':sourceView.observation?'Unverified refund read':'Unverified refund event';
   const sourceLine=node('small','capture-source',sourceLabel+' · '+sourceView.timeLabel+': '+(captureReadTime(sourceView.time)||'Time unknown'));
   sourceLine.dataset.refundSource=sourceView.sourceKind;detail.append(sourceLine);
   if(sourceRecord.id){
    const open=node('button','secondary','Open refund source');open.type='button';open.dataset.refundSourceId=sourceRecord.id;
    open.onclick=()=>openEvidenceRecord({id:sourceRecord.id,kind:sourceView.kind},open);detail.append(open);
   }
   const refundOrder=selected,refundKey=JSON.stringify([refundOrder,read.refund_id]);
   const refresh=node('button','secondary',refundReadsPending.has(refundKey)?'Reading refund…':isLocal?'Refresh refund':'Read refund');
   refresh.type='button';refresh.dataset.refundAction=read.refund_id;
   refresh.disabled=refundReadsPending.has(refundKey)||!state.connected||!!row.sample||!!order?.sample;
   const feedback=node('span','capture-source');feedback.setAttribute('role','status');
   refresh.onclick=async()=>{
    if(refundReadsPending.has(refundKey))return;
    refundReadsPending.add(refundKey);refresh.disabled=true;feedback.textContent='Reading refund…';let saved=false;
    try{await call('/api/refund/inspect','POST',{refund_id:read.refund_id});saved=true;await load();if(selected!==refundOrder)message('Refund saved in '+refundOrder+'.',true);}
    catch(error){feedback.textContent=error.message;}
    finally{refundReadsPending.delete(refundKey);refresh.disabled=!state.connected||!!row.sample||!!order?.sample;if(saved&&selected===refundOrder)await loadPacket();}
   };
   if(!state.connected&&!refundReadsPending.has(refundKey)&&!row.sample&&!order?.sample){
    refresh.disabled=false;refresh.textContent='Connect PayPal to read refund';
    refresh.setAttribute('aria-label','Connect PayPal to read refund '+read.refund_id);
    refresh.onclick=()=>{if(workspaceShell.openDialog('settings-dialog'))el('sandbox-setup').open=true;};
   }
   detail.append(refresh,feedback);
   record.append(detail);
  }
  const disclosure=node('details','capture-details'),key=JSON.stringify([selected,row.id]);
  disclosure.open=openCaptureEvidence.has(key);
  disclosure.ontoggle=()=>disclosure.open?openCaptureEvidence.add(key):openCaptureEvidence.delete(key);
  disclosure.append(node('summary','','Evidence'));
  const sources=node('dl','capture-sources');
  const addSource=(label,value,extra=[],source=null)=>{
   const line=node('div','capture-source-row'),detail=node('dd','');
   detail.append(node('span','capture-source-state',value));
   for(const text of extra.filter(Boolean))detail.append(node('small','',text));
   if(source){const open=node('button','secondary',source.kind==='order_read'?'Open order source':'Open capture source');open.type='button';open.dataset.captureReadSource=source.id;open.onclick=()=>openEvidenceRecord(source);detail.append(open);}
   line.append(node('dt','',label),detail);sources.append(line);
  };
  addSource('Order read',row.api_status?captureStatusLabel(row.api_status):'Not read',[
   order?.status?'Order status: '+captureStatusLabel(order.status):'',
   row.api_observed_at?'Read: '+row.api_observed_at:'',
   sharedOrder?'From shared file':row.sample?'Example':''
  ],snapshots.some(read=>read.id===row.api_read_id&&read.order_id===selected&&(!read.resource_kind||read.resource_kind==='order'))?{id:row.api_read_id,kind:'order_read'}:null);
  if(local)addSource('Capture read',captureStatusLabel(local.status),[
   'Requested: '+(local.requested_at||'Unknown'),
   'Response: '+(local.observed_at||'Unknown')
  ],{id:local.id,kind:'capture_read'});
  else if(shared)addSource('Shared capture read',captureStatusLabel(shared.status),[
   'Reported request: '+(shared.reported_requested_at||'Unknown'),
   'Reported response: '+(shared.observed_at||'Unknown')
  ],{id:shared.id,kind:'capture_read'});
  else addSource('Capture read','Not read');
  disclosure.append(sources);
  const events=node('div','capture-events');
  if(!row.events.length)events.append(node('p','capture-empty-events','No received events for this capture.'));
  for(const event of row.events){
   const line=node('div','capture-event');
   line.append(node('strong','',captureStatusLabel(event.type.replace('PAYMENT.CAPTURE.',''))),node('span','capture-event-source',event.sample?'Example':isProviderRead(event)?'PayPal event read':event.source==='imported_packet'?'Shared file':event.verified?'Signed delivery':'Reported event'),node('code','',event.event_id||event.id));
   if(event.refund_id)line.append(node('span','',refundDetail(event)));
   events.append(line);
  }
  disclosure.append(events,node('p','capture-assessment',row.assessment));
  record.append(disclosure);list.append(record);
 }
 target.replaceChildren(list);
}
function captureReadAction(row,order){
 const orderId=selected,key=JSON.stringify([orderId,row.id]);
 if(!captureReadViews.has(key))captureReadViews.set(key,{pending:false,text:''});
 const view=captureReadViews.get(key),cell=node('div','capture-actions');
 cell.setAttribute('aria-busy',String(view.pending));
 const local=row.latest_capture_read?.source==='sandbox_capture_api'?row.latest_capture_read:null;
 const action=node('button','secondary capture-read-action',view.pending?'Reading…':local?'Refresh capture':'Read capture');
 action.type='button';action.dataset.captureAction=row.id;action.dataset.captureOrder=orderId;
 action.setAttribute('aria-label',(local?'Refresh':'Read')+' PayPal capture '+row.id);
 if(!state.connected&&!view.pending&&!row.sample&&!order?.sample){
  action.textContent='Connect PayPal to read';action.setAttribute('aria-label','Connect PayPal to read capture '+row.id);
  action.onclick=()=>{if(workspaceShell.openDialog('settings-dialog'))el('sandbox-setup').open=true;};
  cell.append(action);return cell;
 }
 action.disabled=view.pending||!state.connected||!!row.sample||!!order?.sample;
 if(!state.connected)action.title='Connect PayPal in setup to read this capture.';
 if(row.sample||order?.sample)action.title='Example investigation';
 const feedback=node('p','capture-read-feedback',view.text);feedback.setAttribute('role','status');
 action.onclick=async()=>{
  if(view.pending)return;
  const navigation=++navigationVersion;
  view.pending=true;view.text='Reading capture…';action.disabled=true;action.textContent='Reading…';feedback.textContent=view.text;cell.setAttribute('aria-busy','true');
  try{
   const result=await call('/api/capture/inspect','POST',{order_id:orderId,capture_id:row.id});
   view.pending=false;view.text='Read saved';
   const restoreFocus=document.activeElement===action;
   if(selected===orderId)clearExplanation();
   await load();
   if(selected!==orderId)message('Saved capture '+row.id+' in '+orderId+'. Your current investigation remains open.',true);
   if(restoreFocus&&document.activeElement===document.body&&selected===orderId&&navigation===navigationVersion)[...document.querySelectorAll('[data-capture-action]')].find(button=>button.dataset.captureAction===row.id&&button.dataset.captureOrder===orderId)?.focus({preventScroll:true});
  }catch(error){view.pending=false;view.text='Could not read capture: '+error.message;feedback.textContent=view.text;if(selected===orderId)await loadPacket();}
  finally{view.pending=false;action.disabled=!state.connected||!!row.sample||!!order?.sample;action.textContent=local?'Refresh capture':'Read capture';cell.setAttribute('aria-busy','false');}
 };
 cell.append(action,feedback);return cell;
}
function findingSource(id,packet){
 const event=packet.events?.find(r=>r.id===id),read=packet.snapshots?.find(r=>r.id===id),refund=packet.refund_observations?.find(r=>r.id===id),dispute=packet.dispute_observations?.find(r=>r.id===id);
 if(!event&&!read&&!refund&&!dispute)return node('code','',id);
 const record=event||read||refund||dispute;
 const eventRead=event&&(isProviderRead(event)||event.source==='imported_packet'&&event.reported_source==='sandbox_event_api');
 const kind=event?(event.type==='PAYMENT.CAPTURE.REFUNDED'?(eventRead?'Refund event read':'Refund event'):(eventRead?'Event read':'Event')):read?.resource_kind==='capture'?'Capture read':read?'Order read':refund?'Refund read':'Dispute read';
 const source=record.source==='imported_packet'?'Shared ':record.sample?'Example ':event&&isProviderRead(event)?'PayPal ':event?.verified===true?'Verified ':'';
 const observed=record.observed_at||record.provider_observed_at||record.reported_provider_observed_at||record.occurred;
 const at=observed&&Number.isFinite(Date.parse(observed))?formatTimelineClock(observed):'';
 const label=(source?source+kind.toLowerCase():kind)+(at?' · '+at:'');
 const button=node('button','activity-source finding-source',label);button.type='button';button.dataset.findingSource=id;button.title=id;button.setAttribute('aria-label',label+' · '+id);
 button.onclick=()=>{
  if(dispute){workspaceShell.showView('records',{resetScroll:false});disputeEvidence.focus(id);return;}
  if(refund){openEvidenceRecord({id,kind:'refund_read'});return;}
  openEvidenceRecord({id,kind:event?'webhook':read.resource_kind==='capture'?'capture_read':'order_read'});
 };
 return button;
}
function renderFinding(n,p){
 const d=node('div','finding'+(n.level==='clear'?' clear':''));d.dataset.findingKind=n.kind||'';
 d.append(node('h4','',n.kind==='refund_evidence'&&!n.resource_id?'Refund observations':n.title));
  const scope=n.kind==='order_capture_scope'?scopePresentation(n.title+': '+n.detail.replace(/\s+/g,' ').trim()):null;
  if(scope?.observations?.length&&scope.observations.length===n.ids.length){
   d.classList.add('finding-scope');
   const sources=new Map(scope.observations.map((row,index)=>[row,n.ids[index]]));
   appendSavedScopeObservations(d,scope,{renderSource:row=>findingSource(sources.get(row),p)});
   const explanation=node('details','finding-explanation');
   explanation.append(node('summary','','Why these statuses can differ'),node('p','finding-detail',scope.explanation),node('p','finding-detail',scope.limits));
   d.append(explanation);return d;
  }
 if(n.answer)d.append(node('p','finding-answer',n.answer));
 if(n.history_summary)d.append(node('p','quiet finding-history-summary',n.history_summary));
 const visibleSources=new Set();
 if(n.observations?.length){
  const history=node('div','finding-observations');history.setAttribute('aria-label','Retained observations');
  const earlier=n.observations.slice(0,-4);
  const older=node('details','finding-older');older.append(node('summary','','Earlier observations · '+earlier.length));
  for(const [index,observation] of n.observations.entries()){
   const row=node('div','finding-observation');row.append(node('strong','',observation.label+' · '+observation.status),node('code','',observation.amount));
   const source=findingSource(observation.id,p);row.append(source);visibleSources.add(observation.id);(index<earlier.length?older:history).append(row);
  }
  if(earlier.length)history.append(older);
  d.append(history);
 }
 if((n.answer||n.level==='info'||n.priority==='authoritative_observation')&&n.detail.length>120&&n.kind!=='order_capture_scope'){const explanation=node('details','finding-explanation');explanation.append(node('summary','','Observation details'),node('p','finding-detail',n.detail));d.append(explanation);}else d.append(node('p','finding-detail',n.detail));
 const remaining=n.ids.filter(id=>!visibleSources.has(id));
 if(remaining.length){const sources=node('div','finding-sources');for(const id of remaining)sources.append(findingSource(id,p));d.append(sources);}
 return d;
}
async function loadPacket({propagateError=false}={}){if(!selected){findingFinder.clear();renderCaptures();el('signal').textContent='Ready to inspect';el('signal').className='signal';el('findings').closest('.next-step').hidden=true;put(el('findings'),[],'');return;}const id=selected;try{const p=await call('/api/packet?order_id='+encodeURIComponent(id));if(selected!==id)return;diagnosis=p.diagnosis;findingFinder.update(p);disputeEvidence.update(p,state.connected);renderPayment(p);rankingAvailability();renderCaptures(p.captures||[],p.order||null,p.refund_observations||[],p.snapshots||[]);renderReadComparison(p.read_comparison,el('capture-comparison'),{snapshots:p.snapshots||[],orderId:id,openRecord:openEvidenceRecord,draftNote:state.read_only_demo?null:text=>{const error=investigationNotes.prepare(id,text);if(!error){workspaceShell.showView('overview',{resetScroll:false});investigationNotes.focus();}return error;}});const items=p.diagnosis.notes.map(n=>renderFinding(n,p));for(const action of p.diagnosis.actions){const d=node('div','finding');d.append(node('span','label','NEXT CHECK'),node('p','',action.split(';')[0].replace(/\.$/,'')));d.title=action;items.push(d);}let details=el('review-details');if(!details){details=node('details','tool-section');details.id='review-details';details.append(node('summary','','Full investigation findings'),node('div',''));document.querySelector('[data-view-panel="records"]').append(details);}put(details.lastElementChild,items,'No findings.');
const next=el('first-use-entry').hidden?(presentCase(p).nextSteps?.[0]?.action||p.diagnosis.actions[0]):null;el('findings').closest('.next-step').hidden=!next;const nextRows=next?[node('p','next-action-copy',next.split(';')[0].replace(/\.$/,''))]:[];
const more=node('button','text-button','View records');more.type='button';more.onclick=()=>{workspaceShell.showView('records',{focus:true});const review=el('review-details');if(review){review.open=true;review.scrollIntoView({block:'start'});}};if(next&&!el('case-summary').querySelector('[data-scope-refund]'))nextRows.push(more);put(el('findings'),nextRows,'');const warning=p.diagnosis.notes.some(x=>x.level==='investigate'||x.level==='caution');const unknown=p.diagnosis.notes.some(x=>x.level==='unknown');const statusView=presentCase(p);el('signal').textContent=statusView.displayStatus;el('signal').className='signal'+(statusView.sourceKind==='shared'?' unverified':warning||unknown?' warn':' good');}catch(e){message(e.message);if(propagateError)throw e;}}
async function load(){summaryHandoff.invalidate();try{state=await call('/api/state');workspaceShell.setReadOnlyDemo(state.read_only_demo===true);restoreSelectedInvestigation();if(!selected&&incidents().length)selected=incidents().filter(o=>!state.investigation_work?.[o.id]?.archived).at(-1)?.id??null;if(selected&&!incidents().some(o=>o.id===selected))selected=null;render();await loadPacket();window.dispatchEvent(new Event('settletrace:ready'));}catch(e){message(e.message);window.dispatchEvent(new Event('settletrace:load-failed'));}}

let importingPacket=false;
async function openSharedPacket(packet){
 const result=await call('/api/packet/import','POST',{packet});
 navigationVersion++;selected=result.order_id;clearExplanation();await load();return result;
}
function importHistory(result){return result.snapshots_already_present?' '+result.snapshots+' new order observations; '+result.snapshots_already_present+' already in this workspace. Existing history kept.':'';}
function packetBusy(busy){importingPacket=busy;for(const form of [el('packet-import-form'),el('packet-file-form')])for(const control of form.elements)control.disabled=busy;}
el('packet-file').onchange=()=>{const file=el('packet-file').files[0];el('packet-file-status').textContent=file?'Selected '+file.name+'. Opening it will keep all imported claims unverified.':'The file opens as imported, unverified evidence in this workspace.';};
el('packet-file-form').onsubmit=async e=>{
 e.preventDefault();if(importingPacket)return;
 const file=el('packet-file').files[0];if(!file)return;
 packetBusy(true);el('packet-file-status').textContent='Opening '+file.name+'…';
 try{
  if(file.size>8*1024*1024)throw Error('File exceeds the 8 MiB incident limit.');
  let packet;try{packet=JSON.parse(await file.text());}catch{throw Error('The selected file is not valid JSON. Choose an exported SettleTrace incident.');}
  const result=await openSharedPacket(packet);
  el('packet-file-status').textContent='Opened '+file.name+' · '+result.order_id+' · IMPORTED / UNVERIFIED'+importHistory(result);
  el('packet-file').value='';message('Opened shared investigation.',true);focusReview();
 }catch(err){el('packet-file-status').textContent='Could not open '+file.name+': '+err.message+' Your current investigation is unchanged.';}
 finally{packetBusy(false);}
};
el('packet-import-form').onsubmit=async e=>{
 e.preventDefault();if(importingPacket)return;packetBusy(true);const feedback=el('packet-import-feedback');feedback.hidden=true;el('packet-import-json').removeAttribute('aria-invalid');
 try{const packet=JSON.parse(el('packet-import-json').value);const result=await openSharedPacket(packet);el('packet-import-json').value='';message('Opened shared investigation.'+importHistory(result),true);focusReview();}
 catch(err){feedback.textContent='Shared packet rejected: '+err.message+' Your pasted JSON has been kept for correction.';feedback.hidden=false;el('packet-import-json').setAttribute('aria-invalid','true');}finally{packetBusy(false);}
};
el('import-form').onsubmit=async e=>{e.preventDefault();const feedback=el('import-feedback');feedback.hidden=true;el('import-json').removeAttribute('aria-invalid');try{const event=JSON.parse(el('import-json').value);const result=await call('/api/events/import','POST',{event});el('import-json').value='';el('import-form').closest('details').open=false;navigationVersion++;selected=result.event.order_id;clearExplanation();message(result.event.order_id?'Imported event '+result.event.id+' as unverified evidence. No signature was checked.':'Capture event saved while its order is unresolved. Find the order from its capture when Sandbox is configured.',true);await load();if(!result.event.order_id){workspaceShell.closeDialogs();workspaceShell.openInvestigations();el('unresolved-refund-heading').focus();el('unresolved-refunds').scrollIntoView({block:'start'});}}catch(err){feedback.textContent='Import rejected: '+err.message+' Your pasted JSON has been kept for correction.';feedback.hidden=false;el('import-json').setAttribute('aria-invalid','true');}};
el('event-inspect-form').onsubmit=async event=>{
 event.preventDefault();if(readingEvent)return;
 const id=el('event-id').value.trim(),startVersion=++navigationVersion;
 const status=el('event-inspect-status');readingEvent=true;eventReadAvailability();
 status.textContent='Reading event '+id+' from PayPal Sandbox…';el('event-open-investigation').hidden=true;
 try{
  const result=await call('/api/events/inspect','POST',{event_id:id});
  const stay=navigationVersion===startVersion;
  if(stay&&result.order_id){selected=result.order_id;clearExplanation();}
  await load();
  status.textContent='Read '+result.event.event_id+' from PayPal Sandbox. '+(result.order_id?'Order '+result.order_id+'.':'Event saved; find its order from capture '+unresolvedCapture(result.event)+'.')+' This is an API observation, not a received or signature-verified delivery.';
  if(!result.order_id){
   const showPending=()=>{workspaceShell.closeDialogs();workspaceShell.openInvestigations();const heading=el('unresolved-refund-heading');heading.focus({preventScroll:true});el('unresolved-refunds').scrollIntoView({block:'start'});};
   if(stay)showPending();
   else {const open=el('event-open-investigation');open.textContent='Show saved event';open.hidden=false;open.onclick=()=>{showPending();open.hidden=true;};}
  }else if(selected!==result.order_id){const open=el('event-open-investigation');open.textContent='Open '+result.order_id;open.hidden=false;open.onclick=()=>{choose(result.order_id);open.hidden=true;};}
  else {workspaceShell.closeDialogs();workspaceShell.showView('records');const heading=el('capture-heading');heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});}
 }catch(error){status.textContent='Event not read: '+error.message+' Existing evidence is unchanged.';}
 finally{readingEvent=false;eventReadAvailability();}
};
el('inspect-form').onsubmit=e=>{e.preventDefault();readOrder(el('order-id').value,'inspect');};
el('sample').onclick=async()=>{try{await call('/api/sample','POST',{});navigationVersion++;selected='SAMPLE-ORDER-105';clearExplanation();message('');await load();}catch(e){message(e.message);}};
el('refresh').onclick=()=>{clearExplanation();load();};
el('reread').onclick=()=>{if(state.orders.find(o=>o.id===selected)?.sample){workspaceShell.openDialog('inspector-dialog');return;}if(selected)readOrder(selected,'reread');};
el('packet').onclick=async()=>{const id=selected;try{const p=await call('/api/packet?order_id='+encodeURIComponent(id));const blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='settletrace-'+id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){message(e.message);}};
el('explain').onclick=async()=>{const id=selected,version=++analysisVersion;el('explanation').textContent='Asking the configured model to prioritize supported checks…';try{const d=await call('/api/ai/prioritize','POST',{order_id:id});if(selected!==id||version!==analysisVersion)return;el('explanation').replaceChildren();
 const modelUsed=d.mode!=='no_ranking_needed';
 const intro=node('p','quiet',modelUsed?'AI ordered these checks; their wording comes from the deterministic evidence review.':'Only one supported check; no model request was made.');
 const list=node('ol','triage-list');
 for(const check of d.checks){const item=node('li');item.append(node('strong','',check.title),node('p','',check.text));if(check.source_ids.length)item.append(node('code','','Evidence: '+check.source_ids.join(', ')));list.append(item);}
 el('explanation').append(intro,list);if(modelUsed)el('explanation').append(node('p','quiet','Model: '+d.model+' · Advisory ordering, not a payment decision.'));}catch(e){if(selected!==id||version!==analysisVersion)return;el('explanation').textContent='No model ordering was accepted. '+e.message;}};
installWebhookSetup({call,node});
load();

mountReportIntake(el('inspect-form'),{
 matches:lookup=>{
  const ids=new Set();
  for(const o of state.orders)if(lookup.kind==='order'?o.id===lookup.id:lookup.kind==='capture'&&o.units?.some(u=>u.captures?.some(c=>c.id===lookup.id)))ids.add(o.id);
  for(const e of state.events)if(e.order_id&&(lookup.kind==='order'?e.order_id===lookup.id:lookup.kind==='event'?(e.event_id||e.id)===lookup.id:lookup.kind==='refund'?(e.refund_id||(e.type==='PAYMENT.CAPTURE.REFUNDED'?e.resource_id:null))===lookup.id:(e.capture_id||(e.type==='PAYMENT.CAPTURE.REFUNDED'?null:e.resource_id))===lookup.id&&e.type.startsWith('PAYMENT.CAPTURE.')))ids.add(e.order_id);
  for(const s of state.snapshots||[])if(s.order_id&&(lookup.kind==='order'?s.order_id===lookup.id:lookup.kind==='capture'&&(s.capture_id===lookup.id||s.captures?.some(c=>c.id===lookup.id))))ids.add(s.order_id);
  for(const r of state.refund_observations||[])if(lookup.kind==='refund'&&r.refund_id===lookup.id&&r.order_id)ids.add(r.order_id);
  return [...ids];
 },
 open:choose,
 inspectCapture:async lookup=>{
  const navigation=++navigationVersion;
  const result=await call('/api/capture/inspect','POST',{capture_id:lookup.id});
  const follow=navigation===navigationVersion;
  if(follow)selected=result.order_id;
  clearExplanation();await load();
  if(follow)focusReview();else message('Saved capture '+lookup.id+' in '+result.order_id+'. Your current investigation remains open.',true);
 },
 inspectRefund:async lookup=>{
  const navigation=++navigationVersion;
  const result=await call('/api/refund/inspect','POST',{refund_id:lookup.id,resolve_order:true});
  const refund=result.refund,follow=navigation===navigationVersion;
  if(follow&&refund.order_id){selected=refund.order_id;clearExplanation();}
  await load();
  if(follow&&refund.order_id){
   workspaceShell.closeDialogs();workspaceShell.closeInvestigations({restoreFocus:false});workspaceShell.showView('records');
   const heading=el('capture-heading');heading.focus({preventScroll:true});heading.scrollIntoView({block:'start'});
  }else if(!follow)message('Saved refund '+lookup.id+'. Your current investigation remains open.',true);
  const amount=refund.amount?[refund.amount.currency,refund.amount.value].join(' '):'Amount unavailable';
  return {message:refund.order_id?'Refund evidence saved.':'Refund '+refund.refund_id+': '+amount+' · '+(refund.status||'Status unavailable')+'. Not yet linked to an order.'+(result.resolution_error?' '+result.resolution_error:'')};
 },
 prepare:lookup=>{
  const input=el(lookup.kind==='order'?'order-id':'event-id');
  input.value=lookup.id;
  const targetDialog=input.closest('dialog');
  if(targetDialog&&!targetDialog.open){workspaceShell.closeDialogs();targetDialog.showModal();}
  for(let parent=input.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  input.scrollIntoView({block:'center'});input.focus();
 }
});
