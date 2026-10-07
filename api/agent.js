import { runAgent } from '../lib/agent.js';
import { guard, json, clean } from '../lib/guard.js';
import { publicMessage } from '../lib/errors.js';

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(-max) : []);

// Earlier turns, shaped for strict alternation starting with the user, as some models require: only user and
// assistant turns, bounded sizes, same-role neighbours merged, no leading reply and no trailing user turn.
export function shapeHistory(raw) {
  const history = list(raw, 8)
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant'))
    .map((h) => ({ role: h.role, text: clean(h.text, 800) }))
    .filter((h) => h.text)
    .reduce((out, h) => {
      if (out.at(-1)?.role === h.role) out.at(-1).text = `${out.at(-1).text}\n${h.text}`.slice(0, 1600);
      else out.push(h);
      return out;
    }, []);
  while (history[0]?.role === 'assistant') history.shift();
  if (history.at(-1)?.role === 'user') history.pop();
  return history;
}

// POST { message, context, history } -> { reply, actions }. Actions are proposals; the user confirms them in the UI.
// Everything the browser sends is re-shaped here: only known fields, bounded sizes, no control characters.
export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'agent', perIp: 20, dailyCap: 2000 });
  if (!g) return;
  const message = clean(g.body.message, 500);
  if (!message) return json(res, 400, { error: 'message is required' });
  const c = g.body.context && typeof g.body.context === 'object' ? g.body.context : {};
  const s = c.summary && typeof c.summary === 'object' ? c.summary : {};
  const v = c.vatReturn && typeof c.vatReturn === 'object' ? c.vatReturn : {};
  const context = {
    today: day(c.today) || new Date().toISOString().slice(0, 10),
    summary: {
      quarter: clean(s.quarter, 10), invoices: num(s.invoices), base: num(s.base), vat: num(s.vat),
      unpaid: num(s.unpaid), unpaidTotal: num(s.unpaidTotal), overdue: num(s.overdue), overdueTotal: num(s.overdueTotal), collected: num(s.collected),
    },
    vatReturn: { quarter: clean(v.quarter, 10), deadline: day(v.deadline), outputVat: num(v.outputVat) },
    invoices: list(c.invoices, 40).map((i) => ({
      number: clean(i?.number, 60), client: clean(i?.client, 120), total: num(i?.total), vat: num(i?.vat),
      status: clean(i?.status, 20), date: clean(i?.date, 10), due: day(i?.due), paypal: Boolean(i?.paypal),
      // Lines travel only for PAID invoices, so a corrective invoice can start from what was billed.
      ...(Array.isArray(i?.lines) ? { lines: i.lines.slice(0, 10).map((l) => ({ description: clean(l?.description, 120), qty: num(l?.qty), price: num(l?.price), vat: num(l?.vat) })) } : {}),
    })),
    clients: list(c.clients, 30).map((k) => ({ name: clean(k?.name, 120), nif: clean(k?.nif, 20), email: clean(k?.email, 254) })),
  };
  const history = shapeHistory(g.body.history);
  try {
    json(res, 200, await runAgent({ message, context, history }));
  } catch (e) {
    if (!e?.public) console.error('[agent]', e);
    json(res, 502, { error: publicMessage(e) });
  }
}
