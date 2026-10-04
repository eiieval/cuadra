import { runAgent } from '../lib/agent.js';
import { guard, json, clean } from '../lib/guard.js';
import { publicMessage } from '../lib/errors.js';

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

// POST { message, context } -> { reply, actions }. Actions are proposals; the user confirms them in the UI.
export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'agent', perIp: 20 });
  if (!g) return;
  const message = clean(g.body.message, 500);
  if (!message) return json(res, 400, { error: 'message is required' });
  const c = g.body.context && typeof g.body.context === 'object' ? g.body.context : {};
  const s = c.summary && typeof c.summary === 'object' ? c.summary : {};
  const context = {
    today: /^\d{4}-\d{2}-\d{2}$/.test(c.today) ? c.today : new Date().toISOString().slice(0, 10),
    summary: { quarter: clean(s.quarter, 10), invoices: num(s.invoices), base: num(s.base), vat: num(s.vat), unpaid: num(s.unpaid), unpaidTotal: num(s.unpaidTotal), collected: num(s.collected) },
    invoices: (Array.isArray(c.invoices) ? c.invoices : []).slice(-25).map((i) => ({
      number: clean(i?.number, 60), client: clean(i?.client, 120), total: num(i?.total), vat: num(i?.vat), status: clean(i?.status, 20), date: clean(i?.date, 10),
    })),
  };
  try {
    json(res, 200, await runAgent({ message, context }));
  } catch (e) {
    if (!e?.public) console.error('[agent]', e);
    json(res, 502, { error: publicMessage(e) });
  }
}
