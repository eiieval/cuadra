// "Ask the ledger": a widget is a small specification that the agent proposes and the person pins to the Insights board:
//   { title, type: bar|donut|line|number|table, metric, groupBy, period: quarter|year|all|YYYY-QN, status?: OPEN|OVERDUE|PAID }
// The model only picks that specification. widgetData() reads the ledger and returns the dataset the chart, the table or
// the figure shows, so every number in a widget is computed here, from the VeriFactu records and the engine's own
// statuses, never by the model. Pure functions, no DOM: they run in the browser, on the server and under Node tests.
import { addDays, cancelledNumbers, daysBetween, invoicesOf, isoFromDmy, quarterOfIso, quarterRange, rectifiedNumbers, stateOf } from './ledger.js';
import { OPEN } from './status.js';
import { csvCell, eur, esc } from './fmt.js';

export const TYPES = ['bar', 'donut', 'line', 'number', 'table'];
// invoiced_vs_collected is the one metric with two series; the rest have one.
export const METRICS = ['invoiced', 'collected', 'outstanding', 'vat', 'count', 'invoiced_vs_collected'];
export const GROUPS = ['month', 'client', 'status', 'vatRate', 'aging', 'none'];
export const STATUSES = ['OPEN', 'OVERDUE', 'PAID'];
export const MAX_WIDGETS = 6; // the board holds six
export const MAX_GROUPS = 8; // clients beyond the eighth are folded into "Other"

const SERIES = {
  invoiced: { label: 'Invoiced', unit: 'eur' },
  collected: { label: 'Collected', unit: 'eur' },
  outstanding: { label: 'Outstanding', unit: 'eur' },
  vat: { label: 'VAT charged', unit: 'eur' },
  count: { label: 'Invoices', unit: 'count' },
};
const seriesKeys = (metric) => (metric === 'invoiced_vs_collected' ? ['invoiced', 'collected'] : [metric]);
const METRIC_WORDS = { invoiced: 'Invoiced', collected: 'Collected', outstanding: 'Outstanding', vat: 'VAT charged', count: 'Invoices', invoiced_vs_collected: 'Invoiced vs collected' };
const GROUP_WORDS = { month: ' by month', client: ' by client', status: ' by status', vatRate: ' by VAT rate', aging: ' by age', none: '' };
const GROUP_HEAD = { month: 'Month', client: 'Client', status: 'Status', vatRate: 'VAT rate', aging: 'Age', none: 'All invoices' };
export const defaultTitle = (s) => `${METRIC_WORDS[s.metric]}${GROUP_WORDS[s.groupBy]}`;

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Whatever the model sent becomes a valid specification: unknown values fall back to a default and a combination that
// cannot be drawn becomes the nearest one that can (a donut cannot show two series, a line needs months, a figure has no groups).
export function cleanSpec(args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const one = (v, list, fallback) => (list.includes(v) ? v : fallback);
  let metric = one(a.metric, METRICS, 'invoiced');
  let groupBy = one(a.groupBy, GROUPS, 'none');
  let type = one(a.type, TYPES, groupBy === 'none' ? 'number' : 'bar');
  if (type === 'number') groupBy = 'none';
  if (groupBy === 'none' && type !== 'table') type = 'number';
  if ((type === 'number' || type === 'donut') && metric === 'invoiced_vs_collected') metric = 'invoiced';
  if (type === 'line' && groupBy !== 'month') type = 'bar';
  const period = /^\d{4}-Q[1-4]$/.test(String(a.period)) ? String(a.period) : ['quarter', 'year', 'all'].includes(a.period) ? a.period : 'quarter';
  const spec = { title: '', type, metric, groupBy, period };
  if (STATUSES.includes(a.status)) spec.status = a.status;
  spec.title = cleanText(a.title, 60) || defaultTitle(spec);
  return spec;
}

// Two widgets with the same key show the same thing: pinning one twice is refused.
export const specKey = (s) => [s.type, s.metric, s.groupBy, s.period, s.status || ''].join('|');

// ---------- periods ----------

const monthKeyOf = (iso) => iso.slice(0, 7);
const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const endOfMonth = (key) => addDays(`${addMonths(key, 1)}-01`, -1);

// "all" with months means the last six months; otherwise the period is the quarter, the year or all the time.
export function periodRange(period, today, groupBy = 'none') {
  if (period === 'all') {
    if (groupBy !== 'month') return { from: '', to: '', label: 'All time' };
    const from = `${addMonths(monthKeyOf(today), -5)}-01`;
    return { from, to: endOfMonth(monthKeyOf(today)), label: 'Last 6 months' };
  }
  if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31`, label: today.slice(0, 4) };
  const quarter = period === 'quarter' ? quarterOfIso(today) : period;
  return { ...quarterRange(quarter), label: quarter };
}

// ---------- the dataset ----------

const cents = (v) => Math.round(Number(v) * 100);
const euros = (c) => Number((c / 100).toFixed(2));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key, withYear) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${withYear ? ` ${key.slice(2, 4)}` : ''}`;
const AGING = [['0-30', '0–30 days'], ['31-60', '31–60 days'], ['61+', '61+ days']];
const STATUS_GROUPS = [['paid', 'Paid'], ['open', 'Open'], ['overdue', 'Overdue']];

// What one invoice adds to one series, in cents. Cancelled invoices never reach here.
function weight(item, key) {
  const { r, state } = item;
  if (key === 'invoiced') return cents(r.total);
  if (key === 'collected') return state === 'PAID' ? cents(r.total) : 0;
  if (key === 'outstanding') return OPEN(state) ? cents(r.total) : 0;
  if (key === 'vat') return cents(r.taxTotal);
  return 1; // count
}
// The same, for one VAT rate of the invoice (its breakdown line).
function rateWeight(item, key, line) {
  const gross = cents(line.base) + cents(line.tax);
  if (key === 'invoiced') return gross;
  if (key === 'collected') return item.state === 'PAID' ? gross : 0;
  if (key === 'outstanding') return OPEN(item.state) ? gross : 0;
  if (key === 'vat') return cents(line.tax);
  return 1;
}

const statusGroup = (state) => (state === 'PAID' ? 'paid' : state === 'OVERDUE' ? 'overdue' : 'open');
const matchesStatus = (state, status) => !status || (status === 'OPEN' ? OPEN(state) : state === status);

// records: the ledger. spec: any object (it is cleaned first). today: YYYY-MM-DD.
// Returns { spec, title, type, period: { key, from, to, label }, series: [{ key, label, unit }], rows, total, n, value, text, empty }.
// rows: [{ key, label, n, <series key>: number }]; total: the sum over the invoices (not over the rows, which can overlap
// when an invoice has two VAT rates); n: invoices that count towards the first series; text: that total, formatted.
export function widgetData(records, rawSpec, today) {
  const spec = cleanSpec(rawSpec);
  const keys = seriesKeys(spec.metric);
  const series = keys.map((k) => ({ key: k, ...SERIES[k] }));
  const primary = keys[0];
  const range = periodRange(spec.period, today, spec.groupBy);
  const cancelled = cancelledNumbers(records);
  const rectified = rectifiedNumbers(records);
  const items = invoicesOf(records)
    .map((r) => ({ r, state: stateOf(r, cancelled, today, rectified), iso: isoFromDmy(r.date) }))
    .filter(({ state, iso }) => state !== 'CANCELLED' && state !== 'RECTIFIED' && (!range.from || (iso >= range.from && iso <= range.to)) && matchesStatus(state, spec.status));

  // The groups that always exist (months, ageing buckets, statuses, the single total) are laid out first, so a chart
  // keeps its axis even where a bucket is empty. Clients and VAT rates only exist where there is something to show.
  const groups = new Map();
  const open = (key, label) => { if (!groups.has(key)) groups.set(key, { key, label, n: 0, cents: Object.fromEntries(keys.map((k) => [k, 0])) }); return groups.get(key); };
  if (spec.groupBy === 'month') {
    const first = items.map((i) => monthKeyOf(i.iso)).sort()[0];
    let from = monthKeyOf(range.from || `${today.slice(0, 7)}-01`);
    const last = monthKeyOf(range.to) > monthKeyOf(today) ? monthKeyOf(today) : monthKeyOf(range.to);
    if (spec.period === 'all' && first && first > from) from = first; // no empty months before the first invoice
    const to = last < from ? from : last;
    const withYear = from.slice(0, 4) !== to.slice(0, 4);
    for (let m = from; m <= to; m = addMonths(m, 1)) open(m, monthLabel(m, withYear));
  } else if (spec.groupBy === 'aging') AGING.forEach(([k, label]) => open(k, label));
  else if (spec.groupBy === 'status') STATUS_GROUPS.forEach(([k, label]) => open(k, label));
  else if (spec.groupBy === 'none') open('total', 'Total');

  const add = (g, w) => {
    keys.forEach((k, i) => { g.cents[k] += w[i]; });
    if (w[0] !== 0) g.n++;
  };
  for (const item of items) {
    const w = keys.map((k) => weight(item, k));
    if (spec.groupBy === 'month') add(open(monthKeyOf(item.iso)), w); // inside the window by construction
    else if (spec.groupBy === 'aging') { const d = daysBetween(item.iso, today); add(open(d <= 30 ? '0-30' : d <= 60 ? '31-60' : '61+'), w); }
    else if (spec.groupBy === 'status') add(open(statusGroup(item.state)), w);
    else if (spec.groupBy === 'none') add(open('total'), w);
    else if (spec.groupBy === 'client') {
      if (w.every((x) => x === 0)) continue;
      const name = item.r.recipient?.name || 'Unknown';
      add(open(String(item.r.recipient?.nif || name).toLowerCase(), name), w);
    } else if (spec.groupBy === 'vatRate') {
      for (const line of item.r.breakdown || []) {
        const lw = keys.map((k) => rateWeight(item, k, line));
        if (lw.every((x) => x === 0)) continue;
        add(open(`rate-${Number(line.rate)}`, `${Number(line.rate)} %`), lw);
      }
    }
  }

  let list = [...groups.values()];
  if (spec.groupBy === 'client') {
    list.sort((a, b) => b.cents[primary] - a.cents[primary] || a.label.localeCompare(b.label));
    if (list.length > MAX_GROUPS) {
      const rest = list.slice(MAX_GROUPS - 1);
      const other = { key: 'other', label: 'Other', n: 0, cents: Object.fromEntries(keys.map((k) => [k, 0])) };
      for (const g of rest) { other.n += g.n; keys.forEach((k) => { other.cents[k] += g.cents[k]; }); }
      list = [...list.slice(0, MAX_GROUPS - 1), other];
    }
  } else if (spec.groupBy === 'vatRate') list.sort((a, b) => Number(b.key.slice(5)) - Number(a.key.slice(5)));

  const unitOf = (k) => SERIES[k].unit;
  const out = (k, c) => (unitOf(k) === 'eur' ? euros(c) : c);
  const rows = list.map((g) => ({ key: g.key, label: g.label, n: g.n, ...Object.fromEntries(keys.map((k) => [k, out(k, g.cents[k])])) }));
  const sums = Object.fromEntries(keys.map((k) => [k, items.reduce((s, item) => s + weight(item, k), 0)]));
  const total = Object.fromEntries(keys.map((k) => [k, out(k, sums[k])]));
  const n = spec.metric === 'count' ? items.length : items.filter((item) => weight(item, primary) !== 0).length;
  const value = total[primary];
  return {
    spec, title: spec.title, type: spec.type,
    period: { key: spec.period, from: range.from, to: range.to, label: range.label },
    series, rows, total, n, value, text: unitOf(primary) === 'eur' ? eur(value) : String(value),
    empty: n === 0,
  };
}

// ---------- the same dataset as words ----------

const NOUN = { outstanding: ['open invoice', 'open invoices'], collected: ['paid invoice', 'paid invoices'] };
// "3 open invoices", "1 invoice": what the figure counts.
export function countText(data) {
  const [one, many] = data.spec.metric === 'count' ? ['invoice', 'invoices'] : NOUN[data.spec.metric] || ['invoice', 'invoices'];
  return `${data.n} ${data.n === 1 ? one : many}`;
}
const STATUS_WORD = { OPEN: 'open', OVERDUE: 'overdue', PAID: 'paid' };
// "3 open invoices · All time · incl. VAT": the line under the figure of a card.
export const subtitle = (data) => [countText(data), data.period.label, data.series[0].unit === 'eur' && data.spec.metric !== 'vat' ? 'incl. VAT' : '', data.spec.status ? `${STATUS_WORD[data.spec.status]} only` : ''].filter(Boolean).join(' · ');

// ---------- the same dataset as text: CSV and a plain table ----------

const plain = (v, unit) => (unit === 'eur' ? Number(v).toFixed(2) : String(v));

// Same bytes as the ledger's CSV: a byte order mark, CRLF, every cell quoted and formula-safe.
export function widgetCsv(data) {
  const head = [GROUP_HEAD[data.spec.groupBy], ...data.series.map((s) => s.label)];
  const body = data.rows.map((r) => [r.label, ...data.series.map((s) => plain(r[s.key], s.unit))]);
  const sum = ['Total', ...data.series.map((s) => plain(data.total[s.key], s.unit))];
  return `﻿${[head, ...body, sum].map((cells) => cells.map(csvCell).join(',')).join('\r\n')}`;
}

// The figures of a widget as a small table: what the board shows for a "table" widget and while a chart cannot load.
export function widgetTableHtml(data) {
  const show = (v, unit) => (unit === 'eur' ? eur(v) : String(v));
  const head = `<tr><th scope="col">${esc(GROUP_HEAD[data.spec.groupBy])}</th>${data.series.map((s) => `<th scope="col" class="insight-num">${esc(s.label)}</th>`).join('')}</tr>`;
  const body = data.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${data.series.map((s) => `<td class="insight-num num">${esc(show(r[s.key], s.unit))}</td>`).join('')}</tr>`).join('');
  const foot = data.rows.length > 1 ? `<tr class="insight-sum"><th scope="row">Total</th>${data.series.map((s) => `<td class="insight-num num">${esc(show(data.total[s.key], s.unit))}</td>`).join('')}</tr>` : '';
  return `<table class="insight-table"><caption class="sr-only">${esc(data.title)}</caption><thead>${head}</thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table>`;
}

// The board a sample ledger opens with: invoiced against collected, who still owes what, and how old the unpaid invoices are.
export const defaultBoard = () => [
  { title: 'Invoiced vs collected by month', type: 'bar', metric: 'invoiced_vs_collected', groupBy: 'month', period: 'all' },
  { title: 'Who still owes what', type: 'donut', metric: 'outstanding', groupBy: 'client', period: 'all' },
  { title: 'Receivables aging', type: 'bar', metric: 'outstanding', groupBy: 'aging', period: 'all' },
].map(cleanSpec);
