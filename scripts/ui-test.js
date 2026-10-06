// Offline tests for the client-side modules and the design system: no browser, no keys, no network.
import { readFileSync, readdirSync } from 'node:fs';
import { buildAlta, buildAnulacion, verifyChain } from '../public/js/verifactu.js';
import { buildSample } from '../public/js/ledger.js';
import { chainBlocks, chainStatus, chainTrackHtml, MAX_BLOCKS } from '../public/js/chain.js';
import { engineChecks, checksHtml, matchClient } from '../public/js/checks.js';
import { isPlan, planProgress, pendingLowRisk, hasHighRisk, planSummary, LOW_RISK } from '../public/js/plan.js';
import { proposalPaperHtml } from '../public/js/proposal.js';
import { reduceActivity, activityRows, activityHtml, relTime, MAX_ACTIVITY, EVENTS } from '../public/js/activity.js';
import { encodeRecord, decodeRecord, sanitizeRecord, shareable, shareUrl, fragmentValue, verifyRecord, ShareError, MAX_FRAGMENT } from '../public/js/share.js';
import { renderDocument } from '../public/js/document.js';
import { summary } from '../public/js/ledger.js';
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
  const dynamic = /^(plan|activity|check)-$|^check-(ok|warn|bad)$/; // plan-${state}, activity-${actor}, check-${level}
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

console.log(failed ? `${failed} UI check(s) failed` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
