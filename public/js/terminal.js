// The terminal in "Cuadra for AI agents": it replays, line by line, the MCP session that scripts/mcp-demo.js recorded from the
// real server (public/mcp-transcript.json): the handshake, the tools, a draft, the issue with PayPal, the open invoices, the
// chain check. The helpers (abbreviating a message for reading, colouring JSON, flattening the transcript into lines) are
// pure and run under Node for the tests; playTranscript() is the only part that touches the page.
import { esc } from './fmt.js';

// A JSON-RPC message written for reading: pretty printed, with small objects and lists kept on one line, long strings and long
// lists cut with an ellipsis and deep objects folded. The `…` is plain text, not JSON: this is what the terminal shows, the
// full message is in mcp-transcript.json.
const cut = (text, str) => (text.length > str ? `${text.slice(0, str - 1)}…` : text);

// One line, abbreviated: { "a": 1, "b": [1, 2, …+3 more] }.
function oneLine(value, o, level) {
  if (typeof value === 'string') return JSON.stringify(cut(value, o.str));
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (level >= o.depth) return '[…]';
    const shown = value.slice(0, o.arr).map((x) => oneLine(x, o, level + 1));
    if (value.length > o.arr) shown.push(`…+${value.length - o.arr} more`);
    return `[${shown.join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    if (level >= o.depth) return '{…}';
    return `{ ${keys.map((k) => `${JSON.stringify(k)}: ${oneLine(value[k], o, level + 1)}`).join(', ')} }`;
  }
  return JSON.stringify(value);
}

export function prettyJson(value, { depth = 5, str = 54, arr = 2, inline = 78 } = {}, level = 0) {
  const o = { depth, str, arr };
  const flat = oneLine(value, o, level);
  if (flat.length <= inline || typeof value !== 'object' || value === null) return flat;
  const pad = '  '.repeat(level);
  if (Array.isArray(value)) {
    const shown = value.slice(0, arr).map((x) => `${pad}  ${prettyJson(x, { depth, str, arr, inline }, level + 1)}`);
    if (value.length > arr) shown.push(`${pad}  …+${value.length - arr} more`);
    return `[\n${shown.join(',\n')}\n${pad}]`;
  }
  return `{\n${Object.keys(value).map((k) => `${pad}  ${JSON.stringify(k)}: ${prettyJson(value[k], { depth, str, arr, inline }, level + 1)}`).join(',\n')}\n${pad}}`;
}

// What the page shows of a message. tools/list lists the tool names; a tool result carries its content twice (as
// structuredContent and again as text), so the text copy is left out. Nothing else is touched.
export function displayMsg(msg) {
  const out = { ...msg };
  if (Array.isArray(msg.result?.tools)) out.result = { ...msg.result, tools: msg.result.tools.map((t) => t.name) };
  else if (msg.result?.structuredContent && Array.isArray(msg.result.content)) out.result = Object.fromEntries(Object.entries(msg.result).filter(([key]) => key !== 'content'));
  return out;
}

// One coloured line: keys, strings, numbers and literals get a class; everything is escaped.
export function jsonHtml(text) {
  const token = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(token)) {
    out += esc(text.slice(last, m.index));
    if (m[1] && m[2]) out += `<span class="t-key">${esc(m[1])}</span>${esc(m[2])}`;
    else if (m[1]) out += `<span class="t-str">${esc(m[1])}</span>`;
    else if (m[3]) out += `<span class="t-lit">${esc(m[3])}</span>`;
    else out += `<span class="t-num">${esc(m[4])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// The whole transcript as a flat list of terminal lines: { kind: 'cmd' | 'note' | 'out' | 'in' | 'cont' | 'end', html, text, ind }.
// 'out' and 'in' mark the first line of a message sent by the client or the server; 'cont' its other lines. `ind` is how far the
// line is indented, so a line that wraps on a narrow screen continues under its own indentation (hanging indent) and not at the margin.
export function transcriptLines(transcript) {
  const lines = [];
  const add = (kind, text, html, ind = 0) => lines.push({ kind, text, html: html ?? esc(text), ind });
  add('cmd', `$ ${transcript.server?.command || 'node mcp/server.js'}`, `<span class="t-prompt">$</span> ${esc(transcript.server?.command || 'node mcp/server.js')}`);
  let n = 0;
  transcript.steps.forEach((step, i) => {
    add('note', `# ${i + 1} · ${step.label}`);
    for (const { dir, msg } of step.lines) {
      n++;
      const rows = prettyJson(displayMsg(msg), Array.isArray(msg.result?.tools) ? { arr: 4 } : {}).split('\n'); // the tool list shows four names and how many more
      rows.forEach((row, j) => {
        const arrow = j === 0 ? (dir === 'out' ? '→ ' : '← ') : '  ';
        const html = `${j === 0 ? `<span class="t-arrow t-arrow-${dir}">${dir === 'out' ? '→' : '←'}</span> ` : '  '}${jsonHtml(row)}`;
        add(j === 0 ? (dir === 'out' ? 'out' : 'in') : 'cont', arrow + row, html, 2 + (j === 0 ? 0 : row.length - row.trimStart().length));
      });
    }
  });
  add('end', `# ${n} JSON-RPC messages, ${transcript.steps.length} steps. The invoice, the PayPal link and the hash all came from the server.`);
  return lines;
}

// Plays the lines into `box`, one after the other: a pause before each note and message, a short one between the lines
// of a message. With reduced motion (or ms = 0) everything appears at once. Returns { stop(), done }.
export function playTranscript(box, lines, { reduced = false, pauses = { note: 320, msg: 300, line: 24 } } = {}) {
  let stopped = false;
  const html = (l) => `<div class="term-line term-${l.kind}" style="--ind:${Number(l.ind) || 0}">${l.html || ' '}</div>`;
  box.replaceChildren();
  if (reduced) {
    box.innerHTML = lines.map(html).join('');
    box.scrollTop = 0;
    return { stop() {}, done: Promise.resolve() };
  }
  const done = (async () => {
    for (const l of lines) {
      if (stopped) return;
      const wait = l.kind === 'note' || l.kind === 'end' ? pauses.note : l.kind === 'out' || l.kind === 'in' ? pauses.msg : pauses.line;
      await new Promise((r) => setTimeout(r, wait));
      if (stopped) return;
      box.insertAdjacentHTML('beforeend', html(l));
      box.scrollTop = box.scrollHeight;
    }
  })();
  return { stop() { stopped = true; }, done };
}
