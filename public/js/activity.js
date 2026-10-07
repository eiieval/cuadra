// Activity: an append-only log of who did what in the ledger. It is the governance trail of the demo: the agent
// proposes, the user approves, the engine issues, PayPal delivers, and every step leaves a line here.
// reduceActivity() is the only writer and it never edits or removes an entry; it only appends and trims the oldest.
import { esc } from './fmt.js';

export const MAX_ACTIVITY = 500;
export const ACTORS = ['you', 'agent', 'paypal', 'system'];
export const EVENTS = {
  proposal: 'Proposal shown',
  approved: 'Approved',
  dismissed: 'Dismissed',
  issued: 'Issued',
  sent: 'Sent with PayPal',
  paypal_error: 'PayPal error',
  reminder: 'Reminder sent',
  payment: 'Payment recorded',
  cancelled: 'Cancelled',
  rectified: 'Corrective invoice issued',
  attested: 'Signed by this deployment',
  view_applied: 'View applied',
  view_reset: 'View reset',
  sync: 'PayPal status changed',
  tamper_on: 'Tamper test on',
  tamper_off: 'Tamper test off',
  sample: 'Sample loaded',
  company: 'Company added',
  reset: 'Ledger reset',
  widget_pinned: 'Widget pinned',
  widget_removed: 'Widget removed',
};

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// list: the current log. entry: { actor, event, number?, detail?, at? }. Returns a NEW array, the last MAX_ACTIVITY entries.
export function reduceActivity(list, entry, now = Date.now()) {
  const prev = Array.isArray(list) ? list : [];
  const at = Number.isFinite(Date.parse(entry?.at)) ? new Date(entry.at).toISOString() : new Date(now).toISOString();
  const next = {
    at,
    actor: ACTORS.includes(entry?.actor) ? entry.actor : 'system',
    event: text(entry?.event, 40) || 'unknown',
    ...(entry?.number ? { number: text(entry.number, 40) } : {}),
    detail: text(entry?.detail, 200),
  };
  return [...prev, next].slice(-MAX_ACTIVITY);
}

// "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", then the date.
export function relTime(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

// The newest `limit` entries, newest first, ready to draw.
export function activityRows(list, limit = 20, now = Date.now()) {
  return (Array.isArray(list) ? list : []).slice(-limit).reverse().map((e) => ({ ...e, label: EVENTS[e.event] || e.event, when: relTime(e.at, now) }));
}

const ICON = {
  you: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.2 13.2c.5-2.6 2.4-4 4.8-4s4.3 1.4 4.8 4"/>',
  agent: '<path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4z"/>',
  paypal: '<path d="M2.5 8h9M8.5 4.5L12 8l-3.5 3.5"/>',
  system: '<path d="M8 2.2l4.8 1.8v3.6c0 3-2 5-4.8 6.2-2.8-1.2-4.8-3.2-4.8-6.2V4z"/><path d="M5.8 8.2l1.5 1.5 3-3.2"/>',
};
const WHO = { you: 'You', agent: 'Agent', paypal: 'PayPal', system: 'Engine' };

export function activityHtml(rows) {
  if (!rows.length) return '<li class="activity-empty">Nothing yet. Every proposal, approval, issue and payment will be listed here.</li>';
  return rows.map((e) => `<li class="activity-row activity-${e.actor}">
    <span class="activity-ic" title="${WHO[e.actor]}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[e.actor]}</svg><span class="sr-only">${WHO[e.actor]}: </span></span>
    <span class="min-w-0 flex-1"><span class="font-medium">${esc(e.label)}</span>${e.number ? ` <span class="num text-xs">${esc(e.number)}</span>` : ''}${e.detail ? `<span class="activity-detail"> · ${esc(e.detail)}</span>` : ''}</span>
    <time class="activity-when" datetime="${esc(e.at)}">${esc(e.when)}</time>
  </li>`).join('');
}
