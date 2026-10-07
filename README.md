# Cuadra

**The AI invoicing agent for PayPal merchants. Describe the sale, confirm, get paid, stay compliant.**

Small businesses lose hours writing invoices, chasing late payers and preparing their quarterly VAT, and in Spain the rules are changing: from 1 January 2027 for companies and 1 July 2027 for the self-employed, every invoicing system must produce **VeriFactu** records, tamper-evident and verifiable by the tax agency. Software that does not comply can be fined up to €50,000 a year.

Cuadra turns a sentence into a compliant invoice, collects it with PayPal, chases whoever has not paid and drafts the quarterly VAT return. The same engine is an **MCP server**, so any AI agent can invoice and get paid through it.

## What it does

| | You say | Cuadra does |
|---|---|---|
| **Invoice** | "Invoice Acme Studio SL for 3 hours of consulting at €60" | Drafts the invoice, reuses the client's NIF and email from earlier invoices, checks the NIF and the VAT rate, and waits for your confirmation. |
| **Comply** | (on confirm) | Issues a VeriFactu record: SHA-256 hash chained to the previous record, AEAT verification QR and RegistroAlta XML. |
| **Collect** | (on confirm) | Sends a PayPal invoice that carries the tax-agency verification link. Status and payments sync back. |
| **Chase** | "Chase every overdue invoice" | One proposal per late invoice: a PayPal reminder if it is on PayPal, or a PayPal invoice if the client still owes you by transfer. |
| **Reconcile** | "Hotel Mirador paid by bank transfer" | Finds the invoice and records the payment, in PayPal too. |
| **Correct** | "Annul the duplicate invoice" | Cancels it in PayPal and appends a VeriFactu cancellation record (RegistroAnulacion). Nothing is ever edited or deleted. Paid invoices are refused: they need a corrective invoice. |
| **Declare** | "Prepare my VAT return" | Modelo 303 draft for the quarter that is due (boxes 01–09 and 27) with the days left to file, computed from the ledger, never by the model. |
| **Ask the ledger** | "Who owes me money?", "Revenue by client this quarter" | Proposes a chart, a table or a single figure (an **Insight**) that you can pin to the Insights board. The agent only picks what to show; the browser computes every number from the ledger. |
| **Delegate** | Any MCP client | Claude, ChatGPT, Cursor or your own agent can do all of the above through the Cuadra MCP server. |

The app opens on a sample quarter (paid, overdue and open invoices plus one cancelled duplicate), so every feature can be tried in the first minute, and a four-step tour (the **?** button, or `?tour=1`) walks through it.

## What you see

The signature of the product is **the living chain**: the book that proves itself.

- **The chain.** A strip of linked blocks, one per record (invoice or cancellation) with its number, amount and the first six hex of its hash. It is re-verified, with a short sweep from left to right, every time the ledger changes. **Tamper test** alters one issued amount in memory: that block turns red with a broken link ("stored hash ≠ recomputed hash"), every block after it turns grey ("not verifiable"), the ledger marks the record as altered, and undoing it heals the chain. A new invoice drops into the chain when you approve it, its ledger row lights up, and a toast gives the hash.
- **Proposals as paper.** The agent answers with a small invoice document (issuer, client, lines, base, VAT, total, due date) and the buttons to issue it. Under it, **Engine checks**: client matched from the ledger or new, NIF checksum, VAT rate, totals, due date. They are computed in the browser from the proposal, never by the model.
- **Insights board.** Between the KPIs and the ledger: up to six pinned widgets, three by default (invoiced vs collected by month, who still owes what, receivables aging), each an [AG Charts Community](https://charts.ag-grid.com/) chart (MIT, self-hosted) with its figures, **Export CSV** and a remove button; the board collapses and is saved with the ledger. Ask "Who owes me money?" or "Revenue by client this quarter" and the agent answers with an **Insight card** in the chat: a preview of the chart, the engine's figure and **Pin to board**. `public/js/widgets.js` (`widgetData`) computes the dataset from the ledger and its statuses, so the model never writes an amount; the figures agree with the KPIs and the Modelo 303 draft (tests compare them box by box). Without the charts file (blocked, slow, tampered, or throwing) every card shows a table with the same figures. On a phone the board is a row of cards you swipe through.
- **A sentence that is always true.** Some models (Gemini Flash-Lite) answer with proposals and no text. The server flags it and the browser writes the sentence itself from the proposals and the ledger, in English or Spanish: "Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)", "Plan to close the quarter: 1 reminder, 2 collections with PayPal and your VAT draft.", "Here is who owes you money: 3 open invoices, 2006,40 €". Every figure in it is the engine's (`public/js/say.js`), never the model's.
- **Plans.** A reply with two or more actions becomes a checklist ("Plan · 4 steps", "2 of 3 done"). Each step is approved on its own; only reminders and collections can be approved together, never invoices, payments or cancellations. **"Close my quarter"** (or "Cierra el trimestre") builds one: reminders for overdue invoices that are on PayPal, collections for the rest, and the VAT draft.
- **Activity.** An append-only log of who did what (agent proposed, you approved, the engine issued, PayPal sent, you tampered), last 500 entries, exportable as JSON from the ⋯ menu.
- **A document you can send.** The invoice document is bilingual ("Factura / Invoice") with two QR codes: Verify at AEAT and, when the invoice is on PayPal, Pay with PayPal. **Copy verification link** and **Open printable** open `verify.html`: the record travels in the URL fragment (never sent to a server), is re-hashed in the client's browser and shown as "✓ This document matches its hash" or "✗ Altered", ready to print or save as PDF.
- **The ledger is an AG Grid.** From 768 px up the invoice table is [AG Grid Community](https://www.ag-grid.com/) (MIT, self-hosted): sort by any column, a quick text filter, status chips with counts (All, Open, Overdue, Paid, Cancelled), a pinned totals row that adds up the rows you are looking at (it agrees with the KPIs), cancellation records as shorter rows ("↳ Cancels CU-0006"), the full hash in a tooltip, keyboard access to the row buttons and CSV export through the grid's own API (the rows you see, in the register format, formula-safe). The theme is built with the Theming API from the same `:root` tokens as the rest of the app. The grid is loaded after the first render and only on wide screens; if its file does not arrive in 3 seconds, fails the integrity check or throws, the plain HTML table stays, with every feature, and nothing is shown to the user.
- **On a phone** the agent opens from a floating "Ask Cuadra" button as a full-screen sheet, the ledger rows become cards and the chain scrolls sideways.

## How it works

```
                      ┌────────────── browser ──────────────┐
 "Invoice Acme…" ───► │ chat · ledger · VAT card · pricing  │
                      │ VeriFactu engine (WebCrypto SHA-256)│◄── verifies the chain on every render
                      └──────┬──────────────────┬───────────┘
                             │ /api/agent       │ /api/paypal (HMAC-bound to the session)
                             ▼                  ▼
            Gemini tool calling          PayPal REST
            proposals only:              Invoicing v2: create · send · status · remind · cancel · payments
            invoice · reminder · collect Subscriptions v1: Cuadra's own plans
            mark paid · cancel · VAT     OAuth 2.0 client credentials (server-side only)
            insight (chart specification only: the browser draws it and computes the figures)

 MCP client (Claude, ChatGPT…) ──stdio──► mcp/server.js ──► same engine + PayPal client ──► ~/.cuadra/ledger.json
```

- **The model proposes, the user decides.** The agent can only return proposals. Every fiscal or payment action needs a click in the UI, or the approval prompt of the MCP client.
- **Numbers never come from the model.** Totals, VAT breakdowns and the Modelo 303 boxes are computed by the engine; the server recomputes and validates every invoice before PayPal sees it.
- **One isomorphic engine.** `public/js/verifactu.js` and `public/js/ledger.js` run unchanged in the browser, in the API and in the MCP server.

### Data model

Every record lives in one append-only array, the hash chain. Two kinds of record:

| Record | Hashed fields (AEAT order) | Other fields |
|---|---|---|
| `RegistroAlta` (invoice) | `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`, `ImporteTotal`, previous `Huella`, `FechaHoraHusoGenRegistro` | recipient, lines, VAT breakdown, QR URL, due date, PayPal id and status, payment date |
| `RegistroAnulacion` (`kind: "anulacion"`) | `IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`, `FechaExpedicionFacturaAnulada`, previous `Huella`, `FechaHoraHusoGenRegistro` | reason |

`verifyChain` checks that each record links to the previous hash, rehashes to itself, matches its invoice lines, and that a cancellation points to an earlier, not yet cancelled invoice. Status (paid, overdue, cancelled) is derived from the records, never stored as truth. In the web demo the ledger is kept in the browser; the MCP server keeps it in a JSON file written atomically and verified before every change.

### VeriFactu details

- The invoice hash and the cancellation hash both reproduce the **official AEAT examples byte for byte** (`npm test`).
- QR URLs follow the AEAT verification service format (test environment in the demo).
- XML follows the `SuministroInformacion` schema: `RegistroAlta` with `Desglose` per rate (0% lines as exempt operations, `E1`), `RegistroAnulacion`, `Encadenamiento` and `SistemaInformatico`.
- Not done here: the electronic signature and submission to the AEAT web service, which a certified deployment adds.

## Cuadra for AI agents (MCP)

`mcp/server.js` is a zero-dependency MCP server over stdio. Add it to any MCP client:

```json
{
  "mcpServers": {
    "cuadra": {
      "command": "node",
      "args": ["/path/to/cuadra/mcp/server.js"],
      "env": {
        "CUADRA_NAME": "Estudio Norte SL", "CUADRA_NIF": "B76543214",
        "PAYPAL_CLIENT_ID": "…", "PAYPAL_CLIENT_SECRET": "…"
      }
    }
  }
}
```

| Tool | What it does | Annotations |
|---|---|---|
| `draft_invoice` | Validates and totals an invoice, issues nothing | read-only |
| `issue_invoice` | Appends a RegistroAlta and sends it with PayPal | |
| `list_invoices` | Invoices with status, due date, PayPal link; summary and known clients | read-only |
| `sync_paypal` | Refreshes PayPal statuses of open invoices | idempotent |
| `collect_with_paypal` | Sends an issued invoice through PayPal | |
| `send_reminder` | PayPal payment reminder | |
| `record_payment` | Marks a transfer or cash payment, in PayPal too | idempotent |
| `cancel_invoice` | PayPal cancel + RegistroAnulacion | destructive |
| `rectify_invoice` | Corrective invoice (R1, substitution) for a paid invoice: a new chained record, the original is never edited | |
| `vat_return` | Modelo 303 draft and days to the deadline | read-only |
| `verify_ledger` | Checks the whole hash chain | read-only |
| `export_verifactu_xml` | RegistroAlta / RegistroAnulacion XML | read-only |

The server tells the client to draft before issuing and never to compute VAT figures itself. If the ledger file is edited by hand, `verify_ledger` reports where, and every tool that writes refuses to run.

### Agentic commerce, on the record

`npm run mcp:demo` (`scripts/mcp-demo.js`, no dependencies, no network, no keys) starts the MCP server over stdio in mock mode (PayPal in memory, a throwaway ledger) and plays the session an agent needs to invoice and get paid: `initialize` → `tools/list` → `draft_invoice` → `issue_invoice` with `collect_with_paypal: true` → `list_invoices` → `verify_ledger`. It prints every JSON-RPC line and saves the conversation to `public/mcp-transcript.json`: protocol messages only, no absolute paths, no environment variables, mock PayPal ids (`npm test` checks the six methods and that nothing from the machine is in the file). The page replays it line by line in a terminal next to the Claude Desktop configuration (Replay button; with reduced motion it appears at once). The step where the agent issues and collects, as the page shows it (long values are cut with an ellipsis):

```text
# 4 · The user approves the draft. Claude issues the VeriFactu record and collects with PayPal
→ {
    "jsonrpc": "2.0", "id": 4, "method": "tools/call",
    "params": {
      "name": "issue_invoice",
      "arguments": {
        "recipient": { "name": "Acme Studio SL", "nif": "B12345674", "email": "billing@acme.example" },
        "lines": [{ "description": "Consulting", "qty": 3, "price": 60, "vat": 21 }],
        "due_days": 15,
        "collect_with_paypal": true
      }
    }
  }
← {
    "jsonrpc": "2.0", "id": 4,
    "result": {
      "structuredContent": {
        "issued": {
          "number": "CU2026-0001", "date": "2026-10-06", "client": "Acme Studio SL", "nif": "B12345674",
          "base": "180.00", "vat": "37.80", "total": "217.80", "status": "SENT", "due": "2026-10-21",
          "paypal": { "id": "INV2-MOCK-0001", "status": "SENT", "payerUrl": "https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0…" },
          "hash": "CF168E62097DB1FF17521613B14EB2B5F56BDCFCCCE2DC99056D2…",
          "verifyUrl": "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=…"
        },
        "paypalError": null
      },
      "isError": false
    }
  }
```

The agent never types a total: `draft_invoice` computes it, `issue_invoice` appends the hash-chained record and creates and sends the PayPal invoice, `verify_ledger` proves the chain still verifies. Your MCP client asks you to approve each call, and `cancel_invoice` is annotated as destructive.

## PayPal integration

| PayPal API | Used for |
|---|---|
| OAuth 2.0 client credentials | Server-side token, cached until expiry. Credentials never reach the browser. |
| Invoicing v2 `POST /invoices`, `/send` | Issue and deliver the invoice, with the VeriFactu verification link in the note |
| Invoicing v2 `GET /invoices/{id}` | Status, payer page and paid amount |
| Invoicing v2 `/remind` | Payment reminders from the collections agent |
| Invoicing v2 `/cancel` | Cancellation paired with the VeriFactu RegistroAnulacion |
| Invoicing v2 `/payments` | Record a bank transfer or cash payment so PayPal and the ledger agree |
| Catalog Products v1, Billing Plans v1 | Cuadra's own Autónomo and Gestoría plans (`npm run paypal:setup`) |
| Subscriptions v1 | Subscribe from the pricing section; status checked on return |

## Business model

| Plan | Price | For |
|---|---|---|
| Free | €0 | 10 invoices a month, VeriFactu records, PayPal collection, AI agent with fair use |
| Autónomo | €9 / month + VAT | Unlimited invoices, collections agent, Modelo 303 draft, MCP access |
| Gestoría | €29 / month + VAT | Up to 10 companies (NIFs), accountant access and exports |

- **Market.** More than 3 million self-employed workers and over a million companies in Spain must use VeriFactu-compliant software by July 2027. Many invoice from spreadsheets or Word today.
- **Why they pay.** Compliance becomes mandatory and the fines are large; getting paid faster is the reason they keep paying. Cuadra never takes a cut of payments.
- **Unit economics (estimates).** An agent turn is about 3k input and 300 output tokens on Gemini Flash-Lite, well under €0.001. PayPal's fee on a €9 subscription is roughly €0.60. Hosting is static files plus two small functions. Gross margin stays around 90%.
- **Distribution.** PayPal merchants in Spain, gestorías that resell to their clients, and AI agents that need a compliant way to bill (MCP).

## Security and governance

- Human in the loop for every fiscal or payment action; the agent only proposes.
- PayPal and Gemini credentials live only in server environment variables.
- Every PayPal invoice and subscription is bound to the browser session that created it with an HMAC token: nobody can read, chase, cancel or mark paid another session's invoices.
- Server-side validation of every invoice: Spanish VAT rates only, valid NIF/CIF/NIE, bounded quantities and prices, totals recomputed.
- Strict Content-Security-Policy, no third-party scripts: Tailwind is compiled; the QR library, AG Grid Community and AG Charts Community are vendored from the npm registry (`public/vendor/<lib>/VERSION.md` records version, license and SHA-256), `npm test` recomputes their hashes, and the page inserts them with a Subresource Integrity attribute, so a modified file is refused and the fallback takes over.
- Same-origin checks, JSON-only endpoints, per-IP rate limits, bounded request bodies, generic user-facing errors and redacted server logs.
- Model output is escaped before rendering; ledger data and chat history are passed to the model as data, never as instructions.
- CSV exports are protected against formula injection.
- Verification links carry only a whitelist of the record's fields (no PayPal token, no client email) in the URL fragment, which browsers never send. The page rebuilds the record with strict types and sizes (16 KB, inflate capped), recomputes the hash, rebuilds the AEAT QR from the hashed fields and encodes a payer link only if it is a PayPal URL. It makes no network request.
- No new origins: the Content-Security-Policy is unchanged (`script-src 'self'`, fonts only from Google Fonts), and a test pins it.

## Run it

```bash
cp .env.example .env    # GEMINI_API_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (Sandbox)
npm test                # offline: engine, AEAT examples, ledger, API security, MCP, chain, share links, activity, design tokens
npm run dev             # http://localhost:3000
MOCK=1 npm run dev      # no keys at all: deterministic agent and in-memory PayPal
npm run paypal:setup    # once: creates the subscription plans, prints PAYPAL_PLAN_PRO / PAYPAL_PLAN_TEAM
npm run build:css       # recompile public/styles.css after touching styles/ or the markup (needs network once)
npm run shots           # screenshots at 1280 and 390 px plus visual and behaviour checks (MOCK=1, needs Playwright in ../ops/video)
npm run social          # re-render public/og.png and public/icon-180.png from docs/og.html and favicon.svg
npm run mcp             # the MCP server on stdio
npm run mcp:demo        # play an agent session against it offline and save public/mcp-transcript.json
```

No dependencies to install: Node 20 or later is enough.

**Deploy.** Vercel serves `public/` and the functions in `api/` as is (`vercel.json` sets the security headers). Render uses `render.yaml`: `npm test` gates the build, `npm start` serves the app, and `/api/health` is the health check.

```
api/        agent.js · paypal.js · health.js       serverless functions
lib/        agent, LLM client, PayPal client, validation, request guard
public/     index.html · verify.html · app.js · verify.js · vendor/ (QR, AG Grid, AG Charts, each with VERSION.md)
  js/       verifactu.js · ledger.js (engine) · chain.js · checks.js · plan.js · proposal.js · document.js · share.js
            activity.js · tour.js · fmt.js · qr.js · terminal.js (MCP replay) · status.js · grid.js (ledger grid) · widgets.js + insights.js (Ask the ledger) · say.js (the agent's sentence) · vendor.js (lazy loader + SRI)
styles/     input.css (design tokens and components) → public/styles.css via Tailwind
docs/       og.html (source of public/og.png)
mcp/        server.js                                MCP server (stdio)
scripts/    test.js · ui-test.js · mcp-test.js · shots.js · social-card.js · paypal-setup.js · mcp-demo.js
```

## Status

Demo on PayPal Sandbox and the AEAT test verification service. Not a certified invoicing system: a production deployment adds the electronic signature, submission to the AEAT and server-side storage. Vendored libraries: qrcode-generator 1.4.4, AG Grid Community 36.2.0 and AG Charts Community 14.2.0, all MIT.

## License

MIT
