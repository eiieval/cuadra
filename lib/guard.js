// Shared request guard: method, same-origin, JSON-only, per-IP rate limit and body parsing, plus the caps of the demo.
// The demo has no accounts, so abuse is bounded by caps: per IP, and a global daily cap per endpoint. All counters live in
// memory, per instance (best effort: a cold start or a second instance starts from zero), and never leave the process.
const hits = new Map();
const days = new Map();
export const resetGuard = () => { hits.clear(); days.clear(); }; // for tests

// The visitor's address. On Vercel the platform sets x-real-ip and x-vercel-forwarded-for itself (a client cannot choose
// them). Anywhere else the proxy in front APPENDS the address it saw to x-forwarded-for, so the last hop is the trustworthy
// one and the first is whatever the client wrote. Without any header, the socket address.
export function clientIp(req) {
  const h = req.headers || {};
  const one = (v) => String(v || '').split(',').pop().trim();
  if (process.env.VERCEL) {
    const platform = one(h['x-real-ip']) || one(h['x-vercel-forwarded-for']);
    if (platform) return platform;
  }
  return one(h['x-forwarded-for']) || req.socket?.remoteAddress || 'unknown';
}

// Sliding window per key: true while under the limit (and counts this call).
export function allow(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

// One global counter per name and UTC day.
export function underDailyCap(name, max) {
  const day = new Date().toISOString().slice(0, 10);
  const c = days.get(name);
  if (!c || c.day !== day) { days.set(name, { day, n: 1 }); return true; }
  if (c.n >= max) return false;
  c.n += 1;
  return true;
}

export const CAP_MESSAGE = 'The demo has reached its daily limit for this action. Try again tomorrow.';

// Mutating operations only come from this site's own page: a browser sends Sec-Fetch-Site, curl and scripts do not.
export function sameSiteBrowser(req) {
  const h = req.headers || {};
  const site = String(h['sec-fetch-site'] || '');
  if (site !== 'same-origin' && site !== 'none') return false;
  if (h.origin) {
    try { return new URL(h.origin).host === (h['x-forwarded-host'] || h.host); } catch { return false; }
  }
  return true;
}

export function json(res, status, data, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
}

export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export async function guard(req, res, { name, perIp = 20, windowMs = 10 * 60 * 1000, dailyCap = 0 }) {
  const h = req.headers || {};
  if (req.method !== 'POST') {
    json(res, 405, { error: 'POST only' }, { allow: 'POST' });
    return null;
  }
  if (h.origin) {
    let same = false;
    try { same = new URL(h.origin).host === (h['x-forwarded-host'] || h.host); } catch { /* malformed origin */ }
    if (!same) {
      json(res, 403, { error: 'Cross-origin requests are not allowed' });
      return null;
    }
  }
  if (!String(h['content-type'] || '').includes('application/json')) {
    json(res, 415, { error: 'JSON body required' });
    return null;
  }
  const ip = clientIp(req);
  if (!allow(`${name}|${ip}`, perIp, windowMs)) {
    json(res, 429, { error: 'Too many requests. Try again in a few minutes.' }, { 'retry-after': String(Math.ceil(windowMs / 1000)) });
    return null;
  }
  if (dailyCap && !underDailyCap(name, dailyCap)) {
    json(res, 429, { error: CAP_MESSAGE }, { 'retry-after': '3600' });
    return null;
  }
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { body = {}; }
  }
  return { body, ip };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 64000) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
