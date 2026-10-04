// Server-side source of truth for invoices: never trust totals or fields computed by the browser.
import { totals, validNif } from '../public/js/verifactu.js';
import { clean } from './guard.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const VAT_RATES = [0, 4, 10, 21];

export function cleanInvoice(b = {}) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 20).map((l) => ({
    description: clean(l?.description, 200), qty: Number(l?.qty), price: Number(l?.price), vat: Number(l?.vat),
  }));
  const problems = [];
  if (!lines.length) problems.push('at least one line is required');
  for (const l of lines) {
    if (!l.description) problems.push('every line needs a description');
    if (!(l.qty > 0 && l.qty <= 10000)) problems.push('quantity must be between 0 and 10,000');
    if (!(l.price > 0 && l.price <= 100000)) problems.push('price must be between 0 and 100,000');
    if (!VAT_RATES.includes(l.vat)) problems.push('VAT must be 0, 4, 10 or 21');
  }
  const r = b.recipient || {};
  const recipient = { name: clean(r.name, 120), nif: clean(r.nif, 20).toUpperCase().replace(/[\s-]/g, ''), email: clean(r.email, 254) };
  if (!recipient.name) problems.push('recipient name is required');
  if (recipient.email && !EMAIL.test(recipient.email)) problems.push('recipient email is invalid');
  if (recipient.nif && !validNif(recipient.nif)) problems.push('recipient NIF is invalid');
  const number = clean(b.number, 60);
  if (!/^[A-Z0-9][A-Z0-9/_-]{2,59}$/i.test(number)) problems.push('invoice number is invalid');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  return {
    problems: [...new Set(problems)],
    invoice: {
      number, date, recipient, lines,
      dueDays: b.dueDays == null || !Number.isFinite(Number(b.dueDays)) ? 15 : Math.min(90, Math.max(0, Math.round(Number(b.dueDays)))),
      description: clean(b.description, 250),
      issuerName: clean(b.issuerName, 120) || 'Cuadra demo merchant',
      note: clean(b.note, 900),
      ...totals(lines),
    },
  };
}
