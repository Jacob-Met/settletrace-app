// Continue from a displayed retained reference without changing its source authority.
export function captureReferenceControl(value,{openHistory}={}){
 const make=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
 const reference=make('code','',value),row=make('div','limitation-reference',''),copy=make('button','secondary','Copy'),status=make('p','note-meta limitation-copy-status','');
 copy.type='button';copy.setAttribute('aria-label','Copy capture reference');
 status.hidden=true;status.setAttribute('role','status');
 copy.onclick=async()=>{
  try{await navigator.clipboard.writeText(value);copy.textContent='Copied';status.textContent='Capture reference copied.';}
  catch{
   const selection=window.getSelection();
   if(selection){const range=document.createRange();range.selectNodeContents(reference);selection.removeAllRanges();selection.addRange(range);status.textContent='Capture reference selected. Use your device’s Copy command.';}
   else status.textContent='Select the capture reference above and use your device’s Copy command.';
   copy.textContent='Copy';
  }
  status.hidden=false;
 };
 row.append(reference,copy);
 if(openHistory){
  const history=make('button','secondary','View retained history');history.type='button';history.dataset.noteCaptureHistory=value;
  history.setAttribute('aria-label','View retained history for capture '+value);
  history.onclick=async()=>{
   history.disabled=true;status.hidden=true;
   try{if(await openHistory(history)===false){status.textContent='No retained capture history is included for this reference. The saved note stays unchanged.';status.hidden=false;}}
   catch{status.textContent='Could not open retained capture history. Try again.';status.hidden=false;}
   finally{history.disabled=false;}
  };
  row.append(history);
 }
 return {row,status};
}
