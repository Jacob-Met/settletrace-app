import {retainedDeliveryGroups} from './finding-catalog.mjs';
import {presentTimelineRecord,formatTimelineClock} from './case-presentation.mjs';

const ORIGINS={
 provider:{label:'PayPal API',tone:'provider'},
 delivery:{label:'Signed webhook',tone:'delivery'},
 shared:{label:'Shared · unverified',tone:'unverified'},
 example:{label:'Example',tone:'unverified'},
 manual:{label:'Unverified',tone:'unverified'}
};
const stamp=value=>{const n=value?Date.parse(value):NaN;return Number.isFinite(n)?n:null;};
const title=record=>({'Order observed':'Order read','Capture observed':'Capture read','Refund observed':'Refund read','Event observed':'Event read'}[record.title]||record.title);
export function traceDuration(ms){
 if(ms<1000)return Math.round(ms)+' ms';
 if(ms<60000)return (ms/1000).toFixed(ms<10000?1:0)+' s';
 if(ms<600000){const seconds=Math.round(ms/1000);return Math.floor(seconds/60)+' min'+(seconds%60?' '+seconds%60+' s':'');}
 if(ms<3600000)return Math.round(ms/60000)+' min';
 return (ms/3600000).toFixed(ms<36000000?1:0)+' h';
}
export function paymentTraceModel(packet={}){
 const entries=[
  ...(packet.events||[]).map(raw=>({raw,kind:'webhook'})),
  ...(packet.snapshots||[]).map(raw=>({raw,kind:raw.resource_kind==='capture'?'capture_read':'order_read'})),
  ...(packet.refund_observations||[]).map(raw=>({raw,kind:'refund_read'}))
 ];
 const repeatedEvents=new Map(retainedDeliveryGroups(packet.events||[]).filter(group=>group.count>1).map(group=>[group.event_id,group]));
 const conflicts=(packet.diagnosis?.notes||[]).filter(note=>note.kind!=='dispute'&&(note.level==='investigate'||note.kind==='capture_amount_claim'));
 const rows=entries.map(({raw,kind})=>{
  const record=presentTimelineRecord({...raw,kind}),at=stamp(record.time);
  const requested=record.observation?stamp(raw.requested_at||raw.reported_requested_at):null;
  const start=requested!==null&&at!==null&&requested<=at?requested:null;
  const conflict=conflicts.find(note=>(note.ids||[]).includes(record.id));
  const delivery=kind==='webhook'?retainedDeliveryGroups([raw])[0]:null;
  const deliveryGroup=delivery?repeatedEvents.get(delivery.event_id)||null:null;
  return {...record,raw,deliveryGroup,key:kind+':'+raw.id,label:title(record),origin:ORIGINS[record.sourceKind]||ORIGINS.manual,at,start,
   duration:start!==null?at-start:null,conflict:conflict?.title||null};
 }).sort((a,b)=>(a.at??Infinity)-(b.at??Infinity)||a.key.localeCompare(b.key));
 const times=rows.flatMap(row=>[row.at,row.start]).filter(value=>value!==null);
 const min=times.length?Math.min(...times):null,max=times.length?Math.max(...times):null;
 return {orderId:packet.order?.id||packet.order_id||null,rows,min,max,conflicts};
}
export function comparedCaptureFacts(selected,other){
 const captures=row=>Array.isArray(row?.raw?.captures)?row.raw.captures:[];
 const counterparts=new Map(captures(other).map(capture=>[capture.id,capture]));
 return captures(selected).filter(capture=>counterparts.has(capture.id)).map(capture=>({id:capture.id,selected:capture,compared:counterparts.get(capture.id)}));
}
function node(tag,cls,text){const item=document.createElement(tag);if(cls)item.className=cls;if(text!==undefined)item.textContent=text;return item;}
function clock(time,full=false){
 if(stamp(time)===null)return 'Time unknown';
 return new Intl.DateTimeFormat('en-GB',{...(full?{day:'2-digit',month:'short'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(time));
}
function originLabel(row){const item=node('span','trace-origin',row.origin.label);item.dataset.origin=row.origin.tone;item.title=row.provenance;return item;}
export function mountPaymentTrace({root,inspector,onOpenSource,appendOriginalDelivery}){
 let model=paymentTraceModel(),selected=null,query='',lastOrder=null,timeWindow='all',extent={min:null,max:null};
 const home=inspector.parentNode,media=window.matchMedia('(max-width:760px)');
 const dialog=node('dialog','sheet trace-inspector-dialog');dialog.setAttribute('aria-label','Payment evidence');document.body.append(dialog);
 let restoreOnClose=true,opener=null;
 function moveInspector(){if(media.matches){dialog.append(inspector);}else{if(dialog.open)dialog.close();home.prepend(inspector);}}
 media.addEventListener('change',moveInspector);moveInspector();
 dialog.addEventListener('close',()=>{if(restoreOnClose&&opener?.isConnected)opener.focus({preventScroll:true});restoreOnClose=true;});
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();});
 function openSource(row){if(dialog.open){restoreOnClose=false;dialog.close();}onOpenSource?.(row);}

 const toolbar=node('div','trace-toolbar'),range=node('span','trace-range'),count=node('span','trace-count');
 const search=node('input','trace-search');search.type='search';search.placeholder='Find in trace';search.setAttribute('aria-label','Find in payment trace');
 const legend=node('div','trace-legend');
 for(const [tone,label] of [['provider','PayPal API'],['delivery','Webhook'],['unverified','Unverified']]){
  const item=node('span','trace-origin',label);item.dataset.origin=tone;legend.append(item);
 }
 toolbar.append(range,count);
 const controls=node('div','trace-controls');
 const windowSelect=node('select','trace-window');windowSelect.setAttribute('aria-label','Trace time window');
 for(const [value,label] of [['all','Full history'],['payment','Payment events']]){const option=node('option','',label);option.value=value;windowSelect.append(option);}
 controls.append(legend,windowSelect,search);
 const axis=node('div','trace-axis'),axisLabel=node('span','','Observation'),ticks=node('div','trace-ticks'),utc=node('span','','UTC');
 axis.append(axisLabel,ticks,utc);
 const rowsRoot=node('div','trace-rows');rowsRoot.setAttribute('role','group');rowsRoot.setAttribute('aria-label','Payment observations');
 const footer=node('div','trace-footer');footer.append(node('span','','↑ ↓ Select observation'),node('span','','O Open full source'));
 root.replaceChildren(toolbar,controls,axis,rowsRoot,footer);
 const inspectorHeader=node('div','trace-inspector-heading');inspectorHeader.append(node('h2','','Source'));const close=node('button','trace-inspector-close','Close');close.type='button';close.addEventListener('click',()=>dialog.close());inspectorHeader.append(close);
 inspector.replaceChildren(inspectorHeader);
 function position(value){return extent.min===null||value===null?0:Math.max(0,Math.min(100,100*(value-extent.min)/Math.max(1,extent.max-extent.min)));}
 function windowRows(){return timeWindow==='payment'?model.rows.filter(row=>row.at!==null&&row.at>=extent.min&&row.at<=extent.max):model.rows;}
 function paintAxis(){
 const events=model.rows.filter(row=>row.kind==='webhook'&&!row.observation&&row.at!==null);
 windowSelect.options[1].disabled=events.length<2;
 if(events.length<2)timeWindow='all';
 windowSelect.value=timeWindow;
 extent=timeWindow==='payment'?{min:Math.min(...events.map(row=>row.at)),max:Math.max(...events.map(row=>row.at))}:{min:model.min,max:model.max};
 range.textContent=extent.min===null?'Payment trace':clock(new Date(extent.min).toISOString(),true)+' — '+clock(new Date(extent.max).toISOString(),true)+' UTC';
 ticks.replaceChildren();
 for(let n=0;n<=4;n++){const tick=node('span','',extent.min===null?'—':traceDuration((extent.max-extent.min)*n/4));tick.style.left=n*25+'%';ticks.append(tick);}
 }
 function showDetails(row){
  inspector.replaceChildren(inspectorHeader);
  if(!row){delete inspector.dataset.selectedRecord;delete inspector.dataset.selectedKind;inspector.append(node('p','trace-empty','Select an observation to inspect its record.'));return;}
  inspector.dataset.selectedRecord=row.id;inspector.dataset.selectedKind=row.kind;
  const heading=node('div','trace-selected');
  heading.append(originLabel(row),node('h3','',row.label));
  if(row.detail)heading.append(node('p','trace-selected-detail',row.detail));
  inspector.append(heading);
  if(row.conflict){
   const conflict=node('div','trace-conflict-note');conflict.append(node('span','trace-break-symbol','≠'),node('span','',row.conflict));inspector.append(conflict);
   const relatedIds=new Set(model.conflicts.filter(note=>(note.ids||[]).includes(row.id)).flatMap(note=>note.ids||[]));
   const others=model.rows.filter(other=>other.key!==row.key&&relatedIds.has(other.id));
   if(others.length){
    const related=node('section','trace-related');related.setAttribute('aria-label','Compared observations');related.append(node('h4','','Compared observations'));
    for(const other of others){
     const card=node('article','trace-related-record');card.dataset.traceCompared=other.id;
     card.append(originLabel(other),node('strong','',other.label));
     if(other.detail)card.append(node('p','trace-related-detail',other.detail));
     card.append(node('p','trace-related-time',other.timeLabel+' · '+formatTimelineClock(other.time)));
     const pairs=comparedCaptureFacts(row,other);
     if(other.reference&&!pairs.some(fact=>other.reference==='Capture '+fact.id))card.append(node('p','trace-related-reference',other.reference));
     for(const fact of pairs){
      const pair=node('div','trace-capture-pair');pair.append(node('code','',fact.id));
      const values=node('dl');
      for(const [label,capture] of [[row.label,fact.selected],[other.label,fact.compared]]){
       const status=String(capture.status||'Status not supplied').toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
       const amount=capture.amount?.currency&&capture.amount?.value?capture.amount.currency+' '+capture.amount.value:'Amount not supplied';
       values.append(node('dt','',label),node('dd','',status+' · '+amount));
      }
      pair.append(values);card.append(pair);
     }
     const open=node('button','text-button trace-related-source','Open compared source ↗');open.type='button';open.dataset.traceComparedSource=other.id;
     open.setAttribute('aria-label','Open compared '+other.label.toLowerCase()+' '+other.id);open.addEventListener('click',()=>openSource(other));card.append(open);related.append(card);
    }
    inspector.append(related);
   }
  }
  const facts=node('dl','trace-evidence-facts');
  const add=(label,value,mono=false)=>{if(value===null||value===undefined||value==='')return;const dd=node('dd',mono?'mono':'',String(value));facts.append(node('dt','',label),dd);};
  const sharedReadReference=row.sourceKind==='shared'&&['order_read','capture_read','refund_read'].includes(row.kind)?row.raw.reported_read_id:null;
  if(sharedReadReference)add('Shared read reference',sharedReadReference,true);
  add(sharedReadReference?'Local record':'Record',row.id,true);
  if(row.reference)add('Resource',row.reference,true);
  if(row.deliveryGroup){add('Event identity',row.deliveryGroup.event_id,true);add(row.sourceKind==='shared'?'Shared receipts':'Recorded receipts',row.deliveryGroup.count+' for the same event');}
  add(row.timeLabel==='Received'&&row.receiptTimeLabel?row.receiptTimeLabel:row.timeLabel,formatTimelineClock(row.time),true);
  if(row.observation&&row.occurred&&row.occurred!==row.time)add('Event occurred',formatTimelineClock(row.occurred),true);
  if(row.receiptTimeLabel&&(row.timeLabel!=='Received'||row.time!==row.received))add(row.receiptTimeLabel,formatTimelineClock(row.received),true);
  if(row.start!==null)add(row.sourceKind==='shared'?'Reported request':'Requested',formatTimelineClock(new Date(row.start).toISOString()),true);
  if(row.duration!==null)add(row.sourceKind==='shared'?'Reported round trip':'Request round trip',traceDuration(row.duration),true);
  inspector.append(facts);
  const open=node('button','trace-open-source','Open full source ↗');open.type='button';open.dataset.traceOpen=row.id;
  open.addEventListener('click',()=>openSource(row));
  inspector.append(open);
  if(row.kind==='webhook'&&appendOriginalDelivery)appendOriginalDelivery(inspector,row.raw);
  const json=node('details','trace-json'),summary=node('summary','','Recorded JSON'),pre=node('pre'),code=node('code');
  code.textContent=JSON.stringify(row.raw,null,2);pre.append(code);json.append(summary,pre);inspector.append(json);
 }
 function filteredRows(){const q=query.trim().toLowerCase();return windowRows().filter(row=>!q||[row.label,row.detail,row.reference,row.id,row.origin.label,row.provenance,row.time,JSON.stringify(row.raw)].join(' ').toLowerCase().includes(q));}
 function select(key,{focus=false,scroll=false,reveal=false}={}){
  const row=model.rows.find(item=>item.key===key);if(!row)return;
  selected=key;
  for(const button of rowsRoot.querySelectorAll('.trace-row')){
   const active=button.dataset.traceKey===key;button.setAttribute('aria-pressed',String(active));button.tabIndex=active?0:-1;
   if(active&&focus)button.focus({preventScroll:true});
   if(active&&scroll)button.scrollIntoView({block:'nearest'});
  }
  showDetails(row);
  if(reveal&&!media.matches){const bounds=inspectorHeader.getBoundingClientRect(),top=document.querySelector('.case-tabs')?.getBoundingClientRect().bottom||0;if(bounds.top<top||bounds.bottom>innerHeight)inspector.scrollIntoView({block:'start'});}
  if(reveal&&media.matches){opener=[...rowsRoot.querySelectorAll('.trace-row')].find(button=>button.dataset.traceKey===key);if(!dialog.open)dialog.showModal();}
 }
 function paintRows(){
  rowsRoot.replaceChildren();const rows=filteredRows();
  count.textContent=rows.length===model.rows.length?model.rows.length+' observations':rows.length+' / '+model.rows.length;
  if(!rows.length){rowsRoot.append(node('p','trace-empty',query?'No matching observations.':'No observations for this payment.'));showDetails(null);return;}
  if(!rows.some(row=>row.key===selected))selected=(rows.find(row=>row.conflict)||rows.at(-1)).key;
  for(const row of rows){
   if(row.conflict){const gap=node('div','trace-break');gap.append(node('span','trace-break-symbol','≠'),node('span','',row.conflict));rowsRoot.append(gap);}
   const button=node('button','trace-row');button.type='button';button.dataset.traceKey=row.key;button.dataset.traceId=row.id;button.dataset.origin=row.origin.tone;
   button.setAttribute('aria-pressed',String(row.key===selected));button.tabIndex=row.key===selected?0:-1;
   button.setAttribute('aria-label',[row.label,row.detail,row.origin.label,row.timeLabel,clock(row.time),row.reference,row.deliveryGroup?'Same event · '+row.deliveryGroup.count+' receipts':null].filter(Boolean).join(' · '));
   const name=node('span','trace-name');name.append(node('strong','',row.label));
   if(row.detail)name.append(node('span','trace-detail',row.detail));
   if(row.deliveryGroup)name.append(node('span','trace-receipts','Same event · '+row.deliveryGroup.count+' receipts'));
   button.title=row.origin.label;
   const track=node('span','trace-track');track.setAttribute('aria-hidden','true');
   if(row.at!==null){
    if(row.start!==null&&row.duration>0){const span=node('span','trace-span');span.style.left=position(row.start)+'%';span.style.width=Math.max(.5,position(row.at)-position(row.start))+'%';track.append(span);}
    const dot=node('span','trace-point');dot.style.left=position(row.at)+'%';track.append(dot);
   }else track.append(node('span','trace-undated','Undated'));
   const time=node('time','trace-time',clock(row.time));if(row.time)time.dateTime=row.time;time.title=row.timeLabel+(row.time?' · '+row.time:' · unknown');
   button.append(name,track,time);
   button.addEventListener('click',()=>select(row.key,{reveal:true}));
   button.addEventListener('keydown',event=>{
    const current=rows.findIndex(item=>item.key===row.key);let index=current;
    if(event.key==='ArrowDown')index=Math.min(rows.length-1,current+1);
    else if(event.key==='ArrowUp')index=Math.max(0,current-1);
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=rows.length-1;
    else if(event.key.toLowerCase()==='o'){event.preventDefault();openSource(row);return;}
    else return;
    event.preventDefault();select(rows[index].key,{focus:true,scroll:true});
   });
   rowsRoot.append(button);
  }
  select(selected);
 }
 function update(packet){
  model=paymentTraceModel(packet);
  if(lastOrder!==model.orderId){query='';search.value='';selected=null;timeWindow='all';lastOrder=model.orderId;rowsRoot.scrollTop=0;}
  paintAxis();
  paintRows();
 }
 windowSelect.addEventListener('change',()=>{timeWindow=windowSelect.value;paintAxis();paintRows();});
 search.addEventListener('input',()=>{query=search.value;paintRows();});
 return {update,clear(){update({});}};
}
