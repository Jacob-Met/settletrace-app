// Browse provider references. Only an explicit detail read saves evidence.
export function eventDiscovery(root,{call,inspect}) {
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const refresh=make('button','Find recent events','outline'),status=make('p','','quiet'),rows=make('div',null,'provider-event-rows'),more=make('button','More events','outline');
 refresh.type=more.type='button';refresh.id='event-discover';more.id='event-discover-more';more.hidden=true;status.hidden=true;
 status.id='event-discover-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(refresh,status,rows,more);
 let connected=false,reading=false,pending=false,cursor=null,pageCount=0,body=null;const shown=new Set();
 const controls=()=>{refresh.disabled=more.disabled=!connected||pending;refresh.textContent=pending?'Loading events…':'Find recent events';for(const b of rows.querySelectorAll('button'))b.disabled=!connected||reading;};
 const addRow=e=>{
  if(shown.has(e.id))return null;shown.add(e.id);
  const tr=make('tr'),identity=make('td'),when=make('td'),action=make('td'),read=make('button','Read','secondary'),type=make('strong');
  for(const [index,part] of e.type.split('.').entries()){if(index)type.append('.',make('wbr'));const segment=make('span',part);segment.style.whiteSpace='nowrap';type.append(segment);}
  identity.append(type,make('code',e.id));if(e.resource_id)identity.append(make('small','Resource '+e.resource_id));
  when.textContent=e.occurred?new Date(e.occurred).toLocaleString(undefined,{timeZone:'UTC'}):'Time not supplied';
  read.type='button';read.setAttribute('aria-label','Read event '+e.id);read.onclick=()=>{if(!reading)inspect(e.id);};action.append(read);tr.append(identity,when,action);body.append(tr);return read;
 };
 const load=async continuation=>{
  if(pending)return;const trigger=continuation?more:refresh,hadFocus=document.activeElement===trigger;pending=true;controls();status.hidden=false;status.textContent=continuation?'Loading more events…':'Loading events…';
  try{
   const result=await call('/api/events/recent'+(continuation?'?cursor='+encodeURIComponent(cursor):''));
   if(!continuation){rows.replaceChildren();shown.clear();pageCount=0;body=null;}
   pageCount++;cursor=result.next_cursor;more.hidden=!cursor;
   if(result.events.length&&!body){
    const format=new Intl.DateTimeFormat(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),table=make('table'),caption=make('caption',format.format(new Date(result.start_time))+' – '+format.format(new Date(result.end_time))+' UTC'),head=make('thead'),hr=make('tr');body=make('tbody');
    for(const label of ['Event','Time (UTC)','']){const th=make('th',label);th.scope='col';hr.append(th);}head.append(hr);table.append(caption,head,body);rows.append(table);
   }
   let firstNew=null;for(const e of result.events){const button=addRow(e);if(button)firstNew??=button;}
   status.textContent=shown.size?shown.size+' '+(shown.size===1?'event':'events')+' · '+pageCount+' '+(pageCount===1?'page':'pages')+(result.more_available&&!cursor?' · Further events unavailable.':''):'No events in the past 24 hours.';
   if(continuation&&firstNew){firstNew.focus({preventScroll:true});firstNew.closest('tr').scrollIntoView({block:'center'});}
  }catch(error){status.textContent='Could not list events: '+error.message;}
  finally{pending=false;controls();if(hadFocus&&document.activeElement===document.body&&!trigger.hidden&&!trigger.disabled)trigger.focus({preventScroll:true});}
 };
 refresh.onclick=()=>load(false);more.onclick=()=>load(true);
 return {update(next){connected=next.connected;reading=next.reading;controls();}};
}
