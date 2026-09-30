// app/test/smoke/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const URL = process.env.LAB_URL ?? 'http://localhost:3100';
const OUT = path.resolve(import.meta.dirname, '../artifacts');
fs.mkdirSync(OUT, { recursive: true });
const chrome = process.env.CHROME_PATH
  ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    .map((c) => { try { return execSync(`command -v ${c}`).toString().trim(); } catch { return null; } }).find(Boolean);
if (!chrome) { console.error('no Chrome found; set CHROME_PATH'); process.exit(2); }

const PATTERNS = ['01-extended-reference', '02-computed', '03-bucket', '04-subset', '05-tree-hierarchy', '06-outlier'];
const fail = (m) => { console.error(`SMOKE FAIL: ${m}`); process.exit(1); };
// The console is a fixed dock over the bottom of the page (clamp(280px, 45vh, 60vh) when
// expanded, a 40 px bar when collapsed); Puppeteer's own scroll can leave a
// target under it, so scroll the target to the top of the viewport before a real click.
const press = async (page, target) => {
  const el = typeof target === 'string' ? await page.$(target) : target;
  if (!el) fail(`no element for ${target}`);
  await el.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await el.click();
};
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    // Headless Chrome always reports (hover: none)/(pointer: coarse) regardless of the host's
    // real input devices, and CDP's media-feature emulation (used above) does not cover hover or
    // pointer — so the dock's own hover gate (there by design, to avoid sticky hover on touch)
    // would never engage under this runner, no matter what page.hover() does. Patch matchMedia
    // for just those two features before the app boots, so this run reflects the mouse-driven
    // desktop behaviour the dock actually ships for.
    await page.evaluateOnNewDocument(() => {
      const native = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/\(\s*hover\s*:\s*hover\s*\)/.test(q) || /\(\s*pointer\s*:\s*fine\s*\)/.test(q))
        ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
        : native(q);
    });
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle0' });
    const cards = await page.$$('.pcard');
    if (cards.length !== 6) fail(`expected 6 pattern cards, got ${cards.length}`);
    await page.screenshot({ path: path.join(OUT, `home-${scheme}.png`) });
    for (const id of PATTERNS) {
      await page.goto(`${URL}/#/p/${id}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.card');
      // Dock: collapsed on arrival, expands on hover, and on Load.
      const expanded = () => page.$eval('#console', (e) => e.classList.contains('expanded'));
      if (await expanded()) fail(`${id}: dock should start collapsed`);
      await page.hover('#console .bar'); await new Promise((r) => setTimeout(r, 300));
      if (!(await expanded())) fail(`${id}: dock did not expand on hover`);
      await page.mouse.move(10, 10); await new Promise((r) => setTimeout(r, 900));
      if (await expanded()) fail(`${id}: dock did not collapse after leaving`);
      // Help: a card ⓘ and a tab ⓘ open popovers with text.
      for (const sel of ['.card h3 .help-i', '#view .tabs .help-i']) {
        const t = await page.$(sel);
        if (!t) fail(`${id}: no help trigger for ${sel}`);
        await t.click();
        const txt = await page.$eval('.help-pop', (e) => e.textContent.trim());
        if (txt.length < 20) fail(`${id}: help popover for ${sel} is empty`);
        // One card's popover, left open for the screenshot, so a reviewer can see it in place.
        if (sel === '.card h3 .help-i') await page.screenshot({ path: path.join(OUT, `${id}-help-${scheme}.png`) });
        await page.keyboard.press('Escape');
      }
      const runButtons = await page.$$('.card .actions button:nth-child(3)');
      await press(page, runButtons[0]);
      await page.waitForSelector('.card-out .result', { timeout: 60000 });
      const errs = await page.$$('.card-out .result.error');
      if (errs.length) fail(`${id}: first card returned an error`);
      const loadButtons = await page.$$('.card .actions button:nth-child(2)');
      await press(page, loadButtons[0]);
      await page.$eval('#out', (o) => o.replaceChildren()); // drop the previous pattern's console result
      await page.click('#run');
      await page.waitForSelector('#out .result', { timeout: 60000 });
      if (await page.$('#out .result.error')) fail(`${id}: console run returned an error`);
      await page.screenshot({ path: path.join(OUT, `${id}-cards-${scheme}.png`) });
      await page.setViewport({ width: 800, height: 900 });
      await page.screenshot({ path: path.join(OUT, `${id}-cards-${scheme}-800.png`) });
      await page.setViewport({ width: 1440, height: 900 });
      // Dock: Load into console (above) opened it via focus, and it should still be open.
      if (!(await expanded())) fail(`${id}: dock did not stay open after Load into console`);
      // Move the pointer off the dock, then click the page heading to move focus out too —
      // with neither hover nor focus on it, it should close on its own after ~600ms.
      await page.mouse.move(10, 10);
      await press(page, '#view h1');
      await new Promise((r) => setTimeout(r, 900));
      if (await expanded()) fail(`${id}: dock did not close after focus and hover both left`);
      const tabs = await page.$$('#view .tabs button.tab'); // pattern tabs, not the console's SQL/MongoDB lane tabs
      await press(page, tabs[tabs.length - 1]); // Measure it
      await press(page, '.card.measure .btn.primary');
      await page.waitForSelector('.measure-out svg', { timeout: 60000 });
      if (!(await page.$('.measure-out svg.curve circle.live-redo'))) fail(`${id}: measure curve has no live marker`);
      if (!(await page.$('.measure-out .stat-bars'))) fail(`${id}: measure stat bars missing`);
      if (await page.$('.measure-out .result.error')) fail(`${id}: measure-it returned an error`);
      // fullPage renders the fixed console dock mid-page, over the measure result: hide it for this shot
      await page.$eval('#console', (c) => { c.hidden = true; });
      await page.screenshot({ path: path.join(OUT, `${id}-measure-${scheme}.png`), fullPage: true });
      await page.setViewport({ width: 800, height: 900 });
      await page.screenshot({ path: path.join(OUT, `${id}-measure-${scheme}-800.png`), fullPage: true });
      await page.setViewport({ width: 1440, height: 900 });
      await page.$eval('#console', (c) => { c.hidden = false; });
    }
    if (external.length) fail(`external requests: ${external.join(', ')}`);
    await page.close();
  }
  console.log(`SMOKE PASS · screenshots in ${OUT}`);
} finally {
  await browser.close();
}
