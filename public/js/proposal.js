// The invoice proposal as a small paper document inside the agent column: issuer, client, lines, base, VAT, total and
// due date. Every figure comes from totals() in the engine, never from the model's own arithmetic.
import { money, totals } from './verifactu.js';
import { addDays } from './ledger.js';
import { esc, eur, fmtDate } from './fmt.js';

// inv: a normalized proposal. issuer: { name, nif }. Returns the paper only; the caller adds buttons or the outcome.
export function proposalPaperHtml(inv, { issuer, today }) {
  const t = totals(inv.lines);
  const base = t.breakdown.reduce((s, b) => s + Number(b.base), 0);
  const due = inv.dueDays ? `Due in ${inv.dueDays} days · ${fmtDate(addDays(today, inv.dueDays))}` : `Due on receipt · ${fmtDate(today)}`;
  const rows = inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.qty)} × ${eur(l.price)}</td><td class="num">${eur(Number(money(l.qty * l.price)))}</td></tr>`).join('');
  const taxes = t.breakdown.map((b) => `<div class="paper-row"><span>${Number(b.rate) ? `VAT ${esc(b.rate)} %` : 'VAT 0 % (exempt)'}<span class="paper-soft"> on ${eur(b.base)}</span></span><span class="num">${eur(b.tax)}</span></div>`).join('');
  return `<article class="paper" aria-label="Invoice proposal for ${esc(inv.recipient.name)}">
    <header class="paper-top"><span class="paper-kind">Factura / Invoice</span><span class="paper-chip">Draft, not issued</span></header>
    <div class="paper-parties">
      <div><div class="paper-label">From</div><div class="paper-strong">${esc(issuer.name)}</div><div class="paper-soft num">NIF ${esc(issuer.nif)}</div></div>
      <div><div class="paper-label">Bill to</div><div class="paper-strong">${esc(inv.recipient.name)}</div>${inv.recipient.nif ? `<div class="paper-soft num">NIF ${esc(inv.recipient.nif)}</div>` : ''}<div class="paper-soft paper-email">${esc(inv.recipient.email || 'no email: PayPal link only')}</div></div>
    </div>
    <table class="paper-lines"><tbody>${rows}</tbody></table>
    <div class="paper-sum">
      <div class="paper-row"><span>Base</span><span class="num">${eur(base)}</span></div>
      ${taxes}
      <div class="paper-row paper-total"><span>Total</span><span class="num">${eur(t.total)}</span></div>
    </div>
    <div class="paper-due">${esc(due)}</div>
  </article>`;
}

// What the model sent for an invoice, reduced to what can be shown and issued: bounded text, quantities and prices above
// zero, a Spanish VAT rate (21 when it is anything else) and due days between 0 and 90.
export function normalizeProposal(args = {}) {
  const lines = (Array.isArray(args.lines) ? args.lines : []).slice(0, 20).map((l) => ({
    description: String(l.description || 'Service').slice(0, 200),
    qty: Math.max(0.01, Number(l.qty) || 1),
    price: Math.max(0.01, Number(l.price) || 0),
    vat: [0, 4, 10, 21].includes(Number(l.vat)) ? Number(l.vat) : 21,
  }));
  const r = args.recipient || {};
  return {
    recipient: { name: String(r.name || 'Client').slice(0, 120), nif: String(r.nif || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 20), email: String(r.email || '').slice(0, 254) },
    lines: lines.length ? lines : [{ description: 'Service', qty: 1, price: 1, vat: 21 }],
    description: String(args.description || '').slice(0, 250),
    dueDays: args.due_days == null || !Number.isFinite(Number(args.due_days)) ? 15 : Math.min(90, Math.max(0, Math.round(Number(args.due_days)))),
  };
}
