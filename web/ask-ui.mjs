// Question bar, answer trace and recent payouts. Answers come from ask-engine.mjs (rules, no model).
// The local model is only asked to name the question shape when the rules cannot (/api/ask/map).
import { ask, answer, mapModelSlots, payoutRows, money, dayLabel, STATUS_LABEL } from './ask-engine.mjs';

const $ = id => document.getElementById(id);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KIND = { order: 'Order', orders: 'Orders', capture: 'Capture', fee: 'Fee', refund: 'Refund', dispute: 'Dispute', payout: 'Payout', adjustment: 'Adjustment', net: 'Net' };
const MARK = { matches: '✓', short: '−', needs_look: '!' };
const EXAMPLES = ['Why is Tuesday’s payout twelve dollars short?', 'Which orders are in the latest payout?', 'What did fees cost me this week?'];

let ledger = null, today = null, ctx = null, busy = false, recorder = null;

async function api(path, method = 'GET', data) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(j.error || 'Request failed'), { status: r.status });
  return j;
}
const status = (t, kind) => { const s = $('ask-status'); s.textContent = t || ''; s.dataset.kind = kind || ''; };

function setMode(mode, push = true) {
  document.body.dataset.mode = mode;
  if (push) try { history.replaceState(null, '', mode === 'payouts' ? '#payouts' : location.pathname + location.search); } catch { /* ignore */ }
  $('open-payouts')?.setAttribute('aria-pressed', String(mode === 'payouts'));
  if (mode === 'payouts') renderHome();
}

function pill(statusKey, text) {
  const p = h('span', 'ask-pill ask-pill-' + statusKey);
  p.append(h('span', 'ask-pill-mark', MARK[statusKey]), document.createTextNode(text ?? STATUS_LABEL[statusKey]));
  return p;
}

function renderHome() {
  const box = $('payout-list'); box.replaceChildren();
  if (!ledger) return;
  const rows = payoutRows(ledger);
  const count = k => rows.filter(r => r.status === k).length;
  $('payout-summary').textContent = rows.length + ' recent payouts: ' + count('matches') + ' match, ' + count('short') + ' short, ' + count('needs_look') + ' need a look';
  $('sample-note').hidden = !ledger.sample;
  for (const r of rows) {
    const b = h('button', 'payout-card payout-' + r.status); b.type = 'button'; b.dataset.payout = r.payout.id;
    const top = h('div', 'payout-top');
    top.append(h('span', 'payout-date', dayLabel(r.payout.date)), pill(r.status, r.status === 'matches' ? 'Matches' : (r.status === 'short' ? 'Short ' + money(r.shortfall) : 'Needs a look · ' + money(r.shortfall))));
    const mid = h('div', 'payout-amount', money(r.actual, r.payout.currency));
    const sub = h('div', 'payout-sub', r.orders.length + ' orders · fees ' + money(r.fees) + ' · ' + r.payout.id);
    b.append(top, mid, sub);
    b.addEventListener('click', () => submit(r.status === 'matches' ? 'Which orders are in payout ' + r.payout.id + '?' : 'Why is payout ' + r.payout.id + ' short?', { fromCard: true }));
    box.append(b);
  }
}

function renderContext() {
  const c = $('ask-context'); c.replaceChildren();
  const p = ctx?.payoutId && ledger?.payouts.find(x => x.id === ctx.payoutId);
  c.hidden = !p;
  $('ask-input').placeholder = p ? 'Ask a follow-up, for example: and the one before?' : 'Ask: why is Tuesday’s payout short?';
  if (!p) return;
  const x = h('button', 'ask-context-clear'); x.type = 'button'; x.setAttribute('aria-label', 'Forget this payout and start a new question'); x.textContent = '✕';
  x.addEventListener('click', () => { ctx = null; renderContext(); renderChips(EXAMPLES); });
  c.append(h('span', null, 'Talking about ' + p.id + ' · ' + dayLabel(p.date)), x);
}
function renderChips(list) {
  const box = $('ask-chips'); box.replaceChildren();
  for (const q of list) { const b = h('button', 'ask-chip', q); b.type = 'button'; b.addEventListener('click', () => submit(q)); box.append(b); }
}

function renderAnswer(q, a) {
  const box = $('ask-answer'); box.hidden = false; box.replaceChildren();
  box.dataset.ok = String(a.ok);
  box.append(h('p', 'ask-q', q));
  const head = h('div', 'ask-sentence-row');
  head.append(h('h2', 'ask-sentence', a.sentence));
  box.append(head);
  const meta = h('div', 'ask-meta');
  if (a.status) meta.append(pill(a.status));
  if (a.viaModel) meta.append(h('span', 'ask-tag', 'Wording matched by the local model; numbers computed from the ledger'));
  if (meta.childNodes.length) box.append(meta);
  if (a.nodes?.length) {
    const flow = h('ol', 'flow'); flow.id = 'ask-flow';
    let pick = a.nodes.findIndex(n => n.highlight);
    a.nodes.forEach((n, i) => {
      const li = h('li', 'step step-' + n.kind + (n.highlight ? ' hl' : '') + (n.unknown ? ' unknown' : ''));
      const b = h('button', 'step-btn'); b.type = 'button'; b.setAttribute('aria-expanded', 'false'); b.dataset.node = n.id;
      b.append(h('span', 'step-kind', KIND[n.kind] ?? n.kind));
      b.append(h('span', 'step-title', n.title));
      b.append(h('span', 'step-sub', n.sub ?? ''));
      if (n.amount != null) b.append(h('span', 'step-amount' + (n.amount < 0 ? ' neg' : ''), (n.amount > 0 && n.kind !== 'order' && n.kind !== 'orders' ? '+' : '') + money(n.amount)));
      if (n.highlight) b.append(h('span', 'step-flag', a.intent === 'short' || a.intent === 'order' || a.intent === 'refunds' || a.intent === 'disputes' ? 'Explains it' : 'The answer'));
      const d = h('div', 'step-detail'); d.hidden = true;
      const dl = h('dl');
      for (const [k, v] of n.detail ?? []) { if (v === '' || v == null) continue; dl.append(h('dt', null, k), h('dd', null, v)); }
      d.append(dl);
      if (n.action) { const act = h('button', 'text-button step-action', n.action.label); act.type = 'button'; act.addEventListener('click', () => submit(n.action.ask)); d.append(act); }
      b.addEventListener('click', () => {
        const open = d.hidden;
        flow.querySelectorAll('.step-detail').forEach(x => { x.hidden = true; }); flow.querySelectorAll('.step-btn').forEach(x => x.setAttribute('aria-expanded', 'false')); flow.querySelectorAll('.step').forEach(x => x.classList.remove('sel'));
        if (open) { d.hidden = false; b.setAttribute('aria-expanded', 'true'); li.classList.add('sel'); }
      });
      li.append(b, d); flow.append(li);
      if (i === pick) queueMicrotask(() => b.click());
    });
    box.append(flow);
  }
  if (a.list) { /* the payout list below is the answer */ }
  renderChips(a.chips ?? EXAMPLES);
}

async function submit(text, opts = {}) {
  const q = String(text ?? '').trim();
  if (!q || busy) return;
  if (!ledger) { status('The ledger has not loaded yet.', 'error'); return; }
  busy = true; $('ask-send').disabled = true; $('ask-input').value = opts.fromCard ? '' : q;
  setMode('payouts');
  status('');
  try {
    let a = ask(ledger, q, ctx, today);
    if (a.needsModel) {
      status('Working out what you mean…', 'busy');
      let mapped = null;
      try { mapped = (await api('/api/ask/map', 'POST', { question: q, context: ctx ? { intent: ctx.intent, payout: ctx.payoutId } : null })).mapped; } catch (e) { status(e.status === 503 ? 'That wording is outside what I can read without the local model, and it is not running. Try one of these.' : 'I could not read that. Try one of these.', 'error'); }
      const slots = mapped && mapModelSlots(mapped, q, ctx, ledger, today);
      a = slots ? answer(ledger, slots, ctx, today) : { ok: false, sentence: 'I did not catch what to look up. You can ask why a payout is short, which orders are in it, or what fees cost.', nodes: [], chips: EXAMPLES };
      if (slots) status('');
    }
    if (a.ok && a.ctx) ctx = a.ctx;
    renderAnswer(q, a); renderContext();
    $('ask-answer').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } finally { busy = false; $('ask-send').disabled = false; if (!opts.fromCard) $('ask-input').value = ''; }
}

// ---- Voice: record in the browser, transcribe with the local speech-to-text service via the server.
function wireMic() {
  const mic = $('ask-mic');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { mic.disabled = true; mic.title = 'Voice needs a browser with microphone recording. Type instead.'; return; }
  mic.addEventListener('click', async () => {
    if (recorder) { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [], rec = new MediaRecorder(stream);
      recorder = rec; mic.classList.add('rec'); mic.setAttribute('aria-pressed', 'true'); status('Listening… tap the mic again when you are done.', 'busy');
      const stop = setTimeout(() => rec.state === 'recording' && rec.stop(), 15000);
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        clearTimeout(stop); stream.getTracks().forEach(t => t.stop()); recorder = null; mic.classList.remove('rec'); mic.setAttribute('aria-pressed', 'false');
        if (!chunks.length) { status('I did not hear anything.', 'error'); return; }
        status('Turning speech into text…', 'busy');
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const r = await fetch('/api/ask/listen', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw Error(j.error || 'Speech to text failed');
          if (!j.text) { status('I could not make out any words. Try again or type.', 'error'); return; }
          $('ask-input').value = j.text; status('Heard: “' + j.text + '”', ''); submit(j.text);
        } catch (e) { status(e.message + ' You can type the question instead.', 'error'); }
      };
      rec.start();
    } catch { status('Microphone is not available here. Type the question instead.', 'error'); }
  });
}

async function init() {
  $('ask-form').addEventListener('submit', e => { e.preventDefault(); submit($('ask-input').value); });
  $('open-payouts').addEventListener('click', () => setMode(document.body.dataset.mode === 'payouts' ? 'investigations' : 'payouts'));
  for (const sel of ['#orders', '#sample', '#open-first-investigation', '#open-inspector']) document.querySelector(sel)?.addEventListener('click', () => { if (document.body.dataset.mode === 'payouts') setMode('investigations'); });
  $('inspect-form')?.addEventListener('submit', () => setMode('investigations'));
  $('back-to-investigations')?.addEventListener('click', () => setMode('investigations'));
  renderChips(EXAMPLES); wireMic();
  try { const j = await api('/api/ask/ledger'); ledger = j.ledger; today = j.today; } catch (e) { status('Payout data could not load: ' + e.message, 'error'); }
  setMode(location.hash === '#payouts' ? 'payouts' : 'investigations', false);
  window.addEventListener('hashchange', () => setMode(location.hash === '#payouts' ? 'payouts' : 'investigations', false));
  window.__ask = { ask: submit };
}
init();
