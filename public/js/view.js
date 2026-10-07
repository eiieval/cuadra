// Agent views: the agent proposes HOW to look at the ledger ("show me overdue invoices sorted by amount") and the browser
// applies it to the AG Grid (status chip, quick filter, sort, visible columns) or, on a phone, to the list of cards. A view
// is only a specification: cleanView() reduces whatever the model wrote to values the page knows, and the figures on
// screen still come from the ledger. Pure functions, no DOM, shared by the server, the page and the tests.
import { matchesChip } from './grid.js';
import { statusWord } from './status.js';

export const VIEW_STATUSES = ['ALL', 'OPEN', 'OVERDUE', 'PAID', 'CANCELLED'];
export const VIEW_SORTS = ['due', 'total', 'number'];
export const VIEW_DIRS = ['asc', 'desc'];
export const VIEW_COLUMNS = ['number', 'client', 'total', 'status', 'due', 'hash'];

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const SORT_WORD = { due: 'due date', total: 'amount', number: 'number' };
const STATUS_WORD = { ALL: 'All invoices', OPEN: 'Open invoices', OVERDUE: 'Overdue invoices', PAID: 'Paid invoices', CANCELLED: 'Cancelled invoices' };

// Whatever the model sent -> a view the page can apply. Unknown values fall back to "no restriction".
export function cleanView(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const status = VIEW_STATUSES.includes(String(r.status ?? '').toUpperCase()) ? String(r.status).toUpperCase() : 'ALL';
  const client = text(r.client, 60);
  const sortBy = VIEW_SORTS.includes(String(r.sortBy ?? '').toLowerCase()) ? String(r.sortBy).toLowerCase() : '';
  const sortDir = sortBy ? (String(r.sortDir ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc') : '';
  let columns = Array.isArray(r.columns) ? [...new Set(r.columns.map((c) => String(c).toLowerCase()).filter((c) => VIEW_COLUMNS.includes(c)))] : [];
  if (columns.length && !columns.includes('number')) columns.unshift('number'); // a row always says which invoice it is
  columns = columns.length && columns.length < VIEW_COLUMNS.length ? VIEW_COLUMNS.filter((c) => columns.includes(c)) : null;
  const view = { title: '', status, client, sortBy, sortDir, columns };
  view.title = text(r.title, 60) || viewTitle(view);
  return view;
}

export function viewTitle(v) {
  return `${STATUS_WORD[v.status] || STATUS_WORD.ALL}${v.client ? ` for ${v.client}` : ''}${v.sortBy ? `, by ${SORT_WORD[v.sortBy]}` : ''}`;
}

export const isPlainView = (v) => !v || (v.status === 'ALL' && !v.client && !v.sortBy && !v.columns);

// What the card says the view does, one short phrase per part.
export function viewParts(v) {
  const parts = [];
  if (v.status !== 'ALL') parts.push(`status: ${v.status.toLowerCase()}`);
  if (v.client) parts.push(`matching "${v.client}"`);
  if (v.sortBy) parts.push(`sorted by ${SORT_WORD[v.sortBy]}, ${v.sortDir === 'desc' ? (v.sortBy === 'due' ? 'latest first' : v.sortBy === 'total' ? 'highest first' : 'newest first') : (v.sortBy === 'due' ? 'earliest first' : v.sortBy === 'total' ? 'lowest first' : 'oldest first')}`);
  if (v.columns) parts.push(`columns: ${v.columns.join(', ')}`);
  return parts;
}
export const viewSummary = (v) => viewParts(v).join(' · ') || 'no filter, no sorting';

// The reducer of the page: apply replaces the active view with a clean one, reset (or a plain view) clears it.
export function reduceView(current, action) {
  if (action?.type === 'apply') {
    const v = cleanView(action.view);
    return isPlainView(v) ? null : v;
  }
  return null;
}

// The words the grid's quick filter matches on a row (the same text as its getQuickFilterText), and the AG Grid rule: every word must be in it.
const rowText = (row) => (row.kind === 'anulacion'
  ? `${row.number} cancellation anulacion ${row.reason || ''}`
  : `${row.number || ''} ${row.client || ''} ${row.nif || ''} ${row.sample ? 'sample' : ''} ${row.status || ''} ${statusWord(row.status || '')} ${row.paypal ? 'paypal' : ''}`).toLowerCase();
export const matchesClient = (row, client) => String(client || '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => rowText(row).includes(w));

const empty = (v) => v == null || v === '';
const sortValue = (row, by) => (by === 'total' ? (row.kind === 'alta' ? row.totalNum : null) : by === 'due' ? (row.kind === 'alta' && row.open ? row.due : '') : row.number);

// The rows of the ledger (ledgerRows(), newest first) with a view applied: for the card list of a phone and for tests.
// Rows without a value to sort by (a cancellation has no amount, a paid invoice no due date) stay at the end.
export function viewRows(rows, view) {
  if (!view || isPlainView(view)) return rows;
  const chip = view.status.toLowerCase();
  const list = rows.filter((r) => matchesChip(r, chip) && (!view.client || matchesClient(r, view.client)));
  if (!view.sortBy) return list;
  const sign = view.sortDir === 'desc' ? -1 : 1;
  return list
    .map((r, k) => ({ r, k, v: sortValue(r, view.sortBy) }))
    .sort((a, b) => {
      const ea = empty(a.v), eb = empty(b.v);
      if (ea || eb) return ea === eb ? a.k - b.k : ea ? 1 : -1;
      const c = typeof a.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'en', { numeric: true });
      return c ? c * sign : a.k - b.k;
    })
    .map((x) => x.r);
}
