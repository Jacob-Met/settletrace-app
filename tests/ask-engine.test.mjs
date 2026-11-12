import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSampleLedger} from '../ask-ledger.mjs';
import {ask,parseAmount,payoutRows,mapModelSlots,answer} from '../web/ask-engine.mjs';
const now=new Date(2026,10,12,12),today='2026-11-12'; // Thursday
const L=buildSampleLedger(now);
test('amounts in words and digits',()=>{
 assert.equal(parseAmount('twelve dollars short'),1200);assert.equal(parseAmount('$12.50'),1250);assert.equal(parseAmount('thirty-eight dollars'),3800);assert.equal(parseAmount('nothing'),null);
});
test('payout marks: matches, short, needs a look',()=>{
 const by=Object.fromEntries(payoutRows(L).map(r=>[r.payout.date,r.status]));
 assert.equal(by['2026-11-10'],'short');assert.equal(by['2026-11-11'],'needs_look');assert.equal(by['2026-11-06'],'needs_look');assert.equal(by['2026-11-09'],'matches');
});
test('why is Tuesday short names the refund and highlights it',()=>{
 const a=ask(L,'why is Tuesday\'s payout twelve dollars short?',null,today);
 assert.ok(a.ok);assert.match(a.sentence,/\$12\.00 short because of a \$12\.00 refund to Hana K\. on order O-3103/);
 const hl=a.nodes.filter(n=>n.highlight);assert.equal(hl.length,1);assert.equal(hl[0].kind,'refund');
 assert.deepEqual(a.nodes.map(n=>n.kind),['order','capture','fee','payout','refund','payout']);
});
test('a wrong amount is corrected, not echoed',()=>{
 assert.match(ask(L,'why is Tuesday\'s payout $15 short?',null,today).sentence,/not \$15\.00/);
});
test('unexplained adjustment is flagged honestly',()=>{
 const a=ask(L,'why is yesterday\'s payout short',null,today);assert.match(a.sentence,/cannot explain/);assert.equal(a.status,'needs_look');
});
test('open dispute',()=>{const a=ask(L,'why was Friday\'s deposit less?',null,today);assert.match(a.sentence,/\$38\.20 is held for an open dispute on order O-3106/);});
test('orders in a payout, then follow-ups keep context',()=>{
 const a=ask(L,'which orders are in Tuesday\'s payout?',null,today);assert.equal(a.nodes.filter(n=>n.kind==='order').length,3);
 const b=ask(L,'why is it short?',a.ctx,today);assert.equal(b.payoutId,a.payoutId);
 const c=ask(L,'and the one before?',b.ctx,today);assert.equal(c.intent,'short');assert.match(c.sentence,/Mon Nov 9/);
 const d=ask(L,'what did fees cost me on it?',c.ctx,today);assert.match(d.sentence,/on Monday's payout/);
});
test('fees this week and last week',()=>{
 const a=ask(L,'what did fees cost me this week?',null,today);assert.ok(a.ok);assert.match(a.sentence,/^Fees cost you \$/);assert.equal(a.nodes.find(n=>n.highlight).kind,'fee');
 const b=ask(L,'what about last week?',a.ctx,today);assert.equal(b.intent,'fees');assert.match(b.sentence,/last week/);
});
test('unknown wording needs the model; mapped shapes are recomputed by rules',()=>{
 const odd=ask(L,'thoughts on the vibes',null,today);assert.equal(odd.needsModel,true);
 const slots=mapModelSlots({intent:'short',payout_phrase:'yesterday',range_phrase:'',order_phrase:''},'thoughts',null,L,today);
 assert.match(answer(L,slots,null,today).sentence,/Wed Nov 11/);
 assert.equal(mapModelSlots({intent:'drop tables'},'x',null,L,today),null);
});
test('order trace and missing payout',()=>{
 assert.match(ask(L,'Where did the money from order O-3103 go?',null,today).sentence,/refunded/);
 assert.match(ask(L,'why is Saturday\'s payout short',null,today).sentence,/No payout landed/);
});
