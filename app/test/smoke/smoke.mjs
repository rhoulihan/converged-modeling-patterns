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
// The console is a fixed dock over the bottom 42vh; Puppeteer's own scroll can leave a
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
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle0' });
    const cards = await page.$$('.pcard');
    if (cards.length !== 6) fail(`expected 6 pattern cards, got ${cards.length}`);
    await page.screenshot({ path: path.join(OUT, `home-${scheme}.png`) });
    for (const id of PATTERNS) {
      await page.goto(`${URL}/#/p/${id}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.card');
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
      const tabs = await page.$$('#view .tabs button'); // pattern tabs, not the console's SQL/MongoDB lane tabs
      await press(page, tabs[tabs.length - 1]); // Measure it
      await press(page, '.card.measure .btn.primary');
      await page.waitForSelector('.measure-out svg', { timeout: 60000 });
      if (await page.$('.measure-out .result.error')) fail(`${id}: measure-it returned an error`);
      // fullPage renders the fixed console dock mid-page, over the measure result: hide it for this shot
      await page.$eval('#console', (c) => { c.hidden = true; });
      await page.screenshot({ path: path.join(OUT, `${id}-measure-${scheme}.png`), fullPage: true });
      await page.$eval('#console', (c) => { c.hidden = false; });
    }
    if (external.length) fail(`external requests: ${external.join(', ')}`);
    await page.close();
  }
  console.log(`SMOKE PASS · screenshots in ${OUT}`);
} finally {
  await browser.close();
}
