// Offline tests: VeriFactu engine against the official AEAT example, QR generation, and API security. No keys needed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { altaHashInput, sha256Hex, buildAlta, verifyChain, qrUrl, totals, validNif, altaXml } from '../public/js/verifactu.js';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };

// 1. VeriFactu engine
const aeat = { nif: '89890001K', number: '12345678/G33', date: '01-01-2024', type: 'F1', taxTotal: '12.35', total: '123.45', prevHash: '', generatedAt: '2024-01-01T19:20:30+01:00' };
expect('hash matches the official AEAT example', (await sha256Hex(altaHashInput(aeat))) === '3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
const t = totals([{ qty: 3, price: 60, vat: 21 }, { qty: 1, price: 10, vat: 10 }]);
expect('totals are grouped per VAT rate', t.total === '228.80' && t.taxTotal === '38.80' && t.breakdown.length === 2);
const issuer = { name: 'Test SL', nif: 'B76543214' };
const chain = [];
for (let i = 1; i <= 3; i++) {
  chain.push(await buildAlta({ issuer, invoice: { number: `T-000${i}`, date: '2026-10-04', recipient: { name: 'Acme', nif: 'B12345674' }, lines: [{ description: 'Work', qty: i, price: 100, vat: 21 }] }, prev: chain[i - 2] || null, generatedAt: '2026-10-04T12:00:00+02:00' }));
}
expect('a 3-record chain verifies', (await verifyChain(chain)).ok);
expect('each record links to the previous hash', chain[1].prevHash === chain[0].hash && chain[2].prevHash === chain[1].hash);
const altered = structuredClone(chain);
altered[1].total = '999.00';
const v = await verifyChain(altered);
expect('altering an issued amount is detected at that record', !v.ok && v.index === 1);
const removed = structuredClone(chain);
removed.splice(1, 1);
expect('deleting a record breaks the chain', !(await verifyChain(removed)).ok);
expect('QR URL encodes the invoice series safely', qrUrl({ ...aeat, number: '12345678&G33', total: '241.40' }).includes('numserie=12345678%26G33'));
expect('NIF, CIF and NIE validation', validNif('89890001K') && validNif('B12345674') && validNif('X1234567L') && !validNif('B12345675'));
const xml = altaXml({ ...chain[1], recipient: { name: 'A&B <script>', nif: 'B12345674' } });
expect('RegistroAlta XML escapes user text', xml.includes('A&amp;B &lt;script&gt;') && xml.includes('<sum1:RegistroAnterior>'));

// 2. Vendored QR library renders an SVG
const sandbox = {};
vm.runInNewContext(`${readFileSync(new URL('../public/vendor/qrcode/qrcode.js', import.meta.url), 'utf8')}\nthis.q = qrcode;`, sandbox);
const qr = sandbox.q(0, 'M');
qr.addData(chain[0].qr);
qr.make();
expect('QR code SVG is generated for the AEAT URL', qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).startsWith('<svg'));

// 3. API security
process.env.MOCK = '1';
const { default: agent } = await import('../api/agent.js');
const { default: paypal } = await import('../api/paypal.js');
async function call(handler, { method = 'POST', headers = {}, body = {} } = {}) {
  let out = '';
  let status = 200;
  const res = { writeHead(s) { status = s; }, setHeader() {}, write(c) { out += c; }, end(c) { if (c) out += c; } };
  await handler({ method, headers: { 'content-type': 'application/json', host: 'localhost', 'x-forwarded-for': '1.1.1.1', ...headers }, body }, res);
  let json = null;
  try { json = JSON.parse(out); } catch { /* not JSON */ }
  return { status, json };
}
const a = await call(agent, { body: { message: 'Invoice Acme for 3 hours at 60', context: { invoices: [] } } });
expect('agent proposes an invoice and never issues it', a.status === 200 && a.json.actions[0]?.type === 'propose_invoice');
const good = { number: 'CUTEST-0001', date: '2026-10-04', recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'buyer@example.com' }, lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }] };
const created = await call(paypal, { body: { op: 'create_and_send', invoice: good } });
expect('PayPal invoice is created and sent', created.status === 200 && created.json.status === 'SENT' && Boolean(created.json.token));
expect('owner can read the invoice status', (await call(paypal, { body: { op: 'status', id: created.json.id, token: created.json.token } })).status === 200);
expect('another session cannot read it (403)', (await call(paypal, { body: { op: 'status', id: created.json.id, token: 'forged' } })).status === 403);
expect('negative prices are rejected (400)', (await call(paypal, { body: { op: 'create_and_send', invoice: { ...good, lines: [{ description: 'x', qty: 1, price: -5, vat: 21 }] } } })).status === 400);
expect('non-Spanish VAT rates are rejected (400)', (await call(paypal, { body: { op: 'create_and_send', invoice: { ...good, lines: [{ description: 'x', qty: 1, price: 5, vat: 7 }] } } })).status === 400);
expect('invalid recipient NIF is rejected (400)', (await call(paypal, { body: { op: 'create_and_send', invoice: { ...good, recipient: { ...good.recipient, nif: 'B12345675' } } } })).status === 400);
expect('cross-origin requests are rejected (403)', (await call(paypal, { headers: { origin: 'https://evil.example' }, body: { op: 'status' } })).status === 403);
expect('non-JSON requests are rejected (415)', (await call(agent, { headers: { 'content-type': 'text/plain' } })).status === 415);
let last = 0;
for (let i = 0; i < 21; i++) last = (await call(agent, { headers: { 'x-forwarded-for': '9.9.9.9' }, body: {} })).status;
expect('per-IP rate limit kicks in (429)', last === 429);
delete process.env.MOCK;
const origError = console.error;
console.error = () => {};
const down = await call(paypal, { headers: { 'x-forwarded-for': '3.3.3.3' }, body: { op: 'create_and_send', invoice: good } });
console.error = origError;
expect('a PayPal outage returns a generic error only', down.status === 502 && /unavailable/i.test(down.json?.error) && !/client|secret|token/i.test(down.json?.error));

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
