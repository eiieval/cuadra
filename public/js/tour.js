// First-visit tour: one caption card at the bottom (never over the page controls it talks about), four steps of about
// five seconds each, skippable, closable with Escape, no libraries. The progress bar is a CSS animation and the step
// advances on its animationend, so hovering or focusing the card pauses it, and with prefers-reduced-motion (no
// animation) it simply waits for the Next button.
const KEY = 'cuadra-tour-v1';
const $ = (s) => document.querySelector(s);

export const tourSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked: the tour may show again */ } };

// steps: [{ title, text, target: () => element(s), block?, enter?, leave? }]. enter/leave may be async and are
// always paired, so a step that changes the page (the tamper test) also undoes it, whatever way the tour ends.
export function startTour(steps, { onEnd, focus = false, ms = 5000 } = {}) {
  const box = $('#tour');
  if (!box || !steps.length) return null;
  let i = 0;
  let lit = [];
  let alive = true;
  let entered = false;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const unlight = () => { lit.forEach((el) => el.classList.remove('tour-hl')); lit = []; };
  const leave = async () => {
    if (!entered) return;
    entered = false;
    try { await steps[i].leave?.(); } catch { /* a tour step must never break the page */ }
  };
  const finish = async () => {
    if (!alive) return;
    alive = false;
    await leave();
    unlight();
    box.hidden = true;
    document.body.classList.remove('touring');
    document.removeEventListener('keydown', onKey);
    markSeen();
    onEnd?.();
  };
  let moving = false;
  const advance = async () => {
    if (!alive || moving) return;
    moving = true;
    try {
      if (i === steps.length - 1) return await finish();
      await leave();
      i++;
      await show();
    } finally {
      moving = false;
    }
  };
  const show = async () => {
    const s = steps[i];
    unlight();
    try { await s.enter?.(); } catch { /* ignore */ }
    if (!alive) { // closed while the step was starting: undo what it did
      try { await s.leave?.(); } catch { /* ignore */ }
      return;
    }
    entered = true;
    lit = [].concat(s.target?.() ?? []).filter(Boolean);
    lit.forEach((el) => el.classList.add('tour-hl'));
    lit[0]?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: s.block || 'nearest' });
    const last = i === steps.length - 1;
    box.style.setProperty('--tour-ms', `${ms}ms`);
    box.innerHTML = `<div class="tour-k">Step ${i + 1} of ${steps.length}</div><div class="tour-t"></div><p class="tour-p"></p><div class="tour-actions"><button type="button" class="btn-primary tour-next"></button>${last ? '' : '<button type="button" class="btn-ghost tour-skip">Skip tour</button>'}</div><div class="tour-bar" aria-hidden="true"><i></i></div>`;
    box.querySelector('.tour-t').textContent = s.title;
    box.querySelector('.tour-p').textContent = s.text || '';
    const next = box.querySelector('.tour-next');
    next.textContent = last ? 'Start using Cuadra' : 'Next';
    next.onclick = advance;
    const skip = box.querySelector('.tour-skip');
    if (skip) skip.onclick = finish;
    box.querySelector('.tour-bar > i').addEventListener('animationend', advance, { once: true });
    if (focus && i === 0) next.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') finish(); };
  document.addEventListener('keydown', onKey);
  box.hidden = false;
  document.body.classList.add('touring');
  show();
  return { stop: finish };
}
