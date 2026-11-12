import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestReportLookups, validateReportLookups, validateReport } from '../web/incident-report.mjs';
const targets = value => value.lookups.map(({kind,id}) => ({kind,id}));

test('explicit fields and PayPal paths identify resource kinds without following links', () => {
  const report = 'Ticket HELP-33111: {"order_id":"6AC890131K991004D"}. Read https://api-m.sandbox.paypal.com/v2/payments/captures/5NX782392S786100A; event WH-4T455995519H0711M-0XA01234567890.';
  assert.deepEqual(targets(suggestReportLookups(report)), [
    {kind:'order',id:'6AC890131K991004D'},
    {kind:'capture',id:'5NX782392S786100A'},
    {kind:'event',id:'WH-4T455995519H0711M-0XA01234567890'}
  ]);
});
test('literal exclusions and contrasting current request preserve the requested reference', () => {
  const report = 'Do not inspect order 6AC890131K991004D, but please inspect capture 5NX782392S786100A.';
  assert.deepEqual(targets(suggestReportLookups(report)), [{kind:'capture',id:'5NX782392S786100A'}]);
});
test('references are deduplicated and ambiguous labels are not silently assigned', () => {
  assert.equal(suggestReportLookups('Capture 5NX782392S786100A. capture_id: 5NX782392S786100A.').lookups.length,1);
  assert.deepEqual(suggestReportLookups('Order 6AC890131K991004D. Capture 6AC890131K991004D.'),{lookups:[],uncertain:true});
});
test('ordinary prose, merchant references, and missing references abstain', () => {
  for (const text of ['The order remains pending; capture processing failed.', 'Merchant order 2223344455667, ticket ISSUE-849239.'])
    assert.deepEqual(suggestReportLookups(text), {lookups:[],uncertain:true});
});
test('too many explicit targets make selection uncertainty visible', () => {
  const value = suggestReportLookups('order_id: ABC12345678900001; order_id: ABC12345678900002; order_id: ABC12345678900003; order_id: ABC12345678900004');
  assert.equal(value.lookups.length,3); assert.equal(value.uncertain,true);
});
test('quoted IDs must be exact whole tokens within an exact contiguous source excerpt', () => {
  const report='Capture 5NX782392S786100A is delayed.';
  const value={lookups:[{kind:'capture',id:'5NX782392S786100A',quote:report}],uncertain:false};
  assert.deepEqual(validateReportLookups(report,JSON.stringify(value)),value);
  for (const item of [
    {...value.lookups[0],quote:'Capture is delayed.'},
    {...value.lookups[0],id:'NX782392S786100A'},
    {...value.lookups[0],quote:'Capture 5NX782392S786100A is completed.'}
  ]) assert.throws(()=>validateReportLookups(report,{lookups:[item],uncertain:false}));
  assert.throws(()=>validateReportLookups('prefix5NX782392S786100A',value));
});
test('schema rejects additional actions, malformed types, duplicated references, and wrappers', () => {
  const report='Capture 5NX782392S786100A';
  const item={kind:'capture',id:'5NX782392S786100A',quote:report};
  for (const value of [
    {lookups:[item],uncertain:false,action:'refund'},
    {lookups:[{...item,kind:'payment'}],uncertain:false},
    {lookups:[item,item],uncertain:false},
    {lookups:[item],uncertain:'false'},
    {lookups:[],uncertain:false}
  ]) assert.throws(()=>validateReportLookups(report,value));
  assert.throws(()=>validateReportLookups(report,'~~~json\n{}\n~~~'));
});
test('provenance validation explicitly does not prove semantic resource type', () => {
  const report='Merchant ticket ISSUE-849239';
  assert.deepEqual(validateReportLookups(report,{
    lookups:[{kind:'event',id:'ISSUE-849239',quote:report}],uncertain:true
  }).lookups[0].kind,'event');
});
test('limits reject invalid input without truncating its evidence', () => {
  for (const value of [null,42,'  ','x'.repeat(8001)]) assert.throws(()=>validateReport(value));
  const original='  capture_id: 5NX782392S786100A\n';
  assert.equal(validateReport(original),original);
});


test('explicit historical payment requests remain targets while stale context and negation abstain', () => {
  for (const request of ['Please investigate previous capture', 'Please inspect the old capture', "Review yesterday's capture"])
    assert.deepEqual(targets(suggestReportLookups(request+' 5NX782392S786100A.')), [{kind:'capture',id:'5NX782392S786100A'}]);
  for (const request of ['Previous capture', 'Ignore old capture', 'Do not investigate previous capture', "Don't inspect the old capture", 'Never review previous capture'])
    assert.deepEqual(suggestReportLookups(request+' 5NX782392S786100A.'), {lookups:[],uncertain:true});
  assert.deepEqual(targets(suggestReportLookups('Ignore old order 6AC890131K991004D; please investigate previous capture 5NX782392S786100A.')), [{kind:'capture',id:'5NX782392S786100A'}]);
});

test('historical background stays excluded beside a separate current request',()=>{
 assert.deepEqual(targets(suggestReportLookups('Previous capture 5NX782392S786100A was logged yesterday. Please inspect order 6AC890131K991004D.')), [{kind:'order',id:'6AC890131K991004D'}]);
});


test('an explicit comma-separated request does not inherit an earlier exclusion', () => {
  for (const report of [
    'Ignore order OLD-123456, please inspect capture LIVE-654321.',
    'Previous order OLD-123456, please inspect capture LIVE-654321.',
    'Do not inspect old order OLD-123456, investigate previous capture LIVE-654321.',
    'Skip order OLD-123456, and please review refund LIVE-654321.'
  ]) {
    const result=suggestReportLookups(report);
    assert.equal(result.lookups.length,1);
    assert.equal(result.lookups[0].id,'LIVE-654321');
    assert(!result.lookups[0].quote.includes('OLD-123456'));
  }
});
test('comma lists and negative requests retain their original exclusion', () => {
  for (const report of [
    'Ignore captures OLD-123456, OLD-654321.',
    'Do not inspect captures OLD-123456, OLD-654321.',
    'Ignore order OLD-123456, please do not inspect capture OLD-654321.',
    'Previous capture OLD-123456, capture OLD-654321.',
    'Please do not inspect previous capture OLD-123456, not order OLD-654321.'
  ]) assert.deepEqual(suggestReportLookups(report),{lookups:[],uncertain:true});
  assert.equal(suggestReportLookups('Please inspect captures LIVE-123456, LIVE-654321.').lookups.length,2);
});


test('a requested historical list carries its request to each contiguous reference', () => {
  for (const label of ['captures','capture IDs','orders','order IDs','refunds','event IDs']) {
    const kind=label.split(' ')[0].replace(/s$/,'');
    const result=suggestReportLookups('Please investigate previous '+label+' PAYPAL-123456, PAYPAL-654321.');
    assert.deepEqual(targets(result),[{kind,id:'PAYPAL-123456'},{kind,id:'PAYPAL-654321'}]);
  }
});
test('historical list intent does not escape its list or override exclusions', () => {
  for (const prefix of ['Previous','Ignore previous','Do not inspect previous','Never investigate previous']) {
    assert.deepEqual(suggestReportLookups(prefix+' captures PAYPAL-123456, PAYPAL-654321.'),{lookups:[],uncertain:true});
  }
  assert.deepEqual(targets(suggestReportLookups('Please inspect previous captures PAYPAL-123456, PAYPAL-654321. Ignore order OLD-123456.')),[
    {kind:'capture',id:'PAYPAL-123456'},{kind:'capture',id:'PAYPAL-654321'}
  ]);
  assert.deepEqual(targets(suggestReportLookups('Please inspect previous captures PAYPAL-123456, PAYPAL-654321 is already resolved.')),[
    {kind:'capture',id:'PAYPAL-123456'}
  ]);
});


test('every supported request verb respects explicit denial for single references and lists', () => {
  for (const verb of ['inspect','investigate','check','review','look up']) {
    for (const denial of ['Do not', "Don't", 'Never', 'Cannot', "Can't"]) {
      for (const target of ['capture PAYPAL-123456','captures PAYPAL-123456, PAYPAL-654321','previous capture PAYPAL-123456']) {
        assert.deepEqual(suggestReportLookups(denial+' '+verb+' '+target+'.'),{lookups:[],uncertain:true},denial+' '+verb+' '+target);
      }
    }
    assert.equal(suggestReportLookups('Please '+verb+' capture PAYPAL-123456.').lookups.length,1);
    assert.equal(suggestReportLookups('Please '+verb+' previous captures PAYPAL-123456, PAYPAL-654321.').lookups.length,2);
    assert.deepEqual(targets(suggestReportLookups('Do not '+verb+' capture OLD-123456, please '+verb+' capture LIVE-654321.')),[{kind:'capture',id:'LIVE-654321'}]);
  }
});

test('every explicit request verb outranks incidental references before the suggestion cap',()=>{
 const background='Order ORDER-CONTEXT-100 was mentioned. Capture CAPTURE-CONTEXT-200 is in the note. Refund REFUND-CONTEXT-300 was logged. ';
 for(const verb of ['inspect','investigate','check','review','look up'])
  for(const prefix of ['', 'Please '])
   for(const history of ['', 'previous ']){
    const report=background+prefix+verb+' '+history+'order ORDER-REQUEST-400.';
    const result=suggestReportLookups(report);
    assert.equal(result.lookups[0]?.id,'ORDER-REQUEST-400',report);
    assert.equal(result.lookups.length,3);
    assert.equal(result.uncertain,true,'The existing bounded suggestion contract remains explicit');
   }
 for(const denied of ['Do not review previous order','Never inspect order','Previous order']){
  const result=suggestReportLookups(background+denied+' ORDER-REQUEST-400.');
  assert(!result.lookups.some(x=>x.id==='ORDER-REQUEST-400'),denied);
 }
});


test('a later comma request does not lend its intent to earlier references',()=>{
 const background='Order ORDER-CONTEXT-100, capture CAPTURE-CONTEXT-200, refund REFUND-CONTEXT-300, ';
 for(const verb of ['inspect','investigate','check','review','look up'])
  for(const prefix of ['', 'please ', 'and please '])
   for(const history of ['', 'previous ']){
    const report=background+prefix+verb+' '+history+'order ORDER-REQUEST-400.';
    const result=suggestReportLookups(report);
    assert.equal(result.lookups[0]?.id,'ORDER-REQUEST-400',report);
    assert.equal(result.lookups.length,3);
    assert.equal(result.uncertain,true);
    for(const item of result.lookups.slice(1))assert(!item.quote.includes('ORDER-REQUEST-400'),'Background quote ends before the new request');
   }
 assert.deepEqual(targets(suggestReportLookups('Ignore orders ORDER-OLD-100, ORDER-OLD-200, please review previous order ORDER-REQUEST-400.')),[{kind:'order',id:'ORDER-REQUEST-400'}]);
 assert.deepEqual(targets(suggestReportLookups('Please review orders ORDER-FIRST-100, ORDER-SECOND-200.')),[{kind:'order',id:'ORDER-FIRST-100'},{kind:'order',id:'ORDER-SECOND-200'}]);
});
