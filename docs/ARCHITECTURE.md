# Architecture

Cuadra is a small system on purpose: one isomorphic engine, two thin server functions, one MCP server and a browser app. This page says what each layer does, where the trust boundaries are and what changes when it grows.

```
                 ┌──────────────────────────── browser (public/) ────────────────────────────┐
 you ──────────► │ app.js: state, rendering, events        js/: pure modules, no DOM          │
                 │   chat · proposals · plans              verifactu.js  ─┐                   │
                 │   chain strip · ledger (AG Grid)        ledger.js      ├─ the engine       │
                 │   Insights (AG Charts) · Activity       chain.js · widgets.js · say.js …   │
                 │   localStorage "cuadra-demo-v1…"        share.js · document.js             │
                 └──────────┬──────────────────────┬──────────────────────────────────────────┘
                            │ POST /api/agent      │ POST /api/paypal  (op + HMAC token)
                            ▼                      ▼
                  api/agent.js · lib/agent.js   api/paypal.js · lib/paypal.js
                  re-shapes the context,        validates the invoice again (lib/validate.js),
                  calls the model with tools,   talks to PayPal Invoicing v2 / Subscriptions v1,
                  returns PROPOSALS only        binds every id to the session with an HMAC
                            │                      │
                            ▼                      ▼
                  Gemini (OpenAI-compatible)   PayPal REST (sandbox in the demo)

 MCP client ── stdio ──► mcp/server.js ── same engine, same PayPal client ──► ~/.cuadra/ledger.json
```

## Layers

| Layer | Files | Responsibility | Trusts |
|---|---|---|---|
| Engine | `public/js/verifactu.js`, `public/js/ledger.js` | VeriFactu records (alta, anulación, rectificativa R1), SHA-256 chaining, `verifyChain`, XML, QR URL, derived status, quarter figures, Modelo 303 draft. Pure functions, isomorphic (browser, API, MCP, tests). | nothing outside its inputs |
| Views | `chain.js`, `grid.js`, `widgets.js`, `insights.js`, `proposal.js`, `document.js`, `say.js`, `plan.js`, `activity.js` | Turn records into blocks, rows, charts, paper and sentences. Pure and escaped; no figure is computed anywhere but in the engine. | the engine's output |
| Browser app | `public/app.js`, `public/index.html`, `public/verify.html` | State, events, approvals. Every fiscal or payment action runs from a button the person pressed. | the person |
| API | `api/agent.js`, `api/paypal.js`, `lib/guard.js`, `lib/validate.js` | Same-origin and JSON checks, per-IP rate limits, bounded bodies, re-validation of every invoice, HMAC binding of PayPal ids, generic errors. | nobody: the browser is treated as hostile input |
| Agent | `lib/agent.js`, `lib/llm.js` | Tool calling with a fixed system prompt. The tools only return proposals (`propose_invoice`, `propose_rectify`, `propose_widget`…). | the model is untrusted: its output is whitelisted and cleaned |
| MCP server | `mcp/server.js` | The same engine as 12 tools over stdio, with a file ledger written atomically and verified before every change. | the MCP client's approval prompt |

## Data flow of one invoice

1. The person writes a sentence. The browser sends it with a compact ledger context (`/api/agent`).
2. The model answers with a `propose_invoice` tool call. The server keeps only known tools and cleans the arguments. No amount comes from the model: the paper shows `totals()` of the engine.
3. The person presses "Issue + collect with PayPal". The browser builds the RegistroAlta (`buildAlta`), chains it to the previous hash and stores it.
4. The browser asks `/api/paypal` to create and send the PayPal invoice. The server recomputes the invoice, creates it in PayPal and returns an id with an HMAC token.
5. Statuses come back by polling (`status`); the chain is re-verified on every render. A paid invoice with a mistake is never edited: a corrective invoice (R1) is appended and the original shows as RECTIFIED.

## Boundaries and decisions

- **The ledger is derived data plus a chain.** Paid, overdue, cancelled and rectified are computed from the records (`stateOf`), never stored as truth, so they cannot drift from the chain.
- **One engine, four callers.** The same file runs in the browser, in the serverless functions, in the MCP server and in the tests, which is why the AEAT examples are checked byte for byte in `npm test`.
- **Strict CSP, no new origins.** `script-src 'self'`; Tailwind is compiled; the QR library, AG Grid Community and AG Charts Community are vendored with a SHA-256 in `VERSION.md` and loaded with Subresource Integrity. If a file is blocked, slow or tampered with, the page falls back to plain tables.
- **Optional enhancement, mandatory core.** Charts, grid, tour and terminal replay are enhancements; the engine, chain and ledger work without them.

## How it scales

This is a demo whose ledger lives in the browser, so "scales" means "what we would change", not "what is already done".

| Concern | Demo | Production path |
|---|---|---|
| Storage | `localStorage` per company (browser) or one JSON file (MCP) | A server-side append-only table per issuer (Postgres), one row per record, a unique constraint on `(nif, number)` and on `prevHash`, so the chain cannot fork. The engine stays the same. |
| Concurrency | One writer per browser tab; the MCP server serialises writes | A single writer per issuer chain (row lock or queue); chain verification becomes incremental from the last verified hash. |
| Identity | None: a session HMAC binds PayPal ids to a browser | Accounts, per-company roles (owner, adviser) and an audit trail written by the server. |
| Payment events | Polling, with an optional webhook accelerator (see the README) | Webhook events written to a server ledger that updates invoice status; polling only for reconciliation. |
| Compliance | Records and XML, not signed, not sent | Electronic signature (or the VERI*FACTU online mode) and submission to the AEAT web service, with retry and receipt storage. |
| Model cost | Flash-Lite, roughly 3k tokens in and 300 out per turn (estimate) | Same; the context is bounded (40 invoices) and the model never sees secrets. Cost is linear in turns, not in invoices. |
| Compute | Static files plus two small functions | Stateless functions scale horizontally; the only shared state is the database. |

## What is deliberately not here

No electronic signature, no submission to the AEAT, no server-side ledger in the web demo, no user accounts, and the XML structure follows the published AEAT schema without being validated against the XSD. See [COMPLIANCE.md](COMPLIANCE.md).
