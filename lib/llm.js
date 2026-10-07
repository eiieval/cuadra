// OpenAI-compatible chat client with tool calling. Gemini by default; any compatible endpoint works.
import { PublicError, logUpstream } from './errors.js';
import { previousQuarter } from '../public/js/ledger.js';

const LLM_DOWN = 'The AI model is unavailable right now. Please try again later.';

export function llmConfig() {
  const e = process.env;
  if (e.LLM_BASE_URL && e.LLM_API_KEY) return { base: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL || 'gpt-4o-mini' };
  if (e.GEMINI_API_KEY) return { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: e.GEMINI_API_KEY, model: e.LLM_MODEL || 'gemini-flash-lite-latest', fallback: ['gemini-flash-latest'] };
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chat({ messages, tools }) {
  if (process.env.MOCK === '1') return mockChat(messages);
  const cfg = llmConfig();
  if (!cfg) {
    console.error('[llm] no LLM key configured');
    throw new PublicError(LLM_DOWN);
  }
  const models = [cfg.model, ...(cfg.fallback || [])];
  let last = '';
  let status = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const model = models[Math.min(attempt, models.length - 1)];
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (res.ok) {
      const msg = JSON.parse(text).choices?.[0]?.message;
      if (msg) return msg;
    }
    status = res.status;
    last = `${model}: ${text}`;
    if (res.status !== 429 && res.status < 500) break;
    const delay = Number((text.match(/retryDelay"?\s*:\s*"?(\d+)/) || [])[1]) || 5;
    await sleep(attempt < models.length - 1 ? 300 : Math.min(delay * 1000 + 500, 15000));
  }
  logUpstream('llm', status, last, cfg.key);
  throw new PublicError(status === 429 ? 'The AI model is busy. Please try again in a minute.' : LLM_DOWN, status);
}

// Reads a question about figures the way the real model does and returns a widget specification, or null if it is not one.
export function widgetQuestion(text, ctx = {}) {
  const t = String(text).toLowerCase();
  const owes = /who owes|owes me|owe me|qui[eé]n me debe|me deben|who has(?:n't| not) paid/.test(t);
  const revenue = /revenue|sales\b|ingresos|facturaci[oó]n|facturado|how much (?:did i|have i) (?:invoice|bill)|invoiced (?:by|per|this|last|in)/.test(t);
  const aging = /aging|ageing|how old|antig[uü]edad/.test(t);
  const vat = /\bvat (?:by|per)\b|\biva (?:por|según)\b/.test(t);
  const collected = /collected (?:by|per|this|last|in)|cobrado/.test(t);
  if (!(owes || revenue || aging || vat || collected)) return null;
  const byMonth = /by month|per month|monthly|por mes|mensual/.test(t);
  const byRate = /by (?:vat )?rate|por tipo/.test(t);
  const named = text.match(/\b(20\d{2})\s*-?\s*Q([1-4])\b/i) || text.match(/\bQ([1-4])\s*-?\s*(20\d{2})\b/i);
  const quarter = String(ctx.summary?.quarter || '');
  const period = named ? `${named[1].length === 4 ? named[1] : named[2]}-Q${named[1].length === 4 ? named[2] : named[1]}`
    : /last quarter|previous quarter|trimestre (?:pasado|anterior)/.test(t) && /^\d{4}-Q[1-4]$/.test(quarter) ? previousQuarter(quarter)
      : /this year|este a[nñ]o/.test(t) ? 'year'
        : /this quarter|este trimestre/.test(t) ? 'quarter'
          : owes || aging || byMonth ? 'all' : 'quarter';
  if (owes) return { title: 'Who still owes what', type: 'donut', metric: 'outstanding', groupBy: 'client', period };
  if (aging) return { title: 'Receivables aging', type: 'bar', metric: 'outstanding', groupBy: 'aging', period: 'all' };
  if (vat) return { title: 'VAT charged by rate', type: 'bar', metric: 'vat', groupBy: 'vatRate', period };
  const metric = collected && !revenue ? 'collected' : 'invoiced';
  const groupBy = byMonth ? 'month' : byRate ? 'vatRate' : 'client';
  const what = metric === 'collected' ? 'Collected' : 'Revenue';
  return { title: `${what} by ${groupBy === 'vatRate' ? 'VAT rate' : groupBy}`, type: 'bar', metric, groupBy, period };
}

// Deterministic stand-in for offline tests and screenshots (MOCK=1). It reads the ledger context like the real model would.
function mockChat(messages) {
  const last = String(messages[messages.length - 1].content);
  const text = last.split('\nUser: ').pop();
  let ctx = {};
  try { ctx = JSON.parse(last.slice(last.indexOf('{'), last.lastIndexOf('\nUser: '))); } catch { /* no context */ }
  const inv = Array.isArray(ctx.invoices) ? ctx.invoices : [];
  const open = inv.filter((i) => !['PAID', 'CANCELLED'].includes(i.status));
  const word = (i) => String(i.client || '').split(/\s+/)[0].replace(/[^\p{L}\d]/gu, '');
  const byClient = open.find((i) => word(i).length > 1 && new RegExp(`\\b${word(i)}\\b`, 'iu').test(text));
  const pick = (re) => (text.match(re) || [])[0] || byClient?.number || open.at(-1)?.number || inv.at(-1)?.number || 'TEST-0001';
  const num = () => pick(/[A-Z0-9]{2,12}-\d{4}/i);
  const call = (name, args) => ({ id: `mock_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const reply = (content, calls = []) => ({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });
  if (/close (?:my|the|this) quarter|cierra(?:me)? el trimestre|cierre del trimestre/i.test(text)) {
    // One plan: remind overdue invoices that are on PayPal, send the others to PayPal, then the VAT draft. Most overdue first.
    const es = /cierra|cierre/i.test(text);
    const byDue = (a, b) => String(a.due || '').localeCompare(String(b.due || ''));
    const reminders = open.filter((i) => i.status === 'OVERDUE' && i.paypal).sort(byDue);
    const collects = open.filter((i) => !i.paypal).sort(byDue);
    const steps = [...reminders.map((i) => call('propose_reminder', { number: i.number })), ...collects.map((i) => call('propose_collect', { number: i.number }))].slice(0, 8);
    const said = es
      ? `Plan para cerrar el trimestre: ${reminders.length} recordatorio(s), ${collects.length} cobro(s) con PayPal y tu borrador del IVA.`
      : `Plan to close the quarter: ${reminders.length} reminder(s), ${collects.length} collection(s) with PayPal and your VAT draft.`;
    return reply(said, [...steps, call('show_vat_return', {})]);
  }
  // Questions about figures end in a widget: the model (here, this stand-in) only picks what to show; the app computes the
  // numbers. Like Gemini Flash-Lite it answers with the tool call and no text, so the browser writes the sentence.
  const asked = widgetQuestion(text, ctx);
  if (asked) return reply('', [call('propose_widget', asked)]);
  if (/vat return|303|declaraci|trimestre/i.test(text)) return reply('Here is your Modelo 303 draft.', [call('show_vat_return', {})]);
  if (/rectif|corrective|corrige|correct(?:ion)? (?:the )?invoice/i.test(text)) {
    // A corrective invoice for a PAID invoice: the lines of the original with the price the user gave (the ledger context carries them).
    const paid = inv.filter((i) => i.status === 'PAID');
    const target = paid.find((i) => text.toUpperCase().includes(i.number)) || paid[0];
    const price = Number(String(text.match(/(?:price|precio)[^\d]{0,12}(\d+(?:[.,]\d+)?)|(?:to|a|por|=)\s*[€$]?\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)?\s*$/i)?.slice(1).find(Boolean) || '').replace(',', '.'));
    const base = Array.isArray(target?.lines) && target.lines.length ? target.lines : [{ description: 'Corrected service', qty: 1, price: price || 1, vat: 21 }];
    const lines = base.map((l, k) => (k === 0 && price > 0 ? { ...l, price } : l));
    return reply('', [call('propose_rectify', { number: target?.number || num(), reason: /price|precio/i.test(text) ? 'Wrong price' : 'Correction', lines })]);
  }
  if (/annul|cancel|anula/i.test(text)) return reply('I can annul it with a VeriFactu cancellation record.', [call('propose_cancel', { number: num(), reason: 'Duplicate invoice' })]);
  if (/\bpaid\b|pag[oó]|transfer/i.test(text) && !/not paid|no ha pagado|unpaid/i.test(text)) return reply('I will record the payment.', [call('propose_mark_paid', { number: num(), method: 'BANK_TRANSFER' })]);
  if (/remind|recuerda|reclama|chase|overdue|vencid/i.test(text)) {
    const overdue = open.filter((i) => i.status === 'OVERDUE');
    const due = (overdue.length ? overdue : open.length ? open : [{ number: 'TEST-0001', paypal: true }]).slice(0, 5);
    return reply(`${due.length} invoice(s) to chase.`, due.map((i) => (i.paypal ? call('propose_reminder', { number: i.number }) : call('propose_collect', { number: i.number }))));
  }
  if (/invoice|factura/i.test(text)) {
    // The same reading of the ledger context a real model does: a known client keeps its NIF and email.
    const clients = Array.isArray(ctx.clients) ? ctx.clients : [];
    const first = (c) => String(c.name || '').split(/\s+/)[0].replace(/[^\p{L}\d]/gu, '');
    const known = clients.find((c) => first(c).length > 1 && new RegExp(`\\b${first(c)}\\b`, 'iu').test(text));
    const nif = (text.match(/\b(?:[A-HJ-NP-SUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/i) || [])[0]?.toUpperCase();
    const named = (text.match(/(?:invoice|factura(?:\s+a)?)\s+([^(),\d€$]+?)\s*(?:\(|\bfor\b|\bpor\b|,|$)/i) || [])[1]?.trim();
    const to = known ? { name: known.name, nif: known.nif || nif || '', email: known.email || '' }
      : named ? { name: named, nif: nif || '', email: '' } : { name: 'Acme Studio SL', nif: 'B12345674', email: 'buyer@example.com' };
    const m = text.match(/(\d+(?:[.,]\d+)?)\s+(?:(?:hours?|horas?|days?|d[ií]as?)\s+(?:of|de)\s+)?([\p{L}][\p{L}]*(?:\s+(?:de|of)\s+[\p{L}]+)?)\s+(?:at|a|@|por)\s*[€$]?\s*(\d+(?:[.,]\d+)?)/iu);
    const n = (v, d) => (Number(String(v).replace(',', '.')) > 0 ? Number(String(v).replace(',', '.')) : d);
    const what = m && !/^(?:hours?|horas?|days?|d[ií]as?)$/i.test(m[2]) ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : 'Consulting';
    return reply('', [call('propose_invoice', {
      recipient: to,
      lines: [{ description: what, qty: n(m?.[1], 3), price: n(m?.[3], 60), vat: 21 }],
      description: what,
      due_days: 15,
    })]);
  }
  const s = ctx.summary || {};
  return reply(`This quarter (${s.quarter || 'n/a'}): ${s.invoices ?? 0} invoices, base €${s.base ?? '0.00'}, VAT €${s.vat ?? '0.00'}. Outstanding: ${s.unpaid ?? 0} invoices, €${s.unpaidTotal ?? '0.00'} (${s.overdue ?? 0} overdue).`);
}
