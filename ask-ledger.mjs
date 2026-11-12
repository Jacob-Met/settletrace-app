// Settlement ledger the question bar reads: orders, captures, fees, refunds, disputes and payouts.
// SettleTrace has no payout feed of its own, so this is a canned sample anchored to the current week.
// To trace real settlements, put a file named ledger.json (same shape) in SETTLETRACE_DATA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shift = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() + n); return x; };
export const feeFor = cents => Math.round(cents * 0.0349) + 49; // 3.49% + $0.49

export function buildSampleLedger(now = new Date()) {
  const today = shift(now, 0);
  const sinceTuesday = (today.getDay() + 5) % 7; // days since the most recent Tuesday
  const A = shift(today, -sinceTuesday); // most recent Tuesday
  const day = n => iso(shift(A, n));
  const spec = [
    { id: 'PO-4411', off: -7, orders: [['O-3101', 'Priya N.', 'Linen duvet cover', 8400, 3], ['O-3102', 'Marcus B.', 'Monstera and a pot', 6450, 2], ['O-3103', 'Hana K.', 'Linen bedding set', 12900, 1]] },
    { id: 'PO-4418', off: -5, orders: [['O-3104', 'Leo S.', 'Ceramic planter', 4200, 2], ['O-3105', 'Amara O.', 'Wool throw', 7625, 1]] },
    { id: 'PO-4421', off: -4, orders: [['O-3106', 'Diego R.', 'Brass lamp', 3820, 3], ['O-3107', 'Sam T.', 'Oak tray', 5500, 2], ['O-3108', 'Ines M.', 'Rug runner', 9140, 1]] },
    { id: 'PO-4430', off: -1, orders: [['O-3109', 'Kofi A.', 'Cotton curtains', 4780, 3], ['O-3110', 'Yuki T.', 'Floor mirror', 11200, 2], ['O-3111', 'Ruth E.', 'Candle set', 2999, 1]] },
    { id: 'PO-4434', off: 0, orders: [['O-3112', 'Nadia P.', 'Side table', 6800, 3], ['O-3113', 'Tom W.', 'Armchair cushion set', 15000, 2], ['O-3114', 'Elena V.', 'Picture frames', 3650, 1]] },
    { id: 'PO-4437', off: 1, orders: [['O-3115', 'Chloe D.', 'Table runner', 5900, 2], ['O-3116', 'Ben H.', 'Glass vase', 4440, 1]] }
  ].filter(p => shift(A, p.off) <= today);
  const orders = [], payouts = [];
  for (const p of spec) {
    const pdate = shift(A, p.off);
    payouts.push({ id: p.id, date: iso(pdate), currency: 'USD', bank: 'Checking ending 4417' });
    for (const [id, buyer, item, gross, before] of p.orders)
      orders.push({ id, buyer, item, gross, fee: feeFor(gross), currency: 'USD', date: iso(shift(pdate, -before)), capture_id: 'CAP-' + id.slice(2) + 'K', payout_id: p.id });
  }
  const has = id => payouts.some(p => p.id === id);
  const refunds = [{ id: 'R-901', order_id: 'O-3103', amount: 1200, date: day(-1), payout_id: 'PO-4434', reason: 'One pillowcase returned, partial refund' }];
  const disputes = [{ id: 'D-77', order_id: 'O-3106', amount: 3820, date: day(-5), payout_id: 'PO-4421', status: 'open', reason: 'Item not received', respond_by: day(5) }];
  const adjustments = has('PO-4437') ? [{ id: 'ADJ-5', amount: 215, date: day(1), payout_id: 'PO-4437', label: 'Adjustment', cause: null }] : [];
  return { sample: true, generated: iso(today), payouts, orders, refunds: refunds.filter(r => has(r.payout_id)), disputes: disputes.filter(r => has(r.payout_id)), adjustments };
}

export async function loadLedger(dataDir, now = new Date()) {
  if (dataDir) {
    try {
      const l = JSON.parse(await fs.readFile(path.join(path.resolve(dataDir), 'ledger.json'), 'utf8'));
      if (Array.isArray(l.payouts) && Array.isArray(l.orders)) return { refunds: [], disputes: [], adjustments: [], ...l, sample: false };
    } catch { /* no ledger file: use the sample */ }
  }
  return buildSampleLedger(now);
}
