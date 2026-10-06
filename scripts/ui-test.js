// Offline tests for the client-side modules and the design system: no browser, no keys, no network.
import { readFileSync, readdirSync } from 'node:fs';
import { buildAlta, buildAnulacion, verifyChain } from '../public/js/verifactu.js';
import { buildSample } from '../public/js/ledger.js';
import { chainBlocks, chainStatus, chainTrackHtml, MAX_BLOCKS } from '../public/js/chain.js';
import { engineChecks, checksHtml, matchClient } from '../public/js/checks.js';
import { isPlan, planProgress, pendingLowRisk, hasHighRisk, planSummary, LOW_RISK } from '../public/js/plan.js';
import { proposalPaperHtml } from '../public/js/proposal.js';
import { reduceActivity, activityRows, activityHtml, relTime, MAX_ACTIVITY, EVENTS } from '../public/js/activity.js';

let failed = 0;
const expect = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// 1. Design system (A1): tokens, named colors, contrast, no loose hex colors in client code
const css = read('styles/input.css');
const root = Object.fromEntries([...css.match(/:root\s*\{([^}]*)\}/)[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2].toLowerCase()]));
const config = (await import('node:module')).createRequire(import.meta.url)('../tailwind.config.cjs').theme.extend.colors;
const named = { ink: config.ink, surface: config.surface.DEFAULT, 'surface-2': config.surface['2'], text: config.fg, soft: config.soft, ok: config.ok, warn: config.warn, bad: config.bad, link: config.link, paper: config.paper.DEFAULT, 'paper-ink': config.paper.ink, 'paper-soft': config.paper.soft };
expect('the spec palette is defined as :root tokens', root.ink === '#0a0d14' && root.surface === '#10141f' && root['surface-2'] === '#161b29' && root.text === '#e8ecf4' && root.soft === '#94a3b8' && root.ok === '#34d399' && root.warn === '#fbbf24' && root.bad === '#fb7185' && root.link === '#a5b4fc');
expect('tailwind.config.cjs named colors match the :root tokens', Object.entries(named).every(([k, v]) => v?.toLowerCase() === root[k]));

const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const mix = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
const surfaces = [root.ink, root.surface, root['surface-2']];
const texts = ['text', 'soft', 'ok', 'warn', 'bad', 'link'];
expect('every text token reaches AA (4.5:1) on the three surfaces, so 11px text is legible', texts.every((t) => surfaces.every((s) => contrast(root[t], s) >= 4.5)));
expect('status badges (14% tint) and the printed paper reach AA too', ['ok', 'warn', 'bad'].every((t) => contrast(root[t], mix(root[t], root.surface, 0.14)) >= 4.5) && contrast(root['paper-ink'], root.paper) >= 4.5 && contrast(root['paper-soft'], root.paper) >= 4.5);

const clientFiles = ['public/app.js', ...(readdirSync(new URL('../public', import.meta.url)).includes('verify.js') ? ['public/verify.js'] : []), ...readdirSync(new URL('../public/js', import.meta.url)).map((f) => `public/js/${f}`)];
const loose = clientFiles.flatMap((f) => [...read(f).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => `${f}: ${m[0]}`));
expect(`no loose hex colors in client code (${clientFiles.length} files)`, loose.length === 0);
expect('Instrument Serif appears only in the .brand-line rule', (css.match(/Instrument Serif/g) || []).length === 1 && /\.brand-line\s*\{[^}]*Instrument Serif/.test(css));
expect('reduced motion switches animations off', /prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none !important/s.test(css));

// 2. The live chain (A2): chainBlocks states for a healthy chain, a chain broken at i, and one with a cancellation
const issuer = { name: 'Estudio Norte SL', nif: 'B76543214', series: 'UI' };
const sample = await buildSample({ issuer, today: '2026-10-06' });
const okVerdict = await verifyChain(sample);
const healthy = chainBlocks(sample, okVerdict);
expect('a healthy chain has one verified block per record', healthy.length === sample.length && healthy.every((b) => b.state === 'verified'));
expect('blocks carry number, amount and the first 6 hex of the hash', healthy[0].kind === 'alta' && healthy[0].number === sample[0].number && healthy[0].amount === sample[0].total && healthy[0].hash6 === sample[0].hash.slice(0, 6) && /^[0-9A-F]{6}$/.test(healthy[0].hash6));
const anul = healthy.find((b) => b.kind === 'anulacion');
expect('a cancellation is its own block that names the invoice it cancels', healthy.filter((b) => b.kind === 'anulacion').length === 1 && anul.cancels === sample.find((r) => r.kind === 'anulacion').number && anul.amount === null);
expect('every block is linked to the previous one, the first has no link', healthy[0].linkIn === null && healthy.slice(1).every((b) => b.linkIn === 'verified'));

const forged = structuredClone(sample);
forged[5].total = '826.00';
const brokenVerdict = await verifyChain(forged);
const split = chainBlocks(forged, brokenVerdict);
expect('altering record i breaks block i and nothing before it', brokenVerdict.index === 5 && split.slice(0, 5).every((b) => b.state === 'verified') && split[5].state === 'broken');
expect('every block after the broken one is unverifiable (grey), not verified', split.slice(6).length === 2 && split.slice(6).every((b) => b.state === 'unverifiable'));
expect('the broken block explains itself: stored hash ≠ recomputed hash', split[5].tip === 'stored hash ≠ recomputed hash' && split[6].tip.includes(forged[5].number));
expect('the link into the broken block holds, the one leaving it is snapped, later ones are unverifiable', split[5].linkIn === 'verified' && split[6].linkIn === 'broken' && split[7].linkIn === 'unverifiable');
const stBad = chainStatus(forged, brokenVerdict);
expect('the header names the broken record and the reason', stBad.tone === 'bad' && stBad.headline === `Chain broken at ${forged[5].number}` && stBad.detail === 'record altered after issue');
const stOk = chainStatus(sample, okVerdict);
expect('the header of a healthy chain counts the records', stOk.tone === 'ok' && stOk.headline === 'Chain verified' && stOk.detail === '8 records · SHA-256 linked' && chainStatus([], { ok: true, count: 0 }).tone === 'idle');
expect('without a verdict no block is ever shown as verified', chainBlocks(sample, null).every((b) => b.state === 'pending') && chainStatus(sample, null).tone === 'warn');
expect('records that just entered the chain are flagged new', chainBlocks(sample, okVerdict, { newFrom: 7 }).filter((b) => b.isNew).map((b) => b.index).join() === '7');

const long = [];
for (let i = 1; i <= 45; i++) long.push(await buildAlta({ issuer, invoice: { number: `L-${String(i).padStart(4, '0')}`, date: '2026-10-06', recipient: { name: 'Acme', nif: 'B12345674' }, lines: [{ description: 'Work', qty: 1, price: 10 + i, vat: 21 }] }, prev: long.at(-1) || null, generatedAt: '2026-10-06T10:00:00+02:00' }));
const collapsed = chainBlocks(long, await verifyChain(long));
expect(`with more than ${MAX_BLOCKS} records the oldest collapse into one "+N earlier" block`, collapsed.length === MAX_BLOCKS && collapsed[0].kind === 'collapsed' && collapsed[0].count === 45 - (MAX_BLOCKS - 1) && collapsed[1].index === 6 && collapsed.at(-1).index === 44 && chainBlocks(long.slice(0, 40), await verifyChain(long.slice(0, 40))).every((b) => b.kind === 'alta'));
const longForged = structuredClone(long);
longForged[2].total = '1.00';
const hiddenBreak = chainBlocks(longForged, await verifyChain(longForged));
expect('a break inside the collapsed block is shown on it, and the visible blocks become unverifiable', hiddenBreak[0].state === 'broken' && hiddenBreak.slice(1).every((b) => b.state === 'unverifiable'));
const html = chainTrackHtml(chainBlocks([{ ...sample[0], number: '<img src=x onerror=alert(1)>' }], { ok: true, count: 1 }));
expect('the strip escapes record text and shows a ghost block when empty', !html.includes('<img') && chainTrackHtml([]).includes('Your first record will appear here'));

// 3. The agent as a colleague (A3): engine checks, plan logic and the proposal paper
const flat = (t) => t.replace(/ /g, ' ');
const known = [{ name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, { name: 'Lumen Foods SL', nif: 'B87654323', email: '' }];
const proposal = { recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }], dueDays: 15 };
const checksFor = (patch = {}, k = known) => Object.fromEntries(engineChecks({ ...proposal, ...patch }, { known: k, today: '2026-10-06' }).map((c) => [c.key, c]));
const ck = checksFor();
expect('checks: a client already in the ledger is matched with its NIF and email', ck.client.level === 'ok' && ck.client.text === 'Client matched from ledger: Acme Studio SL · NIF B12345674 · billing@acme.example');
expect('checks: an unknown client is "New client"', checksFor({ recipient: { name: 'Globex SL', nif: '', email: '' } }).client.text.startsWith('New client'));
expect('checks: a known name with a different NIF, or the NIF of another client, is a warning and never a silent match', checksFor({ recipient: { name: 'acme  studio sl', nif: 'B76543214', email: '' } }).client.level === 'warn' && checksFor({ recipient: { name: 'Acme Studio SL', nif: 'B87654323', email: '' } }).client.level === 'warn' && /belongs to Lumen Foods SL/.test(checksFor({ recipient: { name: 'Acme Studio SL', nif: 'B87654323', email: '' } }).client.text) && matchClient(known, { name: 'Lumen Foods SL', nif: '' }).by === 'name' && matchClient(known, { name: 'x', nif: 'B12345674' }).by === 'nif');
const badNif = checksFor({ recipient: { ...proposal.recipient, nif: 'B12345675' } }).nif;
expect('checks: NIF checksum valid, invalid and missing', ck.nif.text === 'NIF checksum valid' && badNif.level === 'bad' && /NIF looks invalid/.test(badNif.text) && checksFor({ recipient: { name: 'X', nif: '', email: '' } }).nif.level === 'warn');
expect('checks: VAT names every rate used', ck.vat.text === 'VAT 21 % (general rate)' && checksFor({ lines: [...proposal.lines, { description: 'Book', qty: 1, price: 10, vat: 10 }, { description: 'Course', qty: 1, price: 10, vat: 0 }] }).vat.text === 'VAT 21 % (general rate) and 10 % (reduced rate) and 0 % (exempt)');
expect('checks: totals come from the engine (180,00 + 37,80 = 217,80 €)', flat(ck.totals.text) === 'Totals computed by the engine: 180,00 + 37,80 = 217,80 €');
expect('checks: a total written by the model is ignored', flat(checksFor({ total: '9999.00', taxTotal: '1.00' }).totals.text) === 'Totals computed by the engine: 180,00 + 37,80 = 217,80 €');
expect('checks: due date is computed from today', ck.due.text === 'Due in 15 days (21 Oct 2026)' && checksFor({ dueDays: 0 }).due.text === 'Due on receipt (6 Oct 2026)' && checksFor({ dueDays: 1 }).due.text === 'Due in 1 day (7 Oct 2026)');
expect('checks: the server note is honest about when the server looks', ck.server.level === 'info' && /before PayPal receives it/.test(ck.server.text) && Object.keys(ck).join() === 'client,nif,vat,totals,due,server');
const hostile = '<img src=x onerror=alert(1)>';
const html2 = checksHtml(engineChecks({ ...proposal, recipient: { name: hostile, nif: '', email: '' } }, { known: [{ name: hostile, nif: '', email: '' }], today: '2026-10-06' }));
expect('checks: rendered text is escaped and labelled for screen readers', !html2.includes('<img') && html2.includes('Engine checks') && html2.includes('sr-only'));

const step = (type, extra = {}) => ({ type, ...extra });
const mixed = [step('propose_reminder'), step('propose_collect'), step('propose_cancel'), step('propose_mark_paid'), step('propose_invoice'), step('show_vat_return')];
expect('plan: two or more actions in one reply make a plan', !isPlan([step('propose_invoice')]) && isPlan([step('propose_reminder'), step('show_vat_return')]) && !isPlan(undefined));
expect('plan: only reminders and collections can be approved together', LOW_RISK.join() === 'propose_reminder,propose_collect' && pendingLowRisk(mixed).map((x) => x.a.type).join() === 'propose_reminder,propose_collect' && hasHighRisk(mixed) && !hasHighRisk([step('propose_reminder'), step('show_vat_return')]));
expect('plan: finished, running and dead steps are not offered again', pendingLowRisk([step('propose_reminder', { done: 'Reminder sent' }), step('propose_collect', { busy: true }), step('propose_collect', { dead: true }), step('propose_reminder')]).map((x) => x.ai).join() === '3');
expect('plan: progress counts resolved steps ("2 of 3 done")', JSON.stringify(planProgress([step('propose_reminder', { done: 'x' }), step('propose_collect', { dead: true }), step('show_vat_return')])) === '{"total":3,"done":2,"complete":false}' && planProgress([step('show_vat_return', { done: 'x' })]).complete);
expect('plan: the summary counts what really happened', planSummary([step('propose_reminder', { done: 'a', ok: true }), step('propose_reminder', { done: 'a', ok: true }), step('propose_collect', { done: 'b', ok: true }), step('propose_collect', { done: 'c', ok: false }), step('propose_cancel', { done: 'Dismissed.', skipped: true }), step('show_vat_return', { done: 'd', ok: true })]) === '2 reminders sent · 1 invoice sent with PayPal · VAT draft reviewed · 1 not done · 1 dismissed' && planSummary([]) === 'Nothing was changed');

const paper = flat(proposalPaperHtml({ ...proposal, recipient: { name: 'A <b>&</b> B', nif: 'B12345674', email: 'x@y.example' } }, { issuer: { name: 'Estudio Norte SL', nif: 'B76543214' }, today: '2026-10-06' }));
expect('proposal paper: issuer, client, lines, base, VAT, total and due date', ['Estudio Norte SL', 'NIF B76543214', 'Consulting', '3 × 60,00 €', '180,00 €', 'VAT 21 %', '37,80 €', '217,80 €', 'Due in 15 days · 21 Oct 2026', 'Factura / Invoice'].every((t) => paper.includes(t)));
expect('proposal paper: client text is escaped', !paper.includes('<b>&</b>') && paper.includes('A &lt;b&gt;&amp;&lt;/b&gt; B'));

// 4. Activity (A6): an append-only, bounded log with a pure reducer
const t0 = Date.parse('2026-10-06T10:00:00Z');
const a1 = reduceActivity([], { actor: 'agent', event: 'proposal', detail: 'Invoice for Acme Studio SL · 217,80 €' }, t0);
const a2 = reduceActivity(a1, { actor: 'you', event: 'approved', number: 'CU-0008', detail: 'Invoice for Acme' }, t0 + 5000);
const a3 = reduceActivity(a2, { actor: 'system', event: 'issued', number: 'CU-0008', detail: 'VeriFactu record chained' }, t0 + 6000);
expect('activity: entries are appended in order with actor, event, number, detail and time', a3.length === 3 && a3.map((e) => e.event).join() === 'proposal,approved,issued' && a3[2].number === 'CU-0008' && a3[0].actor === 'agent' && a3[0].at === '2026-10-06T10:00:00.000Z' && !('number' in a3[0]));
expect('activity: the reducer never mutates the log or edits an earlier entry', a1.length === 1 && a2.length === 2 && a3[0] === a1[0] && a3[1] === a2[1] && Object.isFrozen(a1) === false);
expect('activity: an unknown actor is recorded as the system, and text is cleaned and bounded', reduceActivity([], { actor: 'root', event: 'issued', detail: `x\u0000\n${'y'.repeat(400)}` }, t0)[0].actor === 'system' && reduceActivity([], { actor: 'you', event: 'issued', detail: `a\u0000b\n${'y'.repeat(400)}` }, t0)[0].detail.length === 200 && !/[\u0000-\u001f]/.test(reduceActivity([], { actor: 'you', event: 'issued', detail: 'a\u0000b\nc' }, t0)[0].detail));
let big = [];
for (let i = 0; i < MAX_ACTIVITY + 25; i++) big = reduceActivity(big, { actor: 'you', event: 'approved', number: `N-${i}` }, t0 + i);
expect(`activity: the log keeps the last ${MAX_ACTIVITY} entries and drops the oldest`, big.length === MAX_ACTIVITY && big[0].number === 'N-25' && big.at(-1).number === `N-${MAX_ACTIVITY + 24}`);
const rows = activityRows(a3, 20, t0 + 6000 + 3 * 60000);
expect('activity: the panel lists the newest first with relative times and readable labels', rows.map((r) => r.label).join() === 'Issued,Approved,Proposal shown' && rows[0].when === '3 min ago' && rows[2].when === '3 min ago' && activityRows(big, 20, t0 + 9e6).length === 20 && activityRows(big, 20).at(0).number === `N-${MAX_ACTIVITY + 24}`);
expect('activity: relative times read naturally', relTime(new Date(t0).toISOString(), t0 + 10000) === 'just now' && relTime(new Date(t0).toISOString(), t0 + 2 * 3600000) === '2 h ago' && relTime(new Date(t0).toISOString(), t0 + 30 * 3600000) === 'yesterday' && relTime(new Date(t0).toISOString(), t0 + 5 * 86400000) === '5 d ago' && relTime(new Date(t0).toISOString(), t0 + 40 * 86400000) === '2026-10-06');
expect('activity: every event of the flow has a label (proposal, approval, dismissal, issue, PayPal, reminder, payment, cancellation, sync, tamper, sample, reset)', ['proposal', 'approved', 'dismissed', 'issued', 'sent', 'reminder', 'payment', 'cancelled', 'sync', 'tamper_on', 'tamper_off', 'sample', 'reset'].every((e) => EVENTS[e]));
expect('activity: rendered entries are escaped and name the actor for screen readers', !activityHtml(activityRows(reduceActivity([], { actor: 'you', event: 'approved', number: '<b>', detail: '<img src=x onerror=alert(1)>' }, t0), 20, t0)).includes('<img') && activityHtml(activityRows(a3, 20, t0)).includes('Engine: ') && activityHtml([]).includes('Nothing yet'));

console.log(failed ? `${failed} UI check(s) failed` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
