import { buildAlta, buildAnulacion, verifyChain, recordXml, money, validNif, totals, isAnulacion } from './js/verifactu.js';
import {
  stateOf, summary, vatReturn, returnQuarter, previousQuarter, clients, cancelledNumbers, invoicesOf, findInvoice,
  nextNumber, buildSample, addDays, daysBetween, isoFromDmy, quarterOfIso,
} from './js/ledger.js';

import { esc, eur, fmtDate, isoToday, md, safeUrl } from './js/fmt.js';
import { chainBlocks, chainStatus, chainTrackHtml, statusHtml } from './js/chain.js';
import { engineChecks, checksHtml } from './js/checks.js';
import { normalizeProposal as normalize, proposalPaperHtml } from './js/proposal.js';
import { detectLang, synthReply } from './js/say.js';
import { isPlan, planProgress, planSummary, pendingLowRisk, hasHighRisk } from './js/plan.js';
import { reduceActivity, activityRows, activityHtml } from './js/activity.js';
import { renderDocument } from './js/document.js';
import { qrSvg } from './js/qr.js';
import { sanitizeRecord, shareable, shareUrl, verifyRecord } from './js/share.js';
import { startTour, tourSeen } from './js/tour.js';
import { BADGE, OPEN, statusWord } from './js/status.js';
import { CHIPS, chipCounts, createLedgerGrid, ledgerRows, registerCsv } from './js/grid.js';
import { loadVendor } from './js/vendor.js';
import { MAX_WIDGETS, cleanSpec, defaultBoard, specKey, widgetCsv, widgetData } from './js/widgets.js';
import { boardCardHtml, createChartHub, insightCardHtml, readTokens } from './js/insights.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = 'cuadra-demo-v1';
const METHOD = { BANK_TRANSFER: 'bank transfer', CASH: 'cash', OTHER: 'other method' };
const EXAMPLES = [
  'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60',
  'Close my quarter',
  'Chase every overdue invoice',
  'Prepare my VAT return',
  'Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA',
  'Hotel Mirador paid by bank transfer',
  'Who owes me money?',
  'Revenue by client this quarter',
];

const newId = () => `w${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const withId = (spec) => ({ id: newId(), ...spec });

const fresh = () => ({
  company: { name: 'Estudio Norte SL', nif: 'B76543214', series: `CU${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4).toUpperCase()}` },
  records: [],
  chat: [],
  activity: [],
  widgets: [],
});
let tampered = null;
let vatQ = null;
let chainSig = '';
let chainCount = 0;
let chainRun = 0;
let chainFx = null; // { newFrom }: records at or after this index just entered the chain and animate in
let chainNow = null;
let chainVerdict = null; // latest verifyChain() result, also used to mark an altered record in the ledger
let ledgerVerdictKey = 'none';
let flash = null; // { number, at }: the ledger row of a record that has just entered the chain lights up
const FLASH_MS = 1500;
const verdictKey = (v) => (!v ? 'none' : v.ok ? 'ok' : `bad${v.index}`);
let statusTimer;
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
const firstVisit = !state;
state = state || fresh();
state.activity = Array.isArray(state.activity) ? state.activity : [];
// The Insights board: up to six pinned widget specs. A ledger saved before the board existed gets the default board.
state.widgets = Array.isArray(state.widgets)
  ? state.widgets.filter((w) => w && typeof w.id === 'string').slice(0, MAX_WIDGETS).map((w) => ({ id: w.id, ...cleanSpec(w) }))
  : state.records.length ? defaultBoard().map(withId) : [];
state.chat = (state.chat || []).filter((m) => m.text !== 'Thinking…');
for (const m of state.chat) { delete m.running; for (const a of m.actions || []) delete a.busy; }
// Append-only activity log: who did what, shown in the Activity panel and exportable as JSON.
const log = (actor, event, number = '', detail = '') => { state.activity = reduceActivity(state.activity, { actor, event, number, detail }); };
const save = () => { if (tampered) return; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } };

async function post(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || `Request failed (${r.status})` };
  } catch {
    return { error: 'Network error. Check your connection.' };
  }
}

let toastTimer;
const bit = (text, cls = 'num') => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };
// content: a string, or a list of strings and nodes (built with bit()), never HTML.
function toast(content) {
  const t = $('#toast');
  t.replaceChildren(...[].concat(content));
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

const today = () => isoToday();
const cancelled = () => cancelledNumbers(state.records);
const status = (rec) => stateOf(rec, cancelled(), today());

function context() {
  const set = cancelled();
  const v = vatReturn(state.records, returnQuarter(today()));
  return {
    today: today(),
    summary: summary(state.records, today()),
    vatReturn: { quarter: v.quarter, deadline: v.deadline, outputVat: Number(v.boxes['27']) },
    invoices: invoicesOf(state.records).slice(-40).map((r) => ({
      number: r.number, client: r.recipient?.name || '', total: Number(r.total), vat: Number(r.taxTotal),
      status: stateOf(r, set, today()), date: r.date, due: r.dueDate || '', paypal: Boolean(r.paypal?.id),
    })),
    clients: clients(state.records).slice(0, 30).map(({ name, nif, email }) => ({ name, nif, email })),
  };
}

// What the model sees of earlier turns: the text plus a one-line trace of each proposal and its outcome.
function actionTrace(a) {
  const done = a.done ? ` → ${a.done}` : '';
  if (a.type === 'propose_invoice') {
    const inv = normalize(a.args);
    const lines = inv.lines.map((l) => `${l.qty} × ${l.description} at €${l.price} + ${l.vat}% VAT`).join('; ');
    return `[Proposed invoice to ${inv.recipient.name}${inv.recipient.nif ? ` (${inv.recipient.nif})` : ''}${inv.recipient.email ? ` <${inv.recipient.email}>` : ''}: ${lines}, due in ${inv.dueDays} days${done}]`;
  }
  if (a.type === 'propose_widget') return `[Proposed an insight: ${a.args?.type} of ${a.args?.metric} by ${a.args?.groupBy}${done}]`;
  return `[Proposed ${a.type.replace('propose_', '').replace('show_', 'show ')}${a.args?.number ? ` for ${a.args.number}` : ''}${done}]`;
}
const chatHistory = () => state.chat.slice(0, -2).slice(-8)
  .filter((m) => !String(m.text).startsWith('⚠'))
  .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: [m.text, ...(m.actions || []).map(actionTrace)].join('\n').slice(0, 800) }));

const paypalPayload = (rec, dueDays) => ({
  number: rec.number, date: isoFromDmy(rec.date), dueDays, issuerName: rec.issuerName,
  recipient: { name: rec.recipient?.name, nif: rec.recipient?.nif, email: rec.email || '' },
  lines: rec.lines, description: rec.description,
  note: `VERI*FACTU invoice. Verify it at the Spanish Tax Agency: ${rec.qr}`,
});

async function collect(rec) {
  const dueDays = Math.max(0, daysBetween(today(), rec.dueDate || today()));
  const r = await post('/api/paypal', { op: 'create_and_send', invoice: paypalPayload(rec, dueDays) });
  rec.paypal = r.error ? { status: 'ERROR', error: r.error } : { id: r.id, token: r.token, status: r.status, payerUrl: safeUrl(r.payerUrl) };
  return r.error;
}

// Every handler reports { ok, text }: the text goes on the card (and into what the model remembers),
// ok feeds the plan summary.
async function issue(inv, withPaypal) {
  const number = nextNumber(state.records, state.company.series);
  const rec = await buildAlta({
    issuer: state.company,
    invoice: { number, date: today(), recipient: { name: inv.recipient.name, nif: inv.recipient.nif }, description: inv.description || inv.lines[0].description, lines: inv.lines },
    prev: state.records.at(-1) || null,
  });
  Object.assign(rec, { email: inv.recipient.email, dueDate: addDays(today(), inv.dueDays) });
  state.records.push(rec);
  chainFx = { newFrom: state.records.length - 1 };
  flash = { number, at: Date.now() };
  log('system', 'issued', number, `VeriFactu record chained · hash ${rec.hash.slice(0, 6)}…`);
  save();
  closeSheet(); // on a phone the sheet gets out of the way, so the new block is seen entering the chain
  $('#chainStrip').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  await renderAll();
  const issued = (extra = '') => toast([bit(number, 'num font-semibold'), ' issued · hash ', bit(`${rec.hash.slice(0, 6)}…`), extra]);
  issued();
  if (!withPaypal) return { ok: true, number, text: `Issued ${number}. VeriFactu record chained.` };
  const error = await collect(rec);
  if (error) log('paypal', 'paypal_error', number, error);
  else log('paypal', 'sent', number, 'PayPal invoice created and sent');
  if (!error) issued(' · sent with PayPal');
  return error ? { ok: false, number, text: `Issued ${number}, but PayPal failed: ${error}` } : { ok: true, number, text: `Issued ${number} and sent with PayPal.` };
}

async function sendWithPaypal(rec) {
  if (rec.paypal?.id) return { ok: false, text: `${rec.number} is already on PayPal.` };
  if (!OPEN(status(rec))) return { ok: false, text: `${rec.number} is ${status(rec).toLowerCase()}, nothing to collect.` };
  const error = await collect(rec);
  if (error) log('paypal', 'paypal_error', rec.number, error);
  else log('paypal', 'sent', rec.number, 'PayPal invoice created and sent');
  return error ? { ok: false, text: `PayPal failed for ${rec.number}: ${error}` } : { ok: true, text: `${rec.number} sent with PayPal. The client can pay online now.` };
}

// Pull PayPal statuses for open invoices: on load and when the tab regains focus, at most every 30 seconds.
let lastSync = 0;
async function syncPaypal() {
  if (Date.now() - lastSync < 30000 || tampered) return;
  lastSync = Date.now();
  const due = invoicesOf(state.records).filter((r) => r.paypal?.id && OPEN(status(r))).slice(-5);
  let changed = 0;
  for (const rec of due) {
    const r = await post('/api/paypal', { op: 'status', id: rec.paypal.id, token: rec.paypal.token });
    if (r.error || r.status === rec.paypal.status) continue;
    log('paypal', 'sync', rec.number, `${rec.paypal.status} → ${r.status}`);
    Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
    changed++;
    if (status(rec) === 'PAID') toast(`${rec.number} was paid with PayPal.`);
  }
  if (changed) { save(); await renderAll(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPaypal(); });

async function remind(rec) {
  if (!rec.paypal?.id) return { ok: false, text: `${rec.number} is not on PayPal yet. Send it with PayPal first.` };
  const r = await post('/api/paypal', { op: 'remind', id: rec.paypal.id, token: rec.paypal.token });
  if (r.error) return { ok: false, text: `Reminder failed: ${r.error}` };
  Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
  log('paypal', 'reminder', rec.number, 'PayPal reminder sent to the client');
  return { ok: true, text: `Reminder sent for ${rec.number}.` };
}

async function markPaid(rec, method = 'BANK_TRANSFER') {
  if (!OPEN(status(rec))) return { ok: false, text: `${rec.number} is already ${status(rec).toLowerCase()}.` };
  if (rec.paypal?.id) {
    const r = await post('/api/paypal', { op: 'record_payment', id: rec.paypal.id, token: rec.paypal.token, amount: Number(rec.total), date: today(), method });
    if (r.error) return { ok: false, text: `PayPal could not record the payment: ${r.error}` };
    rec.paypal.status = r.status;
  }
  Object.assign(rec, { paidAt: today(), paidMethod: method });
  log('you', 'payment', rec.number, `${METHOD[method] || 'other method'}${rec.paypal?.id ? ', recorded in PayPal too' : ''}`);
  return { ok: true, text: `${rec.number} marked as paid by ${METHOD[method] || 'other method'}${rec.paypal?.id ? ', also in PayPal' : ''}.` };
}

// Cancellation never edits the invoice: PayPal stops collecting it, then a RegistroAnulacion is appended to the chain.
async function annul(rec, reason) {
  if (cancelled().has(rec.number)) return { ok: false, text: `${rec.number} is already cancelled.` };
  if (status(rec) === 'PAID') return { ok: false, text: `${rec.number} is paid. A paid invoice needs a corrective invoice (factura rectificativa), not a cancellation.` };
  if (rec.paypal?.id && rec.paypal.status !== 'CANCELLED') {
    const r = await post('/api/paypal', { op: 'cancel', id: rec.paypal.id, token: rec.paypal.token, reason });
    if (r.error) return { ok: false, text: `PayPal could not cancel ${rec.number}: ${r.error}. Nothing was changed.` };
    rec.paypal.status = r.status;
  }
  const record = await buildAnulacion({ issuer: state.company, target: rec, prev: state.records.at(-1), reason });
  state.records.push(record);
  chainFx = { newFrom: state.records.length - 1 };
  flash = { number: rec.number, at: Date.now() };
  log('system', 'cancelled', rec.number, `RegistroAnulacion chained · hash ${record.hash.slice(0, 6)}…`);
  closeSheet();
  $('#chainStrip').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  toast([bit(rec.number, 'num font-semibold'), ' cancelled · cancellation hash ', bit(`${record.hash.slice(0, 6)}…`)]);
  return { ok: true, text: `${rec.number} cancelled with a chained VeriFactu cancellation record${rec.paypal?.id ? '; the PayPal invoice is cancelled too' : ''}.` };
}

// One line about a proposal, for the activity log.
function describe(a) {
  const n = a.args?.number;
  if (a.type === 'propose_invoice') { const inv = normalize(a.args); return `Invoice for ${inv.recipient.name} · ${eur(totals(inv.lines).total)}`; }
  if (a.type === 'propose_reminder') return `PayPal reminder for ${n}`;
  if (a.type === 'propose_collect') return `Send ${n} with PayPal`;
  if (a.type === 'propose_mark_paid') return `Record the payment of ${n}`;
  if (a.type === 'propose_cancel') return `Cancel ${n}`;
  if (a.type === 'show_vat_return') return 'Modelo 303 draft';
  if (a.type === 'propose_widget') return `Insight: ${cleanSpec(a.args).title}`;
  return String(a.type);
}

// Runs one proposal of the agent after the user approved it (act = the button's data-act) and stores the outcome on it.
async function perform(a, act) {
  const rec = findInvoice(state.records, a.args?.number);
  let r;
  if (act === 'discard') r = { ok: true, text: 'Dismissed.', skipped: true };
  else if (act === 'issue' || act === 'issue-send') r = await issue(normalize(a.args), act === 'issue-send');
  else if (act === 'open-vat') r = { ok: true, text: 'Opened the VAT draft.' };
  else if (act === 'pin') r = pinWidget(a.args);
  else if (!rec) r = { ok: false, text: 'Invoice not found.' };
  else if (act === 'remind') r = await remind(rec);
  else if (act === 'collect') r = await sendWithPaypal(rec);
  else if (act === 'mark-paid') r = await markPaid(rec, METHOD[a.args?.method] ? a.args.method : 'BANK_TRANSFER');
  else if (act === 'cancel') r = await annul(rec, String(a.args?.reason || '').slice(0, 200));
  else return;
  Object.assign(a, { done: r.text, ok: r.ok, ...(r.skipped ? { skipped: true } : {}), ...(r.number ? { number: r.number } : {}), ...(r.pinned ? { pinned: true } : {}) });
}

async function run(mi, ai, act) {
  const a = state.chat[mi]?.actions?.[ai];
  if (!a || a.done || a.busy) return;
  a.busy = true;
  if (act !== 'pin') log('you', act === 'discard' ? 'dismissed' : 'approved', a.args?.number, describe(a));
  renderChat();
  try {
    await perform(a, act);
  } finally {
    delete a.busy;
    save();
    await renderAll();
  }
}

// "Approve all reminders and collections": the low-risk steps of a plan, one after the other.
const ACT_OF = { propose_reminder: 'remind', propose_collect: 'collect' };
async function approveAll(mi) {
  const m = state.chat[mi];
  if (!m || m.running) return;
  const todo = pendingLowRisk(stepViews(m.actions));
  if (!todo.length) return;
  m.running = true;
  renderChat();
  try {
    for (const { ai } of todo) {
      await run(mi, ai, ACT_OF[m.actions[ai].type]);
      await sleep(220);
    }
  } finally {
    delete m.running;
    save();
    renderChat();
  }
}

// ---------- rendering ----------

const buttons = (id, primary, label, secondary = 'Dismiss', busy = false) => `<div class="mt-3 flex flex-wrap gap-2"><button class="btn-primary" data-act="${primary}" data-id="${id}"${busy ? ' disabled' : ''}>${busy ? 'Working…' : esc(label)}</button><button class="btn-ghost" data-act="discard" data-id="${id}"${busy ? ' disabled' : ''}>${esc(secondary)}</button></div>`;
const invoiceLine = (rec) => `<b class="num">${esc(rec.number)}</b> · ${esc(rec.recipient?.name)} · <span class="num">${eur(rec.total)}</span> <span class="${BADGE[status(rec)] || 'badge'}">${esc(status(rec).replace(/_/g, ' '))}</span>`;

function vatTable(v, compact = false) {
  const rows = v.rows.map((r) => `<tr class="border-t border-line"><td class="py-1.5 pr-2 text-soft">${r.rate}%</td><td class="num pr-2 text-right"><span class="box">${r.boxes[0]}</span>${eur(r.base)}</td><td class="num text-right"><span class="box">${r.boxes[2]}</span>${eur(r.tax)}</td></tr>`).join('');
  const days = daysBetween(today(), v.deadline);
  const ended = today() > v.to;
  const when = !ended ? `Quarter in progress · file by ${fmtDate(v.deadline)}` : days >= 0 ? `<b class="text-warn">Due in ${days} day${days === 1 ? '' : 's'}</b> · ${fmtDate(v.deadline)}` : `Filing window closed on ${fmtDate(v.deadline)}`;
  return `<div class="text-xs text-soft">${when}</div>
    <table class="mt-2 w-full text-xs"><thead class="text-soft"><tr><th class="text-left font-normal">VAT rate</th><th class="text-right font-normal">Taxable base</th><th class="text-right font-normal">Output VAT</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="mt-2 flex justify-between border-t border-line pt-2 text-sm"><span class="text-soft"><span class="box">27</span>Total output VAT</span><b class="num">${eur(v.boxes['27'])}</b></div>
    ${compact ? '' : `<div class="mt-2 text-[11px] leading-relaxed text-soft">${v.invoices} invoice${v.invoices === 1 ? '' : 's'}${v.cancelled ? `, ${v.cancelled} cancelled and excluded` : ''}${Number(v.exempt) ? ` · exempt (0%) base ${eur(v.exempt)}, declared outside boxes 01–09` : ''}. Output VAT only: add deductible VAT from your expenses (boxes 28–45) before filing. Draft for your adviser, not a filing.</div>`}`;
}

// A step the ledger no longer allows (invoice gone, already settled...): there is nothing left to approve.
function isDeadEnd(a) {
  if (a.type === 'propose_invoice' || a.type === 'show_vat_return' || a.type === 'propose_widget') return false;
  const rec = findInvoice(state.records, a.args?.number);
  if (!rec) return true;
  const st = status(rec);
  if (a.type === 'propose_reminder') return !(rec.paypal?.id && OPEN(st));
  if (a.type === 'propose_collect') return rec.paypal?.id || !OPEN(st);
  if (a.type === 'propose_mark_paid') return !OPEN(st);
  if (a.type === 'propose_cancel') return st === 'PAID' || (st === 'CANCELLED' && cancelled().has(rec.number));
  return false;
}
const stepViews = (actions) => actions.map((a) => ({ ...a, dead: !a.done && Boolean(isDeadEnd(a)) }));

function actionCard(a, mi, ai, inPlan = false) {
  const id = `${mi}-${ai}`;
  const done = a.done ? `<div class="${a.skipped ? 'card-note' : a.ok === false ? 'card-fail' : 'card-done'}">${esc(a.done)}</div>` : '';
  const card = (extra = '') => `card${inPlan ? ' card-step' : ''}${extra}`;
  if (a.type === 'show_vat_return') {
    const q = /^\d{4}-Q[1-4]$/.test(a.args?.quarter || '') ? a.args.quarter : returnQuarter(today());
    return `<div class="${card()}"><div class="flex items-center gap-2"><div class="text-xs text-soft">Modelo 303 draft · ${esc(q)}</div><button class="btn-ghost ml-auto !min-h-8" data-act="open-vat" data-id="${id}" data-q="${esc(q)}">Open</button></div><div class="mt-1">${vatTable(vatReturn(state.records, q), true)}</div>${done}</div>`;
  }
  if (a.type === 'propose_widget') {
    // The figures come from widgetData() on the ledger as it is now; the model only chose what to show.
    const data = widgetData(state.records, a.args, today());
    chartJobs.set(`chat:${id}`, data);
    const boardFull = !a.done && state.widgets.length >= MAX_WIDGETS && !state.widgets.some((w) => specKey(w) === specKey(data.spec));
    return insightCardHtml(data, { id, busy: a.busy, pinned: Boolean(a.pinned), boardFull, done: a.done, ok: a.ok, skipped: a.skipped, tokens: tk(), fmt: eur });
  }
  if (a.type !== 'propose_invoice') {
    const rec = findInvoice(state.records, a.args?.number);
    if (!rec) return `<div class="${card()} text-xs text-warn">Invoice ${esc(a.args?.number || '?')} is not in the ledger.</div>`;
    const st = status(rec);
    const head = (label) => `<div class="text-xs text-soft">${label}</div><div class="mt-1 text-sm">${invoiceLine(rec)}</div>`;
    if (a.type === 'propose_reminder') return `<div class="${card()}">${head('Payment reminder')}${done || (rec.paypal?.id && OPEN(st) ? buttons(id, 'remind', 'Send PayPal reminder', 'Dismiss', a.busy) : '<div class="card-note">No PayPal invoice to remind.</div>')}</div>`;
    if (a.type === 'propose_collect') return `<div class="${card()}">${head('Collect with PayPal')}${inPlan ? '' : `<div class="card-note !mt-1">Creates a PayPal invoice with the VeriFactu verification link, so ${esc(rec.recipient?.name)} can pay online.</div>`}${done || (!rec.paypal?.id && OPEN(st) ? buttons(id, 'collect', 'Send with PayPal', 'Dismiss', a.busy) : '<div class="card-note">Already on PayPal or settled.</div>')}</div>`;
    if (a.type === 'propose_mark_paid') {
      const method = METHOD[a.args?.method] ? a.args.method : 'BANK_TRANSFER';
      return `<div class="${card()}">${head(`Record payment · ${METHOD[method]}`)}${done || (OPEN(st) ? buttons(id, 'mark-paid', 'Mark as paid', 'Dismiss', a.busy) : '<div class="card-note">Nothing to record.</div>')}</div>`;
    }
    if (a.type === 'propose_cancel') {
      const blocked = st === 'PAID' ? 'Paid invoices need a corrective invoice, not a cancellation.' : st === 'CANCELLED' && cancelled().has(rec.number) ? 'Already cancelled.' : '';
      return `<div class="${card(' card-bad')}">${head('Cancel invoice (anulación)')}<div class="card-note !mt-1">${a.args?.reason ? `Reason: ${esc(a.args.reason)}. ` : ''}The invoice is never edited: a VeriFactu cancellation record is appended to the chain${rec.paypal?.id ? ' and the PayPal invoice is cancelled' : ''}.</div>${done || (blocked ? `<div class="card-note text-warn">${esc(blocked)}</div>` : buttons(id, 'cancel', 'Cancel invoice', 'Keep it', a.busy))}</div>`;
    }
    return '';
  }
  // An invoice proposal: a small paper document with the actions attached, and the engine's checks underneath.
  const inv = normalize(a.args);
  const paper = proposalPaperHtml(inv, { issuer: state.company, today: today() });
  const checks = checksHtml(engineChecks(inv, { known: clients(state.records), today: today() }));
  const foot = a.done
    ? `<div class="proposal-result${a.ok === false ? ' is-fail' : a.skipped ? ' is-skipped' : ''}"><span>${esc(a.done)}</span>${a.number ? `<button class="btn-ghost !min-h-8" data-view="${esc(a.number)}">View record</button>` : ''}</div>`
    : `<div class="proposal-actions"><button class="btn-primary" data-act="issue-send" data-id="${id}"${a.busy ? ' disabled' : ''}>${a.busy ? 'Working…' : 'Issue + collect with PayPal'}</button><button class="btn-ghost" data-act="issue" data-id="${id}"${a.busy ? ' disabled' : ''}>Issue only</button><button class="btn-ghost" data-act="discard" data-id="${id}"${a.busy ? ' disabled' : ''}>Discard</button></div>`;
  return `<div class="proposal${a.done ? ' is-done' : ''}">${paper}${foot}</div>${checks}`;
}

const TICK = {
  todo: '<span class="tick tick-todo"></span>',
  busy: '<span class="tick tick-busy"></span>',
  done: '<svg viewBox="0 0 16 16" class="tick tick-done" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6.6" class="tick-ring"/><path d="M5 8.4l2.1 2.1L11 6"/></svg>',
  fail: '<svg viewBox="0 0 16 16" class="tick tick-fail" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.6" class="tick-ring"/><path d="M8 4.8V8.6M8 11v.01"/></svg>',
  skip: '<svg viewBox="0 0 16 16" class="tick tick-skip" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.6" class="tick-ring"/><path d="M5.5 8h5"/></svg>',
};
const STATE_WORD = { todo: 'To do', busy: 'Working', done: 'Done', fail: 'Needs attention', skip: 'Skipped' };
const tickOf = (s) => (s.busy ? 'busy' : s.skipped || s.dead || s.done === 'Dismissed.' ? 'skip' : s.done ? (s.ok === false ? 'fail' : 'done') : 'todo');

// Two or more actions in one reply become a plan: a checklist, each step approved on its own.
function planCard(m, mi) {
  const steps = stepViews(m.actions);
  const p = planProgress(steps);
  const pending = pendingLowRisk(steps);
  const items = steps.map((s, ai) => `<li class="plan-step plan-${tickOf(s)}">${TICK[tickOf(s)]}<span class="sr-only">${STATE_WORD[tickOf(s)]}: </span><div class="min-w-0 flex-1">${actionCard(m.actions[ai], mi, ai, true)}</div></li>`).join('');
  const lead = p.complete
    ? `<div class="plan-summary" role="status"><b>Plan complete.</b> ${esc(planSummary(steps))}.</div>`
    : pending.length ? `<button class="btn-primary plan-all" data-plan-all="${mi}"${m.running ? ' disabled' : ''}>${m.running ? 'Approving…' : 'Approve all reminders and collections'}<span class="plan-count">${pending.length}</span></button>` : '';
  return `<section class="plan" aria-label="Plan with ${p.total} steps">
    <header class="plan-head"><span class="plan-title">Plan · ${p.total} steps</span><span class="plan-count-text" aria-live="polite">${p.done} of ${p.total} done</span></header>
    <progress class="plan-bar" max="${p.total}" value="${p.done}" aria-label="Plan progress"></progress>
    ${lead}
    <ol class="plan-steps">${items}</ol>
    ${hasHighRisk(steps) ? '<p class="card-note plan-note">Invoices, payments and cancellations are always approved one by one.</p>' : ''}
  </section>`;
}

const STARTER_ICON = {
  invoice: '<path d="M5 2.5h6l3 3v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M11 2.5v3h3M6.5 9h5M6.5 11.5h3"/>',
  plan: '<path d="M3 4.5l1.3 1.3 2.2-2.4M3 10.5l1.3 1.3 2.2-2.4M9 5h4.5M9 11h4.5"/>',
  bell: '<path d="M4.5 11V8a3.5 3.5 0 0 1 7 0v3l1 1.5h-9zM6.8 14h2.4"/>',
  percent: '<path d="M12.5 3.5l-9 9M5 6.4a1.3 1.3 0 1 0 0-.01M11 12.6a1.3 1.3 0 1 0 0-.01"/>',
};
const STARTERS = [['invoice', 0], ['plan', 1], ['bell', 2], ['percent', 3]];
const introHtml = () => `<div class="agent-intro">
  <p>Hi, I'm Cuadra. Tell me who to invoice and for what, in English or Spanish. I draft it as a document, the engine checks every figure, and nothing is issued until you press the button.</p>
  <div class="starters" role="list" aria-label="Things to try">${STARTERS.map(([icon, i]) => `<button class="starter" role="listitem" data-ex="${i}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STARTER_ICON[icon]}</svg><span>${esc(EXAMPLES[i])}</span></button>`).join('')}</div>
</div>`;

let chatCount = -1;
let chatFocus = null; // index of a fresh answer to bring to the top of the chat, so its proposal is read from the start
function renderChat() {
  const el = $('#chat');
  for (const key of [...chartJobs.keys()]) if (key.startsWith('chat:')) chartJobs.delete(key);
  const keep = el.scrollTop;
  const wasAtEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  el.innerHTML = state.chat.length
    ? state.chat.map((m, mi) => {
      if (m.role === 'user') return `<div class="bubble-user">${esc(m.text)}</div>`;
      const acts = m.actions || [];
      const body = isPlan(acts) ? planCard(m, mi) : acts.map((a, ai) => actionCard(a, mi, ai)).join('');
      return `<div class="space-y-2"><div class="bubble-agent${m.text === 'Thinking…' ? ' thinking' : ''}">${m.text === 'Thinking…' ? 'Thinking' : md(m.text)}</div>${body}</div>`;
    }).join('')
    : introHtml();
  $('#examples').hidden = !state.chat.length;
  const grew = state.chat.length !== chatCount;
  chatCount = state.chat.length;
  let top = grew || wasAtEnd ? el.scrollHeight : keep;
  const fresh = chatFocus !== null ? el.children[chatFocus] : null;
  if (fresh) top = el.scrollTop + fresh.getBoundingClientRect().top - el.getBoundingClientRect().top - 6;
  chatFocus = null;
  el.scrollTo({ top, behavior: 'instant' });
  mountCharts('chat:', el);
}

function renderKpis() {
  const s = summary(state.records, today());
  const k = [
    [`Taxable base ${s.quarter}`, eur(s.base), `${s.invoices} invoice${s.invoices === 1 ? '' : 's'} this quarter`],
    ['VAT charged', eur(s.vat), 'output VAT this quarter'],
    [`Outstanding · ${s.unpaid}`, eur(s.unpaidTotal), s.overdue ? `<span class="text-bad">${s.overdue} overdue · ${eur(s.overdueTotal)}</span>` : 'nothing overdue'],
    ['Collected', eur(s.collected), 'PayPal and recorded payments'],
  ];
  $('#kpis').innerHTML = k.map(([l, v, sub]) => `<div class="panel kpi"><div class="label">${esc(l)}</div><div class="kpi-value num">${esc(v)}</div><div class="kpi-sub">${sub}</div></div>`).join('');
}

// The ledger: an AG Grid from 768px up (loaded after the first render, see loadGrid), the plain table below 768px, while the
// grid loads, if it cannot load, and for the empty state. Below 640px each table row is drawn as a card (see .ledger in
// styles/input.css), so every cell has a role class. Grid and table share the buttons' data-i / data-do and one click listener.
const wideLedger = matchMedia('(min-width: 768px)');
let gridCtl = null;
let gridState = 'idle'; // idle -> loading -> ready | failed (a failed grid is never retried: the table stays)
const ledgerCountText = () => {
  const invoices = invoicesOf(state.records).length;
  const cancels = state.records.length - invoices;
  return state.records.length ? `${invoices} invoice${invoices === 1 ? '' : 's'}${cancels ? ` · ${cancels} cancellation${cancels === 1 ? '' : 's'}` : ''}` : '';
};
const showLedger = (mode) => {
  const grid = mode === 'grid';
  $('#ledgerGrid').hidden = !grid;
  $('#ledgerTools').hidden = !grid;
  $('#ledgerTable').hidden = grid;
  $('#ledger').dataset.view = mode;
};
const flashNumber = () => (flash && Date.now() - flash.at < FLASH_MS ? flash.number : '');
const brokenIndex = () => (chainVerdict && !chainVerdict.ok ? chainVerdict.index : -1);

function renderChips(counts) {
  const box = $('#ledgerChips');
  if (box.childElementCount !== CHIPS.length) {
    box.innerHTML = CHIPS.map(([key, label]) => `<button type="button" class="chip" data-chip="${key}" aria-pressed="false">${esc(label)} <span class="chip-count"></span></button>`).join('');
  }
  box.querySelectorAll('[data-chip]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.chip === (gridCtl?.chip || 'all')));
    b.querySelector('.chip-count').textContent = counts[b.dataset.chip] ?? 0;
  });
}

// Loads AG Grid after the first render (never blocking it) and swaps the table for it. Any failure leaves the table.
function loadGrid() {
  gridState = 'loading';
  const go = async () => {
    const ag = await loadVendor('grid', { timeout: 3000 });
    if (!ag) { gridState = 'failed'; return; }
    try {
      showLedger('grid'); // the grid is measured when it is created, so it has to be on screen
      gridCtl = createLedgerGrid($('#ledgerGrid'), ag, {
        rows: ledgerRows(state.records, { today: today(), flashNumber: flashNumber(), brokenAt: brokenIndex() }),
        reducedMotion: reducedMotion(),
        onShown: (list) => { $('#ledgerCount').textContent = `${ledgerCountText()}${list.length !== state.records.length ? ` · ${list.length} shown` : ''}`; },
      });
      gridState = 'ready';
    } catch {
      try { gridCtl?.destroy(); } catch { /* nothing to clean */ }
      gridCtl = null;
      gridState = 'failed';
    }
    renderInvoices();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 50);
}
wideLedger.addEventListener('change', () => renderInvoices());

function renderInvoices() {
  $('#ledgerCount').textContent = ledgerCountText();
  ledgerVerdictKey = verdictKey(chainVerdict);
  if (state.records.length && wideLedger.matches && gridState === 'idle') loadGrid();
  if (state.records.length && wideLedger.matches && gridCtl) {
    showLedger('grid');
    const rows = ledgerRows(state.records, { today: today(), flashNumber: flashNumber(), brokenAt: brokenIndex() });
    gridCtl.update(rows);
    renderChips(chipCounts(rows));
    return;
  }
  showLedger('table');
  if (!state.records.length) {
    $('#rows').innerHTML = `<tr class="row-empty"><td colspan="6"><div class="empty">
      <div class="empty-title">Your ledger is empty</div>
      <p>Every invoice you issue becomes a block in the chain above. Start with a sample quarter, or describe your first sale to the agent.</p>
      <div class="empty-actions">
        <button class="btn-primary" data-empty="sample">Load a sample quarter</button>
        <button class="btn-ghost" data-empty="invoice">Invoice someone</button>
        <a class="btn-ghost" href="#agents" data-empty="agents">Connect your own AI agent</a>
      </div>
    </div></td></tr>`;
    return;
  }
  const brokenAt = brokenIndex();
  const lit = (number) => flashNumber() === number;
  $('#rows').innerHTML = state.records.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
    const mark = `${lit(r.number) ? ' row-flash' : ''}${i === brokenAt ? ' row-bad' : ''}`;
    const altered = i === brokenAt ? ' <span class="badge badge-bad" title="This record no longer matches its hash">Altered</span>' : '';
    if (isAnulacion(r)) {
      return `<tr class="row text-soft${mark}">
        <td class="c-num num whitespace-nowrap text-xs">↳ ${esc(r.number)}</td>
        <td class="c-client text-xs" colspan="2">Cancellation record${r.reason ? ` · ${esc(r.reason)}` : ''}</td>
        <td class="c-status"><span class="badge badge-mute">Anulación</span>${altered}</td><td class="c-due hidden xl:table-cell"></td>
        <td class="c-actions text-right"><button class="btn-ghost !min-h-8" data-i="${i}" data-do="view">View</button></td></tr>`;
    }
    const st = status(r);
    const action = !OPEN(st) ? '' : r.paypal?.id
      ? `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="remind">Remind</button>`
      : `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="collect" title="Send with PayPal">Collect</button>`;
    const refresh = r.paypal?.id ? `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="refresh" title="Refresh PayPal status" aria-label="Refresh PayPal status">↻</button>` : '';
    return `<tr class="row${st === 'CANCELLED' ? ' text-soft' : ''}${mark}">
      <td class="c-num num whitespace-nowrap text-xs ${st === 'CANCELLED' ? 'line-through' : ''}" title="${esc(r.hash)}">${esc(r.number)}<span class="c-hash text-soft">${esc(r.hash.slice(0, 6))}</span></td>
      <td class="c-client">${esc(r.recipient?.name)}${r.sample ? ' <span class="text-[11px] text-soft">sample</span>' : ''}</td>
      <td class="c-total num whitespace-nowrap text-right">${eur(r.total)}</td>
      <td class="c-status"><span class="${BADGE[st] || 'badge'}" title="${esc(r.paypal?.error || (r.paypal?.id ? 'On PayPal' : ''))}">${esc(statusWord(st))}</span>${r.paypal?.id ? ' <span class="text-[11px] text-link">PayPal</span>' : ''}${altered}</td>
      <td class="c-due hidden whitespace-nowrap text-xs text-soft xl:table-cell">${r.dueDate && OPEN(st) ? esc(fmtDate(r.dueDate)) : ''}</td>
      <td class="c-actions space-x-1 whitespace-nowrap text-right"><button class="btn-ghost !min-h-8" data-i="${i}" data-do="view">View</button>${refresh}${action}</td>
    </tr>`;
  }).join('');
  // A re-render must not restart the highlight of a record that has just been issued.
  if (flash) $('#rows').querySelectorAll('.row-flash').forEach((tr) => tr.style.setProperty('--flash-elapsed', `${Date.now() - flash.at}ms`));
}

function renderActivity() {
  $('#activityList').innerHTML = activityHtml(activityRows(state.activity, 20));
  const total = state.activity.length;
  $('#activityCount').textContent = total ? `${Math.min(20, total)} of ${total}` : '';
}
setInterval(renderActivity, 30000); // relative times: "2 min ago" keeps counting

function renderVat() {
  const q = vatQ || returnQuarter(today());
  $('#vatQ').textContent = q;
  $('#vatBody').innerHTML = vatTable(vatReturn(state.records, q));
}

// The chain strip. verifyChain() is async, so the blocks are drawn once the verdict is in (a few milliseconds) and
// a 1.2 s sweep then re-checks them visually from left to right; the header says "Verifying" until it ends.
const SWEEP_MS = 1200;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const chainSignature = () => `${state.records.length}|${state.records.at(-1)?.hash || ''}|${tampered ? tampered.i : ''}`;

async function renderChain() {
  const run = ++chainRun;
  const v = await verifyChain(state.records);
  if (run !== chainRun) return; // a newer render superseded this one
  const track = $('#chainTrack');
  chainVerdict = v;
  if (verdictKey(v) !== ledgerVerdictKey) renderInvoices();
  chainNow = chainStatus(state.records, v);
  const sig = chainSignature();
  if (sig !== chainSig) {
    chainSig = sig;
    const motion = !reducedMotion();
    const left = track.scrollLeft;
    track.innerHTML = chainTrackHtml(chainBlocks(state.records, v, { newFrom: chainFx?.newFrom ?? Infinity }));
    chainFx = null;
    track.classList.toggle('sweeping', motion);
    const items = [...track.querySelectorAll('.chain-block')];
    items.forEach((el, i) => el.style.setProperty('--d', `${Math.round((i / Math.max(1, items.length - 1)) * (SWEEP_MS - 450))}ms`));
    const broken = track.querySelector('.chain-block.broken');
    if (broken) broken.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    else if (track.querySelector('.is-new') || state.records.length !== chainCount) track.scrollLeft = track.scrollWidth;
    else track.scrollLeft = left;
    chainCount = state.records.length;
    clearTimeout(statusTimer);
    if (motion && state.records.length) {
      $('#chainStatus').innerHTML = statusHtml({ tone: 'warn', headline: 'Verifying chain…', detail: '' });
      statusTimer = setTimeout(() => { $('#chainStatus').innerHTML = statusHtml(chainNow); }, SWEEP_MS);
    } else {
      $('#chainStatus').innerHTML = statusHtml(chainNow);
    }
  }
  const t = $('#tamper');
  t.textContent = tampered ? 'Undo tampering' : 'Tamper test';
  t.setAttribute('aria-pressed', String(Boolean(tampered)));
  t.disabled = !invoicesOf(state.records).length;
}

function renderPlan() {
  const s = state.subscription;
  const active = s?.status === 'ACTIVE';
  $('#plan').textContent = active ? `${s.plan === 'team' ? 'Gestoría' : 'Autónomo'} plan` : 'Free plan';
  document.querySelectorAll('[data-plan]').forEach((b) => {
    const mine = active && b.dataset.plan === s.plan;
    b.disabled = mine;
    b.textContent = mine ? 'Current plan' : b.dataset.label;
  });
}

// ---------- Insights: the board between the KPIs and the ledger, and the charts of the Insight cards ----------

const chartJobs = new Map(); // chart key -> widgetData, filled while the HTML is built and read when the charts are mounted
let hub = null;
let chartsRetry = null;
let tokens = null;
const tk = () => (tokens ||= readTokens());
const idle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 50));

// AG Charts loads after the first render. Until it is there (or if it never arrives) every card keeps a table of the same figures.
async function chartHub() {
  if (hub) return hub;
  const ag = window.agCharts || await new Promise((done) => idle(() => loadVendor('charts', { timeout: 3000 }).then(done)));
  if (!ag) {
    // A file that arrives late is picked up once, five seconds from now.
    chartsRetry ||= setTimeout(() => { chartsRetry = null; if (window.agCharts) { boardSig = ''; renderBoard(); renderChat(); } }, 5000);
    return null;
  }
  try { hub = createChartHub(ag, { tokens: tk(), fmt: eur }); } catch { hub = null; }
  return hub;
}

async function mountCharts(prefix, root) {
  const slots = () => root.querySelectorAll(`[data-chart^="${prefix}"]`);
  if (!slots().length) { hub?.prune(prefix, new Set()); return; }
  const h = await chartHub();
  if (!h) return;
  const keep = new Set();
  slots().forEach((slot) => {
    const data = chartJobs.get(slot.dataset.chart);
    if (!data) return;
    keep.add(slot.dataset.chart);
    h.mount(slot, slot.dataset.chart, data);
  });
  h.prune(prefix, keep);
}

let boardSig = '';
let newWidgetId = '';
const emptyBoard = () => `<div class="board-empty"><p>No insights pinned yet. Ask a question about your numbers and pin the answer here.</p><div class="board-empty-actions"><button type="button" class="btn-ghost" data-ask="6">${esc(EXAMPLES[6])}</button><button type="button" class="btn-ghost" data-ask="7">${esc(EXAMPLES[7])}</button></div></div>`;

function renderBoard() {
  const widgets = state.widgets;
  $('#board').hidden = !state.records.length && !widgets.length;
  $('#boardCount').textContent = widgets.length ? `${widgets.length} of ${MAX_WIDGETS}` : '';
  const collapsed = Boolean(state.boardCollapsed);
  $('#boardBody').hidden = collapsed;
  const toggle = $('#boardToggle');
  toggle.textContent = collapsed ? 'Show' : 'Hide';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed) return;
  const cards = widgets.map((w) => ({ w, data: widgetData(state.records, w, today()) }));
  // The cards are drawn again only when a widget or one of its figures changed, so a chart is not rebuilt on every render.
  const sig = JSON.stringify(cards.map(({ w, data }) => [w.id, data.type, data.rows, data.n, data.text]));
  if (sig === boardSig) return;
  boardSig = sig;
  for (const key of [...chartJobs.keys()]) if (key.startsWith('board:')) chartJobs.delete(key);
  cards.forEach(({ w, data }) => chartJobs.set(`board:${w.id}`, data));
  $('#boardGrid').innerHTML = cards.length ? cards.map(({ w, data }) => boardCardHtml(w, data, { isNew: w.id === newWidgetId, tokens: tk(), fmt: eur })).join('') : emptyBoard();
  const fresh = newWidgetId ? $(`#boardGrid [data-w="${CSS.escape(newWidgetId)}"]`) : null;
  newWidgetId = '';
  mountCharts('board:', $('#boardGrid'));
  fresh?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' }); // the card that was just pinned
}

function pinWidget(args) {
  const spec = cleanSpec(args);
  if (state.widgets.some((w) => specKey(w) === specKey(spec))) return { ok: true, text: 'Already on the board.', pinned: true };
  if (state.widgets.length >= MAX_WIDGETS) return { ok: false, text: `The board holds ${MAX_WIDGETS} insights. Remove one first.` };
  const w = withId(spec);
  state.widgets.push(w);
  state.boardCollapsed = false;
  newWidgetId = w.id;
  log('you', 'widget_pinned', '', spec.title);
  closeSheet(); // on a phone the sheet gets out of the way, so the new card is seen (renderBoard scrolls to it)
  return { ok: true, text: 'Pinned to the board.', pinned: true };
}

function removeWidget(id) {
  const w = state.widgets.find((x) => x.id === id);
  if (!w) return;
  state.widgets = state.widgets.filter((x) => x.id !== id);
  log('you', 'widget_removed', '', w.title);
  save();
  renderAll();
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'insight';
function exportWidget(id) {
  const w = state.widgets.find((x) => x.id === id);
  if (w) download(`cuadra-insight-${slug(w.title)}.csv`, widgetCsv(widgetData(state.records, w, today())), 'text/csv');
}

function showBoard() {
  state.boardCollapsed = false;
  save();
  renderBoard();
  closeSheet();
  $('#board').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

async function renderAll() {
  const company = `${state.company.name} · NIF ${state.company.nif} · series ${state.company.series}`;
  $('#company').textContent = company;
  $('#menuCompany').textContent = company;
  renderKpis();
  renderBoard();
  renderChat();
  renderInvoices();
  renderVat();
  renderActivity();
  renderPlan();
  updateFab();
  await renderChain();
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* clipboard blocked: fall back to a temporary selection */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function chainFacts(r) {
  return `<div><div class="text-soft">Record hash (SHA-256)</div><div class="num break-all">${esc(r.hash)}</div></div>
    <div><div class="text-soft">Previous record</div><div class="num break-all">${r.prev ? esc(`${r.prev.number} · ${r.prev.hash}`) : 'First record in the chain'}</div></div>
    <div><div class="text-soft">Generated</div><div class="num">${esc(r.generatedAt)}</div></div>`;
}

// The detail of a record: the printable document, what the engine says about it, and what you can do with it.
function openDetail(r) {
  const anul = isAnulacion(r);
  const st = anul ? '' : status(r);
  const xmlBlock = `<details><summary class="cursor-pointer text-fg/80">${anul ? 'RegistroAnulacion' : 'RegistroAlta'} XML</summary><pre class="num mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-ink p-2 text-[11px]">${esc(recordXml(r))}</pre></details>`;
  const actionsHtml = `<div class="flex flex-wrap gap-2"><button class="btn-ghost" data-dl="link">Copy verification link</button><button class="btn-ghost" data-dl="print">Open printable</button><button class="btn-ghost" data-dl="xml">Download XML</button><button class="btn-primary" data-dl="close">Close</button></div>`;
  const pay = r.paypal?.id ? `${esc(r.paypal.status)}${safeUrl(r.paypal.payerUrl) ? ` · <a class="link" href="${esc(r.paypal.payerUrl)}" target="_blank" rel="noopener noreferrer">payer page</a>` : ''}` : r.paidAt ? `Paid by ${esc(METHOD[r.paidMethod] || 'transfer')} on ${esc(fmtDate(r.paidAt))}` : 'Not on PayPal';
  const manage = !anul && OPEN(st) ? `<div class="space-y-2 rounded-lg border border-line p-2"><div class="text-soft">Manage</div>
      <div class="flex flex-wrap gap-2"><select id="payMethod" class="field !w-auto !py-1 text-xs" aria-label="Payment method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select><button class="btn-ghost" data-dl="paid">Mark paid</button></div>
      <div class="flex flex-wrap gap-2"><input id="cancelReason" class="field !w-auto flex-1 !py-1 text-xs" maxlength="200" placeholder="Reason, e.g. duplicate" aria-label="Cancellation reason"><button class="btn-ghost btn-danger" data-dl="cancel">Cancel invoice</button></div></div>` : '';
  $('#dlgBody').innerHTML = `<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
    ${renderDocument(r, { qr: qrSvg, stamp: st === 'CANCELLED' ? 'Cancelled' : '' })}
    <div class="min-w-0 space-y-3 text-xs">
      <div id="dlgVerdict" class="verdict !px-3 !py-2 !text-xs" data-state="checking" role="status">Checking the record…</div>
      ${anul ? '' : `<div><div class="text-soft">Status</div><span class="${BADGE[st] || 'badge'}">${esc(st.replace(/_/g, ' '))}</span></div><div><div class="text-soft">Payment</div><div>${pay}</div></div>`}
      ${chainFacts(r)}
      ${manage}${xmlBlock}${actionsHtml}
    </div>
  </div>`;
  const body = $('#dlgBody');
  // The same check verify.html does, on this record: rebuild it from the shareable fields and re-hash it.
  verifyRecord(sanitizeRecord(shareable(r))).then((v) => {
    const el = body.querySelector('#dlgVerdict');
    if (!el) return;
    el.dataset.state = v.ok ? 'ok' : 'bad';
    el.innerHTML = v.ok ? `<span class="verdict-mark" aria-hidden="true">✓</span> Matches its hash <span class="num">${esc(v.hash.slice(0, 8))}…</span>` : `<span class="verdict-mark" aria-hidden="true">✗</span> Altered: ${esc(v.reason)}`;
    if (!v.ok) body.querySelector('.doc')?.insertAdjacentHTML('afterbegin', '<div class="doc-stamp" aria-hidden="true">Altered</div>');
  }).catch(() => {
    const el = body.querySelector('#dlgVerdict');
    if (el) { el.dataset.state = 'bad'; el.textContent = 'This record could not be checked.'; }
  });
  const act = async (fnc) => { $('#dlg').close(); toast((await fnc()).text); save(); await renderAll(); };
  body.querySelector('[data-dl="paid"]')?.addEventListener('click', () => act(() => markPaid(r, $('#payMethod').value)));
  body.querySelector('[data-dl="cancel"]')?.addEventListener('click', () => {
    if (window.confirm(`Cancel ${r.number}? A VeriFactu cancellation record will be added to the chain.`)) act(() => annul(r, $('#cancelReason').value.trim()));
  });
  body.querySelector('[data-dl="link"]').onclick = async () => {
    try {
      toast((await copyText(await shareUrl(r, location.origin))) ? 'Verification link copied. It opens a printable copy that re-checks the hash in the browser.' : 'Could not copy the link. Use "Open printable" and copy the address from that page.');
    } catch { toast('This record is too large to share as a link.'); }
  };
  body.querySelector('[data-dl="print"]').onclick = async () => {
    try {
      const a = document.createElement('a');
      a.href = await shareUrl(r, location.origin);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch { toast('This record is too large to open as a printable page.'); }
  };
  body.querySelector('[data-dl="xml"]').onclick = () => download(`${r.number}${anul ? '-anulacion' : ''}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n${recordXml(r)}\n`, 'application/xml');
  body.querySelector('[data-dl="close"]').onclick = () => $('#dlg').close();
  $('#dlg').showModal();
}

// ---------- events ----------

// Puts a prompt in the agent's box and moves the focus there (the user reviews it and presses Send).
function askAbout(text) {
  $('#msg').value = text;
  if (wide.matches) $('#agent').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  else openSheet();
  $('#msg').focus({ preventScroll: true });
}

// One turn with the agent: the question goes out with the ledger context, the answer comes back as text and proposals.
async function ask(text) {
  text = String(text || '').trim();
  if (!text) return;
  state.chat.push({ role: 'user', text });
  const pending = { role: 'agent', text: 'Thinking…', actions: [] };
  state.chat.push(pending);
  renderChat();
  const r = await post('/api/agent', { message: text, context: context(), history: chatHistory() });
  // A model that answers with proposals and no text gets its sentence written here, from the proposals and the ledger.
  const said = r.synthesize ? synthReply(r.actions, { records: state.records, today: today(), lang: detectLang(text) }) : '';
  pending.text = r.error ? `⚠ ${r.error}` : said || r.reply;
  pending.actions = r.error ? [] : (r.actions || []).slice(0, 10);
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  chatFocus = Math.max(0, state.chat.indexOf(pending) - 1); // the question and its answer, read from the top
  const n = pending.actions.length;
  if (n) log('agent', 'proposal', '', n > 1 ? `Plan · ${n} steps` : describe(pending.actions[0]));
  // The chat is re-drawn as a whole, so it is not a live region: the answer is announced once, here.
  $('#srLive').textContent = `Cuadra: ${pending.text}${n ? ` ${n === 1 ? '1 proposal is' : `${n} proposals are`} waiting for your decision.` : ''}`;
  save();
  await renderAll();
}

$('#ask').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = $('#msg').value.trim();
  if (!text) return;
  $('#msg').value = '';
  ask(text);
});

$('#chat').addEventListener('click', async (ev) => {
  const all = ev.target.closest('button[data-plan-all]');
  if (all) return approveAll(Number(all.dataset.planAll));
  if (ev.target.closest('button[data-board="show"]')) return showBoard();
  const view = ev.target.closest('button[data-view]');
  if (view) {
    const rec = findInvoice(state.records, view.dataset.view);
    if (rec) openDetail(rec);
    return;
  }
  const starter = ev.target.closest('[data-ex]');
  if (starter) return ask(EXAMPLES[starter.dataset.ex]);
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const [mi, ai] = b.dataset.id.split('-').map(Number);
  const a = state.chat[mi]?.actions?.[ai];
  if (!a) return;
  if (b.dataset.act === 'open-vat') {
    vatQ = b.dataset.q;
    renderVat();
    closeSheet();
    $('#vat').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    if (!a.done) await run(mi, ai, 'open-vat');
    return;
  }
  await run(mi, ai, b.dataset.act);
});

// One listener for the buttons of the table (#rows) and of the grid (#ledgerGrid): both carry data-i and data-do.
async function ledgerClick(ev) {
  const empty = ev.target.closest('[data-empty]');
  if (empty?.dataset.empty === 'sample') return loadSample();
  if (empty?.dataset.empty === 'invoice') return askAbout(EXAMPLES[0]);
  if (ev.target.closest('[data-grid="clear"]')) return clearLedgerFilters();
  const b = ev.target.closest('button[data-i]');
  if (!b) return;
  const rec = state.records[Number(b.dataset.i)];
  if (!rec) return;
  if (b.dataset.do === 'view') return openDetail(rec);
  b.disabled = true;
  if (b.dataset.do === 'refresh') {
    const r = await post('/api/paypal', { op: 'status', id: rec.paypal.id, token: rec.paypal.token });
    if (r.error) toast(r.error);
    else {
      if (r.status !== rec.paypal.status) log('paypal', 'sync', rec.number, `${rec.paypal.status} → ${r.status}`);
      Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
    }
  } else if (b.dataset.do === 'remind') {
    toast((await remind(rec)).text);
  } else if (b.dataset.do === 'collect') {
    toast((await sendWithPaypal(rec)).text);
  }
  save();
  await renderAll();
}
$('#rows').addEventListener('click', ledgerClick);
$('#ledgerGrid').addEventListener('click', ledgerClick);

// Grid toolbar: quick filter, status chips, CSV of the rows that are showing.
function clearLedgerFilters() {
  $('#ledgerSearch').value = '';
  gridCtl?.setQuick('');
  gridCtl?.setChip('all');
  if (gridCtl) renderChips(chipCounts(ledgerRows(state.records, { today: today() })));
}
let searchTimer;
$('#ledgerSearch').addEventListener('input', (ev) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => gridCtl?.setQuick(ev.target.value), 120);
});
$('#ledgerChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-chip]');
  if (!b || !gridCtl) return;
  gridCtl.setChip(b.dataset.chip);
  $('#ledgerChips').querySelectorAll('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
});
const exportLedgerCsv = () => {
  if (gridCtl && wideLedger.matches && state.records.length) return gridCtl.exportCsv('cuadra-libro-registro.csv');
  download('cuadra-libro-registro.csv', registerCsv(ledgerRows(state.records, { today: today() }).sort((a, b) => a.i - b.i)), 'text/csv');
};
$('#ledgerCsv').onclick = exportLedgerCsv;

$('#boardToggle').onclick = () => { state.boardCollapsed = !state.boardCollapsed; save(); renderBoard(); };
$('#boardGrid').addEventListener('click', (ev) => {
  const remove = ev.target.closest('[data-w-remove]');
  if (remove) return removeWidget(remove.dataset.wRemove);
  const csv = ev.target.closest('[data-w-csv]');
  if (csv) return exportWidget(csv.dataset.wCsv);
  const example = ev.target.closest('[data-ask]');
  if (example) {
    if (!wide.matches) openSheet();
    ask(EXAMPLES[Number(example.dataset.ask)]);
  }
});

$('#chainTrack').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-i]');
  const rec = b && state.records[Number(b.dataset.i)];
  if (rec) openDetail(rec);
});

$('#vatPrev').onclick = () => { vatQ = previousQuarter(vatQ || returnQuarter(today())); renderVat(); };
$('#vatNext').onclick = () => {
  const [y, q] = (vatQ || returnQuarter(today())).split('-Q').map(Number);
  const next = q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
  if (next <= quarterOfIso(today())) { vatQ = next; renderVat(); }
};
$('#vatCsv').onclick = () => {
  const v = vatReturn(state.records, vatQ || returnQuarter(today()));
  const lines = ['casilla,concepto,importe', ...v.rows.flatMap((r) => [[r.boxes[0], `Base imponible ${r.rate}%`, r.base], [r.boxes[1], 'Tipo %', money(r.rate)], [r.boxes[2], `Cuota ${r.rate}%`, r.tax]]), ['27', 'Total cuota devengada', v.boxes['27']]].map((x) => (Array.isArray(x) ? x.join(',') : x));
  download(`cuadra-modelo-303-${v.quarter}.csv`, lines.join('\n'), 'text/csv');
};

// Tamper test: alter an issued amount in memory (never saved) so the chain visibly breaks at that record, and undo it.
// Returns true when the state changed. The first-visit tour uses the same two moves.
async function setTamper(on) {
  const altas = state.records.map((r, i) => (isAnulacion(r) ? -1 : i)).filter((i) => i >= 0);
  if (!altas.length || Boolean(tampered) === on) return false;
  if (on) {
    const i = altas.length > 1 ? altas[altas.length - 2] : altas[0];
    tampered = { i, total: state.records[i].total };
    state.records[i].total = money(Number(state.records[i].total) + 100);
    log('you', 'tamper_on', state.records[i].number, `Total changed from ${eur(tampered.total)} to ${eur(state.records[i].total)} in memory only, nothing is saved`);
  } else {
    const rec = state.records[tampered.i];
    rec.total = tampered.total;
    tampered = null;
    log('you', 'tamper_off', rec.number, `Original total ${eur(rec.total)} restored`);
  }
  save(); // a no-op while the amount is altered: a tampered ledger is never stored
  await renderAll();
  return true;
}
$('#tamper').onclick = () => setTamper(!tampered);

$('#xml').onclick = () => download('cuadra-verifactu-records.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<RegistrosFacturacion>\n${state.records.map(recordXml).join('\n')}\n</RegistrosFacturacion>\n`, 'application/xml');
$('#exportActivity').onclick = () => download('cuadra-activity.json', `${JSON.stringify({ company: state.company, exportedAt: new Date().toISOString(), entries: state.activity }, null, 2)}\n`, 'application/json');
// With the grid on screen the export goes through the grid's own API (it writes the rows you see, filter and sort
// applied); otherwise the same register format is written from the records.
$('#csv').onclick = exportLedgerCsv;

// A new ledger replaces the records and the chat, but never the activity log (it is append-only) or the plan.
function startOver() {
  const { activity, subscription } = state;
  tampered = null;
  state = fresh();
  state.activity = activity;
  if (subscription) state.subscription = subscription;
}

async function loadSample(actor = 'you') {
  startOver();
  state.records = await buildSample({ issuer: state.company, today: today() });
  state.widgets = defaultBoard().map(withId);
  vatQ = null;
  log(actor, 'sample', '', `${state.records.length} records: paid, overdue, open and one cancelled`);
  save();
  await renderAll();
}
$('#sample').onclick = async () => {
  if (state.records.length && !window.confirm('Replace your demo ledger with a sample quarter?')) return;
  await loadSample();
  toast('Sample quarter loaded: paid, overdue and open invoices, plus one cancelled duplicate.');
  if (!tourSeen()) runTour();
};
$('#reset').onclick = async () => {
  if (!window.confirm('Delete all demo invoices and start with an empty ledger?')) return;
  startOver();
  log('you', 'reset', '', 'Ledger emptied');
  save();
  await renderAll();
};

// Overflow menu in the top bar: sample quarter, empty ledger and the exports.
const menu = $('#menu');
const menuBtn = $('#menuBtn');
const menuItems = () => [...menu.querySelectorAll('[role="menuitem"]')];
const setMenu = (open) => {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
};
menuBtn.onclick = () => {
  setMenu(menu.hidden);
  if (!menu.hidden) menuItems()[0].focus();
};
document.addEventListener('click', (ev) => { if (!menu.hidden && !ev.target.closest('#menu, #menuBtn')) setMenu(false); });
menu.addEventListener('click', (ev) => { if (ev.target.closest('[role="menuitem"]')) setMenu(false); });
menu.addEventListener('keydown', (ev) => {
  const items = menuItems();
  const at = items.indexOf(document.activeElement);
  const to = { ArrowDown: (at + 1) % items.length, ArrowUp: (at - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[ev.key];
  if (to === undefined) return;
  ev.preventDefault();
  items[to].focus();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || menu.hidden) return;
  setMenu(false);
  menuBtn.focus();
});

// The agent as a sheet on small screens: a floating "Ask Cuadra" button opens it full screen, Escape or the close
// button shuts it, and the rest of the page is inert while it is open. From 1024px up it is a normal column.
const wide = matchMedia('(min-width: 1024px)');
const sheetOpen = () => document.body.classList.contains('sheet-open');
const BEHIND = ['header', '#chainStrip', '#rightCol', '#pricing', '#agents', 'footer'];
let sheetFrom = null;
function openSheet() {
  if (wide.matches || sheetOpen()) return;
  sheetFrom = document.activeElement;
  tour?.stop();
  document.body.classList.add('sheet-open');
  const agent = $('#agent');
  agent.setAttribute('role', 'dialog');
  agent.setAttribute('aria-modal', 'true');
  agent.tabIndex = -1;
  BEHIND.forEach((q) => document.querySelectorAll(q).forEach((el) => { el.inert = true; }));
  agent.focus({ preventScroll: true });
}
function closeSheet() {
  if (!sheetOpen()) return;
  document.body.classList.remove('sheet-open');
  const agent = $('#agent');
  ['role', 'aria-modal', 'tabindex'].forEach((a) => agent.removeAttribute(a));
  BEHIND.forEach((q) => document.querySelectorAll(q).forEach((el) => { el.inert = false; }));
  (sheetFrom?.isConnected ? sheetFrom : $('#openAgent')).focus?.({ preventScroll: true });
  sheetFrom = null;
}
$('#openAgent').onclick = openSheet;
$('#sheetClose').onclick = closeSheet;
wide.addEventListener('change', () => { if (wide.matches) closeSheet(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sheetOpen() && !$('#dlg').open && menu.hidden) closeSheet(); });
document.querySelector('a[href="#msg"]').addEventListener('click', (ev) => {
  if (wide.matches) return;
  ev.preventDefault();
  openSheet();
});
// The button tells how many proposals are still waiting for a decision.
function updateFab() {
  const open = state.chat.flatMap((m) => m.actions || []).filter((a) => !a.done && a.type !== 'show_vat_return' && a.type !== 'propose_widget' && !isDeadEnd(a)).length;
  const fab = $('#openAgent');
  fab.dataset.pending = String(open);
  fab.setAttribute('aria-label', open ? `Ask Cuadra, ${open} proposal${open === 1 ? '' : 's'} waiting for you` : 'Ask Cuadra');
}

// First-visit tour: four captions over the real page. The same tour opens from the "?" button and from ?tour=1.
let tour = null;
let tourTamper = false;
const TOUR = [
  { title: 'Describe the sale. The agent proposes, you confirm.', text: 'Say who to invoice and for what. Nothing is issued until you press the button.', target: () => (wide.matches ? $('#agent') : $('#openAgent') || $('#agent')) },
  { title: 'Every invoice is a VeriFactu record, hash-chained.', text: 'Each block is one record. It carries the hash of the one before it and is re-verified whenever the ledger changes.', target: () => $('#chainStrip') },
  {
    title: 'Try to tamper: the chain breaks at the record.',
    text: 'One amount is changed in memory: its stored hash no longer matches, and every block after it turns grey.',
    target: () => $('#chainStrip'),
    enter: async () => { tourTamper = await setTamper(true); },
    leave: async () => { if (tourTamper) { tourTamper = false; await setTamper(false); } },
  },
  { title: 'Collect with PayPal, chase late payers, draft your VAT.', text: 'Reminders, collections and the Modelo 303 draft all come from the same ledger.', target: () => [$('#ledger'), $('#vat')], block: 'start' },
];
async function runTour(explicit = false) {
  await tour?.stop();
  if (!state.records.length) await loadSample('system'); // the tour needs a ledger to talk about
  tour = startTour(TOUR, {
    focus: explicit,
    onEnd: () => {
      tour = null;
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      if (wide.matches) $('#msg').focus({ preventScroll: true });
    },
  });
}
$('#tourBtn').onclick = () => runTour(true);
// Someone who starts typing, or opens the agent sheet, is using the app: the tour steps aside.
$('#msg').addEventListener('focus', () => tour?.stop());

// Pricing: Cuadra's own plans are PayPal Subscriptions, created server-side and approved on PayPal.
document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
  b.disabled = true;
  b.textContent = 'Opening PayPal…';
  const r = await post('/api/paypal', { op: 'subscribe', plan: b.dataset.plan });
  if (r.error) {
    toast(r.error);
    renderPlan();
    b.disabled = false;
    return;
  }
  state.subscription = { id: r.id, token: r.token, plan: b.dataset.plan, status: r.status };
  save();
  if (r.id.startsWith('I-MOCK')) location.assign('/?subscription=done');
  else location.assign(r.approveUrl);
}));

async function checkSubscription() {
  const p = new URLSearchParams(location.search).get('subscription');
  if (!p) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const s = state.subscription;
  if (p !== 'done' || !s?.id) return toast('Subscription not completed. You are still on the free plan.');
  const r = await post('/api/paypal', { op: 'subscription', id: s.id, token: s.token });
  if (r.error) return toast(r.error);
  s.status = r.status;
  save();
  renderPlan();
  toast(r.status === 'ACTIVE' ? 'Subscription active. Thank you!' : `Subscription status: ${r.status.toLowerCase().replace(/_/g, ' ')}.`);
}

$('#examples').innerHTML = EXAMPLES.map((e, i) => `<button class="chip" data-ex="${i}">${esc(e)}</button>`).join('');
$('#examples').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ex]');
  if (!b) return;
  $('#msg').value = EXAMPLES[b.dataset.ex];
  $('#ask').requestSubmit();
});

// Voice input where the browser supports it (Chrome, Edge, Safari): speak the sale, then review the proposal.
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Speech) {
  const mic = $('#mic');
  mic.classList.remove('hidden');
  let rec = null;
  mic.onclick = () => {
    if (rec) return rec.stop();
    rec = new Speech();
    rec.lang = navigator.language?.startsWith('es') ? 'es-ES' : 'en-US';
    rec.interimResults = true;
    rec.onresult = (e) => { $('#msg').value = [...e.results].map((x) => x[0].transcript).join(' '); };
    rec.onend = () => {
      rec = null;
      mic.classList.remove('btn-rec');
      mic.setAttribute('aria-pressed', 'false');
      if ($('#msg').value.trim()) $('#ask').requestSubmit();
    };
    rec.onerror = () => toast('Voice input is not available. Type instead.');
    mic.classList.add('btn-rec');
    mic.setAttribute('aria-pressed', 'true');
    rec.start();
  };
}

// The tour starts by itself on the first visit to the plain page, and always with ?tour=1 (never in the local self-test).
const query = new URLSearchParams(location.search);
const wantsTour = !location.hash.startsWith('#selftest') && (query.get('tour') === '1' || (!location.hash && !query.get('subscription') && !tourSeen()));
if (firstVisit) await loadSample('system');
await renderAll();
await checkSubscription();
syncPaypal();
if (wantsTour) runTour(query.get('tour') === '1');

// Local visual self-test (localhost only): plays the demo flow so a headless browser can screenshot it.
//   #selftest          sample quarter, invoice approved with PayPal, chase plan (first step), VAT draft,
//                      "Close my quarter" plan approved in one go, an insight pinned to the board, tamper test on and off
//   #selftest-tamper   the same, but it stops with the tamper test on (broken chain)
//   #selftest-detail   the same, then opens the detail of the last invoice
// body[data-selftest] becomes "done" when the flow has finished.
if (location.hostname === 'localhost' && location.hash.startsWith('#selftest')) {
  document.body.dataset.selftest = 'running';
  await loadSample();
  const click = (selector) => [...document.querySelectorAll(selector)].at(-1)?.click();
  const say = async (text, then) => {
    $('#msg').value = text;
    $('#ask').requestSubmit();
    for (let i = 0; i < 80 && state.chat.at(-1)?.text === 'Thinking…'; i++) await sleep(100);
    await sleep(250);
    if (then) then();
    await sleep(700);
  };
  await say(EXAMPLES[0], () => click('#chat button[data-act="issue-send"]'));
  await say(EXAMPLES[2], () => document.querySelector('#chat button[data-act="collect"]')?.click());
  await say(EXAMPLES[3], () => click('#chat button[data-act="open-vat"]'));
  await say(EXAMPLES[1], () => click('#chat [data-plan-all]'));
  await say(EXAMPLES[7], () => click('#chat button[data-act="pin"]'));
  await sleep(1800);
  window.scrollTo(0, 0);
  await setTamper(true);
  await sleep(600);
  if (location.hash !== '#selftest-tamper') await setTamper(false);
  if (location.hash === '#selftest-detail') openDetail(invoicesOf(state.records).at(-1));
  document.body.dataset.selftest = 'done';
}
