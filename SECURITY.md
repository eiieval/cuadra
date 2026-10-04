# Security and governance

Cuadra moves money and produces tax records, so it is designed around one rule: **the AI proposes, a person decides, and every record can be verified.**

## Threat model

| Threat | Control | Where it is tested |
|---|---|---|
| The model invents an invoice, an amount or a payment | The agent can only return proposals. Totals, VAT and Modelo 303 boxes are computed by the engine; the server recomputes and validates every invoice before PayPal sees it. | `scripts/test.js`: the agent proposes and never issues; invalid prices, VAT rates and NIFs are rejected |
| Prompt injection through client names, ledger data or chat history | Ledger context and history are sent as data under a fixed system prompt. Every field is re-shaped server-side to known keys with bounded sizes, and model output is escaped before rendering. | `api/agent.js` keeps only user and assistant turns (8 at most, 800 characters each) and known context fields |
| An issued invoice is altered or deleted afterwards | VeriFactu hash chain: every record hashes its fiscal fields and the previous hash. Corrections are appended as RegistroAnulacion records, never edits. | Tests for altered amounts, deleted records, retargeted or duplicate cancellations; *Tamper test* in the UI |
| A hand-edited ledger file in the MCP server | The chain is verified before every write; tools that write refuse to run on a broken chain. | `scripts/mcp-test.js`: "editing the ledger file is detected", "no new invoice is written on a tampered ledger" |
| One user reads, chases, cancels or marks paid another user's PayPal invoice | Every PayPal invoice and subscription id is bound to the session that created it with an HMAC token, compared in constant time. | 403 tests for status, cancel and subscription |
| Credential leakage | PayPal and Gemini keys live only in server environment variables. Upstream error bodies go to server logs with secrets redacted; users see generic messages. | "a PayPal outage returns a generic error only" |
| Cross-site requests and abuse | Same-origin check, JSON-only POST endpoints, per-IP rate limits, bounded request bodies. | 403, 415 and 429 tests |
| Malicious scripts in the page | Strict Content-Security-Policy with `script-src 'self'`, no third-party scripts, Tailwind compiled at build time, QR library vendored with its integrity verified, `frame-ancestors 'none'`. | `vercel.json`, served by `dev-server.js` too |
| Spreadsheet formula injection in exports | CSV cells starting with `=`, `+`, `-` or `@` are neutralised. | `public/app.js` |
| An MCP client acting without the user | Tools are annotated read-only, idempotent or destructive (`cancel_invoice`), and the server instructs clients to draft before issuing. MCP clients ask the user to approve tool calls. | `scripts/mcp-test.js` checks the annotations |

## Data

- In the web demo, invoices stay in the visitor's browser (`localStorage`). Nothing is stored on the server.
- The MCP server keeps its ledger in a local JSON file (`~/.cuadra/ledger.json` by default), written atomically with owner-only permissions.
- PayPal holds the invoices and subscriptions it processes, under PayPal's own terms.

## Limits

Cuadra is a demo, not a certified invoicing system. A production deployment adds the VeriFactu electronic signature, submission to the AEAT web service, server-side storage with backups, authentication and an independent security review. Rate limits are per instance and best effort.

## Reporting a vulnerability

Please open a private security advisory on this GitHub repository. Do not include real customer data in reports.
