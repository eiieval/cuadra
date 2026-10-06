#!/usr/bin/env node
// Agentic commerce, on the record. Starts the Cuadra MCP server over stdio in mock mode (PayPal in memory, a throwaway
// ledger in a temporary folder: no network, no credentials) and plays the session an AI agent has to invoice and collect:
//   initialize -> tools/list -> draft_invoice -> issue_invoice (collect_with_paypal) -> list_invoices -> verify_ledger
// Every JSON-RPC line is printed as it goes and the whole conversation is saved to public/mcp-transcript.json, which the
// page replays line by line in the "Cuadra for AI agents" section. The file holds protocol messages only: no absolute
// paths, no environment variables, mock PayPal ids.
// Usage: node scripts/mcp-demo.js [--full] [outFile]      (--full prints every line in full instead of abbreviated)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const OUT = args.find((a) => !a.startsWith('--')) || fileURLToPath(new URL('../public/mcp-transcript.json', import.meta.url));
const SERVER = fileURLToPath(new URL('../mcp/server.js', import.meta.url));

const dir = mkdtempSync(join(tmpdir(), 'cuadra-mcp-demo-'));
// The ledger path is relative to the temporary folder the server runs in, so the transcript never shows a real path.
const child = spawn(process.execPath, [SERVER], {
  cwd: dir,
  env: { PATH: process.env.PATH, MOCK: '1', CUADRA_LEDGER: 'ledger.json', CUADRA_NIF: 'B76543214', CUADRA_NAME: 'Estudio Norte SL', CUADRA_SERIES: 'CU2026' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

child.stderr.resume(); // the server logs one line there; nobody reads it
let buffer = '';
const waiting = new Map();
const stray = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { stray.push(line); continue; }
    waiting.get(msg.id)?.(msg);
  }
});

const show = (arrow, msg) => {
  const text = JSON.stringify(msg);
  console.log(`${arrow} ${FULL || text.length <= 200 ? text : `${text.slice(0, 200)}… (${text.length} bytes)`}`);
};
const log = [];
const step = { current: null };
const note = (label) => { step.current = { label, lines: [] }; log.push(step.current); console.log(`\n# ${label}`); };
const send = (msg) => { step.current.lines.push({ dir: 'out', msg }); show('→', msg); child.stdin.write(`${JSON.stringify(msg)}\n`); };
let nextId = 1;
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error(`no answer to ${method} in 10 s`)), 10000);
  waiting.set(id, (reply) => { clearTimeout(timer); step.current.lines.push({ dir: 'in', msg: reply }); show('←', reply); resolve(reply); });
  send({ jsonrpc: '2.0', id, method, params });
});
const tool = (name, args = {}) => call('tools/call', { name, arguments: args });
const data = (reply) => reply.result?.structuredContent;

const fail = (why) => { throw new Error(`The demo session did not go as expected: ${why}`); };

try {
  note('The client and the server shake hands');
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-desktop', version: '1.0.0' } });
  if (init.result?.serverInfo?.name !== 'cuadra') fail('initialize');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' }); // a notification: the server does not answer it

  note('The agent asks which tools it can call');
  const list = await call('tools/list', {});
  const names = (list.result?.tools || []).map((t) => t.name);
  if (!['draft_invoice', 'issue_invoice', 'list_invoices', 'verify_ledger'].every((n) => names.includes(n))) fail('tools/list');

  const invoice = { recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }], description: 'Consulting hours', due_days: 15 };
  note('"Invoice Acme Studio SL for 3 hours of consulting at €60." Claude drafts it first: nothing is issued yet');
  const draft = data(await tool('draft_invoice', invoice));
  if (!draft?.ok || draft.total !== '217.80') fail('draft_invoice');

  note('The user approves the draft. Claude issues the VeriFactu record and collects with PayPal');
  const issued = data(await tool('issue_invoice', { ...invoice, collect_with_paypal: true }));
  if (issued?.issued?.status !== 'SENT' || !/^INV2-MOCK-/.test(issued.issued.paypal?.id || '')) fail('issue_invoice');

  note('Claude checks what is still to collect');
  const owed = data(await tool('list_invoices', { status: 'OPEN' }));
  if (owed?.invoices?.length !== 1) fail('list_invoices');

  note('And that the hash chain of the ledger still verifies');
  const verdict = data(await tool('verify_ledger'));
  if (!verdict?.ok || verdict.records !== 1) fail('verify_ledger');

  if (stray.length) fail('the server wrote something to stdout that is not JSON-RPC');

  const transcript = {
    title: "An AI agent invoices and collects through Cuadra's MCP server",
    note: 'A real run of mcp/server.js over stdio, recorded by scripts/mcp-demo.js. PayPal is the in-memory stand-in (hence the MOCK ids) and the ledger is a throwaway file, so no network and no credentials were involved. Nothing in this file is edited.',
    server: { command: 'node mcp/server.js', name: init.result.serverInfo.name, version: init.result.serverInfo.version, protocol: init.result.protocolVersion },
    steps: log,
  };
  const text = `${JSON.stringify(transcript, null, 1)}\n`;
  // The file is public: it must carry protocol messages and nothing from this machine.
  const leaks = [/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/, /\/Users\//, /\/home\//, /\/tmp\//i, /\\Temp\\/i, /cuadra-mcp-demo/, /PAYPAL_CLIENT|GEMINI_API|LLM_API|\.env\b/].filter((re) => re.test(text));
  if (leaks.length) fail(`the transcript would leak local details (${leaks.join(', ')})`);
  writeFileSync(OUT, text);
  console.log(`\n${log.reduce((n, s) => n + s.lines.length, 0)} JSON-RPC lines recorded in ${log.length} steps. Saved ${args.some((a) => !a.startsWith('--')) ? OUT.split(/[\\/]/).at(-1) : 'public/mcp-transcript.json'} (${Math.round(text.length / 1024)} KB).`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await new Promise((done) => { child.once('exit', done); child.kill(); setTimeout(done, 2000); });
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* the operating system removes the temporary folder later */ }
}
