# Monetization

> **Everything with a number on this page is an estimate** made for this demo, with the assumptions shown. None of it is measured: there are no customers, no revenue and no pilot data yet.

## Plans

| Plan | Price | For | Why they pay |
|---|---|---|---|
| Free | €0 | 10 invoices a month, VeriFactu records, PayPal collection, the agent with fair use | Try it, get the first invoices compliant |
| Autónomo | €9 / month + VAT | Unlimited invoices, collections agent, Modelo 303 draft, corrective invoices, MCP access | Compliance becomes mandatory and getting paid faster is the habit |
| Gestoría | €29 / month + VAT | Up to 10 companies (NIFs), the "All companies" view, exports | One screen for every client's receivables, VAT deadline and chain status |

Cuadra never takes a cut of payments. PayPal's own fees apply to the merchant.

## Market (estimate)

- Spain has roughly 3 million self-employed workers (autónomos) and more than a million companies. All must use VeriFactu-compliant invoicing software from 2027 (the dates are in [COMPLIANCE.md](COMPLIANCE.md)). Many invoice from spreadsheets or word processors today.
- The reachable start is narrower: merchants who already take PayPal, and the gestorías that serve many small clients. Say 2 % of the autónomos who use PayPal as an order of magnitude to plan with, not as a forecast.
- Gestorías are the multiplier: one adviser account brings 10 to 100 small companies, and advisers are the ones who will be asked "which software is compliant?".

## Unit economics (estimates)

| Item | Assumption | Estimate |
|---|---|---|
| Model cost | About 3k tokens in and 300 out per agent turn on Gemini Flash-Lite; 100 turns per user per month | well under €0.10 per user per month |
| Payment fee | PayPal on a €9 subscription (about 3.4 % + €0.35) | about €0.65 |
| Hosting | Static files and two small functions; a server-side ledger adds a small database | about €0.30 per user per month at a few thousand users |
| Gross margin, Autónomo | €9 minus the above | about 88 to 90 % |
| CAC | Content, the MCP listing and gestoría referrals; paid ads only for the Free to Autónomo step | €25 to €60 per paying user |
| Churn | Invoicing is sticky once the chain starts; assume 3 % a month | lifetime of about 33 months |
| LTV | €9 × margin × lifetime | about €260 |
| LTV / CAC | | about 4 to 10 |
| Payback | CAC / (€9 × margin) | 3 to 7 months |

The assumptions that matter most are churn and CAC. If churn is 6 % a month the LTV halves.

## 12-month milestones (plan, not forecast)

| Month | Milestone | Why it matters |
|---|---|---|
| 1 to 2 | Production ledger (server-side, append-only), accounts, the PayPal live approval | Nothing can be sold until the ledger is not in a browser |
| 3 | Electronic signature or VERI*FACTU online submission; XSD validation in CI | The compliance claim becomes true |
| 4 | Ten pilot autónomos and two gestorías, free | Real churn and CAC instead of estimates |
| 6 | Paid plans open; 100 paying users | First signal on willingness to pay |
| 9 | Gestoría plan with adviser access and exports; 10 gestorías | The multiplier channel |
| 12 | 1,000 paying users (about €9k monthly recurring revenue) | Enough to decide whether to raise or stay lean |

## Risks

- **Regulation and timing.** The deadlines have already moved once. Demand depends on them.
- **Certification and liability.** A producer of invoicing software has duties and liability; the demo has none of that done.
- **Distribution.** Incumbents (large invoicing suites, bank tools, adviser software) will add VeriFactu. The difference we bet on is the agent that proposes and the MCP server that lets other agents bill.
- **Model dependence.** The model only proposes and never computes, so a bad or missing model degrades convenience, not correctness.
