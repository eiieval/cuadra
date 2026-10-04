// One-off setup of Cuadra's own billing: creates the Cuadra product and its two monthly plans in PayPal
// (Sandbox unless PAYPAL_ENV=live) and prints the plan ids to set as PAYPAL_PLAN_PRO and PAYPAL_PLAN_TEAM.
// Idempotent per product: PayPal-Request-Id makes a re-run return the same plans instead of creating new ones.
import { loadEnv } from '../lib/env.js';

loadEnv();
const BASE = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (in .env or the environment) first.');
  process.exit(1);
}

const auth = await fetch(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
if (!auth.ok) {
  console.error(`PayPal authentication failed (${auth.status}).`);
  process.exit(1);
}
const { access_token: token } = await auth.json();

async function post(path, body, requestId) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation', 'paypal-request-id': requestId },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`${path} failed (${res.status}): ${j.message || ''} ${JSON.stringify(j.details || [])}`);
    process.exit(1);
  }
  return j;
}

const product = await post('/v1/catalogs/products', {
  name: 'Cuadra',
  description: 'AI invoicing agent for PayPal merchants, VeriFactu-ready',
  type: 'SERVICE',
  category: 'SOFTWARE',
  ...(process.env.PUBLIC_URL ? { home_url: process.env.PUBLIC_URL } : {}),
}, 'cuadra-product-v1');

const plan = (key, name, description, price) => post('/v1/billing/plans', {
  product_id: product.id,
  name,
  description,
  status: 'ACTIVE',
  billing_cycles: [{
    frequency: { interval_unit: 'MONTH', interval_count: 1 },
    tenure_type: 'REGULAR',
    sequence: 1,
    total_cycles: 0,
    pricing_scheme: { fixed_price: { value: price, currency_code: 'EUR' } },
  }],
  payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
  // Spanish VAT on top of the list price, so the €9 and €29 shown on the pricing page are before VAT.
  taxes: { percentage: '21', inclusive: false },
}, `cuadra-plan-${key}-${product.id}-v1`);

const pro = await plan('pro', 'Cuadra Autónomo', 'Unlimited VeriFactu invoices, collections agent, Modelo 303 draft and MCP access', '9.00');
const team = await plan('team', 'Cuadra Gestoría', 'Everything in Autónomo for up to 10 companies, with accountant access', '29.00');

console.log(`# ${process.env.PAYPAL_ENV === 'live' ? 'Live' : 'Sandbox'} plans created. Add these to .env and to your deployment:`);
console.log(`PAYPAL_PLAN_PRO=${pro.id}`);
console.log(`PAYPAL_PLAN_TEAM=${team.id}`);
