// PayPal Invoicing v2 client (Sandbox unless PAYPAL_ENV=live). Credentials never leave the server.
import { PublicError, logUpstream } from './errors.js';
import { money } from '../public/js/verifactu.js';

const BASE = () => (process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
const DOWN = 'PayPal is unavailable right now. Please try again later.';
let cached = null;

async function token() {
  if (cached && cached.exp > Date.now() + 60000) return cached.value;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    console.error('[paypal] credentials missing');
    throw new PublicError(DOWN);
  }
  const res = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    logUpstream('paypal', `${res.status} oauth`, text, secret);
    throw new PublicError(DOWN, res.status);
  }
  const j = JSON.parse(text);
  cached = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.value;
}

async function pp(method, path, body, headers = {}) {
  if (process.env.MOCK === '1' || process.env.MOCK_PAYPAL === '1') return mock(method, path, body);
  const res = await fetch(BASE() + path, {
    method,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    logUpstream('paypal', `${res.status} ${method} ${path}`, text, process.env.PAYPAL_CLIENT_SECRET);
    throw new PublicError(res.status === 422 || res.status === 400 ? 'PayPal rejected the invoice data.' : DOWN, res.status);
  }
  return text ? JSON.parse(text) : {};
}

const term = (d) => (d <= 0 ? 'DUE_ON_RECEIPT' : d <= 10 ? 'NET_10' : d <= 15 ? 'NET_15' : d <= 30 ? 'NET_30' : d <= 45 ? 'NET_45' : 'NET_60');
const safeUrl = (u) => (/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(String(u || '')) ? u : null);

export async function status(id) {
  const j = await pp('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
  return { id: j.id || id, status: j.status || 'UNKNOWN', payerUrl: safeUrl(j.detail?.metadata?.recipient_view_url), paid: j.payments?.paid_amount?.value || null };
}

export async function createAndSend(inv) {
  const draft = await pp('POST', '/v2/invoicing/invoices', {
    detail: { invoice_number: inv.number, invoice_date: inv.date, currency_code: 'EUR', note: inv.note || undefined, payment_term: { term_type: term(inv.dueDays) } },
    invoicer: { business_name: inv.issuerName },
    ...(inv.recipient.email ? { primary_recipients: [{ billing_info: { business_name: inv.recipient.name, email_address: inv.recipient.email } }] } : {}),
    items: inv.lines.map((l) => ({
      name: l.description,
      quantity: String(l.qty),
      unit_amount: { currency_code: 'EUR', value: money(l.price) },
      ...(l.vat ? { tax: { name: 'IVA', percent: String(l.vat) } } : {}),
      unit_of_measure: 'QUANTITY',
    })),
  }, { prefer: 'return=representation' });
  const id = draft.id || String(draft.href || '').split('/').pop();
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { send_to_invoicer: false, send_to_recipient: Boolean(inv.recipient.email) });
  return status(id);
}

export async function remind(id) {
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    subject: 'Payment reminder', note: 'This invoice is still pending. Thank you!', send_to_invoicer: false, send_to_recipient: true,
  });
  return status(id);
}

// Cancel a sent invoice so the client can no longer pay it (paired with a VeriFactu cancellation record).
export async function cancel(id, reason) {
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    subject: 'Invoice cancelled', note: reason || 'This invoice has been cancelled.', send_to_invoicer: false, send_to_recipient: true,
  });
  return status(id);
}

// Record a payment received outside PayPal (bank transfer, cash) so PayPal and the ledger agree.
export async function recordPayment(id, { amount, date, method }) {
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, {
    method, payment_date: date, amount: { currency_code: 'EUR', value: money(amount) }, note: 'Recorded in Cuadra',
  });
  return status(id);
}

// Cuadra's own plans are PayPal Subscriptions. Plan ids come from `npm run paypal:setup` (see scripts/paypal-setup.js).
// Webhook signature check, done by PayPal itself: the headers of the delivery and the event go back to PayPal, which answers
// SUCCESS or FAILURE. Needs PAYPAL_WEBHOOK_ID (the id of the webhook registered with `npm run paypal:setup -- --webhook-url`).
// In MOCK mode the known test signature MOCK-VALID-SIGNATURE is the only one that verifies.
export const MOCK_SIGNATURE = 'MOCK-VALID-SIGNATURE';
export async function verifyWebhook(h, event) {
  const mockMode = process.env.MOCK === '1' || process.env.MOCK_PAYPAL === '1';
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || (mockMode ? 'WH-MOCK' : '');
  if (!webhookId) {
    console.error('[paypal] PAYPAL_WEBHOOK_ID is not set');
    throw new PublicError(DOWN);
  }
  const j = await pp('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h.auth_algo, cert_url: h.cert_url, transmission_id: h.transmission_id, transmission_sig: h.transmission_sig,
    transmission_time: h.transmission_time, webhook_id: webhookId, webhook_event: event,
  });
  return j.verification_status === 'SUCCESS';
}

export const PLANS = { pro: 'PAYPAL_PLAN_PRO', team: 'PAYPAL_PLAN_TEAM' };
const DEMO_PLANS = { pro: 'P-MOCKPRO', team: 'P-MOCKTEAM' };
const safeApprove = (u) => (/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(String(u || '')) ? u : null);
const planId = (plan) => (process.env.MOCK === '1' || process.env.MOCK_PAYPAL === '1' ? DEMO_PLANS[plan] : process.env[PLANS[plan]]);

export async function subscribe(plan, baseUrl) {
  const id = planId(plan);
  if (!id) {
    console.error(`[paypal] ${PLANS[plan]} is not configured`);
    throw new PublicError('Subscriptions are not configured on this deployment yet.');
  }
  const j = await pp('POST', '/v1/billing/subscriptions', {
    plan_id: id,
    application_context: {
      brand_name: 'Cuadra', locale: 'es-ES', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
      return_url: `${baseUrl}/?subscription=done`, cancel_url: `${baseUrl}/?subscription=cancelled#pricing`,
    },
  });
  const approveUrl = safeApprove((j.links || []).find((l) => l.rel === 'approve')?.href);
  if (!j.id || !approveUrl) throw new PublicError(DOWN);
  return { id: j.id, status: j.status, approveUrl };
}

export async function subscription(id) {
  const j = await pp('GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  const plan = Object.keys(PLANS).find((k) => planId(k) === j.plan_id) || null;
  return { id: j.id || id, status: j.status || 'UNKNOWN', plan };
}

// In-memory stand-in for offline tests and screenshots (MOCK=1).
const store = new Map();
const subs = new Map();
function mock(method, path, body) {
  if (method === 'POST' && path === '/v2/invoicing/invoices') {
    const id = `INV2-MOCK-${String(store.size + 1).padStart(4, '0')}`;
    store.set(id, { id, status: 'DRAFT', detail: { ...body.detail, metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` } } });
    return store.get(id);
  }
  if (method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
    return { verification_status: body.transmission_sig === MOCK_SIGNATURE ? 'SUCCESS' : 'FAILURE' };
  }
  if (method === 'POST' && path === '/v1/billing/subscriptions') {
    const id = `I-MOCK${String(subs.size + 1).padStart(6, '0')}`;
    subs.set(id, { id, status: 'APPROVAL_PENDING', plan_id: body.plan_id, links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-${id}` }] });
    return subs.get(id);
  }
  const sub = path.match(/subscriptions\/([^/]+)$/);
  if (sub) {
    const s = subs.get(decodeURIComponent(sub[1]));
    if (!s) throw new PublicError('Subscription not found.', 404);
    s.status = 'ACTIVE';
    return s;
  }
  const m = path.match(/invoices\/([^/]+)(?:\/(send|remind|cancel|payments))?$/);
  const inv = m && store.get(decodeURIComponent(m[1]));
  if (!inv) throw new PublicError('Invoice not found.', 404);
  if (m[2] === 'send') inv.status = 'SENT';
  if (m[2] === 'cancel') inv.status = 'CANCELLED';
  if (m[2] === 'payments') inv.status = 'MARKED_AS_PAID';
  return inv;
}
