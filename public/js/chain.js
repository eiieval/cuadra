// The live chain: one block per VeriFactu record (invoice or cancellation), linked to the previous one.
// chainBlocks() is a pure function over the records and the verdict of verifyChain(); chainTrackHtml() draws it.
// Nothing here verifies anything: the verdict comes from verifyChain() and the blocks only show it.
import { isAnulacion, isRectificativa } from './verifactu.js';
import { esc, eur } from './fmt.js';

export const MAX_BLOCKS = 40;

// What each verifyChain() reason means for the person looking at the block.
const TIPS = {
  'record altered after issue': 'stored hash ≠ recomputed hash',
  'broken link to the previous record': 'stored link ≠ hash of the previous record',
  'amounts do not match the invoice lines': 'stored total ≠ total of the invoice lines',
};

// records: the ledger array. verify: { ok, count } or { ok: false, index, reason } from verifyChain(), or null while
// it runs (every block is then 'pending': a block is never shown as verified without a verdict).
// opts.newFrom: records at or after this index are flagged isNew (they just entered the chain).
// With more than `max` records the oldest collapse into one "+N earlier" block, so the strip never exceeds `max` items.
export function chainBlocks(records, verify, { newFrom = Infinity, max = MAX_BLOCKS } = {}) {
  const n = records.length;
  const known = Boolean(verify);
  const bad = known && verify.ok === false ? verify.index : -1;
  const stateAt = (i) => (!known ? 'pending' : bad < 0 || i < bad ? 'verified' : i === bad ? 'broken' : 'unverifiable');
  const brokenNumber = bad >= 0 ? records[bad]?.number : '';
  const hidden = n > max ? n - (max - 1) : 0;
  const linkBroken = known && verify.reason === 'broken link to the previous record';
  const out = [];
  if (hidden) {
    const state = !known ? 'pending' : bad >= 0 && bad < hidden ? 'broken' : 'verified';
    out.push({ kind: 'collapsed', count: hidden, state, linkIn: null, tip: `${hidden} earlier records${state === 'broken' ? `: the chain breaks at ${brokenNumber}` : ' (all verified)'}` });
  }
  for (let i = hidden; i < n; i++) {
    const r = records[i];
    const state = stateAt(i);
    const prev = out.at(-1);
    let linkIn = null;
    if (prev) {
      if (!known) linkIn = 'pending';
      else if (prev.state === 'verified' && state === 'verified') linkIn = 'verified';
      else if (prev.state === 'verified' && state === 'broken') linkIn = linkBroken ? 'broken' : 'verified';
      else if (prev.state === 'broken') linkIn = 'broken';
      else linkIn = 'unverifiable';
    }
    const hash = String(r.hash || '');
    const base = { kind: isAnulacion(r) ? 'anulacion' : isRectificativa(r) ? 'rectificativa' : 'alta', index: i, number: String(r.number || ''), state, linkIn, hash, hash6: hash.slice(0, 6), isNew: i >= newFrom };
    out.push(isAnulacion(r)
      ? { ...base, amount: null, cancels: base.number, tip: '' }
      : { ...base, amount: String(r.total ?? ''), cancels: null, rectifies: isRectificativa(r) ? String(r.rectifies.number) : null, tip: '' });
    out.at(-1).tip = state === 'broken' ? TIPS[verify.reason] || verify.reason
      : state === 'unverifiable' ? `Not verifiable: the chain is broken at ${brokenNumber}`
        : state === 'pending' ? 'Verifying…'
          : `${base.number}${out.at(-1).rectifies ? ` · R1 · rectifies ${out.at(-1).rectifies}` : ''} · SHA-256 ${base.hash6}… · verified`;
  }
  return out;
}

// Header line above the strip, from the same verdict.
export function chainStatus(records, verify) {
  if (!records.length) return { tone: 'idle', headline: 'Empty chain', detail: 'your first record will start it' };
  if (!verify) return { tone: 'warn', headline: 'Verifying chain…', detail: '' };
  if (verify.ok) return { tone: 'ok', headline: 'Chain verified', detail: `${verify.count} record${verify.count === 1 ? '' : 's'} · SHA-256 linked` };
  return { tone: 'bad', headline: `Chain broken at ${records[verify.index]?.number ?? '?'}`, detail: verify.reason };
}

export const statusHtml = (s) => {
  const tone = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', idle: 'text-soft' }[s.tone] || 'text-soft';
  return `<span class="${tone}">● ${esc(s.headline)}</span>${s.detail ? ` <span class="text-soft">· ${esc(s.detail)}</span>` : ''}`;
};

const SVG = (inner, cls = 'block-ic') => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  alta: SVG('<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75"/><rect x="5.5" y="5.5" width="5" height="5" rx="1.25" fill="currentColor" stroke="none"/>'),
  rectificativa: SVG('<path d="M13 5.5A5 5 0 0 0 4.2 4.2L3 5.5"/><path d="M3 2.5v3h3"/><path d="M3 10.5a5 5 0 0 0 8.8 1.3L13 10.5"/><path d="M13 13.5v-3h-3"/>'),
  anulacion: SVG('<path d="M4 2.5v5.5a2.5 2.5 0 0 0 2.5 2.5H12"/><path d="M9.7 8l2.6 2.5-2.6 2.5"/>'),
  broken: SVG('<path d="M6.3 9.7 4.9 11.1a2.3 2.3 0 0 1-3.3-3.3l1.6-1.6"/><path d="M9.7 6.3l1.4-1.4a2.3 2.3 0 0 1 3.3 3.3l-1.6 1.6"/><path d="M6.6 3.4 6.1 1.8M3.4 6.6 1.8 6.1M9.4 12.6l.5 1.6M12.6 9.4l1.6.5"/>'),
};
const MARK = {
  verified: SVG('<path d="M3.5 8.5l3 3 6-6.5"/>', 'block-mark'),
  broken: SVG('<path d="M4 4l8 8M12 4l-8 8"/>', 'block-mark'),
  unverifiable: SVG('<path d="M4 8h8"/>', 'block-mark'),
  pending: SVG('<circle cx="8" cy="8" r="2.5"/>', 'block-mark'),
};
const LINK = {
  verified: '<svg class="chain-link-svg" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1.5" y="3.5" width="14" height="7" rx="3.5"/><rect x="10.5" y="3.5" width="14" height="7" rx="3.5"/></svg>',
  unverifiable: '<svg class="chain-link-svg" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"><rect x="1.5" y="3.5" width="14" height="7" rx="3.5"/><rect x="10.5" y="3.5" width="14" height="7" rx="3.5"/></svg>',
  broken: '<svg class="chain-link-svg" viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="1.5" y="3.5" width="9.5" height="7" rx="3.5"/><rect x="15" y="3.5" width="9.5" height="7" rx="3.5" stroke-dasharray="2.5 2"/><path d="M12.4 1.5l1.2 2.2M13.6 10.3l-1.2 2.2"/></svg>',
};
LINK.pending = LINK.verified;

const WORD = { verified: 'verified', broken: 'altered, hash mismatch', unverifiable: 'not verifiable', pending: 'verifying' };

function blockHtml(b) {
  const link = b.linkIn ? `<span class="chain-link ${b.linkIn}" aria-hidden="true">${LINK[b.linkIn]}</span>` : '';
  if (b.kind === 'collapsed') {
    return `<li class="chain-item">${link}<div class="chain-block block-collapsed ${b.state}" title="${esc(b.tip)}"><span class="num text-sm font-semibold">+${b.count}</span><span class="text-[11px] text-soft">earlier</span></div></li>`;
  }
  const icon = b.state === 'broken' ? ICONS.broken : ICONS[b.kind];
  const head = b.kind === 'anulacion' ? '<span class="font-semibold">Cancels</span>' : `<span class="num font-semibold">${esc(b.number)}</span>`;
  const body = b.kind === 'anulacion' ? `<span class="num block-amt text-soft">${esc(b.cancels)}</span>`
    : b.kind === 'rectificativa' ? `<span class="num block-amt"><span class="text-soft">R1 ·</span> ${esc(eur(b.amount))}</span>`
      : `<span class="num block-amt">${esc(eur(b.amount))}</span>`;
  const label = b.kind === 'anulacion' ? `Cancels ${b.cancels}, cancellation record`
    : b.kind === 'rectificativa' ? `${b.number}, R1 corrective invoice, rectifies ${b.rectifies}, ${eur(b.amount)}` : `${b.number}, invoice, ${eur(b.amount)}`;
  const rect = b.kind === 'rectificativa' ? `<span class="num text-[11px] text-soft block-rect" aria-hidden="true">← ${esc(b.rectifies)}</span>` : '';
  return `<li class="chain-item">${link}<button type="button" class="chain-block ${b.kind} ${b.state}${b.isNew ? ' is-new' : ''}" data-i="${b.index}" title="${esc(b.tip)}" aria-label="${esc(`${label}, hash ${b.hash6}, ${WORD[b.state]}. Open details.`)}">
    <span class="block-top">${icon}${head}</span>${body}${rect}
    <span class="block-foot"><span class="num text-soft">${esc(b.hash6)}</span>${MARK[b.state]}</span>
  </button></li>`;
}

// Empty ledger: a ghost block instead of an empty strip.
const GHOST = '<li class="chain-item"><div class="chain-block block-ghost"><span class="text-[11px] font-semibold">Your first record will appear here</span><span class="text-[11px] text-soft">invoice or cancellation</span></div></li>';

export const chainTrackHtml = (blocks) => (blocks.length ? blocks.map(blockHtml).join('') : GHOST);
