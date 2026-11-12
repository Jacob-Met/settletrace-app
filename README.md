# SettleTrace

Diagnose before you retry.

SettleTrace is a local incident workbench for developers and support engineers who take PayPal payments. When a checkout fails halfway and a customer asks "was I charged?", it reads what PayPal actually recorded and lays it out as evidence, so nobody re-runs a payment on a guess.

## Try the simulated demo

No PayPal account and no local AI model are needed.

```sh
npm run demo        # or: sh ./run-unix.sh --demo
# open http://127.0.0.1:4179
```

1. Choose **Inspect payment**, open **Find evidence in a report**: a sample customer email is already filled in. Choose **Find identifiers**, then **Use order ID in inspection**, then **Inspect order**. The order is CREATED with no capture.
2. Open the **Simulated PayPal page** link in the yellow badge (or `/demo/paypal`) and press **Approve**. You return to SettleTrace; choose **Refresh payment** and see the order read as APPROVED, still with no capture.
3. Under **Next step**, choose **Prioritize checks**. A canned ranking orders the computed checks.
4. Open the simulated PayPal page again and press **Capture payment** (what the shop's server would do), return, and choose **Refresh payment**. The trace now shows the order COMPLETED with one capture.

A yellow badge reads "Simulated demo: no real PayPal call". The PayPal Sandbox reads (OAuth and show order details) and the AI ranking are answered by small in-process fakes in `demo-mode.mjs` for one sample order; the demo journal is stored in a temporary folder. SettleTrace itself still only reads: the approve and capture buttons belong to the simulated PayPal page. The real PayPal Sandbox and model setup is described below.

## Ask about payouts

Open **Payouts** in the header (or `/#payouts`). The home view lists recent payouts, each marked **Matches**, **Short** or **Needs a look**. Type or speak a question: "why is Tuesday's payout twelve dollars short?", "which orders are in this payout?", "what did fees cost me this week?". The answer is a tappable trace (order, capture, fee, refund or dispute, payout) with the step that explains it highlighted and one sentence on top. Follow-ups such as "and the one before?" keep the context.

Common question shapes are parsed by rules and computed from the ledger, with no model. Only unusual wording is sent to the local model, which names the shape and nothing more. Voice is recorded in the browser and sent to a local speech-to-text service (`SETTLETRACE_STT_URL`, default `http://127.0.0.1:5621/listen`); typing always works. SettleTrace has no payout feed of its own, so the demo uses a sample ledger anchored to the current week; put a `ledger.json` (same shape as `ask-ledger.mjs` builds) in `SETTLETRACE_DATA_DIR` to trace your own.

## What it does

- **Find the reference.** Paste a customer email or support ticket; SettleTrace picks out order, capture, refund and event IDs.
- **Read the payment.** One click reads the order from PayPal and saves the response: status, amount, captures and refunds.
- **See the trace.** API reads and webhook events sit on one timeline. Verified, unverified and imported sources are kept apart.
- **Know what is established.** A deterministic review states what the saved evidence does and does not show, for example that buyer approval alone is not a completed capture.
- **Share it.** Export an investigation as a JSON file a teammate can open in their own workspace.

SettleTrace only reads. It never creates, captures or refunds a payment.

## How it uses AI

Optionally, a language model ranks which check to do first. The model receives checks that were already computed from saved evidence and may only return their order; wording and source references stay as computed. Its output is labelled advisory.

Any OpenAI-compatible chat completions endpoint works. It was built and tested with `qwen2.5:7b` served by Ollama.

## How it uses PayPal

All calls go to the PayPal REST API in **Sandbox**:

- OAuth 2 client credentials, held on the server only
- Orders v2: show order details
- Payments v2: show captured payment details and show refund details
- Webhooks: receive events at `POST /api/webhooks/ingest` and check them with verify webhook signature
- Notifications: read event records

## Run it

Requires Node.js 22 or newer. There are no npm dependencies.

Explore the bundled example (no accounts needed):

```sh
sh ./run-unix.sh        # Windows: run-windows.cmd
# open http://127.0.0.1:4179
```

Read real Sandbox payments and enable the model:

```sh
export PAYPAL_CLIENT_ID="your sandbox client id"
export PAYPAL_CLIENT_SECRET="your sandbox client secret"
export PAYPAL_WEBHOOK_ID="your sandbox webhook id"      # optional, for signature checks
export AI_BASE_URL="http://127.0.0.1:11434/v1/"         # optional
export AI_MODEL="qwen2.5:7b"                            # optional
export AI_API_KEY="only if your endpoint needs one"     # optional
export SETTLETRACE_DATA_DIR="$HOME/.local/share/settletrace"
export PORT=4179

sh ./run-unix.sh
```

Create Sandbox credentials at <https://developer.paypal.com/dashboard/applications/sandbox>. The journal in `SETTLETRACE_DATA_DIR` can contain customer details from webhooks; keep it private.

## A two-minute walkthrough

1. Choose **Inspect payment**, open **Find evidence in a report** and paste a message that contains an order ID. Choose **Find identifiers**, then **Use order ID in inspection**.
2. Choose **Inspect order**. The header shows the amount and state; **Captures**, **Events** and **Reads** count what has been observed.
3. Under **Next step**, read the review, then choose **Prioritize checks** to have the model order them.
4. Fix the payment in your own system, then choose **Refresh payment**. The new read appears beside the old one in the trace.
5. Choose **Share** to export the investigation.

## Tests

```sh
npm test
```

## Limits

A local, single-operator tool. It listens on loopback and has no sign-in. It is fixed to PayPal Sandbox.

## License

MIT. See [LICENSE](LICENSE). Source: <https://github.com/Jacob-Met/settletrace-app>

## Light and dark mode

The interface follows the system colour scheme, and the round button in the bottom-right corner switches between light and dark. The second colour sheet is generated from the first with `tools/retheme.py`, so the two always share the same layout.
