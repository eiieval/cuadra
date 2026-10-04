import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

loadEnv();
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const routes = {
  '/api/agent': (await import('./api/agent.js')).default,
  '/api/paypal': (await import('./api/paypal.js')).default,
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const cfg = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
const SECURITY = Object.fromEntries((cfg.headers?.[0]?.headers || []).map((x) => [x.key, x.value]));
const port = Number(process.env.PORT) || 3000;

http.createServer(async (req, res) => {
  const route = routes[req.url.split('?')[0]];
  if (route) return route(req, res);
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (path.includes('..')) { res.writeHead(400); return res.end(); }
  try {
    const buf = await readFile(join(PUBLIC, path));
    res.writeHead(200, { ...SECURITY, 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`Cuadra on http://localhost:${port}${process.env.MOCK === '1' ? ' (MOCK)' : ''}`));
