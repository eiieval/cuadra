#!/usr/bin/env node
// Cuadra MCP server: VeriFactu invoicing and PayPal collection as tools for any MCP client (Claude, ChatGPT, Cursor…).
// Zero dependencies, JSON-RPC 2.0 over stdio. The ledger is a local JSON file holding one VeriFactu hash chain;
// it is verified before every change, and every change is written atomically. stdout carries only protocol messages.
import { createInterface } from 'node:readline';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { loadEnv } from '../lib/env.js';
import { buildAlta, buildAnulacion, verifyChain, recordXml, validNif, isAnulacion } from '../public/js/verifactu.js';
import { stateOf, summary, vatReturn, returnQuarter, cancelledNumbers, invoicesOf, findInvoice, nextNumber, addDays, daysBetween, isoFromDmy, clients } from '../public/js/ledger.js';
import { cleanInvoice } from '../lib/validate.js';
import * as paypal from '../lib/paypal.js';

loadEnv();
const VERSION = '0.2.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LEDGER = process.env.CUADRA_LEDGER || join(homedir(), '.cuadra', 'ledger.json');
const today = () => new Date().toLocaleDateString('sv-SE');
const paypalOn = () => Boolean(process.env.MOCK === '1' || process.env.MOCK_PAYPAL === '1' || (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET));
const METHODS = ['BANK_TRANSFER', 'CASH', 'OTHER'];

class ToolError extends Error {}

// ---------- ledger file ----------

function company() {
  const nif = String(process.env.CUADRA_NIF || 'B76543214').toUpperCase();
  if (!validNif(nif)) throw new ToolError(`CUADRA_NIF "${nif}" is not a valid Spanish NIF/CIF/NIE.`);
  const series = String(process.env.CUADRA_SERIES || `CU${new Date().getFullYear()}`).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,20}$/.test(series)) throw new ToolError('CUADRA_SERIES must be 2-21 letters, digits, "_" or "-".');
  return { name: String(process.env.CUADRA_NAME || 'Cuadra demo merchant').slice(0, 120), nif, series };
}

async function load() {
  if (!existsSync(LEDGER)) return { company: company(), records: [] };
  const data = JSON.parse(await readFile(LEDGER, 'utf8'));
  if (!Array.isArray(data.records) || !data.company) throw new ToolError(`${LEDGER} is not a Cuadra ledger.`);
  return data;
}

async function save(ledger) {
  await mkdir(dirname(LEDGER), { recursive: true });
  const tmp = `${LEDGER}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, LEDGER);
}

// Changes run one at a time, and only on a ledger whose chain verifies.
let queue = Promise.resolve();
const exclusive = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};
async function mutate(fn) {
  return exclusive(async () => {
    const ledger = await load();
    const v = await verifyChain(ledger.records);
    if (!v.ok) throw new ToolError(`Ledger integrity check failed at record ${v.index + 1} (${v.reason}). Nothing was changed.`);
    const out = await fn(ledger);
    await save(ledger);
    return out;
  });
}

// ---------- views ----------

const view = (r, set) => ({
  number: r.number, date: isoFromDmy(r.date), client: r.recipient?.name || '', nif: r.recipient?.nif || '',
  base: (Number(r.total) - Number(r.taxTotal)).toFixed(2), vat: r.taxTotal, total: r.total,
  status: stateOf(r, set, today()), due: r.dueDate || null, paypal: r.paypal?.id ? { id: r.paypal.id, status: r.paypal.status, payerUrl: r.paypal.payerUrl || null } : null,
  hash: r.hash, verifyUrl: r.qr,
});
const need = (ledger, number) => {
  const rec = findInvoice(ledger.records, number);
  if (!rec) throw new ToolError(`Invoice ${number} is not in the ledger. Use list_invoices to see invoice numbers.`);
  return rec;
};
const open = (rec, ledger) => !['PAID', 'CANCELLED'].includes(stateOf(rec, cancelledNumbers(ledger.records), today()));

function draft(ledger, args) {
  const number = nextNumber(ledger.records, ledger.company.series);
  const { problems, invoice } = cleanInvoice({
    number, date: today(), recipient: args.recipient, lines: args.lines, dueDays: args.due_days ?? 15,
    description: args.description, issuerName: ledger.company.name,
  });
  const warnings = [];
  if (!invoice.recipient.nif) warnings.push('No recipient NIF: only valid as a simplified invoice (factura simplificada).');
  if (!invoice.recipient.email) warnings.push('No recipient email: PayPal will create a payment link but cannot email the client.');
  return { problems, invoice, warnings };
}

async function sendToPaypal(rec) {
  const dueDays = Math.max(0, daysBetween(today(), rec.dueDate || today()));
  const out = await paypal.createAndSend({
    number: rec.number, date: isoFromDmy(rec.date), dueDays, issuerName: rec.issuerName, recipient: { ...rec.recipient, email: rec.email || '' },
    lines: rec.lines, note: `VERI*FACTU invoice. Verify it at the Spanish Tax Agency: ${rec.qr}`,
  });
  rec.paypal = { id: out.id, status: out.status, payerUrl: out.payerUrl };
}

// ---------- tools ----------

const recipient = {
  type: 'object',
  properties: { name: { type: 'string' }, nif: { type: 'string', description: 'Spanish NIF, CIF or NIE' }, email: { type: 'string', description: 'Where PayPal sends the invoice' } },
  required: ['name'],
};
const lines = {
  type: 'array', minItems: 1, maxItems: 20,
  items: {
    type: 'object',
    properties: {
      description: { type: 'string' }, qty: { type: 'number', exclusiveMinimum: 0 },
      price: { type: 'number', exclusiveMinimum: 0, description: 'Unit price in EUR before VAT' },
      vat: { type: 'number', enum: [0, 4, 10, 21], description: 'Spanish VAT rate' },
    },
    required: ['description', 'qty', 'price', 'vat'],
  },
};
const number = { type: 'string', description: 'Invoice number, e.g. CU2026-0001' };
const invoiceInput = { recipient, lines, description: { type: 'string' }, due_days: { type: 'integer', minimum: 0, maximum: 90, default: 15 } };

const TOOLS = {
  draft_invoice: {
    title: 'Draft invoice',
    description: 'Validate an invoice and compute its totals without issuing anything. Always show the draft to the user before issue_invoice.',
    inputSchema: { type: 'object', properties: invoiceInput, required: ['recipient', 'lines'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const ledger = await load();
      const { problems, invoice, warnings } = draft(ledger, a);
      return { ok: !problems.length, problems, warnings, number: invoice.number, recipient: invoice.recipient, lines: invoice.lines, breakdown: invoice.breakdown, vat: invoice.taxTotal, total: invoice.total, dueDays: invoice.dueDays };
    },
  },
  issue_invoice: {
    title: 'Issue invoice',
    description: 'Issue a VeriFactu invoice: append a hash-chained RegistroAlta to the ledger and, by default, send it with PayPal Invoicing so the client can pay online. Only after the user confirmed the draft.',
    inputSchema: { type: 'object', properties: { ...invoiceInput, collect_with_paypal: { type: 'boolean', default: true } }, required: ['recipient', 'lines'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (a) => mutate(async (ledger) => {
      const { problems, invoice } = draft(ledger, a);
      if (problems.length) throw new ToolError(`Invalid invoice: ${problems.join('; ')}`);
      const rec = await buildAlta({
        issuer: ledger.company,
        invoice: { number: invoice.number, date: invoice.date, recipient: { name: invoice.recipient.name, nif: invoice.recipient.nif }, description: invoice.description || invoice.lines[0].description, lines: invoice.lines },
        prev: ledger.records.at(-1) || null,
      });
      Object.assign(rec, { email: invoice.recipient.email, dueDate: addDays(invoice.date, invoice.dueDays) });
      ledger.records.push(rec);
      let paypalError = null;
      if (a.collect_with_paypal !== false) {
        if (!paypalOn()) paypalError = 'PayPal is not configured (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET).';
        else await sendToPaypal(rec).catch((e) => { paypalError = e.public ? e.message : 'PayPal failed.'; rec.paypal = { status: 'ERROR', error: paypalError }; });
      }
      return { issued: view(rec, cancelledNumbers(ledger.records)), paypalError };
    }),
  },
  list_invoices: {
    title: 'List invoices',
    description: 'List invoices with their status (ISSUED, SENT, OVERDUE, PAID, CANCELLED), due date and PayPal link.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['ALL', 'OPEN', 'OVERDUE', 'PAID', 'CANCELLED'], default: 'ALL' }, client: { type: 'string', description: 'Filter by client name' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const ledger = await load();
      const set = cancelledNumbers(ledger.records);
      const q = String(a.client || '').toLowerCase();
      const rows = invoicesOf(ledger.records).map((r) => view(r, set))
        .filter((r) => !q || r.client.toLowerCase().includes(q))
        .filter((r) => !a.status || a.status === 'ALL' || (a.status === 'OPEN' ? !['PAID', 'CANCELLED'].includes(r.status) : r.status === a.status));
      return { company: ledger.company, summary: summary(ledger.records, today()), invoices: rows.reverse().slice(0, 100), clients: clients(ledger.records).slice(0, 20) };
    },
  },
  sync_paypal: {
    title: 'Sync PayPal statuses',
    description: 'Refresh the status of every open invoice that is on PayPal (paid, partially paid, cancelled…).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: () => mutate(async (ledger) => {
      if (!paypalOn()) throw new ToolError('PayPal is not configured.');
      const changed = [];
      for (const rec of invoicesOf(ledger.records).filter((r) => r.paypal?.id && open(r, ledger))) {
        const s = await paypal.status(rec.paypal.id);
        if (s.status !== rec.paypal.status) changed.push({ number: rec.number, from: rec.paypal.status, to: s.status });
        Object.assign(rec.paypal, { status: s.status, payerUrl: s.payerUrl || rec.paypal.payerUrl });
      }
      return { changed, summary: summary(ledger.records, today()) };
    }),
  },
  collect_with_paypal: {
    title: 'Collect with PayPal',
    description: 'Send an already issued, unpaid invoice that is not on PayPal yet as a PayPal invoice, with its VeriFactu verification link.',
    inputSchema: { type: 'object', properties: { number }, required: ['number'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (a) => mutate(async (ledger) => {
      const rec = need(ledger, a.number);
      if (rec.paypal?.id) throw new ToolError(`${rec.number} is already on PayPal (${rec.paypal.status}).`);
      if (!open(rec, ledger)) throw new ToolError(`${rec.number} is ${stateOf(rec, cancelledNumbers(ledger.records), today())}; nothing to collect.`);
      if (!paypalOn()) throw new ToolError('PayPal is not configured.');
      await sendToPaypal(rec);
      return { invoice: view(rec, cancelledNumbers(ledger.records)) };
    }),
  },
  send_reminder: {
    title: 'Send payment reminder',
    description: 'Send a PayPal payment reminder for an unpaid invoice that is on PayPal.',
    inputSchema: { type: 'object', properties: { number }, required: ['number'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (a) => mutate(async (ledger) => {
      const rec = need(ledger, a.number);
      if (!rec.paypal?.id) throw new ToolError(`${rec.number} is not on PayPal. Use collect_with_paypal first.`);
      if (!open(rec, ledger)) throw new ToolError(`${rec.number} does not need a reminder.`);
      const s = await paypal.remind(rec.paypal.id);
      rec.paypal.status = s.status;
      return { reminded: rec.number, status: s.status };
    }),
  },
  record_payment: {
    title: 'Record payment',
    description: 'Record that an invoice was paid outside PayPal (bank transfer, cash). Also marks it paid in PayPal if it is there.',
    inputSchema: { type: 'object', properties: { number, method: { type: 'string', enum: METHODS, default: 'BANK_TRANSFER' }, date: { type: 'string', description: 'YYYY-MM-DD, default today' } }, required: ['number'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: (a) => mutate(async (ledger) => {
      const rec = need(ledger, a.number);
      if (!open(rec, ledger)) throw new ToolError(`${rec.number} is already ${stateOf(rec, cancelledNumbers(ledger.records), today())}.`);
      const method = METHODS.includes(a.method) ? a.method : 'BANK_TRANSFER';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') && a.date <= today() ? a.date : today();
      if (rec.paypal?.id) rec.paypal.status = (await paypal.recordPayment(rec.paypal.id, { amount: Number(rec.total), date, method })).status;
      Object.assign(rec, { paidAt: date, paidMethod: method });
      return { paid: rec.number, method, date };
    }),
  },
  cancel_invoice: {
    title: 'Cancel invoice',
    description: 'Annul an unpaid invoice issued by mistake: cancels it in PayPal and appends a VeriFactu RegistroAnulacion to the chain. The original record is never edited. Paid invoices need a corrective invoice instead.',
    inputSchema: { type: 'object', properties: { number, reason: { type: 'string', maxLength: 200 } }, required: ['number', 'reason'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    run: (a) => mutate(async (ledger) => {
      const rec = need(ledger, a.number);
      const st = stateOf(rec, cancelledNumbers(ledger.records), today());
      if (cancelledNumbers(ledger.records).has(rec.number)) throw new ToolError(`${rec.number} is already cancelled.`);
      if (st === 'PAID') throw new ToolError(`${rec.number} is paid. A paid invoice needs a corrective invoice (factura rectificativa), not a cancellation.`);
      if (rec.paypal?.id && rec.paypal.status !== 'CANCELLED') rec.paypal.status = (await paypal.cancel(rec.paypal.id, String(a.reason || '').slice(0, 200))).status;
      const anul = await buildAnulacion({ issuer: ledger.company, target: rec, prev: ledger.records.at(-1), reason: a.reason });
      ledger.records.push(anul);
      return { cancelled: rec.number, cancellationHash: anul.hash, paypal: rec.paypal?.status || null };
    }),
  },
  vat_return: {
    title: 'Modelo 303 VAT draft',
    description: 'Draft of the quarterly Modelo 303 output VAT (boxes 01-09 and 27) from the ledger, with the filing deadline. Output VAT only; deductible VAT from expenses is not included.',
    inputSchema: { type: 'object', properties: { quarter: { type: 'string', pattern: '^\\d{4}-Q[1-4]$', description: 'e.g. 2026-Q3; default is the return due now' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const ledger = await load();
      const q = /^\d{4}-Q[1-4]$/.test(a.quarter || '') ? a.quarter : returnQuarter(today());
      return { ...vatReturn(ledger.records, q), daysToDeadline: daysBetween(today(), vatReturn(ledger.records, q).deadline), note: 'Draft for your adviser, not a filing. Add deductible VAT (boxes 28-45) before filing.' };
    },
  },
  verify_ledger: {
    title: 'Verify ledger',
    description: 'Check the VeriFactu hash chain of the whole ledger: links, hashes, amounts and cancellations.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => {
      const ledger = await load();
      const v = await verifyChain(ledger.records);
      return v.ok ? { ok: true, records: v.count, lastHash: ledger.records.at(-1)?.hash || null, file: LEDGER } : { ok: false, brokenAt: ledger.records[v.index]?.number, reason: v.reason, file: LEDGER };
    },
  },
  export_verifactu_xml: {
    title: 'Export VeriFactu XML',
    description: 'Return the RegistroAlta / RegistroAnulacion XML of one invoice, or of the whole ledger.',
    inputSchema: { type: 'object', properties: { number: { ...number, description: 'Omit for every record' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (a) => {
      const ledger = await load();
      const recs = a.number ? ledger.records.filter((r) => r.number === String(a.number).toUpperCase()) : ledger.records;
      if (!recs.length) throw new ToolError(`No records for ${a.number}.`);
      return { records: recs.length, xml: `<RegistrosFacturacion>\n${recs.map(recordXml).join('\n')}\n</RegistrosFacturacion>`, kinds: recs.map((r) => (isAnulacion(r) ? 'anulacion' : 'alta')) };
    },
  },
};

const INSTRUCTIONS = 'Cuadra issues Spanish VeriFactu invoices and collects them with PayPal. Call draft_invoice first and show the user the totals and warnings; call issue_invoice only after the user confirms. Never cancel an invoice or record a payment unless the user asked for it. Figures for VAT questions must come from vat_return or list_invoices, never from your own arithmetic.';

// ---------- JSON-RPC over stdio ----------

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const fail = (id, code, message) => send({ id, error: { code, message } });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const notification = id === undefined || id === null;
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return send({ id, result: { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'cuadra', title: 'Cuadra', version: VERSION }, instructions: INSTRUCTIONS } });
  }
  if (notification) return undefined; // notifications/initialized, cancelled, progress: nothing to answer
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') {
    return send({ id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })) } });
  }
  if (method === 'tools/call') {
    const tool = Object.hasOwn(TOOLS, params.name) ? TOOLS[params.name] : null;
    if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
    try {
      const out = await tool.run(params.arguments && typeof params.arguments === 'object' ? params.arguments : {});
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false } });
    } catch (e) {
      const text = e instanceof ToolError || e?.public ? e.message : 'Unexpected error. See the server log.';
      if (!(e instanceof ToolError) && !e?.public) console.error('[cuadra-mcp]', e);
      return send({ id, result: { content: [{ type: 'text', text }], isError: true } });
    }
  }
  return fail(id, -32601, `Method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  if (Array.isArray(msg) || typeof msg !== 'object' || msg === null) return fail(null, -32600, 'Invalid request');
  handle(msg).catch((e) => { console.error('[cuadra-mcp]', e); if (msg.id != null) fail(msg.id, -32603, 'Internal error'); });
});
console.error(`[cuadra-mcp] ${VERSION} ready · ledger ${LEDGER} · PayPal ${paypalOn() ? (process.env.MOCK === '1' || process.env.MOCK_PAYPAL === '1' ? 'mock' : process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox') : 'off'}`);
