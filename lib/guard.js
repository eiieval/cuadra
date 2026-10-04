// Shared request guard: method, same-origin, JSON-only, per-IP rate limit (per instance, best effort) and body parsing.
const hits = new Map();

export function json(res, status, data, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
}

export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export async function guard(req, res, { name, perIp = 20, windowMs = 10 * 60 * 1000 }) {
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
  const ip = String(h['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const key = `${name}|${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= perIp) {
    hits.set(key, recent);
    json(res, 429, { error: 'Too many requests. Try again in a few minutes.' }, { 'retry-after': String(Math.ceil(windowMs / 1000)) });
    return null;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
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
