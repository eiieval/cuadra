import { buildAlta, buildAnulacion, verifyChain, recordXml, money, validNif, totals, isAnulacion } from './js/verifactu.js';
import {
  stateOf, summary, vatReturn, returnQuarter, previousQuarter, clients, cancelledNumbers, invoicesOf, findInvoice,
  nextNumber, buildSample, addDays, daysBetween, isoFromDmy, quarterOfIso,
} from './js/ledger.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const isoToday = () => new Date().toLocaleDateString('sv-SE');
const fmtDate = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00`)) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Minimal, safe formatting for agent replies: escape first, then only add <b> and bullet glyphs.
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[*-]\s+/gm, '• ').replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:])/g, '$1$2');
const safeUrl = (u) => (/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(String(u || '')) ? u : null);

const KEY = 'cuadra-demo-v1';
const BADGE = { PAID: 'badge badge-ok', MARKED_AS_PAID: 'badge badge-ok', OVERDUE: 'badge badge-bad', ERROR: 'badge badge-bad', CANCELLED: 'badge badge-mute', SENT: 'badge badge-warn', UNPAID: 'badge badge-warn', PARTIALLY_PAID: 'badge badge-warn' };
const METHOD = { BANK_TRANSFER: 'bank transfer', CASH: 'cash', OTHER: 'other method' };
const OPEN = (s) => s !== 'PAID' && s !== 'CANCELLED';
const EXAMPLES = [
  'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60',
  'Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA',
  'Chase every overdue invoice',
  'Prepare my VAT return',
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
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
const firstVisit = !state;
state = state || fresh();
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

async function issue(inv, withPaypal) {
  const number = nextNumber(state.records, state.company.series);
  const rec = await buildAlta({
    issuer: state.company,
    invoice: { number, date: today(), recipient: { name: inv.recipient.name, nif: inv.recipient.nif }, description: inv.description || inv.lines[0].description, lines: inv.lines },
    prev: state.records.at(-1) || null,
  });
  Object.assign(rec, { email: inv.recipient.email, dueDate: addDays(today(), inv.dueDays) });
  state.records.push(rec);
  save();
  await renderAll();
  if (!withPaypal) return `Issued ${number}. VeriFactu record chained.`;
  const error = await collect(rec);
  return error ? `Issued ${number}, but PayPal failed: ${error}` : `Issued ${number} and sent with PayPal.`;
}

async function sendWithPaypal(rec) {
  if (rec.paypal?.id) return `${rec.number} is already on PayPal.`;
  if (!OPEN(status(rec))) return `${rec.number} is ${status(rec).toLowerCase()}, nothing to collect.`;
  const error = await collect(rec);
  return error ? `PayPal failed for ${rec.number}: ${error}` : `${rec.number} sent with PayPal. The client can pay online now.`;
}

async function remind(rec) {
  if (!rec.paypal?.id) return `${rec.number} is not on PayPal yet. Send it with PayPal first.`;
  const r = await post('/api/paypal', { op: 'remind', id: rec.paypal.id, token: rec.paypal.token });
  if (r.error) return `Reminder failed: ${r.error}`;
  Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
  return `Reminder sent for ${rec.number}.`;
}

async function markPaid(rec, method = 'BANK_TRANSFER') {
  if (!OPEN(status(rec))) return `${rec.number} is already ${status(rec).toLowerCase()}.`;
  if (rec.paypal?.id) {
    const r = await post('/api/paypal', { op: 'record_payment', id: rec.paypal.id, token: rec.paypal.token, amount: Number(rec.total), date: today(), method });
    if (r.error) return `PayPal could not record the payment: ${r.error}`;
    rec.paypal.status = r.status;
  }
  Object.assign(rec, { paidAt: today(), paidMethod: method });
  return `${rec.number} marked as paid by ${METHOD[method] || 'other method'}${rec.paypal?.id ? ', also in PayPal' : ''}.`;
}

// Cancellation never edits the invoice: PayPal stops collecting it, then a RegistroAnulacion is appended to the chain.
async function annul(rec, reason) {
  if (cancelled().has(rec.number)) return `${rec.number} is already cancelled.`;
  if (status(rec) === 'PAID') return `${rec.number} is paid. A paid invoice needs a corrective invoice (factura rectificativa), not a cancellation.`;
  if (rec.paypal?.id && rec.paypal.status !== 'CANCELLED') {
    const r = await post('/api/paypal', { op: 'cancel', id: rec.paypal.id, token: rec.paypal.token, reason });
    if (r.error) return `PayPal could not cancel ${rec.number}: ${r.error}. Nothing was changed.`;
    rec.paypal.status = r.status;
  }
  state.records.push(await buildAnulacion({ issuer: state.company, target: rec, prev: state.records.at(-1), reason }));
  return `${rec.number} cancelled with a chained VeriFactu cancellation record${rec.paypal?.id ? '; the PayPal invoice is cancelled too' : ''}.`;
}

// ---------- rendering ----------

const buttons = (id, primary, label, secondary = 'Dismiss') => `<div class="mt-3 flex flex-wrap gap-2"><button class="btn-primary" data-act="${primary}" data-id="${id}">${esc(label)}</button><button class="btn-ghost" data-act="discard" data-id="${id}">${esc(secondary)}</button></div>`;
const invoiceLine = (rec) => `<b>${esc(rec.number)}</b> · ${esc(rec.recipient?.name)} · ${eur(rec.total)} <span class="${BADGE[status(rec)] || 'badge'}">${esc(status(rec).replace(/_/g, ' '))}</span>`;

function vatTable(v, compact = false) {
  const rows = v.rows.map((r) => `<tr class="border-t border-white/5"><td class="py-1 pr-2 text-slate-400">${r.rate}%</td><td class="pr-2 text-right tabular-nums"><span class="box">${r.boxes[0]}</span>${eur(r.base)}</td><td class="text-right tabular-nums"><span class="box">${r.boxes[2]}</span>${eur(r.tax)}</td></tr>`).join('');
  const days = daysBetween(today(), v.deadline);
  const ended = today() > v.to;
  const when = !ended ? `Quarter in progress · file by ${fmtDate(v.deadline)}` : days >= 0 ? `<b class="text-amber-200">Due in ${days} day${days === 1 ? '' : 's'}</b> · ${fmtDate(v.deadline)}` : `Filing window closed on ${fmtDate(v.deadline)}`;
  return `<div class="text-xs text-slate-400">${when}</div>
    <table class="mt-2 w-full text-xs"><thead class="text-slate-500"><tr><th class="text-left font-normal">VAT rate</th><th class="text-right font-normal">Taxable base</th><th class="text-right font-normal">Output VAT</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="mt-2 flex justify-between border-t border-white/10 pt-2 text-sm"><span class="text-slate-400"><span class="box">27</span>Total output VAT</span><b class="tabular-nums">${eur(v.boxes['27'])}</b></div>
    ${compact ? '' : `<div class="mt-2 text-[11px] leading-relaxed text-slate-500">${v.invoices} invoice${v.invoices === 1 ? '' : 's'}${v.cancelled ? `, ${v.cancelled} cancelled and excluded` : ''}${Number(v.exempt) ? ` · exempt (0%) base ${eur(v.exempt)}, declared outside boxes 01–09` : ''}. Output VAT only: add deductible VAT from your expenses (boxes 28–45) before filing. Draft for your adviser, not a filing.</div>`}`;
}

function actionCard(a, mi, ai) {
  const id = `${mi}-${ai}`;
  const done = a.done ? `<div class="mt-2 text-xs text-emerald-300">${esc(a.done)}</div>` : '';
  if (a.type === 'show_vat_return') {
    const q = /^\d{4}-Q[1-4]$/.test(a.args?.quarter || '') ? a.args.quarter : returnQuarter(today());
    return `<div class="card"><div class="flex items-center gap-2"><div class="text-xs text-slate-400">Modelo 303 draft · ${esc(q)}</div><button class="ml-auto btn-ghost" data-act="open-vat" data-id="${id}" data-q="${esc(q)}">Open</button></div><div class="mt-1">${vatTable(vatReturn(state.records, q), true)}</div></div>`;
  }
  if (a.type !== 'propose_invoice') {
    const rec = findInvoice(state.records, a.args?.number);
    if (!rec) return `<div class="card text-xs text-amber-200">Invoice ${esc(a.args?.number || '?')} is not in the ledger.</div>`;
    const st = status(rec);
    const head = (label) => `<div class="text-xs text-slate-400">${label}</div><div class="mt-1 text-sm">${invoiceLine(rec)}</div>`;
    if (a.type === 'propose_reminder') return `<div class="card">${head('Payment reminder')}${done || (rec.paypal?.id && OPEN(st) ? buttons(id, 'remind', 'Send PayPal reminder') : '<div class="mt-2 text-xs text-slate-400">No PayPal invoice to remind.</div>')}</div>`;
    if (a.type === 'propose_collect') return `<div class="card">${head('Collect with PayPal')}<div class="mt-1 text-[11px] text-slate-400">Creates a PayPal invoice with the VeriFactu verification link, so ${esc(rec.recipient?.name)} can pay online.</div>${done || (!rec.paypal?.id && OPEN(st) ? buttons(id, 'collect', 'Send with PayPal') : '<div class="mt-2 text-xs text-slate-400">Already on PayPal or settled.</div>')}</div>`;
    if (a.type === 'propose_mark_paid') {
      const method = METHOD[a.args?.method] ? a.args.method : 'BANK_TRANSFER';
      return `<div class="card">${head(`Record payment · ${METHOD[method]}`)}${done || (OPEN(st) ? buttons(id, 'mark-paid', 'Mark as paid') : '<div class="mt-2 text-xs text-slate-400">Nothing to record.</div>')}</div>`;
    }
    if (a.type === 'propose_cancel') {
      const blocked = st === 'PAID' ? 'Paid invoices need a corrective invoice, not a cancellation.' : st === 'CANCELLED' && cancelled().has(rec.number) ? 'Already cancelled.' : '';
      return `<div class="card border-rose-300/20 bg-rose-400/5">${head('Cancel invoice (anulación)')}<div class="mt-1 text-[11px] text-slate-400">${a.args?.reason ? `Reason: ${esc(a.args.reason)}. ` : ''}The invoice is never edited: a VeriFactu cancellation record is appended to the chain${rec.paypal?.id ? ' and the PayPal invoice is cancelled' : ''}.</div>${done || (blocked ? `<div class="mt-2 text-xs text-amber-200">${esc(blocked)}</div>` : buttons(id, 'cancel', 'Cancel invoice', 'Keep it'))}</div>`;
    }
    return '';
  }
  const inv = normalize(a.args);
  const t = totals(inv.lines);
  const base = t.breakdown.reduce((s, b) => s + Number(b.base), 0);
  const warn = [];
  if (inv.recipient.nif && !validNif(inv.recipient.nif)) warn.push(`NIF ${inv.recipient.nif} looks invalid`);
  if (!inv.recipient.nif) warn.push('No NIF: valid for a simplified invoice only');
  const rows = inv.lines.map((l) => `<tr><td class="pr-2 py-0.5">${esc(l.description)}</td><td class="pr-2 text-right tabular-nums whitespace-nowrap">${l.qty} × ${eur(l.price)}</td><td class="text-right text-slate-400">${l.vat}%</td></tr>`).join('');
  return `<div class="card">
    <div class="flex items-center gap-2"><div class="text-xs text-slate-400">Invoice proposal</div><div class="ml-auto text-[11px] text-slate-400 truncate">${esc(inv.recipient.email || 'no email: PayPal link only')}</div></div>
    <div class="mt-1 font-semibold">${esc(inv.recipient.name)} ${inv.recipient.nif ? `<span class="font-mono text-xs text-slate-400">${esc(inv.recipient.nif)}</span>` : ''}</div>
    <table class="mt-2 w-full text-xs">${rows}</table>
    <div class="mt-2 flex justify-between text-sm"><span class="text-slate-400">Base ${eur(base)} + VAT ${eur(t.taxTotal)}</span><b class="tabular-nums">${eur(t.total)}</b></div>
    <div class="mt-1 text-[11px] text-slate-500">Due ${inv.dueDays ? `in ${inv.dueDays} days` : 'on receipt'}</div>
    ${warn.length ? `<div class="mt-2 text-[11px] text-amber-300/90">${warn.map(esc).join(' · ')}</div>` : ''}
    ${done || `<div class="mt-3 flex flex-wrap gap-2"><button class="btn-primary" data-act="issue-send" data-id="${id}">Issue + collect with PayPal</button><button class="btn-ghost" data-act="issue" data-id="${id}">Issue only</button><button class="btn-ghost" data-act="discard" data-id="${id}">Discard</button></div>`}
  </div>`;
}

function renderChat() {
  $('#chat').innerHTML = state.chat.length
    ? state.chat.map((m, mi) => (m.role === 'user'
      ? `<div class="flex justify-end"><div class="bubble-user">${esc(m.text)}</div></div>`
      : `<div class="space-y-2"><div class="bubble-agent">${md(m.text)}</div>${(m.actions || []).map((a, ai) => actionCard(a, mi, ai)).join('')}</div>`)).join('')
    : '<div class="pt-2 text-sm leading-relaxed text-slate-400">Tell me who to invoice and for what, in English or Spanish. I draft the invoice, you confirm it, and Cuadra issues a VeriFactu record and collects it with PayPal. I can also chase late payers, record payments, cancel mistakes and draft your quarterly VAT return.</div>';
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

function renderKpis() {
  const s = summary(state.records, today());
  const k = [
    [`Taxable base ${s.quarter}`, eur(s.base), `${s.invoices} invoice${s.invoices === 1 ? '' : 's'} this quarter`],
    ['VAT charged', eur(s.vat), 'output VAT this quarter'],
    [`Outstanding · ${s.unpaid}`, eur(s.unpaidTotal), s.overdue ? `<span class="text-rose-300">${s.overdue} overdue · ${eur(s.overdueTotal)}</span>` : 'nothing overdue'],
    ['Collected', eur(s.collected), 'PayPal and recorded payments'],
  ];
  $('#kpis').innerHTML = k.map(([l, v, sub]) => `<div class="glass rounded-xl p-3"><div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(l)}</div><div class="mt-1 text-lg font-semibold tabular-nums">${esc(v)}</div><div class="text-[11px] text-slate-500">${sub}</div></div>`).join('');
}

function renderInvoices() {
  if (!state.records.length) {
    $('#rows').innerHTML = '<tr><td colspan="7" class="py-8 text-center text-sm text-slate-500">No invoices yet. Ask the agent to create one, or <button class="underline text-slate-300" data-sample="1">load a sample quarter</button>.</td></tr>';
    return;
  }
  $('#rows').innerHTML = state.records.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
    if (isAnulacion(r)) {
      return `<tr class="border-t border-white/5 text-slate-400">
        <td class="py-2 pr-2 font-mono text-xs whitespace-nowrap">↳ ${esc(r.number)}</td>
        <td class="pr-2 text-xs" colspan="2">Cancellation record${r.reason ? ` · ${esc(r.reason)}` : ''}</td>
        <td class="pr-2"><span class="badge badge-mute">Anulación</span></td><td class="hidden sm:table-cell"></td>
        <td class="pr-2 font-mono text-[11px] hidden md:table-cell" title="${esc(r.hash)}">${esc(r.hash.slice(0, 12))}…</td>
        <td class="text-right"><button class="btn-ghost" data-i="${i}" data-do="view">View</button></td></tr>`;
    }
    const st = status(r);
    const action = !OPEN(st) ? '' : r.paypal?.id
      ? `<button class="btn-ghost" data-i="${i}" data-do="remind">Remind</button>`
      : `<button class="btn-ghost" data-i="${i}" data-do="collect" title="Send with PayPal">Collect</button>`;
    const refresh = r.paypal?.id ? `<button class="btn-ghost" data-i="${i}" data-do="refresh" title="Refresh PayPal status" aria-label="Refresh PayPal status">↻</button>` : '';
    return `<tr class="border-t border-white/5 ${st === 'CANCELLED' ? 'text-slate-500' : ''}">
      <td class="py-2 pr-2 font-mono text-xs whitespace-nowrap ${st === 'CANCELLED' ? 'line-through' : ''}">${esc(r.number)}</td>
      <td class="pr-2">${esc(r.recipient?.name)}${r.sample ? ' <span class="text-[10px] text-slate-500">sample</span>' : ''}</td>
      <td class="pr-2 text-right tabular-nums whitespace-nowrap">${eur(r.total)}</td>
      <td class="pr-2"><span class="${BADGE[st] || 'badge'}" title="${esc(r.paypal?.error || (r.paypal?.id ? 'On PayPal' : ''))}">${esc(st.replace(/_/g, ' '))}</span>${r.paypal?.id ? ' <span class="text-[10px] text-indigo-300">PayPal</span>' : ''}</td>
      <td class="pr-2 text-xs text-slate-400 whitespace-nowrap hidden sm:table-cell">${r.dueDate && OPEN(st) ? fmtDate(r.dueDate) : ''}</td>
      <td class="pr-2 font-mono text-[11px] text-slate-400 hidden md:table-cell" title="${esc(r.hash)}">${esc(r.hash.slice(0, 12))}…</td>
      <td class="text-right whitespace-nowrap space-x-1"><button class="btn-ghost" data-i="${i}" data-do="view">View</button>${refresh}${action}</td>
    </tr>`;
  }).join('');
}

function renderVat() {
  const q = vatQ || returnQuarter(today());
  $('#vatQ').textContent = q;
  $('#vatBody').innerHTML = vatTable(vatReturn(state.records, q));
}

async function renderChain() {
  const v = await verifyChain(state.records);
  $('#chain').innerHTML = v.ok
    ? `<span class="text-emerald-300">● Chain verified</span> <span class="text-slate-400">${v.count} record${v.count === 1 ? '' : 's'}, SHA-256 linked</span>`
    : `<span class="text-rose-300">● Chain broken at ${esc(state.records[v.index].number)}</span> <span class="text-slate-400">${esc(v.reason)}</span>`;
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
  $('#company').textContent = `${state.company.name} · NIF ${state.company.nif} · series ${state.company.series}`;
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
  return `<div><div class="text-slate-400">Record hash (SHA-256)</div><div class="font-mono break-all">${esc(r.hash)}</div></div>
    <div><div class="text-slate-400">Previous record</div><div class="font-mono break-all">${r.prev ? esc(`${r.prev.number} · ${r.prev.hash}`) : 'First record in the chain'}</div></div>
    <div><div class="text-slate-400">Generated</div><div class="font-mono">${esc(r.generatedAt)}</div></div>`;
}

function openDetail(r) {
  const xmlBlock = `<details><summary class="cursor-pointer text-slate-300">${isAnulacion(r) ? 'RegistroAnulacion' : 'RegistroAlta'} XML</summary><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px]">${esc(recordXml(r))}</pre></details>`;
  const closeBtns = '<div class="flex flex-wrap gap-2"><button class="btn-ghost" data-dl="xml">Download XML</button><button class="btn-primary" data-dl="close">Close</button></div>';
  if (isAnulacion(r)) {
    $('#dlgBody').innerHTML = `<div class="max-w-xl space-y-3 text-xs"><div class="text-base font-semibold">Cancellation of ${esc(r.number)}</div>
      <p class="text-slate-400">A RegistroAnulacion identifies the cancelled invoice and is chained like any other record. The original invoice stays in the ledger untouched.${r.reason ? ` Reason: ${esc(r.reason)}.` : ''}</p>${chainFacts(r)}${xmlBlock}${closeBtns}</div>`;
  } else {
    const st = status(r);
    const rows = (r.lines || []).map((l) => `<tr class="border-t border-black/10"><td class="py-1 pr-2">${esc(l.description)}</td><td class="pr-2 text-right">${l.qty}</td><td class="pr-2 text-right">${eur(l.price)}</td><td class="text-right">${l.vat}%</td></tr>`).join('');
    const pay = r.paypal?.id ? `${esc(r.paypal.status)}${safeUrl(r.paypal.payerUrl) ? ` · <a class="text-indigo-300 underline" href="${esc(r.paypal.payerUrl)}" target="_blank" rel="noopener noreferrer">payer page</a>` : ''}` : r.paidAt ? `Paid by ${esc(METHOD[r.paidMethod] || 'transfer')} on ${fmtDate(r.paidAt)}` : 'Not on PayPal';
    const manage = OPEN(st) ? `<div class="space-y-2 rounded-lg border border-white/10 p-2"><div class="text-slate-400">Manage</div>
      <div class="flex flex-wrap gap-2"><select id="payMethod" class="field !w-auto !py-1 text-xs" aria-label="Payment method"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select><button class="btn-ghost" data-dl="paid">Mark paid</button></div>
      <div class="flex flex-wrap gap-2"><input id="cancelReason" class="field !w-auto flex-1 !py-1 text-xs" maxlength="200" placeholder="Reason, e.g. duplicate" aria-label="Cancellation reason"><button class="btn-ghost text-rose-200" data-dl="cancel">Cancel invoice</button></div></div>` : '';
    $('#dlgBody').innerHTML = `
    <div class="grid gap-5 md:grid-cols-[1fr_260px]">
      <div class="rounded-xl bg-white p-5 text-slate-900">
        <div class="flex justify-between gap-4">
          <div><div class="text-lg font-bold">${esc(r.issuerName)}</div><div class="text-xs text-slate-500">NIF ${esc(r.nif)}</div></div>
          <div class="text-right"><div class="text-xs text-slate-500">Invoice${st === 'CANCELLED' ? ' · CANCELLED' : ''}</div><div class="font-mono font-semibold">${esc(r.number)}</div><div class="text-xs text-slate-500">${esc(r.date)}${r.dueDate ? ` · due ${esc(fmtDate(r.dueDate))}` : ''}</div></div>
        </div>
        <div class="mt-4 text-sm"><div class="text-xs text-slate-500">Bill to</div><div class="font-medium">${esc(r.recipient?.name)}</div>${r.recipient?.nif ? `<div class="text-xs text-slate-500">NIF ${esc(r.recipient.nif)}</div>` : ''}</div>
        <table class="mt-4 w-full text-sm"><thead class="text-xs text-slate-500"><tr><th class="text-left">Description</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">VAT</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="mt-3 space-y-0.5 text-right text-sm">${r.breakdown.map((b) => `<div class="text-slate-500">Base ${b.rate}%: ${eur(b.base)} · VAT ${eur(b.tax)}</div>`).join('')}<div class="text-base font-bold">Total ${eur(r.total)}</div></div>
        <div class="mt-4 flex items-end gap-3 border-t border-black/10 pt-3">
          <div class="w-28 shrink-0">${qrSvg(r.qr)}<div class="text-center text-[10px] font-bold tracking-wider">VERI*FACTU</div></div>
          <div class="break-all text-[10px] text-slate-500">Invoice verifiable at the Spanish Tax Agency (AEAT test service).<br>${esc(r.qr)}</div>
        </div>
      </div>
      <div class="min-w-0 space-y-3 text-xs">
        <div><div class="text-slate-400">Status</div><span class="${BADGE[st] || 'badge'}">${esc(st.replace(/_/g, ' '))}</span></div>
        ${chainFacts(r)}
        <div><div class="text-slate-400">Payment</div><div>${pay}</div></div>
        ${manage}${xmlBlock}${closeBtns}
      </div>
    </div>`;
    const act = async (fnc) => { $('#dlg').close(); toast(await fnc()); save(); await renderAll(); };
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

$('#ask').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('#msg').value.trim();
  if (!text) return;
  $('#msg').value = '';
  state.chat.push({ role: 'user', text });
  const pending = { role: 'agent', text: 'Thinking…', actions: [] };
  state.chat.push(pending);
  renderChat();
  const r = await post('/api/agent', { message: text, context: context(), history: chatHistory() });
  pending.text = r.error ? `⚠ ${r.error}` : r.reply;
  pending.actions = r.error ? [] : (r.actions || []).slice(0, 10);
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  save();
  await renderAll();
});

$('#chat').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const [mi, ai] = b.dataset.id.split('-').map(Number);
  const a = state.chat[mi]?.actions?.[ai];
  if (!a) return;
  if (b.dataset.act === 'open-vat') {
    vatQ = b.dataset.q;
    renderVat();
    $('#vat').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (a.done || a.busy) return;
  a.busy = true;
  b.disabled = true;
  b.textContent = 'Working…';
  const rec = findInvoice(state.records, a.args?.number);
  try {
    if (b.dataset.act === 'discard') a.done = 'Dismissed.';
    else if (b.dataset.act === 'issue' || b.dataset.act === 'issue-send') a.done = await issue(normalize(a.args), b.dataset.act === 'issue-send');
    else if (!rec) a.done = 'Invoice not found.';
    else if (b.dataset.act === 'remind') a.done = await remind(rec);
    else if (b.dataset.act === 'collect') a.done = await sendWithPaypal(rec);
    else if (b.dataset.act === 'mark-paid') a.done = await markPaid(rec, METHOD[a.args?.method] ? a.args.method : 'BANK_TRANSFER');
    else if (b.dataset.act === 'cancel') a.done = await annul(rec, String(a.args?.reason || '').slice(0, 200));
  } finally {
    delete a.busy;
    save();
    await renderAll();
  }
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
    toast(await remind(rec));
  } else if (b.dataset.do === 'collect') {
    toast(await sendWithPaypal(rec));
  }
  save();
  await renderAll();
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
  $('#tamper').textContent = tampered ? 'Undo tampering' : 'Tamper test';
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
  $('#tamper').textContent = 'Tamper test';
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

if (firstVisit) await loadSample();
await renderAll();
await checkSubscription();

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
