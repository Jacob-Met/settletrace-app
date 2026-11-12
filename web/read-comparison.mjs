// Pure comparison of retained local observations; shared claims are never promoted.
const knownMoney = value => {
 if (!value || !/^[A-Z]{3}$/.test(value.currency || '') || !/^\d+(?:\.\d+)?$/.test(value.value || '')) return null;
 const [whole, fractional = ''] = value.value.split('.');
 return value.currency + ' ' + (whole.replace(/^0+(?=\d)/, '') || '0') + (fractional.replace(/0+$/, '') ? '.' + fractional.replace(/0+$/, '') : '');
};
const amountLabel = amount => amount?.currency && amount?.value ? amount.currency + ' ' + amount.value : 'Amount not retained';
const statusLabel = value => value || 'Status not retained';
export function compareOrderReads(snapshots = [], orderId, selection = null) {
 const allReads = snapshots.filter(read => read.order_id === orderId && read.source === 'sandbox_api' && (!read.resource_kind || read.resource_kind === 'order'));
 // The server retains delayed older responses with superseded_by. They stay in
 // Activity but must never become the apparent after-state of a sequential read.
 const reads = allReads.filter(read => !read.superseded_by);
 const activeOverlap = allReads.filter(read => read.superseded_by && read.superseded_by === reads.at(-1)?.id).length;
 const counts = {read_count:allReads.length,comparable_read_count:reads.length,superseded_read_count:allReads.length-reads.length,overlapping_read_count:activeOverlap};
 const unavailable = reason => ({state:'unavailable',...counts,reason,changes:[]});
 if (reads.length < 2) return unavailable(reads.length ? 'One local API read is saved. Re-read the order to compare observations.' : 'Two local API reads are needed. Shared files and examples are not local API observations.');
 // Applied reads follow journal order; superseded responses are retained separately.
 const beforeIndex = selection ? reads.findIndex(read => read.id === selection.before) : reads.length - 2;
 const afterIndex = selection ? reads.findIndex(read => read.id === selection.after) : reads.length - 1;
 if (beforeIndex < 0 || afterIndex <= beforeIndex) return unavailable('Choose two saved local reads in their recorded order.');
 const before = reads[beforeIndex], after = reads[afterIndex];
 const describe = read => ({id:read.id,observed_at:read.observed_at || null,requested_at:read.requested_at || null,status:read.status || null});
 const prior = new Map(before.captures.map(capture => [capture.id,capture]));
 const current = new Map(after.captures.map(capture => [capture.id,capture]));
 const changes = [];
 if (before.status !== after.status) changes.push({kind:'order_status',label:'Order status',before:statusLabel(before.status),after:statusLabel(after.status)});
 let unchanged = 0, unknownAmounts = 0;
 for (const id of new Set([...prior.keys(),...current.keys()])) {
  const old = prior.get(id), now = current.get(id);
  if (!old) { changes.push({kind:'capture_added',capture_id:id,label:'Capture first seen in later read',before:'Not present in earlier read',after:statusLabel(now.status) + ' · ' + amountLabel(now.amount)}); continue; }
  if (!now) { changes.push({kind:'capture_absent',capture_id:id,label:'Capture absent from later read',before:statusLabel(old.status) + ' · ' + amountLabel(old.amount),after:'Not present in later read',caution:'Absence from this read does not establish a refund, reversal or deletion.'}); continue; }
  let changed = false;
  if (old.status !== now.status) {changes.push({kind:'capture_status',capture_id:id,label:'Capture status',before:statusLabel(old.status),after:statusLabel(now.status)});changed = true;}
  const oldMoney = knownMoney(old.amount), newMoney = knownMoney(now.amount);
  if (oldMoney === null || newMoney === null) unknownAmounts++;
  else if (oldMoney !== newMoney) {changes.push({kind:'capture_amount',capture_id:id,label:'Reported capture amount',before:amountLabel(old.amount),after:amountLabel(now.amount),caution:'Different amounts or currencies need investigation; this is not an additional charge or a refund calculation.'});changed = true;}
  if (!changed) unchanged++;
 }
 return {state:'ready',...counts,before:describe(before),after:describe(after),changes,unchanged_captures:unchanged,unknown_amount_captures:unknownAmounts,limits:['These are two saved API responses, not a live payment balance.','Unrecorded history cannot be reconstructed.']};
}
export function previousChangedReadPair(snapshots, orderId, beforeAfterId = null) {
 const reads = snapshots.filter(read => read.order_id === orderId && read.source === 'sandbox_api' && (!read.resource_kind || read.resource_kind === 'order') && !read.superseded_by);
 const boundary = beforeAfterId ? reads.findIndex(read => read.id === beforeAfterId) : reads.length;
 if (boundary < 0) return null;
 for (let index = Math.min(boundary - 1, reads.length - 1); index > 0; index--) {
  const pair = {before:reads[index-1].id, after:reads[index].id};
  if (compareOrderReads(snapshots, orderId, pair).changes.length) return pair;
 }
 return null;
}
export function readChangeNote(comparison) {
 if (comparison.state !== 'ready' || !comparison.changes.length || comparison.overlapping_read_count) return null;
 const changes = comparison.changes.filter(change => change.kind !== 'order_status');
 if (!changes.length) return null;
 return {level:changes.some(change => ['capture_amount','capture_absent'].includes(change.kind))?'investigate':'info',title:'Capture evidence changed between API reads',
 detail:changes.slice(0,4).map(change => change.capture_id + ': ' + change.before + ' → ' + change.after).join('; ') + (changes.length>4 ? '; ' + (changes.length-4) + ' more changes in the read comparison.' : '.') + ' Compare the two observations; changes alone do not prove a new charge or refund.' + (comparison.unknown_amount_captures?' Some older amounts were not retained.':''),
 ids:[comparison.before.id,comparison.after.id]};
}
export function savedReadState(read){
 const captures=read.captures||[];
 if(!captures.length)return 'Order '+statusLabel(read.status)+' · No captures';
 if(captures.length===1)return 'Capture '+statusLabel(captures[0].status);
 const counts=new Map();for(const capture of captures){const status=statusLabel(capture.status);counts.set(status,(counts.get(status)||0)+1);}
 return captures.length+' captures · '+[...counts].map(([status,count])=>count+' '+status).join(' / ');
}
export function comparisonNote(comparison,orderId){
 if(!orderId||comparison?.state!=='ready')throw Error('Choose two saved reads first.');
 const lines=['Saved order-read comparison: '+orderId,
  'Earlier read '+comparison.before.id+' · '+(comparison.before.observed_at||'Time not recorded'),
  'Later read '+comparison.after.id+' · '+(comparison.after.observed_at||'Time not recorded'),''];
 const groups=comparison.changes.map(change=>(change.capture_id?change.capture_id+' · ':'')+change.label+': '+change.before+' → '+change.after+(change.caution?'\n'+change.caution:''));
 const amountNote=comparison.unknown_amount_captures?'Amount unavailable for '+comparison.unknown_amount_captures+' capture(s); no amount change is inferred.':'';
 if(!groups.length)lines.push('No recorded differences between these two reads.');
 const included=[];
 const finish=()=>[...lines,...included,...(included.length<groups.length?[String(groups.length-included.length)+' additional changes. Open the earlier and later sources for the complete comparison.']:[]),...(amountNote?[amountNote]:[])].join('\n');
 for(const group of groups){included.push(group);if(finish().length>4000){included.pop();break;}}
 const text=finish();
 if(text.length>4000)throw Error('The source references exceed the note limit.');

 return text;
}
const selectedReadPairs = new Map();
export function renderReadComparison(comparison, anchor, context = {}) {
 const {snapshots = [], orderId, openRecord, draftNote} = context;
 const reads = snapshots.filter(read => read.order_id === orderId && read.source === 'sandbox_api' && (!read.resource_kind || read.resource_kind === 'order') && !read.superseded_by);
 const selection = selectedReadPairs.get(orderId);
 if(selection){
  const selected = compareOrderReads(snapshots, orderId, selection);
  if(selected.state === 'ready') comparison = selected;
  else selectedReadPairs.delete(orderId);
 }
 let panel=document.getElementById('read-comparison');
 if(!panel){panel=document.createElement('section');panel.id='read-comparison';panel.className='read-comparison';panel.setAttribute('aria-label','Changes between reads');anchor.after(panel);}
 panel.replaceChildren();panel.hidden=!comparison||(comparison.state==='unavailable'&&!comparison.read_count);
 if(panel.hidden)return;
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
 if(comparison.state!=='ready'){panel.append(node('p',comparison.overlapping_read_count?'Overlapping responses · Refresh payment':comparison.read_count+' read · Refresh to compare','quiet'));return;}
 const count=comparison.changes.length,incomplete=!!comparison.unknown_amount_captures;
 const details=node('details');details.open=!!count||incomplete||selectedReadPairs.has(orderId);
 const resultTitle=count?count+(count===1?' change':' changes'):'No recorded changes';
 details.append(node('summary',reads.length>2?'Compare '+reads.length+' saved reads':resultTitle));
 const times=node('p',undefined,'read-comparison-times');
 const formatTime=value=>{if(!value)return 'Not recorded';const date=new Date(value);return Number.isNaN(date.valueOf())?value:new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(date);};
 for(const [label,read] of [['Before',comparison.before],['After',comparison.after]]){const line=node('span',label+' '),time=node('time',formatTime(read.observed_at));if(read.observed_at)time.dateTime=read.observed_at;line.append(time);times.append(line);}
 if(reads.length<=2)details.append(times);
 if(reads.length > 2){
  const controls=node('div',undefined,'read-range-controls');
  const drawChoice=(label,value)=>{
   const wrapper=node('label',label),select=node('select');select.setAttribute('aria-label',label+' saved read');
   for(const [index,read] of reads.entries()){
    const option=node('option',(index+1)+' · '+savedReadState(read)+' · '+formatTime(read.observed_at));option.value=read.id;select.append(option);
   }
   select.value=value;wrapper.append(select);
   const chosen=reads.find(read=>read.id===value);
   if(chosen?.captures?.length>1){const state=node('span',savedReadState(chosen),'read-choice-state');state.id='read-choice-'+label.toLowerCase();select.setAttribute('aria-describedby',state.id);wrapper.append(state);}
   controls.append(wrapper);return select;
  };
  const before=drawChoice('Earlier',comparison.before.id),after=drawChoice('Later',comparison.after.id);
  const constrain=()=>{
   const earlier=reads.findIndex(read=>read.id===before.value),later=reads.findIndex(read=>read.id===after.value);
   for(const [index,option] of [...before.options].entries())option.disabled=index>=later;
   for(const [index,option] of [...after.options].entries())option.disabled=index<=earlier;
  };constrain();
  const change=event=>{
   const focusLabel=event.target.getAttribute('aria-label');
   selectedReadPairs.set(orderId,{before:before.value,after:after.value});
   renderReadComparison(comparison,anchor,context);
   panel.querySelector('[aria-label="'+focusLabel+'"]').focus({preventScroll:true});
  };
  before.onchange=after.onchange=change;
  const latest=node('button','Latest two reads','secondary');latest.type='button';
  latest.disabled=!selectedReadPairs.has(orderId);
  latest.onclick=()=>{selectedReadPairs.delete(orderId);renderReadComparison(compareOrderReads(snapshots,orderId),anchor,context);panel.querySelector('details').open=true;panel.querySelector('select')?.focus({preventScroll:true});};
  const previousPair=previousChangedReadPair(snapshots,orderId,selectedReadPairs.has(orderId)?comparison.after.id:null);
  const previous=node('button','Previous change','secondary');previous.type='button';previous.disabled=!previousPair;
  previous.onclick=()=>{selectedReadPairs.set(orderId,previousPair);renderReadComparison(comparison,anchor,context);panel.querySelector('details').open=true;panel.querySelector('select')?.focus({preventScroll:true});};
  controls.append(previous,latest);details.append(controls);
 }
 if(openRecord){
  const sources=node('div',undefined,'read-source-actions');
  for(const [label,read] of [['Earlier source',comparison.before],['Later source',comparison.after]]){
   const button=node('button',label,'secondary');button.type='button';button.onclick=()=>openRecord({id:read.id,kind:'order_read'});sources.append(button);
  }
  details.append(sources);
 }
 if(draftNote){const action=node('button','Add comparison to notes','secondary'),feedback=node('p','','form-feedback');action.type='button';feedback.setAttribute('role','status');action.onclick=()=>{try{feedback.textContent=draftNote(comparisonNote(comparison,orderId))||'';}catch(error){feedback.textContent=error.message;}};details.append(action,feedback);}
 if(reads.length>2)details.append(node('p',resultTitle,'read-pair-result'));
 const labels={order_status:'Order status',capture_added:'Capture first seen',capture_absent:'Capture not in this read',capture_status:'Capture status',capture_amount:'Capture amount'};
 for(const change of comparison.changes){
  const row=node('div',undefined,'read-change'),label=node('strong',labels[change.kind]||change.label);
  if(change.capture_id)label.append(node('code',change.capture_id));
  const values=node('div',undefined,'read-change-values');values.append(node('span',change.before,'read-before'),node('span','→','read-arrow'),node('span',change.after,'read-after'));row.append(label,values);if(change.caution)row.append(node('p',change.caution,'quiet'));details.append(row);
 }
 if(incomplete)details.append(node('p','Amount unavailable for '+comparison.unknown_amount_captures+(comparison.unknown_amount_captures===1?' capture':' captures'),'quiet'));
 panel.append(details);
}
