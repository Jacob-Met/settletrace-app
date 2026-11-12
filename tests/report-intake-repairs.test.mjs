import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestReportLookups,validateReportLookups} from '../web/incident-report.mjs';
const keys=r=>r.lookups.map(x=>x.kind+':'+x.id);
test('production diagnostic repair retains order and both explicitly listed captures',()=>{
 const report='The order 9KL12345MN678901P has two captures: 1QR23456ST789012U and 3VW34567XY890123Z; compare both attempts.';
 const r=suggestReportLookups(report);
 assert.deepEqual(keys(r),['order:9KL12345MN678901P','capture:1QR23456ST789012U','capture:3VW34567XY890123Z']);
 assert.equal(r.uncertain,false);assert.deepEqual(validateReportLookups(report,r),r);
});
test('explicit event request excludes the negated related order',()=>{
 const report='Event WH-7AA32451BC0233532-12376317DE4543714 belongs to checkout. Read that event, not the related order 2EF67890GH123456J.';
 assert.deepEqual(keys(suggestReportLookups(report)),['event:WH-7AA32451BC0233532-12376317DE4543714']);
 for(const word of ['associated','linked']){
  const r=suggestReportLookups('Inspect event WH-ABCDEF-11, not the '+word+' order ORDER-123456.');
  assert.deepEqual(keys(r),['event:WH-ABCDEF-11']);
 }
});
test('plural references stop at a new resource cue and exclude a negated list',()=>{
 assert.deepEqual(keys(suggestReportLookups('Capture IDs: CAPTURE-100, CAPTURE-200 and CAPTURE-300. Invoice INV-004 remains open.')),['capture:CAPTURE-100','capture:CAPTURE-200','capture:CAPTURE-300']);
 assert.deepEqual(keys(suggestReportLookups('Do not inspect captures: CAPTURE-100 and CAPTURE-200. Inspect order ORDER-300.')),['order:ORDER-300']);
 assert.deepEqual(keys(suggestReportLookups('Captures: CAPTURE-100 and invoice INV-004.')),['capture:CAPTURE-100']);
});
test('a 100-character ID retains a whole exact source excerpt at most360 characters',()=>{
 const id='A'.repeat(99)+'7';
 for(const prefix of ['', 'context '.repeat(30)])for(const suffix of ['', ' background'.repeat(40)]){
  const report=prefix+'capture '+id+suffix;
  const r=suggestReportLookups(report);assert.equal(r.lookups.length,1);
  assert.equal(r.lookups[0].id,id);assert.ok(r.lookups[0].quote.length<=360);
  assert.ok(report.includes(r.lookups[0].quote));assert.deepEqual(validateReportLookups(report,r),r);
 }
});
test('long plural IDs remain exact and never exceed the source excerpt budget',()=>{
 const ids=['A','B','C'].map((x,i)=>x.repeat(99)+i),report='background '.repeat(20)+'capture IDs: '+ids.join(', ')+' context'.repeat(30);
 const r=suggestReportLookups(report);assert.deepEqual(r.lookups.map(x=>x.id),ids);
 for(const item of r.lookups){assert.ok(item.quote.length<=360);assert.ok(report.includes(item.quote));}
 assert.deepEqual(validateReportLookups(report,r),r);
});

test('report excerpts preserve decimal amounts on both sides of a capture reference',()=>{
 const report='The 0.25 USD refund relates to capture CAPTURE-REPORT-200, which shows 1.00 USD. Inspect event WH-REPORT-300 next.';
 const r=suggestReportLookups(report),capture=r.lookups.find(x=>x.kind==='capture');
 assert.ok(capture);
 assert.equal(capture.quote,'The 0.25 USD refund relates to capture CAPTURE-REPORT-200, which shows 1.00 USD');
 assert.deepEqual(validateReportLookups(report,r),r);
 assert.ok(!capture.quote.includes('WH-REPORT-300'),'A sentence boundary still ends the excerpt');
});

test('an exact refund reference is offered alongside its capture without merging their amounts',()=>{
 const report='Please inspect refund 6KJ177644S3791349 for 0.25 USD and capture 05484865GF3267710 for 1.00 USD.';
 const r=suggestReportLookups(report);
 assert.deepEqual(keys(r),['refund:6KJ177644S3791349','capture:05484865GF3267710']);
 assert.equal(r.uncertain,false);
 for(const lookup of r.lookups){assert.ok(lookup.quote.includes('0.25 USD'));assert.ok(lookup.quote.includes('1.00 USD'));}
 assert.deepEqual(validateReportLookups(report,r),r);
});
test('refund paths and explicit plural references retain type and respect exclusions',()=>{
 const report='Ignore refund REFUND-OLD-100. Inspect https://api-m.sandbox.paypal.com/v2/payments/refunds/REFUND-CURRENT-200; refunds: REFUND-CURRENT-300 and REFUND-CURRENT-400.';
 const r=suggestReportLookups(report);
 assert.deepEqual(keys(r).sort(),['refund:REFUND-CURRENT-200','refund:REFUND-CURRENT-300','refund:REFUND-CURRENT-400']);
 assert.equal(r.uncertain,false);
});
