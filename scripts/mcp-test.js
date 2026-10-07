// Offline end-to-end test of the MCP server: spawns it over stdio with PayPal mocked and a temporary ledger.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };

const dir = mkdtempSync(join(tmpdir(), 'cuadra-mcp-'));
const ledgerPath = join(dir, 'ledger.json');
const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.js', import.meta.url))], {
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

  const rUnpaid = await tool('rectify_invoice', { number: 'MCP-0002', reason: 'x', lines: inv.lines });
  expect('rectify_invoice refuses an invoice that is not paid', rUnpaid.error && /Only paid invoices/.test(rUnpaid.text));
  const rBad = await tool('rectify_invoice', { number: 'MCP-0001', reason: 'x', lines: [{ description: 'x', qty: 1, price: 5, vat: 7 }] });
  expect('rectify_invoice refuses invalid corrected lines', rBad.error && /VAT/.test(rBad.text));
  const rect = await tool('rectify_invoice', { number: 'MCP-0001', reason: 'Wrong price', lines: [{ description: 'Consulting', qty: 3, price: 50, vat: 21 }] });
  expect('rectify_invoice issues an R1 that points at the paid invoice, with the engine totals', !rect.error && rect.data.type === 'R1' && rect.data.rectified === 'MCP-0001' && rect.data.corrective.number === 'MCP-0003' && rect.data.newTotal === '181.50' && rect.data.difference === '-36.30' && /^[0-9A-F]{64}$/.test(rect.data.corrective.hash));
  const rTwice = await tool('rectify_invoice', { number: 'MCP-0001', reason: 'again', lines: inv.lines });
  expect('a rectified invoice cannot be rectified again nor cancelled', rTwice.error && /already been rectified/.test(rTwice.text) && (await tool('cancel_invoice', { number: 'MCP-0001', reason: 'x' })).error);
  const l2 = await tool('list_invoices', { status: 'ALL' });
  expect('the original shows as RECTIFIED and the R1 as PAID', l2.data.invoices.map((q) => `${q.number}:${q.status}`).join() === 'MCP-0003:PAID,MCP-0002:CANCELLED,MCP-0001:RECTIFIED');
  const ok2 = await tool('verify_ledger');
  const x2 = await tool('export_verifactu_xml', { number: 'MCP-0003' });
  expect('the chain verifies with the corrective invoice and its XML carries FacturasRectificadas', ok2.data.ok && ok2.data.records === 4 && x2.data.xml.includes('<sum1:TipoFactura>R1</sum1:TipoFactura>') && x2.data.xml.includes('<sum1:NumSerieFactura>MCP-0001</sum1:NumSerieFactura>'));
  const v2 = await tool('vat_return', { quarter: `${now.slice(0, 4)}-Q${Math.ceil(Number(now.slice(5, 7)) / 3)}` });
  expect('the VAT draft counts the corrective invoice instead of the rectified one', v2.data.boxes['27'] === '31.50');

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

  // The recorded session (B4): public/mcp-transcript.json is a real run of this server, replayed on the page, and it is safe to
  // publish. scripts/mcp-demo.js makes it offline; running it again must give the same conversation.
  {
    const flatten = (t) => t.steps.flatMap((s) => s.lines);
    const methodsOf = (t) => flatten(t).filter((l) => l.dir === 'out' && l.msg.id != null).map((l) => (l.msg.method === 'tools/call' ? l.msg.params.name : l.msg.method));
    const WANTED = 'initialize,tools/list,draft_invoice,issue_invoice,list_invoices,verify_ledger';
    const checkTranscript = (label, text) => {
      const t = JSON.parse(text);
      const lines = flatten(t);
      const requests = lines.filter((l) => l.dir === 'out' && l.msg.id != null);
      const answered = requests.every((r) => lines.filter((l) => l.dir === 'in' && l.msg.id === r.msg.id).length === 1);
      const byName = (name) => lines.find((l) => l.dir === 'in' && l.msg.id === requests.find((r) => r.msg.params?.name === name)?.msg.id)?.msg.result;
      const issue = lines.find((l) => l.dir === 'out' && l.msg.params?.name === 'issue_invoice')?.msg;
      const issued = byName('issue_invoice')?.structuredContent?.issued;
      expect(`${label}: the six methods of the session, in order (${WANTED.replaceAll(',', ' → ')})`, methodsOf(t).join() === WANTED && t.steps.length === 6 && t.steps.every((s) => typeof s.label === 'string' && s.label.length > 10));
      expect(`${label}: every request is answered once, none with an error, and the initialized notification has no id and no answer`, answered && lines.filter((l) => l.dir === 'in').every((l) => !l.msg.error && l.msg.jsonrpc === '2.0') && lines.filter((l) => l.msg.method === 'notifications/initialized').length === 1 && lines.find((l) => l.msg.method === 'notifications/initialized').msg.id === undefined && lines.length === 13);
      expect(`${label}: the invoice is issued with collect_with_paypal and comes back sent, with a mock PayPal id, a sandbox payer link, the AEAT verification URL and a SHA-256 hash`, issue?.params.arguments.collect_with_paypal === true && issued?.status === 'SENT' && issued.total === '217.80' && /^INV2-MOCK-\d{4}$/.test(issued.paypal?.id) && /^https:\/\/www\.sandbox\.paypal\.com\//.test(issued.paypal?.payerUrl) && /^https:\/\/prewww2\.aeat\.es\//.test(issued.verifyUrl) && /^[0-9A-F]{64}$/.test(issued.hash));
      expect(`${label}: the draft comes before the issue and issues nothing, the list shows the open invoice, the chain verifies (1 record, ledger path relative)`, byName('draft_invoice')?.structuredContent?.ok === true && byName('draft_invoice').structuredContent.total === '217.80' && byName('list_invoices')?.structuredContent?.invoices?.length === 1 && byName('list_invoices').structuredContent.invoices[0].status === 'SENT' && byName('verify_ledger')?.structuredContent?.ok === true && byName('verify_ledger').structuredContent.records === 1 && byName('verify_ledger').structuredContent.file === 'ledger.json' && byName('verify_ledger').structuredContent.lastHash === issued.hash);
      const toolsReply = lines.find((l) => l.dir === 'in' && l.msg.id === requests.find((r) => r.msg.method === 'tools/list').msg.id).msg.result;
      expect(`${label}: tools/list carries the 12 tools with their input schemas and annotations`, toolsReply.tools.length === 12 && toolsReply.tools.every((tool) => tool.inputSchema?.type === 'object' && tool.annotations) && toolsReply.tools.some((tool) => tool.name === 'cancel_invoice' && tool.annotations.destructiveHint === true));
      const secrets = [/AIza[0-9A-Za-z_-]{35}/, /github_pat_[0-9A-Za-z_]{20,}/, /\bgh[pousr]_[0-9A-Za-z]{30,}/, /\bvc[pk]_[0-9A-Za-z]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /Bearer\s+[0-9A-Za-z._-]{24,}/, /\bsk-[0-9A-Za-z]{20,}/, /PAYPAL_CLIENT|GEMINI_API|LLM_API|CUADRA_LEDGER/, /"(?:token|secret|password|authorization|api[_-]?key)"/i];
      const paths = [/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/, /\/Users\//, /\/home\//, /\/tmp\//i, /\\Users\\/i, /AppData/i, /\\Temp\\/i, /cuadra-mcp/i, /\.env\b/];
      expect(`${label}: no secret, token, environment variable name or absolute path anywhere in the file`, !secrets.some((re) => re.test(text)) && !paths.some((re) => re.test(text)) && !('env' in t.server) && Object.keys(t.server).join() === 'command,name,version,protocol');
      return t;
    };
    const committed = readFileSync(new URL('../public/mcp-transcript.json', import.meta.url), 'utf8');
    checkTranscript('transcript (committed)', committed);

    const out = join(dir, 'transcript-check.json');
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./mcp-demo.js', import.meta.url)), out], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 30000 });
    expect('mcp-demo.js runs offline (no network, no keys), prints every JSON-RPC line with an arrow and ends with exit code 0', run.status === 0 && (run.stdout.match(/^→ /gm) || []).length === 7 && (run.stdout.match(/^← /gm) || []).length === 6 && /JSON-RPC lines recorded/.test(run.stdout) && !/[A-Za-z]:\\/.test(run.stdout));
    const fresh = checkTranscript('transcript (fresh run)', readFileSync(out, 'utf8'));
    expect('a fresh run records the same conversation as the committed one (same steps, requests and tool names)', JSON.stringify(fresh.steps.map((s) => [s.label, s.lines.map((l) => l.msg.method || l.msg.params?.name || l.dir)])) === JSON.stringify(JSON.parse(committed).steps.map((s) => [s.label, s.lines.map((l) => l.msg.method || l.msg.params?.name || l.dir)])) && fresh.server.version === JSON.parse(committed).server.version);
  }
} catch (e) {
  console.log('FAIL', e.message);
  failed++;
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `${failed} MCP check(s) failed` : 'all MCP checks passed');
process.exit(failed ? 1 : 0);
