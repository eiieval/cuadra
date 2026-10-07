// Gestoría mode: several companies (NIFs) in one browser, each with its own ledger, chain, chat and Activity log.
// Pure helpers shared by the app and the tests: the storage namespace, the index of companies, the second sample company
// and the numbers of the "All companies" view. Nothing here touches the DOM or localStorage.
//
// Storage. The ledger that existed before this feature stays exactly where it was, under `cuadra-demo-v1`: it is the
// primary company, so every saved demo survives and one company behaves as it always did. Other companies live under
// `cuadra-demo-v1:<nif>`. A small index under `cuadra-companies-v1` says which companies exist and which one is open.
import { buildAlta, validNif, verifyChain } from './verifactu.js';
import { addDays, filingDeadline, daysBetween, quarterRange, returnQuarter, summary, quarterOfIso, previousQuarter } from './ledger.js';

export const KEY_BASE = 'cuadra-demo-v1';
export const INDEX_KEY = 'cuadra-companies-v1';
export const MAX_COMPANIES = 10; // what the Gestoría plan promises

export const ledgerKey = (nif, primary) => (!nif || nif === primary ? KEY_BASE : `${KEY_BASE}:${nif}`);
export const normNif = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '');

// What the index looks like after reading it back from storage: only valid, distinct NIFs, at most MAX_COMPANIES, and a
// current company that is one of them. `fallback` is the company of the primary ledger (used when there is no index yet).
export function parseIndex(raw, fallback) {
  let data = null;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { data = null; }
  const primary = normNif(data?.primary) && validNif(data.primary) ? normNif(data.primary) : normNif(fallback?.nif);
  const seen = new Set();
  const list = [];
  for (const c of [{ nif: primary, name: fallback?.name }, ...(Array.isArray(data?.list) ? data.list : [])]) {
    const nif = normNif(c?.nif);
    if (!nif || !validNif(nif) || seen.has(nif) || list.length >= MAX_COMPANIES) continue;
    seen.add(nif);
    list.push({ nif, name: String(c?.name || nif).slice(0, 120) });
  }
  const current = normNif(data?.current);
  return { v: 1, primary, current: seen.has(current) ? current : primary, list };
}

// A name and a NIF typed by a person, ready to become a company, or the first thing wrong with them.
export function companyInput({ name, nif }, index) {
  const n = String(name || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const id = normNif(nif);
  if (!n) return { error: 'Enter the name of the company.' };
  if (!validNif(id)) return { error: 'That NIF, CIF or NIE is not valid.' };
  if (index.list.some((c) => c.nif === id)) return { error: 'That company is already in your list.' };
  if (index.list.length >= MAX_COMPANIES) return { error: `The Gestoría plan covers up to ${MAX_COMPANIES} companies.` };
  return { company: { name: n, nif: id } };
}

export const withCompany = (index, company, open = true) => ({
  ...index,
  list: index.list.some((c) => c.nif === company.nif) ? index.list : [...index.list, { nif: company.nif, name: company.name }],
  current: open ? company.nif : index.current,
});

// ---------- the second sample company ----------

export const SECOND_SAMPLE = { name: 'Taller Rivas SL', nif: 'B48219075', series: 'TR' };

// Taller Rivas SL: a small workshop with three invoices to fictional clients, one paid, one overdue and one open (issued five
// days ago), in one valid hash chain (real VeriFactu records, like the first sample).
export async function buildSecondSample({ today, company = SECOND_SAMPLE }) {
  const start = quarterRange(previousQuarter(quarterOfIso(today))).from;
  const at = (iso) => `${iso}T09:30:00+02:00`;
  const plan = [
    { d: 6, to: { name: 'Carpintería Olmo SL', nif: 'B55123442', email: 'compras@olmo.example' }, lines: [{ description: 'Brake and clutch overhaul, delivery van', qty: 1, price: 640, vat: 21 }], paid: 10 },
    { d: 40, to: { name: 'Cooperativa Huerta Alta', nif: 'F61234506', email: 'admin@huertaalta.example' }, lines: [{ description: 'Annual service, tractor', qty: 2, price: 310, vat: 21 }, { description: 'Hydraulic oil, 20 l', qty: 3, price: 28, vat: 10 }] },
    { ago: 5, to: { name: 'Gestiones Vela SL', nif: 'B33456716', email: 'cuentas@vela.example' }, lines: [{ description: 'Pre-ITV inspection and repairs', qty: 1, price: 420, vat: 21 }] },
  ];
  const records = [];
  for (const p of plan) {
    const date = p.ago ? addDays(today, -p.ago) : addDays(start, p.d);
    const rec = await buildAlta({
      issuer: company,
      invoice: { number: `${company.series}-${String(records.length + 1).padStart(4, '0')}`, date, recipient: { name: p.to.name, nif: p.to.nif }, description: p.lines[0].description, lines: p.lines },
      prev: records.at(-1) || null,
      generatedAt: at(date),
    });
    Object.assign(rec, { email: p.to.email, dueDate: addDays(date, 15), sample: true });
    if (p.paid) rec.paidAt = addDays(date, p.paid);
    records.push(rec);
  }
  return records;
}

// ---------- the "All companies" view ----------

// One row per company. `state` is a saved ledger { company, records }; `verdict` is the result of verifyChain() for its
// records (null while unknown). Every number comes from summary() and the filing calendar, never from the model.
export function overviewRow(state, today, verdict = null) {
  const records = Array.isArray(state?.records) ? state.records : [];
  const s = summary(records, today);
  const quarter = returnQuarter(today);
  const date = filingDeadline(quarter);
  const chain = !records.length ? 'empty' : !verdict ? 'pending' : verdict.ok ? 'verified' : 'broken';
  return {
    nif: String(state?.company?.nif || ''),
    name: String(state?.company?.name || ''),
    invoices: records.filter((r) => r.kind !== 'anulacion').length,
    outstanding: { count: s.unpaid, total: s.unpaidTotal },
    overdue: { count: s.overdue, total: s.overdueTotal },
    deadline: { quarter, date, days: daysBetween(today, date) },
    chain,
    chainAt: chain === 'broken' ? Number(verdict.index) : null,
  };
}

export async function overview(states, today) {
  return Promise.all(states.map(async (st) => overviewRow(st, today, st?.records?.length ? await verifyChain(st.records) : null)));
}

// The totals line under the table.
export function overviewTotals(rows) {
  const cents = (v) => Math.round(Number(v) * 100);
  return {
    companies: rows.length,
    outstanding: rows.reduce((n, r) => n + cents(r.outstanding.total), 0) / 100,
    overdue: rows.reduce((n, r) => n + cents(r.overdue.total), 0) / 100,
    overdueCount: rows.reduce((n, r) => n + r.overdue.count, 0),
    broken: rows.filter((r) => r.chain === 'broken').length,
  };
}
