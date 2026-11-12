import {randomUUID,createHash} from 'node:crypto';
import {investigationIds} from './investigation-work.mjs';
const invalid=message=>Object.assign(Error(message),{status:422});
const validText=text=>typeof text==='string'&&text.trim().length>0&&text.length<=4000;
const fingerprint=n=>createHash('sha256').update(JSON.stringify([n.order_id,n.origin_id||n.id,n.text,n.recorded_at])).digest('hex');
export function addInvestigationNote(state,{order_id,text,note_id}) {
 if(!investigationIds(state).includes(order_id))throw Object.assign(Error('Select an existing investigation'),{status:404});
 if(!validText(text))throw invalid('Write a note of 1–4,000 characters.');
 if(typeof note_id!=='string'||!/^note-[a-f0-9-]{36}$/.test(note_id))throw invalid('Invalid note identity.');
 const prior=(state.operator_notes??[]).find(n=>n.id===note_id&&n.source==='operator');
 if(prior){if(prior.order_id!==order_id||prior.text!==text)throw Object.assign(Error('This note was already saved with different text. Reload before saving another note.'),{status:409});return state;}
 const note={id:note_id,order_id,text,recorded_at:new Date().toISOString(),source:'operator'};
 return {...state,operator_notes:[...(state.operator_notes??[]),note]};
}
export function admitNotes(raw,orderId) {
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>1000)throw invalid('Invalid shared investigation notes.');
 return raw.map(n=>{
  if(!n||!validText(n.text)||typeof n.id!=='string'||n.id.length>100||(n.origin_id!==undefined&&(typeof n.origin_id!=='string'||n.origin_id.length>100))||(n.order_id&&n.order_id!==orderId))throw invalid('Invalid shared investigation note.');
  const t=n.recorded_at==null?null:new Date(n.recorded_at);
  if(t&&Number.isNaN(t.getTime()))throw invalid('Invalid shared note time.');
  return {id:'shared-'+randomUUID(),origin_id:n.origin_id||n.id,order_id:orderId,text:n.text,recorded_at:t?t.toISOString():null,source:'shared',imported_at:new Date().toISOString()};
 });
}
export function mergeNotes(current,incoming) {
 const seen=new Set(current.map(fingerprint));
 return [...current,...incoming.filter(n=>{const key=fingerprint(n);if(seen.has(key))return false;seen.add(key);return true;})];
}
export function exportNotes(notes,orderId) {
 return notes.filter(n=>n.order_id===orderId).map(({id,origin_id,order_id,text,recorded_at,source})=>({id:origin_id||id,order_id,text,recorded_at,source}));
}
