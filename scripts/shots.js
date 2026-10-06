// Visual check of the whole product, not part of npm test: starts the app with MOCK=1 on port 3080 (or reuses a mock
// server already there), plays the demo flow and screenshots the key states at 1280x800 and 390x844 into
// hackathons/paypal/galeria/ronda2 (outside this repo; pass another folder as the first argument).
// Besides the pictures it asserts what the eye should not have to find: no console errors, no 4xx/5xx, no horizontal
// scroll of the page, the activity log of the #selftest flow, the print rules of the verification page, the tour
// undoing its tamper test, and the behaviours that existed before round 2 (ledger buttons, detail dialog, exports...). It borrows the Playwright of the sibling ops/video folder, like scripts/social-card.js.
// Usage: node scripts/shots.js [outDir]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.argv[2] || here('../../hackathons/paypal/galeria/ronda2/');
const PORT = 3080;
const BASE = `http://localhost:${PORT}`;
if (!existsSync(here('../../ops/video/node_modules/playwright-core'))) {
  console.log('Playwright was not found at ../ops/video/node_modules/playwright-core. Install it there to take the screenshots.');
  process.exit(1);
}
const { chromium } = createRequire(here('../../ops/video/package.json'))('playwright-core');
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (label, ok) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) failed++; };
const issues = [];
const watch = (page, label) => {
  page.on('console', (m) => { if (m.type() === 'error') issues.push(`${label}: console error: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`${label}: page error: ${String(e).slice(0, 160)}`));
  page.on('response', (r) => { if (r.status() >= 400) issues.push(`${label}: HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
};

async function health() {
  try {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
let server = null;
const running = await health();
if (running && running.mode !== 'mock') {
  console.log(`Something that is not a MOCK server is already listening on port ${PORT}. Stop it first.`);
  process.exit(1);
}
if (!running) {
  server = spawn(process.execPath, ['dev-server.js'], { cwd: here('../'), env: { ...process.env, MOCK: '1', PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await health()); i++) await new Promise((r) => setTimeout(r, 200));
  if (!(await health())) {
    server.kill();
    console.log('The dev server did not start.');
    process.exit(1);
  }
}

const VIEWS = [
  { name: '1280', mobile: false, opts: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  { name: '390', mobile: true, opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
// Every context calls the API as its own client address (TEST-NET-3), so the per-IP rate limit of the server, which is
// meant for real visitors, does not stop a second run of this script within ten minutes.
let nextClient = 1 + Math.floor(Math.random() * 200);
async function newContext(opts) {
  const ctx = await browser.newContext(opts);
  const ip = `203.0.113.${nextClient++ % 250 + 1}`;
  await ctx.route(`${BASE}/api/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
  return ctx;
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);
const say = async (page, text) => {
  await page.fill('#msg', text);
  await page.press('#msg', 'Enter');
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('.thinking'), null, { timeout: 15000 });
  await settle(page, 600);
};
// Wait until the toast of the previous step is gone, so it does not end up in the next picture.
const quiet = (page) => page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {});
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

try {
  for (const view of VIEWS) {
    console.log(`\n== ${view.name} px ==`);
    const ctx = await newContext({ ...view.opts, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
    const page = await ctx.newPage();
    watch(page, view.name);
    const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}-${view.name}.png`, ...opts }); };
    const openAgent = async () => { if (view.mobile) { await page.click('#openAgent'); await settle(page, 450); } };
    const closeAgent = async () => { if (view.mobile && (await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.click('#sheetClose'); await settle(page, 350); } };

    // 1. Dashboard: the sample quarter, a verified chain, the agent waiting.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 1800);
    check(`[${view.name}] dashboard: chain verified with 8 blocks and no horizontal scroll`, (await page.locator('.chain-block[data-i]').count()) === 8 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && (await overflow(page)) <= 0);
    await shot('01-dashboard');
    await shot('01-dashboard-full', { fullPage: true });

    // 2. Invoice proposal as a paper document, with the engine checks under it.
    await openAgent();
    await say(page, 'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60');
    await page.waitForSelector('.proposal');
    if (!view.mobile) await page.evaluate(() => { const c = document.querySelector('#chat'); c.scrollTop = c.scrollHeight; });
    await settle(page, 400);
    const checks = await page.locator('.checks li').allInnerTexts();
    check(`[${view.name}] proposal: paper document with the six engine checks`, (await page.locator('.proposal .paper').count()) === 1 && checks.length === 6 && /Client matched from ledger: Acme Studio SL/.test(checks[0]) && /Totals computed by the engine: 180,00 \+ 37,80 = 217,80/.test(checks[3].replace(/ /g, ' ')));
    await shot('02-proposal-checks');
    if (!view.mobile) {
      // The same proposal on a taller window, where the whole paper and every check fit in the agent column.
      await page.setViewportSize({ width: 1280, height: 1000 });
      await settle(page, 500);
      await page.evaluate(() => { const c = document.querySelector('#chat'); c.scrollTop += document.querySelector('.proposal').getBoundingClientRect().top - c.getBoundingClientRect().top - 6; });
      await page.screenshot({ path: `${OUT}/02c-proposal-full-1280x1000.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
      await settle(page, 400);
    }
    await page.click('[data-act="issue-send"]');
    await settle(page, 600);
    check(`[${view.name}] approving closes the sheet on a phone and the block enters the chain`, (await page.locator('.chain-block.is-new').count()) === 1 && (!view.mobile || !(await page.evaluate(() => document.body.classList.contains('sheet-open')))));
    await shot('02b-approved-moment');
    await settle(page, 1500);

    // 3. A plan: chase (approve the first step), then "Close my quarter".
    await openAgent();
    await say(page, 'Chase every overdue invoice');
    await page.locator('#chat [data-act="collect"]').first().click();
    await settle(page, 800);
    await say(page, 'Close my quarter');
    check(`[${view.name}] plan: "Plan · 4 steps" with a reminder, two collections and the VAT draft`, /Plan · 4 steps/.test(await page.locator('.plan').last().innerText()) && (await page.locator('.plan').last().locator('.plan-step').count()) === 4);
    await quiet(page);
    await shot('03-plan');
    await page.locator('[data-plan-all]').last().click();
    await settle(page, 2200);
    check(`[${view.name}] plan: approve all runs the reminders and collections only ("3 of 4 done")`, /3 of 4 done/.test(await page.locator('.plan').last().innerText()));
    await shot('03b-plan-approved');
    await page.locator('#chat [data-act="open-vat"]').last().click();
    await settle(page, 900);
    await closeAgent();

    // 4. Tamper test: red record, grey blocks after it.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#tamper');
    await settle(page, 1900);
    check(`[${view.name}] tamper: one broken block, the ones after it unverifiable, the ledger marks the record`, (await page.locator('.chain-block.broken').count()) === 1 && (await page.locator('.chain-block.unverifiable').count()) >= 1 && /Chain broken at/.test(await page.locator('#chainStatus').innerText()) && (await page.locator('#rows .row-bad').count()) === 1);
    await quiet(page);
    await shot('04-tamper');

    // 5. Verification page for the broken record (✗), then for a sound one (✓), print rules on the sound one.
    await page.locator('#chainTrack .chain-block.broken').click();
    await settle(page, 700);
    const [bad] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-dl="print"]')]);
    watch(bad, `${view.name} verify (altered)`);
    await bad.waitForLoadState('networkidle');
    await settle(bad, 900);
    check(`[${view.name}] verify.html shows ✗ Altered for the tampered record`, /✗/.test(await bad.locator('#verdict').innerText()) && /Altered: the content does not match its hash/.test(await bad.locator('#verdict').innerText()));
    await bad.screenshot({ path: `${OUT}/05b-verify-altered-${view.name}.png`, fullPage: true });
    await bad.close();
    await page.keyboard.press('Escape');
    await page.click('#tamper');
    await settle(page, 1700);
    check(`[${view.name}] undoing the tamper test heals the chain`, (await page.locator('.chain-block.broken').count()) === 0 && /Chain verified/.test(await page.locator('#chainStatus').innerText()));
    await page.locator('#rows .row').first().locator('button[data-do="view"]').click();
    await settle(page, 700);
    const [good] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-dl="print"]')]);
    watch(good, `${view.name} verify`);
    await good.waitForLoadState('networkidle');
    await settle(good, 900);
    const verdict = await good.locator('#verdict').innerText();
    check(`[${view.name}] verify.html shows ✓ This document matches its hash, with both QR codes for an invoice sent with PayPal`, /✓/.test(verdict) && /This document matches its hash/.test(verdict) && (await good.locator('.doc-qr').count()) === 2 && /Pay with PayPal/.test(await good.locator('.doc-foot').innerText()));
    await good.screenshot({ path: `${OUT}/05-verify-${view.name}.png`, fullPage: true });
    check(`[${view.name}] verify.html has no horizontal scroll and never loaded a server resource besides its own files`, (await overflow(good)) <= 0);
    await good.emulateMedia({ media: 'print' });
    const visibleExtras = await good.evaluate(() => [...document.body.children, ...document.querySelector('main').children].filter((el) => el.tagName !== 'MAIN' && el.id !== 'paper' && getComputedStyle(el).display !== 'none').map((el) => `${el.tagName}#${el.id}`));
    check(`[${view.name}] print: only the document is left on the page`, visibleExtras.length === 0 && (await good.locator('#paper').isVisible()));
    await good.screenshot({ path: `${OUT}/05c-verify-print-${view.name}.png`, fullPage: true });
    await good.close();
    await page.keyboard.press('Escape');
    check(`[${view.name}] no horizontal scroll at the end of the flow`, (await overflow(page)) <= 0);
    await ctx.close();
  }

  // 6. First-visit tour, step 3: the chain breaks under the caption, and is healed when the tour ends.
  for (const view of VIEWS) {
    const ctx = await newContext(view.opts);
    const page = await ctx.newPage();
    watch(page, `${view.name} tour`);
    await page.goto(`${BASE}/?tour=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tour:not([hidden])');
    for (const n of [1, 2]) {
      await page.waitForFunction((s) => document.querySelector('.tour-k')?.textContent.startsWith(`Step ${s}`), n);
      await settle(page, 450);
      await page.click('.tour-next');
    }
    await page.waitForFunction(() => document.querySelector('.tour-k')?.textContent.startsWith('Step 3'));
    await settle(page, 1800);
    check(`[${view.name}] tour step 3: the chain is broken on screen under the caption`, (await page.locator('.chain-block.broken').count()) === 1 && /breaks at the record/.test(await page.locator('.tour-t').innerText()));
    await page.screenshot({ path: `${OUT}/06-tour-step3-${view.name}.png` });
    await page.click('.tour-next');
    await settle(page, 700);
    await page.click('.tour-next');
    await settle(page, 900);
    check(`[${view.name}] tour end: the tamper test is undone and the tour will not repeat`, (await page.locator('.chain-block.broken').count()) === 0 && (await page.locator('#tour').isHidden()) && (await page.evaluate(() => localStorage.getItem('cuadra-tour-v1'))) === '1');
    await ctx.close();
  }

  // 7. The extended #selftest flow: every action it plays must be in the Activity log.
  {
    const ctx = await newContext(VIEWS[0].opts);
    const page = await ctx.newPage();
    watch(page, 'selftest');
    await page.goto(`${BASE}/#selftest`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.dataset.selftest === 'done', null, { timeout: 60000 });
    await settle(page, 1800);
    const events = await page.evaluate(() => [...new Set(JSON.parse(localStorage.getItem('cuadra-demo-v1')).activity.map((e) => e.event))]);
    const wanted = ['sample', 'proposal', 'approved', 'issued', 'sent', 'reminder', 'tamper_on', 'tamper_off'];
    check(`#selftest: the Activity log has every step of the flow (${wanted.join(', ')})`, wanted.every((e) => events.includes(e)));
    check('#selftest: the Activity panel lists them and the chain ends verified', (await page.locator('#activityList .activity-row').count()) >= 8 && /Chain verified/.test(await page.locator('#chainStatus').innerText()));
    await page.screenshot({ path: `${OUT}/07-selftest-1280.png` });
    await page.screenshot({ path: `${OUT}/07-selftest-full-1280.png`, fullPage: true });
    await ctx.close();
  }

  // 8. Behaviours that existed before round 2 and must keep working: ledger buttons, the detail dialog, exports, VAT,
  //    reload, the PayPal subscription (mock) and starting empty.
  {
    const ctx = await newContext({ ...VIEWS[0].opts, acceptDownloads: true });
    await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
    const page = await ctx.newPage();
    watch(page, 'flows');
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 1500);
    const hotel = () => page.locator('#rows .row', { hasText: 'Hotel Mirador' });
    await hotel().locator('[data-do="collect"]').click();
    await settle(page);
    check('flows: Collect in the ledger puts the invoice on PayPal (Remind and refresh appear)', (await hotel().locator('[data-do="remind"]').count()) === 1 && (await hotel().locator('[data-do="refresh"]').count()) === 1 && /PayPal/.test(await hotel().innerText()));
    await hotel().locator('[data-do="remind"]').click();
    await settle(page);
    check('flows: Remind reports through the toast and the Activity log', /Reminder sent/.test(await page.locator('#toast').innerText()) && /Reminder sent/.test(await page.locator('#activityList').innerText()));
    await page.locator('#rows .row', { hasText: 'Marta Pardo' }).filter({ hasText: 'OVERDUE' }).locator('[data-do="view"]').click();
    await settle(page);
    await page.selectOption('#payMethod', 'CASH');
    await page.click('[data-dl="paid"]');
    await settle(page, 900);
    check('flows: Mark paid in the detail records the payment', (await page.locator('#rows .row', { hasText: 'Marta Pardo' }).filter({ hasText: 'PAID' }).count()) >= 1 && /Payment recorded/.test(await page.locator('#activityList').innerText()));
    const blocks = await page.locator('.chain-block[data-i]').count();
    await hotel().locator('[data-do="view"]').click();
    await settle(page);
    await page.fill('#cancelReason', 'Wrong client');
    await page.click('[data-dl="cancel"]');
    await settle(page, 1500);
    check('flows: Cancel in the detail appends a cancellation block and the chain stays verified', (await page.locator('.chain-block[data-i]').count()) === blocks + 1 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && /Cancelled/.test(await page.locator('#activityList').innerText()));
    const exported = async (id) => { await page.click('#menuBtn'); const [d] = await Promise.all([page.waitForEvent('download'), page.click(id)]); return d.suggestedFilename(); };
    check('flows: the menu exports XML, CSV and the activity JSON', (await exported('#xml')) === 'cuadra-verifactu-records.xml' && (await exported('#csv')) === 'cuadra-libro-registro.csv' && (await exported('#exportActivity')) === 'cuadra-activity.json');
    const quarter = await page.locator('#vatQ').innerText();
    await page.click('#vatPrev');
    const moved = (await page.locator('#vatQ').innerText()) !== quarter;
    await page.click('#vatNext');
    check('flows: the VAT draft moves to the previous quarter and back', moved && (await page.locator('#vatQ').innerText()) === quarter);
    await page.fill('#msg', 'Invoice Lumen Foods SL for 2 hours at 100');
    await page.press('#msg', 'Enter');
    await page.waitForSelector('.proposal');
    await settle(page, 600);
    check('flows: a new proposal reuses the client in the ledger (Lumen email on the paper)', /pagos@lumen\.example/.test(await page.locator('.proposal .paper').last().innerText()));
    await page.locator('.proposal [data-act="discard"]').last().click();
    await settle(page);
    check('flows: Discard dismisses the proposal and logs it', /Dismissed/.test(await page.locator('#activityList').innerText()));
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page, 1500);
    check('flows: a reload restores the ledger, the chat and the activity', (await page.locator('.chain-block[data-i]').count()) === blocks + 1 && (await page.locator('.proposal').count()) >= 1 && (await page.locator('#activityList .activity-row').count()) >= 5);
    await page.locator('[data-plan="pro"]').click();
    await page.waitForURL(/subscription=done/);
    await settle(page, 1500);
    check('flows: the PayPal subscription (mock) turns the plan chip and the pricing button', /Autónomo plan/i.test(await page.locator('#plan').innerText()) && /Current plan/i.test(await page.locator('[data-plan="pro"]').innerText()));
    await page.click('#menuBtn');
    await page.click('#reset');
    await settle(page, 1200);
    check('flows: Start empty shows the guided empty state and a ghost block, and keeps the activity log and the plan', (await page.locator('.empty-actions button').count()) === 2 && (await page.locator('.block-ghost').count()) === 1 && /Ledger reset/.test(await page.locator('#activityList').innerText()) && /Autónomo plan/i.test(await page.locator('#plan').innerText()));
    await ctx.close();
  }
} finally {
  await browser.close();
  server?.kill();
}

check('zero console errors, page errors and 4xx/5xx responses in every page', issues.length === 0);
if (issues.length) console.log(issues.join('\n'));
const files = readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
console.log(`\n${files.length} screenshots in ${OUT}`);
for (const f of files) console.log(`  ${f}  ${Math.round(statSync(`${OUT}/${f}`).size / 1024)} KB`);
console.log(failed ? `${failed} visual check(s) failed` : 'all visual checks passed');
process.exit(failed ? 1 : 0);
