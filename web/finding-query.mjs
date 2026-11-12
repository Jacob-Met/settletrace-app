// Action eligibility cannot be inferred from a retained refund observation.
// Keep requests to inspect historical reads on their ordinary evidence path.
export function refundDecisionQuestion(question){
 const q=String(question);
 const actor='(?:i|we|you|the merchant|the seller)';
 const permission=new RegExp('\\b(?:can|could|may|should)\\s+'+actor+'\\s+(?:(?:still|safely|now|also)\\s+)*(?:refund|reimburse)\\b','i');
 const issue=new RegExp('\\b(?:can|could|may|should)\\s+'+actor+'\\s+(?:(?:still|safely|now|also)\\s+)*(?:issue|send|make|process|approve)\\b[^?!.]{0,50}\\brefund\\b','i');
 return permission.test(q)||issue.test(q)||/\b(?:safe|possible|allowed|permitted|eligible)\s+(?:for\s+(?:me|us)\s+)?to\s+(?:refund|reimburse)\b/i.test(q)||/\b(?:refund(?:ing)?|reimburs(?:e|ing))\b[^?!.]{0,80}\b(?:rest|remainder)\b/i.test(q);
}

// Bounded deterministic filters over normalized fields, never generated facts.
function scaledAmount(amount){
 if(!amount?.currency||!/^\d{1,20}(?:\.\d{1,6})?$/.test(String(amount.value)))return null;
 const [whole,fraction='']=String(amount.value).split('.');
 return {currency:amount.currency,value:BigInt(whole+fraction.padEnd(6,'0'))};
}

function amountConstraint(question,references=[]){
 const known=new Set(references.filter(id=>typeof id==='string'&&id.length>=6&&/\d/.test(id)).map(id=>id.toLowerCase()));
 const text=String(question).replace(/[a-z0-9]+(?:-[a-z0-9]+)*/gi,word=>known.has(word.toLowerCase())?' '.repeat(word.length):word);
 const operator=/\b(more than|greater than|above|over|less than|below|under|at least|at most|no less than|no more than|equal to|exactly|for|of|at)\s+(?=(?:[a-z]{3}\s+)?[$€£¥]?[+-]?(?:\d|\.\d))/gi;
 const spans=[...text.matchAll(operator)];
 // Every explicit monetary clue must belong to the one supported comparison.
 // Do not silently drop a second amount, currency, range or shorthand.
 const moneyClue=value=>/(?<![\w-])[a-z]{3}\s*[+-]?(?:\d|\.\d)|[$€£¥]\s*[+-]?(?:\d|\.\d)|(?:\d|\.\d)\s*(?:dollars?|euros?|pounds?|yen|usd|eur|gbp|jpy)\b/i.test(value.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/gi,''));
 if(!spans.length)return moneyClue(text)?{error:true}:null;
 if(spans.length!==1)return {error:true};
 const span=spans[0],tail=text.slice(span.index+span[0].length);
 const amount=/^([a-z]{3})\s+(\d{1,20}(?:\.\d{1,6})?)(?![\w.,])/i.exec(tail);
 if(!amount)return {error:true};
 const end=span.index+span[0].length+amount[0].length;
 if(moneyClue(text.slice(0,span.index)+' '+text.slice(end)))return {error:true};
 const rawOp=span[1].toLowerCase(),op=/^(for|of|at)$/.test(rawOp)?'exactly':rawOp;
 return {op,currency:amount[1].toUpperCase(),value:amount[2],span:[span.index,end],
  compare:op==='at least'||op==='no less than'?'gte':op==='at most'||op==='no more than'?'lte':op==='equal to'||op==='exactly'?'eq':/^(more than|greater than|above|over)$/.test(op)?'gt':'lt'};
}


function referenceIntentText(question,references=[]){
 const known=new Set(references.filter(id=>typeof id==='string').map(id=>id.toLowerCase()));
 return String(question).replace(/[a-z0-9]+(?:-[a-z0-9]+)*/gi,word=>known.has(word.toLowerCase())?'REFERENCE':word).trim().replace(/[?.]$/,'').toLowerCase().replace(/\s+/g,' ');
}
export function ordinaryRefundCaptureAmountQuestion(question,references=[]){
 const q=referenceIntentText(question,references);
 return /^how much(?: money)? of (?:(?:this|the) capture|capture reference) (?:was|has been|had been|is) (?:refunded|paid back|reimbursed)$/.test(q);
}
export function ordinaryRefundAmountQuestion(question,references=[]){
 const q=referenceIntentText(question,references);
 return /^(?:how much(?: money)? (?:was|has been|had been|is) (?:refunded|paid back|reimbursed)|(?:what is (?:the )?)?(?:recorded |retained )?refund amount)(?: (?:for|on|from) (?:(?:this|the) (?:order|payment)|(?:(?:refund|capture|order) )?reference))?$/.test(q);
}
export function ordinaryRefundRecordRequest(question,references=[]){
 const q=referenceIntentText(question,references).replace(/^(?:please |(?:can|could) (?:you|we|i) )/,'');
 return /^(?:(?:show|list|find|inspect|open|browse|get)(?: me)?(?: the)?(?: (?:all|every|each|recorded|retained|saved))* )?(?:refunds?|reimbursements?)(?: reference)?(?: (?:histories|history|observations|records|details|state|status|currency|amount|evidence))?(?: (?:for|on|from) (?:capture )?reference)?$/.test(q)
  ||/^(?:show|inspect|open) reference$/.test(q)
  ||/^what does (?:refund )?reference (?:report|show|say)$/.test(q)
  ||/^what (?:is|was) (?:the )?(?:(?:later|latest|earlier|earliest) )?(?:recorded )?(?:status|state|currency|amount) of (?:refund )?reference$/.test(q)
  ||/^what amount does (?:refund )?reference (?:report|show|say)$/.test(q)
  ||/^are two reference deliveries two refunds$/.test(q);
}

const observationScope=/\b(?:order|capture(?:[- ]only)?|refund)\s+reads?\b|\b(?:webhook\s+)?events?\b/gi;
// Status words are predicates only as separate words, never inside record IDs.
const observationStatus=/(?<![\w-])(partially[ _]refunded|refunded|declined|completed|complete|completion|pending|failed|unsuccessful|denied|cancelled|canceled|reversed)(?![\w-])/gi;
const reportedStatusClaim=/\b(?:reports?|reporting|says?|saying)\s+(?:(?:that|it|is|was|a|an|the|status|of|as)\s+)*(partially[ _]refunded|[a-z][a-z_-]*)(?![\w-])/gi;
const canonicalStatus=word=>word.toUpperCase().replace(/ +/g,'_').replace('CANCELED','CANCELLED').replace(/^(COMPLETE|COMPLETION)$/,'COMPLETED').replace('UNSUCCESSFUL','FAILED');
const kindLabel={event:'Event',order_read:'Order read',capture_read:'Capture read',refund_read:'Refund read'};
const localReadSources={order_read:'sandbox_api',capture_read:'sandbox_capture_api',refund_read:'sandbox_refund_api'};
const localQualifier=/(?<![\w-])local(?:ly)?(?:[- ]only)?(?![\w-])/i;
const sharedQualifier=/(?<![\w-])(?:shared|imported)(?:[- ]only)?(?![\w-])/i;

const observationTime=record=>Date.parse(record.kind==='event'?record.occurred_at:record.observed_at);

// Parse complete UTC terminals before splitting source clauses, so the "or"
// in "on or after" cannot turn a time bound into a status alternative.
function observationBounds(question){
 const text=String(question),bounds=[];
 const pattern=/\b(on or after|on or before|after|before)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)(?=$|[\s,?.;])/gi;
 let masked='',cursor=0;
 for(const match of text.matchAll(pattern)){
  const raw=match[2].toUpperCase(),value=Date.parse(raw),canonical=raw.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction='')=>'.'+fraction.padEnd(3,'0')+'Z');
  if(!Number.isFinite(value)||new Date(value).toISOString()!==canonical)return {error:true};
  bounds.push({start:match.index,end:match.index+match[0].length,operator:match[1].toLowerCase(),value,stamp:canonical});
  masked+=text.slice(cursor,match.index)+' '.repeat(match[0].length);cursor=match.index+match[0].length;
 }
 masked+=text.slice(cursor);
 if(bounds.length>4||/(?<![\w-])\d{4}-\d{2}-\d{2}|\b(yesterday|today|tomorrow)\b|\b(?:last|this|next)\s+(?:day|week|month|year)\b/i.test(masked))return {error:true};
 return {bounds,masked};
}

// A source-qualified predicate must be established by that exact source and
// its own clock. Event occurrence and read observation are not delivery time.
function filterObservationQuestion(question,selected,timeBounds){
 const original=String(question),text=timeBounds.masked,scopes=[...text.matchAll(observationScope)],statuses=[...text.matchAll(observationStatus)];
 if(!scopes.length)return null;
 if(!statuses.length&&!timeBounds.bounds.length&&/\b(not|never|no|without|except|excluding)\b|n['’]t\b/i.test(text.replace(/\bno (?:less|more) than\b/gi,'amount comparison')))return {checks:[],reason:'observation_condition_unavailable'};
 const parts=text.split(/\b(and|but|then|or)\b/i),clauses=[];let cursor=0;
 for(let i=0;i<parts.length;i+=2){
  const start=cursor,end=start+parts[i].length,part=original.slice(start,end);cursor=end+(parts[i+1]?.length||0);
  const bounds=timeBounds.bounds.filter(b=>b.start>=start&&b.end<=end);
  const scope=[...parts[i].matchAll(observationScope)],status=[...parts[i].matchAll(observationStatus)];
  if(!scope.length&&!status.length){
   if(localQualifier.test(parts[i]))return {checks:[],reason:'observation_source_condition_unavailable'};
   if(!bounds.length){
    if(i>0&&parts[i].replace(/[\s,?.;]/g,''))return {checks:[],reason:'observation_clause_unavailable'};
    continue;
   }
   if(!clauses.length||parts[i-1]?.toLowerCase()!=='and'||parts[i].replace(/[\s,?.;]/g,''))return {checks:[],reason:'observation_time_condition_unavailable'};
   clauses.at(-1).bounds.push(...bounds);continue;
  }
  if(scope.length!==1||status.length>1)return {checks:[],reason:'observation_condition_unavailable'};
  const word=scope[0][0].toLowerCase(),kind=/event/.test(word)?'event':word.startsWith('order')?'order_read':word.startsWith('capture')?'capture_read':'refund_read';
  if(bounds.length&&(/\b(received|receipt|delivery|delivered|arrived|arrival|sent)\b/i.test(part)||kind==='event'&&/\bobserved\b/i.test(part)||kind!=='event'&&/\boccurred\b/i.test(part)))return {checks:[],reason:'observation_time_condition_unavailable'};
  const local=localQualifier.test(part),shared=sharedQualifier.test(part);
  if(local&&(shared||kind==='event'||/(?<![\w-])(?:verified|revalidated|authenticated|signed|signatures?)(?![\w-])|\blocally\s+(?:stored|saved)\b/i.test(part)))return {checks:[],reason:'observation_source_condition_unavailable'};
  clauses.push({kind,local,shared,status:status.length?canonicalStatus(status[0][1]):null,bounds,text:parts[i],connector:parts[i-1]?.toLowerCase()});
 }
 if(!clauses.length||clauses.length>2||clauses.some(c=>c.connector==='or')||/\b(latest|earliest|last|first|after|before)\b/i.test(text))return {checks:[],reason:'observation_condition_unavailable'};
 if(clauses.some(c=>c.bounds.length>2))return {checks:[],reason:'observation_time_condition_unavailable'};
 const relative=/\b(later|earlier)\b/i.test(text)||clauses.some(c=>c.connector==='then');
 let direction=null;
 if(relative){
  if(clauses.length!==2||/\b(later|earlier)\b/i.test(clauses[0].text))return {checks:[],reason:'observation_condition_unavailable'};
  direction=/\bearlier\b/i.test(clauses[1].text)?'earlier':'later';
 }
 const conditions=clauses.flatMap(c=>[
  ...(c.status?[(c.local?'Local ':c.shared?'Shared ':'')+kindLabel[c.kind]+': '+c.status]:!c.bounds.length?['Source: '+(c.local?'Local ':c.shared?'Shared ':'')+kindLabel[c.kind]]:[]),
  ...c.bounds.map(b=>(c.local?'Local ':c.shared?'Shared ':'')+kindLabel[c.kind]+(c.kind==='event'?' occurred ':' observed ')+b.operator+': '+b.stamp)
 ]);
 if(direction)conditions.push(kindLabel[clauses[1].kind]+' '+(clauses[1].kind==='event'?'occurred':'observed')+' '+(direction==='later'?'after':'before')+' '+kindLabel[clauses[0].kind].toLowerCase()+' '+(clauses[0].kind==='event'?'occurred':'was observed'));
 let unknownOrder=false;
 const checks=[];
 for(const resource of selected){
  const sets=clauses.map(c=>{
   const candidates=(resource.status_observations||[]).filter(r=>r.source_id&&r.kind===c.kind&&(!c.status||r.status===c.status)&&(!c.shared||r.source==='imported_packet')&&(!c.local||r.source===localReadSources[c.kind]&&!r.sample));
   if(!c.bounds.length)return candidates;
   const found=candidates.filter(r=>{const time=observationTime(r);return Number.isFinite(time)&&c.bounds.every(b=>b.operator==='after'?time>b.value:b.operator==='before'?time<b.value:b.operator==='on or after'?time>=b.value:time<=b.value);});
   if(!found.length&&candidates.some(r=>!Number.isFinite(observationTime(r))))unknownOrder=true;
   return found;
  });
  if(sets.some(s=>!s.length))continue;
  let matching=sets.flat();
  if(direction){
   const pairs=sets[0].flatMap(a=>sets[1].filter(b=>a.source_id!==b.source_id&&Number.isFinite(observationTime(a))&&Number.isFinite(observationTime(b))&&(direction==='later'?observationTime(b)>observationTime(a):observationTime(b)<observationTime(a))).map(b=>[a,b]));
   if(!pairs.length){if(sets.some(s=>s.some(r=>!Number.isFinite(observationTime(r)))))unknownOrder=true;continue;}
   matching=pairs.flat();
  }
  const unique=[...new Map(matching.map(r=>[r.source_id,r])).values()];
  checks.push({...resource,matching_observations:unique});
 }
 if(unknownOrder)return {checks:[],conditions,reason:'observation_time_unavailable'};
 return {checks,conditions,recognized:true,relative,reason:checks.length?null:'no_matching_resource_facts'};
}

// Explicit operator choices only. Keep every other character of the question;
// the selected proposal is reinterpreted normally before it can yield an answer.
export function sourceStatusRefinements(question,resources){
 const q=String(question),scopes=[...q.matchAll(observationScope)];
 if(scopes.length!==1)return [];
 const source=scopes[0][0].toLowerCase(),kind=/event/.test(source)?'event':source.startsWith('order')?'order_read':source.startsWith('capture')?'capture_read':'refund_read';
 const claims=[...q.matchAll(reportedStatusClaim)];let start,end,verb=false;
 if(claims.length===1){
  const claim=claims[0],known=[...claim[1].matchAll(observationStatus)];
  if(known.length===1&&known[0][0].length===claim[1].length)return [];
  start=claim.index+claim[0].length-claim[1].length;end=start+claim[1].length;
 }else if(!claims.length){
  const succeeded=[...q.matchAll(/(?<![\w-])succeeded(?![\w-])/gi)],successful=[...q.matchAll(/(?<![\w-])successful(?=\s+(?:order|capture(?:[- ]only)?|refund)\s+reads?\b)/gi)];
  if(succeeded.length===1&&!successful.length&&succeeded[0].index>scopes[0].index){start=succeeded[0].index;end=start+succeeded[0][0].length;verb=true;}
  else if(successful.length===1&&!succeeded.length){start=successful[0].index;end=start+successful[0][0].length;}
  else return [];
 }else return [];
 const statuses=[...new Set(resources.flatMap(r=>r.status_observations||[]).filter(o=>o.kind===kind&&o.source_id).map(o=>o.status).filter(status=>typeof status==='string'&&[...status.matchAll(observationStatus)].some(m=>m[0]===status)))].sort();
 return statuses.map(status=>({status,question:q.slice(0,start)+(verb?'reports ':'')+status+q.slice(end)}));
}

// Receipt intervals stay within one provider event identity. Match the complete
// supported question so an additional condition cannot disappear in execution.
export function deliveryIntervalCondition(question){
 const match=/^(?:which refunds?|(?:show|find)(?: the)? refunds?) (?:has|have|with) (?:exactly )?two delivery rows for (?:one|the same) event identity,? with the second delivery (?:arriving|arrived|received) (more than|less than|at least|at most|exactly) (zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d{1,3})?) (seconds?|minutes?|hours?) after the first(?: and (?:a |the )?(?:retained )?refund reads? (?:reports?|says?) (completed|complete|completion|pending|failed|unsuccessful|denied|cancelled|canceled|reversed))?[?.]?$/i.exec(String(question).trim());
 if(!match)return null;
 const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
 const number=words.includes(match[2].toLowerCase())?words.indexOf(match[2].toLowerCase()):Number(match[2]);
 const milliseconds=number*(/^second/i.test(match[3])?1000:/^minute/i.test(match[3])?60000:3600000);
 if(!Number.isSafeInteger(milliseconds))return null;
 return {operator:match[1].toLowerCase(),milliseconds,...(match[4]?{refundStatus:canonicalStatus(match[4])}:{})};
}
// An unqualified state is not silently assigned to a delivery or to a live
// refund. Offer an explicit read-based question with the entire interval intact.
export function deliveryStatusRefinements(question){
 const match=/^(.*) and is (completed|complete|completion|pending|failed|unsuccessful|denied|cancelled|canceled|reversed)[?.]?$/i.exec(String(question).trim());
 if(!match)return [];
 const interval=deliveryIntervalCondition(match[1]);
 if(!interval||interval.refundStatus)return [];
 const status=canonicalStatus(match[2]);
 return [{status,label:'Use retained refund reads reporting '+status,question:match[1]+' and a retained refund read reports '+status+'?'}];
}
function filterDeliveryInterval(condition,selected){
 const readMatches=resource=>(resource.status_observations||[]).filter(row=>row.kind==='refund_read'&&row.source_id&&row.status===condition.refundStatus);
 const eligible=condition.refundStatus?selected.filter(resource=>readMatches(resource).length):selected;
 const groups=eligible.flatMap(resource=>(resource.delivery_groups||[]).filter(group=>group.count===2).map(group=>({resource,group})));
 const conditions=['Exactly two retained deliveries for the same event identity','Second receipt '+condition.operator+' '+condition.milliseconds/1000+' seconds after the first receipt',...(condition.refundStatus?['Retained refund read reports: '+condition.refundStatus]:[])];
 if(groups.some(({group})=>group.elapsed_ms===null||!Number.isFinite(group.elapsed_ms)))return {checks:[],conditions,reason:'delivery_receipt_time_unavailable'};
 const qualifies=value=>condition.operator==='more than'?value>condition.milliseconds:condition.operator==='less than'?value<condition.milliseconds:condition.operator==='at least'?value>=condition.milliseconds:condition.operator==='at most'?value<=condition.milliseconds:value===condition.milliseconds;
 const checks=eligible.flatMap(resource=>{
  const matching=groups.filter(entry=>entry.resource===resource&&qualifies(entry.group.elapsed_ms)).map(entry=>entry.group);
  if(!matching.length)return [];
  const ids=new Set(matching.flatMap(group=>group.deliveries.map(row=>row.source_id)));
  const receipts=(resource.status_observations||[]).filter(row=>ids.has(row.source_id)).map(row=>({...row,display_clock:'received'}));
  return [{...resource,matching_delivery_groups:matching,matching_observations:[...receipts,...(condition.refundStatus?readMatches(resource):[])]}];
 });
 return {checks,conditions,recognized:true,reason:checks.length?null:'no_matching_resource_facts'};
}


// A recognized status or amount is only part of an answer. After removing
// exact references and the interpreted value/clock spans, every remaining
// word must belong to this bounded retained-record question vocabulary.
function resourceClauseCovered(question,resources,constraint,timeBounds){
 const known=new Set(resources.flatMap(r=>[r.resource_id,...(r.references||[])]).filter(Boolean).map(id=>String(id).toLowerCase()));
 let text=timeBounds.masked;
 if(constraint?.span){const [start,end]=constraint.span;text=text.slice(0,start)+' '.repeat(end-start)+text.slice(end);}
 text=text.replace(/[a-z0-9]+(?:-[a-z0-9]+)*/gi,word=>known.has(word.toLowerCase())?' ':word);
 text=text.replace(observationStatus,' ');
 const words=text.toLowerCase().match(/[a-z0-9]+/g)||[];
 const allowed=new Set(('which what why how much here help see shown packet is are was were has have had does do did the a an this that these those it its their my me you we i please can could will would show list find inspect open browse get recheck compare report reports reporting say says saying with of for on from to in at as by and but then or whose belonging belongs belong linked associated all every each any recorded retained saved selected shared imported local locally only order orders payment payments capture captures captured charge charges refund refunds reimbursement reimbursements read reads reading observation observations observed record records histories history details state states status evidence event events webhook webhooks notification notifications delivery deliveries delivered sent received receipt receipts arrival arriving arrived occurred occurrence time times clock clocks amount amounts currency smaller smallest lower lowest larger largest higher highest later latest last most recent earlier earliest first after before repeated duplicate twice again redelivered resent conflicting sum total combined aggregate subtotal add adds up').split(' '));
 return words.every(word=>allowed.has(word));
}

export function filterResourceQuestion(question,selected,resources){
 const q=String(question);
 const interval=deliveryIntervalCondition(q);if(interval)return filterDeliveryInterval(interval,selected);
 const retainedEventScope=/\b(retained|recorded|saved|this packet|here)\b/i.test(q)&&/\b(webhook|event)\b/i.test(q)&&/\btimes?\b/i.test(q);
 const repeatedDeliveries=/\b(?:delivered|sent|received)\s+again\b|\b(redelivered|resent)\b|\b(repeated|duplicate|twice)\b.*\b(deliver(?:y|ies)|notification|webhook)\b|\b(deliver(?:y|ies)|notification|webhook)\b.*\b(repeated|duplicate|twice)\b/i.test(q);
 const constraint=amountConstraint(q,resources.flatMap(r=>[r.resource_id,...(r.references||[])]));
 if(constraint?.error)return {checks:[],reason:'amount_condition_unavailable'};
 const statusMatches=[...q.matchAll(observationStatus)].filter(m=>m[1].toLowerCase()!=='completion');
 const statusQuestion=q.replace(/\bno (?:less|more) than\b/gi,'amount comparison');
 if((/\b(not|never|no)\b|n['’]t\b/i.test(statusQuestion))&&statusMatches.length)
  return {checks:[],reason:'negative_status_not_established'};
 if(/\b(still|currently|right now)\b/i.test(q)&&statusMatches.length)
  return {checks:[],reason:'current_resource_state_not_established'};
 // A request outcome is not a payment status, and an explicit unrecognized
 // reported state must not collapse into the resource's whole history.
 if([...q.matchAll(observationScope)].length){
  if(/(?<![\w-])(successful|success|succeeded|http)(?![\w-])|\bstatus\s+code\b/i.test(q))return {checks:[],reason:'request_outcome_unavailable'};

  for(const claim of q.matchAll(reportedStatusClaim)){
   const words=[...claim[1].matchAll(observationStatus)];
   if(words.length!==1||words[0][0].length!==claim[1].length)return {checks:[],reason:'observation_status_condition_unavailable'};
  }
 }
 const timeBounds=observationBounds(q);if(timeBounds.error)return {checks:[],reason:'observation_time_condition_unavailable'};
 // Keep offsets stable while marking an already interpreted amount clause.
 // An unconsumed conjunction clause must not disappear from the answer.
 if(constraint?.span){const [start,end]=constraint.span;timeBounds.masked=timeBounds.masked.slice(0,start)+' '.repeat(end-start)+timeBounds.masked.slice(end);}

 if(timeBounds.bounds.length&&/\b(not|never|no|without|except|excluding)\b|n['’]t\b/i.test(statusQuestion))return {checks:[],reason:'observation_time_condition_unavailable'};
 const scopes=[...q.matchAll(observationScope)];
 if(localQualifier.test(q)&&!scopes.length)return {checks:[],reason:'observation_source_condition_unavailable'};
 if(timeBounds.bounds.length&&(!scopes.length||/\b(latest|earliest|last|first|most recent)\b/i.test(q)))return {checks:[],reason:'observation_time_condition_unavailable'};
 const rankedEventTime=retainedEventScope&&/\b(earliest|latest|first|last)\b/i.test(q)&&scopes.length===1&&/event/i.test(scopes[0][0]);
 if(rankedEventTime&&localQualifier.test(q))return {checks:[],reason:'observation_source_condition_unavailable'};
 const observations=rankedEventTime?null:filterObservationQuestion(q,selected,timeBounds);
 if(!observations&&(timeBounds.bounds.length||/\b(before|after)\b/i.test(q)))return {checks:[],reason:'observation_time_condition_unavailable'};
 if(observations?.reason)return observations;
 let matches=observations?.checks||selected;const conditions=[...(observations?.conditions||[])];
 const statuses=statusMatches.map(m=>canonicalStatus(m[1])).filter(status=>status!=='REFUNDED'||!selected.every(r=>r.resource_type==='refund'));
 const recognized=!!observations||!!constraint||repeatedDeliveries||statuses.length>0||/\b(smaller|smallest|lower|lowest|larger|largest|higher|highest|completed|complete|completion|pending|failed|denied|cancelled|canceled|reversed|repeated|duplicate|twice)\b/i.test(q);
 if(!resourceClauseCovered(q,resources,constraint,timeBounds)&&!(!recognized&&ordinaryRefundRecordRequest(q,resources.flatMap(row=>row.references||[]))))return {checks:[],reason:recognized?'observation_clause_unavailable':'question_interpretation_unavailable'};
 const statusExpression=statusMatches.length>1?q.slice(statusMatches[0].index,statusMatches.at(-1).index+statusMatches.at(-1)[0].length):'';
 const alternative=/\bor\b/i.test(statusExpression),conjunction=/\band\b/i.test(statusExpression);
 if(!observations&&alternative&&conjunction)return {checks:[],reason:'mixed_status_conditions'};
 if(statuses.length&&!observations){
  matches=matches.filter(r=>statuses[alternative?'some':'every'](status=>(r.observed_statuses||[]).includes(status)));
  conditions.push('Recorded status: '+statuses.join(alternative?' or ':' and '));
 }
 const amountDirection=/\b(smaller|smallest|lower|lowest|larger|largest|higher|highest)\b/i.exec(q)?.[1].toLowerCase();
 if(statuses.length&&!observations&&!constraint&&!amountDirection&&!repeatedDeliveries&&!/\b(later|latest|last|most recent|earlier|earliest|first)\b/i.test(q)){
  matches=matches.map(resource=>{const matching=(resource.status_observations||[]).filter(row=>row.source_id&&statuses.includes(row.status));return matching.length?{...resource,matching_observations:matching}:resource;});
 }
 if(observations&&scopes.length>1&&(constraint||amountDirection))return {checks:[],reason:'observation_condition_unavailable'};
 const withAmountEvidence=resource=>{
  const amount=scaledAmount(resource.amount);
  const matching=(resource.status_observations||[]).filter(o=>{const observed=scaledAmount(o.amount);return o.source_id&&amount&&observed&&observed.currency===amount.currency&&observed.value===amount.value;});
  return matching.length?{...resource,matching_observations:matching}:resource;
 };
 const amountValues=(target,fromSources)=>fromSources?target.flatMap(resource=>(resource.matching_observations||[]).map(observation=>({resource,observation,rawAmount:observation.amount,amount:scaledAmount(observation.amount)}))):target.map(resource=>({resource,rawAmount:resource.amount,amount:scaledAmount(resource.amount)}));
 const keepAmountSources=(candidates,values)=>candidates.map(resource=>{
  const ids=new Set(values.filter(v=>v.resource.resource_id===resource.resource_id).map(v=>v.observation.source_id));
  return {...resource,matching_observations:(resource.matching_observations||[]).filter(o=>ids.has(o.source_id))};
 }).filter(resource=>resource.matching_observations.length);
 if(constraint){
  const parent=/\bcapture\b/i.test(q)&&selected.every(r=>r.resource_type==='refund');
  const target=parent?resources.filter(r=>r.resource_type==='capture'):matches,fromSources=!!observations&&!parent;
  const values=amountValues(target,fromSources),threshold=scaledAmount(constraint);
  if(!threshold||values.some(x=>!x.amount))return {checks:[],reason:'amount_condition_unavailable'};
  const qualifies=v=>constraint.compare==='gte'?v>=threshold.value:constraint.compare==='lte'?v<=threshold.value:constraint.compare==='eq'?v===threshold.value:constraint.compare==='gt'?v>threshold.value:v<threshold.value;
  const qualified=values.filter(x=>x.amount.currency===threshold.currency&&qualifies(x.amount.value));
  if(fromSources)matches=keepAmountSources(matches,qualified);
  else{const found=new Set(qualified.map(x=>x.resource.resource_id));matches=matches.filter(r=>found.has(r.resource_id)||parent&&found.has(r.capture_id));}
  if(!observations&&!parent&&!statuses.length)matches=matches.map(withAmountEvidence);
  conditions.push('Recorded '+(parent?'capture':selected[0]?.resource_type||'resource')+' amount '+constraint.op+': '+constraint.currency+' '+constraint.value);
 }
 if(amountDirection){
  const comparesParentCapture=/\bcapture\b/i.test(q)&&selected.every(r=>r.resource_type==='refund');
  const target=comparesParentCapture?resources.filter(r=>r.resource_type==='capture'):matches,fromSources=!!observations&&!comparesParentCapture;
  const values=amountValues(target,fromSources);
  if(!values.length||/^(smaller|lower|larger|higher)$/.test(amountDirection)&&values.length<2||values.some(x=>!x.amount)||new Set(values.map(x=>x.amount.currency)).size!==1)return {checks:[],reason:'amount_comparison_unavailable'};
  const smaller=/^(smaller|smallest|lower|lowest)$/.test(amountDirection);
  const extreme=values.reduce((a,b)=>(smaller?a.amount.value<b.amount.value:a.amount.value>b.amount.value)?a:b).amount.value;
  const qualified=values.filter(x=>x.amount.value===extreme);
  if(fromSources)matches=keepAmountSources(matches,qualified);
  else{const ids=new Set(qualified.map(x=>x.resource.resource_id));matches=matches.filter(r=>ids.has(r.resource_id)||r.resource_type==='refund'&&ids.has(r.capture_id));}
  if(!observations&&!comparesParentCapture&&!statuses.length)matches=matches.map(withAmountEvidence);
  const example=qualified[0].rawAmount;conditions.push((smaller?'Lowest':'Highest')+' recorded '+(target[0].resource_type==='capture'?'capture':'refund')+' amount: '+example.currency+' '+example.value);
 }

 if(!observations?.relative&&/\b(?:completed?|completion)\b/i.test(q)&&/\b(later|latest|last|most recent|earlier|earliest|first)\b/i.test(q)){
  if(matches.some(r=>r.resource_type!=='capture'))return {checks:[],reason:'chronology_comparison_unavailable'};
  const observed=!retainedEventScope&&/\b(observations?|observed|reads?|recorded)\b/i.test(q);
  const allTimes=matches.map(r=>({resource:r,times:((observed?r.completion_observation_times:r.completion_times)||[]).map(Date.parse).filter(Number.isFinite)}));
  const times=retainedEventScope?allTimes.filter(x=>x.times.length):allTimes;
  if(!times.length||/\b(later|earlier)\b/i.test(q)&&times.length<2||times.some(x=>!x.times.length))return {checks:[],reason:'chronology_comparison_unavailable'};
  const earlier=/\b(earlier|earliest|first)\b/i.test(q);
  const timesByResource=times.map(x=>({...x,value:earlier?Math.min(...x.times):Math.max(...x.times)}));
  const extreme=earlier?Math.min(...timesByResource.map(x=>x.value)):Math.max(...timesByResource.map(x=>x.value));
  matches=timesByResource.filter(x=>x.value===extreme).map(x=>({...x.resource,matched_source_ids:(x.resource[observed?'completion_observations':'completion_records']||[]).filter(r=>Date.parse(r.time)===extreme).map(r=>r.id)}));
  conditions.push((earlier?'Earliest':'Latest')+(observed?' completion observation: ':retainedEventScope?' retained completion event time: ':' completion event time: ')+new Date(extreme).toISOString());
 }
 if(repeatedDeliveries){
  matches=matches.filter(r=>(r.delivery_groups||[]).some(g=>g.count>1)).map(r=>{
   const groups=r.delivery_groups.filter(g=>g.count>1),ids=new Set(groups.flatMap(g=>g.deliveries.map(d=>d.source_id)));
   return {...r,matching_delivery_groups:groups,matching_observations:(r.status_observations||[]).filter(o=>ids.has(o.source_id)).map(o=>({...o,display_clock:'received'}))};
  });conditions.push('Repeated deliveries for the same retained event identity');
 }
 else if(/\bobserved twice\b/i.test(q))matches=matches.filter(r=>r.observation_count===2);
 return {checks:matches,recognized,conditions,reason:matches.length?null:'no_matching_resource_facts'};
}


// Evaluate each side of an explicit relationship in its own resource scope.
// Only normalized capture_id links join results; co-occurring words never do.
export function filterRelatedResources(question,resources,requested=[]){
 const text=String(question).replace(/\bcaptured\s+payments?\b/gi,'capture');
 if(/\b(signatures?|signed|authentic(?:ity)?|verification)\b/i.test(text))return null;
 const types=text=>[...new Set([...text.matchAll(/\b(captures?|charges?|refunds?)\b/gi)].map(m=>/^refund/i.test(m[0])?'refund':'capture'))];
 // An explicitly named refund read after the parent clause still describes
 // the refund. Keep that predicate on the requested resource, not its capture.
 const returnedRead=/^(.*?)\s+\b(on|for|from|belong(?:s|ing)?\s+to|linked\s+to|associated\s+with)\b\s+(.+?)\s+\bwhose\b\s+((?:(?:the|retained|shared|saved)\s+)*refund\s+reads?\b.+)$/i.exec(text);
 const explicitRead=returnedRead&&types(returnedRead[1]).join()==='refund'&&types(returnedRead[3]).join()==='capture'&&types(returnedRead[4]).join()==='refund';
 if(explicitRead&&![...returnedRead[4].matchAll(observationStatus)].length&&!observationBounds(returnedRead[4]).bounds?.length)return {checks:[],reason:'related_condition_unavailable'};
 const relation=explicitRead?[returnedRead[0],returnedRead[1]+' '+returnedRead[4],returnedRead[2],returnedRead[3]]:[...text.matchAll(/\b(without|with|has|have|whose|for|from|belong(?:s|ing)?\s+to|linked\s+to|associated\s+with)\b/gi)]
  .map(m=>[m[0],text.slice(0,m.index),m[0],text.slice(m.index+m[0].length)])
  .find(parts=>types(parts[1]).length&&types(parts[3]).length);
 if(!relation)return null;
 const leftTypes=types(relation[1]),rightTypes=types(relation[3]);
 if(!leftTypes.length||!rightTypes.length)return null;
 if(leftTypes.length!==1||rightTypes.length!==1)return {checks:[],reason:'ambiguous_resource_conditions'};
 const targetType=leftTypes[0],relatedType=rightTypes[0];
 if(targetType===relatedType)return null;
 const resourceIds=new Set(resources.filter(r=>r.resource_type==='capture'||r.resource_type==='refund').map(r=>r.resource_id.toLowerCase()));
 if(requested.some(id=>!resourceIds.has(id)))return null;
 const clauseIds=text=>{const tokens=new Set(text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)||[]);return requested.filter(id=>tokens.has(id));};
 const scoped=(type,text)=>{const ids=clauseIds(text);return resources.filter(r=>r.resource_type===type&&(!ids.length||ids.includes(r.resource_id.toLowerCase())));};

 if(/^without$/i.test(relation[2])||/\bno\s+(?:captures?|charges?|refunds?)\b/i.test(relation[3]))return {checks:[],reason:'related_absence_not_established'};
 const target=filterResourceQuestion(relation[1],scoped(targetType,relation[1]),resources);
 if(target.reason&&target.reason!=='no_matching_resource_facts')return target.reason==='question_interpretation_unavailable'?{...target,reason:'related_condition_unavailable'}:target;
 const related=filterResourceQuestion(relation[3],scoped(relatedType,relation[3]),resources);
 if(related.reason&&related.reason!=='no_matching_resource_facts')return related.reason==='question_interpretation_unavailable'?{...related,reason:'related_condition_unavailable'}:related;
 const relatedWords=relation[3].replace(/[a-z0-9]+(?:-[a-z0-9]+)*/gi,word=>requested.includes(word.toLowerCase())?'':word).trim();
 if(!related.recognized&&relatedWords&&!/^\s*(?:(?:a|an|the|their)\s+)?(?:captures?|charges?|refunds?)\s*\??\s*$/i.test(relatedWords))return {checks:[],reason:'related_condition_unavailable'};
 const joined=r=>related.checks.filter(other=>targetType==='refund'?r.capture_id===other.resource_id:other.capture_id===r.resource_id);
 const checks=target.checks.map(r=>({...r,related_resources:joined(r)})).filter(r=>r.related_resources.length);
 const scope=(condition,label)=>condition.startsWith('Recorded status:')?label[0].toUpperCase()+label.slice(1)+' status:'+condition.slice('Recorded status:'.length):condition;
 const conditions=[...(target.conditions||[]).map(c=>scope(c,targetType)),...(related.conditions||[]).map(c=>scope(c,relatedType))];
 return {checks,conditions,recognized:true,reason:checks.length?null:'no_matching_resource_facts'};
}


// Add distinct retained identities, never delivery count or an inferred balance.
export function recordedRefundSubtotal(question,result){
 const q=String(question);
 if(!/\b(refunds?|refunded|paid back|reimburse(?:d|ments?)?)\b/i.test(q)||!/\b(total|combined|aggregate|sum|subtotal)\b|\badd(?:s)? up\b/i.test(q))return result;
 if(!/\b(recorded|retained|saved|selected)\b|\bthis packet\b/i.test(q))return {checks:[],conditions:[],reason:'refund_total_not_recorded'};
 if(result.reason||!result.checks?.length)return result;
 const rows=result.checks.filter(r=>r.resource_type==='refund'),unique=new Map();
 if(!rows.length)return {checks:[],reason:'refund_subtotal_unavailable'};
 for(const row of rows){
  const amount=scaledAmount(row.amount);
  if(!amount||!row.resource_id)return {checks:[],reason:'refund_subtotal_unavailable'};
  const previous=unique.get(row.resource_id);
  if(previous&&(previous.amount.currency!==amount.currency||previous.amount.value!==amount.value))return {checks:[],reason:'refund_subtotal_unavailable'};
  unique.set(row.resource_id,{row,amount});
 }
 const values=[...unique.values()];
 if(new Set(values.map(v=>v.amount.currency)).size!==1)return {checks:[],reason:'refund_subtotal_unavailable'};
 const sum=values.reduce((total,v)=>total+v.amount.value,0n);
 const whole=sum/1000000n,fraction=(sum%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
 return {...result,subtotal:{currency:values[0].amount.currency,value:whole+'.'+fraction,count:unique.size,resource_ids:[...unique.keys()]}};
}


export function relatedCaptureStatusRefinements(question,resources){
 const pattern=/^(?:which (?:captures?|captured payments?)|(?:show|find)(?: the)? (?:captures?|captured payments?)) (?:has|have|with) (?:a )?(?:retained )?partial refund[?.]?$/i;
 if(!pattern.test(String(question).trim()))return [];
 if(!resources.some(resource=>resource.resource_type==='capture'&&(resource.status_observations||[]).some(row=>row.source_id&&row.status==='PARTIALLY_REFUNDED')))return [];
 return [{status:'PARTIALLY_REFUNDED',label:'Use captures reported PARTIALLY_REFUNDED',question:'Which capture reports PARTIALLY_REFUNDED?'}];
}

// Only explicit retained identities can be subtracted. Other exclusions must
// remain unanswered rather than becoming positive reference requirements.
export function retainedResourceExclusion(question){
 const text=String(question),markers=[...text.matchAll(/\b(?:except(?:\s+for)?|excluding|other\s+than|apart\s+from)\b/gi)];
 if(!markers.length)return null;
 if(markers.length!==1)return {error:true};
 const marker=markers[0],base=text.slice(0,marker.index).trim().replace(/[,;]$/,'').trim();
 const tail=text.slice(marker.index+marker[0].length).trim().replace(/[?.]$/,'').trim();
 // Existing clock exclusions retain their specific time-bound limitation.
 if(/^(?:on or after|on or before|after|before)\b/i.test(tail))return null;
 const match=/^(?:the\s+)?(captures?|refunds?)\s+(.+)$/i.exec(tail);
 if(!base||!match||/\b(?:not|never|without)\s*$/i.test(base))return {error:true};
 const ids=match[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i);
 if(!ids.length||ids.length>20||ids.some(id=>!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id)||id.length<6||!/[0-9]/.test(id)))return {error:true};
 return {question:base,suffix:text.slice(marker.index).trim(),type:/^refund/i.test(match[1])?'refund':'capture',ids:[...new Set(ids.map(id=>id.toLowerCase()))]};
}
