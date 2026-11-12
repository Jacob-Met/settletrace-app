import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCaptureRead} from '../paypal-resources.mjs';
test('capture read retains exact status and amount while removing customer and links',()=>{
 const c=normalizeCaptureRead({id:'CAPTURE-77',status:'PARTIALLY_REFUNDED',amount:{currency_code:'USD',value:'42.00'},create_time:'2026-11-10T00:00:00Z',update_time:'2026-11-10T01:00:00Z',supplementary_data:{related_ids:{order_id:'ORDER-77'}},payee:{email_address:'private@example.com'},invoice_id:'private',links:[{href:'https://example.com'}]},'CAPTURE-77');
 assert.deepEqual(c,{capture_id:'CAPTURE-77',status:'PARTIALLY_REFUNDED',amount:{currency:'USD',value:'42.00'},created:'2026-11-10T00:00:00.000Z',updated:'2026-11-10T01:00:00.000Z',order_id:'ORDER-77'});
});
test('capture without explicit order association remains unknown even with authorization up link',()=>{
 const c=normalizeCaptureRead({id:'CAPTURE-77',links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-77'}],supplementary_data:{related_ids:{authorization_id:'AUTH-77'}}},'CAPTURE-77');
 assert.equal(c.order_id,null);assert.equal(c.amount,null);assert.equal(c.updated,null);assert.equal(c.status,'UNKNOWN');
});
test('mismatched capture and invalid requested identity are rejected',()=>{
 assert.throws(()=>normalizeCaptureRead({id:'CAPTURE-OTHER'},'CAPTURE-77'),/does not match/);assert.throws(()=>normalizeCaptureRead({id:'../x'},'../x'),/does not match/);
});
test('malformed optional values do not become payment facts',()=>{
 const c=normalizeCaptureRead({id:'CAPTURE-77',amount:{currency_code:'USD',value:-1},update_time:'invalid',supplementary_data:{related_ids:{order_id:{id:'ORDER-77'}}}},'CAPTURE-77');assert.equal(c.amount,null);assert.equal(c.updated,null);assert.equal(c.order_id,null);
});
