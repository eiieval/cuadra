import { verifyWebhook } from '../lib/paypal.js';
import { record } from '../lib/events.js';
import { guard, json } from '../lib/guard.js';
import { publicMessage } from '../lib/errors.js';

// PayPal webhook receiver (demo-grade). Nothing is trusted until PayPal itself says the signature is valid
// (/v1/notifications/verify-webhook-signature, needs PAYPAL_WEBHOOK_ID); verified events are deduplicated by event_id and kept
// in the memory of this function instance. The browser reads them through api/paypal.js (op: events) as an accelerator.
export default async function handler(req, res) {
  const g = await guard(req, res, { name: 'webhook', perIp: 120 });
  if (!g) return;
  const h = req.headers || {};
  const event = g.body && typeof g.body === 'object' && !Array.isArray(g.body) ? g.body : null;
  const headers = {
    auth_algo: String(h['paypal-auth-algo'] || ''),
    cert_url: String(h['paypal-cert-url'] || ''),
    transmission_id: String(h['paypal-transmission-id'] || ''),
    transmission_sig: String(h['paypal-transmission-sig'] || ''),
    transmission_time: String(h['paypal-transmission-time'] || ''),
  };
  if (!event || !event.id || Object.values(headers).some((v) => !v || v.length > 2048)) return json(res, 400, { error: 'Invalid webhook' });
  try {
    if (!(await verifyWebhook(headers, event))) return json(res, 400, { error: 'Invalid webhook' });
    const { duplicate } = record(event);
    return json(res, 200, { ok: true, duplicate });
  } catch (e) {
    if (!e?.public) console.error('[webhook]', e);
    return json(res, 502, { error: publicMessage(e) });
  }
}
