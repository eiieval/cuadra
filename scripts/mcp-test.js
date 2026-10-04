// Offline end-to-end test of the MCP server: spawns it over stdio with PayPal mocked and a temporary ledger.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };

const dir = mkdtempSync(join(tmpdir(), 'cuadra-mcp-'));
const ledgerPath = join(dir, 'ledger.json');
const child = spawn(process.execPath, [new URL('../mcp/server.js', import.meta.url).pathname], {
  env: { PATH: process.env.PATH, MOCK_PAYPAL: '1', CUADRA_LEDGER: ledgerPath, CUADRA_NIF: 'B76543214', CUADRA_NAME: 'Estudio Norte SL', CUADRA_SERIES: 'MCP' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const pending = new Map();
const stray = [];
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { stray.push(line); continue; }
    pending.get(msg.id)?.(msg);
  }
});
let next = 1;
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = next++;
  const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 5000);
  pending.set(id, (m) => { clearTimeout(t); resolve(m); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});
const tool = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return { error: r.result?.isError, text: r.result?.content?.[0]?.text, data: r.result?.structuredContent };
};

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  expect('initialize negotiates the protocol and advertises tools', init.result?.protocolVersion === '2025-06-18' && Boolean(init.result.capabilities.tools) && init.result.serverInfo.name === 'cuadra');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  expect('tools/list exposes the invoicing tools with schemas', ['draft_invoice', 'issue_invoice', 'cancel_invoice', 'vat_return', 'verify_ledger'].every((n) => names.includes(n)) && list.result.tools.every((t) => t.inputSchema?.type === 'object'));
  expect('cancel_invoice is flagged destructive, drafts read-only', list.result.tools.find((t) => t.name === 'cancel_invoice').annotations.destructiveHint === true && list.result.tools.find((t) => t.name === 'draft_invoice').annotations.readOnlyHint === true);

  const inv = { recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'buyer@example.com' }, lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }] };
  const d = await tool('draft_invoice', inv);
  expect('draft computes totals without issuing', d.data?.ok && d.data.total === '217.80' && d.data.number === 'MCP-0001');
  const bad = await tool('draft_invoice', { ...inv, recipient: { name: 'X', nif: 'B12345675' } });
  expect('draft reports an invalid NIF', bad.data?.ok === false && bad.data.problems.some((p) => /NIF/.test(p)));
  const badIssue = await tool('issue_invoice', { ...inv, lines: [{ description: 'x', qty: 1, price: 5, vat: 7 }] });
  expect('issue refuses invalid VAT rates', badIssue.error && /VAT/.test(badIssue.text));

  const i1 = await tool('issue_invoice', inv);
  expect('issue appends a VeriFactu record and sends it with PayPal', !i1.error && i1.data.issued.number === 'MCP-0001' && i1.data.issued.paypal?.status === 'SENT' && /ValidarQR/.test(i1.data.issued.verifyUrl));
  const i2 = await tool('issue_invoice', { ...inv, recipient: { name: 'Lumen Foods SL', nif: 'B87654323' }, collect_with_paypal: false });
  expect('issue without PayPal keeps it local', !i2.error && i2.data.issued.paypal === null && i2.data.issued.status === 'ISSUED');
  const c = await tool('collect_with_paypal', { number: 'MCP-0002' });
  expect('an issued invoice can be sent with PayPal later', !c.error && c.data.invoice.paypal?.status === 'SENT');
  const rem = await tool('send_reminder', { number: 'mcp-0001' });
  expect('reminders go through PayPal', !rem.error && rem.data.reminded === 'MCP-0001');
  const paid = await tool('record_payment', { number: 'MCP-0001', method: 'BANK_TRANSFER' });
  expect('a transfer payment marks the invoice paid', !paid.error && paid.data.paid === 'MCP-0001');
  const cpaid = await tool('cancel_invoice', { number: 'MCP-0001', reason: 'test' });
  expect('a paid invoice cannot be cancelled', cpaid.error && /corrective/.test(cpaid.text));
  const can = await tool('cancel_invoice', { number: 'MCP-0002', reason: 'Wrong client' });
  expect('cancel appends a RegistroAnulacion and cancels in PayPal', !can.error && can.data.paypal === 'CANCELLED' && /^[0-9A-F]{64}$/.test(can.data.cancellationHash));
  const l = await tool('list_invoices', { status: 'ALL' });
  expect('list shows paid and cancelled statuses', l.data.invoices.map((x) => x.status).join() === 'CANCELLED,PAID');
  const now = new Date().toLocaleDateString('sv-SE');
  const v = await tool('vat_return', { quarter: `${now.slice(0, 4)}-Q${Math.ceil(Number(now.slice(5, 7)) / 3)}` });
  expect('VAT draft counts the paid invoice and excludes the cancelled one', !v.error && v.data.boxes['07'] === '180.00' && v.data.boxes['27'] === '37.80' && v.data.cancelled === 1);
  const ok = await tool('verify_ledger');
  expect('the ledger chain verifies (2 invoices + 1 cancellation)', ok.data.ok && ok.data.records === 3);
  const x = await tool('export_verifactu_xml', {});
  expect('XML export includes the cancellation record', x.data.xml.includes('RegistroAnulacion') && x.data.kinds.join() === 'alta,alta,anulacion');

  const stored = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  stored.records[0].total = '9999.00';
  writeFileSync(ledgerPath, JSON.stringify(stored));
  const tampered = await tool('verify_ledger');
  expect('editing the ledger file is detected', tampered.data.ok === false && tampered.data.brokenAt === 'MCP-0001');
  const blocked = await tool('issue_invoice', inv);
  expect('no new invoice is written on a tampered ledger', blocked.error && /integrity/.test(blocked.text));

  const unknown = await rpc('tools/call', { name: 'constructor', arguments: {} });
  expect('unknown tools are a protocol error', unknown.error?.code === -32602);
  const nomethod = await rpc('resources/list', {});
  expect('unknown methods return -32601', nomethod.error?.code === -32601);
  expect('stdout carries only JSON-RPC messages', stray.length === 0);
} catch (e) {
  console.log('FAIL', e.message);
  failed++;
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `${failed} MCP check(s) failed` : 'all MCP checks passed');
process.exit(failed ? 1 : 0);
