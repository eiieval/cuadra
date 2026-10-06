// "Engine checks": what the browser's own engine verified about an invoice proposal, shown under the proposal.
// Every line is computed here from the proposal and the ledger, never written by the model.
import { totals, validNif } from './verifactu.js';
import { addDays } from './ledger.js';
import { dec, eur, esc, fmtDate } from './fmt.js';

const RATE_NAME = { 21: 'general rate', 10: 'reduced rate', 4: 'super-reduced rate', 0: 'exempt' };
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// A proposal client is "known" when its NIF is on file, or else when its name is (case and spacing aside).
export function matchClient(known, recipient) {
  const list = Array.isArray(known) ? known : [];
  const nif = String(recipient?.nif || '');
  const byNif = nif ? list.find((c) => c.nif && c.nif === nif) : null;
  if (byNif) return { client: byNif, by: 'nif' };
  const byName = list.find((c) => norm(c.name) && norm(c.name) === norm(recipient?.name));
  return byName ? { client: byName, by: 'name' } : null;
}

// inv: a normalized proposal { recipient: { name, nif, email }, lines: [{ qty, price, vat }], dueDays }.
// known: clients(records) from the ledger. Returns [{ key, level: 'ok'|'warn'|'bad'|'info', text }].
export function engineChecks(inv, { known = [], today }) {
  const out = [];
  const r = inv.recipient;
  const hit = matchClient(known, r);
  if (hit && hit.by === 'nif' && norm(hit.client.name) !== norm(r.name)) {
    out.push({ key: 'client', level: 'warn', text: `That NIF belongs to ${hit.client.name} in your ledger, but the proposal is addressed to ${r.name}` });
  } else if (hit && hit.by === 'name' && r.nif && hit.client.nif && r.nif !== hit.client.nif) {
    out.push({ key: 'client', level: 'warn', text: `The name matches ${hit.client.name} in your ledger, but the NIF on file there is ${hit.client.nif}` });
  } else if (hit) {
    out.push({ key: 'client', level: 'ok', text: `Client matched from ledger: ${hit.client.name}${hit.client.nif ? ` · NIF ${hit.client.nif}` : ''} · ${hit.client.email || 'no email on file'}` });
  } else {
    out.push({ key: 'client', level: 'info', text: 'New client: not in your ledger yet' });
  }

  if (!r.nif) out.push({ key: 'nif', level: 'warn', text: 'No NIF: valid for a simplified invoice only' });
  else if (validNif(r.nif)) out.push({ key: 'nif', level: 'ok', text: 'NIF checksum valid' });
  else out.push({ key: 'nif', level: 'bad', text: `NIF looks invalid (${r.nif}): check it before issuing` });

  const rates = [...new Set(inv.lines.map((l) => Number(l.vat)))].sort((a, b) => b - a);
  out.push({ key: 'vat', level: 'ok', text: `VAT ${rates.map((x) => `${x} % (${RATE_NAME[x] || 'special rate'})`).join(' and ')}` });

  const t = totals(inv.lines);
  const base = t.breakdown.reduce((s, b) => s + Number(b.base), 0);
  out.push({ key: 'totals', level: 'ok', text: `Totals computed by the engine: ${dec(base)} + ${dec(t.taxTotal)} = ${eur(t.total)}` });

  const days = Number(inv.dueDays) || 0;
  out.push({ key: 'due', level: 'ok', text: days ? `Due in ${days} day${days === 1 ? '' : 's'} (${fmtDate(addDays(today, days))})` : `Due on receipt (${fmtDate(today)})` });

  // create_and_send runs cleanInvoice() on the server: it recomputes the totals and re-checks NIF, VAT and email.
  out.push({ key: 'server', level: 'info', text: 'Server re-validates the invoice before PayPal receives it' });
  return out;
}

const MARK = {
  ok: '<svg viewBox="0 0 16 16" class="check-mark text-ok" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
  warn: '<svg viewBox="0 0 16 16" class="check-mark text-warn" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v5.5M8 12v.01"/></svg>',
  bad: '<svg viewBox="0 0 16 16" class="check-mark text-bad" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  info: '<svg viewBox="0 0 16 16" class="check-mark text-soft" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 7.5V12M8 4.5v.01"/></svg>',
};
const WORD = { ok: 'Passed', warn: 'Warning', bad: 'Problem', info: 'Note' };

export function checksHtml(list) {
  return `<section class="checks" aria-label="Engine checks">
    <div class="checks-head"><span class="label">Engine checks</span><span class="text-[11px] text-soft">computed in your browser, not by the AI</span></div>
    <ul>${list.map((c) => `<li class="check check-${c.level}">${MARK[c.level]}<span class="sr-only">${WORD[c.level]}: </span><span>${esc(c.text)}</span></li>`).join('')}</ul>
  </section>`;
}
