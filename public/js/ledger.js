// Ledger views shared by the browser app, the MCP server and the tests: invoice status, quarter figures,
// the Modelo 303 VAT draft and the client directory. Pure functions over the VeriFactu records.
import { money, isAnulacion, buildAlta, buildAnulacion, isoWithOffset } from './verifactu.js';

export const PAID = ['PAID', 'MARKED_AS_PAID'];
const DONE = ['PAID', 'CANCELLED', 'RECTIFIED'];

export const isoFromDmy = (d) => String(d).split('-').reverse().join('-');
export const addDays = (iso, n) => {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const invoicesOf = (records) => records.filter((r) => !isAnulacion(r));
export const cancelledNumbers = (records) => new Set(records.filter(isAnulacion).map((r) => r.number));
// Numbers of the invoices that a corrective invoice (R1) replaced: they stay in the chain, untouched, but no longer count.
export const rectifiedNumbers = (records) => new Set(records.filter((r) => r?.type === 'R1' && r.rectifies).map((r) => r.rectifies.number));
export const nextNumber = (records, series) => `${series}-${String(invoicesOf(records).length + 1).padStart(4, '0')}`;
export const findInvoice = (records, number) => invoicesOf(records).find((r) => r.number === String(number || '').trim().toUpperCase());

// One status per invoice, in priority order: cancelled, rectified, paid, overdue, then PayPal's own status, else ISSUED.
export function stateOf(rec, cancelled, today, rectified = new Set()) {
  if (cancelled.has(rec.number) || rec.paypal?.status === 'CANCELLED') return 'CANCELLED';
  if (rectified.has(rec.number)) return 'RECTIFIED';
  if (rec.paidAt || PAID.includes(rec.paypal?.status)) return 'PAID';
  if (rec.dueDate && today > rec.dueDate) return 'OVERDUE';
  return rec.paypal?.status || 'ISSUED';
}

export const quarterOfIso = (iso) => `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
export const quarterOf = (dmyDate) => quarterOfIso(isoFromDmy(dmyDate));
export function quarterRange(quarter) {
  const [y, q] = [Number(quarter.slice(0, 4)), Number(quarter.slice(-1))];
  const from = `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`;
  const to = addDays(q === 4 ? `${y + 1}-01-01` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, -1);
  return { from, to };
}
// Modelo 303 filing window ends on the 20th of the month after the quarter (30 January for Q4).
export function filingDeadline(quarter) {
  const [y, q] = [Number(quarter.slice(0, 4)), Number(quarter.slice(-1))];
  return q === 4 ? `${y + 1}-01-30` : `${y}-${String(q * 3 + 1).padStart(2, '0')}-20`;
}
export const previousQuarter = (quarter) => {
  const [y, q] = [Number(quarter.slice(0, 4)), Number(quarter.slice(-1))];
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
};
// The return that matters today: last quarter while its filing window is open, otherwise the current one.
export function returnQuarter(today) {
  const prev = previousQuarter(quarterOfIso(today));
  return today <= filingDeadline(prev) ? prev : quarterOfIso(today);
}

const live = (records) => {
  const cancelled = cancelledNumbers(records);
  const rectified = rectifiedNumbers(records);
  return { cancelled, rectified, list: invoicesOf(records).filter((r) => !cancelled.has(r.number) && !rectified.has(r.number)) };
};
const baseOf = (r) => (r.breakdown || []).reduce((s, b) => s + Number(b.base), 0);
const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);

export function summary(records, today) {
  const { cancelled, rectified, list } = live(records);
  const quarter = quarterOfIso(today);
  const inQ = list.filter((r) => quarterOf(r.date) === quarter);
  const states = list.map((r) => ({ r, s: stateOf(r, cancelled, today, rectified) }));
  const open = states.filter((x) => !DONE.includes(x.s));
  const overdue = states.filter((x) => x.s === 'OVERDUE');
  const paid = states.filter((x) => x.s === 'PAID');
  return {
    quarter,
    invoices: inQ.length,
    base: money(sum(inQ, baseOf)),
    vat: money(sum(inQ, (r) => Number(r.taxTotal))),
    unpaid: open.length,
    unpaidTotal: money(sum(open, (x) => Number(x.r.total))),
    overdue: overdue.length,
    overdueTotal: money(sum(overdue, (x) => Number(x.r.total))),
    collected: money(sum(paid, (x) => Number(x.r.total))),
  };
}

// Draft of the output-VAT section of Modelo 303 (IVA devengado, régimen general): boxes 01–09 and 27.
// Deductible VAT from expenses (boxes 28–45) is outside Cuadra, so the draft says so instead of guessing.
const BOXES = { 4: ['01', '02', '03'], 10: ['04', '05', '06'], 21: ['07', '08', '09'] };
export function vatReturn(records, quarter) {
  const { list } = live(records);
  const inQ = list.filter((r) => quarterOf(r.date) === quarter);
  const by = new Map();
  for (const r of inQ) {
    for (const b of r.breakdown || []) {
      const g = by.get(Number(b.rate)) || { base: 0, tax: 0 };
      g.base += Number(b.base);
      g.tax += Number(b.tax);
      by.set(Number(b.rate), g);
    }
  }
  const rows = [4, 10, 21].map((rate) => ({ rate, base: money(by.get(rate)?.base || 0), tax: money(by.get(rate)?.tax || 0), boxes: BOXES[rate] }));
  const boxes = {};
  for (const r of rows) [boxes[r.boxes[0]], boxes[r.boxes[1]], boxes[r.boxes[2]]] = [r.base, money(r.rate), r.tax];
  boxes['27'] = money(rows.reduce((s, r) => s + Number(r.tax), 0));
  const cancelledInQ = records.filter((r) => isAnulacion(r) && quarterOf(r.date) === quarter).length;
  return { quarter, ...quarterRange(quarter), deadline: filingDeadline(quarter), invoices: inQ.length, cancelled: cancelledInQ, rows, exempt: money(by.get(0)?.base || 0), boxes };
}

// Known clients, most recent first, so "invoice Acme again" can reuse the NIF and email on file.
export function clients(records) {
  const out = new Map();
  for (const r of invoicesOf(records)) {
    const name = r.recipient?.name;
    if (!name) continue;
    const key = r.recipient.nif || name.toLowerCase();
    const prev = out.get(key);
    out.delete(key);
    out.set(key, { name, nif: r.recipient.nif || '', email: r.email || prev?.email || '', invoices: (prev?.invoices || 0) + 1 });
  }
  return [...out.values()].reverse();
}

// A believable last quarter for a fresh demo: paid, overdue and open invoices, plus one duplicate that was
// cancelled with a RegistroAnulacion. Every record is a real VeriFactu record in one hash chain.
export async function buildSample({ issuer, today }) {
  const start = quarterRange(previousQuarter(quarterOfIso(today))).from;
  const at = (iso) => isoWithOffset(new Date(`${iso}T10:00:00`));
  const plan = [
    { d: 2, to: { name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, lines: [{ description: 'Brand strategy workshop', qty: 1, price: 1200, vat: 21 }], paid: 12 },
    { d: 20, to: { name: 'Lumen Foods SL', nif: 'B87654323', email: 'pagos@lumen.example' }, lines: [{ description: 'Label design', qty: 2, price: 250, vat: 21 }], paid: 9 },
    { d: 35, to: { name: 'Casa Verde S.Coop.', nif: 'F23456783', email: 'admin@casaverde.example' }, lines: [{ description: 'Printed cookbook copies', qty: 20, price: 18, vat: 4 }], paid: 14 },
    { d: 58, to: { name: 'Hotel Mirador SL', nif: 'B66112236', email: 'facturas@mirador.example' }, lines: [{ description: 'Catering, product launch', qty: 1, price: 900, vat: 10 }] },
    { d: 76, to: { name: 'Marta Pardo', nif: '00000000T', email: 'marta@pardo.example' }, lines: [{ description: 'Logo refresh', qty: 1, price: 600, vat: 21 }] },
    { d: 83, to: { name: 'Marta Pardo', nif: '00000000T', email: 'marta@pardo.example' }, lines: [{ description: 'Logo refresh', qty: 1, price: 600, vat: 21 }], duplicate: true },
    { d: daysBetween(start, today) - 3, to: { name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, lines: [{ description: 'Consulting hours', qty: 4, price: 60, vat: 21 }] },
  ];
  const records = [];
  for (const p of plan) {
    const date = addDays(start, p.d);
    const rec = await buildAlta({
      issuer,
      invoice: { number: nextNumber(records, issuer.series), date, recipient: { name: p.to.name, nif: p.to.nif }, description: p.lines[0].description, lines: p.lines },
      prev: records.at(-1) || null,
      generatedAt: at(date),
    });
    Object.assign(rec, { email: p.to.email, dueDate: addDays(date, 15), sample: true });
    if (p.paid) rec.paidAt = addDays(date, p.paid);
    records.push(rec);
    if (p.duplicate) {
      const anul = await buildAnulacion({ issuer, target: rec, prev: rec, reason: 'Duplicate of the previous invoice', generatedAt: at(date).replace('T10:', 'T11:') });
      records.push({ ...anul, sample: true });
    }
  }
  return records;
}
