// OpenAI-compatible chat client with tool calling. Gemini by default; any compatible endpoint works.
import { PublicError, logUpstream } from './errors.js';

const LLM_DOWN = 'The AI model is unavailable right now. Please try again later.';

export function llmConfig() {
  const e = process.env;
  if (e.LLM_BASE_URL && e.LLM_API_KEY) return { base: e.LLM_BASE_URL, key: e.LLM_API_KEY, model: e.LLM_MODEL || 'gpt-4o-mini' };
  if (e.GEMINI_API_KEY) return { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: e.GEMINI_API_KEY, model: e.LLM_MODEL || 'gemini-flash-latest', fallback: ['gemini-flash-lite-latest'] };
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

// Deterministic stand-in for offline tests (MOCK=1).
function mockChat(messages) {
  const text = String(messages[messages.length - 1].content).split('\nUser: ').pop();
  const call = (name, args) => ({ id: `mock_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  if (/remind|recuerda|reclama/i.test(text)) return { role: 'assistant', content: 'I can send this reminder.', tool_calls: [call('propose_reminder', { number: 'TEST-0001' })] };
  if (/invoice|factura/i.test(text)) {
    return { role: 'assistant', content: 'Here is the invoice draft.', tool_calls: [call('propose_invoice', {
      recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'buyer@example.com' },
      lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }],
      description: 'Consulting services',
      due_days: 15,
    })] };
  }
  return { role: 'assistant', content: 'Mock answer from the ledger.' };
}
