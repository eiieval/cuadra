# Compliance

Cuadra is a demo of a VeriFactu-ready invoicing agent. It is **not a certified invoicing system** and it does not make anyone compliant by itself. This page says which rules it follows, what it does and does not do, and what a production deployment adds. It is not legal advice: check the details with your tax adviser.

## Which rules

| Rule | What it asks | Where Cuadra stands |
|---|---|---|
| Ley 11/2021 (anti-fraud) and RD 1007/2023 (Reglamento de sistemas informáticos de facturación) | Invoicing software must keep records that are complete, unaltered, traceable and chronological, and must not allow hidden edits | Append-only, hash-chained records; corrections are new records |
| Orden HAC/1177/2024 | Technical specifications: record fields, hash (SHA-256 of a fixed field order), chaining, QR, XML, the VERI*FACTU and non-VERI*FACTU modes | Hash, chaining, QR and XML follow it; see below |
| RD 254/2025 | Postponed the deadlines | From 1 January 2027 for companies and 1 July 2027 for the self-employed (as understood when this was written; check the current text) |
| RD 1619/2012 (facturación) | Content of an invoice, corrective invoices | Bilingual document with issuer, client, lines, VAT breakdown, number, date; corrective invoices use TipoFactura R1 |
| GDPR and LOPDGDD | Lawful basis, minimisation, processors | See "Personal data" |

## What it does

- **Hash chain.** Each RegistroAlta hashes `IDEmisorFactura`, `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`, `ImporteTotal`, the previous `Huella` and `FechaHoraHusoGenRegistro` in the AEAT order. `npm test` reproduces the official AEAT examples for the invoice hash and the cancellation hash byte for byte.
- **Cancellation (RegistroAnulacion)** for unpaid invoices issued by mistake. The original is never edited or deleted.
- **Corrective invoice (R1, substitution)** for paid invoices that were wrong: a new invoice with the full corrected lines, pointing at the original (`IDFacturaRectificada`) and carrying its base and VAT (`ImporteRectificacion`). The original stays in the chain and shows as RECTIFIED. `verifyChain` requires the rectified invoice to exist earlier and refuses a second rectification or the cancellation of a rectified invoice.
- **Verification.** `verifyChain` checks links, hashes, totals against lines, cancellations and rectifications on every render. Verification links rebuild the record in the recipient's browser and recompute its hash; the AEAT verification QR is rebuilt from the hashed fields.
- **Derived status.** Paid, overdue, cancelled and rectified are computed from the records, not stored.
- **Record schema.** [`docs/schema/record.schema.json`](schema/record.schema.json) (JSON Schema 2020-12) describes the three record kinds as stored; `npm test` validates the sample records against it.

## What it does not do

- **No electronic signature** of the records, and **no submission** to the AEAT web service (neither the VERI*FACTU online mode nor a non-VERI*FACTU deployment with signed records). The QR points at the AEAT **test** verification service, so a scanned demo invoice is not found there.
- **The XML is not validated against the XSD.** The structure follows the published `SuministroInformacion` schema (including `FacturasRectificadas` and `ImporteRectificacion`), but the demo does not run a validator, and the system declaration (`SistemaInformatico`) is a placeholder.
- **No certification.** There is no declaración responsable of the producer, no conformity statement, no certified software identifier.
- **The web ledger is in the browser.** Clearing site data erases it. The MCP server keeps a local file. Neither is a retained, backed-up register.
- **Simplified invoices, other corrective types (differences), recargo de equivalencia, withholdings (IRPF), reverse charge and other VAT regimes are not modelled.** Only the general regime at 0, 4, 10 and 21 %.
- **The Modelo 303 view is a draft of output VAT only** (boxes 01-09 and 27). Deductible VAT (boxes 28-45) is not in Cuadra and is not guessed.

## Audit

- The chain is the audit trail: any edit, deletion or reordering breaks a link or a hash and is shown at the record where it happens (the tamper test in the app does this on purpose and undoes it).
- **Activity** is an append-only log of who did what: the agent proposed, the person approved, the engine issued, PayPal sent. The last 500 entries can be exported as JSON.
- PayPal keeps its own records of the invoices and payments it processed.
- In production the chain would also be anchored outside the issuer's control (see below), which a browser-only demo cannot offer.

## Retention

Invoices and their records must be kept for the tax limitation period (four years in general, longer for some obligations; the Código de Comercio asks for six years for commercial books). The demo does not retain anything on a server. A production deployment stores records server-side, with backups, for at least that period, and exports them in the AEAT format on request.

## Personal data (GDPR)

- **What is processed.** Client name, NIF and email (for invoices), the issuer's data, and what is typed into the agent.
- **Where it goes.** Invoices stay in the visitor's browser. When the agent is used, a bounded ledger context (up to 40 invoices with client names, amounts and statuses, 30 known clients with NIF and email) and the typed text go to the model provider (Gemini by default) through the server. When an invoice is sent with PayPal, name, NIF, email and lines go to PayPal. Both are processors with their own terms; a production deployment needs data-processing agreements, an international-transfer basis where it applies, and a way to turn the model off.
- **Minimisation.** Verification links carry a whitelist of fields (no PayPal token, no client email) in the URL fragment, which browsers never send to a server. Logs are redacted and the server stores no invoices.
- **Rights.** Access and erasure are local in the demo (export the ledger, clear site data). In production, erasure of a fiscal record conflicts with the retention duty: the answer is restriction of processing, not deletion, until the period ends.
- **The demo uses fictional data** (Estudio Norte SL, Acme Studio SL and the other sample clients). Do not enter real personal data in a public demo.

## What a production deployment adds

1. Electronic signature or VERI*FACTU online submission, with receipts stored.
2. A server-side append-only ledger with a unique constraint per `(nif, number)` and per `prevHash`, backups and retention.
3. Validation of every XML against the AEAT XSD in CI.
4. Producer certification statements and the system identifier.
5. Accounts, roles and a server-written audit log.
6. A DPA with each processor, a privacy notice and a retention policy.
