# Security and governance

Cuadra moves money and produces tax records, so it is designed around one rule: **the AI proposes, a person decides, and every record can be verified.**

## The demo has no accounts

Anyone who opens the page can use it: there are no logins, no users and no server-side ownership of an invoice. What a visitor can do is therefore bounded, not authenticated. The mitigations, all server-side and all tested in `scripts/test.js`:

- **No free text reaches PayPal.** The note on a PayPal invoice is written by the server: a fixed sentence plus the AEAT verification link of the record. The client only sends that link, and it is accepted only when it is exactly the link of the invoice being sent (valid NIF, same number, date and total recomputed on the server), so a sent invoice cannot carry a message of the caller's choosing.
- **Only this site's page can mutate.** `create_and_send`, `remind`, `cancel`, `record_payment` and `subscribe` require `Sec-Fetch-Site: same-origin` (or `none`) and, when an `Origin` is present, that it matches the request host. curl and scripts do not send that header and get a 403.
- **The visitor's address is the platform's, not the client's.** On Vercel the limits use `x-real-ip` / `x-vercel-forwarded-for`; elsewhere the last hop of `x-forwarded-for` (the one the proxy appended), never the first. A spoofed `X-Forwarded-For` no longer gives a fresh budget.
- **Caps.** Sending an invoice through PayPal: 10 per IP per hour and 300 per day per instance. Agent calls (the model costs money): 20 per IP per 10 minutes and 2,000 per day per instance. Over a cap the user gets a clear, generic message (429).
- **Limits are per instance and in memory**, best effort: a cold start or a second instance starts from zero. A production deployment needs accounts, a shared store for the counters and per-account quotas.
- Each PayPal invoice still carries an HMAC token issued to the browser that created it; only that token can read, remind or cancel it.

## Threat model

| Threat | Control | Where it is tested |
|---|---|---|
| The model invents an invoice, an amount or a payment | The agent can only return proposals. Totals, VAT and Modelo 303 boxes are computed by the engine; the server recomputes and validates every invoice before PayPal sees it. An Insight (chart, table or figure) is only a specification (type, metric, grouping, period) that the server cleans to known values; every number in it is computed in the browser from the ledger (`widgetData`). | `scripts/test.js`: the agent proposes and never issues; invalid prices, VAT rates and NIFs are rejected; widget specifications come back clean. `scripts/ui-test.js`: widget figures equal the KPIs and the Modelo 303 boxes |
| Prompt injection through client names, ledger data or chat history | Ledger context and history are sent as data under a fixed system prompt. Every field is re-shaped server-side to known keys with bounded sizes, and model output is escaped before rendering. | `shapeHistory` keeps only user and assistant turns (8 at most, 800 characters each); test "history keeps user/assistant turns only" |
| An issued invoice is altered or deleted afterwards | VeriFactu hash chain: every record hashes its fiscal fields and the previous hash. Corrections are appended as RegistroAnulacion records, never edits. | Tests for altered amounts, deleted records, retargeted or duplicate cancellations; *Tamper test* in the UI |
| A hand-edited ledger file in the MCP server | The chain is verified before every write; tools that write refuse to run on a broken chain. | `scripts/mcp-test.js`: "editing the ledger file is detected", "no new invoice is written on a tampered ledger" |
| One user reads, chases, cancels or marks paid another user's PayPal invoice | Every PayPal invoice and subscription id carries an HMAC token issued to the browser that created it, compared in constant time; only that token can read, remind or cancel it. | 403 tests for status, cancel and subscription |
| Credential leakage | PayPal and Gemini keys live only in server environment variables. Upstream error bodies go to server logs with secrets redacted; users see generic messages. | "a PayPal outage returns a generic error only" |
| Cross-site requests and abuse | Same-origin check, `Sec-Fetch-Site` for every mutating PayPal operation, JSON-only POST endpoints, per-IP rate limits from a trustworthy address plus daily caps (see above), bounded request bodies, no client-written text on PayPal invoices. | 403, 415 and 429 tests, spoofed `X-Forwarded-For`, cap tests |
| Malicious scripts in the page | Strict Content-Security-Policy with `script-src 'self'`, no third-party scripts, Tailwind compiled at build time, QR library, AG Grid and AG Charts vendored with their integrity verified, `frame-ancestors 'none'`. | `vercel.json`, served by `dev-server.js` too |
| A vendored library is swapped or tampered with | Files live in `public/vendor/<lib>/` with version, license and SHA-256 in `VERSION.md`; the page loads them with a Subresource Integrity attribute (the browser refuses a changed file and the plain table stays); the CSP gained no origin. | `scripts/test.js` recomputes the hashes; `scripts/shots.js` serves a tampered file and checks that nothing breaks |
| Spreadsheet formula injection in exports | CSV cells starting with `=`, `+`, `-` or `@` are neutralised. | `public/app.js` |
| A crafted verification link tries to inject HTML, a hostile URL or a decompression bomb | `verify.html` rebuilds the record from the URL fragment with strict types and sizes (16 KB, inflated size capped), escapes every field, rebuilds the AEAT QR from the hashed fields instead of trusting the link, and only encodes a payer link that is a PayPal URL. It never calls a server. | `scripts/ui-test.js`: "link:" and "document:" checks, including a 5 MB inflate bomb and a `__proto__` key |
| A shared verification link leaks more than the document | Only a whitelist of the record's fields travels, in the fragment, which browsers never send to a server: no PayPal token, no client email. | `scripts/ui-test.js`: "no PayPal token, no client email and no precomputed QR travel in the link" |
| An MCP client acting without the user | Tools are annotated read-only, idempotent or destructive (`cancel_invoice`), and the server instructs clients to draft before issuing. MCP clients ask the user to approve tool calls. | `scripts/mcp-test.js` checks the annotations |

## Data

- In the web demo, invoices stay in the visitor's browser (`localStorage`). Nothing is stored on the server.
- The MCP server keeps its ledger in a local JSON file (`~/.cuadra/ledger.json` by default), written atomically with owner-only permissions.
- PayPal holds the invoices and subscriptions it processes, under PayPal's own terms.

## Limits

Cuadra is a demo, not a certified invoicing system. A production deployment adds the VeriFactu electronic signature, submission to the AEAT web service, server-side storage with backups, authentication and an independent security review. Rate limits are per instance and best effort.

## Reporting a vulnerability

Please open a private security advisory on this GitHub repository. Do not include real customer data in reports.
