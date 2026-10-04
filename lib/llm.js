// OpenAI-compatible chat client with tool calling. Gemini by default; any compatible endpoint works.
import { PublicError, logUpstream } from './errors.js';

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
  if (/vat return|303|declaraci|trimestre/i.test(text)) return reply('Here is your Modelo 303 draft.', [call('show_vat_return', {})]);
  if (/annul|cancel|anula/i.test(text)) return reply('I can annul it with a VeriFactu cancellation record.', [call('propose_cancel', { number: num(), reason: 'Duplicate invoice' })]);
  if (/\bpaid\b|pag[oó]|transfer/i.test(text) && !/not paid|no ha pagado|unpaid/i.test(text)) return reply('I will record the payment.', [call('propose_mark_paid', { number: num(), method: 'BANK_TRANSFER' })]);
  if (/remind|recuerda|reclama|chase|overdue|vencid/i.test(text)) {
    const overdue = open.filter((i) => i.status === 'OVERDUE');
    const due = (overdue.length ? overdue : open.length ? open : [{ number: 'TEST-0001', paypal: true }]).slice(0, 5);
    return reply(`${due.length} invoice(s) to chase.`, due.map((i) => (i.paypal ? call('propose_reminder', { number: i.number }) : call('propose_collect', { number: i.number }))));
  }
  if (/invoice|factura/i.test(text)) {
    return reply('Here is the invoice draft.', [call('propose_invoice', {
      recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'buyer@example.com' },
      lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }],
      description: 'Consulting services',
      due_days: 15,
    })]);
  }
  const s = ctx.summary || {};
  return reply(`This quarter (${s.quarter || 'n/a'}): ${s.invoices ?? 0} invoices, base €${s.base ?? '0.00'}, VAT €${s.vat ?? '0.00'}. Outstanding: ${s.unpaid ?? 0} invoices, €${s.unpaidTotal ?? '0.00'} (${s.overdue ?? 0} overdue).`);
}
