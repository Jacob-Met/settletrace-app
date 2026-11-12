// Simulated demo mode: `node scripts/start-workspace.mjs --demo` (or `npm run demo`).
// Nothing here runs unless that flag is given. It answers the PayPal Sandbox
// reads and the model call with small in-process fakes, serves a tiny
// "Simulated PayPal approval" page for one sample order, and adds a badge.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const DEMO_ORDER_ID = "SIM8F3A9C1D7B5E2046";
const AMOUNT = { currency_code: "USD", value: "64.50" };
const MODEL_URL = "http://127.0.0.1:9/v1/"; // never contacted; the fake answers first
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function createDemo() {
  // The one sample order: a shop customer started a payment, then the shop's server crashed.
  const order = { id: DEMO_ORDER_ID, status: "CREATED", captures: [], updated: new Date().toISOString() };
  const view = () => ({
    id: order.id, status: order.status, intent: "CAPTURE", update_time: order.updated,
    purchase_units: [{ reference_id: "default", description: "Monstera and a pot", amount: AMOUNT, ...(order.captures.length ? { payments: { captures: order.captures } } : {}) }]
  });
  const touch = status => { order.status = status; order.updated = new Date().toISOString(); };

  // Answers PayPal Sandbox reads and the OpenAI-compatible model request.
  async function fetchImpl(url, init = {}) {
    const target = new URL(url), method = init.method ?? "GET";
    if (target.pathname.endsWith("/chat/completions")) return model(JSON.parse(init.body));
    if (target.pathname === "/v1/oauth2/token")
      return json(200, { scope: "https://uri.paypal.com/services/payments/payment", access_token: "SIMULATED-" + randomBytes(12).toString("hex"), token_type: "Bearer", app_id: "SIMULATED-APP", expires_in: 32400, nonce: "simulated" });
    if (method === "GET" && target.pathname === "/v2/checkout/orders/" + order.id) return json(200, view());
    return json(404, { name: "RESOURCE_NOT_FOUND", message: "Simulated PayPal knows one sample order only." });
  }

  // Canned model answer: the same shapes the real model returns.
  async function model(payload) {
    await sleep(1200);
    const system = payload.messages[0].content, user = payload.messages[1].content;
    let content;
    if (system.includes('"order"')) {
      // Rank findings before generic next checks, otherwise keep the computed order.
      const { checks } = JSON.parse(user);
      const rank = c => (c.kind === "finding" ? 0 : 1);
      content = JSON.stringify({ order: checks.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c.id) });
    } else {
      content = "The latest order read shows the order status and no completed capture, so no money is recorded as moved [O1]. Do not retry the payment until the order is read again [O1]. If the order is APPROVED, capture it once from your own system and then read it again [O1].";
    }
    return json(200, { id: "simulated", model: "demo-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  }

  const css = "#sim-badge{position:fixed;top:8px;left:50%;transform:translateX(-50%);white-space:nowrap;z-index:2147483647;padding:6px 12px;border-radius:999px;background:#fff3bf;color:#5c4400;border:1px solid #d9a400;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)}#sim-badge a{color:#5c4400;margin-left:8px;font-weight:700}"
    + ".sim-page{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;color:#1a2233;font:16px/1.5 system-ui,sans-serif}.sim-page main{background:#fff;border-radius:12px;padding:28px 32px;max-width:480px;box-shadow:0 6px 24px rgba(0,0,0,.12)}.sim-page h1{margin:0 0 8px;font-size:22px}.sim-page dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px}.sim-page dt{color:#5b6475}.sim-page dd{margin:0;font-weight:600}.sim-page button{margin-top:18px;padding:10px 22px;border:0;border-radius:999px;background:#0070ba;color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer}.sim-page small{display:block;color:#5b6475;margin-top:12px}";
  const report = "From: Marcus Bell\\nSubject: Was I charged?\\n\\nI paid $64.50 for a monstera and a pot, and your site showed an error page. My order reference was " + DEMO_ORDER_ID + ". Please do not charge me twice.";
  const script = "(function(){var b=document.createElement('div');b.id='sim-badge';b.appendChild(document.createTextNode('Simulated demo: no real PayPal call'));"
    + "var a=document.createElement('a');a.href='/demo/paypal';a.target='_blank';a.rel='noopener';a.textContent='Simulated PayPal page';b.appendChild(a);document.body.appendChild(b);"
    + "var text='" + report + "';function fill(){var t=document.getElementById('incident-report');if(t&&!t.value&&!t.dataset.simFilled){t.dataset.simFilled='1';t.value=text;t.dispatchEvent(new Event('input',{bubbles:true}));}}"
    + "new MutationObserver(fill).observe(document.documentElement,{childList:true,subtree:true});fill();})();";

  function page() {
    let action;
    if (order.status === "CREATED") action = '<p>The buyer has not approved this order yet.</p><form method="post" action="/demo/paypal/approve"><button type="submit" id="sim-approve">Approve</button></form>';
    else if (order.status === "APPROVED") action = '<p>Approved by the buyer. Nothing has been captured yet. Capturing is what the shop\'s server should have done before it went down.</p><form method="post" action="/demo/paypal/capture"><button type="submit" id="sim-capture">Capture payment</button></form>';
    else action = "<p>Captured. Go back to SettleTrace and choose Refresh payment to read the order again.</p>";
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated PayPal approval</title><link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head><body class="sim-page"><main><h1>Simulated PayPal approval</h1><p>This page stands in for PayPal in the offline demo. No real payment, account or PayPal server is involved.</p><dl><dt>Order</dt><dd>' + esc(order.id) + "</dd><dt>Item</dt><dd>Monstera and a pot</dd><dt>Amount</dt><dd>" + esc(AMOUNT.value) + " " + AMOUNT.currency_code + "</dd><dt>Status</dt><dd>" + esc(order.status) + "</dd></dl>" + action + '<small><a href="/">Back to SettleTrace</a></small></main></body></html>';
  }

  // Returns true when the request was answered here.
  async function handle(req, res, pathname) {
    const send = (status, type, body, extra = {}) => { res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Content-Security-Policy": PAGE_CSP, "X-Content-Type-Options": "nosniff", ...extra }); res.end(body); return true; };
    if (pathname === "/demo-badge.css" || pathname === "/demo-badge.light.css") return send(200, "text/css; charset=utf-8", css);
    if (pathname === "/demo-badge.js") return send(200, "text/javascript; charset=utf-8", script);
    if (pathname === "/demo/paypal" && req.method === "GET") return send(200, "text/html; charset=utf-8", page());
    if (req.method === "POST" && (pathname === "/demo/paypal/approve" || pathname === "/demo/paypal/capture")) {
      for await (const chunk of req) void chunk;
      if (pathname.endsWith("/approve") && order.status === "CREATED") touch("APPROVED");
      if (pathname.endsWith("/capture") && order.status === "APPROVED") {
        touch("COMPLETED");
        order.captures = [{ id: "SIMCAP" + randomBytes(7).toString("hex").toUpperCase(), status: "COMPLETED", amount: { ...AMOUNT }, final_capture: true }];
      }
      return send(303, "text/plain; charset=utf-8", "", { Location: "/" });
    }
    return false;
  }
  const decorateHtml = bytes => Buffer.from(bytes.toString("utf8").replace("</head>", '<link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head>'));
  return { fetchImpl, handle, decorateHtml };
}

// Options for startServer()/createService().
export function demoOptions({ port }) {
  const demo = createDemo();
  const env = { PORT: String(port), PAYPAL_CLIENT_ID: "simulated", PAYPAL_CLIENT_SECRET: "simulated", AI_BASE_URL: MODEL_URL, AI_MODEL: "demo-model",
    SETTLETRACE_DATA_DIR: mkdtempSync(join(tmpdir(), "settletrace-demo-")) };
  return { env, fetchImpl: demo.fetchImpl, demo, starterCase: false };
}
