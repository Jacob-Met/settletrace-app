// Models may rank existing checks; they never author payment assertions here.
export function supportedChecks(diagnosis) {
 return [
  ...diagnosis.notes.map((note,i)=>({id:'F'+(i+1),kind:'finding',title:note.title,text:note.detail,source_ids:[...note.ids]})),
  ...diagnosis.actions.map((text,i)=>({id:'A'+(i+1),kind:'next_check',title:'Suggested check',text,source_ids:[]}))
 ];
}
export function applyTriageOrder(content,checks){
 let parsed;
 try{parsed=JSON.parse(content);}catch{throw Error('Model ranking must be a JSON object');}
 const order=parsed?.order,valid=new Map(checks.map(c=>[c.id,c]));
 if(!Array.isArray(order)||order.length!==checks.length||order.some(id=>typeof id!=='string'||!valid.has(id))||new Set(order).size!==checks.length)
  throw Error('Model ranking must contain every supported check exactly once');
 return order.map(id=>valid.get(id));
}
