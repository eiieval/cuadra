import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAndSend, status, remind } from '../lib/paypal.js';
import { cleanInvoice } from '../lib/validate.js';
import { guard, json } from '../lib/guard.js';
import { publicMessage } from '../lib/errors.js';

// Each PayPal invoice id is bound to the browser that created it with an HMAC token,
// so nobody can read the status of, or send reminders for, another session's invoices.
const key = () => createHmac('sha256', 'cuadra-invoice-token').update(process.env.PAYPAL_CLIENT_SECRET || 'dev-only-key').digest();
const sign = (id) => createHmac('sha256', key()).update(id).digest('base64url');
const owns = (id, token) => {
  const a = Buffer.from(sign(id));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

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
    if (op === 'status' || op === 'remind') {
      const id = String(g.body.id || '');
      if (!/^INV2-[A-Z0-9-]{4,40}$/.test(id)) return json(res, 400, { error: 'Invalid invoice id' });
      if (!owns(id, g.body.token)) return json(res, 403, { error: 'This invoice belongs to another session' });
      return json(res, 200, op === 'status' ? await status(id) : await remind(id));
    }
    return json(res, 400, { error: 'Unknown operation' });
  } catch (e) {
    if (!e?.public) console.error('[paypal]', e);
    return json(res, e?.status === 404 ? 404 : 502, { error: publicMessage(e) });
  }
}
