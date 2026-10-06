import { buildAlta, buildAnulacion, verifyChain, recordXml, money, validNif, totals, isAnulacion } from './js/verifactu.js';
import {
  stateOf, summary, vatReturn, returnQuarter, previousQuarter, clients, cancelledNumbers, invoicesOf, findInvoice,
  nextNumber, buildSample, addDays, daysBetween, isoFromDmy, quarterOfIso,
} from './js/ledger.js';

import { esc, eur, fmtDate, isoToday, md, safeUrl } from './js/fmt.js';
import { chainBlocks, chainStatus, chainTrackHtml, statusHtml } from './js/chain.js';
import { engineChecks, checksHtml } from './js/checks.js';
import { proposalPaperHtml } from './js/proposal.js';
import { isPlan, planProgress, planSummary, pendingLowRisk, hasHighRisk } from './js/plan.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = 'cuadra-demo-v1';
const BADGE = { PAID: 'badge badge-ok', MARKED_AS_PAID: 'badge badge-ok', OVERDUE: 'badge badge-bad', ERROR: 'badge badge-bad', CANCELLED: 'badge badge-mute', SENT: 'badge badge-warn', UNPAID: 'badge badge-warn', PARTIALLY_PAID: 'badge badge-warn' };
const METHOD = { BANK_TRANSFER: 'bank transfer', CASH: 'cash', OTHER: 'other method' };
const OPEN = (s) => s !== 'PAID' && s !== 'CANCELLED';
const EXAMPLES = [
  'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60',
  'Close my quarter',
  'Chase every overdue invoice',
  'Prepare my VAT return',
  'Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA',
  'Hotel Mirador paid by bank transfer',
  'Who owes me money?',
];

const fresh = () => ({
  company: { name: 'Estudio Norte SL', nif: 'B76543214', series: `CU${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4).toUpperCase()}` },
  records: [],
  chat: [],
});
let tampered = null;
let vatQ = null;
let chainSig = '';
let chainRun = 0;
let chainFx = null; // { newFrom }: records at or after this index just entered the chain and animate in
let chainNow = null;
let statusTimer;
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
const firstVisit = !state;
state = state || fresh();
state.chat = (state.chat || []).filter((m) => m.text !== 'Thinking…');
for (const m of state.chat) { delete m.running; for (const a of m.actions || []) delete a.busy; }
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
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 4500);
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
  return `[Proposed ${a.type.replace('propose_', '').replace('show_', 'show ')}${a.args?.number ? ` for ${a.args.number}` : ''}${done}]`;
}
const chatHistory = () => state.chat.slice(0, -2).slice(-8)
  .filter((m) => !String(m.text).startsWith('⚠'))
  .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: [m.text, ...(m.actions || []).map(actionTrace)].join('\n').slice(0, 800) }));

function normalize(args = {}) {
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
  save();
  await renderAll();
  if (!withPaypal) return { ok: true, number, text: `Issued ${number}. VeriFactu record chained.` };
  const error = await collect(rec);
  return error ? { ok: false, number, text: `Issued ${number}, but PayPal failed: ${error}` } : { ok: true, number, text: `Issued ${number} and sent with PayPal.` };
}

async function sendWithPaypal(rec) {
  if (rec.paypal?.id) return { ok: false, text: `${rec.number} is already on PayPal.` };
  if (!OPEN(status(rec))) return { ok: false, text: `${rec.number} is ${status(rec).toLowerCase()}, nothing to collect.` };
  const error = await collect(rec);
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
  state.records.push(await buildAnulacion({ issuer: state.company, target: rec, prev: state.records.at(-1), reason }));
  chainFx = { newFrom: state.records.length - 1 };
  return { ok: true, text: `${rec.number} cancelled with a chained VeriFactu cancellation record${rec.paypal?.id ? '; the PayPal invoice is cancelled too' : ''}.` };
}

// Runs one proposal of the agent after the user approved it (act = the button's data-act) and stores the outcome on it.
async function perform(a, act) {
  const rec = findInvoice(state.records, a.args?.number);
  let r;
  if (act === 'discard') r = { ok: true, text: 'Dismissed.', skipped: true };
  else if (act === 'issue' || act === 'issue-send') r = await issue(normalize(a.args), act === 'issue-send');
  else if (act === 'open-vat') r = { ok: true, text: 'Opened the VAT draft.' };
  else if (!rec) r = { ok: false, text: 'Invoice not found.' };
  else if (act === 'remind') r = await remind(rec);
  else if (act === 'collect') r = await sendWithPaypal(rec);
  else if (act === 'mark-paid') r = await markPaid(rec, METHOD[a.args?.method] ? a.args.method : 'BANK_TRANSFER');
  else if (act === 'cancel') r = await annul(rec, String(a.args?.reason || '').slice(0, 200));
  else return;
  Object.assign(a, { done: r.text, ok: r.ok, ...(r.skipped ? { skipped: true } : {}), ...(r.number ? { number: r.number } : {}) });
}

async function run(mi, ai, act) {
  const a = state.chat[mi]?.actions?.[ai];
  if (!a || a.done || a.busy) return;
  a.busy = true;
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
  if (a.type === 'propose_invoice' || a.type === 'show_vat_return') return false;
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
const tickOf = (s) => (s.busy ? 'busy' : s.skipped || s.dead || s.done === 'Dismissed.' ? 'skip' : s.done ? (s.ok === false ? 'fail' : 'done') : 'todo');

// Two or more actions in one reply become a plan: a checklist, each step approved on its own.
function planCard(m, mi) {
  const steps = stepViews(m.actions);
  const p = planProgress(steps);
  const pending = pendingLowRisk(steps);
  const items = steps.map((s, ai) => `<li class="plan-step plan-${tickOf(s)}">${TICK[tickOf(s)]}<div class="min-w-0 flex-1">${actionCard(m.actions[ai], mi, ai, true)}</div></li>`).join('');
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
  const keep = el.scrollTop;
  const wasAtEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  el.innerHTML = state.chat.length
    ? state.chat.map((m, mi) => {
      if (m.role === 'user') return `<div class="bubble-user">${esc(m.text)}</div>`;
      const acts = m.actions || [];
      const body = isPlan(acts) ? planCard(m, mi) : acts.map((a, ai) => actionCard(a, mi, ai)).join('');
      return `<div class="space-y-2"><div class="bubble-agent${m.text === 'Thinking…' ? ' thinking' : ''}">${md(m.text)}</div>${body}</div>`;
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

function renderInvoices() {
  const invoices = invoicesOf(state.records).length;
  const cancels = state.records.length - invoices;
  $('#ledgerCount').textContent = state.records.length ? `${invoices} invoice${invoices === 1 ? '' : 's'}${cancels ? ` · ${cancels} cancellation${cancels === 1 ? '' : 's'}` : ''}` : '';
  if (!state.records.length) {
    $('#rows').innerHTML = '<tr><td colspan="6" class="py-8 text-center text-sm text-soft">No invoices yet. Ask the agent to create one, or <button class="link" data-sample="1">load a sample quarter</button>.</td></tr>';
    return;
  }
  $('#rows').innerHTML = state.records.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
    if (isAnulacion(r)) {
      return `<tr class="text-soft">
        <td class="num whitespace-nowrap text-xs">↳ ${esc(r.number)}</td>
        <td class="text-xs" colspan="2">Cancellation record${r.reason ? ` · ${esc(r.reason)}` : ''}</td>
        <td><span class="badge badge-mute">Anulación</span></td><td class="hidden xl:table-cell"></td>
        <td class="text-right"><button class="btn-ghost !min-h-8" data-i="${i}" data-do="view">View</button></td></tr>`;
    }
    const st = status(r);
    const action = !OPEN(st) ? '' : r.paypal?.id
      ? `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="remind">Remind</button>`
      : `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="collect" title="Send with PayPal">Collect</button>`;
    const refresh = r.paypal?.id ? `<button class="btn-ghost !min-h-8" data-i="${i}" data-do="refresh" title="Refresh PayPal status" aria-label="Refresh PayPal status">↻</button>` : '';
    return `<tr class="${st === 'CANCELLED' ? 'text-soft' : ''}">
      <td class="num whitespace-nowrap text-xs ${st === 'CANCELLED' ? 'line-through' : ''}" title="${esc(r.hash)}">${esc(r.number)}</td>
      <td>${esc(r.recipient?.name)}${r.sample ? ' <span class="text-[11px] text-soft">sample</span>' : ''}</td>
      <td class="num whitespace-nowrap text-right">${eur(r.total)}</td>
      <td><span class="${BADGE[st] || 'badge'}" title="${esc(r.paypal?.error || (r.paypal?.id ? 'On PayPal' : ''))}">${esc(st.replace(/_/g, ' '))}</span>${r.paypal?.id ? ' <span class="text-[11px] text-link">PayPal</span>' : ''}</td>
      <td class="hidden whitespace-nowrap text-xs text-soft xl:table-cell">${r.dueDate && OPEN(st) ? esc(fmtDate(r.dueDate)) : ''}</td>
      <td class="space-x-1 whitespace-nowrap text-right"><button class="btn-ghost !min-h-8" data-i="${i}" data-do="view">View</button>${refresh}${action}</td>
    </tr>`;
  }).join('');
}

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
  chainNow = chainStatus(state.records, v);
  const sig = chainSignature();
  if (sig !== chainSig) {
    chainSig = sig;
    const motion = !reducedMotion();
    const left = track.scrollLeft;
    track.innerHTML = chainTrackHtml(chainBlocks(state.records, v, { newFrom: chainFx?.newFrom ?? Infinity }));
    chainFx = null;
    track.classList.toggle('sweeping', motion);
    const items = [...track.querySelectorAll('.block')];
    items.forEach((el, i) => el.style.setProperty('--d', `${Math.round((i / Math.max(1, items.length - 1)) * (SWEEP_MS - 450))}ms`));
    const broken = track.querySelector('.block.broken');
    if (broken) broken.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    else if (track.querySelector('.is-new')) track.scrollLeft = track.scrollWidth;
    else track.scrollLeft = left;
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

async function renderAll() {
  const company = `${state.company.name} · NIF ${state.company.nif} · series ${state.company.series}`;
  $('#company').textContent = company;
  $('#menuCompany').textContent = company;
  renderKpis();
  renderChat();
  renderInvoices();
  renderVat();
  renderPlan();
  await renderChain();
}

function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function chainFacts(r) {
  return `<div><div class="text-soft">Record hash (SHA-256)</div><div class="num break-all">${esc(r.hash)}</div></div>
    <div><div class="text-soft">Previous record</div><div class="num break-all">${r.prev ? esc(`${r.prev.number} · ${r.prev.hash}`) : 'First record in the chain'}</div></div>
    <div><div class="text-soft">Generated</div><div class="num">${esc(r.generatedAt)}</div></div>`;
}

function openDetail(r) {
  const xmlBlock = `<details><summary class="cursor-pointer text-fg/80">${isAnulacion(r) ? 'RegistroAnulacion' : 'RegistroAlta'} XML</summary><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-ink p-2 text-[10px]">${esc(recordXml(r))}</pre></details>`;
  const closeBtns = '<div class="flex flex-wrap gap-2"><button class="btn-ghost" data-dl="xml">Download XML</button><button class="btn-primary" data-dl="close">Close</button></div>';
  if (isAnulacion(r)) {
    $('#dlgBody').innerHTML = `<div class="max-w-xl space-y-3 text-xs"><div class="text-base font-semibold">Cancellation of ${esc(r.number)}</div>
      <p class="text-soft">A RegistroAnulacion identifies the cancelled invoice and is chained like any other record. The original invoice stays in the ledger untouched.${r.reason ? ` Reason: ${esc(r.reason)}.` : ''}</p>${chainFacts(r)}${xmlBlock}${closeBtns}</div>`;
  } else {
    const st = status(r);
    const rows = (r.lines || []).map((l) => `<tr class="border-t border-black/10"><td class="py-1 pr-2">${esc(l.description)}</td><td class="pr-2 text-right">${l.qty}</td><td class="pr-2 text-right">${eur(l.price)}</td><td class="text-right">${l.vat}%</td></tr>`).join('');
    const pay = r.paypal?.id ? `${esc(r.paypal.status)}${safeUrl(r.paypal.payerUrl) ? ` · <a class="text-link underline" href="${esc(r.paypal.payerUrl)}" target="_blank" rel="noopener noreferrer">payer page</a>` : ''}` : r.paidAt ? `Paid by ${esc(METHOD[r.paidMethod] || 'transfer')} on ${esc(fmtDate(r.paidAt))}` : 'Not on PayPal';
    const manage = OPEN(st) ? `<div class="space-y-2 rounded-lg border border-white/10 p-2"><div class="text-soft">Manage</div>
      <div class="flex flex-wrap gap-2"><select id="payMethod" class="field !w-auto !py-1 text-xs" aria-label="Payment method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select><button class="btn-ghost" data-dl="paid">Mark paid</button></div>
      <div class="flex flex-wrap gap-2"><input id="cancelReason" class="field !w-auto flex-1 !py-1 text-xs" maxlength="200" placeholder="Reason, e.g. duplicate" aria-label="Cancellation reason"><button class="btn-ghost btn-danger" data-dl="cancel">Cancel invoice</button></div></div>` : '';
    $('#dlgBody').innerHTML = `
    <div class="grid gap-5 md:grid-cols-[1fr_260px]">
      <div class="rounded-xl bg-paper p-5 text-paper-ink">
        <div class="flex justify-between gap-4">
          <div><div class="text-lg font-bold">${esc(r.issuerName)}</div><div class="text-xs text-paper-soft">NIF ${esc(r.nif)}</div></div>
          <div class="text-right"><div class="text-xs text-paper-soft">Invoice${st === 'CANCELLED' ? ' · CANCELLED' : ''}</div><div class="font-mono font-semibold">${esc(r.number)}</div><div class="text-xs text-paper-soft">${esc(r.date)}${r.dueDate ? ` · due ${esc(fmtDate(r.dueDate))}` : ''}</div></div>
        </div>
        <div class="mt-4 text-sm"><div class="text-xs text-paper-soft">Bill to</div><div class="font-medium">${esc(r.recipient?.name)}</div>${r.recipient?.nif ? `<div class="text-xs text-paper-soft">NIF ${esc(r.recipient.nif)}</div>` : ''}</div>
        <table class="mt-4 w-full text-sm"><thead class="text-xs text-paper-soft"><tr><th class="text-left">Description</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">VAT</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="mt-3 space-y-0.5 text-right text-sm">${r.breakdown.map((b) => `<div class="text-paper-soft">Base ${b.rate}%: ${eur(b.base)} · VAT ${eur(b.tax)}</div>`).join('')}<div class="text-base font-bold">Total ${eur(r.total)}</div></div>
        <div class="mt-4 flex items-end gap-3 border-t border-black/10 pt-3">
          <div class="w-28 shrink-0">${qrSvg(r.qr)}<div class="text-center text-[10px] font-bold tracking-wider">VERI*FACTU</div></div>
          <div class="break-all text-[10px] text-paper-soft">Invoice verifiable at the Spanish Tax Agency (AEAT test service).<br>${esc(r.qr)}</div>
        </div>
      </div>
      <div class="min-w-0 space-y-3 text-xs">
        <div><div class="text-soft">Status</div><span class="${BADGE[st] || 'badge'}">${esc(st.replace(/_/g, ' '))}</span></div>
        ${chainFacts(r)}
        <div><div class="text-soft">Payment</div><div>${pay}</div></div>
        ${manage}${xmlBlock}${closeBtns}
      </div>
    </div>`;
    const act = async (fnc) => { $('#dlg').close(); toast((await fnc()).text); save(); await renderAll(); };
    $('#dlgBody').querySelector('[data-dl="paid"]')?.addEventListener('click', () => act(() => markPaid(r, $('#payMethod').value)));
    $('#dlgBody').querySelector('[data-dl="cancel"]')?.addEventListener('click', () => {
      if (window.confirm(`Cancel ${r.number}? A VeriFactu cancellation record will be added to the chain.`)) act(() => annul(r, $('#cancelReason').value.trim()));
    });
  }
  $('#dlgBody').querySelector('[data-dl="xml"]').onclick = () => download(`${r.number}${isAnulacion(r) ? '-anulacion' : ''}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n${recordXml(r)}\n`, 'application/xml');
  $('#dlgBody').querySelector('[data-dl="close"]').onclick = () => $('#dlg').close();
  $('#dlg').showModal();
}

// ---------- events ----------

// One turn with the agent: the question goes out with the ledger context, the answer comes back as text and proposals.
async function ask(text) {
  text = String(text || '').trim();
  if (!text) return;
  state.chat.push({ role: 'user', text });
  const pending = { role: 'agent', text: 'Thinking…', actions: [] };
  state.chat.push(pending);
  renderChat();
  const r = await post('/api/agent', { message: text, context: context(), history: chatHistory() });
  pending.text = r.error ? `⚠ ${r.error}` : r.reply;
  pending.actions = r.error ? [] : (r.actions || []).slice(0, 10);
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  chatFocus = state.chat.indexOf(pending);
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
    $('#vat').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    if (!a.done) await run(mi, ai, 'open-vat');
    return;
  }
  await run(mi, ai, b.dataset.act);
});

$('#rows').addEventListener('click', async (ev) => {
  if (ev.target.closest('[data-sample]')) return loadSample();
  const b = ev.target.closest('button[data-i]');
  if (!b) return;
  const rec = state.records[Number(b.dataset.i)];
  if (!rec) return;
  if (b.dataset.do === 'view') return openDetail(rec);
  b.disabled = true;
  if (b.dataset.do === 'refresh') {
    const r = await post('/api/paypal', { op: 'status', id: rec.paypal.id, token: rec.paypal.token });
    if (r.error) toast(r.error);
    else Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
  } else if (b.dataset.do === 'remind') {
    toast((await remind(rec)).text);
  } else if (b.dataset.do === 'collect') {
    toast((await sendWithPaypal(rec)).text);
  }
  save();
  await renderAll();
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

$('#tamper').onclick = async () => {
  const altas = state.records.map((r, i) => (isAnulacion(r) ? -1 : i)).filter((i) => i >= 0);
  if (!altas.length) return;
  if (!tampered) {
    const i = altas.length > 1 ? altas[altas.length - 2] : altas[0];
    tampered = { i, total: state.records[i].total };
    state.records[i].total = money(Number(state.records[i].total) + 100);
  } else {
    state.records[tampered.i].total = tampered.total;
    tampered = null;
  }
  await renderAll();
};

const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
$('#xml').onclick = () => download('cuadra-verifactu-records.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<RegistrosFacturacion>\n${state.records.map(recordXml).join('\n')}\n</RegistrosFacturacion>\n`, 'application/xml');
$('#csv').onclick = () => {
  const head = 'record,number,date,client,client_nif,base,vat,total,status,due,hash';
  const rows = state.records.map((r) => (isAnulacion(r)
    ? ['anulacion', r.number, r.date, '', '', '', '', '', 'CANCELLATION', '', r.hash]
    : ['alta', r.number, r.date, r.recipient?.name, r.recipient?.nif, money(Number(r.total) - Number(r.taxTotal)), r.taxTotal, r.total, status(r), r.dueDate || '', r.hash]).map(csvCell).join(','));
  download('cuadra-libro-registro.csv', [head, ...rows].join('\n'), 'text/csv');
};

async function loadSample() {
  tampered = null;
  state = fresh();
  state.records = await buildSample({ issuer: state.company, today: today() });
  vatQ = null;
  save();
  await renderAll();
}
$('#sample').onclick = async () => {
  if (state.records.length && !window.confirm('Replace your demo ledger with a sample quarter?')) return;
  await loadSample();
  toast('Sample quarter loaded: paid, overdue and open invoices, plus one cancelled duplicate.');
};
$('#reset').onclick = async () => {
  if (!window.confirm('Delete all demo invoices and start with an empty ledger?')) return;
  tampered = null;
  state = fresh();
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

if (firstVisit) await loadSample();
await renderAll();
await checkSubscription();
syncPaypal();

// Local visual self-test (localhost only): plays the demo flow so a headless browser can screenshot it.
if (location.hostname === 'localhost' && location.hash.startsWith('#selftest')) {
  await loadSample();
  const run = async (text, act) => {
    $('#msg').value = text;
    $('#ask').requestSubmit();
    for (let i = 0; i < 80 && state.chat.at(-1)?.text === 'Thinking…'; i++) await sleep(100);
    if (act) document.querySelector(`#chat button[data-act="${act}"]`)?.click();
    await sleep(400);
  };
  await run(EXAMPLES[0], 'issue-send');
  await run(EXAMPLES[2]);
  await run(EXAMPLES[3]);
  if (location.hash === '#selftest-detail') openDetail(invoicesOf(state.records).at(-1));
}
