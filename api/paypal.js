import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAndSend, status, remind, cancel, recordPayment, subscribe, subscription, PLANS } from '../lib/paypal.js';
import { cleanInvoice } from '../lib/validate.js';
import { guard, json, clean } from '../lib/guard.js';
import { publicMessage } from '../lib/errors.js';

// Each PayPal invoice or subscription id is bound to the browser that created it with an HMAC token,
// so nobody can read, chase, cancel or mark paid another session's invoices.
const key = () => createHmac('sha256', 'cuadra-invoice-token').update(process.env.PAYPAL_CLIENT_SECRET || 'dev-only-key').digest();
const sign = (id) => createHmac('sha256', key()).update(id).digest('base64url');
const owns = (id, token) => {
  const a = Buffer.from(sign(id));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

const METHODS = ['BANK_TRANSFER', 'CASH', 'OTHER'];
const INVOICE_OPS = ['status', 'remind', 'cancel', 'record_payment'];

// Absolute base URL for PayPal's return links: PUBLIC_URL if set, else the request's own host.
function baseUrl(req) {
  if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(process.env.PUBLIC_URL || '')) return process.env.PUBLIC_URL;
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '');
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'paypal', perIp: 30 });
  if (!g) return;
  const { op } = g.body;
  try {
    if (op === 'create_and_send') {
      const { problems, invoice } = cleanInvoice(g.body.invoice);
      if (problems.length) return json(res, 400, { error: `Invalid invoice: ${problems.join('; ')}` });
      const out = await createAndSend(invoice);
      return json(res, 200, { ...out, token: sign(out.id) });
    }
    if (INVOICE_OPS.includes(op)) {
      const id = String(g.body.id || '');
      if (!/^INV2-[A-Z0-9-]{4,40}$/.test(id)) return json(res, 400, { error: 'Invalid invoice id' });
      if (!owns(id, g.body.token)) return json(res, 403, { error: 'This invoice belongs to another session' });
      if (op === 'status') return json(res, 200, await status(id));
      if (op === 'remind') return json(res, 200, await remind(id));
      if (op === 'cancel') return json(res, 200, await cancel(id, clean(g.body.reason, 200)));
      const amount = Number(g.body.amount);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(g.body.date) ? g.body.date : new Date().toISOString().slice(0, 10);
      const method = METHODS.includes(g.body.method) ? g.body.method : 'BANK_TRANSFER';
      if (!(amount > 0 && amount <= 2000000)) return json(res, 400, { error: 'Invalid amount' });
      return json(res, 200, await recordPayment(id, { amount, date, method }));
    }
    if (op === 'subscribe') {
      const plan = String(g.body.plan || '');
      if (!PLANS[plan]) return json(res, 400, { error: 'Unknown plan' });
      const base = baseUrl(req);
      if (!base) return json(res, 400, { error: 'Invalid host' });
      const out = await subscribe(plan, base);
      return json(res, 200, { ...out, token: sign(out.id) });
    }
    if (op === 'subscription') {
      const id = String(g.body.id || '');
      if (!/^I-[A-Z0-9]{6,30}$/.test(id)) return json(res, 400, { error: 'Invalid subscription id' });
      if (!owns(id, g.body.token)) return json(res, 403, { error: 'This subscription belongs to another session' });
      return json(res, 200, await subscription(id));
    }
    return json(res, 400, { error: 'Unknown operation' });
  } catch (e) {
    if (!e?.public) console.error('[paypal]', e);
    return json(res, e?.status === 404 ? 404 : 502, { error: publicMessage(e) });
  }
}
