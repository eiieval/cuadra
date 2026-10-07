// Server-side source of truth for invoices: never trust totals or fields computed by the browser.
import { totals, validNif, qrUrl, QR_BASE, dmy } from '../public/js/verifactu.js';
import { clean } from './guard.js';
import { LIMITS, EMAIL } from '../public/js/limits.js';

const VAT_RATES = LIMITS.vatRates;

// The note on the PayPal invoice is written here, never by the client: a fixed sentence plus the AEAT verification link of
// the record. The client only sends that link (`qr`); it is accepted when it is exactly the link this invoice has (a valid
// issuer NIF and the number, date and total as recomputed here), so there is no free text to abuse a sent invoice as a relay.
export function verificationNote(qr, number, date, total) {
  const given = String(qr || '');
  let nif = '';
  try { nif = new URL(given).searchParams.get('nif') || ''; } catch { return null; }
  if (!validNif(nif)) return null;
  const same = Object.keys(QR_BASE).some((env) => qrUrl({ nif, number, date: dmy(date), total }, env) === given);
  return same ? `VERI*FACTU invoice. Verify it at the Spanish Tax Agency: ${given}` : null;
}

export function cleanInvoice(b = {}) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, LIMITS.maxLines).map((l) => ({
    description: clean(l?.description, 200), qty: Number(l?.qty), price: Number(l?.price), vat: Number(l?.vat),
  }));
  const problems = [];
  if (!lines.length) problems.push('at least one line is required');
  for (const l of lines) {
    if (!l.description) problems.push('every line needs a description');
    if (!(l.qty > 0 && l.qty <= LIMITS.maxQty)) problems.push('quantity must be between 0 and 10,000');
    if (!(l.price > 0 && l.price <= LIMITS.maxPrice)) problems.push('price must be between 0 and 100,000');
    if (!VAT_RATES.includes(l.vat)) problems.push('VAT must be 0, 4, 10 or 21');
  }
  if (Array.isArray(b.lines) && b.lines.length > LIMITS.maxLines) problems.push(`at most ${LIMITS.maxLines} lines`);
  const sum = totals(lines);
  if (lines.length && Number(sum.total) > LIMITS.maxTotal) problems.push('the invoice total must not exceed 1,000,000 EUR');
  const r = b.recipient || {};
  const recipient = { name: clean(r.name, 120), nif: clean(r.nif, 20).toUpperCase().replace(/[\s-]/g, ''), email: clean(r.email, 254) };
  if (!recipient.name) problems.push('recipient name is required');
  if (recipient.email && !EMAIL.test(recipient.email)) problems.push('recipient email is invalid');
  if (recipient.nif && !validNif(recipient.nif)) problems.push('recipient NIF is invalid');
  const number = clean(b.number, 60);
  if (!/^[A-Z0-9][A-Z0-9/_-]{2,59}$/i.test(number)) problems.push('invoice number is invalid');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  let note = 'VERI*FACTU invoice.';
  if (b.qr !== undefined && b.qr !== '') {
    note = verificationNote(b.qr, number, date, sum.total);
    if (!note) { problems.push('verification link does not match the invoice'); note = ''; }
  }
  return {
    problems: [...new Set(problems)],
    invoice: {
      number, date, recipient, lines,
      dueDays: b.dueDays == null || !Number.isFinite(Number(b.dueDays)) ? 15 : Math.min(90, Math.max(0, Math.round(Number(b.dueDays)))),
      description: clean(b.description, 250),
      issuerName: clean(b.issuerName, 120) || 'Cuadra demo merchant',
      note,
      ...sum,
    },
  };
}
