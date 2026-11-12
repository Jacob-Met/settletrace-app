import {selectCaptureRefunds} from './refund-selection.mjs';
import {hasEventAuthority} from './event-origin.mjs';
const money=a=>a?.currency&&a?.value ? a.currency+' '+a.value : null;
const label=s=>({COMPLETED:'Captured',APPROVED:'Approved',CREATED:'Created',PENDING:'Pending',DECLINED:'Declined',DENIED:'Declined',REFUNDED:'Refunded',PARTIALLY_REFUNDED:'Partially refunded',REVERSED:'Reversed',VOIDED:'Voided'}[s]||'Needs lookup');
const tone=s=>/DECLINED|DENIED|REVERSED/.test(s)?'danger':/PENDING|APPROVED|CREATED/.test(s)?'pending':s==='COMPLETED'?'success':'neutral';
export function formatTimelineClock(value){
 const date=new Date(value);
 if(!value||!Number.isFinite(date.getTime()))return 'Time unknown';
 return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,...(date.getUTCMilliseconds()?{fractionalSecondDigits:3}:{}),timeZone:'UTC'}).format(date)+' UTC';
}
// Recognize only the saved-finding serializer's complete observation row.
// This is display of retained text, not a fresh state or provenance assessment.
export function presentSavedObservationRow(line){
 if(typeof line!=='string')return null;
 const scope=/^(PayPal order read|PayPal capture read|Shared claim, not locally revalidated|Authored example|Unverified observation) at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z) reports (order|capture) ([A-Za-z0-9-]+) (COMPLETED|PARTIALLY_REFUNDED)(?: \/ (amount not supplied|[A-Z]{3} \d+(?:\.\d+)?))?\.$/.exec(line);
 if(scope&&scope[0]===line){
  const [,basis,time,resource,resourceId,status,amount]=scope,date=new Date(time);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==time.replace(/(?<=:\d{2})Z$/,'.000Z'))return null;
  if(resource==='order'?(status!=='COMPLETED'||amount!==undefined||basis==='PayPal capture read'):(status!=='PARTIALLY_REFUNDED'||amount===undefined||basis==='PayPal order read'))return null;
  return {original:line,kind:resource+'_read',label:resource==='order'?'Order read':'Capture read',resourceId,status,amount:amount&&amount!=='amount not supplied'?amount:null,time,timeLabel:basis.startsWith('Shared claim')?'Reported read':'Observed',basis};
 }
 const match=/^(refund_read|capture_read|order_read|event|Delivery received) · ([A-Z][A-Z0-9_]*) · (Amount unavailable|[A-Z]{3} \d+(?:\.\d+)?) · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/.exec(line);
 if(!match||match[0]!==line)return null;
 const [,type,status,amount,time]=match,date=new Date(time);
 if(!Number.isFinite(date.getTime())||date.toISOString()!==time.replace(/(?<=:\d{2})Z$/,'.000Z'))return null;
 const kinds={refund_read:['refund_read','Refund read','Observed'],capture_read:['capture_read','Capture read','Observed'],order_read:['order_read','Order read','Observed'],event:['event','Event','Occurred'],'Delivery received':['delivery','Event delivery','Received']};
 const [kind,label,timeLabel]=kinds[type];
 return {original:line,kind,label,status,amount:amount==='Amount unavailable'?null:amount,time,timeLabel};
}
// An order source shows only captures actually contained in that observation.
export function presentOrderReadCaptures(record){
 if(record.kind!=='order_read'||!Array.isArray(record.captures))return [];
 return record.captures.map(capture=>({
  id:capture.id||null,
  status:capture.status?label(capture.status):'State not supplied',
  amount:money(capture.amount)
 }));
}
export function presentTimelineRecord(record){
 const refundRead=record.kind==='refund_read'||record.resource_kind==='refund'||record.source==='sandbox_refund_api'||record.source==='imported_packet'&&record.reported_source==='sandbox_refund_api';
 const captureRead=record.kind==='capture_read'||record.resource_kind==='capture';
 const read=refundRead||captureRead||record.kind==='order_read'||Array.isArray(record.captures);
 const eventRead=record.source==='sandbox_event_api'||record.source==='imported_packet'&&record.reported_source==='sandbox_event_api';
 const kind=read?(refundRead?'refund_read':captureRead?'capture_read':'order_read'):'webhook';
 const status=read?record.status:record.type?.split('.').at(-1);
 const amount=read?(refundRead?money(record.amount):captureRead?money(record.amount||record.captures?.[0]?.amount):record.captures?.length===1?money(record.captures[0].amount):null):money(record.refund_amount||record.capture_amount);
 const sourceKind=record.sample||record.source==='authored_sample'?'example':record.source==='imported_packet'?'shared':record.source==='sandbox_event_api'?'provider':read&&['sandbox_api','sandbox_capture_api','sandbox_refund_api'].includes(record.source)?'provider':record.verified?'delivery':'manual';
 const resourceId=(refundRead?record.refund_id:null)||record.capture_id||record.resource_id||record.order_id||null;
 const eventTitle=record.type==='PAYMENT.CAPTURE.REFUNDED'?'Refund recorded':record.type?.startsWith('CHECKOUT.ORDER.')?'Order '+(status==='COMPLETED'?'completed':label(status).toLowerCase()):record.type==='PAYMENT.CAPTURE.COMPLETED'?'Capture completed':record.type==='PAYMENT.CAPTURE.REVERSED'?'Capture reversed':record.type==='PAYMENT.CAPTURE.PENDING'?'Capture pending':record.type==='PAYMENT.CAPTURE.DENIED'?'Capture denied':record.type||'Event record';
 const title=eventRead?'Event observed':read?(refundRead?'Refund observed':captureRead?'Capture observed':'Order observed'):eventTitle;
 const eventReadAt=record.provider_observed_at||record.reported_provider_observed_at||null;
 const time=eventRead?eventReadAt:read?record.observed_at||null:record.occurred||record.received||null;
 const timeLabel=eventRead?(sourceKind==='shared'?'Reported read':'Read'):read?(sourceKind==='shared'?'Reported read':'Observed'):record.occurred?'Occurred':'Received';
 const provenance=(sourceKind==='example'?'Example':sourceKind==='shared'?'Shared claim · unverified':sourceKind==='manual'?(read?'Unverified observation':record.source==='manual'?'Imported event · unverified':'Received event · unverified'):read?'PayPal API read':record.source==='sandbox_event_api'?'PayPal event record · no delivery signature':'Signature verified')+(record.superseded_by?' · Earlier response retained':'');
 const refundStatus=String(status||'State not supplied').toLowerCase().replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
 const detail=[eventRead?eventTitle:read?(refundRead?refundStatus:captureRead?label(status):status==='COMPLETED'?'Order completed':label(status)):null,amount].filter(Boolean).join(' · ')||(read?'State not supplied':'');
 const reference=refundRead||record.type==='PAYMENT.CAPTURE.REFUNDED'?['Refund '+(record.refund_id||record.resource_id||'unknown'),record.capture_id?'Capture '+record.capture_id:null].filter(Boolean).join(' · '):resourceId?((read&&!captureRead)||record.type?.startsWith('CHECKOUT.ORDER.')?'Order ':'Capture ')+resourceId:null;
 return {id:record.id,kind,title,detail,selectionAt:refundRead?record.requested_at||record.reported_requested_at||record.observed_at||null:null,superseded:!!record.superseded_by,reference,time,timeLabel,provenance,occurred:record.occurred||null,groupId:eventRead?record.event_id||record.id:resourceId,received:record.received||null,receiptTimeLabel:!read&&!eventRead?(sourceKind==='shared'?'Reported receipt':'Received'):null,observedAt:record.provider_observed_at||record.observed_at||null,tone:['shared','example','manual'].includes(sourceKind)?'neutral':tone(status),sourceKind,resourceId,sortAt:eventReadAt||record.observed_at||record.received||record.occurred||'',observation:read||eventRead};
}
// Activity is ordered by the same observation clock shown to the operator.
export function chronologicalActivity(records){
 return records.map((record,index)=>({record,index,at:Date.parse(presentTimelineRecord(record).time)}))
  .sort((a,b)=>(Number.isFinite(a.at)?a.at:Infinity)-(Number.isFinite(b.at)?b.at:Infinity)||a.index-b.index)
  .map(({record})=>record);
}
// Overview is a compact selection, not a rewritten history. Keep the newest
// actual event alongside the latest observation of each exact resource.
export function overviewTimeline(records,limit=3){
 const ordered=[...records].sort((a,b)=>(b.sortAt||'').localeCompare(a.sortAt||''));
 const latestEvent=ordered.find(record=>!record.observation),seen=new Set(),selected=latestEvent?[latestEvent]:[];
 for(const record of ordered){
  if(selected.length>=limit)break;
  if(record===latestEvent)continue;
  if(record.observation){
   const key=JSON.stringify([record.kind,record.groupId||record.resourceId,record.sourceKind]);
   if(record.superseded&&ordered.some(other=>other.observation&&!other.superseded&&JSON.stringify([other.kind,other.groupId||other.resourceId,other.sourceKind])===key))continue;
   if(record.kind==='refund_read'&&ordered.some(other=>other.kind==='refund_read'&&JSON.stringify([other.kind,other.groupId||other.resourceId,other.sourceKind])===key&&(Date.parse(other.selectionAt)||0)>(Date.parse(record.selectionAt)||0)))continue;
   if(seen.has(key))continue;seen.add(key);
   const readCount=ordered.filter(other=>other.observation&&JSON.stringify([other.kind,other.groupId||other.resourceId,other.sourceKind])===key).length;
   selected.push({...record,readCount});
  }else selected.push(record);
 }
 return selected.sort((a,b)=>(b.sortAt||'').localeCompare(a.sortAt||''));
}
function captureStates(packet,order){
 const original=(order?.units||[]).flatMap(unit=>unit.captures||[]),byId=new Map(original.map(capture=>[capture.id,capture]));
 const differences=[];let localRead=false,sharedRead=false;
 for(const row of packet.captures||[]){
  if(order?.sample||row.sample)continue;
  const local=row.latest_capture_read?.source==='sandbox_capture_api'&&row.latest_capture_read.capture_id===row.id?row.latest_capture_read:null;
  const shared=(row.capture_reads||[]).filter(read=>read.source==='imported_packet'&&read.capture_id===row.id).at(-1);
  const read=local||((!order||order.imported)?shared:null);
  if(!read?.status)continue;
  const previous=byId.get(row.id);
  byId.set(row.id,{...previous,id:row.id,status:read.status,amount:read.amount||previous?.amount||row.amount});
  localRead ||= !!local;sharedRead ||= !local;
  if(previous?.status&&previous.status!==read.status)differences.push({id:row.id,orderStatus:previous.status,captureStatus:read.status,shared:!local});
 }
 return {captures:[...original.map(capture=>byId.get(capture.id)),...[...byId.values()].filter(capture=>!original.some(item=>item.id===capture.id))],differences,localRead,sharedRead};
}
export function presentCase(packet={}){
 const order=packet.order,id=order?.id||packet.order_id||'',events=packet.events||[],reads=packet.snapshots||[],refunds=packet.refund_observations||[];
 const captureView=captureStates(packet,order),captures=captureView.captures;
 const sourceKind=order?.sample?'example':captureView.localRead?'provider':order?.imported||captureView.sharedRead?'shared':order?'provider':events.some(hasEventAuthority)?'provider':'manual';
 const notes=packet.diagnosis?.notes||[],conflict=notes.find(n=>n.level==='investigate'&&n.kind!=='dispute'),dispute=notes.find(n=>n.kind==='dispute'&&n.review_required),reported=notes.find(n=>n.title==='Shared file reports conflicting capture amounts');
 const amountConflict=notes.find(n=>n.kind==='capture_amount'&&n.level==='investigate')||(sourceKind==='shared'?notes.find(n=>n.kind==='capture_amount_claim'):null);
 let status={label:'Needs lookup',tone:'neutral'};
 if(conflict&&sourceKind==='provider'&&!captureView.localRead)status={label:'Review',tone:'danger'};
 else if(captures.length){const states=[...new Set(captures.map(c=>c.status))];status=states.length===1?{label:label(states[0]),tone:tone(states[0])}:{label:'Mixed captures',tone:'pending'};}
 else if(order)status={label:order.status==='COMPLETED'?'Order completed':label(order.status),tone:'pending'};
 if(amountConflict&&sourceKind==='provider')status={label:'Review amounts',tone:'danger'};
 if(sourceKind==='example'||sourceKind==='shared')status={...status,tone:'neutral'};
 if(amountConflict&&sourceKind==='shared')status={label:'Compare amounts',tone:'neutral'};
 const reversal=events.find(e=>e.order_id===id&&hasEventAuthority(e)&&e.type==='PAYMENT.CAPTURE.REVERSED'&&captures.some(c=>c.id===e.resource_id));
 if(reversal&&sourceKind==='provider')status={label:'Review reversal',tone:'danger'};
 const amounts=[...new Set(captures.map(c=>money(c.amount)).filter(Boolean))];
 const unitAmounts=(order?.units||[]).map(u=>money(u.amount)).filter(Boolean);
 const amount=captures.length===1?money(captures[0].amount):captures.length>1?captures.length+' captures':unitAmounts.length===1?unitAmounts[0]:null;
 const difference=captureView.differences.length===1?captureView.differences[0]:null;
 const comparison=difference?'Capture '+difference.id+' · '+(order?.imported?'In shared order':'In order read')+': '+label(difference.orderStatus)+' · '+(difference.shared?'Shared capture read':'Capture read')+': '+label(difference.captureStatus):captureView.differences.length?'Order and capture reads differ for '+captureView.differences.length+' captures':null;
 const summary=sourceKind==='example'?'Example payment':reversal&&sourceKind==='provider'?'Capture reversal recorded':comparison|| (!conflict&&dispute?'Dispute needs review':conflict?(/amount/i.test(conflict.title)?'Capture amounts differ':/revers/i.test(conflict.title)?'Capture reversed':/failure/i.test(conflict.title)?'Capture statuses differ':'Compare capture records'):reported?'Shared amounts differ':status.label);
 const primaryAction=sourceKind==='example'?{kind:'inspect',label:'Find a payment'}:sourceKind==='shared'||!order?{kind:'inspect',label:'Look up payment'}:conflict?{kind:'refresh',label:'Refresh payment'}:{kind:'refresh',label:'Refresh payment'};
 const singleAmount=amountConflict?null:captures.length===1?captures[0].amount:!captures.length&&order?.units?.length===1?order.units[0].amount:null;
 const refundReads=captures.length===1?selectCaptureRefunds(refunds,captures[0].id,id):[];
 const refundAmount=refundReads.length===1?money(refundReads[0].read.amount):null;
 const nextSteps=!conflict&&dispute?[{title:dispute.title,action:dispute.action,sourceIds:dispute.ids||[]}]:conflict||reported?[{title:summary,action:primaryAction.label,sourceIds:[...new Set((conflict||reported).ids||[])]}]:[];
 const statusScope=sourceKind==='shared'?{sourceLabel:'Shared file · not verified',displayStatus:'Reported · '+status.label}:{sourceLabel:null,displayStatus:status.label};
 return {id,...statusScope,nextSteps,comparisonCaptureId:summary===comparison?difference?.id||null:null,refundAmount,refundSource:refundAmount?refundReads[0].read.source:null,amount:singleAmount?.value||'—',currency:singleAmount?.currency||'',amountLabel:amountConflict?'Compare capture amounts':amount||'—',amounts,status,summary,primaryAction,metrics:{captures:captures.length,events:events.length,reads:reads.length+refunds.length},sourceKind,sourceIds:[...new Set((conflict||reported)?.ids||[])],timeline:[...events.map(e=>presentTimelineRecord({...e,kind:'webhook'})),...reads.map(r=>presentTimelineRecord({...r,kind:r.resource_kind==='capture'?'capture_read':'order_read'})),...refunds.map(r=>presentTimelineRecord({...r,kind:'refund_read'}))].sort((a,b)=>(b.time||'').localeCompare(a.time||''))};
}

export const presentPayment=presentCase;

export function refundStatusSubtotals(rows){
 const identities=new Map();
 const scaled=value=>{const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(6,'0'));};
 const format=value=>{const whole=value/1000000n,fraction=(value%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');return whole+'.'+fraction;};
 for(const row of rows){
  if(!row.id||!row.amount||!/^([A-Z]{3})$/.test(row.amount.currency)||!/^\d{1,24}(?:\.\d{1,6})?$/.test(String(row.amount.value)))return [];
  const amount=scaled(String(row.amount.value)),old=identities.get(row.id);
  if(old&&(old.currency!==row.amount.currency||old.amount!==amount))return [];
  const entry=old||{currency:row.amount.currency,amount,statuses:new Set()};
  for(const status of row.statuses||[])entry.statuses.add(typeof status==='string'&&/^[A-Z][A-Z_]*$/.test(status)?status:'UNKNOWN');
  identities.set(row.id,entry);
 }
 const groups=new Map();
 for(const entry of identities.values()){
  const statuses=[...entry.statuses].sort();if(!statuses.length)statuses.push('UNKNOWN');
  const key=entry.currency+':'+statuses.join('/'),group=groups.get(key)||{currency:entry.currency,statuses,amount:0n,count:0};
  group.amount+=entry.amount;group.count++;groups.set(key,group);
 }
 return [...groups.values()].map(({amount,...group})=>({...group,value:format(amount)}));
}
export function refundStatusSubtotalLabel(group){
 return group.currency+' '+group.value+' · '+group.statuses.map(status=>status.replaceAll('_',' ')).join(' / ')+' observed';
}
