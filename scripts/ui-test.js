// Offline tests for the client-side modules and the design system: no browser, no keys, no network.
import { readFileSync, readdirSync } from 'node:fs';
import { buildAlta, buildAnulacion, verifyChain } from '../public/js/verifactu.js';
import { buildSample } from '../public/js/ledger.js';
import { chainBlocks, chainStatus, chainTrackHtml, MAX_BLOCKS } from '../public/js/chain.js';

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

console.log(failed ? `${failed} UI check(s) failed` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
