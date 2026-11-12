import {orderCaptureScopeCopy,findingFollowupResultText,refundEvidenceLimits} from './finding-catalog.mjs';
import {presentSavedObservationRow,refundStatusSubtotals,refundStatusSubtotalLabel} from './case-presentation.mjs';
const text=value=>String(value??'unknown').replace(/[\r\n\u0000-\u001f\u007f]+/g,' ').trim()||'unknown';
// Recognize only the generator's exact canonical wording. Edited notes retain
// their complete body instead of being restated as the canonical explanation.
export function scopePresentation(detail){
 const copy=orderCaptureScopeCopy,prefix=copy.title+': '+copy.explanation.join(' ');
 if(!detail.startsWith(prefix))return null;
 const at=detail.indexOf(copy.limits,prefix.length);
 if(at<0||detail.indexOf(copy.limits,at+copy.limits.length)>=0)return null;
 const reads=detail.slice(prefix.length,at).trim();if(!reads)return null;
 const rows=reads.split(/(?<=\.)\s+/).map(presentSavedObservationRow);
 const observations=rows.every(row=>row?.resourceId)&&rows.some(row=>row.kind==='order_read')&&rows.some(row=>row.kind==='capture_read')?rows:null;
 return {explanation:copy.explanation.join('\n\n'),reads,limits:copy.limits,operatorText:detail.slice(at+copy.limits.length).trim(),...(observations?{observations}:{})};
}
// The same exact saved facts lead both Share and the recipient's note. Values
// come from the saved wording, never a later workspace observation.
export function appendSavedScopeObservations(host,scope,{shared=false,renderSource=null,renderCaptureControl=null}={}){
 if(!scope.observations?.length)return false;
 const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const section=make('section','saved-scope-observations'),groups=new Map();
 section.setAttribute('aria-label','Saved order and capture observations');
 for(const row of scope.observations){
  const key=row.kind+':'+row.resourceId;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 for(const rows of groups.values()){
  const first=rows[0],resource=make('div','saved-scope-resource'),heading=make('h4','saved-scope-heading',first.kind==='order_read'?'Order':'Capture');
  const captureControl=first.kind==='capture_read'?renderCaptureControl?.(first.resourceId):null;
  if(!captureControl)heading.append(make('code','saved-scope-reference',first.resourceId));
  resource.append(heading);
  if(captureControl)resource.append(captureControl.row,captureControl.status);
  const values=new Map();
  for(const row of rows){const key=JSON.stringify([row.status,row.amount,row.basis]);if(!values.has(key))values.set(key,[]);values.get(key).push(row);}
  for(const observations of values.values()){
   const row=observations[0],value=make('div','saved-scope-value');
   if(row.amount)value.append(make('strong','saved-scope-amount',row.amount));
   value.append(make('span','saved-scope-status',row.status==='COMPLETED'?'Completed':'Partially refunded'));resource.append(value);
   if(row.kind==='capture_read'&&!row.amount)resource.append(make('p','saved-scope-basis','Amount not supplied'));
   const claim=shared||row.basis.startsWith('Shared claim');
   resource.append(make('p','saved-scope-basis',row.basis==='Authored example'?'Authored example':claim?'Shared observations · not locally revalidated':row.basis));
   const times=make('div','saved-scope-times');
   for(const observation of observations){
    const source=renderSource?.(observation);if(source){times.append(source);continue;}
    const time=make('time','');time.dateTime=observation.time;time.title=observation.time;
    time.textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'}).format(new Date(observation.time))+' UTC';times.append(time);
   }
   resource.append(times);
  }
  section.append(resource);
 }
 host.append(section);return true;
}
export function appendSavedFollowupResult(host,result){
 const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const section=make('section','saved-followup-result','');
 section.append(make('p','saved-followup-answer',result.result));
 for(const condition of result.conditions)section.append(make('p','saved-followup-condition',condition));
 section.append(make('p','saved-followup-scope',result.scope),make('p','saved-followup-caution',result.caution));
 host.append(section);
}

function savedGatheredObservations(lines,orderId){
 if(lines[0]!=='Saved finding: '+orderId||!lines[1]?.startsWith('Question: ')||lines[2]!=='Retained evidence only; not a fresh provider check.'||!lines[3]?.startsWith('Original question: ')||!lines[4]?.startsWith('Original result: ')||lines[5]!=='Follow-up result: '+findingFollowupResultText.records)return null;
 let index=6;const conditions=[],limits=[],groups=[];
 while(lines[index]?.startsWith('Condition: ')){const value=lines[index++].slice(11);if(!value||conditions.includes(value))return null;conditions.push(value);}
 while(lines[index]?.startsWith('Limit: ')){const value=lines[index++].slice(7);if(!refundEvidenceLimits.includes(value)||limits.includes(value))return null;limits.push(value);}
 while(index<lines.length){
  const match=/^(Capture|Refund) ([A-Za-z0-9_-]+): Retained observations gathered$/.exec(lines[index++]);if(!match)return null;
  const name=match[1]+' '+match[2];if(groups.some(group=>group.name===name))return null;
  const observations=[];let row;
  while((row=presentSavedObservationRow(lines[index]))&&!row.resourceId){observations.push(row);index++;}
  const allowed=match[1]==='Refund'?['refund_read','event','delivery']:['order_read','capture_read','event','delivery'];
  if(!observations.length||observations.some(row=>!allowed.includes(row.kind))||lines[index++]!=='Source group: '+name)return null;
  const sources=[];let source;
  while((source=/^Finding source (webhook|order_read|capture_read|refund_read) (\S+) · (shared|saved|authored) observation$/.exec(lines[index]||''))){sources.push({kind:source[1],reference:source[2],mode:source[3]});index++;}
  const rowKinds=observations.map(row=>['event','delivery'].includes(row.kind)?'webhook':row.kind).sort(),sourceKinds=sources.map(source=>source.kind).sort();
  if(JSON.stringify(rowKinds)!==JSON.stringify(sourceKinds)||new Set(sources.map(source=>source.kind+':'+source.reference)).size!==sources.length)return null;
  let associatedCapture=null;
  if(match[1]==='Refund'){
   const association=/^Associated capture: ([A-Za-z0-9_-]+|not recorded) · association retained with the refund; not a fresh capture check$/.exec(lines[index++]);if(!association||limits.length!==refundEvidenceLimits.length)return null;associatedCapture=association[1];
  }
  groups.push({name,observations,associatedCapture,sourceModes:[...new Set(sources.map(source=>source.mode))]});
 }
 return groups.length?{conditions,limits,groups}:null;
}

function savedRelatedObservationAnswer(lines,orderId,{directRead=false}={}){
 if(lines[0]!=='Saved finding: '+orderId||!lines[1]?.startsWith('Question: ')||lines[2]!=='Retained evidence only; not a fresh provider check.')return null;
 if(!directRead&&(!lines[3]?.startsWith('Original question: ')||!lines[4]?.startsWith('Original result: ')||lines[5]!=='Follow-up result: '+findingFollowupResultText.answer))return null;
 const conditions=[],limits=[],groups=[],names=new Map();let index=directRead?3:6;
 while(lines[index]?.startsWith('Condition: ')){const value=lines[index++].slice(11);if(!value||conditions.includes(value))return null;conditions.push(value);}
 if(!conditions.length)return null;
 while(lines[index]?.startsWith('Limit: ')){const value=lines[index++].slice(7);if(!refundEvidenceLimits.includes(value)||limits.includes(value))return null;limits.push(value);}
 if(limits.length!==refundEvidenceLimits.length)return null;
 const readGroup=(type,id,summary,related)=>{
  const name=type+' '+id;
  const observations=[];let row;
  while((row=presentSavedObservationRow(lines[index]))&&!row.resourceId){observations.push(row);index++;}
  if(summary==='Matching retained observations'&&!observations.length||!related&&summary!=='Matching retained observations'&&observations.length)return null;
  if(type==='Refund'&&!observations.length)return null;
  const allowed=type==='Refund'?['refund_read','event','delivery']:['order_read','capture_read','event'];
  if(observations.some(row=>!allowed.includes(row.kind))||lines[index++]!=='Source group: '+name)return null;
  const sources=[];let source;
  while((source=/^Finding source (webhook|order_read|capture_read|refund_read) (\S+) · (shared|saved|authored) observation$/.exec(lines[index]||''))){sources.push({kind:source[1],reference:source[2],mode:source[3]});index++;}
  if(!sources.length||new Set(sources.map(s=>s.kind+':'+s.reference)).size!==sources.length)return null;
  if(observations.length){
   const rowKinds=observations.map(o=>['event','delivery'].includes(o.kind)?'webhook':o.kind).sort(),sourceKinds=sources.map(s=>s.kind).sort();
   if(JSON.stringify(rowKinds)!==JSON.stringify(sourceKinds))return null;
  }else if(sources.some(s=>!['order_read','capture_read','webhook'].includes(s.kind)))return null;
  let associatedCapture=null;
  if(type==='Refund'){
   const association=/^Associated capture: ([A-Za-z0-9_-]+) · association retained with the refund; not a fresh capture check$/.exec(lines[index++]||'');
   if(!association)return null;associatedCapture=association[1];
  }
  const group={name,resourceType:type.toLowerCase(),resourceId:id,observations,related,sourceModes:[...new Set(sources.map(source=>source.mode))],...(summary&&summary!=='Matching retained observations'&&!observations.length?{summary}:{}),...(associatedCapture?{associatedCapture}:{})};const signature=JSON.stringify([group,sources]),previous=names.get(name);if(previous)return related&&previous.group.related&&previous.signature===signature?previous.group:null;names.set(name,{group,signature});groups.push(group);return group;
 };
 let targets=0;
 while(index<lines.length){
  const match=/^(Capture|Refund) ([A-Za-z0-9_-]+): (Matching retained observations|(?:Shared observations · )?[A-Z]{3} \d+(?:\.\d+)?)$/.exec(lines[index++]||'');
  if(!match)return null;
  const target=readGroup(match[1],match[2],match[3],false);if(!target)return null;targets++;
  const related=[];let relation;
  while((relation=/^Related resource: (Capture|Refund) ([A-Za-z0-9_-]+)(?: · ([A-Z]{3} \d+(?:\.\d+)?))?$/.exec(lines[index]||''))){
   index++;if(relation[1].toLowerCase()===target.resourceType)return null;
   const resource=readGroup(relation[1],relation[2],relation[3]||null,true);if(!resource||related.some(r=>r.name===resource.name))return null;related.push(resource);
  }
  if(!related.length)return null;
  if(target.resourceType==='capture'){if(related.some(r=>r.associatedCapture!==target.resourceId))return null;}
  else if(related.length!==1||target.associatedCapture!==related[0].resourceId)return null;
 }
 return targets?{conditions,limits,groups,related:true}:null;
}

function savedObservationAnswer(lines,orderId,{directRead=false}={}){
 if(lines[0]!=='Saved finding: '+orderId||!lines[1]?.startsWith('Question: ')||lines[2]!=='Retained evidence only; not a fresh provider check.')return null;
 if(!directRead&&(!lines[3]?.startsWith('Original question: ')||!lines[4]?.startsWith('Original result: ')||lines[5]!=='Follow-up result: '+findingFollowupResultText.answer))return null;
 const conditions=[],limits=[],groups=[];let index=directRead?3:6;
 while(lines[index]?.startsWith('Condition: ')){const value=lines[index++].slice(11);if(!value||conditions.includes(value))return null;conditions.push(value);}
 if(!conditions.length)return null;
 while(lines[index]?.startsWith('Limit: ')){const value=lines[index++].slice(7);if(!refundEvidenceLimits.includes(value)||limits.includes(value))return null;limits.push(value);}
 while(index<lines.length){
  const match=/^(Order|Capture|Refund) ([A-Za-z0-9_-]+): Matching retained observations$/.exec(lines[index++]);if(!match||match[1]==='Order'&&(!directRead||match[2]!==orderId))return null;
  const name=match[1]+' '+match[2];if(groups.some(g=>g.name===name))return null;
  const observations=[];let row;
  while((row=presentSavedObservationRow(lines[index]))&&!row.resourceId){observations.push(row);index++;}
  const allowed=match[1]==='Order'?['order_read']:match[1]==='Refund'?['refund_read','event','delivery']:['order_read','capture_read','event','delivery'];
  if(!observations.length||observations.some(row=>!allowed.includes(row.kind)||match[1]==='Order'&&row.amount!==null)||lines[index++]!=='Source group: '+name)return null;
  const sources=[];let source;
  while((source=/^Finding source (webhook|order_read|capture_read|refund_read) (\S+) · (shared|saved|authored) observation$/.exec(lines[index]||''))){sources.push({kind:source[1],reference:source[2],mode:source[3]});index++;}
  const rowKinds=observations.map(o=>['event','delivery'].includes(o.kind)?'webhook':o.kind).sort(),sourceKinds=sources.map(s=>s.kind).sort();
  if(JSON.stringify(rowKinds)!==JSON.stringify(sourceKinds)||new Set(sources.map(s=>s.kind+':'+s.reference)).size!==sources.length)return null;
  let associatedCapture=null;
  if(match[1]==='Refund'){
   const association=/^Associated capture: ([A-Za-z0-9_-]+|not recorded) · association retained with the refund; not a fresh capture check$/.exec(lines[index++]);
   if(!association||limits.length!==refundEvidenceLimits.length)return null;associatedCapture=association[1];
  }
  groups.push({name,observations,sourceModes:[...new Set(sources.map(source=>source.mode))],...(associatedCapture?{associatedCapture}:{})});
 }
 if(limits.length&&!groups.some(group=>group.associatedCapture))return null;
 return groups.length?{conditions,groups,...(limits.length?{limits}:{})}:null;
}


function savedRefundSubtotal(lines,orderId,{directRead=false}={}){
 const markers=lines.filter(line=>line.startsWith('Recorded refund subtotal: '));
 if(markers.length!==1)return null;
 const match=/^Recorded refund subtotal: ([A-Z]{3}) (\d{1,24}(?:\.\d{1,6})?) · ([1-9]\d*) distinct refunds$/.exec(markers[0]);
 if(!match)return null;
 const answer=savedObservationAnswer(lines.filter(line=>line!==markers[0]),orderId,{directRead});
 if(!answer||answer.groups.length!==Number(match[3])||answer.groups.some(group=>!group.name.startsWith('Refund '))||answer.limits?.length!==refundEvidenceLimits.length)return null;
 const scaled=value=>{const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(6,'0'));};
 let sum=0n;
 for(const group of answer.groups){
  const values=group.observations.map(row=>/^([A-Z]{3}) (\d{1,20}(?:\.\d{1,6})?)$/.exec(row.amount||''));
  if(!values.length||values.some(value=>!value||value[1]!==match[1]))return null;
  const amount=scaled(values[0][2]);if(values.some(value=>scaled(value[2])!==amount))return null;
  sum+=amount;
 }
 if(sum!==scaled(match[2]))return null;
 const statusAmounts=refundStatusSubtotals(answer.groups.map(group=>({id:group.name,amount:{currency:match[1],value:group.observations[0].amount.split(' ')[1]},statuses:group.observations.map(row=>row.status)})));
 return {answer,currency:match[1],value:match[2],count:Number(match[3]),statusAmounts,limit:refundEvidenceLimits[2]};
}
function savedSourceBasis(modes,shared){
 const basis=[];
 if(shared||modes.includes('shared'))basis.push((shared||modes.every(mode=>mode==='shared')?'Shared observations':'Includes shared observations')+' · not locally revalidated');
 if(modes.includes('authored'))basis.push(modes.every(mode=>mode==='authored')?'Authored example observations':'Includes authored example observations');
 return basis;
}
export function appendSavedRefundSubtotal(host,subtotal){
 const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const block=make('section','finding-subtotal note-reading-subtotal','');block.dataset.refundSubtotal=subtotal.value;
 block.append(make('h4','note-reading-resource','Recorded refund subtotal'),make('strong','note-reading-amount',subtotal.currency+' '+subtotal.value),make('p','note-meta',subtotal.count+' distinct retained refund'+(subtotal.count===1?'':'s')));
 for(const group of subtotal.statusAmounts||[])block.append(make('p','note-reading-context',refundStatusSubtotalLabel(group)));
 for(const basis of subtotal.sourceBasis?.length?subtotal.sourceBasis:['Retained observations · not a fresh provider check'])block.append(make('p','note-meta',basis));
 block.append(make('p','note-reading-context',subtotal.limit));host.append(block);
}

export function appendSavedObservation(host,row){
 const make=(tag,cls,text='')=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const observation=make('div','note-reading-observation'),main=make('div','note-reading-observation-main');
 if(row.amount)main.append(make('strong','note-reading-amount',row.amount));
 main.append(make('span','note-reading-status',row.status.replaceAll('_',' ')));observation.append(main);
 const when=make('p','note-reading-when',row.label+' · '+row.timeLabel+' '),time=make('time','');
 time.dateTime=row.time;time.title=row.time;time.textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'}).format(new Date(row.time))+' UTC';when.append(time);observation.append(when);host.append(observation);
}

export function incidentSummary(packet){
 const order=packet.order,events=packet.events||[],reads=packet.snapshots||[];
 const id=packet.order_id||order?.id;
 const orderReads=reads.filter(r=>r.resource_kind!=='capture'),captureReads=reads.filter(r=>r.resource_kind==='capture');
 const refundReads=(packet.refund_observations||[]).filter(r=>r.order_id===id);
 if(!id||!packet.diagnosis)throw Error('A selected incident with a supported review is required.');
 const provenance=order?.imported?'SHARED PACKET — order claims not locally revalidated'+(order.sample?' (authored example)':''):order?.sample?'AUTHORED EXAMPLE — no provider payment established':order?'PAYPAL SANDBOX ORDER OBSERVATION':'ORDER UNKNOWN — no order read available';
 const lines=['SettleTrace incident: '+text(id),''];
 const explanation=handoffExplanation(packet);
 if(explanation?.plainText){lines.push(explanation.shared?'Latest shared operator note':'Latest saved operator note',explanation.plainText,'','Full investigation summary','');}
 else if(explanation){
  lines.push(explanation.shared?'Latest shared operator explanation':'Latest saved operator explanation','Question: '+text(explanation.question));
  if(explanation.result&&(!explanation.followupResult||explanation.followup))lines.push((explanation.followup?'Original result: ':'Result: ')+text(explanation.result));
  if(explanation.followup)lines.push('Follow-up: '+text(explanation.followup));
  if(explanation.followupResult){const result=explanation.followupResult;lines.push((explanation.followup?'Follow-up result: ':'Result: ')+result.result,...result.conditions.map(condition=>'Condition: '+condition),'Search scope: '+result.scope,result.caution);}
  if(explanation.refundSubtotal){const subtotal=explanation.refundSubtotal;lines.push('Recorded refund subtotal: '+subtotal.currency+' '+subtotal.value+' · '+subtotal.count+' distinct retained refunds',...(subtotal.statusAmounts||[]).map(refundStatusSubtotalLabel),...subtotal.sourceBasis,subtotal.limit);}
  if(explanation.observation&&!explanation.refundSubtotal)lines.push((explanation.operatorContext?'Operator conclusion: ':'Recorded observation: ')+text(explanation.observation));
  if(explanation.detail)lines.push('Saved explanation:',explanation.detail);
  lines.push('','Full investigation summary','');
 }

 const answers=(packet.diagnosis.notes||[]).filter(note=>note.answer);
 if(answers.length){lines.push('Payment answer');for(const note of answers)lines.push(text(note.answer));lines.push('');}
 lines.push('Evidence basis: '+provenance,'Order status: '+(order?text(order.status):'NOT OBSERVED'),'Prepared: '+text(packet.generated),'');
 const counts={signed:0,manual:0,shared:0,sample:0,provider:0,other:0};
 for(const e of events){if(e.source==='imported_packet')counts.shared++;else if(e.sample)counts.sample++;else if(e.source==='manual')counts.manual++;else if(e.source==='sandbox_event_api')counts.provider++;else if(e.verified)counts.signed++;else counts.other++;}
 if(packet.operator_notes?.length){lines.push('Operator notes');for(const note of packet.operator_notes){lines.push((note.source==='shared'?'Shared note':'Local note')+' · '+text(note.recorded_at));for(const line of String(note.text).split('\n'))lines.push('  '+line);}lines.push('');}
 lines.push('Supported findings');
 const notes=packet.diagnosis.notes||[];
 if(!notes.length)lines.push('- No determinations available.');
 for(const n of notes){
  lines.push('- ['+text(n.level).toUpperCase()+'] '+text(n.title)+': '+text(n.detail));
  if(n.ids?.length)lines.push('  Evidence references: '+n.ids.map(text).join(', '));
 }
 lines.push('','Suggested next checks');
 for(const [i,a] of (packet.diagnosis.actions||[]).entries())lines.push((i+1)+'. '+text(a));
 if(!packet.diagnosis.actions?.length)lines.push('No additional check supplied by the deterministic review.');
 lines.push('');
 lines.push('Evidence in this workspace',
  '- '+orderReads.length+' order observations; '+captureReads.length+' capture observations; '+refundReads.length+' refund observations; '+events.length+' event records.',
  '- Events: '+counts.signed+' signature verified; '+counts.manual+' manual/unverified; '+counts.shared+' shared/not reverified; '+counts.sample+' authored; '+counts.provider+' provider API observations; '+counts.other+' other/unverified.');
 for(const e of events){
  if(e.source==='sandbox_event_api')lines.push('- Provider event '+text(e.event_id)+': local observation '+text(e.id)+' at '+text(e.provider_observed_at)+'. API observation only; not local webhook receipt or signature verification.');
  else if(e.source==='imported_packet'&&e.reported_source==='sandbox_event_api')lines.push('- Shared provider-event claim '+text(e.event_id)+': '+text(e.id)+'; reported observation '+text(e.reported_provider_observed_at)+'. Imported claim, not locally revalidated.');
 }
 const latest=orderReads.at(-1);if(latest)lines.push('- Latest saved order observation: '+text(latest.id)+'; '+text(latest.observed_at)+'; source '+text(latest.source)+(latest.source==='imported_packet'?' (reported, not locally revalidated)':'')+'.');
 lines.push('- Missing webhook records do not prove a delivery failure or disprove payment.','');
 const comparison=packet.read_comparison;
 if(comparison?.state==='ready'){
  lines.push('','Changes between saved API responses',
   'Comparison follows local save order, not a reconstructed provider-event chronology.',
   '- First saved: '+text(comparison.before?.id)+'; observed '+text(comparison.before?.observed_at)+'.',
   '- Next saved: '+text(comparison.after?.id)+'; observed '+text(comparison.after?.observed_at)+'.');
  if(!comparison.changes?.length)lines.push('- No recorded status or comparable amount change.');
  for(const change of comparison.changes||[]){
   lines.push('- '+text(change.label)+(change.capture_id?' / '+text(change.capture_id):'')+': '+text(change.before)+' → '+text(change.after)+'.');
   if(change.caution)lines.push('  '+text(change.caution));
  }
  if(comparison.unknown_amount_captures)lines.push('- Amount comparison unavailable for '+comparison.unknown_amount_captures+' capture(s): one or both saved responses did not retain an amount. No amount change is inferred.');
  for(const limit of comparison.limits||[])lines.push('- '+text(limit));
 }
 if(packet.captures?.length){
  lines.push('','Exact capture comparison');
  for(const c of packet.captures){
   lines.push('- Capture '+text(c.id)+(c.amount?' / '+text(c.amount.currency)+' '+text(c.amount.value):' / amount not supplied')+': '+text(c.assessment));
   lines.push('  Latest saved order claim: '+text(c.api_status||'not observed')+'.');
   for(const e of c.events||[])if(e.refund_id)lines.push('  Refund '+text(e.refund_id)+': '+(e.refund_amount?text(e.refund_amount.currency)+' '+text(e.refund_amount.value):'amount not supplied')+'; '+text(e.refund_status||'status not supplied')+'; event '+text(e.id)+'. This event alone does not establish a full refund or remaining balance.');
  }
 }
 if(refundReads.length){
  const money=a=>a?.currency&&a.value!==undefined?text(a.currency)+' '+text(a.value):'not supplied';
  lines.push('','Exact refund observations','Repeated reads are observations of a refund, not additional refunds. No sum or remaining balance is inferred.');
  for(const r of refundReads){
   const shared=r.source==='imported_packet',sample=r.sample;
   const basis=sample?'Authored example; no payment established':shared?'Shared claim; not locally revalidated':r.source==='sandbox_refund_api'?'Local PayPal Sandbox refund read':'Unverified refund claim';
   lines.push('- Refund '+text(r.refund_id)+' → capture '+text(r.capture_id)+'; order '+text(r.order_id)+'.',
    '  This refund amount: '+money(r.amount)+'; status '+text(r.status)+'.',
    '  '+(shared?'Shared claim of provider-reported':'Provider-reported')+' refunded total for the original capture: '+money(r.total_refunded_amount)+'.',
    '  Source: '+basis+'; observation '+text(r.id)+'.',
    '  '+(shared?'Reported request':'Requested')+': '+text(shared?r.reported_requested_at:r.requested_at)+'; '+(shared?'reported response':'response observed')+': '+text(r.observed_at)+'.');
  }
  lines.push('Refund API reads and imported claims do not establish webhook delivery or signature verification.');
 }
 lines.push('','Handoff limits','This summary uses the saved deterministic review, not AI-generated conclusions. It is a snapshot, not a fresh provider check.','Attach the JSON evidence packet when the recipient needs the complete normalized history. Raw deliveries, signature headers and provider customer details are excluded. Saved operator notes are included.');
 for(const limit of packet.limits||[])lines.push('- '+text(limit));
 return lines.join('\n')+'\n';
}
export function handoffExplanation(packet){
 const note=packet.operator_notes?.at(-1);if(!note)return null;
 const lines=String(note.text).split('\n'),value=prefix=>lines.find(line=>line.startsWith(prefix))?.slice(prefix.length)||'';
 const original=value('Original question: '),question=value('Question: ');
 if(lines.filter(line=>line.startsWith('Question: ')).length>1)return null;
 if(!question&&!original)return /^(Saved finding:|Saved order-read comparison:)/m.test(note.text)||!String(note.text).trim()?null:{plainText:String(note.text),shared:note.source==='shared'};
 const followupMarkers=lines.filter(line=>line.startsWith('Follow-up result: '));
 const followupKind=original&&followupMarkers.length===1&&lines.filter(line=>line.startsWith('Original question: ')).length===1&&lines.filter(line=>line.startsWith('Original result: ')).length===1?(Object.entries(findingFollowupResultText).find(([,text])=>followupMarkers[0]==='Follow-up result: '+text)?.[0]||null):null;
 const lead={question:original||question||'Latest investigation note',result:original?value('Original result: '):value('Result: '),followup:original?question:'',observation:value('Operator context: ')||value('Recorded refund subtotal: ')||value('Delivery timing: '),operatorContext:!!value('Operator context: '),followupKind,shared:note.source==='shared'};
 const results=lines.filter(line=>line.startsWith('Result: ')),scopes=lines.filter(line=>line.startsWith('Search scope: ')),scope='retained records for '+(packet.order_id||packet.order?.id||''),caution='This saved search does not establish that a payment action never happened.';
 const directConditions=lines.slice(2,-2);
 const directEmpty=!original&&question&&lines[0]==='Question: '+question&&lines[1]==='Result: No matching retained records.'&&lines.at(-2)==='Search scope: '+scope&&lines.at(-1)===caution&&directConditions.length>0&&directConditions.every(line=>/^Condition: \S/.test(line))&&new Set(directConditions).size===directConditions.length;
 if(question&&(lead.followupKind==='answer'||directEmpty)&&results.length===1&&results[0]==='Result: No matching retained records.'&&scopes.length===1&&scopes[0]==='Search scope: '+scope&&(packet.order_id||packet.order?.id)&&lines.filter(line=>line===caution).length===1){
  lead.followupResult={result:'No matching retained records.',conditions:lines.filter(line=>line.startsWith('Condition: ')).map(line=>line.slice(11)),scope,caution};
 }
 const saved=lines.filter(line=>/^(Saved finding|Saved limitation): /.test(line));
 if(lines.some(line=>line.startsWith('Recorded refund subtotal: '))){
  const subtotal=savedRefundSubtotal(lines,packet.order_id||packet.order?.id,{directRead:!original});
  if(!subtotal)return {...lead,plainText:String(note.text),shared:note.source==='shared'};
  lead.observationAnswer=subtotal.answer;
  const {answer,...display}=subtotal;
  lead.refundSubtotal={...display,sourceBasis:savedSourceBasis([...new Set(answer.groups.flatMap(group=>group.sourceModes))],lead.shared)};
 }

 if((!lead.observation||lead.refundSubtotal)&&saved.length===1&&['Saved finding: ','Saved limitation: '].some(prefix=>saved[0]===prefix+(packet.order_id||packet.order?.id))){
  const detail=lines.filter(line=>!(followupKind&&line.startsWith('Follow-up result: '))&&!/^(Saved finding|Saved limitation): /.test(line)&&!/^(Question|Original question|Original result|Result|Source group): /.test(line)&&!/^Finding source (webhook|order_read|capture_read|refund_read) \S+ · /.test(line)&&line!=='Retained evidence only; not a fresh provider check.').join('\n').trim();
  if(detail){lead.detail=detail;const scope=scopePresentation(detail);if(scope)lead.scope=scope;else if(followupKind==='records'){const gathered=savedGatheredObservations(lines,packet.order_id||packet.order?.id);if(gathered)lead.gatheredObservations=gathered;}else if(followupKind==='answer'||!original){const related=savedRelatedObservationAnswer(lines,packet.order_id||packet.order?.id,{directRead:!original});if(related)lead.relatedAnswer=related;else{const answer=savedObservationAnswer(lines,packet.order_id||packet.order?.id,{directRead:!original});if(answer)lead.observationAnswer=answer;}}}
 }
 for(const answer of [lead.observationAnswer,lead.relatedAnswer,lead.gatheredObservations]){
  if(!answer)continue;
  for(const group of answer.groups){
   group.sourceBasis=savedSourceBasis(group.sourceModes,lead.shared);
  }
 }
 return lead;
}
export function mountIncidentSummary(anchor,{getSelected,loadPacket,pendingNote=()=>'',saveNote}){
 const make=(tag,content,cls)=>{const n=document.createElement(tag);if(content)n.textContent=content;if(cls)n.className=cls;return n;};
 const headerButtons=[...document.querySelectorAll('[data-open-dialog="handoff-dialog"]')];
 const open=make('button','Prepare handoff','outline');open.type='button';open.id='prepare-summary';open.disabled=true;if(!headerButtons.length)anchor.insertAdjacentElement('afterend',open);
 let visibleOpener=headerButtons[0]||open;
 const panel=make('section',null,'incident-summary');panel.hidden=true;panel.setAttribute('aria-labelledby','summary-heading');
 const heading=make('h4','Incident summary','sr-only');heading.id='summary-heading';
 
 const preview=make('textarea');preview.id='incident-summary-text';preview.readOnly=true;preview.rows=12;preview.setAttribute('aria-label','Supported incident summary');preview.spellcheck=false;
 const explanation=make('section',null,'handoff-explanation');explanation.hidden=true;
 const full=make('details',null,'handoff-full-summary'),fullLabel=make('summary','Full investigation summary');full.append(fullLabel,preview);
 const actions=make('div',null,'actions'),file=make('button','Download investigation','primary'),copy=make('button','Copy summary','outline'),download=make('button','Download text','outline'),close=make('button','Close summary','outline');
 file.id='download-investigation';file.title='Open this JSON file in SettleTrace to continue the investigation';
 for(const b of [file,copy,download,close])b.type='button';
 const status=make('p',null,'quiet');status.id='summary-status';status.setAttribute('role','status');
 actions.append(file,copy,download,close);panel.append(heading,actions,explanation,full,status);const host=document.getElementById('handoff-content'),dialog=document.getElementById('handoff-dialog');if(host)host.append(panel);else (anchor.closest('.grid-main')||anchor.closest('.actions')).insertAdjacentElement('afterend',panel);
 const draftPanel=make('section',null,'stack-form'),draftHeading=make('h3','Include your note?'),draftPreview=make('p',null,'note-text'),saveDraft=make('button','Save note and prepare','primary'),savedOnly=make('button','Use saved notes only','outline');draftPanel.id='handoff-note-draft';saveDraft.id='handoff-save-note';savedOnly.id='handoff-saved-only';saveDraft.type=savedOnly.type='button';draftPanel.hidden=true;draftPanel.append(draftHeading,draftPreview,saveDraft,savedOnly);panel.prepend(draftPanel);
 let generation=0,preparedId=null,preparedPacket=null,currentId=null,savingDraft=false;
 const showDraft=value=>{draftPanel.hidden=!value;full.hidden=actions.hidden=!!value;explanation.hidden=!!value||!explanation.childElementCount;};
 const setAvailable=value=>{for(const button of headerButtons)button.disabled=!value;};
 const clear=()=>{if(dialog?.open)dialog.close();generation++;preparedId=null;preparedPacket=null;explanation.replaceChildren();explanation.hidden=true;file.disabled=true;preview.value='';panel.hidden=true;copy.disabled=true;download.disabled=true;status.textContent='';showDraft(false);open.disabled=!getSelected();setAvailable(!!getSelected());};
 const prepare=async(skipDraft=false)=>{
  const id=getSelected();if(!id)return;if(dialog&&!dialog.open){for(const other of document.querySelectorAll('dialog[open]'))other.close();dialog.showModal();}const version=++generation;preparedId=null;preparedPacket=null;explanation.replaceChildren();explanation.hidden=true;file.disabled=true;preview.value='';panel.hidden=false;copy.disabled=true;download.disabled=true;open.disabled=true;setAvailable(false);status.textContent='Preparing summary for '+id+'…';
  const draft=skipDraft?'':pendingNote();showDraft(!!draft);
  if(draft){draftPreview.textContent=draft;status.textContent='This note has not been saved or included in the download.';open.disabled=false;setAvailable(true);saveDraft.focus();return;}
  try{
   const packet=await loadPacket(id);if(version!==generation||getSelected()!==id)return;
   if((packet.order_id||packet.order?.id)!==id)throw Error('The returned evidence belongs to another incident.');
   preview.value=incidentSummary(packet);explanation.replaceChildren();const lead=handoffExplanation(packet);explanation.hidden=!lead;full.open=!lead||(!lead.plainText&&!lead.observation&&!lead.result&&!lead.detail);
   if(lead?.plainText){explanation.append(make('p',lead.shared?'Shared operator note':'Saved operator note','note-meta'),make('p',lead.plainText,'handoff-plain-note'));}
   else if(lead?.observationAnswer||lead?.relatedAnswer||lead?.gatheredObservations){
    const answer=lead.gatheredObservations||lead.relatedAnswer||lead.observationAnswer;
    if(lead.gatheredObservations)explanation.append(make('p',lead.shared?'Shared operator note':'Saved operator note','note-meta'),make('h3',lead.question),make('p',lead.result,'handoff-result'),make('h4',lead.followup),make('p','Records gathered; not a supported answer.','note-meta'));
    else explanation.append(make('p',lead.shared?'Shared operator note':'Saved operator note','note-meta'),make('h3',lead.followup||lead.question),make('p',lead.followup?'Answer to the refined question · retained observations':'Retained observations','note-meta'));
    if(lead.refundSubtotal)appendSavedRefundSubtotal(explanation,lead.refundSubtotal);
    for(const condition of answer.conditions)explanation.append(make('p',condition,'saved-followup-condition'));
    const reading=make('div',null,'note-reading');
    for(const group of answer.groups){
     const section=make('section',null,'note-reading-group');section.append(make('h4',group.related?'Related '+group.name[0].toLowerCase()+group.name.slice(1):group.name,'note-reading-resource'));
     if(group.summary)section.append(make('p',group.sourceBasis?.some(basis=>basis.startsWith('Shared observations'))?group.summary.replace(/^Shared observations · /,''):group.summary,'note-reading-context'));
     for(const basis of group.sourceBasis||[])section.append(make('p',basis,'note-meta'));
     for(const row of group.observations)appendSavedObservation(section,row);
     if(group.associatedCapture)section.append(make('p','Associated capture · '+group.associatedCapture,'note-reading-context'),make('p','Retained association; not a fresh capture check.','note-meta'));
     reading.append(section);
    }
    explanation.append(reading);
    if(answer.limits?.length){const limits=make('details',null,'handoff-full-summary');limits.append(make('summary','Not established: cause, buyer receipt, refundable balance'));for(const limit of answer.limits)limits.append(make('p',limit,'handoff-result'));explanation.append(limits);}
    if(lead.followup&&!lead.gatheredObservations){const original=make('details',null,'handoff-full-summary handoff-original-result');original.append(make('summary','Original question and result'),make('p',lead.question,'handoff-observation'),make('p',lead.result,'handoff-result'));explanation.append(original);}
   }
   else if(lead?.followupResult){
    explanation.append(make('p',lead.shared?'Shared operator note':'Saved operator note','note-meta'),make('h3',lead.followup||lead.question));appendSavedFollowupResult(explanation,lead.followupResult);
    if(lead.followup){const original=make('details',null,'handoff-full-summary');original.append(make('summary','Original question and result'),make('p',lead.question,'handoff-observation'),make('p',lead.result,'handoff-result'));explanation.append(original);}
   }else if(lead){explanation.append(make('p',lead.shared?'Shared operator note':'Saved operator note','note-meta'),make('h3',lead.question));if(lead.result)explanation.append(make('p',lead.result,'handoff-result'));if(lead.followup)explanation.append(make('p','Follow-up: '+lead.followup,'note-meta'));if(lead.observation)explanation.append(make('p',lead.operatorContext?'Operator conclusion':'Recorded observation','note-meta'),make('p',lead.observation,'handoff-observation'));}
   if(lead?.scope){
    appendSavedScopeObservations(explanation,lead.scope,{shared:lead.shared});
    explanation.append(make('p',lead.scope.explanation,'handoff-observation'),make('p',lead.scope.limits,'handoff-result'));
    if(!lead.scope.observations){const retained=make('details',null,'handoff-full-summary');retained.append(make('summary','Retained reads'),make('p',lead.scope.reads,'note-meta'));explanation.append(retained);}
    if(lead.scope.operatorText)explanation.append(make('p',lead.scope.operatorText,'handoff-observation'));
   }else if(lead?.detail&&!lead.observationAnswer&&!lead.relatedAnswer&&!lead.gatheredObservations)explanation.append(make('p',lead.detail,'handoff-observation'));
   preparedId=id;preparedPacket=packet;file.disabled=false;copy.disabled=false;download.disabled=false;status.textContent='Prepared from saved evidence for '+id+'.';file.focus({preventScroll:true});if(!dialog)panel.scrollIntoView({block:'start'});
  }catch(error){if(version===generation&&getSelected()===id)status.textContent='Could not prepare summary: '+error.message;}
  finally{if(version===generation){open.disabled=!getSelected();setAvailable(!!getSelected());}}
 };
 open.onclick=()=>prepare();
 savedOnly.onclick=()=>prepare(true);
 saveDraft.onclick=async()=>{
  const id=getSelected(),version=generation;if(!id||savingDraft)return;savingDraft=true;saveDraft.disabled=savedOnly.disabled=true;status.textContent='Saving note…';
  try{await saveNote();if(id===getSelected()&&version===generation&&(!dialog||dialog.open))await prepare(true);}
  catch(error){if(id===getSelected()&&version===generation)status.textContent='Could not save note: '+error.message;}
  finally{savingDraft=false;saveDraft.disabled=savedOnly.disabled=false;}
 };
 copy.onclick=async()=>{
  if(!preparedId||preparedId!==getSelected())return;
  const id=preparedId,value=preview.value,version=generation;
  try{await navigator.clipboard.writeText(value);if(version===generation&&id===getSelected())status.textContent='Copied summary for '+id+'.';}
  catch{if(version===generation&&id===getSelected()){full.open=true;preview.focus();preview.select();status.textContent='Clipboard access is unavailable. The summary is selected; copy it with your device’s copy command, or download the text.';}}
 };
 file.onclick=()=>{
  if(!preparedPacket||!preparedId||preparedId!==getSelected())return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(preparedPacket,null,2)],{type:'application/json'})),a=make('a');a.href=url;a.download='settletrace-'+preparedId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status.textContent='Investigation downloaded. Import the file in SettleTrace to reopen its records and notes.';
 };
 download.onclick=()=>{
  if(!preparedId||preparedId!==getSelected())return;
  const url=URL.createObjectURL(new Blob([preview.value],{type:'text/plain;charset=utf-8'})),a=make('a');a.href=url;a.download='settletrace-'+preparedId+'-summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 close.onclick=()=>{clear();dialog?.close();visibleOpener.focus();};
 dialog?.addEventListener('close',()=>{if(visibleOpener.isConnected&&!visibleOpener.disabled)visibleOpener.focus();});
 document.addEventListener('click',event=>{const button=event.target.closest('[data-open-dialog="handoff-dialog"]');if(button){visibleOpener=button;open.click();}});
 return {update(){const id=getSelected();if(id!==currentId){currentId=id;clear();}open.disabled=!id;setAvailable(!!id);},invalidate(){if(!savingDraft)clear();}};
}

