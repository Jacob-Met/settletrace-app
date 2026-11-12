// Deterministic question parser and tracer for payouts. No model is involved here:
// common question shapes are parsed with rules and answered by computing from the ledger.
// A local model may only translate unusual wording into the same slots (see mapModelSlots).

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export const money = (cents, cur = 'USD') => (cents < 0 ? '-' : '') + (cur === 'USD' ? '$' : cur + ' ') + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const toISO = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
export const dayLabel = s => { const d = parseISO(s); return DAYS[d.getDay()].slice(0, 3).replace(/^./, c => c.toUpperCase()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); };
const dayName = s => DAYS[parseISO(s).getDay()].replace(/^./, c => c.toUpperCase());

// "twelve dollars", "$12", "12.50" -> cents, or null.
export function parseAmount(text) {
  const t = String(text).toLowerCase();
  let m = t.match(/\$\s*(\d+(?:\.\d{1,2})?)/) || t.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd)/);
  if (m) return Math.round(parseFloat(m[1]) * 100);
  m = t.match(/\b(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](one|two|three|four|five|six|seven|eight|nine))?|(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))\s+(?:dollars?|bucks)/);
  if (m) return (m[3] ? ONES[m[3]] : TENS[m[1]] + (m[2] ? ONES[m[2]] : 0)) * 100;
  return null;
}

// ---- Ledger arithmetic ------------------------------------------------------------------
export function payoutFigures(L, payoutId) {
  const orders = L.orders.filter(o => o.payout_id === payoutId);
  const refunds = L.refunds.filter(r => r.payout_id === payoutId);
  const disputes = L.disputes.filter(r => r.payout_id === payoutId);
  const adjustments = L.adjustments.filter(r => r.payout_id === payoutId);
  const gross = orders.reduce((a, o) => a + o.gross, 0), fees = orders.reduce((a, o) => a + o.fee, 0);
  const expected = gross - fees;
  const taken = refunds.reduce((a, r) => a + r.amount, 0) + disputes.reduce((a, r) => a + r.amount, 0) + adjustments.reduce((a, r) => a + r.amount, 0);
  const unexplained = adjustments.filter(a => !a.cause).reduce((s, a) => s + a.amount, 0);
  const openDispute = disputes.some(d => d.status === 'open');
  const actual = expected - taken, shortfall = expected - actual;
  const status = shortfall === 0 ? 'matches' : (unexplained > 0 || openDispute ? 'needs_look' : 'short');
  return { orders, refunds, disputes, adjustments, gross, fees, expected, actual, shortfall, unexplained, status };
}
export const STATUS_LABEL = { matches: 'Matches', short: 'Short', needs_look: 'Needs a look' };
const sortedPayouts = L => [...L.payouts].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
export function payoutRows(L) { return sortedPayouts(L).reverse().map(p => ({ payout: p, ...payoutFigures(L, p.id) })); }

// ---- Slot parsing -----------------------------------------------------------------------
export function parseRange(text, today) {
  const t = String(text).toLowerCase();
  const dow = (parseISO(today).getDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  if (/\blast week\b|\bprevious week\b/.test(t)) return { from: addDays(monday, -7), to: addDays(monday, -1), label: 'last week' };
  if (/\bpast (week|7 days)\b|\blast 7 days\b|\bseven days\b/.test(t)) return { from: addDays(today, -6), to: today, label: 'the past 7 days' };
  if (/\bthis week\b/.test(t)) return { from: monday, to: today, label: 'this week' };
  if (/\blast month\b/.test(t)) { const d = parseISO(today); const f = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12), e = new Date(d.getFullYear(), d.getMonth(), 0, 12); return { from: toISO(f), to: toISO(e), label: 'last month' }; }
  if (/\bthis month\b/.test(t)) { const d = parseISO(today); return { from: toISO(new Date(d.getFullYear(), d.getMonth(), 1, 12)), to: today, label: 'this month' }; }
  if (/\bto ?day\b/.test(t) && !/payout|deposit/.test(t)) return { from: today, to: today, label: 'today' };
  return null;
}

function weekdayOf(t) {
  const full = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/);
  if (full) return DAYS.indexOf(full[1]);
  const ab = t.match(/\b(sun|mon|tues?|wed|thur?s?|fri|sat)\b/);
  return ab ? DAY_ABBR[ab[1]] : null;
}

export function parsePayoutRef(text, today) {
  const t = String(text).toLowerCase();
  const id = String(text).match(/\bPO-\d{3,6}\b/i);
  if (id) return { type: 'id', id: id[0].toUpperCase() };
  if (/\b(the )?(one )?(before|previous|prior|earlier)\b/.test(t) && !/\blast week\b/.test(t)) return { type: 'prev' };
  if (/\b(the )?(one )?(after|next|following|later)\b/.test(t)) return { type: 'next' };
  if (/\byesterday/.test(t)) return { type: 'date', date: addDays(today, -1) };
  const wd = weekdayOf(t);
  if (wd !== null) {
    let back = (parseISO(today).getDay() - wd + 7) % 7;
    if (back === 0 && /\blast\b/.test(t)) back = 7;
    return { type: 'date', date: addDays(today, -back) };
  }
  const nth = t.match(/\b(?:the )?(\d{1,2})(?:st|nd|rd|th)\b/);
  if (nth) { const d = parseISO(today); let c = new Date(d.getFullYear(), d.getMonth(), +nth[1], 12); if (c > d) c = new Date(d.getFullYear(), d.getMonth() - 1, +nth[1], 12); return { type: 'date', date: toISO(c) }; }
  if (/\b(latest|last|most recent|newest|recent|current)\b/.test(t) && /payout|deposit|transfer|settlement|one\b/.test(t)) return { type: 'latest' };
  if (/\b(it|that|this|those|same)\b/.test(t) && /\b(payout|deposit|transfer|one|it|that)\b/.test(t) && !/\bthis (week|month)\b/.test(t)) return { type: 'this' };
  return null;
}

const ORDER_RE = /\bO-\d{4,6}\b/i;
function parseOrderRef(text, L) {
  const m = String(text).match(ORDER_RE);
  if (m) return m[0].toUpperCase();
  const t = String(text).toLowerCase();
  for (const o of L.orders) { const first = o.buyer.toLowerCase().replace(/\.$/, '').split(' ')[0]; if (first.length > 2 && new RegExp('\\b' + first + '\\b').test(t)) return o.id; }
  return null;
}

export function detectIntent(text) {
  const t = String(text).toLowerCase();
  const payoutWord = /payouts?|deposits?|transfers?|settlements?|paid out|paycheck/.test(t);
  if (ORDER_RE.test(text) || /where did .*(order|sale|money from)|trace .*order|what happened to .*order/.test(t)) return 'order';
  if (/\bfees?\b|cost me|commission|took off|charged me|processing/.test(t)) return 'fees';
  if (/\b(short|less|missing|lower|light|smaller|under|off by|gone|wrong|discrepanc|differ|mismatch|stiffed)\b|(?:does|do|did)n'?t (match|add)|not (match|add)|why .*(low|small)|where.*(money|rest|difference)/.test(t) || (/^\s*why\b/.test(t) && payoutWord)) return 'short';
  if (/\bwhich\b.*\borders?\b|\bwhat\b.*\borders?\b|\borders?\b.*\b(in|inside|part of|included|behind)\b|made up|what('s| is| was) in|contain|break ?down|include/.test(t)) return 'orders';
  if (/\brefunds?\b|\brefunded\b|gave back/.test(t)) return 'refunds';
  if (/\bdisputes?\b|chargebacks?|claims?\b/.test(t)) return 'disputes';
  if (/\b(show|list|all|recent|my)\b.*\b(payouts?|deposits?|transfers?)\b|\bpayouts?\b\s*\??$/.test(t)) return 'list';
  return null;
}

// Turns a question plus the previous answer's context into slots, or {needsModel:true}.
export function parseQuestion(text, ctx, L, today) {
  const q = String(text ?? '').trim().slice(0, 400);
  if (!q) return { empty: true };
  let intent = detectIntent(q);
  const payoutRef = parsePayoutRef(q, today), range = parseRange(q, today), order = parseOrderRef(q, L);
  const amount = parseAmount(q);
  if (!intent && ctx?.intent && (payoutRef || range || order)) intent = ctx.intent === 'order' && !order ? 'orders' : ctx.intent;
  if (!intent && order) intent = 'order';
  if (!intent) return { needsModel: true, q };
  return { intent, payoutRef, range, order, amount, q };
}

// Model output -> slots. The model only names the shape; every value is re-parsed by the rules above.
export const MODEL_INTENTS = ['short', 'orders', 'fees', 'refunds', 'disputes', 'order', 'list'];
export function mapModelSlots(mapped, q, ctx, L, today) {
  if (!mapped || !MODEL_INTENTS.includes(mapped.intent)) return null;
  const payoutText = String(mapped.payout_phrase ?? ''), rangeText = String(mapped.range_phrase ?? ''), orderText = String(mapped.order_phrase ?? '');
  return { intent: mapped.intent, payoutRef: parsePayoutRef(payoutText, today) ?? parsePayoutRef(q, today), range: parseRange(rangeText, today) ?? parseRange(q, today), order: parseOrderRef(orderText, L) ?? parseOrderRef(q, L), amount: parseAmount(q), q, viaModel: true };
}

// ---- Resolving a payout reference --------------------------------------------------------
function resolvePayout(L, ref, ctx, intent) {
  const list = sortedPayouts(L);
  if (!list.length) return { error: 'There are no payouts in the ledger yet.' };
  const latest = list.at(-1);
  if (!ref) {
    if (ctx?.payoutId && list.some(p => p.id === ctx.payoutId) && intent !== 'short') return { payout: list.find(p => p.id === ctx.payoutId) };
    if (intent === 'short') { const bad = [...list].reverse().find(p => payoutFigures(L, p.id).shortfall !== 0); return { payout: bad ?? latest }; }
    return { payout: ctx?.payoutId ? list.find(p => p.id === ctx.payoutId) ?? latest : latest };
  }
  if (ref.type === 'latest') return { payout: latest };
  if (ref.type === 'id') { const p = list.find(x => x.id === ref.id); return p ? { payout: p } : { error: 'I do not see a payout ' + ref.id + '.' }; }
  if (ref.type === 'this') { const p = list.find(x => x.id === ctx?.payoutId) ?? latest; return { payout: p }; }
  if (ref.type === 'prev' || ref.type === 'next') {
    const base = list.findIndex(x => x.id === (ctx?.payoutId ?? latest.id)), i = base + (ref.type === 'prev' ? -1 : 1);
    return list[i] ? { payout: list[i] } : { error: ref.type === 'prev' ? 'That is the earliest payout I have.' : 'That is the most recent payout.' };
  }
  const exact = list.filter(p => p.date === ref.date);
  if (exact.length) return { payout: exact.at(-1) };
  return { error: 'No payout landed on ' + dayLabel(ref.date) + '. Payouts I have: ' + list.slice(-5).map(p => dayLabel(p.date)).join(', ') + '.' };
}

// ---- Node builders -----------------------------------------------------------------------
const orderOf = (L, id) => L.orders.find(o => o.id === id);
const payoutOf = (L, id) => L.payouts.find(p => p.id === id);
function node(kind, title, sub, amount, extra = {}) { return { kind, title, sub, amount, ...extra }; }

function orderNodes(L, o) {
  const nodes = [
    node('order', 'Order ' + o.id, o.buyer + ' · ' + o.item, o.gross, { date: o.date, detail: [['Buyer', o.buyer], ['Item', o.item], ['Placed', dayLabel(o.date)], ['Order total', money(o.gross, o.currency)]], action: { label: 'Trace this order', ask: 'Where did the money from order ' + o.id + ' go?' } }),
    node('capture', 'Captured', o.capture_id, o.gross, { date: o.date, detail: [['Capture', o.capture_id], ['Captured', money(o.gross, o.currency)], ['On', dayLabel(o.date)]] }),
    node('fee', 'PayPal fee', '3.49% + $0.49', -o.fee, { detail: [['Fee', money(o.fee, o.currency)], ['Net after fee', money(o.gross - o.fee, o.currency)]] })
  ];
  return nodes;
}
function payoutNode(L, p, extra = {}) {
  const f = payoutFigures(L, p.id);
  return node('payout', 'Payout ' + p.id, dayLabel(p.date) + ' · ' + p.bank, f.actual, { status: f.status, date: p.date, payoutId: p.id, detail: [['Expected from sales', money(f.expected)], ['Deposited', money(f.actual)], ['Difference', money(-f.shortfall)], ['Orders', String(f.orders.length)]], action: { label: 'Open this payout', ask: 'Which orders are in payout ' + p.id + '?' }, ...extra });
}
function refundNode(r, o, hl) { return node('refund', 'Refund ' + r.id, dayLabel(r.date) + ' · ' + (r.reason || 'Refund'), -r.amount, { highlight: hl, detail: [['Refund', money(r.amount)], ['To', o?.buyer ?? ''], ['Order', r.order_id], ['Issued', dayLabel(r.date)], ['Reason', r.reason ?? ''], ['Taken from', r.payout_id]] }); }
function disputeNode(d, o, hl) { return node('dispute', 'Dispute ' + d.id, (d.status === 'open' ? 'Open' : d.status) + ' · ' + d.reason, -d.amount, { highlight: hl, detail: [['Held', money(d.amount)], ['Buyer', o?.buyer ?? ''], ['Order', d.order_id], ['Opened', dayLabel(d.date)], ['Reason', d.reason], ['Status', d.status], ...(d.respond_by ? [['Respond by', dayLabel(d.respond_by)]] : [])] }); }
function adjustmentNode(a, hl) { return node('adjustment', a.label || 'Adjustment', a.cause ? a.cause : 'No order or reason attached', -a.amount, { highlight: hl, unknown: !a.cause, detail: [['Amount', money(a.amount)], ['Date', dayLabel(a.date)], ['Reason on record', a.cause || 'none']] }); }

// Full chain for one order: order -> capture -> fee -> (earlier payout) -> refund/dispute -> payout.
function orderChain(L, o, { highlightKind = null, focusPayoutId = null } = {}) {
  const nodes = orderNodes(L, o);
  const home = payoutOf(L, o.payout_id);
  const rs = L.refunds.filter(r => r.order_id === o.id), ds = L.disputes.filter(d => d.order_id === o.id);
  const later = [...rs.map(r => ({ d: r.date, n: refundNode(r, o, highlightKind === 'refund' && r.payout_id === focusPayoutId), pid: r.payout_id })), ...ds.map(d => ({ d: d.date, n: disputeNode(d, o, highlightKind === 'dispute' && d.payout_id === focusPayoutId), pid: d.payout_id }))].sort((a, b) => a.d.localeCompare(b.d));
  const settledHere = !later.some(x => x.pid !== o.payout_id);
  if (settledHere && later.length === 0) nodes.push(payoutNode(L, home, { highlight: highlightKind === 'payout' }));
  else {
    // disputes held in the same payout come before it; refunds taken from a later payout come after the original payout
    const before = later.filter(x => x.pid === o.payout_id), after = later.filter(x => x.pid !== o.payout_id);
    before.forEach(x => nodes.push(x.n));
    nodes.push(payoutNode(L, home, { highlight: highlightKind === 'payout' && focusPayoutId === home.id }));
    for (const x of after) { nodes.push(x.n); const tp = payoutOf(L, x.pid); if (tp) nodes.push(payoutNode(L, tp, { highlight: highlightKind === 'payout' && focusPayoutId === tp.id })); }
  }
  return nodes;
}

// ---- Answers -----------------------------------------------------------------------------
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const pname = p => dayName(p.date) + "'s payout (" + dayLabel(p.date) + ')';
const nextCtx = (slots, extra) => ({ intent: slots.intent, ...extra });
const CHIPS = {
  short: ['Which orders are in it?', 'What did fees cost me on it?', 'And the one before?'],
  orders: ['Why is it short?', 'What did fees cost me on it?', 'And the one before?'],
  fees: ['What did fees cost me last week?', 'Which orders are in the latest payout?', 'Show refunds this week'],
  refunds: ['Why is Tuesday’s payout short?', 'What did fees cost me this week?'],
  disputes: ['Which orders are in the latest payout?', 'What did fees cost me this week?'],
  order: ['Which orders are in that payout?', 'Why is the latest payout short?'],
  list: ['Why is Tuesday’s payout short?', 'What did fees cost me this week?', 'Which orders are in the latest payout?']
};

function answerShort(L, slots, ctx) {
  const r = resolvePayout(L, slots.payoutRef, ctx, 'short'); if (r.error) return fail(r.error);
  const p = r.payout, f = payoutFigures(L, p.id), name = pname(p);
  const lead = slots.amount != null && f.shortfall > 0 && slots.amount !== f.shortfall ? 'It is ' + money(f.shortfall) + ' short, not ' + money(slots.amount) + '. ' : '';
  if (f.shortfall === 0) {
    const nodes = [node('orders', plural(f.orders.length, 'order'), money(f.gross) + ' captured', f.gross, { detail: f.orders.map(o => [o.id + ' ' + o.buyer, money(o.gross)]) }), node('fee', 'PayPal fees', f.orders.length + ' captures', -f.fees, { detail: f.orders.map(o => [o.id, money(-o.fee)]) }), payoutNode(L, p, { highlight: true })];
    return done({ sentence: lead + name + ' is not short: ' + money(f.actual) + ' arrived, which is exactly the ' + plural(f.orders.length, 'order') + ' (' + money(f.gross) + ') minus ' + money(f.fees) + ' in fees.', status: 'matches', nodes, payoutId: p.id, ctx: nextCtx(slots, { payoutId: p.id }) });
  }
  const parts = [...f.refunds.map(x => ({ t: 'refund', x, amt: x.amount })), ...f.disputes.map(x => ({ t: 'dispute', x, amt: x.amount })), ...f.adjustments.map(x => ({ t: 'adjustment', x, amt: x.amount }))].sort((a, b) => b.amt - a.amt);
  const lead1 = parts[0];
  let nodes, sentence;
  const others = parts.slice(1);
  const short = money(f.shortfall);
  if (lead1.t === 'adjustment') {
    const a = lead1.x;
    nodes = [node('orders', plural(f.orders.length, 'order'), money(f.gross) + ' captured', f.gross, { detail: f.orders.map(o => [o.id + ' ' + o.buyer, money(o.gross)]) }), node('fee', 'PayPal fees', f.orders.length + ' captures', -f.fees, { detail: f.orders.map(o => [o.id, money(-o.fee)]) }), adjustmentNode(a, true), payoutNode(L, p)];
    sentence = lead + name + ' is ' + short + ' short. ' + (a.cause ? 'PayPal lists ' + a.cause + '.' : 'PayPal took ' + money(a.amount) + ' as an adjustment with no order or reason attached, so I cannot explain it from the records. This one needs a look.');
  } else {
    const o = orderOf(L, lead1.x.order_id);
    nodes = orderChain(L, o, { highlightKind: lead1.t, focusPayoutId: p.id });
    if (lead1.t === 'refund') sentence = lead + name + ' is ' + short + ' short because of a ' + money(lead1.x.amount) + ' refund to ' + o.buyer + ' on order ' + o.id + ' (' + dayLabel(lead1.x.date) + '), taken out of this payout.';
    else sentence = lead + name + ' is ' + short + ' short because ' + money(lead1.x.amount) + ' is held for ' + (lead1.x.status === 'open' ? 'an open ' : 'a ') + 'dispute on order ' + o.id + ' (' + o.buyer + ', "' + lead1.x.reason.toLowerCase() + '")' + (lead1.x.respond_by ? '. Respond by ' + dayLabel(lead1.x.respond_by) + ' to get it back.' : '.');
  }
  if (others.length) sentence += ' ' + plural(others.length, 'other deduction') + ' also apply.';
  const status = f.status;
  return done({ sentence, status, nodes, payoutId: p.id, ctx: nextCtx(slots, { payoutId: p.id, orderId: lead1.x.order_id }) });
}

function answerOrders(L, slots, ctx) {
  const r = resolvePayout(L, slots.payoutRef, ctx, 'orders'); if (r.error) return fail(r.error);
  const p = r.payout, f = payoutFigures(L, p.id);
  const nodes = f.orders.map(o => node('order', o.id + ' · ' + o.buyer, o.item + ' · fee ' + money(o.fee), o.gross, { date: o.date, orderId: o.id, detail: [['Placed', dayLabel(o.date)], ['Order total', money(o.gross)], ['Fee', money(-o.fee)], ['Net', money(o.gross - o.fee)], ['Capture', o.capture_id]], action: { label: 'Trace this order', ask: 'Where did the money from order ' + o.id + ' go?' } }));
  nodes.push(node('fee', 'PayPal fees', plural(f.orders.length, 'capture'), -f.fees, { detail: f.orders.map(o => [o.id, money(-o.fee)]) }));
  f.refunds.forEach(x => nodes.push(refundNode(x, orderOf(L, x.order_id), false)));
  f.disputes.forEach(x => nodes.push(disputeNode(x, orderOf(L, x.order_id), false)));
  f.adjustments.forEach(x => nodes.push(adjustmentNode(x, false)));
  nodes.push(payoutNode(L, p, { highlight: true }));
  const deduct = f.shortfall ? ' After ' + money(f.shortfall) + ' of deductions, ' + money(f.actual) + ' was deposited.' : ' ' + money(f.actual) + ' was deposited after fees.';
  return done({ sentence: pname(p).replace(/^./, c => c.toUpperCase()) + ' holds ' + plural(f.orders.length, 'order') + ' worth ' + money(f.gross) + ' (' + f.orders.map(o => o.id).join(', ') + ').' + deduct, status: f.status, nodes, payoutId: p.id, ctx: nextCtx(slots, { payoutId: p.id }) });
}

function inRange(date, range) { return date >= range.from && date <= range.to; }
function answerFees(L, slots, ctx, today) {
  let orders, label, payoutId = null, range = slots.range;
  if (!range && !slots.payoutRef && ctx?.range && !ctx.payoutId) range = ctx.range;
  if (slots.payoutRef || (!range && ctx?.payoutId && L.payouts.some(p => p.id === ctx.payoutId))) {
    const r = resolvePayout(L, slots.payoutRef, ctx, 'fees'); if (r.error) return fail(r.error);
    orders = payoutFigures(L, r.payout.id).orders; label = 'on ' + pname(r.payout); payoutId = r.payout.id;
  } else {
    range = range ?? parseRange('this week', today);
    orders = L.orders.filter(o => inRange(o.date, range)); label = range.label;
  }
  if (!orders.length) return done({ sentence: 'I do not see any captured orders ' + label + ', so no fees.', nodes: [], ctx: nextCtx(slots, { range: slots.range }), status: null });
  const gross = orders.reduce((a, o) => a + o.gross, 0), fees = orders.reduce((a, o) => a + o.fee, 0);
  const pids = [...new Set(orders.map(o => o.payout_id))];
  const pct = (fees / gross * 100).toFixed(1);
  const nodes = [
    node('orders', plural(orders.length, 'order'), 'placed ' + (payoutId ? 'in this payout' : label), gross, { detail: orders.map(o => [o.id + ' ' + o.buyer, money(o.gross)]) }),
    node('capture', 'Captured', plural(orders.length, 'capture'), gross, { detail: orders.map(o => [o.capture_id, money(o.gross)]) }),
    node('fee', 'PayPal fees', pct + '% of sales', -fees, { highlight: true, detail: [...orders.map(o => [o.id + ' ' + o.buyer, money(-o.fee)]), ['Total', money(-fees)]] }),
    node('net', 'Kept after fees', money(gross - fees) + ' of ' + money(gross), gross - fees, { detail: [['Sales', money(gross)], ['Fees', money(-fees)]] })
  ];
  let extra = '';
  if (!payoutId && range) { const span = (parseISO(range.to) - parseISO(range.from)) / 864e5 + 1; const prev = { from: addDays(range.from, -span), to: addDays(range.from, -1) }; const pf = L.orders.filter(o => inRange(o.date, prev)).reduce((a, o) => a + o.fee, 0); if (pf) extra = ' The period before it cost ' + money(pf) + '.'; }
  for (const id of pids.slice(0, 4)) nodes.push(payoutNode(L, payoutOf(L, id)));
  return done({ sentence: 'Fees cost you ' + money(fees) + ' ' + label + ', ' + pct + '% of ' + money(gross) + ' across ' + plural(orders.length, 'order') + '.' + extra, status: null, nodes, payoutId, ctx: nextCtx(slots, { payoutId, range: payoutId ? null : range }) });
}

function answerDeductions(L, slots, ctx, today, kind) {
  const range = slots.range ?? (slots.payoutRef ? null : parseRange('this week', today));
  let payoutId = null;
  if (!range) { const r = resolvePayout(L, slots.payoutRef, ctx, kind); if (r.error) return fail(r.error); payoutId = r.payout.id; }
  const all = kind === 'refunds' ? L.refunds : L.disputes;
  const rows = payoutId ? all.filter(x => x.payout_id === payoutId) : all.filter(x => inRange(x.date, range));
  const label = payoutId ? 'on ' + pname(payoutOf(L, payoutId)) : range.label, noun = kind === 'refunds' ? 'refund' : 'dispute';
  if (!rows.length) return done({ sentence: 'No ' + noun + 's ' + label + '.', nodes: [], status: null, ctx: nextCtx(slots, { payoutId }) });
  const total = rows.reduce((a, x) => a + x.amount, 0), big = [...rows].sort((a, b) => b.amount - a.amount)[0];
  const o = orderOf(L, big.order_id);
  const nodes = orderChain(L, o, { highlightKind: kind === 'refunds' ? 'refund' : 'dispute', focusPayoutId: big.payout_id });
  return done({ sentence: plural(rows.length, noun) + ' ' + label + ' totalling ' + money(total) + '. ' + (rows.length > 1 ? 'The largest is ' : 'It is ') + money(big.amount) + ' on order ' + big.order_id + ' (' + o.buyer + '), taken from ' + pname(payoutOf(L, big.payout_id)) + '.', status: null, nodes, payoutId: big.payout_id, ctx: nextCtx(slots, { payoutId: big.payout_id, orderId: big.order_id }) });
}

function answerOrder(L, slots, ctx) {
  const id = slots.order ?? ctx?.orderId; const o = id && orderOf(L, id);
  if (!o) return fail('I do not see that order. Orders I have: ' + L.orders.slice(-6).map(x => x.id).join(', ') + '.');
  const rs = L.refunds.filter(r => r.order_id === o.id), ds = L.disputes.filter(d => d.order_id === o.id);
  const home = payoutOf(L, o.payout_id);
  const last = [...rs, ...ds].sort((a, b) => b.date.localeCompare(a.date))[0];
  const nodes = orderChain(L, o, { highlightKind: 'payout', focusPayoutId: last ? last.payout_id : o.payout_id });
  let s = 'Order ' + o.id + ' (' + o.buyer + ', ' + money(o.gross) + '): PayPal kept ' + money(o.fee) + ', ' + money(o.gross - o.fee) + ' went out in ' + dayName(home.date) + "'s payout (" + dayLabel(home.date) + ')';
  for (const r of rs) s += '; then ' + money(r.amount) + ' was refunded and taken from ' + dayName(payoutOf(L, r.payout_id).date) + "'s payout";
  for (const d of ds) s += '; ' + money(d.amount) + ' is held for a ' + d.status + ' dispute';
  return done({ sentence: s + '.', status: null, nodes, payoutId: last ? last.payout_id : o.payout_id, ctx: nextCtx(slots, { orderId: o.id, payoutId: last ? last.payout_id : o.payout_id }) });
}

function answerList(L, slots) {
  const rows = payoutRows(L); const c = k => rows.filter(r => r.status === k).length;
  return done({ sentence: plural(rows.length, 'payout') + ' recently: ' + c('matches') + ' match, ' + c('short') + ' short, ' + c('needs_look') + ' need a look.', status: null, nodes: [], list: true, ctx: nextCtx(slots, {}) });
}

const fail = message => ({ ok: false, sentence: message, nodes: [] });
function done(r) { return { ok: true, ...r }; }

export function answer(L, slots, ctx, today) {
  if (slots.empty) return fail('Ask about a payout, for example: why is Tuesday’s payout short?');
  let a;
  switch (slots.intent) {
    case 'short': a = answerShort(L, slots, ctx); break;
    case 'orders': a = answerOrders(L, slots, ctx); break;
    case 'fees': a = answerFees(L, slots, ctx, today); break;
    case 'refunds': a = answerDeductions(L, slots, ctx, today, 'refunds'); break;
    case 'disputes': a = answerDeductions(L, slots, ctx, today, 'disputes'); break;
    case 'order': a = answerOrder(L, slots, ctx); break;
    case 'list': a = answerList(L, slots); break;
    default: a = fail('I could not tell what to look up.');
  }
  a.intent = slots.intent; a.chips = CHIPS[slots.intent] ?? CHIPS.list; a.viaModel = !!slots.viaModel;
  nodesIds(a); return a;
}
function nodesIds(a) { (a.nodes ?? []).forEach((n, i) => { n.id = 'n' + i; }); }

export function ask(L, text, ctx, today) {
  const slots = parseQuestion(text, ctx, L, today);
  if (slots.needsModel) return { needsModel: true, q: slots.q };
  return answer(L, slots, ctx, today);
}
