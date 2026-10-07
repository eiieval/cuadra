import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

// Zero-dependency server for local runs and for Render (npm start). Vercel serves the same files and functions natively.
loadEnv();
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const routes = {
  '/api/agent': (await import('./api/agent.js')).default,
  '/api/paypal': (await import('./api/paypal.js')).default,
  '/api/paypal-webhook': (await import('./api/paypal-webhook.js')).default,
  '/api/attest': (await import('./api/attest.js')).default,
  '/api/health': (await import('./api/health.js')).default,
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const cfg = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
const SECURITY = Object.fromEntries((cfg.headers?.[0]?.headers || []).map((x) => [x.key, x.value]));
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const route = routes[req.url.split('?')[0]];
  if (route) {
    try {
      return await route(req, res);
    } catch (e) {
      console.error('[server]', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      return res.end('{"error":"Something went wrong. Please try again."}');
    }
  }
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; } catch { path = '..'; }
  if (path.includes('..') || path.includes('\0')) { res.writeHead(400); return res.end(); }
  try {
    const buf = await readFile(join(PUBLIC, path));
    res.writeHead(200, { ...SECURITY, 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, SECURITY);
    res.end('not found');
  }
}).listen(port, () => console.log(`Cuadra on http://localhost:${port}${process.env.MOCK === '1' ? ' (MOCK)' : ''}`));
