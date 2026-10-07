// Visual check of the whole product, not part of npm test: starts the app with MOCK=1 on port 3080 (or reuses a mock
// server already there), plays the demo flow and screenshots the key states at 1280x800 and 390x844 into
// hackathons/paypal/galeria/ronda2 (outside this repo; pass another folder as the first argument).
// Besides the pictures it asserts what the eye should not have to find: no console errors, no 4xx/5xx, no horizontal
// scroll of the page, the activity log of the #selftest flow, the print rules of the verification page, the tour
// undoing its tamper test, the tour timing, prefers-reduced-motion, and the behaviours that existed before round 2
// (ledger buttons, detail dialog, exports...). Round 2B adds the AG Grid ledger (status filter, totals row, CSV, keyboard,
// and the plain-table fallback when the file is blocked, slow, tampered or throws), the Insights board with AG Charts (pin,
// remove, limit of six, CSV, collapse, the table fallback), the agent's own sentences and the MCP terminal replay.
// It borrows the Playwright of the sibling ops/video folder, like scripts/social-card.js.
// Usage: node scripts/shots.js [outDir]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transcriptLines } from '../public/js/terminal.js';

const here =(p) => fileURLToPath(new URL(p, import.meta.url));
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
const watch = (page, label, expected = []) => {
  const expect_ = (text) => expected.some((re) => re.test(text));
  page.on('console', (m) => { if (m.type() === 'error' && !expect_(m.text())) issues.push(`${label}: console error: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => issues.push(`${label}: page error: ${String(e).slice(0, 160)}`));
  page.on('response', (r) => { if (r.status() >= 400) issues.push(`${label}: HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
};
// The ledger is an AG Grid from 768px up (loaded after the first render) and the HTML table below that.
const ROWS = (view) => (view.mobile ? '#rows .row' : '#ledgerGrid .ag-row:not(.ag-row-pinned)');
const ROW_BAD = (view) => (view.mobile ? '#rows .row-bad' : '#ledgerGrid .row-bad');
const gridReady = (page) => page.waitForSelector('#ledger[data-view="grid"] .ag-row', { timeout: 15000 });

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
const closeAgentSheet = async (page, view) => { if (view.mobile && (await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.click('#sheetClose'); await settle(page, 350); } };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

try {
  for (const view of VIEWS) {
    console.log(`\n== ${view.name} px ==`);
    const ctx = await newContext({ ...view.opts, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
    const page = await ctx.newPage();
    watch(page, view.name);
    let gridRequested = false;
    page.on('request', (r) => { if (/\/vendor\/ag-grid\//.test(r.url())) gridRequested = true; });
    const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}-${view.name}.png`, ...opts }); };
    const openAgent = async () => { if (view.mobile) { await page.click('#openAgent'); await settle(page, 450); } };
    const closeAgent = async () => { if (view.mobile && (await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.click('#sheetClose'); await settle(page, 350); } };

    // 1. Dashboard: the sample quarter, a verified chain, the agent waiting.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 1800);
    if (!view.mobile) await gridReady(page);
    check(`[${view.name}] dashboard: chain verified with 8 blocks and no horizontal scroll`, (await page.locator('.chain-block[data-i]').count()) === 8 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && (await overflow(page)) <= 0);
    await shot('01-dashboard');
    await shot('01-dashboard-full', { fullPage: true });

    // 1b. The ledger: an AG Grid from 768px up (a status filter and the totals row), the card table on a phone.
    if (view.mobile) {
      check(`[${view.name}] ledger: a phone keeps the card table and never downloads the grid`, !gridRequested && (await page.locator('#ledgerGrid').isHidden()) && (await page.locator('#ledgerTools').isHidden()) && (await page.locator('#rows .row').count()) === 8);
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = 'hidden'; });
      await page.locator('#ledger').screenshot({ path: `${OUT}/08-ledger-cards-390.png` });
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = ''; });
    } else {
      const chips = (await page.locator('#ledgerChips .chip').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ');
      const sum = async () => (await page.locator('#ledgerGrid .ag-row-pinned').innerText()).replace(/\s+/g, ' ');
      check('[1280] ledger: AG Grid with 8 rows (a cancellation among them), five status chips with counts and a totals row', (await page.locator(ROWS(view)).count()) === 8 && chips === 'All 7 | Open 3 | Overdue 2 | Paid 3 | Cancelled 1' && /Total · 6 invoices · 1 cancelled left out 4437,80 €/.test(await sum()) && (await page.locator('#ledgerGrid .row-anul').count()) === 1 && (await page.locator('#ledgerGrid .row-void').count()) >= 1);
      const heights = await page.evaluate(() => [...document.querySelectorAll('#ledgerGrid .ag-row:not(.ag-row-pinned)')].map((r) => Math.round(r.getBoundingClientRect().height)));
      const sideways = await page.evaluate(() => [...document.querySelectorAll('#ledgerGrid *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)).length);
      check('[1280] ledger: the cancellation row is shorter than an invoice row, and every column fits (no scroll inside the grid, none on the page)', Math.min(...heights) < Math.max(...heights) && sideways === 0 && (await overflow(page)) <= 0);
      await page.evaluate(() => document.querySelector('#ledger').scrollIntoView({ block: 'start' }));
      await settle(page, 500);
      await shot('08-ledger-grid');
      // The hash column shows 12 hex; the whole SHA-256 is in its tooltip.
      const hashCell = page.locator('#ledgerGrid .ag-row:not(.ag-row-pinned) .ag-cell[col-id="hash"]').first();
      await hashCell.hover();
      await settle(page, 900);
      const fullHash = await page.evaluate(() => JSON.parse(localStorage.getItem('cuadra-demo-v1')).records.at(-1).hash);
      const tip = await page.evaluate(() => [...document.querySelectorAll('[class*="ag-tooltip"]')].map((e) => e.textContent.trim()).find(Boolean) || '');
      check('[1280] ledger: the hash column shows 12 hex and its tooltip the full SHA-256', /^[0-9A-F]{12}$/.test((await hashCell.innerText()).trim()) && tip === fullHash);
      await shot('08c-ledger-grid-hash-tooltip');
      await page.mouse.move(5, 5);
      await page.waitForFunction(() => ![...document.querySelectorAll('[class*="ag-tooltip"]')].some((e) => e.textContent.trim()), null, { timeout: 4000 }).catch(() => {});
      await settle(page, 400);
      // A status filter: Open is everything still to collect (overdue included). The totals row follows the filter.
      await page.click('[data-chip="open"]');
      await settle(page, 500);
      check('[1280] ledger: the Open chip leaves the 3 invoices still to collect and the totals row adds them up (2006,40 €)', (await page.locator(ROWS(view)).count()) === 3 && /Total · 3 invoices 2006,40 €/.test(await sum()) && (await page.locator('[data-chip="open"]').getAttribute('aria-pressed')) === 'true' && /3 shown/.test(await page.locator('#ledgerCount').innerText()));
      await shot('08b-ledger-grid-filter');
      await page.click('[data-chip="all"]');
      await settle(page, 300);
    }

    // 1c. The Insights board: three cards between the KPIs and the ledger, each with an AG Charts chart.
    await page.waitForSelector('#boardGrid canvas', { timeout: 15000 });
    await settle(page, 600);
    const cards = await page.locator('#boardGrid .board-card').evaluateAll((els) => els.map((c) => ({ title: c.querySelector('.board-title').textContent.trim(), canvases: c.querySelectorAll('canvas').length, text: c.innerText.replace(/\s+/g, ' ') })));
    const boardText = cards.map((c) => c.text).join(' | ');
    check(`[${view.name}] insights: the board opens with three cards, a chart in each (invoiced vs collected by month, who still owes what, receivables aging)`, cards.map((c) => c.title).join(' | ') === 'Invoiced vs collected by month | Who still owes what | Receivables aging' && cards.every((c) => c.canvases === 1) && (await page.locator('#board').getAttribute('hidden')) === null);
    check(`[${view.name}] insights: every figure on the board is the engine's (4437,80 € invoiced, 2431,40 € collected, 2006,40 € outstanding over 3 open invoices, the donut legend adds up per client)`, /Invoiced 4437,80 € Collected 2431,40 €/.test(boardText) && /3 open invoices/.test(boardText) && /Hotel Mirador SL 990,00 € 49%/.test(boardText) && /Marta Pardo 726,00 € 36%/.test(boardText) && /Acme Studio SL 290,40 € 14%/.test(boardText) && (await page.locator('#boardGrid .board-card').nth(2).innerText()).includes('2006,40'));
    check(`[${view.name}] insights: the board sits between the KPIs and the ledger${view.mobile ? ' and is a row of cards you swipe through' : ''}`, await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return y('#kpis') < y('#board') && y('#board') < y('#ledger'); }) && (!view.mobile || (await page.evaluate(() => { const g = document.querySelector('#boardGrid'); return g.scrollWidth > g.clientWidth; }))) && (await overflow(page)) <= 0);
    await page.evaluate(() => document.querySelector('#board').scrollIntoView({ block: 'start' }));
    await settle(page, 500);
    if (view.mobile) {
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = 'hidden'; });
      await page.locator('#board').screenshot({ path: `${OUT}/10-insights-board-390.png` });
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = ''; });
    } else {
      await shot('10-insights-board');
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page, 300);

    // 2. Invoice proposal as a paper document, with the engine checks under it.
    await openAgent();
    await say(page, 'Invoice Acme Studio SL (B12345674) for 3 hours of consulting at €60');
    await page.waitForSelector('.proposal');
    if (!view.mobile) await page.evaluate(() => { const c = document.querySelector('#chat'); c.scrollTop = c.scrollHeight; });
    await settle(page, 400);
    const checks = await page.locator('.checks li').allInnerTexts();
    check(`[${view.name}] proposal: paper document with the six engine checks`, (await page.locator('.proposal .paper').count()) === 1 && checks.length === 6 && /Client matched from ledger: Acme Studio SL/.test(checks[0]) && /Totals computed by the engine: 180,00 \+ 37,80 = 217,80/.test(checks[3].replace(/ /g, ' ')));
    check(`[${view.name}] agent sentence: the model sent the draft without text, so the sentence is written from the proposal and the engine ("Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)")`, (await page.locator('.bubble-agent').last().innerText()).replace(/\s+/g, ' ').trim() === 'Invoice draft for Acme Studio SL: 217,80 € (3 × 60,00 € + VAT)');
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
    if (!view.mobile) check('[1280] approving lights the new row of the grid for a moment (row-flash) and the grid gains its row', (await page.locator('#ledgerGrid .row-flash').count()) === 1 && (await page.locator(ROWS(view)).count()) === 9);
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
    check(`[${view.name}] tamper: one broken block, the ones after it unverifiable, the ledger marks the record`, (await page.locator('.chain-block.broken').count()) === 1 && (await page.locator('.chain-block.unverifiable').count()) >= 1 && /Chain broken at/.test(await page.locator('#chainStatus').innerText()) && (await page.locator(ROW_BAD(view)).count()) === 1);
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
    await page.locator(ROWS(view)).first().locator('button[data-do="view"]').click();
    await settle(page, 700);
    const [good] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-dl="print"]')]);
    watch(good, `${view.name} verify`);
    await good.waitForLoadState('networkidle');
    await settle(good, 900);
    const verdict = await good.locator('#verdict').innerText();
    check(`[${view.name}] verify.html shows ✓ Consistent copy: the content matches its hash, with both QR codes for an invoice sent with PayPal`, /✓/.test(verdict) && /Consistent copy: the content matches its hash/.test(verdict) && (await good.locator('.doc-qr').count()) === 2 && /Pay with PayPal/.test(await good.locator('.doc-foot').innerText()));
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
    await gridReady(page);
    check('#selftest: it runs with the grid active (9 rows: the sample, the invoice it issued) and no row is left marked as altered', (await page.locator('#ledger').getAttribute('data-view')) === 'grid' && (await page.locator(ROWS(VIEWS[0])).count()) === 9 && (await page.locator('#ledgerGrid .row-bad').count()) === 0);
    check('#selftest: the Insights board shows its three default cards and the one the flow pinned (4 of 6), each with a chart', (await page.locator('#boardGrid .board-card').count()) === 4 && (await page.locator('#boardGrid canvas').count()) === 4 && /4 of 6/.test(await page.locator('#boardCount').innerText()));
    const events = await page.evaluate(() => [...new Set(JSON.parse(localStorage.getItem('cuadra-demo-v1')).activity.map((e) => e.event))]);
    const wanted = ['sample', 'proposal', 'approved', 'issued', 'sent', 'reminder', 'widget_pinned', 'tamper_on', 'tamper_off'];
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
    await gridReady(page);
    const ledgerRow = (text) => page.locator(ROWS(VIEWS[0]), { hasText: text });
    const hotel = () => ledgerRow('Hotel Mirador');
    // The grid's buttons are reachable by keyboard: arrows to the actions cell, Enter into it, Tab between buttons, Escape out.
    await ledgerRow('Acme Studio SL').first().locator('.ag-cell[col-id="client"]').click({ position: { x: 20, y: 10 } });
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    const focusedDo = () => page.evaluate(() => document.activeElement.dataset.do || document.activeElement.getAttribute('col-id'));
    const keyFirst = await focusedDo();
    await page.keyboard.press('Tab');
    const keySecond = await focusedDo();
    await page.keyboard.press('Escape');
    check('flows: the grid is keyboard friendly (arrows reach the actions cell, Enter focuses View, Tab moves to Collect, Escape returns to the cell)', keyFirst === 'view' && keySecond === 'collect' && (await focusedDo()) === 'actions');
    await hotel().locator('[data-do="collect"]').click();
    await settle(page);
    check('flows: Collect in the ledger puts the invoice on PayPal (Remind and refresh appear)', (await hotel().locator('[data-do="remind"]').count()) === 1 && (await hotel().locator('[data-do="refresh"]').count()) === 1 && /PayPal/.test(await hotel().innerText()));
    await hotel().locator('[data-do="remind"]').click();
    await settle(page);
    check('flows: Remind reports through the toast and the Activity log', /Reminder sent/.test(await page.locator('#toast').innerText()) && /Reminder sent/.test(await page.locator('#activityList').innerText()));
    await ledgerRow('Marta Pardo').filter({ hasText: 'OVERDUE' }).locator('[data-do="view"]').click();
    await settle(page);
    await page.selectOption('#payMethod', 'CASH');
    await page.click('[data-dl="paid"]');
    await settle(page, 900);
    check('flows: Mark paid in the detail records the payment', (await ledgerRow('Marta Pardo').filter({ hasText: 'PAID' }).count()) >= 1 && /Payment recorded/.test(await page.locator('#activityList').innerText()));
    const blocks = await page.locator('.chain-block[data-i]').count();
    await hotel().locator('[data-do="view"]').click();
    await settle(page);
    await page.fill('#cancelReason', 'Wrong client');
    await page.click('[data-dl="cancel"]');
    await settle(page, 1500);
    check('flows: Cancel in the detail appends a cancellation block and the chain stays verified', (await page.locator('.chain-block[data-i]').count()) === blocks + 1 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && /Cancelled/.test(await page.locator('#activityList').innerText()));
    const exported = async (id) => { await page.click('#menuBtn'); const [d] = await Promise.all([page.waitForEvent('download'), page.click(id)]); return d.suggestedFilename(); };
    check('flows: the menu exports XML, CSV and the activity JSON', (await exported('#xml')) === 'cuadra-verifactu-records.xml' && (await exported('#csv')) === 'cuadra-libro-registro.csv' && (await exported('#exportActivity')) === 'cuadra-activity.json');
    // The ledger's own Export CSV goes through the grid's API and writes the rows that are showing, in the register format.
    await page.click('[data-chip="paid"]');
    await page.fill('#ledgerSearch', 'acme');
    await settle(page, 500);
    check('flows: the status chip and the quick filter combine (Paid + "acme" leaves one row and its total)', (await page.locator(ROWS(VIEWS[0])).count()) === 1 && /Total · 1 invoice 1452,00 €/.test((await page.locator('#ledgerGrid .ag-row-pinned').innerText()).replace(/\s+/g, ' ')));
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.click('#ledgerCsv')]);
    const csvLines = readFileSync(await csvDownload.path(), 'utf8').replace(/^\ufeff/, '').trim().split(/\r?\n/);
    check('flows: Export CSV in the ledger toolbar writes only the rows showing, in the register format (header + 1 invoice, no totals row)', csvDownload.suggestedFilename() === 'cuadra-libro-registro.csv' && csvLines.length === 2 && csvLines[0] === '"record","number","date","client","client_nif","base","vat","total","status","due","hash"' && /^"alta","[A-Z0-9]+-0001","\d\d-\d\d-\d{4}","Acme Studio SL","B12345674","1200.00","252.00","1452.00","PAID"/.test(csvLines[1]));
    await page.click('[data-chip="all"]');
    await page.fill('#ledgerSearch', '');
    await settle(page, 400);
    const firstRow = () => page.locator(ROWS(VIEWS[0])).first().innerText();
    const totalHeader = page.locator('#ledgerGrid .ag-header-cell[col-id="total"]');
    await totalHeader.click();
    await settle(page, 400);
    const smallest = await firstRow();
    await totalHeader.click();
    await settle(page, 400);
    const largest = await firstRow();
    const lastKind = await page.locator(ROWS(VIEWS[0])).last().innerText();
    await totalHeader.click();
    await settle(page, 400);
    check('flows: the Total header sorts the grid both ways, the cancellation record (no amount) always stays last, a third click restores the order', /290,40/.test(smallest) && /1452,00/.test(largest) && /Cancels/.test(lastKind) && /Cancels/.test(await firstRow()));
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
    check('flows: a request without a sentence from the model gets one from the proposal (Lumen: "Invoice draft for Lumen Foods SL: 242,00 € (2 × 100,00 € + VAT)")', (await page.locator('.bubble-agent').last().innerText()).replace(/\s+/g, ' ').trim() === 'Invoice draft for Lumen Foods SL: 242,00 € (2 × 100,00 € + VAT)');
    await page.locator('.proposal [data-act="discard"]').last().click();
    await settle(page);
    check('flows: Discard dismisses the proposal and logs it', /Dismissed/.test(await page.locator('#activityList').innerText()));
    await page.fill('#msg', 'Factura a Lumen Foods SL por 2 diseños de etiqueta a 250 € más IVA');
    await page.press('#msg', 'Enter');
    await page.waitForFunction(() => !document.querySelector('.thinking'), null, { timeout: 15000 });
    await settle(page, 600);
    check('flows: a Spanish request gets a Spanish sentence ("Borrador de factura para Lumen Foods SL: 605,00 € (2 × 250,00 € + IVA)")', (await page.locator('.bubble-agent').last().innerText()).replace(/\s+/g, ' ').trim() === 'Borrador de factura para Lumen Foods SL: 605,00 € (2 × 250,00 € + IVA)');
    await page.locator('.proposal [data-act="discard"]').last().click();
    await settle(page);
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page, 1500);
    await gridReady(page);
    check('flows: a reload restores the ledger, the chat and the activity', (await page.locator('.chain-block[data-i]').count()) === blocks + 1 && (await page.locator('.proposal').count()) >= 1 && (await page.locator('#activityList .activity-row').count()) >= 5);
    await page.locator('[data-plan="pro"]').click();
    await page.waitForURL(/subscription=done/);
    await settle(page, 1500);
    check('flows: the PayPal subscription (mock) turns the plan chip and the pricing button', /Autónomo plan/i.test(await page.locator('#plan').innerText()) && /Current plan/i.test(await page.locator('[data-plan="pro"]').innerText()));
    await page.click('#menuBtn');
    await page.click('#reset');
    await settle(page, 1200);
    check('flows: Start empty shows the guided empty state and a ghost block, and keeps the activity log and the plan', (await page.locator('.empty-actions button').count()) === 2 && (await page.locator('.block-ghost').count()) === 1 && /Ledger reset/.test(await page.locator('#activityList').innerText()) && /Autónomo plan/i.test(await page.locator('#plan').innerText()) && (await page.locator('#ledgerGrid').isHidden()));
    await page.click('#menuBtn');
    await page.click('#sample');
    await gridReady(page);
    await settle(page, 800);
    check('flows: loading the sample again after Start empty brings the grid back with its 8 rows and its totals row', (await page.locator(ROWS(VIEWS[0])).count()) === 8 && (await page.locator('#ledgerGrid .ag-row-pinned').count()) === 1 && (await page.locator('#ledgerGrid').isVisible()) && (await page.locator('#ledgerTable').isHidden()));
    await ctx.close();
  }

  // 9. The tour on its own clock, and with prefers-reduced-motion (no animation, final states at once, manual tour).
  {
    const ctx = await newContext({ ...VIEWS[0].opts });
    const page = await ctx.newPage();
    watch(page, 'tour timing');
    const step = async () => (await page.locator('.tour-k').textContent()).trim();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tour:not([hidden])');
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('.tour-k')?.textContent.includes('Step 2'), null, { timeout: 9000 });
    check('tour: the first visit starts it by itself and each step lasts about five seconds', Date.now() - t0 > 3500 && Date.now() - t0 < 8000);
    await page.hover('#tour');
    await settle(page, 6200);
    check('tour: hovering the caption pauses it', /Step 2 of 4/.test(await step()));
    await page.mouse.move(10, 10);
    await page.waitForFunction(() => document.querySelector('#tour')?.hidden, null, { timeout: 20000 });
    check('tour: it ends by itself, heals the tamper test and does not come back on the next visit', (await page.locator('.chain-block.broken').count()) === 0 && (await page.evaluate(() => localStorage.getItem('cuadra-tour-v1'))) === '1');
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page, 800);
    check('tour: the ? button replays it', (await page.locator('#tour').isHidden()) && (await (async () => { await page.click('#tourBtn'); await page.waitForSelector('#tour:not([hidden])'); return /Step 1 of 4/.test(await step()); })()));
    await page.focus('#msg');
    await settle(page, 400);
    check('tour: starting to type in the agent box closes it', await page.locator('#tour').isHidden());
    await ctx.close();

    const calm = await newContext({ ...VIEWS[0].opts, reducedMotion: 'reduce' });
    const still = await calm.newPage();
    watch(still, 'reduced motion');
    await still.goto(`${BASE}/?tour=1`, { waitUntil: 'domcontentloaded' });
    await still.waitForSelector('.chain-block');
    await settle(still, 300);
    check('reduced motion: the chain verdict is there at once and nothing is animated', /Chain verified/.test(await still.locator('#chainStatus').innerText()) && (await still.evaluate(() => [...document.querySelectorAll('.chain-block')].every((b) => getComputedStyle(b).animationName === 'none'))));
    await still.waitForSelector('#tour:not([hidden])');
    await settle(still, 6500);
    check('reduced motion: the tour waits for Next instead of advancing, and Escape closes it', /Step 1 of 4/i.test(await still.locator('.tour-k').innerText()) && (await (async () => { await still.keyboard.press('Escape'); await settle(still, 300); return still.locator('#tour').isHidden(); })()));
    await calm.close();
  }

  // 10. The grid is an enhancement: if its file is blocked, too slow, rejected by the integrity check or throws, the
  //     plain table stays with all its rows and nobody sees an error (the console shows only the browser's own network line).
  {
    const real = readFileSync(here('../public/vendor/ag-grid/ag-grid-community.min.noStyle.js'));
    const cases = [
      ['blocked', async (ctx) => { await ctx.route('**/vendor/ag-grid/**', (r) => r.abort()); }, [/Failed to load resource/, /ag-grid/]],
      ['too slow (3 s limit)', async (ctx) => { await ctx.route('**/vendor/ag-grid/**', async (r) => { await new Promise((ok) => setTimeout(ok, 3600)); await r.continue().catch(() => {}); }); }, []],
      ['tampered (integrity check)', async (ctx) => { await ctx.route('**/vendor/ag-grid/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: Buffer.concat([real, Buffer.from('\n/* altered */')]) })); }, [/integrity/i, /ag-grid/]],
      ['throws while building', async (ctx) => { await ctx.addInitScript(() => { window.agGrid = { createGrid() { throw new Error('boom'); } }; }); }, []],
    ];
    for (const [label, setup, expected] of cases) {
      const ctx = await newContext({ ...VIEWS[0].opts });
      await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
      await setup(ctx);
      const page = await ctx.newPage();
      watch(page, `grid fallback (${label})`, expected);
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle(page, label.startsWith('too slow') ? 5200 : 2200);
      const view = await page.locator('#ledger').getAttribute('data-view');
      check(`grid fallback, ${label}: the plain table stays with its 8 rows and the grid and its toolbar stay hidden`, view === 'table' && (await page.locator('#rows .row').count()) === 8 && (await page.locator('#ledgerGrid').isHidden()) && (await page.locator('#ledgerTools').isHidden()) && (await page.locator('#ledgerTable').isVisible()));
      if (label === 'blocked') { await page.evaluate(() => document.querySelector('#ledger').scrollIntoView({ block: 'start' })); await settle(page, 300); await page.screenshot({ path: `${OUT}/09-ledger-fallback-table-1280.png` }); }
      await page.locator('#rows .row', { hasText: 'Hotel Mirador' }).locator('[data-do="collect"]').click();
      await settle(page, 700);
      check(`grid fallback, ${label}: the table still works (Collect puts the invoice on PayPal) and the CSV export falls back to the register writer`, (await page.locator('#rows .row', { hasText: 'Hotel Mirador' }).locator('[data-do="remind"]').count()) === 1 && await (async () => { await page.click('#menuBtn'); const [d] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]); const text = readFileSync(await d.path(), 'utf8'); return d.suggestedFilename() === 'cuadra-libro-registro.csv' && text.startsWith('﻿"record","number"') && text.trim().split(/\r?\n/).length === 9; })());
      await ctx.close();
    }
  }

  // 11. Ask the ledger: an Insight proposal in the chat, pinning it, the six-widget limit, removing, CSV, collapsing,
  //     and the board surviving a reload.
  for (const view of VIEWS) {
    const ctx = await newContext({ ...view.opts, acceptDownloads: true });
    await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
    const page = await ctx.newPage();
    watch(page, `${view.name} insights`);
    const openAgent = async () => { if (view.mobile && !(await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.click('#openAgent'); await settle(page, 450); } };
    const closeAgent = async () => { if (view.mobile && (await page.evaluate(() => document.body.classList.contains('sheet-open')))) { await page.click('#sheetClose'); await settle(page, 350); } };
    const ask = async (text) => { await openAgent(); await say(page, text); await page.waitForSelector('#chat .insight', { timeout: 10000 }); await settle(page, 500); };
    const now = new Date();
    const thisQuarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    const cardsOnBoard = () => page.locator('#boardGrid .board-card');
    const titles = () => cardsOnBoard().evaluateAll((els) => els.map((c) => c.querySelector('.board-title').textContent.trim()));
    const lastInsight = () => page.locator('#chat .insight').last();
    const boardState = () => page.evaluate(() => JSON.parse(localStorage.getItem('cuadra-demo-v1')).widgets.map((w) => w.title));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#boardGrid canvas', { timeout: 15000 });
    await settle(page, 600);

    // An Insight proposal: the agent only chose the specification, the card is drawn from the ledger.
    await ask('Who owes me money?');
    const insight = lastInsight();
    const legendText = (await insight.locator('.insight-legend').innerText()).replace(/\s+/g, ' ');
    check(`[${view.name}] Insight proposal: a card with the title, the engine's figure, a donut chart, the legend with amounts, the honest note and Pin / Dismiss`, (await insight.locator('.insight-title').innerText()) === 'Who still owes what' && /2006,40/.test(await insight.innerText()) && (await insight.locator('canvas').count()) === 1 && /Hotel Mirador SL 990,00 € 49%/.test(legendText) && /not by the AI/.test(await insight.innerText()) && (await insight.locator('[data-act="pin"]').innerText()) === 'Pin to board' && (await insight.locator('[data-act="discard"]').isVisible()));
    check(`[${view.name}] agent sentence: "Who owes me money?" is answered with a sentence written from the widget ("Here is who owes you money: 3 open invoices, 2006,40 €")`, (await page.locator('#chat .bubble-agent').last().textContent()).replace(/\s+/g, ' ').trim() === 'Here is who owes you money: 3 open invoices, 2006,40 €');
    check(`[${view.name}] Insight proposal: it is not counted as a decision waiting for you (the Ask Cuadra badge stays at 0) and the chat shows it without a plan card`, (await page.locator('#openAgent').getAttribute('data-pending')) === '0' && (await page.locator('#chat .plan').count()) === 0);
    // The card from its first line (the question and the answer above it scroll out of the way).
    const cardToTop = () => page.evaluate(() => { const c = document.querySelector('#chat'); const k = [...c.querySelectorAll('.insight')].at(-1); c.scrollTop += k.getBoundingClientRect().top - c.getBoundingClientRect().top - 6; });
    await cardToTop();
    await settle(page, 400);
    await page.screenshot({ path: `${OUT}/11-insight-proposal-${view.name}.png` });
    if (!view.mobile) {
      // The same card on a taller window, where the question, the answer and the whole card are in view.
      await page.setViewportSize({ width: 1280, height: 1000 });
      await settle(page, 500);
      await page.evaluate(() => { const c = document.querySelector('#chat'); c.scrollTop = 0; });
      await page.evaluate(() => { const c = document.querySelector('#chat'); const q = [...c.querySelectorAll('.bubble-user')].at(-1); c.scrollTop += q.getBoundingClientRect().top - c.getBoundingClientRect().top - 6; });
      await settle(page, 300);
      await page.screenshot({ path: `${OUT}/11c-insight-proposal-full-1280x1000.png` });
      await page.setViewportSize({ width: 1280, height: 800 });
      await settle(page, 400);
    }

    // Pinning something that is already on the board says so; pinning something new adds a card.
    await insight.locator('[data-act="pin"]').click();
    await settle(page, 700);
    check(`[${view.name}] pin: the default board already has it ("Already on the board."), so nothing is added`, /Already on the board/.test(await lastInsight().innerText()) && (await cardsOnBoard().count()) === 3);
    await ask('Revenue by client this quarter');
    check(`[${view.name}] Insight proposal: "Revenue by client this quarter" is a bar chart with the one invoice of the quarter (290,40 € to Acme Studio SL)`, (await lastInsight().locator('.insight-title').innerText()) === 'Revenue by client' && /290,40/.test(await lastInsight().innerText()) && (await lastInsight().locator('canvas').count()) === 1 && new RegExp(`1 invoice · ${thisQuarter}`).test(await lastInsight().innerText()));
    await lastInsight().locator('[data-act="pin"]').click();
    await settle(page, 900);
    check(`[${view.name}] pin: "Pin to board" adds a fourth card with its chart, logs "Widget pinned", saves it and shows the board${view.mobile ? ' (the sheet closes)' : ''}`, (await cardsOnBoard().count()) === 4 && (await titles()).at(-1) === 'Revenue by client' && (await cardsOnBoard().last().locator('canvas').count()) === 1 && /Widget pinned/.test(await page.locator('#activityList').innerText()) && (await boardState()).length === 4 && /Pinned to the board/.test(await lastInsight().textContent()) && (!view.mobile || !(await page.evaluate(() => document.body.classList.contains('sheet-open')))));
    check(`[${view.name}] pin: the board scrolls to the card that was just pinned and the card is in view`, await page.evaluate(() => { const r = document.querySelector('#boardGrid .board-card:last-child').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 60 && r.left >= 0 && r.left < innerWidth - 40; }));
    await page.screenshot({ path: `${OUT}/11b-board-pinned-${view.name}.png` });

    // Export one card, then fill the board to six: the seventh cannot be pinned until one is removed.
    const [csv] = await Promise.all([page.waitForEvent('download'), cardsOnBoard().first().locator('[data-w-csv]').click()]);
    const csvText = readFileSync(await csv.path(), 'utf8');
    check(`[${view.name}] board: CSV of a card is the dataset it shows (header, one line per month, total), formula-safe, named after the card`, csv.suggestedFilename() === 'cuadra-insight-invoiced-vs-collected-by-month.csv' && /^﻿"Month","Invoiced","Collected"\r\n"\w{3}","2057\.00","2057\.00"\r\n"\w{3}","1364\.40","374\.40"/.test(csvText) && csvText.trimEnd().endsWith('"Total","4437.80","2431.40"'));
    await ask('VAT by rate last quarter');
    await lastInsight().locator('[data-act="pin"]').click();
    await settle(page, 600);
    await ask('Invoiced by month this year');
    await lastInsight().locator('[data-act="pin"]').click();
    await settle(page, 600);
    await ask('Collected by client this quarter');
    check(`[${view.name}] board: six cards at most; the seventh Insight cannot be pinned and says why`, (await cardsOnBoard().count()) === 6 && (await lastInsight().locator('[data-act="pin"]').isDisabled()) && /The board holds 6 insights/.test(await lastInsight().innerText()) && /6 of 6/.test(await page.locator('#boardCount').innerText()));
    await page.evaluate(() => document.querySelector('#board').scrollIntoView({ block: 'start' }));
    await closeAgent();
    await settle(page, 500);
    await page.locator('#boardGrid .board-card').nth(3).locator('[data-w-remove]').click();
    await settle(page, 700);
    check(`[${view.name}] board: removing a card ("Revenue by client") leaves five, logs "Widget removed", and the waiting Insight can be pinned again`, (await cardsOnBoard().count()) === 5 && !(await titles()).includes('Revenue by client') && /Widget removed/.test(await page.locator('#activityList').innerText()) && !(await lastInsight().locator('[data-act="pin"]').isDisabled()));

    // Collapse and expand, then reload: the board and its charts come back.
    await page.click('#boardToggle');
    await settle(page, 300);
    const hidden = await page.locator('#boardBody').isHidden();
    await page.click('#boardToggle');
    await settle(page, 700);
    check(`[${view.name}] board: Hide collapses it (aria-expanded false), Show brings the cards and their charts back`, hidden && (await page.locator('#boardToggle').getAttribute('aria-expanded')) === 'true' && (await page.locator('#boardGrid canvas').count()) === 5);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#boardGrid canvas', { timeout: 15000 });
    await settle(page, 600);
    check(`[${view.name}] board: a reload restores the five pinned cards with their charts (the board is saved with the ledger)`, (await cardsOnBoard().count()) === 5 && (await page.locator('#boardGrid canvas').count()) === 5 && (await boardState()).length === 5);
    await page.screenshot({ path: `${OUT}/11d-board-after-reload-${view.name}.png`, fullPage: false });

    // Start empty hides the board's content; the guided empty state offers the two questions.
    page.on('dialog', (d) => d.accept());
    await page.click('#menuBtn');
    await page.click('#reset');
    await settle(page, 900);
    check(`[${view.name}] board: after Start empty there is no board to show (no ledger, nothing pinned)`, await page.locator('#board').isHidden());
    await ctx.close();
  }

  // 12. The charts are an enhancement too: with the library blocked, tampered or throwing, every card keeps a table of the
  //     same figures, pinning still works, and nobody sees an error.
  {
    const real = readFileSync(here('../public/vendor/ag-charts/ag-charts-community.min.js'));
    const cases = [
      ['blocked', async (ctx) => { await ctx.route('**/vendor/ag-charts/**', (r) => r.abort()); }, [/Failed to load resource/, /ag-charts/]],
      ['tampered (integrity check)', async (ctx) => { await ctx.route('**/vendor/ag-charts/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: Buffer.concat([real, Buffer.from('\n/* altered */')]) })); }, [/integrity/i, /ag-charts/]],
      ['throws while drawing', async (ctx) => { await ctx.addInitScript(() => { window.agCharts = { AgCharts: { create() { throw new Error('boom'); } } }; }); }, []],
    ];
    for (const [label, setup, expected] of cases) {
      const ctx = await newContext({ ...VIEWS[0].opts });
      await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
      await setup(ctx);
      const page = await ctx.newPage();
      watch(page, `charts fallback (${label})`, expected);
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle(page, 2500);
      const tables = await page.locator('#boardGrid .insight-table').count();
      const flat = (await page.locator('#boardGrid').innerText()).replace(/\s+/g, ' ');
      check(`charts fallback, ${label}: the three cards show tables with the same figures (no canvas, no error)`, tables === 3 && (await page.locator('#boardGrid canvas').count()) === 0 && /Hotel Mirador SL 990,00 €/.test(flat) && /\w{3} 2057,00 € 2057,00 €/.test(flat) && /0–30 days 1016,40 €/.test(flat));
      await say(page, 'Who owes me money?');
      await page.locator('#chat .insight [data-act="pin"]').last().click();
      await settle(page, 600);
      check(`charts fallback, ${label}: an Insight proposal is a table too and pinning it still works`, (await page.locator('#chat .insight .insight-table').count()) === 1 && /Already on the board/.test(await page.locator('#chat .insight').last().innerText()));
      if (label === 'blocked') {
        await page.evaluate(() => document.querySelector('#board').scrollIntoView({ block: 'start' }));
        await settle(page, 400);
        await page.screenshot({ path: `${OUT}/12-insights-fallback-tables-1280.png` });
      }
      await ctx.close();
    }
  }

  // 13. Cuadra for AI agents: the recorded MCP session replays line by line in a terminal, next to the Claude Desktop config.
  {
    const expected = transcriptLines(JSON.parse(readFileSync(here('../public/mcp-transcript.json'), 'utf8'))).length;
    for (const view of VIEWS) {
      const ctx = await newContext({ ...view.opts });
      await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
      const page = await ctx.newPage();
      watch(page, `${view.name} agents`);
      let fetched = 0;
      page.on('request', (r) => { if (/mcp-transcript\.json/.test(r.url())) fetched++; });
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await settle(page, 1200);
      check(`[${view.name}] agents: the transcript is not fetched, nor the terminal filled, until the section scrolls into view`, fetched === 0 && (await page.locator('#termBody .term-line').count()) === 0);
      await page.evaluate(() => document.querySelector('#agents').scrollIntoView({ block: 'start' }));
      await settle(page, 4200);
      const mid = await page.locator('#termBody .term-line').count();
      check(`[${view.name}] agents: the session replays line by line (some lines are on screen, not all, and the caret is blinking)`, fetched === 1 && mid > 8 && mid < expected && (await page.locator('#termBody').evaluate((e) => e.classList.contains('is-playing'))));
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = 'hidden'; });
      await page.locator('#agents').screenshot({ path: `${OUT}/13-mcp-terminal-midreplay-${view.name}.png` });
      await page.waitForFunction(() => !document.querySelector('#termBody').classList.contains('is-playing'), null, { timeout: 45000 });
      const text = await page.locator('#termBody').innerText();
      check(`[${view.name}] agents: the whole session ends with the server's own figures (217.80, a mock PayPal id, SENT, ok) and its closing line, ${expected} lines in all`, (await page.locator('#termBody .term-line').count()) === expected && /"total": "217\.80"/.test(text) && /INV2-MOCK-0001/.test(text) && /"collect_with_paypal": true/.test(text) && /"status": "SENT"/.test(text) && /13 JSON-RPC messages, 6 steps/.test(text) && fetched === 1);
      await page.locator('#termBody').evaluate((e) => { e.scrollTop = e.scrollHeight * 0.55; });
      await settle(page, 300);
      await page.locator('#agents').screenshot({ path: `${OUT}/13b-mcp-terminal-issue-${view.name}.png` });
      check(`[${view.name}] agents: the section has the Claude Desktop configuration and the 12 tools next to the terminal, and nothing makes the page scroll sideways`, /mcpServers/.test(await page.locator('#agents pre').innerText()) && /export_verifactu_xml/.test(await page.locator('#agents').innerText()) && (await overflow(page)) <= 0);
      await page.click('#termReplay');
      await settle(page, 700);
      const again = await page.locator('#termBody .term-line').count();
      check(`[${view.name}] agents: Replay starts the session again from the first line`, again > 0 && again < 30 && (await page.locator('#termBody').evaluate((e) => e.classList.contains('is-playing'))) && (await page.locator('#termBody .term-line').first().innerText()) === '$ node mcp/server.js' && fetched === 1);
      await ctx.close();
    }
    // With reduced motion the whole session is there at once, and Replay shows it at once too.
    const calm = await newContext({ ...VIEWS[0].opts, reducedMotion: 'reduce' });
    const still = await calm.newPage();
    watch(still, 'reduced motion agents');
    await still.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await still.evaluate(() => document.querySelector('#agents').scrollIntoView({ block: 'start' }));
    await settle(still, 900);
    const whole = (await still.locator('#termBody .term-line').count()) === expected && !(await still.locator('#termBody').evaluate((e) => e.classList.contains('is-playing')));
    await still.click('#termReplay');
    await settle(still, 300);
    check('reduced motion: the terminal shows the whole session at once, with no caret, and Replay does the same', whole && (await still.locator('#termBody .term-line').count()) === expected && !(await still.locator('#termBody').evaluate((e) => e.classList.contains('is-playing'))));
    await calm.close();
  }

  // 14. Corrective invoice (B5): from the detail of a PAID invoice to a proposal in the agent column, the R1 block in the chain,
  //     the rectified original in the ledger, the document and the verification page of the R1.
  for (const view of VIEWS) {
    const ctx = await newContext({ ...view.opts, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => localStorage.setItem('cuadra-tour-v1', '1'));
    const page = await ctx.newPage();
    watch(page, `${view.name} rectify`);
    const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}-${view.name}.png`, ...opts }); };
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 1500);
    if (!view.mobile) await gridReady(page);
    const paidRow = page.locator(ROWS(view), { hasText: 'Lumen Foods' }).first();
    await paidRow.locator('[data-do="view"]').click();
    await settle(page, 700);
    const offered = (await page.locator('#dlgBody [data-dl="rectify"]').count()) === 1 && (await page.locator('#dlgBody [data-dl="cancel"]').count()) === 0;
    await page.locator('#dlgBody [data-dl="rectify"]').click();
    await settle(page, 700);
    check(`[${view.name}] rectify: a PAID invoice offers "Issue corrective invoice" (and no cancel), which opens a prefilled proposal in the agent column without issuing anything`, offered && (await page.locator('.proposal .paper').count()) === 1 && /Factura rectificativa/i.test(await page.locator('.proposal .paper').innerText()) && (await page.locator('.chain-block[data-i]').count()) === 8 && (await page.locator('#chat [data-act="rectify"]').count()) === 1);
    // The user (or the model) changes the price: the paper is updated with the engine's figures.
    const target = await page.evaluate(() => JSON.parse(localStorage.getItem('cuadra-demo-v1')).records.find((r) => r.recipient?.name?.startsWith('Lumen') && r.paidAt).number);
    await say(page, `Rectify ${target}: the price was 200`);
    const last = page.locator('.proposal').last();
    check(`[${view.name}] rectify: asking "Rectify ${target}: the price was 200" gives a corrective proposal with the engine total (2 x 200 + 21% = 484,00 €) and the reference to the paid invoice`, /Factura rectificativa/i.test(await last.innerText()) && /484,00/.test(await last.innerText()) && new RegExp(`rectifies ${target}`).test(await last.innerText()) && /Issue corrective invoice/.test(await last.innerText()));
    await quiet(page);
    if (!view.mobile) await page.evaluate(() => { const c = document.querySelector('#chat'); c.scrollTop = c.scrollHeight; });
    await settle(page, 400);
    await shot('14-rectify-proposal');
    await page.locator('#chat [data-act="rectify"]').last().click();
    await settle(page, 1600);
    await closeAgentSheet(page, view);
    check(`[${view.name}] rectify: the R1 enters the chain as its own block "R1 · rectifies ${target}", the chain stays verified (9 blocks)`, (await page.locator('.chain-block.rectificativa').count()) === 1 && (await page.locator('.chain-block[data-i]').count()) === 9 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && new RegExp(`rectifies ${target}`).test(await page.locator('.chain-block.rectificativa').getAttribute('title')));
    await page.locator('#chainStrip').scrollIntoViewIfNeeded();
    await settle(page, 600);
    await page.locator('#chainStrip').screenshot({ path: `${OUT}/14b-chain-r1-${view.name}.png` });
    if (!view.mobile) await gridReady(page);
    const orig = page.locator(ROWS(view), { hasText: target }).filter({ hasText: 'RECTIFIED' });
    check(`[${view.name}] rectify: the original shows RECTIFIED in the ledger (still there, not edited) next to the R1 row`, (await orig.count()) === 1 && (await page.locator(ROWS(view), { hasText: 'R1' }).count()) >= 1);
    await page.evaluate(() => document.querySelector('#ledger').scrollIntoView({ block: 'start' }));
    await settle(page, 600);
    if (view.mobile) {
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = 'hidden'; });
      await page.locator('#ledger').screenshot({ path: `${OUT}/14c-rectified-status-${view.name}.png` });
      await page.evaluate(() => { document.querySelector('#openAgent').style.visibility = ''; });
    } else await shot('14c-rectified-status');
    // The R1 is a document and a verification page of its own.
    await page.locator(ROWS(view), { hasText: 'R1' }).first().locator('[data-do="view"]').click();
    await settle(page, 800);
    check(`[${view.name}] rectify: the detail of the R1 is a "Factura rectificativa / Corrective invoice" that names the rectified invoice, and its XML has FacturasRectificadas`, /Factura rectificativa \/ Corrective invoice/i.test(await page.locator('#dlgBody .doc').innerText()) && (await page.locator('#dlgBody .doc').innerText()).includes(target) && /FacturasRectificadas/.test(await page.locator('#dlgBody details pre').evaluate((e) => e.textContent)));
    await shot('14d-rectify-document');
    const [ver] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-dl="print"]')]);
    watch(ver, `${view.name} verify R1`);
    await ver.waitForLoadState('networkidle');
    await settle(ver, 900);
    check(`[${view.name}] rectify: verify.html shows the corrective invoice with the reference and "Consistent copy: the content matches its hash"`, /Consistent copy: the content matches its hash/.test(await ver.locator('#verdict').innerText()) && /Corrective invoice/i.test(await ver.locator('#paper').innerText()) && (await ver.locator('#paper').innerText()).includes(target));
    await ver.screenshot({ path: `${OUT}/14e-verify-r1-${view.name}.png`, fullPage: true });
    await ver.close();
    await page.keyboard.press('Escape');
    // The rectified original: no more corrective invoice, no cancellation, and a link to the R1.
    await page.locator(ROWS(view), { hasText: target }).filter({ hasText: 'RECTIFIED' }).first().locator('[data-do="view"]').click();
    await settle(page, 700);
    check(`[${view.name}] rectify: the rectified original offers neither a new corrective invoice nor a cancellation, and points to the R1`, (await page.locator('#dlgBody [data-dl="rectify"]').count()) === 0 && (await page.locator('#dlgBody [data-dl="cancel"]').count()) === 0 && /Rectified by/.test(await page.locator('#dlgBody').innerText()));
    await page.keyboard.press('Escape');
    const acts = await page.evaluate(() => JSON.parse(localStorage.getItem('cuadra-demo-v1')).activity.map((e) => e.event));
    check(`[${view.name}] rectify: the Activity log has the corrective invoice`, acts.includes('rectified'));
    await ctx.close();
  }

  // 15. Gestoría mode (B6): one company looks exactly as before; a second company from the switcher, the "All companies" view,
  //     separate ledgers and Activity, and the choice surviving a reload.
  for (const view of VIEWS) {
    const ctx = await newContext(view.opts);
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('shots-init')) { localStorage.setItem('cuadra-tour-v1', '1'); sessionStorage.setItem('shots-init', '1'); } });
    const page = await ctx.newPage();
    watch(page, `${view.name} companies`);
    const shot = async (name, opts = {}) => { await page.screenshot({ path: `${OUT}/${name}-${view.name}.png`, ...opts }); };
    const stored = (key) => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, key);
    const companyText = async () => ((await page.locator('#menuCompany').textContent()) || '').trim();
    const openSwitcher = async () => {
      if (view.mobile) { await page.click('#menuBtn'); await page.click('#menuCompany'); } else await page.click('#company');
      await page.waitForSelector('#companyDlg[open]');
      await settle(page, 400);
    };
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await settle(page, 1500);
    if (!view.mobile) await gridReady(page);
    const before = await companyText();
    check(`[${view.name}] one company: the header, the plan chip and the storage are what they always were (Estudio Norte SL, Free plan, no index written, 8 records under cuadra-demo-v1)`, /^Estudio Norte SL · NIF B76543214 · series CU/.test(before) && (await page.locator('#plan').textContent()) === 'Free plan' && (await stored('cuadra-companies-v1')) === null && (await stored('cuadra-demo-v1')).records.length === 8 && (await page.locator('#allCompanies').isHidden()));
    await openSwitcher();
    check(`[${view.name}] switcher: lists the one company, offers Add company… and Load a second sample company, and no All companies yet`, (await page.locator('#companyDlg .co-item').count()) === 1 && (await page.locator('#companyDlg [data-co="add"]').count()) === 1 && (await page.locator('#companyDlg [data-co="sample2"]').count()) === 1 && (await page.locator('#companyDlg [data-co="all"]').count()) === 0);
    await shot('15-company-switcher');
    await page.locator('#companyDlg [data-co="sample2"]').click();
    await settle(page, 1500);
    if (!view.mobile) await gridReady(page);
    const names = await page.evaluate(() => JSON.parse(localStorage.getItem('cuadra-companies-v1')).list.map((c) => c.name));
    check(`[${view.name}] second company: Taller Rivas SL opens with three invoices in its own chain, the plan chip reads "Gestoría plan (demo)", and the first ledger is untouched`, /^Taller Rivas SL · NIF B48219075 · series TR/.test(await companyText()) && (await page.locator('.chain-block[data-i]').count()) === 3 && /Chain verified/.test(await page.locator('#chainStatus').innerText()) && (await page.locator('#plan').textContent()) === 'Gestoría plan (demo)' && names.join() === 'Estudio Norte SL,Taller Rivas SL' && (await stored('cuadra-demo-v1')).records.length === 8 && (await stored('cuadra-demo-v1:B48219075')).records.length === 3);
    await quiet(page);
    await shot('15b-second-company');
    // Activity is per company: the new one has its own, the first one's does not mention it.
    check(`[${view.name}] activity: Taller Rivas SL has its own log (company added, sample loaded)`, /Company added/.test(await page.locator('#activityList').innerText()) && !(await stored('cuadra-demo-v1')).activity.some((e) => e.event === 'company'));
    await openSwitcher();
    check(`[${view.name}] switcher: with two companies the open one is marked and All companies appears`, (await page.locator('#companyDlg .co-item').count()) === 2 && (await page.locator('#companyDlg .co-item.is-current').innerText()).includes('Taller Rivas SL') && (await page.locator('#companyDlg [data-co="all"]').count()) === 1);
    await shot('15c-company-switcher-two');
    await page.locator('#companyDlg [data-co="all"]').click();
    await page.waitForSelector('#allCompanies .co-row');
    await settle(page, 700);
    const rows = await page.locator('#allCompanies .co-row').evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
    check(`[${view.name}] All companies: one row per company with outstanding, overdue, the next Modelo 303 deadline and the chain, and the dashboard is out of the way`, rows.length === 2 && /Estudio Norte SL/.test(rows[0]) && /2006,40 €/.test(rows[0]) && /1716,00 €/.test(rows[0]) && /2026-Q\d/.test(rows[0]) && /Chain verified/.test(rows[0]) && /Taller Rivas SL/.test(rows[1]) && /1350,80 €/.test(rows[1]) && /842,60 €/.test(rows[1]) && /Chain verified/.test(rows[1]) && /in \d+ days?|today|closed/.test(rows[1]) && (await page.locator('main').isHidden()) && (await page.locator('#chainStrip').isHidden()) && (await overflow(page)) <= 0);
    await shot('15d-all-companies');
    if (view.mobile) await page.screenshot({ path: `${OUT}/15d-all-companies-full-390.png`, fullPage: true });
    // Open the first company from the overview: the dashboard returns with its own ledger.
    await page.locator('#allCompanies [data-switch="B76543214"]').click();
    await settle(page, 1500);
    if (!view.mobile) await gridReady(page);
    check(`[${view.name}] switching back: Estudio Norte SL again, its 8 records and chain, the Taller Rivas ledger kept apart`, /^Estudio Norte SL/.test(await companyText()) && (await page.locator('.chain-block[data-i]').count()) === 8 && (await page.locator('main').isVisible()) && (await page.locator('#allCompanies').isHidden()) && (await stored('cuadra-demo-v1:B48219075')).records.length === 3);
    // The choice survives a reload.
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page, 1200);
    check(`[${view.name}] reload: the company that was open is open again`, /^Estudio Norte SL/.test(await companyText()) && (await page.locator('#plan').textContent()) === 'Gestoría plan (demo)');
    await openSwitcher();
    await page.locator('#companyDlg [data-switch="B48219075"]').click();
    await settle(page, 1200);
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page, 1200);
    check(`[${view.name}] reload: the second company, when it was the open one, comes back with its three records`, /^Taller Rivas SL/.test(await companyText()) && (await page.locator('.chain-block[data-i]').count()) === 3);
    // Add a company by hand: a bad NIF is refused with a message, a valid one starts an empty ledger.
    await openSwitcher();
    await page.locator('#companyDlg [data-co="add"]').click();
    await page.fill('#coName', 'Panadería Soto SL');
    await page.fill('#coNif', 'B12345675');
    await page.click('#companyForm button[type="submit"]');
    await settle(page, 300);
    check(`[${view.name}] add company: an invalid NIF is refused in place, with a message and the dialog still open`, /not valid/.test(await page.locator('#coError').innerText()) && (await page.locator('#companyDlg[open]').count()) === 1);
    await shot('15e-add-company-error');
    await page.fill('#coNif', 'B71889026');
    await page.click('#companyForm button[type="submit"]');
    await settle(page, 1200);
    check(`[${view.name}] add company: Panadería Soto SL opens with an empty ledger and three companies are listed`, /^Panadería Soto SL · NIF B71889026/.test(await companyText()) && (await page.locator('.chain-block[data-i]').count()) === 0 && (await page.locator('#ledger').innerText()).includes('Your ledger is empty') && (await stored('cuadra-companies-v1')).list.length === 3);
    await shot('15f-new-company-empty');
    check(`[${view.name}] companies: no horizontal scroll`, (await overflow(page)) <= 0);
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
