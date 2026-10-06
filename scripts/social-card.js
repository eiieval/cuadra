// Renders the brand images from their sources; not part of npm test and with no new dependency:
//   public/og.png        1200x630 link-preview card, from docs/og.html
//   public/icon-180.png  180x180 apple-touch-icon, from public/favicon.svg (full bleed: iOS rounds the corners itself)
// It borrows the Playwright that lives in the sibling ops/video folder of the monorepo (by absolute path) and stops
// with a message when it is not there. The card loads its fonts from Google Fonts while it is rendered.
// Usage: node scripts/social-card.js
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
if (!existsSync(here('../../ops/video/node_modules/playwright-core'))) {
  console.log('Playwright was not found at ../ops/video/node_modules/playwright-core. Install it there, or open docs/og.html at 1200x630 and save a screenshot to public/og.png by hand.');
  process.exit(1);
}
const { chromium } = createRequire(here('../../ops/video/package.json'))('playwright-core');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const card = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await card.goto(pathToFileURL(here('../docs/og.html')).href, { waitUntil: 'networkidle' });
  const fonts = await card.evaluate(async () => {
    await Promise.all(['400 20px Inter', '800 70px Inter', '600 15px "JetBrains Mono"', 'italic 36px "Instrument Serif"'].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    return ['800 70px Inter', '600 15px "JetBrains Mono"', 'italic 36px "Instrument Serif"'].every((f) => document.fonts.check(f));
  });
  if (!fonts) console.log('Warning: a font did not load (offline?), the card uses a system font instead.');
  await card.screenshot({ path: here('../public/og.png'), type: 'png' });

  // The favicon without rounded corners or hairline border, scaled to 180 px.
  const svg = readFileSync(here('../public/favicon.svg'), 'utf8')
    .replace(' rx="8"', ' rx="0"')
    .replace(/<rect x="\.5"[^>]*\/>/, '')
    .replace('<svg ', '<svg width="180" height="180" ');
  const icon = await (await browser.newContext({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 })).newPage();
  await icon.setContent(`<!doctype html><style>html,body{margin:0;background:#0a0d14}svg{display:block}</style>${svg}`);
  await icon.screenshot({ path: here('../public/icon-180.png'), type: 'png' });
} finally {
  await browser.close();
}
for (const f of ['og.png', 'icon-180.png']) console.log(`public/${f}: ${Math.round(statSync(here(`../public/${f}`)).size / 1024)} KB`);
