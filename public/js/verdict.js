// What the verification page says about a record. A matching hash proves the copy is unaltered, not who issued it:
// the words say exactly that, next to the verdict, not in a folded section. Pure, escaped, shared with the tests.
import { esc } from './fmt.js';

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
