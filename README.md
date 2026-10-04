# Cuadra

**The AI invoicing agent for PayPal merchants. Describe the sale, confirm, get paid, stay compliant.**

Small businesses lose hours on invoices, chasing payments and new e-invoicing rules. In Spain, every invoicing system must produce VeriFactu records from 2027: tamper-evident, hash-chained and verifiable by the tax agency. Cuadra turns a sentence into a compliant invoice and collects it with PayPal.

## What it does

1. **Ask.** "Invoice Acme Studio SL for 3 hours of consulting at €60." The agent drafts the invoice, checks the NIF and the VAT rate, and waits for confirmation. It never issues anything on its own.
2. **Comply.** Each confirmed invoice becomes a VeriFactu record: a SHA-256 hash chained to the previous record, the AEAT verification QR and the RegistroAlta XML. Alter or delete any issued record and the chain breaks. Try the **Tamper test** button.
3. **Collect.** PayPal Invoicing sends the invoice, with its tax-agency verification link, and collects. Status, reminders and paid totals sync back to the ledger, and the agent answers questions like "How much VAT have I charged this quarter?".

## How it works

```
browser ledger ──► /api/agent  ── Gemini (tool calling) ──► proposals: propose_invoice · propose_reminder
      │                                                         │ user confirms
      ├─ VeriFactu engine (WebCrypto SHA-256 chain, QR, XML) ◄──┘
      └──► /api/paypal ── PayPal Invoicing v2: create · send · status · remind
```

- The VeriFactu hash reproduces the official AEAT example byte for byte; it is covered by `npm test`.
- Totals are recomputed and validated server-side: Spanish VAT rates only, valid NIF/CIF/NIE, sane amounts.

## Security and governance

- Human in the loop for every fiscal action; the agent only proposes.
- PayPal and Gemini credentials live only in server environment variables.
- Every PayPal invoice is bound to the session that created it with an HMAC token, so no one can read or chase another session's invoices.
- Strict Content-Security-Policy, no third-party scripts: Tailwind is compiled and the QR library is vendored from the npm registry with its integrity verified.
- Same-origin checks, JSON-only endpoints, per-IP rate limits, generic user-facing errors and redacted server logs.
- Demo data stays in the browser. CSV exports are protected against formula injection.

## Run locally

```bash
cp .env.example .env    # GEMINI_API_KEY, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (Sandbox)
npm test                # offline: engine, QR and API security checks
npm run dev             # http://localhost:3000
```

## Status

Demo on PayPal Sandbox and the AEAT test verification service. Not a certified invoicing system. The QR library is qrcode-generator 1.4.4 (MIT).

## License

MIT
