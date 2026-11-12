// Navigation for the existing payment workspace. No provider calls or payment effects.
export function mountWorkspaceShell({getSelected=()=>null}={}){
 const byId=id=>document.getElementById(id);
 const workspace=byId('payment-workspace');
 const tabs=[...document.querySelectorAll('[role="tab"][data-view]')];
 const panels=[...document.querySelectorAll('[data-view-panel]')];
 const dialogs=[...document.querySelectorAll('dialog.sheet')];
 const abort=new AbortController(),options={signal:abort.signal};
 const listen=(node,type,handler)=>node?.addEventListener(type,handler,options);
 const openers=new Map();
 let copyTimer,drawerInertState=null,sourceReturn=null;
 const returnButton=document.createElement('button');returnButton.id='source-return';returnButton.type='button';returnButton.className='text-button';returnButton.hidden=true;
 byId('open-investigation-notes')?.before(returnButton);
 function updateSourceReturn(){
  returnButton.hidden=!sourceReturn;
  if(!sourceReturn){delete document.body.dataset.sourceNoteReturn;return;}
  returnButton.textContent='← Back to '+(sourceReturn.note?'note':sourceReturn.view==='overview'?'trace':'records');
  let noteOrigin=sourceReturn;while(noteOrigin&&!noteOrigin.note)noteOrigin=noteOrigin.parent;
  document.body.toggleAttribute('data-source-note-return',!!noteOrigin);
 }
 function clearSourceReturn(){sourceReturn=null;updateSourceReturn();}
 function rememberSourceOrigin(opener=document.activeElement){
  const view=document.body.dataset.view;
  if(view==='activity')return;
  const active=opener;
  const traceRow=byId('overview-activity')?.querySelector('.trace-row[aria-pressed="true"]');
  const note=!!active?.closest('#investigation-notes .investigation-note');
  const parent=!note&&sourceReturn?.order===getSelected()?sourceReturn:null;
  sourceReturn={view,order:getSelected(),scroll:workspace?.scrollTop||0,opener:active?.closest('.trace-inspector-dialog')?traceRow:active,note,parent};
  updateSourceReturn();
 }
 listen(returnButton,'click',()=>{
  const origin=sourceReturn;
  if(!origin||origin.order!==getSelected()){clearSourceReturn();return;}
  sourceReturn=origin.parent||null;updateSourceReturn();
  showView(origin.view,{resetScroll:false,preserveSourceReturn:!!sourceReturn});
  if(workspace)workspace.scrollTop=origin.scroll;
  const target=origin.opener?.isConnected&&origin.opener.checkVisibility()?origin.opener:byId('tab-'+origin.view);
  target?.focus({preventScroll:true});
 });
 const hero=workspace?.querySelector('.payment-hero');
 function updatePaymentContext(){
  const compact=['activity','records'].includes(document.body.dataset.view);
  const height=compact&&hero?Math.ceil(hero.getBoundingClientRect().height):0;
  workspace?.style.setProperty('--payment-context-height',height+'px');
 }
 const contextObserver=typeof ResizeObserver==='function'?new ResizeObserver(updatePaymentContext):null;
 if(hero)contextObserver?.observe(hero);
 listen(window,'resize',updatePaymentContext);

 let readOnlyDemo=false,demoLink=null;
 const hiddenForDemo=new Map();
 const demoSelector='[data-open-dialog="inspector-dialog"],[data-open-dialog="tools-dialog"],[data-open-dialog="settings-dialog"],#sample,#reread,#archive-investigation,[data-capture-action],[data-refund-action]';
 function applyDemoControls(){
  if(!readOnlyDemo)return;
  for(const node of document.querySelectorAll(demoSelector)){if(!hiddenForDemo.has(node))hiddenForDemo.set(node,node.hidden);node.hidden=true;}
 }
 const demoObserver=new MutationObserver(applyDemoControls);
 function setReadOnlyDemo(active){
  if(readOnlyDemo===active){applyDemoControls();return;}
  readOnlyDemo=active;
  const badge=document.querySelector('.sandbox-badge');if(badge)badge.textContent='Sandbox';
  if(active){
   document.body.dataset.readOnlyDemo='true';closeDialogs();applyDemoControls();
   demoObserver.observe(document.body,{childList:true,subtree:true});
   demoLink=document.createElement('a');demoLink.className='header-action';demoLink.textContent='Run locally';demoLink.href='https://github.com/Jacob-Met/settletrace#readme';
   document.querySelector('.header-actions')?.append(demoLink);
  }else{
   delete document.body.dataset.readOnlyDemo;demoObserver.disconnect();demoLink?.remove();demoLink=null;
   for(const [node,hidden] of hiddenForDemo)if(node.isConnected)node.hidden=hidden;hiddenForDemo.clear();
  }
 }

 function setDrawerInert(active){
  if(active&&!drawerInertState){drawerInertState=[workspace,document.querySelector('.header-actions')].filter(Boolean).map(node=>[node,node.inert]);for(const [node] of drawerInertState)node.inert=true;}
  if(!active&&drawerInertState){for(const [node,previous] of drawerInertState)node.inert=previous;drawerInertState=null;}
 }
 function showView(name,{focus=false,resetScroll=true,preserveSourceReturn=false}={}){
  const tab=tabs.find(item=>item.dataset.view===name);
  if((name!=='activity'&&!preserveSourceReturn)||sourceReturn?.order!==getSelected())clearSourceReturn();
  if(!tab)return false;
  document.body.dataset.view=name;
  for(const item of tabs){const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;}
  for(const panel of panels)panel.hidden=panel.dataset.viewPanel!==name;
  updatePaymentContext();
  if(resetScroll&&workspace)workspace.scrollTop=0;
  if(focus)tab.focus({preventScroll:true});
  document.dispatchEvent(new CustomEvent('settletrace:viewchange',{detail:{view:name}}));
  return true;
 }
 function closeInvestigations({restoreFocus=false}={}){
  document.body.removeAttribute('data-list-open');
  setDrawerInert(false);
  byId('show-investigations')?.setAttribute('aria-expanded','false');
  if(byId('investigations-scrim'))byId('investigations-scrim').hidden=true;
  if(restoreFocus)byId('show-investigations')?.focus({preventScroll:true});
 }
 function openInvestigations(){
  if(window.innerWidth>760){byId('incident-search')?.focus({preventScroll:true});return;}
  document.body.dataset.listOpen='true';
  setDrawerInert(true);
  byId('show-investigations')?.setAttribute('aria-expanded','true');
  if(byId('investigations-scrim'))byId('investigations-scrim').hidden=false;
  byId('incident-search')?.focus({preventScroll:true});
 }
 function closeDialogs(){
  for(const dialog of dialogs)if(dialog.open)dialog.close();
 }
 function openDialog(id){
  if(readOnlyDemo&&['inspector-dialog','tools-dialog','settings-dialog'].includes(id))return false;
  const dialog=byId(id);
  if(!(dialog instanceof HTMLDialogElement))return false;
  if(dialog.open)return true;
  const active=document.activeElement;
  const opener=window.innerWidth<=760&&active?.closest('#investigations')?byId('show-investigations'):active;
  closeDialogs();
  closeInvestigations();
  openers.set(dialog,opener);
  dialog.showModal();
  return true;
 }
 for(const tab of tabs){
  listen(tab,'click',()=>showView(tab.dataset.view));
  listen(tab,'keydown',event=>{
   let index=tabs.indexOf(tab);
   if(event.key==='ArrowRight')index=(index+1)%tabs.length;
   else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;
   else if(event.key==='Home')index=0;
   else if(event.key==='End')index=tabs.length-1;
   else return;
   event.preventDefault();showView(tabs[index].dataset.view,{focus:true});
  });
 }
 for(const link of document.querySelectorAll('[data-view-link]'))listen(link,'click',()=>showView(link.dataset.viewLink,{focus:true}));
 for(const button of document.querySelectorAll('[data-open-dialog]'))listen(button,'click',()=>openDialog(button.dataset.openDialog));
 for(const button of document.querySelectorAll('[data-close-dialog]'))listen(button,'click',()=>button.closest('dialog')?.close());
 for(const dialog of dialogs){
  listen(dialog,'keydown',event=>{
   if(event.key!=='Tab')return;
   const focusable=[...dialog.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')].filter(node=>!node.disabled&&node.tabIndex>=0&&node.checkVisibility({visibilityProperty:true,contentVisibilityAuto:true})&&!node.closest('[hidden],[inert]'));
   if(!focusable.length){event.preventDefault();dialog.focus();return;}
   const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
   if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus();}
  });
  listen(dialog,'click',event=>{
   if(event.target!==dialog)return;
   const rect=dialog.getBoundingClientRect();
   if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
  listen(dialog,'close',()=>{
   const opener=openers.get(dialog);openers.delete(dialog);
   if(opener?.isConnected&&!dialogs.some(item=>item.open))opener.focus({preventScroll:true});
  });
 }
 listen(byId('show-investigations'),'click',()=>document.body.dataset.listOpen==='true'?closeInvestigations({restoreFocus:true}):openInvestigations());
 listen(byId('close-investigations'),'click',()=>closeInvestigations({restoreFocus:true}));
 listen(byId('investigations-scrim'),'click',()=>closeInvestigations({restoreFocus:true}));
 listen(document,'keydown',event=>{
  if(document.body.dataset.listOpen!=='true'||dialogs.some(item=>item.open))return;
  if(event.key==='Escape'){event.preventDefault();closeInvestigations({restoreFocus:true});return;}
  if(event.key!=='Tab')return;
  const focusable=[...byId('investigations').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[hidden]'));
  if(!focusable.length)return;
  const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||!byId('investigations').contains(active))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!byId('investigations').contains(active))){event.preventDefault();first.focus();}
 });
 listen(window,'resize',()=>{if(window.innerWidth>760)closeInvestigations();});
 const copyButton=byId('copy-reference');
 const copyStatus=document.createElement('span');copyStatus.id='copy-reference-status';copyStatus.className='sr-only';copyStatus.setAttribute('role','status');copyButton?.after(copyStatus);
 listen(copyButton,'click',async()=>{
  const reference=getSelected();
  if(!reference)return;
  try{
   await navigator.clipboard.writeText(reference);
   copyStatus.textContent='Payment reference copied.';
   copyButton.dataset.copied='true';copyButton.title='Copied';copyButton.setAttribute('aria-label','Payment reference copied');
   clearTimeout(copyTimer);copyTimer=setTimeout(()=>{copyButton.removeAttribute('data-copied');copyButton.title='';copyButton.setAttribute('aria-label','Copy payment reference');},1800);
  }catch{
   const target=byId('review-context'),selection=window.getSelection();
   if(target&&selection){const range=document.createRange();range.selectNodeContents(target);selection.removeAllRanges();selection.addRange(range);}
   copyStatus.textContent='Payment reference selected. Use Copy to copy it.';
  }
 });
 showView(document.body.dataset.view||'overview',{resetScroll:false});
 return {rememberSourceOrigin,setReadOnlyDemo,showView,openDialog,closeDialogs,openInvestigations,closeInvestigations,destroy(){contextObserver?.disconnect();demoObserver.disconnect();demoLink?.remove();closeInvestigations();abort.abort();clearTimeout(copyTimer);copyStatus.remove();returnButton.remove();}};
}
