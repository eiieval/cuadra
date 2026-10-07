// The ledger as an AG Grid Community table. Two halves:
//  - pure functions (rows, status chips, totals of the filtered rows, register CSV, the HTML of each cell): they run
//    under Node for the tests and also feed the plain HTML table that stays as the fallback;
//  - createLedgerGrid(): the grid itself, built only when the vendored library is there (public/vendor/ag-grid).
// Every number the grid shows comes from the ledger records and the engine; the grid only sorts, filters and draws.
import { isAnulacion, money } from './verifactu.js';
import { cancelledNumbers, rectifiedNumbers, stateOf, outstandingOf, refundNote } from './ledger.js';
import { csvCell, csvPlain, esc, eur, fmtDate } from './fmt.js';
import { BADGE, OPEN, statusWord } from './status.js';

// ---------- rows ----------

// One row per record, newest first (the same order as the table). `i` is the index in state.records: the buttons
// carry it as data-i, so the click handler of the ledger works the same for the table and for the grid.
export function ledgerRows(records, { today, flashNumber = '', brokenAt = -1 } = {}) {
  const cancelled = cancelledNumbers(records);
  const rectified = rectifiedNumbers(records);
  return records.map((r, i) => {
    const common = { i, number: String(r.number), hash: String(r.hash || ''), date: String(r.date || ''), altered: i === brokenAt, flash: Boolean(flashNumber) && r.number === flashNumber, sample: Boolean(r.sample), rectifies: r.type === 'R1' && r.rectifies ? String(r.rectifies.number) : '' };
    if (isAnulacion(r)) {
      return { ...common, kind: 'anulacion', client: '', nif: '', total: '', totalNum: 0, base: '', vat: '', status: 'ANULACION', open: false, paypal: false, paypalError: '', due: '', reason: String(r.reason || '') };
    }
    const status = stateOf(r, cancelled, today, rectified);
    return {
      ...common, kind: 'alta', client: String(r.recipient?.name || ''), nif: String(r.recipient?.nif || ''),
      total: String(r.total), totalNum: Number(r.total), base: money(Number(r.total) - Number(r.taxTotal)), vat: String(r.taxTotal),
      status, open: OPEN(status), outstanding: outstandingOf(r, status), refund: refundNote(r), paypal: Boolean(r.paypal?.id), paypalError: String(r.paypal?.error || ''), due: String(r.dueDate || ''), reason: '',
    };
  }).reverse();
}

// ---------- status chips ----------

export const CHIPS = [['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];

// A cancellation record belongs to "All" and "Cancelled" only. "Open" is everything still to collect, overdue included.
export function matchesChip(row, chip) {
  if (chip === 'all' || !chip) return true;
  if (row.kind === 'anulacion') return chip === 'cancelled';
  if (chip === 'open') return row.open;
  if (chip === 'overdue') return row.status === 'OVERDUE';
  if (chip === 'paid') return row.status === 'PAID';
  if (chip === 'cancelled') return row.status === 'CANCELLED';
  return true;
}

// Invoices per chip (cancellation records are not counted: they are not invoices).
export function chipCounts(rows) {
  const out = Object.fromEntries(CHIPS.map(([key]) => [key, 0]));
  for (const row of rows) {
    if (row.kind === 'anulacion') continue;
    for (const [key] of CHIPS) if (matchesChip(row, key)) out[key]++;
  }
  return out;
}

// ---------- totals of the rows that are showing ----------

// The pinned bottom row. Cancelled invoices are void, so they are left out of the sum; if the filter shows nothing
// but cancelled invoices, the row totals those instead of a misleading 0,00 €. Cents are summed as integers.
export function gridTotals(rows) {
  const invoices = rows.filter((r) => r.kind === 'alta');
  const live = invoices.filter((r) => r.status !== 'CANCELLED' && r.status !== 'RECTIFIED');
  const voided = invoices.length - live.length;
  const onlyVoided = !live.length && voided > 0;
  const counted = onlyVoided ? invoices : live;
  const cents = counted.reduce((sum, r) => sum + Math.round(r.totalNum * 100), 0);
  const n = counted.length;
  return {
    kind: 'total',
    count: n,
    totalNum: Number(money(cents / 100)),
    label: `${onlyVoided ? 'Cancelled' : 'Total'} · ${n} invoice${n === 1 ? '' : 's'}`,
    note: !onlyVoided && voided ? `${voided} ${invoices.some((r) => r.status === 'RECTIFIED') ? 'voided' : 'cancelled'} left out` : '',
  };
}

// ---------- register CSV (what "Export CSV" writes) ----------

// A cell that starts like a formula would be run by a spreadsheet: neutralise it. Every cell is quoted.
export { csvCell, csvPlain };

export const REGISTER_COLUMNS = ['kind', 'number', 'date', 'client', 'nif', 'base', 'vat', 'total', 'status', 'due', 'hash'];
export const REGISTER_HEADER = 'record,number,date,client,client_nif,base,vat,total,status,due,hash';

// The value of one register column for a row: strings exactly as the ledger stores them (amounts with two decimals).
export function registerValue(colId, row) {
  const alta = row.kind === 'alta';
  switch (colId) {
    case 'kind': return alta ? 'alta' : 'anulacion';
    case 'number': return row.number;
    case 'date': return row.date;
    case 'client': return alta ? row.client : '';
    case 'nif': return alta ? row.nif : '';
    case 'base': return alta ? row.base : '';
    case 'vat': return alta ? row.vat : '';
    case 'total': return alta ? row.total : '';
    case 'status': return alta ? row.status : 'CANCELLATION';
    case 'due': return alta ? row.due : '';
    case 'hash': return row.hash;
    default: return '';
  }
}

export const registerCells = (row) => REGISTER_COLUMNS.map((c) => registerValue(c, row));
// Same bytes as the grid's own export: a UTF-8 byte order mark (so Excel reads the accents) and CRLF line ends.
export const registerCsv = (rows) => `﻿${[REGISTER_HEADER.split(',').map(csvCell).join(','), ...rows.map((r) => registerCells(r).map(csvCell).join(','))].join('\r\n')}`;

// ---------- the HTML of each cell (escaped, no model text) ----------

export function numberCellHtml(row) {
  if (row.kind === 'anulacion') {
    return `<span class="g-anul" title="${esc(`Cancels ${row.number}${row.reason ? ` · ${row.reason}` : ''}`)}"><span aria-hidden="true">↳</span> Cancels <b class="num">${esc(row.number)}</b>${row.reason ? `<span class="g-reason"> · ${esc(row.reason)}</span>` : ''}</span>`;
  }
  return `<span class="num g-number${(row.status === 'CANCELLED' || row.status === 'RECTIFIED') ? ' line-through' : ''}">${esc(row.number)}</span>`;
}

// The pinned row: "Total · 6 invoices" and, when something was left out of the sum, why.
export const totalCellHtml = (t) => `<span class="g-total-label">${esc(t.label)}</span>${t.note ? `<span class="g-note"> · ${esc(t.note)}</span>` : ''}`;

export function clientCellHtml(row) {
  const sub = [row.rectifies ? `R1 · rectifies ${row.rectifies}` : row.nif, row.refund, row.sample ? 'sample' : ''].filter(Boolean).join(' · ');
  return `<span class="g-client"><span class="g-name" title="${esc(row.client)}">${esc(row.client)}</span>${sub ? `<span class="g-sub num">${esc(sub)}</span>` : ''}</span>`;
}

export function statusCellHtml(row) {
  const altered = row.altered ? '<span class="badge badge-bad" title="This record no longer matches its hash">Altered</span>' : '';
  if (row.kind === 'anulacion') return `<span class="g-status"><span class="badge badge-mute">Anulación</span>${altered}</span>`;
  const title = row.paypalError || (row.paypal ? 'On PayPal' : '');
  return `<span class="g-status"><span class="${BADGE[row.status] || 'badge'}" title="${esc(title)}">${esc(statusWord(row.status))}</span>${row.paypal ? '<span class="text-[11px] text-link">PayPal</span>' : ''}${altered}</span>`;
}

// The same buttons as the table, with the same data-i / data-do, so one click listener serves both.
export function actionsCellHtml(row) {
  const btn = (act, label, extra = '') => `<button type="button" class="btn-ghost g-btn" data-i="${row.i}" data-do="${act}" aria-label="${esc(`${label} ${row.number}`)}"${extra}>${esc(label === 'Refresh' ? '↻' : label)}</button>`;
  const view = btn('view', 'View');
  if (row.kind === 'anulacion') return `<span class="g-actions-in">${view}</span>`;
  const refresh = row.paypal ? btn('refresh', 'Refresh', ' title="Refresh PayPal status"') : '';
  const act = !row.open ? '' : row.paypal ? btn('remind', 'Remind') : btn('collect', 'Collect', ' title="Send with PayPal"');
  return `<span class="g-actions-in">${view}${refresh}${act}</span>`;
}

export const dueText = (row) => (row.kind === 'alta' && row.open && row.due ? fmtDate(row.due) : '');

// ---------- the grid ----------

const ROW = 50;
const ROW_ANUL = 34;
const ROW_TOTAL = 44;
const HEADER = 36;
const MIN_HEIGHT = 190;
const MAX_HEIGHT = 560;

// The Theming API, built from the :root tokens of styles/input.css: the grid follows the palette by reference.
export function ledgerTheme(ag) {
  return ag.themeQuartz.withPart(ag.colorSchemeDark).withParams({
    backgroundColor: 'var(--surface)',
    foregroundColor: 'var(--text)',
    borderColor: 'var(--line)',
    accentColor: 'var(--link)',
    headerBackgroundColor: 'var(--surface)',
    headerTextColor: 'var(--soft)',
    headerFontSize: 11,
    headerFontWeight: 500,
    headerHeight: HEADER,
    rowHoverColor: 'rgba(255, 255, 255, .03)',
    pinnedRowBackgroundColor: 'var(--surface)',
    pinnedRowFontWeight: 600,
    fontFamily: 'Inter, system-ui, "Segoe UI", sans-serif',
    fontSize: 13,
    cellHorizontalPadding: 8,
    wrapperBorder: false,
    wrapperBorderRadius: 0,
    columnBorder: false,
    headerColumnBorder: false,
    headerColumnResizeHandleColor: 'transparent',
  });
}

// What the grid shows when the filter hides every row.
function noRowsComponent() {
  return class NoRows {
    init() {
      this.el = document.createElement('div');
      this.el.className = 'g-norows';
      this.el.innerHTML = 'No invoices match this filter. <button type="button" class="link" data-grid="clear">Clear filters</button>';
    }
    getGui() { return this.el; }
  };
}

// Keyboard in the actions column. The arrows move between cells; Enter on the cell moves focus to its first button,
// Tab and Shift+Tab go from button to button (and leave the cell at either end), Escape comes back to the cell. Enter
// or Space on a button is a button press, so the grid must not treat it as a cell action. Returning true tells the grid
// to leave the key to the browser.
function actionsKeyboard(p) {
  const ev = p.event;
  const down = ev.type === 'keydown';
  const inButton = ev.target?.closest?.('button');
  if (inButton) {
    if (ev.key === 'Tab') {
      const buttons = [...inButton.parentElement.querySelectorAll('button')];
      return Boolean(buttons[buttons.indexOf(inButton) + (ev.shiftKey ? -1 : 1)]);
    }
    if (ev.key === 'Enter' || ev.key === ' ') return true;
    if (ev.key === 'Escape') {
      if (down) p.api.setFocusedCell(p.node.rowIndex, 'actions');
      return true;
    }
    return false;
  }
  if (ev.key === 'Enter' && down) {
    const first = ev.target?.querySelector?.('button');
    if (first) { ev.preventDefault(); first.focus(); return true; }
  }
  return false;
}

const rowHeightOf = (row, pinned) => (pinned ? ROW_TOTAL : row?.kind === 'anulacion' ? ROW_ANUL : ROW);

// A cancellation has no amount and a paid invoice no due date: those cells sort after the filled ones, whichever way
// the column is sorted (the grid flips the sign of the comparator when descending, so the empty ones flip it back).
const emptyLast = (compare) => (a, b, nodeA, nodeB, descending) => {
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : (emptyA ? 1 : -1) * (descending ? -1 : 1);
  return compare(a, b);
};

// host: the element that will hold the grid. ag: window.agGrid. hooks.onShown(rows, totals) runs after every filter or
// data change with the rows that are showing, so the page can update its counters.
export function createLedgerGrid(host, ag, { rows = [], onShown, reducedMotion = false } = {}) {
  let chip = 'all';
  let quick = '';
  let data = rows;
  let lastTotals = '';
  let api = null;

  const span = (p) => (p.node.rowPinned ? 2 : p.data?.kind === 'anulacion' ? 3 : 1);
  const columnDefs = [
    {
      colId: 'number', headerName: 'Number', minWidth: 96, flex: 1.1, colSpan: span, cellClass: 'g-cell',
      valueGetter: (p) => (p.data?.kind === 'total' ? `${p.data.label}|${p.data.note}` : p.data?.number),
      cellRenderer: (p) => (p.data?.kind === 'total' ? totalCellHtml(p.data) : numberCellHtml(p.data)),
      getQuickFilterText: (p) => (p.data?.kind === 'anulacion' ? `${p.data.number} cancellation anulacion ${p.data.reason}` : p.data?.number || ''),
    },
    {
      colId: 'client', headerName: 'Client', minWidth: 94, flex: 1.6, cellClass: 'g-cell',
      valueGetter: (p) => `${p.data?.client}|${p.data?.nif}|${p.data?.sample}`,
      cellRenderer: (p) => (p.data?.kind === 'total' ? '' : clientCellHtml(p.data)),
      getQuickFilterText: (p) => `${p.data?.client || ''} ${p.data?.nif || ''} ${p.data?.sample ? 'sample' : ''}`,
    },
    {
      colId: 'total', headerName: 'Total', minWidth: 88, flex: 0.9, headerClass: 'ag-right-aligned-header', cellClass: 'g-cell num g-money ag-right-aligned-cell',
      valueGetter: (p) => (p.data?.kind === 'anulacion' ? null : p.data?.totalNum),
      valueFormatter: (p) => (p.value == null ? '' : eur(p.value)),
      comparator: emptyLast((a, b) => a - b),
    },
    {
      colId: 'status', headerName: 'Status', minWidth: 104, flex: 1.1, cellClass: 'g-cell',
      valueGetter: (p) => (p.data?.kind === 'total' ? '' : `${p.data?.status}|${p.data?.paypal}|${p.data?.altered}|${p.data?.paypalError}`),
      cellRenderer: (p) => (p.data?.kind === 'total' ? '' : statusCellHtml(p.data)),
      comparator: (a, b) => String(a).localeCompare(String(b)),
      getQuickFilterText: (p) => `${p.data?.status || ''} ${statusWord(p.data?.status || '')} ${p.data?.paypal ? 'paypal' : ''}`,
    },
    {
      colId: 'due', headerName: 'Due', minWidth: 98, flex: 1, cellClass: 'g-cell g-due',
      valueGetter: (p) => (p.data?.kind === 'alta' && p.data.open ? p.data.due : ''),
      valueFormatter: (p) => (p.value ? fmtDate(p.value) : ''),
      comparator: emptyLast((a, b) => String(a).localeCompare(String(b))),
    },
    {
      colId: 'hash', headerName: 'Hash', minWidth: 100, flex: 1, cellClass: 'g-cell num g-hash',
      valueGetter: (p) => String(p.data?.hash || '').slice(0, 12),
      tooltipValueGetter: (p) => p.data?.hash || '',
    },
    {
      colId: 'actions', headerName: 'Actions', minWidth: 156, flex: 1.3, sortable: false, cellClass: 'g-cell g-actions', headerClass: 'g-header-quiet',
      suppressKeyboardEvent: actionsKeyboard,
      valueGetter: (p) => (p.data?.kind === 'total' ? '' : `${p.data?.i}|${p.data?.open}|${p.data?.paypal}|${p.data?.kind}`),
      cellRenderer: (p) => (p.data?.kind === 'total' ? '' : actionsCellHtml(p.data)),
    },
    // Register columns that are not on screen: they exist so the grid's CSV export can write the full register format.
    ...['kind', 'date', 'nif', 'base', 'vat'].map((colId) => ({ colId, hide: true, valueGetter: (p) => (p.data?.kind === 'total' ? '' : registerValue(colId, p.data)) })),
  ];

  const shownRows = () => {
    const list = [];
    api.forEachNodeAfterFilterAndSort((n) => { if (n.data) list.push(n.data); });
    return list;
  };

  // The five essential columns need about 540px; the due date shows from 645px and the hash from 745px.
  const fitColumns = (width) => {
    api.setColumnsVisible(['due'], width >= 645);
    api.setColumnsVisible(['hash'], width >= 745);
  };

  // After every filter, sort or data change: the totals row, the height of the grid, the page's counters.
  function refresh() {
    if (!api) return;
    const list = shownRows();
    const totals = gridTotals(list);
    const sig = JSON.stringify([totals, list.length]);
    if (sig !== lastTotals) {
      lastTotals = sig;
      api.setGridOption('pinnedBottomRowData', list.length ? [totals] : []);
    }
    const body = list.reduce((h, r) => h + rowHeightOf(r), 0) + (list.length ? ROW_TOTAL : 0);
    host.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, HEADER + 4 + body))}px`;
    onShown?.(list, totals);
  }

  api = ag.createGrid(host, {
    theme: ledgerTheme(ag),
    columnDefs,
    defaultColDef: { sortable: true, resizable: false, suppressMovable: true, suppressHeaderMenuButton: true },
    rowData: data,
    getRowId: (p) => String(p.data.i),
    getRowHeight: (p) => rowHeightOf(p.data, p.node.rowPinned),
    headerHeight: HEADER,
    animateRows: !reducedMotion,
    enableCellTextSelection: true,
    ensureDomOrder: true,
    tooltipShowDelay: 250,
    rowClassRules: {
      'row-flash': (p) => Boolean(p.data?.flash),
      'row-bad': (p) => Boolean(p.data?.altered),
      'row-anul': (p) => p.data?.kind === 'anulacion',
      'row-void': (p) => p.data?.status === 'CANCELLED' || p.data?.status === 'RECTIFIED',
      'row-total': (p) => Boolean(p.node.rowPinned),
    },
    isExternalFilterPresent: () => chip !== 'all',
    doesExternalFilterPass: (node) => matchesChip(node.data, chip),
    noRowsOverlayComponent: noRowsComponent(),
    noMatchingRowsOverlayComponent: noRowsComponent(),
    onModelUpdated: refresh,
    // Narrow grids drop the least useful columns first (the full hash is one click away, in the record's detail).
    onGridSizeChanged: (e) => fitColumns(e.clientWidth),
  });
  fitColumns(host.clientWidth);
  refresh();

  return {
    api,
    update(next) { data = next; api.setGridOption('rowData', next); refresh(); },
    setChip(key) { chip = CHIPS.some(([k]) => k === key) ? key : 'all'; api.onFilterChanged(); },
    setQuick(text) { quick = String(text || '').slice(0, 60); api.setGridOption('quickFilterText', quick); },
    get chip() { return chip; },
    get quick() { return quick; },
    // The rows that are showing, in the order they are showing, written in the register format.
    exportCsv(fileName = 'cuadra-libro-registro.csv') {
      api.exportDataAsCsv({
        fileName,
        columnKeys: REGISTER_COLUMNS,
        skipPinnedBottom: true,
        processHeaderCallback: (p) => REGISTER_HEADER.split(',')[REGISTER_COLUMNS.indexOf(p.column.getColId())] ?? p.column.getColId(),
        processCellCallback: (p) => csvPlain(registerValue(p.column.getColId(), p.node.data)),
      });
    },
    destroy() { try { api.destroy(); } catch { /* already gone */ } host.style.height = ''; },
  };
}
