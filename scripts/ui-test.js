// Offline tests for the client-side modules and the design system: no browser, no keys, no network.
import { readFileSync, readdirSync } from 'node:fs';
import { buildAlta, buildAnulacion, buildRectificativa, verifyChain } from '../public/js/verifactu.js';
import { buildSample } from '../public/js/ledger.js';
import { chainBlocks, chainStatus, chainTrackHtml, MAX_BLOCKS } from '../public/js/chain.js';
import { engineChecks, checksHtml, matchClient } from '../public/js/checks.js';
import { isPlan, planProgress, pendingLowRisk, hasHighRisk, planSummary, LOW_RISK } from '../public/js/plan.js';
import { proposalPaperHtml } from '../public/js/proposal.js';
import { reduceActivity, activityRows, activityHtml, relTime, MAX_ACTIVITY, EVENTS } from '../public/js/activity.js';
import { encodeRecord, decodeRecord, sanitizeRecord, shareable, shareUrl, fragmentValue, verifyRecord, ShareError, MAX_FRAGMENT } from '../public/js/share.js';
import { renderDocument } from '../public/js/document.js';
import { summary, vatReturn } from '../public/js/ledger.js';
import { cleanSpec, defaultBoard, specKey, widgetData, widgetCsv, widgetTableHtml, periodRange, countText, subtitle, MAX_WIDGETS, TYPES, METRICS, GROUPS } from '../public/js/widgets.js';
import { chartOptions, createChartHub, insightCardHtml, boardCardHtml, widgetBodyHtml, legendRows, legendHtml, mix as mixHex, palette, figures, chartLabel } from '../public/js/insights.js';
import { eur, md } from '../public/js/fmt.js';
import { synthReply, detectLang } from '../public/js/say.js';
import { normalizeProposal, normalizeRectify } from '../public/js/proposal.js';
import { prettyJson, displayMsg, jsonHtml, transcriptLines, playTranscript } from '../public/js/terminal.js';
import { ledgerRows, CHIPS, matchesChip, chipCounts, gridTotals, registerCsv, registerCells, REGISTER_HEADER, numberCellHtml, clientCellHtml, statusCellHtml, actionsCellHtml, csvCell, dueText } from '../public/js/grid.js';

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
expect('plan: an insight changes nothing in the ledger (no "one by one" warning for it) and the summary counts it as pinned', !hasHighRisk([step('propose_reminder'), step('propose_widget'), step('show_vat_return')]) && hasHighRisk([step('propose_widget'), step('propose_cancel')]) && planSummary([step('propose_widget', { done: 'Pinned to the board.', ok: true }), step('propose_widget', { done: 'Dismissed.', skipped: true })]) === '1 insight pinned · 1 dismissed');
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
expect('activity: every event of the flow has a label (proposal, approval, dismissal, issue, PayPal, reminder, payment, cancellation, sync, tamper, sample, reset, widget pinned and removed)', ['proposal', 'approved', 'dismissed', 'issued', 'sent', 'reminder', 'payment', 'cancelled', 'sync', 'tamper_on', 'tamper_off', 'sample', 'reset', 'widget_pinned', 'widget_removed'].every((e) => EVENTS[e]));
expect('activity: rendered entries are escaped and name the actor for screen readers', !activityHtml(activityRows(reduceActivity([], { actor: 'you', event: 'approved', number: '<b>', detail: '<img src=x onerror=alert(1)>' }, t0), 20, t0)).includes('<img') && activityHtml(activityRows(a3, 20, t0)).includes('Engine: ') && activityHtml([]).includes('Nothing yet'));

// 5. Document and verification link (A5): the record travels in a URL fragment and is re-hashed by the reader
const issued = sample.find((r) => r.kind !== 'anulacion' && r.number === sample[0].number);
const withPayPal = { ...issued, email: 'billing@acme.example', paypal: { id: 'INV2-MOCK-0001', token: 'SECRET-TOKEN', status: 'SENT', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0001' } };
const canDeflate = (() => { try { new CompressionStream('deflate-raw'); new DecompressionStream('deflate-raw'); return true; } catch { return false; } })();
const packed = await encodeRecord(withPayPal);
const unpacked = await decodeRecord(packed);
expect('link: a record survives encode and decode (compressed)', packed.startsWith(canDeflate ? 'z.' : 'j.') && JSON.stringify(unpacked) === JSON.stringify(sanitizeRecord(shareable(withPayPal))) && unpacked.number === issued.number && unpacked.hash === issued.hash && unpacked.lines.length === issued.lines.length);
const plain = await encodeRecord(withPayPal, { compress: false });
expect('link: the uncompressed fallback round-trips too', plain.startsWith('j.') && JSON.stringify(await decodeRecord(plain)) === JSON.stringify(unpacked) && (!canDeflate || packed.length < plain.length));
expect('link: a decoded record verifies, with the hash it was issued with', (await verifyRecord(unpacked)).ok && (await verifyRecord(unpacked)).hash === issued.hash);
expect('link: a cancellation record round-trips and verifies', await (async () => { const c = sample.find((r) => r.kind === 'anulacion'); const back = await decodeRecord(await encodeRecord(c)); return back.kind === 'anulacion' && back.reason === c.reason && (await verifyRecord(back)).ok; })());
const forgedTotal = await decodeRecord(await encodeRecord({ ...issued, total: '999.00' }));
const forgedLines = await decodeRecord(await encodeRecord({ ...issued, lines: issued.lines.map((l) => ({ ...l, price: l.price + 1 })) }));
const forgedLink = await decodeRecord(await encodeRecord({ ...issued, prev: { nif: 'B76543214', number: 'X-1', date: '01-01-2026', hash: 'A'.repeat(64) } }));
expect('link: an altered amount fails the hash ("Altered")', (await verifyRecord(forgedTotal)).ok === false && (await verifyRecord(forgedTotal)).reason === 'the content does not match its hash');
expect('link: altered lines fail even though the hash fields are untouched', (await verifyRecord(forgedLines)).ok === false && /amounts do not match/.test((await verifyRecord(forgedLines)).reason) && (await verifyRecord(forgedLink)).ok === false);
const jsonOf = JSON.stringify(shareable(withPayPal));
expect('link: no PayPal token, no client email and no precomputed QR travel in the link', !jsonOf.includes('SECRET-TOKEN') && !jsonOf.includes('billing@acme.example') && !('qr' in shareable(withPayPal)) && shareable(withPayPal).payerUrl === withPayPal.paypal.payerUrl);
expect('link: a payer link that is not PayPal is dropped', !('payerUrl' in shareable({ ...withPayPal, paypal: { payerUrl: 'https://evil.example/pay' } })) && !('payerUrl' in sanitizeRecord({ ...shareable(withPayPal), payerUrl: 'javascript:alert(1)' })));
const rejects = async (value, code) => { try { await decodeRecord(value); return false; } catch (e) { return e instanceof ShareError && e.code === code; } };
const rawLink = (obj) => `j.${Buffer.from(JSON.stringify(obj)).toString('base64url')}`;
expect('link: empty, malformed and oversized values are rejected', await rejects('', 'empty') && await rejects('nonsense', 'malformed') && await rejects('z.@@@', 'malformed') && await rejects(`j.${'A'.repeat(MAX_FRAGMENT)}`, 'too-large') && await rejects(`z.${Buffer.from('not deflate').toString('base64url')}`, 'malformed'));
expect('link: a small link that inflates into a huge payload is stopped (16 KB cap)', await (async () => { const { deflateRawSync } = await import('node:zlib'); const bomb = deflateRawSync(Buffer.alloc(5 * 1024 * 1024, 32)); return !canDeflate || (bomb.length < MAX_FRAGMENT && (await rejects(`z.${bomb.toString('base64url')}`, 'too-large'))); })());
expect('link: the record is rebuilt from known fields only, with strict types', await (async () => {
  const good = shareable(issued);
  const poisoned = await decodeRecord(`j.${Buffer.from(`${JSON.stringify({ ...good, extra: '<img src=x>', qr: 'https://evil.example/' }).slice(0, -1)},"__proto__":{"admin":true}}`).toString('base64url')}`);
  return !('extra' in poisoned) && !('qr' in poisoned) && !('admin' in poisoned) && !Object.hasOwn(poisoned, '__proto__') && await rejects(rawLink({ ...good, hash: 'nothex' }), 'malformed') && await rejects(rawLink({ ...good, lines: 'x' }), 'malformed') && await rejects(rawLink({ ...good, lines: Array(21).fill(good.lines[0]) }), 'malformed') && await rejects(rawLink({ ...good, total: 217.8 }), 'malformed') && await rejects(rawLink({ ...good, lines: [{ ...good.lines[0], vat: 7 }] }), 'malformed') && await rejects(rawLink({ ...good, date: '2026-10-06' }), 'malformed') && await rejects(rawLink(null), 'malformed');
})());
expect('link: the fragment is read from location.hash', fragmentValue('#r=z.abc_-') === 'z.abc_-' && fragmentValue('') === '' && fragmentValue('#x=1') === '');
expect('link: shareUrl points to verify.html with the record in the fragment, never in the query', (await shareUrl(withPayPal, 'https://cuadra-invoices.vercel.app')).startsWith('https://cuadra-invoices.vercel.app/verify.html#r=z.') && !(await shareUrl(withPayPal, 'https://x.example')).includes('?'));

const qrCalls = [];
const docHtml = renderDocument({ ...unpacked, qr: 'https://evil.example/fake-qr' }, { qr: (t) => { qrCalls.push(t); return `<svg data-text="${t.length}"></svg>`; } });
expect('document: bilingual labels, issuer, client, lines, breakdown, total and the hash footer', ['Factura / Invoice', 'Cliente / Bill to', 'Descripción / Description', 'Base imponible / Taxable base', 'IVA / VAT', 'Total', 'Hash SHA-256', 'Registro anterior / Previous record', issued.number, issued.hash].every((t) => flat(docHtml).includes(t)));
expect('document: two QR codes, the AEAT one rebuilt from the record and the PayPal one from a PayPal link only', qrCalls.length === 2 && qrCalls[0].startsWith('https://prewww2.aeat.es/') && qrCalls[0].includes(`numserie=${encodeURIComponent(issued.number)}`) && !qrCalls.some((t) => t.includes('evil.example')) && qrCalls[1] === withPayPal.paypal.payerUrl && docHtml.includes('Verify at AEAT') && docHtml.includes('Pay with PayPal'));
const evilCalls = [];
const evilDoc = renderDocument({ ...unpacked, payerUrl: 'https://evil.example/pay' }, { qr: (t) => { evilCalls.push(t); return ''; } });
expect('document: no PayPal QR without a PayPal payer link', evilCalls.length === 1 && !evilDoc.includes('Pay with PayPal') && !evilDoc.includes('evil.example'));
const hostileDoc = renderDocument({ ...unpacked, issuerName: hostile, number: hostile, recipient: { name: hostile, nif: hostile }, lines: [{ description: hostile, qty: 1, price: 1, vat: 21 }] }, { stamp: hostile, check: { ok: true, at: hostile } });
expect('document: every field is escaped', !hostileDoc.includes('<img') && hostileDoc.includes('&lt;img'));
const cancelDoc = renderDocument(sample.find((r) => r.kind === 'anulacion'), { qr: () => '' });
expect('document: a cancellation record has its own document without an AEAT QR', cancelDoc.includes('Anulación / Cancellation record') && !cancelDoc.includes('Verify at AEAT'));
expect('document: a stamp and the hash check line appear when asked', renderDocument(unpacked, { stamp: 'Altered', check: { ok: false, at: 'now' } }).includes('doc-stamp') && renderDocument(unpacked, { check: { ok: false } }).includes('DOES NOT MATCH') && !renderDocument(unpacked).includes('doc-stamp'));

const verifyPage = read('public/verify.html');
const verifyJs = read('public/verify.js');
expect('verify page: never calls a server (no fetch, XHR, beacon or form)', !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|<form/.test(verifyJs + verifyPage + read('public/js/share.js') + read('public/js/document.js')));
expect('verify page: print rules show only the document', /@media print[\s\S]*\.print-doc main > :not\(#paper\)\s*\{\s*display: none !important/.test(css) && verifyPage.includes('class="print-doc') && verifyPage.includes('id="paper"') && (verifyPage.match(/no-print/g) || []).length >= 4);
expect('verify page: honest text and the Print button', verifyPage.includes("Generated from the issuer's ledger copy. For legal effect, scan the AEAT QR.") && verifyPage.includes('Print / Save as PDF') && /window\.print\(\)/.test(verifyJs));

// 6. Social and brand (A9): the card, the icons and the metas that point to them
const png = (p) => { const b = readFileSync(new URL(`../${p}`, import.meta.url)); return { size: b.length, magic: b.subarray(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const og = png('public/og.png');
const icon = png('public/icon-180.png');
expect('og.png is a 1200x630 PNG under 300 KB', og.magic === 'PNG' && og.w === 1200 && og.h === 630 && og.size < 300 * 1024);
expect('icon-180.png is a 180x180 PNG and favicon.svg is the new C of two links', icon.magic === 'PNG' && icon.w === 180 && icon.h === 180 && /<svg/.test(read('public/favicon.svg')) && read('public/favicon.svg').includes('#a5b4fc') && read('public/favicon.svg').includes('#34d399'));
const metas = (html) => ({ ogImage: /property="og:image" content="https:\/\/cuadra-invoices\.vercel\.app\/og\.png"/.test(html), twitter: /name="twitter:card" content="summary_large_image"/.test(html), title: /property="og:title"/.test(html) && /name="twitter:title"/.test(html), touch: /rel="apple-touch-icon" href="\/icon-180\.png"/.test(html), icon: /rel="icon" href="\/favicon\.svg"/.test(html) });
expect('index.html and verify.html carry the OG and Twitter metas, the favicon and the touch icon', Object.values(metas(read('public/index.html'))).every(Boolean) && Object.values(metas(read('public/verify.html'))).every(Boolean));
expect('the CSP gained no origin: fonts and styles still come only from Google Fonts', (() => { const csp = JSON.parse(read('vercel.json')).headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value; return csp.includes("script-src 'self';") && csp.includes('style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com;') && csp.includes('font-src https://fonts.gstatic.com;') && csp.includes("img-src 'self' data:;") && csp.includes("connect-src 'self';") && !/https:\/\/(?!fonts\.g)/.test(csp); })());

// 7. Markup and stylesheet agree: every plain class used in the HTML and the JS templates has a rule in public/styles.css
{
  const sheet = read('public/styles.css');
  const files = ['public/index.html', 'public/verify.html', 'public/app.js', 'public/verify.js', ...readdirSync(new URL('../public/js', import.meta.url)).map((f) => `public/js/${f}`)];
  const hooks = new Set(['tour-next', 'tour-skip', 'false', 'true']); // JS hooks without styles
  const dynamic = /^(plan|activity|check|term|t-arrow)-$|^check-(ok|warn|bad)$/; // plan-${state}, activity-${actor}, check-${level}, term-${kind}, t-arrow-${dir}
  const classes = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/class(?:Name)?="([^"]*)"/g)) for (const t of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(t)) classes.add(t);
  }
  const missing = [...classes].filter((t) => !hooks.has(t) && !dynamic.test(t) && !new RegExp(`\\.${t}(?![\\w-])`).test(sheet));
  expect(`every plain class used in the markup has a rule in the stylesheet (${classes.size} classes)${missing.length ? `: missing ${missing.join(', ')}` : ''}`, missing.length === 0);
  const appCss = read('styles/input.css');
  expect('no component class is named like a Tailwind utility it would lose to (block, flex, hidden, grid...)', !/^\.(block|inline|flex|grid|hidden|table|contents|container|static|fixed|absolute|relative|sticky|truncate|collapse|invisible|visible)\s*[{,]/m.test(appCss));
}

// 8. The ledger as an AG Grid (B1): rows, status chips, totals of the filtered rows, register CSV and the cells' HTML.
// None of this needs the library: the grid only draws what these pure functions decide.
{
  const today = '2026-10-06';
  const rows = ledgerRows(sample, { today });
  expect('grid rows: one per record, newest first, i is the index in the ledger', rows.length === 8 && rows[0].i === 7 && rows.at(-1).i === 0 && rows.every((r) => r.number === sample[r.i].number));
  expect('grid rows: statuses come from the ledger (paid, overdue, cancelled, open) and the cancellation is its own row', rows.map((r) => r.status).join() === 'ISSUED,ANULACION,CANCELLED,OVERDUE,OVERDUE,PAID,PAID,PAID' && rows[1].kind === 'anulacion' && rows[1].number === sample[5].number && rows[1].reason === 'Duplicate of the previous invoice' && rows[1].total === '');
  expect('grid rows: amounts and the register fields are the ledger strings, never recomputed', rows[0].total === sample[7].total && rows[0].base === '240.00' && rows[0].vat === '50.40' && rows[0].due === sample[7].dueDate && rows[0].hash === sample[7].hash && rows.every((r) => r.kind === 'anulacion' || (r.paypal === false && r.sample === true)));
  expect('grid rows: the new record flashes and the altered one is marked', (() => { const r = ledgerRows(sample, { today, flashNumber: sample[7].number, brokenAt: 3 }); return r.filter((x) => x.flash).map((x) => x.i).join() === '7' && r.filter((x) => x.altered).map((x) => x.i).join() === '3'; })());

  const counts = chipCounts(rows);
  expect('status chips: All, Open, Overdue, Paid, Cancelled count invoices (overdue is also open, a cancellation is not an invoice)', CHIPS.map(([k]) => k).join() === 'all,open,overdue,paid,cancelled' && JSON.stringify(counts) === '{"all":7,"open":3,"overdue":2,"paid":3,"cancelled":1}');
  const by = (chip) => rows.filter((r) => matchesChip(r, chip));
  expect('status chips: a cancellation record shows under All and Cancelled only', by('all').length === 8 && by('cancelled').map((r) => r.kind).join() === 'anulacion,alta' && by('open').length === 3 && by('overdue').length === 2 && by('paid').length === 3 && !by('open').some((r) => r.kind === 'anulacion'));

  const money2 = (list) => gridTotals(list).totalNum.toFixed(2);
  const kpi = summary(sample, today);
  expect('totals row: the sum of the rows showing agrees with the engine (open = outstanding, overdue, paid = collected)', money2(by('open')) === kpi.unpaidTotal && money2(by('overdue')) === kpi.overdueTotal && money2(by('paid')) === kpi.collected && kpi.unpaidTotal === '2006.40' && kpi.overdueTotal === '1716.00' && kpi.collected === '2431.40');
  expect('totals row: All leaves the cancelled invoice out and says so', JSON.stringify(gridTotals(rows)) === '{"kind":"total","count":6,"totalNum":4437.8,"label":"Total · 6 invoices","note":"1 cancelled left out"}');
  expect('totals row: labels follow the filter, a lone cancelled invoice is totalled instead of 0,00 and an empty filter is zero', gridTotals(by('open')).label === 'Total · 3 invoices' && gridTotals(by('overdue')).label === 'Total · 2 invoices' && JSON.stringify([gridTotals(by('cancelled')).label, gridTotals(by('cancelled')).totalNum, gridTotals(by('cancelled')).note]) === '["Cancelled · 1 invoice",726,""]' && gridTotals([]).label === 'Total · 0 invoices' && gridTotals([]).totalNum === 0 && gridTotals(by('paid').slice(0, 1)).label === 'Total · 1 invoice');
  expect('totals row: cents are summed as integers (0.1 + 0.2 never shows 0,30000000000000004)', gridTotals([{ kind: 'alta', status: 'ISSUED', totalNum: 0.1 }, { kind: 'alta', status: 'ISSUED', totalNum: 0.2 }]).totalNum === 0.3);

  const hostileClient = '<img src=x onerror=alert(1)>';
  const open = rows[0];
  expect('cells: client names are escaped and "sample" is shown under the NIF', !clientCellHtml({ ...open, client: hostileClient }).includes('<img') && clientCellHtml({ ...open, client: hostileClient }).includes('&lt;img') && /B12345674 · sample/.test(clientCellHtml(open)));
  expect('cells: the status keeps the badge classes, the PayPal label and the ALTERED badge', statusCellHtml({ ...open, status: 'OVERDUE', paypal: true, altered: true }).includes('badge badge-bad') && statusCellHtml({ ...open, paypal: true }).includes('PayPal') && statusCellHtml({ ...open, altered: true }).includes('Altered') && !statusCellHtml(open).includes('Altered') && statusCellHtml(rows[1]).includes('Anulación'));
  expect('cells: a cancellation row reads "↳ Cancels CU-0006" with its reason, escaped', numberCellHtml(rows[1]).includes('↳') && numberCellHtml(rows[1]).includes(`Cancels <b class="num">${sample[5].number}</b>`) && !numberCellHtml({ ...rows[1], reason: hostileClient }).includes('<img') && numberCellHtml(rows[2]).includes('line-through'));
  const btn = (row) => [...actionsCellHtml(row).matchAll(/data-i="(\d+)" data-do="(\w+)"/g)].map((m) => `${m[2]}:${m[1]}`).join();
  expect('cells: the buttons keep data-i and data-do (view, collect, remind, refresh), so the ledger listener serves table and grid', btn(open) === 'view:7,collect:7' && btn({ ...open, paypal: true }) === 'view:7,refresh:7,remind:7' && btn(rows.at(-1)) === 'view:0' && btn(rows[1]) === 'view:6' && actionsCellHtml(open).includes('aria-label="Collect ' + open.number + '"'));
  expect('cells: the due date shows for open invoices only', dueText(open) === '18 Oct 2026' && dueText(rows.at(-1)) === '' && dueText(rows[1]) === '');

  const csv = registerCsv([...rows].sort((a, b) => a.i - b.i));
  const lines = csv.slice(1).split('\r\n');
  expect('register CSV: BOM, the register header, one quoted line per record in ledger order', csv.startsWith('﻿') && lines[0] === REGISTER_HEADER.split(',').map(csvCell).join(',') && lines.length === 9 && lines[1].startsWith(`"alta","${sample[0].number}","${sample[0].date}","Acme Studio SL","B12345674","1200.00","252.00","1452.00","PAID"`) && lines[7].startsWith(`"anulacion","${sample[5].number}"`) && lines[7].includes('"CANCELLATION"'));
  expect('register CSV: a cell that looks like a formula is neutralised, quotes are doubled', registerCsv([{ ...open, client: '=HYPERLINK("http://x","y")' }]).includes('"\'=HYPERLINK(""http://x"",""y"")"') && csvCell('+1') === '"\'+1"' && csvCell('@a') === '"\'@a"' && csvCell('-2') === '"\'-2"' && csvCell('ok') === '"ok"' && registerCells(rows[1]).length === 11);
}

// 9. Ask the ledger (B2): widgetData computes every figure from the ledger; the model only picks the specification.
{
  const today = '2026-10-06';
  const snapshot = JSON.stringify(sample);
  const D = (spec) => widgetData(sample, spec, today);
  const table = (d) => d.rows.map((r) => [r.label, ...d.series.map((s) => r[s.key])]);
  const owes = D({ type: 'donut', metric: 'outstanding', groupBy: 'client', period: 'all' });
  expect('widgetData: who still owes what = 3 open invoices, 2006,40 €, biggest first, the cancelled duplicate left out', JSON.stringify(table(owes)) === '[["Hotel Mirador SL",990],["Marta Pardo",726],["Acme Studio SL",290.4]]' && owes.total.outstanding === 2006.4 && owes.n === 3 && flat(owes.text) === '2006,40 €' && !owes.empty);
  const q3 = D({ type: 'bar', metric: 'invoiced', groupBy: 'client', period: '2026-Q3' });
  expect('widgetData: invoiced by client in 2026-Q3 = 4147,40 € over 5 clients (the Q4 invoice and the cancelled duplicate are not in it)', JSON.stringify(table(q3)) === '[["Acme Studio SL",1452],["Hotel Mirador SL",990],["Marta Pardo",726],["Lumen Foods SL",605],["Casa Verde S.Coop.",374.4]]' && q3.total.invoiced === 4147.4 && q3.n === 5);
  const thisQuarter = D({ type: 'bar', metric: 'invoiced', groupBy: 'client', period: 'quarter' });
  expect('widgetData: "this quarter" is the calendar quarter of today (2026-Q4: only the invoice of 3 October)', thisQuarter.period.label === '2026-Q4' && JSON.stringify(table(thisQuarter)) === '[["Acme Studio SL",290.4]]' && thisQuarter.total.invoiced === 290.4);
  const months = D({ type: 'bar', metric: 'invoiced_vs_collected', groupBy: 'month', period: 'all' });
  expect('widgetData: invoiced vs collected by month = two series over the months that have invoices (Jul to Oct), totals 4437,80 € and 2431,40 €', JSON.stringify(table(months)) === '[["Jul",2057,2057],["Aug",1364.4,374.4],["Sep",726,0],["Oct",290.4,0]]' && months.series.map((s) => s.key).join() === 'invoiced,collected' && months.total.invoiced === 4437.8 && months.total.collected === 2431.4 && months.period.label === 'Last 6 months');
  const aging = D({ type: 'bar', metric: 'outstanding', groupBy: 'aging', period: 'all' });
  expect('widgetData: receivables aging buckets are 0–30, 31–60 and 61+ days since the invoice date (empty buckets stay on the axis)', JSON.stringify(table(aging)) === '[["0–30 days",1016.4],["31–60 days",990],["61+ days",0]]' && aging.total.outstanding === 2006.4);
  const vat = D({ type: 'table', metric: 'vat', groupBy: 'vatRate', period: '2026-Q3' });
  const boxes = vatReturn(sample, '2026-Q3').boxes;
  expect('widgetData: VAT by rate in 2026-Q3 agrees with the Modelo 303 draft box by box (21 %, 10 %, 4 % and box 27)', JSON.stringify(table(vat)) === '[["21 %",483],["10 %",90],["4 %",14.4]]' && vat.total.vat === 587.4 && vat.rows[0].vat.toFixed(2) === boxes['09'] && vat.rows[1].vat.toFixed(2) === boxes['06'] && vat.rows[2].vat.toFixed(2) === boxes['03'] && vat.total.vat.toFixed(2) === boxes['27']);
  const kpis = summary(sample, today);
  expect('widgetData: the figures agree with the KPI cards (outstanding, overdue, collected)', D({ type: 'number', metric: 'outstanding', groupBy: 'none', period: 'all' }).value.toFixed(2) === kpis.unpaidTotal && D({ type: 'number', metric: 'outstanding', groupBy: 'none', period: 'all', status: 'OVERDUE' }).value.toFixed(2) === kpis.overdueTotal && D({ type: 'number', metric: 'collected', groupBy: 'none', period: 'all' }).value.toFixed(2) === kpis.collected);
  const byStatus = D({ type: 'donut', metric: 'invoiced', groupBy: 'status', period: 'all' });
  expect('widgetData: by status the groups are Paid, Open and Overdue and add up to the invoiced total', JSON.stringify(table(byStatus)) === '[["Paid",2431.4],["Open",290.4],["Overdue",1716]]' && byStatus.total.invoiced === 4437.8);
  expect('widgetData: the status filter narrows the invoices (overdue only: Hotel Mirador and Marta Pardo)', JSON.stringify(table(D({ type: 'bar', metric: 'outstanding', groupBy: 'client', period: 'all', status: 'OVERDUE' }))) === '[["Hotel Mirador SL",990],["Marta Pardo",726]]' && JSON.stringify(table(D({ type: 'bar', metric: 'invoiced', groupBy: 'client', period: 'all', status: 'PAID' })).map((r) => r[0])) === '["Acme Studio SL","Lumen Foods SL","Casa Verde S.Coop."]');
  expect('widgetData: counts, a single figure and a trend (zero months are kept inside a year)', D({ type: 'number', metric: 'count', groupBy: 'none', period: 'all' }).value === 6 && D({ type: 'number', metric: 'count', groupBy: 'none', period: 'all' }).text === '6' && D({ type: 'line', metric: 'count', groupBy: 'month', period: 'year' }).rows.map((r) => r.count).join() === '0,0,0,0,0,0,2,2,1,1');
  expect('widgetData: an empty ledger gives an empty widget, and a model that stuffs figures into the spec changes nothing', widgetData([], { type: 'bar', metric: 'invoiced', groupBy: 'month', period: 'all' }, today).empty && widgetData([], { type: 'number', metric: 'invoiced' }, today).text === eur(0) && JSON.stringify(D({ type: 'donut', metric: 'outstanding', groupBy: 'client', period: 'all', total: 9999, rows: [{ label: 'x', outstanding: 1 }], value: 1 })) === JSON.stringify(owes));
  expect('widgetData: it never mutates the ledger it reads', JSON.stringify(sample) === snapshot);

  const cleaned = cleanSpec({ type: 'pie', metric: 'revenue', groupBy: 'weekday', period: 'someday', status: 'LATE', title: `  ${'x'.repeat(100)}  `, extra: '<img>' });
  expect('cleanSpec: unknown values fall back to safe defaults, titles are bounded and unknown keys are dropped', cleaned.type === 'number' && cleaned.metric === 'invoiced' && cleaned.groupBy === 'none' && cleaned.period === 'quarter' && !('status' in cleaned) && cleaned.title.length === 60 && !('extra' in cleaned) && JSON.stringify(Object.keys(cleaned)) === '["title","type","metric","groupBy","period"]');
  expect('cleanSpec: combinations that cannot be drawn become ones that can (donut and figure have one series, a line needs months, a figure has no groups)', cleanSpec({ type: 'donut', metric: 'invoiced_vs_collected', groupBy: 'client', period: 'all' }).metric === 'invoiced' && cleanSpec({ type: 'line', metric: 'vat', groupBy: 'client', period: 'all' }).type === 'bar' && cleanSpec({ type: 'number', metric: 'vat', groupBy: 'client', period: 'all' }).groupBy === 'none' && cleanSpec({ type: 'bar', metric: 'vat', groupBy: 'none', period: 'all' }).type === 'number' && cleanSpec({ type: 'table', metric: 'vat', groupBy: 'none', period: 'all' }).type === 'table');
  expect('cleanSpec: periods are quarter, year, all or a quarter like 2027-Q1; null, arrays and strings are not specs', cleanSpec({ period: '2027-Q1' }).period === '2027-Q1' && cleanSpec({ period: '2027-Q5' }).period === 'quarter' && cleanSpec({ period: 'year' }).period === 'year' && [null, [], 'x', 7, undefined].every((v) => cleanSpec(v).type === 'number') && cleanSpec({ title: '', metric: 'count', groupBy: 'client', type: 'bar' }).title === 'Invoices by client');
  expect('the board: six widgets at most, a default board of three, and two specs with the same key are the same widget', MAX_WIDGETS === 6 && defaultBoard().map((w) => w.title).join(' | ') === 'Invoiced vs collected by month | Who still owes what | Receivables aging' && specKey(defaultBoard()[1]) === specKey({ ...defaultBoard()[1], title: 'another title' }) && specKey(defaultBoard()[1]) !== specKey(defaultBoard()[0]) && [TYPES, METRICS, GROUPS].every((l) => l.length >= 5));
  expect('periods: this quarter, this year, a named quarter, and six months back when the period is "all" with months', periodRange('quarter', today).from === '2026-10-01' && periodRange('year', today).to === '2026-12-31' && periodRange('2026-Q3', today).to === '2026-09-30' && periodRange('all', today).label === 'All time' && periodRange('all', today, 'month').from === '2026-05-01' && countText(owes) === '3 open invoices' && subtitle(owes) === '3 open invoices · All time · incl. VAT' && subtitle(vat) === '5 invoices · 2026-Q3');

  const csv = widgetCsv(owes);
  expect('widget CSV: BOM, CRLF, quoted cells, amounts with two decimals and a total row', csv === '﻿"Client","Outstanding"\r\n"Hotel Mirador SL","990.00"\r\n"Marta Pardo","726.00"\r\n"Acme Studio SL","290.40"\r\n"Total","2006.40"' && widgetCsv(months).split('\r\n')[0] === '﻿"Month","Invoiced","Collected"');
  expect('widget CSV: a client name that looks like a formula is neutralised', widgetCsv({ ...owes, rows: [{ key: 'x', label: '=HYPERLINK("http://evil","x")', n: 1, outstanding: 5 }], total: { outstanding: 5 } }).includes('"\'=HYPERLINK(""http://evil"",""x"")"'));
  const tableHtml = widgetTableHtml({ ...owes, rows: [{ key: 'x', label: hostile, n: 1, outstanding: 5 }, { key: 'y', label: 'Other', n: 1, outstanding: 3 }], title: hostile });
  expect('widget table (the fallback of every chart): the same figures, escaped, with a total and a caption for screen readers', !tableHtml.includes('<img') && tableHtml.includes('&lt;img') && tableHtml.includes('<caption class="sr-only">') && /<tfoot>/.test(tableHtml) && flat(widgetTableHtml(owes)).includes('990,00 €') && flat(widgetTableHtml(owes)).includes('2006,40 €'));

  // The drawing side: AG Charts options from the :root tokens, the legend, the cards and the hub that keeps one chart per card
  const tokens = { ink: '#0a0d14', surface: '#10141f', text: '#e8ecf4', soft: '#94a3b8', ok: '#34d399', warn: '#fbbf24', bad: '#fb7185', link: '#a5b4fc' };
  const bar = chartOptions(months, tokens, eur);
  expect('chart options: invoiced vs collected is a grouped bar chart with two series, a legend and the dark theme from the tokens', bar.series.length === 2 && bar.series.every((s) => s.type === 'bar' && s.grouped === true && s.xKey === 'label') && bar.series.map((s) => s.yKey).join() === 'invoiced,collected' && bar.series[0].fill === tokens.link && bar.series[1].fill === tokens.ok && bar.legend.enabled === true && bar.theme.baseTheme === 'ag-default-dark' && bar.theme.params.foregroundColor === tokens.text && bar.axes.x.type === 'category' && bar.axes.y.label.formatter({ value: 1500 }) === '1.5k' && bar.axes.y.label.formatter({ value: 0 }) === '0');
  const donut = chartOptions(owes, tokens, eur);
  expect('chart options: a donut has one slice per client with its colour, no built-in legend (the card draws one with the amounts) and the total in the middle', donut.series[0].type === 'donut' && donut.data.length === 3 && donut.data[0].label === 'Hotel Mirador SL' && donut.data[0].value === 990 && donut.legend.enabled === false && flat(donut.series[0].innerLabels[0].text) === '2006,40 €' && donut.series[0].fills.length === 8);
  expect('chart options: zero slices are not drawn, ageing bars are green, amber and red, a line chart has lines', chartOptions(D({ type: 'donut', metric: 'outstanding', groupBy: 'status', period: 'all' }), tokens, eur).data.map((d) => d.label).join() === 'Open,Overdue' && ['0-30', '31-60', '61+'].map((k, i) => chartOptions(aging, tokens, eur).series[0].itemStyler({ datum: { key: k } }).fill === [tokens.ok, tokens.warn, tokens.bad][i]).every(Boolean) && chartOptions(D({ type: 'line', metric: 'count', groupBy: 'month', period: 'year' }), tokens, eur).series[0].type === 'line');
  expect('chart options: the animation is off (the Community charts have none, and asking for it only logs a warning)', chartOptions(owes, tokens, eur).animation.enabled === false && chartOptions(months, tokens, eur).animation.enabled === false);
  const colours = palette(tokens);
  expect('palette: eight different colours made from the tokens, mixing is plain hex arithmetic', colours.length === 8 && new Set(colours).size === 8 && colours.every((c) => /^#[0-9a-f]{6}$/.test(c)) && mixHex('#000000', '#ffffff', 0.5) === '#808080' && mixHex(tokens.ok, tokens.ok, 0.7) === tokens.ok);
  const legend = legendRows(owes, tokens, eur);
  expect('donut legend: client, amount and share of the total, in the slice colours, escaped', legend.map((r) => `${r.label}:${r.share}`).join() === 'Hotel Mirador SL:49,Marta Pardo:36,Acme Studio SL:14' && legend[0].color === colours[0] && legend[1].color === colours[1] && !legendHtml([{ label: hostile, text: '1', share: 1, color: '"><img src=x>' }]).includes('<img'));
  expect('figures: one per series, from the engine totals', JSON.stringify(figures(months, eur).map((f) => [f.label, flat(f.text)])) === '[["Invoiced","4437,80 €"],["Collected","2431,40 €"]]' && figures(D({ type: 'number', metric: 'count', groupBy: 'none', period: 'all' }), eur)[0].text === '6');

  expect('chart label: a screen reader gets the title and every figure of the chart, not just a canvas', flat(chartLabel(owes, eur)) === 'Donut chart: Outstanding by client. Hotel Mirador SL: 990,00 €; Marta Pardo: 726,00 €; Acme Studio SL: 290,40 €.' && flat(chartLabel(months, eur)).startsWith('Bar chart: Invoiced vs collected by month. Jul: Invoiced 2057,00 €, Collected 2057,00 €; Aug: Invoiced 1364,40 €, Collected 374,40 €;'));
  const card = insightCardHtml(owes, { id: '3-0', tokens, fmt: eur });
  expect('Insight card: title, figure, the chart slot, the honest note and the two buttons (Pin to board, Dismiss)', card.includes('Outstanding by client') && flat(card).includes('2006,40 €') && card.includes('data-chart="chat:3-0"') && card.includes('Computed in your browser from the ledger, not by the AI.') && card.includes('data-act="pin" data-id="3-0"') && card.includes('data-act="discard"') && !card.includes(' disabled'));
  expect('Insight card: a full board disables Pin and says why; a pinned one shows its result and a way to the board; the title is escaped', /data-act="pin"[^>]*disabled/.test(insightCardHtml(owes, { id: '1-0', boardFull: true, tokens, fmt: eur })) && insightCardHtml(owes, { id: '1-0', boardFull: true, tokens, fmt: eur }).includes('The board holds 6 insights') && insightCardHtml(owes, { id: '1-0', done: 'Pinned to the board.', pinned: true, tokens, fmt: eur }).includes('data-board="show"') && !insightCardHtml({ ...owes, title: hostile }, { id: '1-0', tokens, fmt: eur }).includes('<img'));
  const board = boardCardHtml({ id: 'wabc', ...owes.spec }, owes, { isNew: true, tokens, fmt: eur });
  expect('board card: remove and CSV buttons carry the widget id, new cards animate in, the id is escaped', board.includes('data-w="wabc"') && board.includes('data-w-remove="wabc"') && board.includes('data-w-csv="wabc"') && board.includes('board-card is-new') && !boardCardHtml({ id: '"><img src=x>', ...owes.spec }, owes, { tokens, fmt: eur }).includes('<img'));
  expect('widget body: a figure has no chart slot, a table shows its rows, an empty period says so', !widgetBodyHtml(D({ type: 'number', metric: 'count', groupBy: 'none', period: 'all' }), { chartKey: 'k', tokens, fmt: eur }).includes('data-chart') && widgetBodyHtml(D({ type: 'table', metric: 'vat', groupBy: 'vatRate', period: '2026-Q3' }), { chartKey: 'k', tokens, fmt: eur }).includes('insight-table') && widgetBodyHtml(widgetData([], { type: 'bar', metric: 'invoiced', groupBy: 'client', period: 'all' }, today), { chartKey: 'k', tokens, fmt: eur }).includes('Nothing to show'));

  // The hub, with a stand-in for the library and for the DOM: one live chart per card, rebuilt only when its data changes.
  const made = [];
  let destroyed = 0;
  const fakeAg = { AgCharts: { create: (opts) => { made.push(opts); return { destroy() { destroyed++; } }; } } };
  const slot = () => ({ childNodes: ['fallback table'], replaceChildren(...nodes) { this.childNodes = nodes; } });
  globalThis.document = { createElement: () => ({ className: '', remove() {} }) };
  const hub = createChartHub(fakeAg, { tokens, fmt: eur });
  const [s1, s2] = [slot(), slot()];
  const mounted = [hub.mount(s1, 'board:a', owes), hub.mount(s2, 'board:a', owes)];
  expect('chart hub: mounting the same data again reuses the live chart (it is moved into the new slot, not redrawn)', mounted.every(Boolean) && made.length === 1 && s2.childNodes[0] === s1.childNodes[0] && hub.size === 1);
  hub.mount(slot(), 'board:a', D({ type: 'donut', metric: 'outstanding', groupBy: 'client', period: 'all', status: 'OVERDUE' }));
  expect('chart hub: changed data destroys the old chart and draws a new one; pruning removes the cards that are gone', made.length === 2 && destroyed === 1 && (hub.mount(slot(), 'chat:x', owes), hub.size === 2) && (hub.prune('board:', new Set()), hub.size === 1 && destroyed === 2) && (hub.destroyAll(), hub.size === 0 && destroyed === 3));
  const brokenAg = { AgCharts: { create: () => { throw new Error('boom'); } } };
  const stuck = slot();
  expect('chart hub: if the library throws, the table that is already in the card stays and nothing is thrown', createChartHub(brokenAg, { tokens, fmt: eur }).mount(stuck, 'k', owes) === false && stuck.childNodes[0] === 'fallback table');
  delete globalThis.document;
}

// 10. The agent's own sentence (B3): when the model answers with proposals and no text, the browser writes it from the
// proposals and the ledger, so every figure in it is the engine's.
{
  const today = '2026-10-06';
  const said = (actions, lang = 'en') => flat(synthReply(actions, { records: sample, today, lang }));
  const acme = { type: 'propose_invoice', args: { recipient: { name: 'Acme Studio SL', nif: 'B12345674', email: 'billing@acme.example' }, lines: [{ description: 'Consulting', qty: 3, price: 60, vat: 21 }] } };
  const plan = [{ type: 'propose_reminder', args: { number: sample[3].number } }, { type: 'propose_collect', args: { number: sample[4].number } }, { type: 'propose_collect', args: { number: sample[7].number } }, { type: 'show_vat_return', args: {} }];
  const owesSpec = { type: 'propose_widget', args: { title: 'Who still owes what', type: 'donut', metric: 'outstanding', groupBy: 'client', period: 'all' } };
  expect('say: an invoice draft names the client, the engine total and the line ("Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)")', said([acme]) === 'Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)');
  expect('say: a plan counts its steps ("Plan to close the quarter: 1 reminder, 2 collections with PayPal and your VAT draft.")', said(plan) === 'Plan to close the quarter: 1 reminder, 2 collections with PayPal and your VAT draft.');
  expect('say: who owes you money comes from widgetData ("Here is who owes you money: 3 open invoices, 2006,40 €")', said([owesSpec]) === 'Here is who owes you money: 3 open invoices, 2006,40 €');
  expect('say: the total is the engine\'s, whatever the model wrote (a made-up total in the arguments changes nothing)', said([{ ...acme, args: { ...acme.args, total: 9999, lines: [{ description: 'x', qty: '3', price: '60', vat: 21 }] } }]) === 'Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)');
  expect('say: two lines, an exempt line, fractional quantities and a bad VAT rate are described honestly', said([{ ...acme, args: { ...acme.args, lines: [acme.args.lines[0], { description: 'Book', qty: 1, price: 10, vat: 10 }] } }]) === 'Invoice draft for Acme Studio SL: 228,80 € (2 lines + VAT)' && said([{ ...acme, args: { ...acme.args, lines: [{ description: 'Course', qty: 2.5, price: 40, vat: 0 }] } }]) === 'Invoice draft for Acme Studio SL: 100,00 € (2,5 × 40,00 €, VAT exempt)' && said([{ ...acme, args: { ...acme.args, lines: [{ description: 'x', qty: 1, price: 100, vat: 7 }] } }]) === 'Invoice draft for Acme Studio SL: 121,00 € (1 × 100,00 € + VAT)');
  expect('say: one proposal per invoice action, with the client and amount from the ledger', said([{ type: 'propose_reminder', args: { number: sample[3].number } }]) === `Payment reminder for Hotel Mirador SL (${sample[3].number}, 990,00 €).` && said([{ type: 'propose_collect', args: { number: sample[4].number } }]) === `Send ${sample[4].number} (Marta Pardo, 726,00 €) with PayPal so the client can pay online.` && said([{ type: 'propose_mark_paid', args: { number: sample[3].number, method: 'CASH' } }]) === `Record the cash payment of ${sample[3].number} (Hotel Mirador SL, 990,00 €).` && said([{ type: 'propose_cancel', args: { number: sample[3].number } }]) === `Cancel ${sample[3].number} (Hotel Mirador SL, 990,00 €) with a chained cancellation record.` && said([{ type: 'show_vat_return', args: {} }]) === 'Your Modelo 303 draft for 2026-Q3.' && said([{ type: 'show_vat_return', args: { quarter: '2026-Q2' } }]) === 'Your Modelo 303 draft for 2026-Q2.');
  expect('say: other insights say what they show ("Revenue by client: 1 invoice, 290,40 €") and a count is just its number', said([{ type: 'propose_widget', args: { title: 'Revenue by client', type: 'bar', metric: 'invoiced', groupBy: 'client', period: 'quarter' } }]) === 'Revenue by client: 1 invoice, 290,40 €' && said([{ type: 'propose_widget', args: { title: 'Invoices by month', type: 'bar', metric: 'count', groupBy: 'month', period: 'all' } }]) === 'Invoices by month: 6');
  expect('say: plans of other shapes are counted too (reminders only, an invoice and a reminder, insights and payments)', said([plan[0], plan[0]]) === 'Plan: 2 reminders.' && said([acme, plan[0]]) === 'Plan: 1 reminder and 1 invoice draft.' && said([owesSpec, { type: 'propose_mark_paid', args: { number: sample[3].number } }, { type: 'propose_cancel', args: { number: sample[4].number } }]) === 'Plan: 1 payment to record, 1 cancellation and 1 insight.');
  expect('say in Spanish: the same three sentences, with the engine figures', said([acme], 'es') === 'Borrador de factura para Acme Studio SL: 217,80 € (3 × 60,00 € + IVA)' && said(plan, 'es') === 'Plan para cerrar el trimestre: 1 recordatorio, 2 cobros con PayPal y tu borrador del IVA.' && said([owesSpec], 'es') === 'Esto es lo que te deben: 3 facturas pendientes, 2006,40 €' && said([{ type: 'show_vat_return', args: {} }], 'es') === 'Tu borrador del Modelo 303 de 2026-Q3.');
  expect('say: nothing to say, or nothing it knows, falls back to the generic line, and the sentence is plain text that md() escapes when it is shown', synthReply([], { records: sample, today }) === '' && said([{ type: 'something_new', args: {} }]) === 'Here is my proposal. Review it and confirm.' && !md(synthReply([{ ...acme, args: { ...acme.args, recipient: { name: hostile, nif: '', email: '' } } }], { records: sample, today })).includes('<img'));
  const wild = normalizeProposal({ recipient: { name: 'x'.repeat(300), nif: ' b-1234 5674 ', email: 'a@b.example' }, lines: [{ description: '', qty: -3, price: 'abc', vat: 7 }], due_days: 400 });
  expect('proposals are normalized before anything is shown or said: bounded text, a clean NIF, quantities and prices above zero, a Spanish VAT rate, due days 0 to 90', wild.recipient.name.length === 120 && wild.recipient.nif === 'B12345674' && wild.lines[0].description === 'Service' && wild.lines[0].qty === 0.01 && wild.lines[0].price === 0.01 && wild.lines[0].vat === 21 && wild.dueDays === 90 && normalizeProposal({}).lines.length === 1 && normalizeProposal({}).dueDays === 15);
  expect('say: the language follows the person ("Factura a Lumen…", "¿Quién me debe dinero?" and "Cierra el trimestre" are Spanish, the rest English)', ['Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA', '¿Quién me debe dinero?', 'Cierra el trimestre', 'Ingresos por cliente este trimestre'].every((t) => detectLang(t) === 'es') && ['Invoice Acme Studio SL for 3 hours', 'Close my quarter', 'Revenue by client this quarter', 'Who owes me money?', '', undefined].every((t) => detectLang(t) === 'en'));
}

// 11. The terminal of "Cuadra for AI agents" (B4): the recorded MCP session, written for reading and replayed line by line.
{
  const transcript = JSON.parse(read('public/mcp-transcript.json'));
  const lines = transcriptLines(transcript);
  const stripSpans = (html) => html.replace(/<span class="[a-z -]+">/g, '').replace(/<\/span>/g, '');
  expect('terminal: long strings and lists are cut with an ellipsis, small objects stay on one line, deep ones fold', prettyJson({ s: 'x'.repeat(80), list: [1, 2, 3, 4, 5], small: { a: 1, b: 'two' }, deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } }, { depth: 3, str: 20 }).includes(`"s": "${'x'.repeat(19)}…"`) && prettyJson({ list: [1, 2, 3, 4, 5] }) === '{ "list": [1, 2, …+3 more] }' && prettyJson({ a: 1, b: 'two' }) === '{ "a": 1, "b": "two" }' && prettyJson({ a: { b: { c: 1 } } }, { depth: 2 }) === '{ "a": { "b": {…} } }' && prettyJson(null) === 'null' && prettyJson([]) === '[]');
  expect('terminal: a tool list shows the tool names, a tool result drops the text copy of its own structuredContent, nothing is mutated', (() => {
    const list = { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'draft_invoice', inputSchema: { type: 'object' } }, { name: 'issue_invoice', inputSchema: {} }] } };
    const call = { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true }, isError: false } };
    const before = JSON.stringify([list, call]);
    const shown = [displayMsg(list), displayMsg(call), displayMsg({ jsonrpc: '2.0', id: 9, error: { code: -32601, message: 'x' } })];
    return JSON.stringify(shown[0].result.tools) === '["draft_invoice","issue_invoice"]' && !('content' in shown[1].result) && shown[1].result.structuredContent.ok === true && shown[2].error.code === -32601 && JSON.stringify([list, call]) === before;
  })());
  expect('terminal: JSON is coloured by token (keys, strings, numbers, literals) and every character is escaped', jsonHtml('"a": "b", "n": 1.5, "t": true, "z": null').includes('<span class="t-key">&quot;a&quot;</span>:') && jsonHtml('"s": "x"').includes('<span class="t-str">&quot;x&quot;</span>') && jsonHtml('"n": -3').includes('<span class="t-num">-3</span>') && jsonHtml('"t": false').includes('<span class="t-lit">false</span>') && !jsonHtml(`"k": "${hostile}"`).includes('<img') && jsonHtml(`"k": "${hostile}"`).includes('&lt;img'));
  expect('terminal: the transcript becomes a command, six numbered notes, seven messages out, six in and a closing line', lines[0].kind === 'cmd' && lines[0].text === '$ node mcp/server.js' && lines.filter((l) => l.kind === 'note').map((l) => l.text.slice(0, 4)).join() === '# 1 ,# 2 ,# 3 ,# 4 ,# 5 ,# 6 ' && lines.filter((l) => l.kind === 'out').length === 7 && lines.filter((l) => l.kind === 'in').length === 6 && lines.at(-1).kind === 'end' && /13 JSON-RPC messages, 6 steps/.test(lines.at(-1).text));
  expect('terminal: the lines tell the story with the server\'s own values (draft 217.80, issued and sent with a mock PayPal id, chain ok) and nothing is escaped JSON-in-JSON', (() => { const text = lines.map((l) => l.text).join('\n'); return text.includes('"name": "draft_invoice"') && text.includes('"total": "217.80"') && text.includes('"collect_with_paypal": true') && /"id": "INV2-MOCK-0001"/.test(text) && text.includes('"status": "SENT"') && /"ok": true/.test(text) && !text.includes('\\n') && !text.includes('\\"') && lines.length < 260; })());
  expect('terminal: every line is safe HTML (only our spans), and no line is absurdly long', lines.every((l) => !stripSpans(l.html).includes('<') && l.text.length <= 140));
  expect('terminal: every line knows its indentation, so a line that wraps on a phone continues under it (hanging indent)', lines[0].ind === 0 && lines.filter((l) => l.kind === 'note').every((l) => l.ind === 0) && lines.filter((l) => l.kind === 'out' || l.kind === 'in').every((l) => l.ind === 2) && lines.find((l) => l.text === '    "jsonrpc": "2.0",').ind === 4 && lines.find((l) => /^ {10}"name": "Acme Studio SL",$/.test(l.text)).ind === 10);
  const box = { html: '', scrollTop: 0, replaceChildren() { this.html = ''; }, insertAdjacentHTML(where, html) { this.html += html; } };
  const instant = playTranscript(box, lines, { reduced: true });
  await instant.done;
  expect('terminal replay: with reduced motion the whole session is there at once (no timers)', (box.innerHTML || '').split('class="term-line').length - 1 === lines.length);
  const slow = { html: '', scrollTop: 0, replaceChildren() { this.html = ''; }, insertAdjacentHTML(where, html) { this.html += html; } };
  const run = playTranscript(slow, lines, { pauses: { note: 1, msg: 1, line: 1 } });
  await run.done;
  const stopped = { html: '', scrollTop: 0, replaceChildren() { this.html = ''; }, insertAdjacentHTML(where, html) { this.html += html; } };
  const early = playTranscript(stopped, lines, { pauses: { note: 4, msg: 4, line: 4 } });
  await new Promise((r) => setTimeout(r, 30));
  early.stop();
  await early.done;
  const kept = stopped.html.split('class="term-line').length - 1;
  expect('terminal replay: lines arrive in order, one after the other, and Replay can stop a run half way', slow.html.split('class="term-line').length - 1 === lines.length && slow.html.indexOf('t-prompt') < slow.html.indexOf('term-note') && kept > 0 && kept < lines.length && (await (async () => { const before = stopped.html.length; await new Promise((r) => setTimeout(r, 40)); return stopped.html.length === before; })()));
}

// Corrective invoice (B5): chain block, document, verification link, grid row, proposal paper and the agent's sentence
{
  const target = sample.find((r) => r.kind !== 'anulacion' && r.paidAt);
  const r1 = await buildRectificativa({ issuer, target, number: 'SMP-0009', date: '2026-10-06', lines: [{ description: 'Brand strategy workshop', qty: 1, price: 1000, vat: 21 }], reason: 'Wrong price', prev: sample.at(-1), generatedAt: '2026-10-06T10:00:00+02:00' });
  const recs = [...sample, r1];
  const verdict = await verifyChain(recs);
  const blocks = chainBlocks(recs, verdict);
  const b = blocks.at(-1);
  expect('chain: the R1 is its own block that says "R1 · rectifies <number>" and keeps its amount', verdict.ok && b.kind === 'rectificativa' && b.rectifies === target.number && b.amount === r1.total && b.tip.includes(`R1 · rectifies ${target.number}`) && /R1 corrective invoice, rectifies/.test(chainTrackHtml([b])) && chainTrackHtml([b]).includes(`rectifies ${target.number}`));
  const doc = renderDocument(r1, { qr: () => '' });
  expect('document: "Factura rectificativa / Corrective invoice" with the reference to the original and its amounts', doc.includes('Factura rectificativa / Corrective invoice') && doc.includes(`>${target.number}<`) && doc.includes('R1, sustitutiva') && doc.includes('Wrong price') && !renderDocument(target, { qr: () => '' }).includes('rectificativa'));
  const back = await decodeRecord(await encodeRecord(r1));
  expect('link: a corrective invoice round-trips, keeps its reference and verifies on the verify page', back.type === 'R1' && back.rectifies.number === target.number && back.rectified.base === r1.rectified.base && (await verifyRecord(back)).ok && renderDocument(back, { qr: () => '' }).includes('Corrective invoice'));
  expect('link: a reference to a rectified invoice with a bad shape is rejected', await decodeRecord(await encodeRecord({ ...r1, rectifies: { ...r1.rectifies, date: 'x' } })).then(() => false, (e) => e instanceof ShareError) && await decodeRecord(await encodeRecord({ ...target, rectifies: r1.rectifies })).then(() => false, (e) => e instanceof ShareError));
  const rows = ledgerRows(recs, { today: '2026-10-06' });
  expect('grid: the original is RECTIFIED (out of the totals), the R1 row names it and the open count ignores it', rows.find((r) => r.number === target.number).status === 'RECTIFIED' && rows.find((r) => r.number === target.number).open === false && rows[0].rectifies === target.number && numberCellHtml(rows[0]).includes('R1 · rectifies') && gridTotals(rows).note === '1 voided left out' || gridTotals(rows).note.includes('voided'));
  const paper = proposalPaperHtml({ recipient: target.recipient, lines: r1.lines, description: '', dueDays: 0 }, { issuer, today: '2026-10-06', rectifies: { number: target.number, total: target.total, reason: 'Wrong price' } });
  expect('proposal paper: corrective title, the original and the difference computed by the engine', paper.includes('Factura rectificativa') && paper.includes(target.number) && paper.includes('difference'));
  const fix = normalizeRectify({ number: ' smp-0001 ', reason: 'x'.repeat(300), lines: [{ description: 'A', qty: -1, price: 0, vat: 7 }] });
  expect('normalizeRectify cleans what the model sends: number upper-cased, reason bounded, lines positive with a Spanish VAT rate', fix.number === 'SMP-0001' && fix.reason.length === 200 && fix.lines[0].qty > 0 && fix.lines[0].price > 0 && fix.lines[0].vat === 21);
  const said = synthReply([{ type: 'propose_rectify', args: { number: target.number, reason: 'x', lines: [{ description: 'A', qty: 1, price: 1000, vat: 21 }] } }], { records: sample, today: '2026-10-06' });
  expect('the sentence for a corrective invoice uses the engine totals (old and new)', said.includes(target.number) && said.includes(eur(target.total)) && said.includes(eur(1210)));
  expect('Activity knows the rectified event', EVENTS.rectified === 'Corrective invoice issued');
}

console.log(failed ? `${failed} UI check(s) failed` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
