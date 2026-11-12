import {refundStatusSubtotals,refundStatusSubtotalLabel} from './case-presentation.mjs';
import {findingFollowupResultText} from './finding-catalog.mjs';
import {ordinaryRefundCaptureAmountQuestion,ordinaryRefundAmountQuestion,ordinaryRefundRecordRequest,retainedResourceExclusion,refundDecisionQuestion,filterResourceQuestion,filterRelatedResources,recordedRefundSubtotal,relatedCaptureStatusRefinements,sourceStatusRefinements,deliveryIntervalCondition,deliveryStatusRefinements} from './finding-query.mjs';
import {resourceFindingCatalog,refundEvidenceLimits,orderCaptureScopeFindings,retainedTimeBoundaries} from './finding-catalog.mjs';
// Product selector derived from the frozen study; no model or network request.
export const MAX_FINDING_QUESTION_LENGTH=600;
export const negatives=[
 {id:'OUT-INTENT',title:'Customer intent or fraud',text:'Whether a person is dishonest, lying, intentionally deceiving someone, committing fraud or a crime is not established by payment records.'},
 {id:'OUT-PERSON',title:'Personal contact information',text:'Customer identity, contact details, telephone number, street address and home address are not supplied by these payment records.'},
 {id:'OUT-METHOD',title:'Payment method or card destination',text:'The card brand, Visa, Mastercard, Amex, card number, last four digits, funding instrument or destination account for a refund is not established by these payment records.'},
 {id:'OUT-BANK',title:'Bank posting or settlement date',text:'When funds arrive in a bank account, card statement, payout or settlement cannot be determined from these payment records.'},
 {id:'OUT-DELIVERY',title:'Physical goods or delivery',text:'Which courier has a parcel, whether goods shipped, arrived or were delivered is not established by payment events.'},
 {id:'OUT-ADVICE',title:'Tax, legal or business advice',text:'Tax liability, legal duties, whether to ship goods or accuse a customer are not established by these records.'}
];
const stop=new Set('a an and are as at be been but by can could did do does for from had has have here how i in into is it its me my of on or our that the their them then there these they this those to us was we were what when where which who why will with would you your question asks evidence records record establish established supplied determine determined'.split(' '));
const groups=[
 ['refund','refunded','repaid','reimburse','reimbursed','reimbursement'],
 ['capture','captured','charge','charged','collect','collected','collection'],
 ['complete','completed','completion','paid','confirmed','confirmation'],
 ['pending','waiting','unconfirmed','unfinished'],
 ['signature','signed','authentic','authenticity','verified','verification'],
 ['current','fresh','freshness','latest','recent','newest','outdated','stale'],
 ['time','timestamp','chronology','chronological'],
 ['failure','failed','declined','denied','refused'],
 ['reversal','reversed','reverse'],
 ['amount','money','funds','value','dollar','dollars','usd'],
 ['different','difference','disagree','disagreement','conflict','conflicting','contradiction'],
 ['shared','imported','transfer','transferred','recipient'],
 ['repeated','repeat','duplicate','duplicates','twice'],
 ['full','whole','entire','all']
];
const aliases=new Map(groups.flatMap((g,i)=>g.map(t=>[t,'concept'+i])));
function tokens(input){
 const text=String(input).toLowerCase().replace(/paid\s+back|pay\s+back|given\s+back|sent\s+back/g,'refund');
 return (text.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)||[]).filter(t=>t.length>1&&!stop.has(t)).map(t=>aliases.get(t)||t);
}
function catalog(findings){
 const prerequisites=findings.filter(f=>f.priority==='authoritative_observation');
 const selectable=findings.filter(f=>!prerequisites.includes(f));
 return {prerequisites,docs:[...selectable,...negatives]};
}
function filterSourceQuestion(question,ranked,docs){
 if(!/\b(signatures?|signed|authentic|authenticity|forged)\b/i.test(question))return ranked;
 const exact=docs.filter(d=>!d.id.startsWith('OUT-')&&/\bsignature\b/i.test(d.title+' '+d.text));
 if(!exact.length)return ranked;
 const allowed=new Set(exact.map(d=>d.id));
 return ranked.filter(r=>r.id.startsWith('OUT-')||allowed.has(r.id));
}
function resolve(ranked,findings,prerequisites){
 const winner=ranked[0];
 if(!winner||winner.id.startsWith('OUT-')||winner.score<=0)return [];
 const f=findings.find(f=>f.id===winner.id);
 return f?[...prerequisites.filter(p=>p.id!==f.id),f]:[];
}
function references(question){
 return [...new Set((String(question).match(/[a-z0-9]+(?:-[a-z0-9]+)*/gi)||[])
  .filter(t=>!/^[0-9]{4}-[0-9]{2}-/.test(t)&&(/^[a-z0-9]{12,32}$/i.test(t)&&/\d/.test(t)||/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/i.test(t)&&t.length>=6&&/\d/.test(t)))
  .map(t=>t.toLowerCase()))];
}
function resourceSelection(question,findings,requested){
 const orderReadQuestion=/\border\s+reads?\b/i.test(question)&&!/\b(captur(?:e|es|ed)|charg(?:e|es|ed)|refund(?:s|ed)?|events?|webhooks?)\b/i.test(question);
 if(orderReadQuestion){
  const orders=findings.filter(f=>f.resource_type==='order'),prerequisites=findings.filter(f=>f.priority==='authoritative_observation');
  const selected=orders.filter(f=>requested.every(id=>(f.references||[]).some(ref=>ref.toLowerCase()===id)));
  if(requested.length&&!selected.length)return {checks:[],reason:'reference_not_found'};
  if(!selected.length)return {checks:[],reason:'no_resource_observation'};
  const filtered=filterResourceQuestion(question,selected,orders);
  return {...filtered,checks:filtered.checks.length?[...prerequisites,...filtered.checks]:[]};
 }
 const resources=findings.filter(f=>f.resource_type&&f.resource_type!=='order');
 const captureReadQuestion=(/\bcapture(?:[- ]only)?\s+reads?\b/i.test(question)||/\b(captures?|charges?|captured payments?)\b/i.test(question)&&/\bpartially[ _]refunded\b/i.test(question))&&!/\brefunds?\b/i.test(question);
 if(!resources.length)return null;
 const prerequisites=findings.filter(f=>f.priority==='authoritative_observation');
 const known=new Set(resources.flatMap(f=>f.references||[]).map(x=>x.toLowerCase()));
 if(requested.some(id=>!known.has(id)))return {checks:[],reason:'reference_not_found'};
 {const relation=filterRelatedResources(question,resources,requested);if(relation)return {...relation,checks:relation.checks.length?[...prerequisites,...relation.checks]:[]};}
 const selectedRefunds=resources.filter(f=>f.resource_type==='refund'&&requested.includes(f.resource_id.toLowerCase()));
 const selectedCaptures=resources.filter(f=>f.resource_type==='capture'&&requested.includes(f.resource_id.toLowerCase()));
 if(selectedRefunds.length&&selectedCaptures.some(c=>selectedRefunds.some(r=>r.capture_id!==c.resource_id)))return {checks:[],reason:'relationship_not_recorded'};
 let selected;let conditions=[];
 if(/\b(signatures?|signed|authentic(?:ity)?|verification)\b/i.test(question)){
  const scopes=[...selectedRefunds,...selectedCaptures].map(f=>f.resource_id);
  selected=resources.filter(f=>f.resource_type==='verification'&&(scopes.length?scopes.includes(f.verification_scope):!f.verification_scope));
 }
 else if(selectedRefunds.length)selected=selectedRefunds;
 else if(selectedCaptures.length){
  if(!captureReadQuestion&&/\b(refund(?:ed|s)?|reimburse(?:d|ment)?|paid back)\b/i.test(question))selected=resources.filter(f=>f.resource_type==='refund'&&selectedCaptures.some(c=>c.resource_id===f.capture_id));
  else selected=selectedCaptures;
 }else if(requested.length)selected=resources.filter(f=>f.resource_type!=='verification'&&requested.every(id=>(f.references||[]).some(ref=>ref.toLowerCase()===id)));
 else if(captureReadQuestion)selected=resources.filter(f=>f.resource_type==='capture');
 else if(/\b(refund(?:ed|s)?|reimburse(?:d|ment)?|paid back)\b/i.test(question))selected=resources.filter(f=>f.resource_type==='refund');
 else if(/\b(capture(?:s|d)?|charge(?:s|d)?)\b/i.test(question))selected=resources.filter(f=>f.resource_type==='capture');
 else return null;
 if(!selected.some(f=>f.resource_type==='verification')){
  const filtered=filterResourceQuestion(question,selected,resources);
  if(!requested.length&&!filtered.recognized&&selected.every(f=>f.resource_type==='capture')&&!filtered.reason&&!/\b(captures|charges|capture histories|capture observations|capture records)\b|\b(?:all|every|each)\b.*\b(?:capture|charge)\b/i.test(question))return null;
  const subtotalRequest=/\b(total|combined|aggregate|sum|subtotal)\b|\badd(?:s)? up\b/i.test(question);
  if(selected.length&&selected.every(f=>f.resource_type==='refund')&&!filtered.recognized&&!filtered.reason&&!subtotalRequest&&!ordinaryRefundRecordRequest(question,resources.flatMap(r=>r.references||[])))return {checks:[],reason:'question_interpretation_unavailable'};
  selected=filtered.checks;conditions=filtered.conditions||[];if(!selected.length)return filtered;
 }
 return {checks:selected.length?[...prerequisites,...selected]:[],conditions,reason:selected.length?null:'no_resource_observation'};
}
export function unsupportedFindingQuestion(question){
 const q=String(question);
 if(/(?:^|[.!?]\s*)(?:(?:please|can you|could you|will you)\s+)?(?:issue|create|initiate|send|process|retry)\b.{0,45}\brefund\b/i.test(q)&&!/\b(?:who|when|why)\b/i.test(q))return 'payment_action_not_performed';
 if(refundDecisionQuestion(q))return 'refundable_balance_not_recorded';
 if(!deliveryIntervalCondition(q)&&/\b(?:minutes?|seconds?|hours?|days?)\b/i.test(q)&&/\b(?:delivery|deliveries|arriving|arrival|received)\b/i.test(q)&&/\b(?:after|before|apart|elapsed|between|more than|less than)\b/i.test(q))return 'delivery_interval_unavailable';
 if(/\b(?:never|not)(?:\s+(?:ever|been))?\s+(?:refund(?:ed)?|reimbursed)\b|\b(?:no|without)\s+(?:any\s+)?refunds?\b/i.test(q))return 'negative_status_not_established';
 // A retained observation is not a ledger total. Even several known captures
 // can be incomplete, conflicting, or denominated in different currencies.
 if(/\b(?:total|combined|aggregate|sum)\b/.test(q.toLowerCase())&&/\b(?:captur(?:e|es|ed)|charg(?:e|es|ed)|collected)\b/i.test(q)&&!/\b(?:total|combined|aggregate|sum|subtotal)\b(?:\s+(?:the|recorded|retained|saved|selected|completed|failed|pending))*\s+refund/i.test(q))return 'capture_total_not_recorded';
 if(/\bhow many\b.*\b(?:captur(?:e|es)|charg(?:e|es)|times.*charg(?:e|ed))\b/i.test(q))return 'capture_total_not_recorded';
 if(/\b(fees?|commission|surcharge|exchange rate|conversion rate|converted amount|net proceeds|net amount|net received)\b/i.test(q))return 'unrecorded_financial_detail';
 if(/\b(remaining|remains?|left|unused|maximum)\b.*\b(refund(?:able)?|reimburse)|\b(refund(?:able)?|reimburse)\b.*\b(remaining|remains?|left|maximum)|\b(how much|amount)\b.*\b(still|can|could)\b.*\b(refund|reimburse)/i.test(q))return 'refundable_balance_not_recorded';
 if(/\b(employee|staff|agent|person|operator)\b|\bwho\b.*\b(approv|authoriz|request|initiat|issu|creat)|\b(approv|authoriz|request|initiat|issu|creat)\w*\b.*\bby whom\b/i.test(q))return 'actor_not_recorded';
 if(/\b(caused? by|root cause|merchant mistake|human error|accident|motive|intention|intentional)\b|\bwhy\b.*\b(fail(?:ed)?|declin(?:e|ed)|den(?:y|ied)|refund(?:ed)?)\b/i.test(q))return 'cause_not_recorded';
 if(/\b(customer|buyer|recipient)\b.*\b(receive|received|receiving|receipt|got|credited)\b|\b(receive|received|receiving|receipt|credited)\b.*\b(customer|buyer|recipient)\b/i.test(q))return 'recipient_posting_not_recorded';
 // Current account questions cannot be answered by ranking historical records.
 // Keep ordinary requests for the latest retained read on the observation path.
 const liveAccount=/\b(?:live|production)\s+(?:paypal\s+)?(?:accounts?|payments?|captures?|refunds?|orders?)\b|\bpaypal\s+(?:live|production)\b/i.test(q)&&!/\b(?:not|rather than|instead of)\s+(?:the\s+)?(?:live|production)\b/i.test(q);
 const currentState=/\b(?:currently|now|at this moment|still)\b|\bcurrent\s+(?:(?:payment|capture|refund|order|account)\s+)?(?:status(?:es)?|states?|balance|settlement)\b/i.test(q);
 if((liveAccount||currentState)&&/\b(?:payments?|captures?|refunds?|orders?|accounts?|paypal)\b/i.test(q)&&/\b(?:settled?|settlement|status(?:es)?|states?|pending|completed?|failed|refunded?|paid|cleared)\b/i.test(q))return liveAccount?'live_account_state_not_established':'current_resource_state_not_established';
 return null;
}
export const findingRefusalText={
 question_interpretation_unavailable:'The retained records do not establish an answer to this wording. Browse the histories to inspect related observations without treating them as an answer.',
 observation_clause_unavailable:'The extra condition is not supported. Use an explicit read status, observation time, or currency and amount comparison to refine the question.',
 observation_source_condition_unavailable:'Ask for a local PayPal Sandbox order, capture or refund read, or for shared observations. A local read is not proof of signature verification, revalidation of a shared claim or current account state.',
 resource_exclusion_unavailable:'This search can exclude explicitly named retained capture or refund identities. It could not apply this exclusion, so no matching answer was inferred.',
 status_scope_not_recorded:'This investigation needs both a retained COMPLETED order read and a PARTIALLY_REFUNDED read of its exact capture to explain those observed states. No source was inferred.',
 request_outcome_unavailable:'A successful read request does not establish the payment status. Search for a read reporting FAILED, COMPLETED or PENDING.',
 observation_status_condition_unavailable:'That reported status is not supported by this search. Try FAILED, COMPLETED or PENDING, or open the retained history.',
 payment_action_not_performed:'Find evidence searches retained records. No refund was issued. Open the exact payment in PayPal to review or perform a refund.',
 delivery_interval_unavailable:'This search cannot apply that delivery interval. Open the event delivery records to compare their received times.',
 delivery_receipt_time_unavailable:'A repeated event identity lacks consistent retained receipt times. The delivery interval is not established; event occurrence times cannot substitute.',
 observation_condition_unavailable:'Name the status reported by each event or read. For ordering, ask for one event or read followed by a later read; no source or time condition was assumed.',
 observation_time_condition_unavailable:'Use an event occurrence or read observation with a complete UTC time, for example after 2026-11-10T10:20:00Z. Delivery receipt time and relative dates are not assumed.',
 observation_time_unavailable:'The matching observations lack the retained times needed to establish that order. Delivery receipt time cannot substitute for the event occurrence time.',
 related_condition_unavailable:'The requested condition on the related resource is not established by these observations. Search its recorded state or amount.',
 ambiguous_resource_conditions:'Separate the capture conditions from the refund conditions so their recorded relationship can be checked.',
 related_absence_not_established:'The retained records do not establish that a capture has no refunds. They can show the refund-to-capture associations that are recorded.',
 mixed_status_conditions:'Search one set of alternative states, or one combination of required states. This question mixes both, so no state condition was assumed.',
 refund_total_not_recorded:'A complete refunded total is not established. Ask for the sum of recorded refund amounts to total the retained identities.',
 refund_subtotal_unavailable:'The selected refunds need consistent amounts in one currency before they can be added. Review their exact observations below.',
 capture_total_not_recorded:'These observations do not establish a complete capture total or charge count. Review the individual capture histories below; one capture amount cannot stand in for the whole payment.',
 negative_status_not_established:'Missing or unmatched observations do not prove that a payment action never completed. Search for the recorded status or inspect the exact resource history.',
 current_resource_state_not_established:'Saved observations do not establish what is still pending or current now. Refresh the exact resource in PayPal before treating a recorded status as current.',
 live_account_state_not_established:'This search uses retained observations; it has not checked the live PayPal account. Those observations do not establish current live settlement or account state.',
 amount_condition_unavailable:'This amount condition needs one explicit currency code and decimal amount, with comparable recorded amounts. The condition was not applied; refine it before relying on a result.',
 amount_comparison_unavailable:'These records cannot support that amount comparison. Comparable amounts in one currency are required.',
 chronology_comparison_unavailable:'The requested completion-time evidence is missing for at least one resource. A later API read does not establish when a capture completed.',
 no_matching_resource_facts:'No retained resource observations match those conditions. This does not prove that the event never happened.',
 question_too_long:'Shorten the question to 600 characters before finding evidence. No partial question was searched.',
 unrecorded_financial_detail:'These observations do not contain the requested fee, exchange rate or net proceeds. A capture or refund amount cannot answer that question.',
 refundable_balance_not_recorded:'These observations do not establish a complete refund history or the remaining refundable amount. Inspect the exact capture in PayPal before deciding what can still be refunded.',
 actor_not_recorded:'These observations do not identify the person who requested, created or approved the payment action.',
 cause_not_recorded:'The records retain reported states and dates, but do not establish why the payment action happened or failed.',
 recipient_posting_not_recorded:'A completed refund observation does not establish when the buyer received or could use the money.',
 unsupported_payment_method:'These records do not establish the card, funding instrument or refund destination.',
 available_balance_not_recorded:'These records do not establish a current available or withdrawable balance.',
 unsupported_record_detail:'The requested detail is not established by the retained payment observations.',
 capture_reference_required:'This question does not identify one retained capture. Choose its exact reference before adding the associated refund amounts.',
 reference_not_found:'The requested reference is absent from this investigation. Check the ID or import the matching records.',
 relationship_not_recorded:'The retained records do not link the requested refund to that capture.',
 no_resource_observation:'No matching observation for this resource is retained in this investigation.'
};
function findingLimitation(result){
 const text=findingRefusalText[result?.reason];
 return !(result?.checks||[]).length&&result?.reason!=='question_too_long'&&typeof text==='string'?text:null;
}
function orderCaptureScopeAnswer(question,findings,scopeIds){
 const text=String(question),generic=/\borders?\b/i.test(text)&&/\bcaptures?\b/i.test(text)&&/\b(?:statuses|status|states|state)\b/i.test(text)&&/\b(?:differ(?:ent|ence|ences)?|disagree(?:ment)?|mismatch(?:ed)?|conflict(?:ing)?)\b/i.test(text);
 const explicit=/\border\b/i.test(text)&&/\bcapture\b/i.test(text)&&/\bcompleted\b/i.test(text)&&/\bpartially[ _]refunded\b/i.test(text)&&/\b(say|says|show|shows|status|statuses|mean|means|difference|different)\b/i.test(text);
 if(!generic&&!explicit)return null;
 const unsupported=unsupportedFindingQuestion(text);if(unsupported&&unsupported!=='cause_not_recorded')return null;
 const allReferences=references(text),requested=allReferences.filter(id=>!scopeIds.some(scope=>String(scope).toLowerCase()===id));
 const captures=findings.filter(f=>f.resource_type==='capture'&&requested.every(id=>id===f.resource_id.toLowerCase()||id===String(f.order_capture_scope?.order_id).toLowerCase()));
 if(requested.length&&!captures.length)return {checks:[],reason:'reference_not_found'};
 if(generic){
  // Explain resource scopes only. Extra facts, amounts and time conditions
  // cannot disappear into an apparently successful capture-history result.
  const words=new Set('why do does is are can could how what explain the a an this that these those my our retained recorded reported observed saved shared order orders capture captures status statuses state states and from between for of in with be have has say says show shows differ different difference differences disagree disagreement mismatch mismatched conflict conflicting versus vs mean means coexist while when completed partially refunded partially_refunded read reads observation observations'.split(' '));
  const tokens=text.toLowerCase().match(/[a-z0-9_]+(?:-[a-z0-9_]+)*/g)||[];
  if(tokens.some(word=>!words.has(word)&&!allReferences.includes(word)))return {checks:[],reason:'unsupported_record_detail'};
 }else if(/\b(buyer|customer|recipient|before|after|since|between|yesterday|today|not|never|pending|failed|declined|cancelled|motive|mistake|error|decid|chose|chosen|choose|reason for|caused by)\w*\b/i.test(text))return null;
 const checks=orderCaptureScopeFindings(captures);
 if(generic&&checks.length!==captures.length)return {checks:[],reason:'status_scope_not_recorded'};
 return {checks,reason:checks.length?null:'status_scope_not_recorded'};
}
function sourceTimeRefinements(question,findings,scopeIds){
 const relative=[...String(question).matchAll(/\b(later|earlier)\s+((?:order|capture(?:[- ]only)?|refund)\s+reads?)\b/gi)];
 if(relative.length!==1||[...String(question).matchAll(/\b(later|earlier)\b/gi)].length!==1||[...String(question).matchAll(/\b(?:order|capture(?:[- ]only)?|refund)\s+reads?\b|\b(?:webhook\s+)?events?\b/gi)].length!==1)return [];
 const match=relative[0],direction=match[1].toLowerCase(),simplified=String(question).slice(0,match.index)+match[2]+String(question).slice(match.index+match[0].length);
 const base=lexicalSearch(simplified,findings,{scopeIds});if(base.reason||!base.checks.some(c=>c.matching_observations?.length))return [];
 return retainedTimeBoundaries(base.checks,direction).map(choice=>({...choice,question:simplified.trim().replace(/[?.;]+$/,'')+' '+(direction==='later'?'after ':'before ')+choice.stamp})).filter(choice=>choice.question.length<=MAX_FINDING_QUESTION_LENGTH);
}
function currentAmountRefinements(question,findings,scopeIds,reason){
 if(!['live_account_state_not_established','current_resource_state_not_established'].includes(reason))return [];
 const q=String(question),comparisons=[...q.matchAll(/\b(larger|largest|smaller|smallest)\s+(?:payment|capture|charge)s?\b/gi)];
 if(comparisons.length!==1||/\b(?:and|or|except|excluding|before|after|above|below|over|under|between|at least|at most|more than|less than|exactly|not|never|without|pending|completed?|failed|refunded?|usd|eur|gbp|jpy)\b|\d/i.test(q))return [];
 if(references(q).some(id=>!scopeIds.some(scope=>String(scope).toLowerCase()===id)))return [];
 const direction=comparisons[0][1].toLowerCase(),captures=findings.filter(f=>f.resource_type==='capture');
 if(/^(larger|smaller)$/.test(direction)&&captures.length!==2)return [];
 const extreme=/^small/.test(direction)?'lowest':'highest',refined='Which capture has the '+extreme+' recorded amount?';
 const result=resourceSelection(refined,findings,[]);
 if(!result||result.reason||!result.checks.some(c=>c.resource_type==='capture'))return [];
 return [{question:refined,label:'Use '+extreme+' retained capture amount'}];
}


function excludedResourceSelection(exclusion,findings,scopeIds){
 if(exclusion.error)return {checks:[],ranked:[],reason:'resource_exclusion_unavailable'};
 const resources=findings.filter(f=>f.resource_type===exclusion.type);
 const excluded=exclusion.ids.map(id=>resources.find(f=>String(f.resource_id).toLowerCase()===id));
 if(excluded.some(resource=>!resource))return {checks:[],ranked:[],reason:'reference_not_found'};
 const result=lexicalSearch(exclusion.question,findings,{scopeIds});
 if(result.reason&&result.reason!=='no_matching_resource_facts'){
  const refinements={};
  for(const key of ['status_refinements','time_refinements','evidence_refinements'])if(result[key])refinements[key]=result[key].map(proposal=>({...proposal,question:proposal.question.trim().replace(/[?.]+$/,'')+' '+exclusion.suffix})).filter(proposal=>proposal.question.length<=MAX_FINDING_QUESTION_LENGTH);
  return {...result,...refinements};
 }
 const selected=result.checks.filter(check=>check.priority!=='authoritative_observation');
 if(selected.some(check=>check.resource_type!==exclusion.type)||!selected.length&&!result.conditions?.length)return {checks:[],ranked:[],reason:'resource_exclusion_unavailable'};
 const ids=new Set(excluded.map(resource=>resource.resource_id));
 const remaining=selected.filter(check=>!ids.has(check.resource_id));
 const checks=remaining.length?result.checks.filter(check=>check.priority==='authoritative_observation'||remaining.includes(check)):[];
 const conditions=[...(result.conditions||[]),...excluded.map(resource=>'Excluded retained '+exclusion.type+' identity: '+resource.resource_id)];
 return recordedRefundSubtotal(result.subtotal?'Sum recorded refunds':exclusion.question,{...result,checks,conditions,subtotal:undefined,reason:remaining.length?null:'no_matching_resource_facts'});
}

export function lexicalSearch(question,findings,{scopeIds=[]}={}){
 const start=performance.now();
 if(String(question).length>MAX_FINDING_QUESTION_LENGTH)return {checks:[],ranked:[],reason:'question_too_long',wall_ms:performance.now()-start};
 const exclusion=retainedResourceExclusion(question);
 if(exclusion)return {...excludedResourceSelection(exclusion,findings,scopeIds),wall_ms:performance.now()-start};
 const scopeAnswer=orderCaptureScopeAnswer(question,findings,scopeIds);if(scopeAnswer)return {...scopeAnswer,ranked:[],wall_ms:performance.now()-start};
 const unsupported=unsupportedFindingQuestion(question);
 if(unsupported){
  const refinements=unsupported==='delivery_interval_unavailable'?deliveryStatusRefinements(question):[];
  const evidenceRefinements=currentAmountRefinements(question,findings,scopeIds,unsupported);
  return {checks:[],ranked:[],reason:unsupported,...(refinements.length?{status_refinements:refinements}:{}),...(evidenceRefinements.length?{evidence_refinements:evidenceRefinements}:{}),wall_ms:performance.now()-start};
 }
 if(/\b(visa|mastercard|amex|card(?:holder)?|funding instrument|destination account|last four|last 4)\b/i.test(question))return {checks:[],ranked:[],reason:'unsupported_payment_method',wall_ms:performance.now()-start};
 if(/\b(available|spendable|withdrawable)\b.*\b(funds|balance|money|now|usd|eur|gbp)\b|\b(funds|balance|usd|eur|gbp)\b.*\b(available|spendable|withdrawable)\b/i.test(question))return {checks:[],ranked:[],reason:'available_balance_not_recorded',wall_ms:performance.now()-start};
 if(/\b(bank|payout|email|courier|parcel|fraud|dishonest|tax|legal)\b|\b(phone number|street address|home address|who initiated|who issued)\b/i.test(question))return {checks:[],ranked:[],reason:'unsupported_record_detail',wall_ms:performance.now()-start};
 const ids=references(question).filter(id=>!scopeIds.some(scope=>String(scope).toLowerCase()===id));

 const captureAmountQuestion=ordinaryRefundCaptureAmountQuestion(question,[...scopeIds,...findings.flatMap(f=>f.references||[])]);
 if(findings.some(f=>f.resource_type)&&(captureAmountQuestion||ordinaryRefundAmountQuestion(question,[...scopeIds,...findings.flatMap(f=>f.references||[])]))){
  let amountIds=ids,captureId=null;
  if(captureAmountQuestion){
   const captures=findings.filter(f=>f.resource_type==='capture'),named=ids.length?captures.filter(f=>ids.includes(f.resource_id.toLowerCase())):captures;
   if(ids.length!==1||named.length!==1)return {checks:[],ranked:[],reason:'capture_reference_required',evidence_refinements:captures.map(capture=>({kind:'capture_refund_amount',label:'Use capture '+capture.resource_id,question:'How much of capture '+capture.resource_id+' was paid back?'})),wall_ms:performance.now()-start};
   captureId=named[0].resource_id;amountIds=[captureId.toLowerCase()];
  }
  const selected=resourceSelection('Show all refunds',findings,amountIds);
  if(!selected)return {checks:[],ranked:[],reason:'no_resource_observation',wall_ms:performance.now()-start};
  const evidence={...selected,conditions:[...(captureId?['Retained capture identity: '+captureId]:[]),'Distinct retained refund identities; repeated observations counted once.'],checks:selected.checks.map(check=>check.resource_type==='refund'?{...check,matching_observations:check.status_observations}:check)};
  return {...recordedRefundSubtotal('Sum recorded refunds',evidence),ranked:[],wall_ms:performance.now()-start};
 }

 const scoped=resourceSelection(question,findings,ids);if(scoped){
  if(['request_outcome_unavailable','observation_status_condition_unavailable'].includes(scoped.reason))scoped.status_refinements=sourceStatusRefinements(question,findings).filter(proposal=>{const check=lexicalSearch(proposal.question,findings,{scopeIds});return !check.reason&&check.checks.some(item=>item.resource_type);});
  if(scoped.reason==='related_condition_unavailable')scoped.status_refinements=relatedCaptureStatusRefinements(question,findings);
  if(scoped.reason==='observation_condition_unavailable')scoped.time_refinements=sourceTimeRefinements(question,findings,scopeIds);
  return {...recordedRefundSubtotal(question,scoped),ranked:[],wall_ms:performance.now()-start};
 }
 const eligible=findings.filter(f=>f.resource_type!=='order').filter(f=>f.priority==='authoritative_observation'||ids.every(id=>{
  const exact=new Set((f.title+' '+f.text+' '+(f.source_ids||[]).join(' ')).toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g)||[]);
  return exact.has(id);
 }));
 if(ids.length&&!eligible.some(f=>f.priority!=='authoritative_observation'))return {checks:[],ranked:[],reason:'reference_not_found',wall_ms:performance.now()-start};
 findings=eligible;
 const {docs,prerequisites}=catalog(findings);
 const corpus=docs.map(d=>tokens(d.title+' '+d.title+' '+d.text)),query=[...new Set(tokens(question))];
 const average=corpus.reduce((s,t)=>s+t.length,0)/Math.max(1,corpus.length),N=corpus.length;
 const ranked=docs.map((d,i)=>{
  const t=corpus[i],counts=new Map();for(const x of t)counts.set(x,(counts.get(x)||0)+1);
  let score=0;for(const q of query){const frequency=counts.get(q)||0;if(!frequency)continue;const df=corpus.filter(c=>c.includes(q)).length;
   const idf=Math.log(1+(N-df+.5)/(df+.5));score+=idf*frequency*2.2/(frequency+1.2*(.25+.75*t.length/Math.max(1,average)));
  }return {id:d.id,score};
 }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 const refundDetail=/\b(refund(?:ed|s)?|paid back|reimburse(?:d|ment)?)\b/i.test(question)&&/\b(how much|amount|total|currency|when|time|date)\b/i.test(question);
 const exactAmounts=refundDetail&&!ranked[0]?.id.startsWith('OUT-')?findings.filter(f=>f.source_kind==='refund_evidence'):[];
 const selection=exactAmounts.length?[...prerequisites,...exactAmounts]:resolve(filterSourceQuestion(question,ranked,docs),findings,prerequisites);
 return {checks:selection,ranked,wall_ms:performance.now()-start};
}

export function mountFindingSearch(target,{renderFinding,draftNote,canDraftNote=()=>true}){
 const observationStamp=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'}).format(date)+' UTC':'time unavailable';};
 const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const section=make('section','finding-finder');section.hidden=true;section.setAttribute('aria-labelledby','finding-search-heading');
 const title=make('h2','','Find evidence');title.id='finding-search-heading';
 const form=make('form','finding-search-form');form.id='finding-search-form';
 const label=make('label','sr-only','Question about this payment');label.htmlFor='finding-query';
 const input=make('input');input.id='finding-query';input.type='search';input.minLength=3;input.required=true;input.autocomplete='off';input.enterKeyHint='search';input.placeholder='Refund amount, payment status, signature…';
 const submit=make('button','secondary','Find evidence');submit.type='submit';
 const clear=make('button','text-button','Clear');clear.type='button';clear.hidden=true;
 const status=make('p','form-feedback');status.id='finding-search-status';status.setAttribute('role','status');
 input.setAttribute('aria-describedby',status.id);
 const results=make('div','finding-search-results');results.id='finding-search-results';results.hidden=true;
 form.append(label,input,submit,clear);section.append(title,form,status,results);target.prepend(section);
 let packet=null,currentId=null,submitted=false,previousQuestion=null,previousReason=null,browsing=null,boundaryChoice=null,recoveryRecordsOnly=false;
 const erase=()=>{submitted=false;previousQuestion=null;previousReason=null;browsing=null;boundaryChoice=null;recoveryRecordsOnly=false;results.replaceChildren();results.hidden=true;status.textContent='';input.removeAttribute('aria-invalid');};
 const execute=(focus,reveal=false)=>{
  if(!packet)return;
  if(input.value.length>MAX_FINDING_QUESTION_LENGTH){erase();clear.hidden=false;input.setAttribute('aria-invalid','true');status.textContent=`Your question has ${input.value.length.toLocaleString('en-US')} characters. Shorten it to ${MAX_FINDING_QUESTION_LENGTH} before finding evidence.`;if(focus)input.focus();return;}
  input.removeAttribute('aria-invalid');
  const question=input.value.trim();if(question.length<3){status.textContent='Enter at least three characters.';return;}
  const notes=packet.diagnosis?.notes||[];
  const catalog=[...notes.map((n,i)=>({id:'F'+(i+1),kind:'finding',source_kind:n.kind||null,title:n.title,text:n.detail,source_ids:[...(n.ids||[])],priority:n.priority||null,note:n})),...resourceFindingCatalog(packet)];
  const result=lexicalSearch(question,catalog,{scopeIds:[packet.order_id,packet.order?.id].filter(Boolean)});
  results.replaceChildren();results.hidden=false;submitted=true;clear.hidden=false;
  results.classList.toggle('finding-search-multiple',result.checks.filter(check=>check.priority!=='authoritative_observation').length>1);
  const emptyMatch=result.reason==='no_matching_resource_facts'&&result.conditions?.length;
  const limitation=!emptyMatch&&findingLimitation(result);
  const heading=make('h3','finding-result-heading');heading.tabIndex=-1;
  heading.append(make('span','finding-result-question',question),make('span','finding-result-status',browsing?'Retained '+browsing+' histories':recoveryRecordsOnly?'Retained records for follow-up':result.checks.length?'Matching evidence':emptyMatch?'No matching retained records':'Question not answered'));results.append(heading);
  if(previousQuestion){
   results.append(make('p','note-meta finding-recovery-question','Original question: '+previousQuestion));
   const back=make('button','text-button finding-recovery-return','Back to original question');back.type='button';back.dataset.findingRecoveryReturn='';
   back.onclick=()=>{input.value=previousQuestion;previousQuestion=null;previousReason=null;browsing=null;boundaryChoice=null;recoveryRecordsOnly=false;execute(true);};results.append(back);
  }

   if(result.conditions?.length){
    const conditions=make('p','finding-match-conditions');
    result.conditions.forEach((condition,index)=>{
     if(index)conditions.append(document.createTextNode(' · '));
     const clock=/^(.*?: )([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z)$/.exec(condition);
     if(!clock){conditions.append(document.createTextNode(condition));return;}
     const date=new Date(clock[2]),time=make('time','',new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',...(date.getUTCMilliseconds()?{fractionalSecondDigits:3}:{}),timeZone:'UTC'}).format(date)+' UTC');time.dateTime=clock[2];time.title=clock[2];conditions.append(document.createTextNode(clock[1]),time);
    });results.append(conditions);
   }
  if(result.subtotal){
   const subtotal=make('section','finding-subtotal');subtotal.dataset.refundSubtotal=result.subtotal.value;
   subtotal.append(make('h3','','Recorded refund subtotal · '+result.subtotal.currency+' '+result.subtotal.value),make('p','',result.subtotal.count+' distinct retained refund'+(result.subtotal.count===1?'':'s')+' · complete refund history is not established'));for(const group of refundStatusSubtotals(result.checks.filter(row=>row.resource_type==='refund').map(row=>({id:row.resource_id,amount:row.amount,statuses:(row.matching_observations||row.status_observations||[]).map(observation=>observation.status)}))))subtotal.append(make('p','',refundStatusSubtotalLabel(group)));results.append(subtotal);
  }
  if((result.checks.length||emptyMatch||limitation)&&draftNote&&canDraftNote()){
   const recordsOnly=!!(browsing||recoveryRecordsOnly);
   const action=make('button','secondary finding-handoff-action',limitation?'Add limitation to notes':recordsOnly?'Add records to notes':emptyMatch?'Add result to notes':'Add answer to notes');action.type='button';action.dataset.findingNote='';
   action.onclick=()=>{try{status.textContent=draftNote((limitation?findingLimitationNote:findingQuestionNote)(question,result,packet,{originalQuestion:previousQuestion,reason:previousReason,timeBoundary:boundaryChoice,recordsOnly}))||'';}catch(error){status.textContent=error.message;}};results.append(action);
  }
  if(result.checks.length){
   const context=make('details','finding-search-context');context.append(make('summary','','Evidence context'));
   const captureCount=result.checks.filter(check=>check.resource_type==='capture').length;
   const focusObservation=(check,note)=>check.matching_observations?.length?{...note,answer:'Matching retained observations',history_summary:null,ids:check.matching_observations.map(o=>o.source_id),detail:'',observations:check.matching_observations.map(o=>({id:o.source_id,label:(o.sample?'Example · ':o.source==='imported_packet'?'Shared · ':'')+(o.display_clock==='received'?'Delivery':{event:'Event',order_read:'Order read',capture_read:'Capture read',refund_read:'Refund read'}[o.kind])+' · '+(o.display_clock==='received'?'Received ':o.kind==='event'?'Occurred ':'Observed ')+observationStamp(o.display_clock==='received'?o.received_at:o.kind==='event'?o.occurred_at:o.observed_at),status:o.status,amount:o.amount?.currency&&o.amount?.value!==undefined?o.amount.currency+' '+o.amount.value:'Amount unavailable'}))}:note;
   for(const check of result.checks){const note=check.note||notes[Number(check.id.slice(1))-1];
    const matched=check.matching_observations;
    const focused=focusObservation(check,note);
    const item=renderFinding(focused,packet);item.dataset.findingSearchId=check.id;if(check.resource_id)item.dataset.findingResourceId=check.resource_id;
    if(check.matching_delivery_groups?.length){
     const timing=make('section','finding-delivery-timing');timing.dataset.deliveryTiming='';
     timing.append(make('h5','','Delivery timing'));
     for(const group of check.matching_delivery_groups){
      timing.append(make('p','',group.event_id+' · '+group.count+' delivery observations'),make('strong','',group.elapsed_ms===null?'Receipt times are incomplete':String(group.elapsed_ms/1000)+' seconds between '+(group.count===2?'the two receipts':'first and latest receipt')));
     }
     const answer=item.querySelector('.finding-answer');if(answer)answer.after(timing);else item.prepend(timing);
    }
    if(matched?.length){const history=make('details','finding-matched-history');history.append(make('summary','','Full retained history'),renderFinding(note,packet));item.append(history);}
    const matches=check.matched_source_ids||[];
    if(matches.length){
     const links=make('div','finding-matched-observations');
     for(const id of matches){const source=[...item.querySelectorAll('[data-finding-source]')].find(button=>button.dataset.findingSource===id);if(!source)continue;
      const open=make('button','secondary',matches.length===1?'Open matching observation':'Open matching observation · '+source.textContent);open.type='button';open.dataset.matchedSource=id;open.onclick=()=>source.click();links.append(open);
     }
     item.prepend(links);
    }
    for(const related of check.related_resources||[]){
     const detail=make('details','finding-related-evidence');detail.dataset.relatedResourceId=related.resource_id;
     detail.append(make('summary','','Matched '+related.resource_type+' '+related.resource_id+(related.amount?' · '+related.amount.currency+' '+related.amount.value:'')),renderFinding(focusObservation(related,related.note),packet));
     if(related.matching_observations?.length){const history=make('details','finding-matched-history');history.append(make('summary','','Full retained history'),renderFinding(related.note,packet));detail.append(history);}
     item.append(detail);
    }
    if(captureCount>1&&check.resource_type==='capture'){
     const history=make('details','finding-capture-history');
     const summary=make('summary','',check.title+' · '+note.answer);
     history.append(summary,item);results.append(history);
    }else (check.priority==='authoritative_observation'?context:results).append(item);}
  if(boundaryChoice){const name={event:'Event occurrence',order_read:'Order-read observation',capture_read:'Capture-read observation',refund_read:'Refund-read observation'}[boundaryChoice.kind];results.append(renderFinding({kind:'chosen_time_boundary',title:'Chosen comparison time',answer:name+' · '+observationStamp(boundaryChoice.stamp),detail:'You selected this retained time as a boundary. The original question did not name a comparison time.',ids:[boundaryChoice.source_id]},packet));}
   if(context.children.length>1)results.append(context);
   status.textContent='';
  }else{
   results.append(make('p','finding-refusal',result.time_refinements?.length?'Relative timing needs a comparison point. Choose a retained source time below, or refine the question yourself.':findingRefusalText[result.reason]||'Browse the records and full investigation findings below.'));
   const recovery=make('div','finding-recovery');recovery.setAttribute('aria-label','Browse retained records');
   for(const proposal of result.evidence_refinements||[]){
    const refine=make('button','secondary',proposal.label);refine.type='button';refine.dataset.findingEvidenceRefinement=proposal.kind||'capture_amount';refine.title=proposal.question;
    refine.onclick=()=>{previousQuestion=previousQuestion||question;previousReason=previousReason||result.reason;browsing=null;boundaryChoice=null;recoveryRecordsOnly=false;input.value=proposal.question;execute(true);};recovery.append(refine);
   }
   for(const proposal of result.status_refinements||[]){
    const refine=make('button','secondary',proposal.label||'Search '+proposal.status);refine.type='button';refine.dataset.findingStatusRefinement=proposal.status;refine.title=proposal.question;
    refine.onclick=()=>{previousQuestion=previousQuestion||question;previousReason=previousReason||result.reason;browsing=null;boundaryChoice=null;recoveryRecordsOnly=false;input.value=proposal.question;execute(true);};recovery.append(refine);
   }
   if(result.time_refinements?.length){
    recovery.append(make('p','','Choose a retained time as the comparison boundary. Your amount and status conditions stay in the question.'));
    for(const proposal of result.time_refinements){const name={event:'Event occurred',order_read:'Order read observed',capture_read:'Capture read observed',refund_read:'Refund read observed'}[proposal.kind];const refine=make('button','secondary',name+' · '+observationStamp(proposal.stamp));refine.type='button';refine.dataset.findingTimeRefinement=proposal.source_id;refine.title=proposal.question;
     refine.onclick=()=>{previousQuestion=previousQuestion||question;previousReason=previousReason||result.reason;browsing=null;recoveryRecordsOnly=false;boundaryChoice=proposal;input.value=proposal.question;execute(true);};recovery.append(refine);
    }
   }
   if(result.reason==='delivery_interval_unavailable'){
    const compare=make('button','secondary','Compare delivery times');compare.type='button';compare.dataset.compareDeliveryTimes='';
    compare.onclick=()=>{previousQuestion=question;previousReason=result.reason;browsing=null;boundaryChoice=null;recoveryRecordsOnly=true;input.value='Which refund has duplicate deliveries?';clear.hidden=false;execute(true);};recovery.append(compare);
   }

   for(const type of ['refund','capture']){
    const count=new Set(catalog.filter(c=>c.resource_type===type).map(c=>c.resource_id)).size;if(!count)continue;
    const browse=make('button','secondary','Browse '+type+' histories · '+count);browse.type='button';browse.dataset.findingRecovery=type;
    browse.onclick=()=>{previousQuestion=question;previousReason=result.reason;browsing=type;boundaryChoice=null;input.value='Show all '+type+'s';execute(true);};recovery.append(browse);
   }
   if(recovery.children.length)results.append(recovery);
   status.textContent='';

  }
  if(focus){heading.focus({preventScroll:true});if(reveal||matchMedia('(max-width:600px)').matches)heading.scrollIntoView({block:'start'});}
 };
 form.onsubmit=e=>{e.preventDefault();previousQuestion=null;previousReason=null;browsing=null;boundaryChoice=null;recoveryRecordsOnly=false;execute(true);};
 input.addEventListener('input',()=>{erase();clear.hidden=!input.value;});
 clear.onclick=()=>{input.value='';clear.hidden=true;erase();input.focus();};
 return {
  openQuestion(orderId,question,onOpen,recovery){
   if(!packet||orderId!==currentId||typeof question!=='string'||question.trim().length<3||question.length>MAX_FINDING_QUESTION_LENGTH)return false;
   onOpen?.();erase();
   if(recovery?.recordsOnly===true&&typeof recovery.originalQuestion==='string'&&recovery.originalQuestion!==question&&recovery.originalQuestion.length<=MAX_FINDING_QUESTION_LENGTH&&recovery.originalQuestion.trim().length>=3&&recovery.originalQuestion===recovery.originalQuestion.replace(/\s+/g,' ').trim()&&recovery.reason!=='question_too_long'&&Object.hasOwn(findingRefusalText,recovery.reason)){
    previousQuestion=recovery.originalQuestion;previousReason=recovery.reason;recoveryRecordsOnly=true;
   }
   input.value=question;clear.hidden=false;execute(true,true);return true;
  },
  update(next){
   const nextId=next?.order_id||next?.order?.id||null;
   if(nextId!==currentId){input.value='';clear.hidden=true;erase();}
   currentId=nextId;packet=next;section.hidden=!next;input.disabled=submit.disabled=!next;
   if(next&&submitted)execute(false);
  },
  clear(){packet=null;currentId=null;section.hidden=true;input.value='';clear.hidden=true;erase();}
 };
}


export function findingQuestionNote(question,result,packet,recovery={}){
 const orderId=packet?.order_id||packet?.order?.id;
 const checks=(result?.checks||[]).filter(r=>r.priority!=='authoritative_observation');
 const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
 const recoveryLines=recovery.originalQuestion&&recovery.originalQuestion!==question&&findingRefusalText[recovery.reason]?['Original question: '+clean(recovery.originalQuestion),'Original result: '+findingRefusalText[recovery.reason],...(typeof recovery.recordsOnly==='boolean'?['Follow-up result: '+findingFollowupResultText[recovery.recordsOnly?'records':'answer']]:[])]:[];
 if(orderId&&!checks.length&&result?.reason==='no_matching_resource_facts'&&result.conditions?.length){
  return ['Question: '+clean(question),'Result: No matching retained records.',...recoveryLines,...result.conditions.map(c=>'Condition: '+clean(c)),'Search scope: retained records for '+clean(orderId),'This saved search does not establish that a payment action never happened.'].join('\n');
 }
 if(!orderId||!checks.length||result.reason)throw Error('Select a supported finding first.');
 const lines=['Saved finding: '+orderId,'Question: '+clean(question),'Retained evidence only; not a fresh provider check.'];
 lines.push(...recoveryLines);
 if(result.subtotal)lines.push('Recorded refund subtotal: '+result.subtotal.currency+' '+result.subtotal.value+' · '+result.subtotal.count+' distinct refunds');
 for(const condition of result.conditions||[])lines.push('Condition: '+clean(condition));
 if(checks.some(check=>check.resource_type==='refund'||check.note?.kind==='refund_evidence'||(check.related_resources||[]).some(resource=>resource.resource_type==='refund')))lines.push(...refundEvidenceLimits.map(text=>'Limit: '+text));
 const records=[...(packet.events||[]).map(r=>({...r,kind:'webhook'})),...(packet.snapshots||[]).map(r=>({...r,kind:r.resource_kind==='capture'?'capture_read':'order_read'})),...(packet.refund_observations||[]).map(r=>({...r,kind:'refund_read'}))];
 if(recovery.timeBoundary){
  const boundary=recovery.timeBoundary,record=records.find(r=>r.id===boundary.source_id),stamp=record?.kind==='webhook'?record.occurred_at:record?.observed_at;
  if(!record||!stamp||!Number.isFinite(Date.parse(stamp))||new Date(stamp).toISOString()!==boundary.stamp)throw Error('The chosen comparison source is unavailable. Choose its retained time again.');
  lines.push('Chosen time boundary: '+clean(boundary.clock)+' at '+clean(boundary.stamp)+'; explicitly selected after the original question was unanswered.','Source group: Chosen time boundary','Finding source '+record.kind+' '+clean(record.kind==='webhook'?record.id:record.reported_read_id||record.id)+' · '+(record.source==='imported_packet'?'shared observation':record.sample?'authored observation':'saved observation'));
 }
 const appendObservationRows=(group,observations)=>{
  for(const observation of observations||[])group.push(clean(observation.display_clock==='received'?'Delivery received':observation.kind)+' · '+clean(observation.status)+' · '+(observation.amount?clean(observation.amount.currency)+' '+clean(observation.amount.value):'Amount unavailable')+' · '+clean(observation.display_clock==='received'?observation.received_at:observation.kind==='event'?observation.occurred_at:observation.observed_at));
 };
 const groups=checks.map(check=>{
  const gathered=recovery.recordsOnly===true&&recoveryLines.length&&['capture','refund'].includes(check.resource_type)&&!check.matching_observations?.length;
  const matched=gathered?check.status_observations:check.matching_observations;
  const group=[clean(check.title)+': '+(matched?.length?(gathered?'Retained observations gathered':'Matching retained observations'):clean(check.resource_type==='status_scope'?check.text:check.note?.answer||check.text))];
  appendObservationRows(group,matched);
  const appendSources=(resource,label)=>{
   group.push('Source group: '+clean(label));
   const ids=[...new Set(resource.matching_observations?.map(r=>r.source_id)||resource.matched_source_ids||resource.status_observations?.map(r=>r.source_id)||resource.source_ids||[])];
   for(const id of ids){const record=records.find(r=>r.id===id);if(!record)continue;const reference=record.kind==='webhook'?record.id:record.reported_read_id||record.id;
    group.push('Finding source '+record.kind+' '+clean(reference)+' · '+(record.source==='imported_packet'?'shared observation':record.sample?'authored observation':'saved observation'));
   }
  };
  for(const delivery of check.matching_delivery_groups||[])group.push('Delivery timing: '+clean(delivery.event_id)+' · '+delivery.count+' delivery observations · '+(delivery.elapsed_ms===null?'Receipt times are incomplete':String(delivery.elapsed_ms/1000)+' seconds between '+(delivery.count===2?'the two receipts':'first and latest receipt')));
  appendSources(check,check.title);
  if(check.resource_type==='refund')group.push('Associated capture: '+clean(check.capture_id||'not recorded')+' · association retained with the refund; not a fresh capture check');
  for(const related of check.related_resources||[]){
   const label=clean(related.title||related.resource_type+' '+related.resource_id);
   group.push('Related resource: '+label+(!related.matching_observations?.length&&related.amount?' · '+clean(related.amount.currency)+' '+clean(related.amount.value):''));
   appendObservationRows(group,related.matching_observations);
   appendSources(related,label);
   if(related.resource_type==='refund')group.push('Associated capture: '+clean(related.capture_id||'not recorded')+' · association retained with the refund; not a fresh capture check');
  }
  return group.join('\n');
 });
 const included=[];
 const finish=()=>[...lines,...included,...(included.length<groups.length?[String(groups.length-included.length)+' additional selected records omitted. Reopen the question with the full packet.']:[])].join('\n');
 for(const group of groups){included.push(group);if(finish().length>4000){included.pop();break;}}
 const text=finish();if(text.length>4000||!included.length)throw Error('This answer is too large for a note. Narrow the question first.');
 return text;
}


export const limitationCaptureCopy=Object.freeze({"singlePrefix": "Capture reference to check: ", "singleSuffix": " · retained association only; confirm its order and refund history in PayPal.", "multiple": "Capture selection needed: More than one capture reference is retained. Choose the intended capture in Records before checking PayPal.", "missing": "Capture reference not established for this question. Use Records to identify the intended capture before checking PayPal."});

function limitationCaptureContext(question,result,packet){
 if(result?.reason!=='refundable_balance_not_recorded')return [];
 const orderIds=[packet?.order_id,packet?.order?.id].filter(Boolean).map(id=>String(id).toLowerCase());
 const requested=references(question).filter(id=>!orderIds.includes(id));
 const captures=resourceFindingCatalog(packet).filter(record=>record.resource_type==='capture'&&requested.every(id=>(record.references||[]).some(reference=>String(reference).toLowerCase()===id)));
 if(captures.length===1)return [limitationCaptureCopy.singlePrefix+captures[0].resource_id+limitationCaptureCopy.singleSuffix];
 if(captures.length>1)return [limitationCaptureCopy.multiple];
 return [limitationCaptureCopy.missing];
}

export function findingLimitationNote(question,result,packet,recovery={}){
 const orderId=packet?.order_id||packet?.order?.id;
 const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
 const limitation=findingLimitation(result);
 if(orderId&&limitation){
  return ['Saved limitation: '+clean(orderId),'Question: '+clean(question),'Result: Question not answered.','Limitation: '+limitation,...limitationCaptureContext(question,result,packet),...(recovery.originalQuestion&&recovery.originalQuestion!==question&&findingRefusalText[recovery.reason]?['Original question: '+clean(recovery.originalQuestion),'Original result: '+findingRefusalText[recovery.reason]]:[]),'Search scope: retained records for '+clean(orderId),'Retained evidence only; not a fresh provider check.'].join('\n');
 }
 throw Error('Select a known limitation first.');
}
