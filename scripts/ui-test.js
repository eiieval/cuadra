// Offline tests for the client-side modules and the design system: no browser, no keys, no network.
import { readFileSync, readdirSync } from 'node:fs';

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

console.log(failed ? `${failed} UI check(s) failed` : 'all UI checks passed');
process.exit(failed ? 1 : 0);
