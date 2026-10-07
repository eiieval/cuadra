// Plans: when one reply of the agent carries two or more actions they are grouped into a checklist.
// Each step is approved on its own. Only the low-risk ones (reminders and collections) can be approved together;
// invoices, payments and cancellations always need their own click. Pure helpers, no DOM.
//
// A step is { type, done, ok, skipped, busy, dead }: done is the outcome text once it ran, ok whether it worked,
// skipped whether the user dismissed it, dead whether the ledger no longer allows it (nothing left to approve).

export const LOW_RISK = ['propose_reminder', 'propose_collect'];
export const isPlan = (actions) => Array.isArray(actions) && actions.length >= 2;

const dismissed = (a) => Boolean(a.skipped) || a.done === 'Dismissed.';
const resolved = (a) => Boolean(a.done) || Boolean(a.dead);

export function planProgress(steps) {
  const done = steps.filter(resolved).length;
  return { total: steps.length, done, complete: steps.length > 0 && done === steps.length };
}

// The steps "Approve all" runs: low-risk, still open, not running.
export const pendingLowRisk = (steps) => steps.map((a, ai) => ({ a, ai })).filter(({ a }) => LOW_RISK.includes(a.type) && !resolved(a) && !a.busy);
// Invoices, payments and cancellations are never batch-approved. A VAT draft and an insight change nothing in the ledger.
export const hasHighRisk = (steps) => steps.some((a) => !LOW_RISK.includes(a.type) && a.type !== 'show_vat_return' && a.type !== 'propose_widget' && a.type !== 'propose_view');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One line for the end of the plan: what was actually done, counted from the outcomes the handlers reported.
export function planSummary(steps) {
  const worked = (type) => steps.filter((a) => a.type === type && a.done && a.ok !== false && !dismissed(a)).length;
  const parts = [];
  const add = (n, text) => { if (n) parts.push(text(n)); };
  add(worked('propose_invoice'), (n) => `${plural(n, 'invoice')} issued`);
  add(worked('propose_reminder'), (n) => `${plural(n, 'reminder')} sent`);
  add(worked('propose_collect'), (n) => `${plural(n, 'invoice')} sent with PayPal`);
  add(worked('propose_mark_paid'), (n) => `${plural(n, 'payment')} recorded`);
  add(worked('propose_cancel'), (n) => `${plural(n, 'invoice')} cancelled`);
  if (worked('show_vat_return')) parts.push('VAT draft reviewed');
  add(worked('propose_widget'), (n) => `${plural(n, 'insight')} pinned`);
  if (worked('propose_view')) parts.push('view applied');
  add(steps.filter((a) => a.done && a.ok === false && !dismissed(a)).length, (n) => `${n} not done`);
  add(steps.filter((a) => !a.done && a.dead).length, (n) => `${n} no longer needed`);
  add(steps.filter(dismissed).length, (n) => `${n} dismissed`);
  return parts.join(' · ') || 'Nothing was changed';
}
