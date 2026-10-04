import { llmConfig } from '../lib/llm.js';

// GET /api/health: liveness for Render and uptime checks. Reports which integrations are configured, never their values.
export default function handler(req, res) {
  const e = process.env;
  const body = {
    ok: true,
    mode: e.MOCK === '1' ? 'mock' : e.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    ai: Boolean(llmConfig()) || e.MOCK === '1',
    paypal: Boolean(e.PAYPAL_CLIENT_ID && e.PAYPAL_CLIENT_SECRET) || e.MOCK === '1',
    subscriptions: Boolean(e.PAYPAL_PLAN_PRO && e.PAYPAL_PLAN_TEAM) || e.MOCK === '1',
  };
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
