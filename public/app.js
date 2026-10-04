import { buildAlta, verifyChain, altaXml, money, validNif, totals } from './js/verifactu.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const isoToday = () => new Date().toLocaleDateString('sv-SE');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeUrl = (u) => (/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(String(u || '')) ? u : null);

const KEY = 'cuadra-demo-v1';
const PAID = ['PAID', 'MARKED_AS_PAID'];
const BADGE = { PAID: 'badge badge-ok', MARKED_AS_PAID: 'badge badge-ok', SENT: 'badge badge-warn', UNPAID: 'badge badge-warn', PARTIALLY_PAID: 'badge badge-warn', ERROR: 'badge badge-bad', CANCELLED: 'badge badge-bad' };
const EXAMPLES = [
  'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60',
  'Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA',
  'How much VAT have I charged this quarter?',
  'Remind every client who has not paid',
];

const fresh = () => ({
  company: { name: 'Estudio Norte SL', nif: 'B76543214', series: `CU${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4).toUpperCase()}` },
  records: [],
  chat: [],
});
let tampered = null;
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { return fresh(); } })();
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

const quarter = (date) => { const [, m, y] = date.split('-'); return `${y}-Q${Math.ceil(Number(m) / 3)}`; };
const todayDmy = () => { const [y, m, d] = isoToday().split('-'); return `${d}-${m}-${y}`; };

function summary() {
  const q = quarter(todayDmy());
  const inQ = state.records.filter((r) => quarter(r.date) === q);
  const base = inQ.reduce((s, r) => s + r.breakdown.reduce((a, b) => a + Number(b.base), 0), 0);
  const vat = inQ.reduce((s, r) => s + Number(r.taxTotal), 0);
  const unpaid = state.records.filter((r) => r.paypal?.id && !PAID.includes(r.paypal.status));
  const collected = state.records.filter((r) => PAID.includes(r.paypal?.status)).reduce((s, r) => s + Number(r.total), 0);
  return { quarter: q, invoices: inQ.length, base: money(base), vat: money(vat), unpaid: unpaid.length, unpaidTotal: money(unpaid.reduce((s, r) => s + Number(r.total), 0)), collected: money(collected) };
}

const context = () => ({
  today: isoToday(),
  summary: summary(),
  invoices: state.records.slice(-25).map((r) => ({ number: r.number, client: r.recipient?.name || '', total: Number(r.total), vat: Number(r.taxTotal), status: r.paypal?.status || 'ISSUED', date: r.date })),
});

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
    dueDays: Number(args.due_days) || 15,
  };
}

const isoFromDmy = (d) => d.split('-').reverse().join('-');
const paypalPayload = (rec, dueDays = 15) => ({
  number: rec.number, date: isoFromDmy(rec.date), dueDays, issuerName: rec.issuerName,
  recipient: { name: rec.recipient?.name, nif: rec.recipient?.nif, email: rec.email || '' },
  lines: rec.lines, description: rec.description,
  note: `VERI*FACTU invoice. Verify it at the Spanish Tax Agency: ${rec.qr}`,
});

async function collect(rec, dueDays) {
  const r = await post('/api/paypal', { op: 'create_and_send', invoice: paypalPayload(rec, dueDays) });
  rec.paypal = r.error ? { status: 'ERROR', error: r.error } : { id: r.id, token: r.token, status: r.status, payerUrl: safeUrl(r.payerUrl) };
  return r.error;
}

async function issue(inv, withPaypal) {
  const prev = state.records[state.records.length - 1] || null;
  const number = `${state.company.series}-${String(state.records.length + 1).padStart(4, '0')}`;
  const rec = await buildAlta({
    issuer: state.company,
    invoice: { number, date: isoToday(), recipient: { name: inv.recipient.name, nif: inv.recipient.nif }, description: inv.description || inv.lines[0].description, lines: inv.lines },
    prev,
  });
  rec.email = inv.recipient.email;
  state.records.push(rec);
  save();
  await renderAll();
  if (!withPaypal) return `Issued ${number}. VeriFactu record chained.`;
  const error = await collect(rec, inv.dueDays);
  return error ? `Issued ${number}, but PayPal failed: ${error}` : `Issued ${number} and sent with PayPal.`;
}

async function remindByNumber(number) {
  const rec = state.records.find((r) => r.number === number);
  if (!rec?.paypal?.id) return `No PayPal invoice found for ${number}.`;
  const r = await post('/api/paypal', { op: 'remind', id: rec.paypal.id, token: rec.paypal.token });
  if (r.error) return `Reminder failed: ${r.error}`;
  Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
  return `Reminder sent for ${number}.`;
}

function actionCard(a, mi, ai) {
  const id = `${mi}-${ai}`;
  const done = a.done ? `<div class="mt-2 text-xs text-emerald-300">${esc(a.done)}</div>` : '';
  if (a.type === 'propose_reminder') {
    return `<div class="card"><div class="text-xs text-slate-400">Payment reminder</div><div class="mt-1 text-sm">Send a PayPal reminder for <b>${esc(a.args.number)}</b></div>${done || `<div class="mt-2 flex gap-2"><button class="btn-primary" data-act="remind" data-id="${id}">Send reminder</button><button class="btn-ghost" data-act="discard" data-id="${id}">Dismiss</button></div>`}</div>`;
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
    ${warn.length ? `<div class="mt-2 text-[11px] text-amber-300/90">${warn.map(esc).join(' · ')}</div>` : ''}
    ${done || `<div class="mt-3 flex flex-wrap gap-2"><button class="btn-primary" data-act="issue-send" data-id="${id}">Issue + collect with PayPal</button><button class="btn-ghost" data-act="issue" data-id="${id}">Issue only</button><button class="btn-ghost" data-act="discard" data-id="${id}">Discard</button></div>`}
  </div>`;
}

function renderChat() {
  $('#chat').innerHTML = state.chat.length
    ? state.chat.map((m, mi) => (m.role === 'user'
      ? `<div class="flex justify-end"><div class="bubble-user">${esc(m.text)}</div></div>`
      : `<div class="space-y-2"><div class="bubble-agent">${esc(m.text)}</div>${(m.actions || []).map((a, ai) => actionCard(a, mi, ai)).join('')}</div>`)).join('')
    : '<div class="pt-2 text-sm leading-relaxed text-slate-400">Tell me who to invoice and for what, in English or Spanish. I draft the invoice, you confirm it, and Cuadra issues a VeriFactu record and collects it with PayPal.</div>';
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

function renderKpis() {
  const s = summary();
  const k = [[`Base ${s.quarter}`, eur(s.base)], ['VAT charged', eur(s.vat)], [`Unpaid · ${s.unpaid}`, eur(s.unpaidTotal)], ['Collected via PayPal', eur(s.collected)]];
  $('#kpis').innerHTML = k.map(([l, v]) => `<div class="glass rounded-xl p-3"><div class="text-[11px] uppercase tracking-wide text-slate-400">${esc(l)}</div><div class="mt-1 text-lg font-semibold tabular-nums">${esc(v)}</div></div>`).join('');
}

function renderInvoices() {
  $('#rows').innerHTML = state.records.length
    ? state.records.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
      const st = r.paypal?.status || 'ISSUED';
      const actions = r.paypal?.id
        ? `<button class="btn-ghost" data-i="${i}" data-do="refresh" title="Refresh PayPal status">↻</button>${PAID.includes(st) ? '' : `<button class="btn-ghost" data-i="${i}" data-do="remind">Remind</button>`}`
        : `<button class="btn-ghost" data-i="${i}" data-do="collect">Collect</button>`;
      return `<tr class="border-t border-white/5">
        <td class="py-2 pr-2 font-mono text-xs whitespace-nowrap">${esc(r.number)}</td>
        <td class="pr-2">${esc(r.recipient?.name)}</td>
        <td class="pr-2 text-right tabular-nums whitespace-nowrap">${eur(r.total)}</td>
        <td class="pr-2"><span class="${BADGE[st] || 'badge'}" title="${esc(r.paypal?.error || '')}">${esc(st.replace(/_/g, ' '))}</span></td>
        <td class="pr-2 font-mono text-[11px] text-slate-400" title="${esc(r.hash)}">${esc(r.hash.slice(0, 12))}…</td>
        <td class="text-right whitespace-nowrap space-x-1"><button class="btn-ghost" data-i="${i}" data-do="view">View</button>${actions}</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="6" class="py-8 text-center text-sm text-slate-500">No invoices yet. Ask the agent to create one.</td></tr>';
}

async function renderChain() {
  const v = await verifyChain(state.records);
  $('#chain').innerHTML = v.ok
    ? `<span class="text-emerald-300">● Chain verified</span> <span class="text-slate-400">${v.count} record${v.count === 1 ? '' : 's'}, SHA-256 linked</span>`
    : `<span class="text-rose-300">● Chain broken at ${esc(state.records[v.index].number)}</span> <span class="text-slate-400">${esc(v.reason)}</span>`;
}

async function renderAll() {
  $('#company').textContent = `${state.company.name} · NIF ${state.company.nif} · series ${state.company.series}`;
  renderKpis();
  renderChat();
  renderInvoices();
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

function openDetail(r) {
  const rows = (r.lines || []).map((l) => `<tr class="border-t border-black/10"><td class="py-1 pr-2">${esc(l.description)}</td><td class="pr-2 text-right">${l.qty}</td><td class="pr-2 text-right">${eur(l.price)}</td><td class="text-right">${l.vat}%</td></tr>`).join('');
  const pay = r.paypal?.id ? `${esc(r.paypal.status)}${safeUrl(r.paypal.payerUrl) ? ` · <a class="text-indigo-300 underline" href="${esc(r.paypal.payerUrl)}" target="_blank" rel="noopener noreferrer">payer page</a>` : ''}` : 'Not sent';
  $('#dlgBody').innerHTML = `
  <div class="grid gap-5 md:grid-cols-[1fr_260px]">
    <div class="rounded-xl bg-white p-5 text-slate-900">
      <div class="flex justify-between gap-4">
        <div><div class="text-lg font-bold">${esc(r.issuerName)}</div><div class="text-xs text-slate-500">NIF ${esc(r.nif)}</div></div>
        <div class="text-right"><div class="text-xs text-slate-500">Invoice</div><div class="font-mono font-semibold">${esc(r.number)}</div><div class="text-xs text-slate-500">${esc(r.date)}</div></div>
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
      <div><div class="text-slate-400">Record hash (SHA-256)</div><div class="font-mono break-all">${esc(r.hash)}</div></div>
      <div><div class="text-slate-400">Previous record</div><div class="font-mono break-all">${r.prev ? esc(`${r.prev.number} · ${r.prev.hash}`) : 'First record in the chain'}</div></div>
      <div><div class="text-slate-400">Generated</div><div class="font-mono">${esc(r.generatedAt)}</div></div>
      <div><div class="text-slate-400">PayPal</div><div>${pay}</div></div>
      <details><summary class="cursor-pointer text-slate-300">RegistroAlta XML</summary><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px]">${esc(altaXml(r))}</pre></details>
      <div class="flex gap-2"><button class="btn-ghost" data-dl="xml">Download XML</button><button class="btn-primary" data-dl="close">Close</button></div>
    </div>
  </div>`;
  $('#dlgBody').querySelector('[data-dl="xml"]').onclick = () => download(`${r.number}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n${altaXml(r)}\n`, 'application/xml');
  $('#dlgBody').querySelector('[data-dl="close"]').onclick = () => $('#dlg').close();
  $('#dlg').showModal();
}

$('#ask').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('#msg').value.trim();
  if (!text) return;
  $('#msg').value = '';
  state.chat.push({ role: 'user', text });
  const pending = { role: 'agent', text: 'Thinking…', actions: [] };
  state.chat.push(pending);
  renderChat();
  const r = await post('/api/agent', { message: text, context: context() });
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
  if (!a || a.done || a.busy) return;
  a.busy = true;
  b.disabled = true;
  b.textContent = 'Working…';
  try {
    if (b.dataset.act === 'discard') a.done = 'Discarded.';
    else if (b.dataset.act === 'remind') a.done = await remindByNumber(a.args.number);
    else a.done = await issue(normalize(a.args), b.dataset.act === 'issue-send');
  } finally {
    delete a.busy;
    save();
    await renderAll();
  }
});

$('#rows').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-i]');
  if (!b) return;
  const rec = state.records[Number(b.dataset.i)];
  if (!rec) return;
  if (b.dataset.do === 'view') return openDetail(rec);
  b.disabled = true;
  if (b.dataset.do === 'refresh') {
    const r = await post('/api/paypal', { op: 'status', id: rec.paypal.id, token: rec.paypal.token });
    if (!r.error) Object.assign(rec.paypal, { status: r.status, payerUrl: safeUrl(r.payerUrl) || rec.paypal.payerUrl });
  } else if (b.dataset.do === 'remind') {
    await remindByNumber(rec.number);
  } else if (b.dataset.do === 'collect') {
    await collect(rec);
  }
  save();
  await renderAll();
});

$('#tamper').onclick = async () => {
  if (!state.records.length) return;
  if (!tampered) {
    const i = Math.max(0, state.records.length - 2);
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
$('#xml').onclick = () => download('cuadra-verifactu-records.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<RegistrosFacturacion>\n${state.records.map((r) => altaXml(r)).join('\n')}\n</RegistrosFacturacion>\n`, 'application/xml');
$('#csv').onclick = () => {
  const head = 'number,date,client,client_nif,base,vat,total,paypal_status,hash';
  const rows = state.records.map((r) => [r.number, r.date, r.recipient?.name, r.recipient?.nif, money(Number(r.total) - Number(r.taxTotal)), r.taxTotal, r.total, r.paypal?.status || 'ISSUED', r.hash].map(csvCell).join(','));
  download('cuadra-libro-registro.csv', [head, ...rows].join('\n'), 'text/csv');
};

$('#reset').onclick = async () => {
  if (!window.confirm('Delete all demo invoices and start over?')) return;
  tampered = null;
  state = fresh();
  save();
  await renderAll();
};

$('#examples').innerHTML = EXAMPLES.map((e, i) => `<button class="chip" data-ex="${i}">${esc(e)}</button>`).join('');
$('#examples').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ex]');
  if (!b) return;
  $('#msg').value = EXAMPLES[b.dataset.ex];
  $('#ask').requestSubmit();
});

await renderAll();

// Local visual self-test (localhost only): plays the demo flow so a headless browser can screenshot it.
if (location.hostname === 'localhost' && location.hash === '#selftest') {
  state = fresh();
  for (const ex of EXAMPLES.slice(0, 2)) {
    $('#msg').value = ex;
    $('#ask').requestSubmit();
    for (let i = 0; i < 50 && state.chat.at(-1)?.text === 'Thinking…'; i++) await sleep(100);
    const a = state.chat.at(-1)?.actions?.[0];
    if (a) a.done = await issue(normalize(a.args), true);
    await renderAll();
  }
  openDetail(state.records.at(-1));
}
