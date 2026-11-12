import test from 'node:test';
import assert from 'node:assert/strict';
import {appendSavedScopeObservations} from '../web/incident-summary.mjs';

function node(tagName) {
 return {
  tagName, className:'', textContent:'', children:[], attributes:{},
  append(...nodes){this.children.push(...nodes);},
  setAttribute(name,value){this.attributes[name]=String(value);}
 };
}
const scope={observations:[
 {kind:'order_read',resourceId:'ORDER-A',status:'COMPLETED',amount:'USD 1.00',basis:'Saved API read',time:'2026-11-11T18:00:00Z'},
 {kind:'capture_read',resourceId:'CAPTURE-A',status:'PARTIALLY_REFUNDED',amount:'USD 0.75',basis:'Saved API read',time:'2026-11-11T18:05:00Z'},
 {kind:'capture_read',resourceId:'CAPTURE-A',status:'PARTIALLY_REFUNDED',amount:'USD 0.75',basis:'Saved API read',time:'2026-11-11T18:06:00Z'}
]};

test('saved scope presents one in-place capture continuation with unchanged observations',()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:node};
 try {
  const host=node('div'),seen=[];
  assert.equal(appendSavedScopeObservations(host,scope,{renderCaptureControl:id=>{
   seen.push(id);return {row:Object.assign(node('div'),{textContent:'Capture '+id+' / View retained history'}),status:node('p')};
  }}),true);
  assert.deepEqual(seen,['CAPTURE-A']);
  const section=host.children[0],resources=section.children;
  assert.equal(resources.length,2);
  assert.equal(resources[0].children[0].children[0].textContent,'ORDER-A');
  assert.equal(resources[1].children[0].textContent,'Capture');
  assert.match(resources[1].children[1].textContent,/View retained history/);
  assert.equal(resources[1].children.filter(item=>item.className==='saved-scope-value').length,1);
  assert.equal(resources[1].children.find(item=>item.className==='saved-scope-times').children.length,2);
 } finally {globalThis.document=previous;}
});

test('handoff scope without note navigation keeps readable static references',()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:node};
 try {
  const host=node('div');
  assert.equal(appendSavedScopeObservations(host,scope),true);
  const resources=host.children[0].children;
  assert.equal(resources[0].children[0].children[0].textContent,'ORDER-A');
  assert.equal(resources[1].children[0].children[0].textContent,'CAPTURE-A');
  assert.equal(resources[1].children.filter(item=>item.className==='limitation-reference').length,0);
 } finally {globalThis.document=previous;}
});
