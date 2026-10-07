// What the verification page says about a record. A matching hash proves the copy is unaltered, not who issued it:
// the words say exactly that, next to the verdict, not in a folded section. Pure, escaped, shared with the tests.
import { esc } from './fmt.js';
import { attestWords } from './attest.js';

export const CONSISTENT = 'Consistent copy: the content matches its hash';
export const NOT_THE_ISSUER = 'This proves this copy was not altered, not who issued it. Scan the AEAT QR to check the issuer.';

// v: the result of verifyRecord(). Returns { state: 'ok'|'bad', html } for the #verdict element.
export function verdictHtml(v) {
  if (!v.ok) return { state: 'bad', html: `<span class="verdict-mark" aria-hidden="true">✗</span> <div>Altered: ${esc(v.reason)}</div>` };
  return {
    state: 'ok',
    html: `<span class="verdict-mark" aria-hidden="true">✓</span> <div><div>${esc(CONSISTENT)} <span class="num">${esc(v.hash.slice(0, 8))}…</span></div><div class="mt-1 text-xs font-normal text-soft">${esc(NOT_THE_ISSUER)}</div></div>`,
  };
}

// The signature line under the verdict. result: checkAttestation(). A signature vouches that the Cuadra deployment saw this
// hash when it was issued; it does not say who the issuer is, which is why the AEAT sentence above stays.
const SHIELD = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 13 3.6v3.9c0 3.1-2 5.2-5 6.7-3-1.5-5-3.6-5-6.7V3.6z"/><path d="M5.6 8.1l1.8 1.8 3-3.3"/></svg>';
export function attestHtml(result) {
  const w = attestWords(result);
  const mark = result.state === 'signed' ? SHIELD : result.state === 'invalid' ? '✗' : '–';
  return { state: w.tone === 'ok' ? 'ok' : w.tone === 'bad' ? 'bad' : 'info', html: `<span class="verdict-mark" aria-hidden="true">${mark}</span> <div>${esc(w.text)}</div>` };
}
