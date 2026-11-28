#!/usr/bin/env node
// Opens the live church finder in a real browser, as a visitor standing at a given spot, presses "Use my location"
// and reports when churches appear and what the page says. It talks to the real public map services, so it shows
// what visitors are getting today. Run by the "Check the church finder" workflow.
//   node scripts/finder-check.js [lat,lng] [time zone] [url]
import { chromium } from 'playwright';

const [lat, lng] = (process.argv[2] || '33.749,-84.388').split(',').map(Number);
const timezoneId = process.argv[3] || 'America/New_York';
const url = process.argv[4] || 'https://gloriousanchor.com/church-finder/';
const browser = await chromium.launch();
const context = await browser.newContext({ timezoneId, geolocation: { latitude: lat, longitude: lng }, permissions: ['geolocation'], viewport: { width: 390, height: 800 } });
const page = await context.newPage();
const answers = [];
page.on('response', (r) => { if (/interpreter|nominatim/.test(r.url())) answers.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.status()} ${new URL(r.url()).host}`); });
page.on('requestfailed', (r) => { if (/interpreter|nominatim/.test(r.url())) answers.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.failure()?.errorText} ${new URL(r.url()).host}`); });
page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
const blocked = new Set();
page.on('console', (m) => { if (m.type() === 'error' && /interpreter|nominatim|CORS/i.test(m.text())) blocked.add(m.text().replace(/\?data=\S+/, '').slice(0, 300)); });
let t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
console.log(`${url} as a visitor at ${lat},${lng} (${timezoneId})`);
t0 = Date.now();
await page.click('#locateBtn');
let last = -1;
for (let i = 0; i < 450; i++) {
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => ({ n: document.querySelectorAll('.church:not(.church--skeleton)').length, busy: document.getElementById('locateBtn').disabled, more: document.getElementById('status').classList.contains('status--more'), status: document.getElementById('status').textContent, first: [...document.querySelectorAll('.church__name')].slice(0, 3).map((e) => e.textContent).join(' / '), dist: document.querySelector('.church__dist')?.textContent || '' }));
  if (s.n !== last) { last = s.n; console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s: ${s.n} churches${s.more ? ' (loading the full list)' : ''} | nearest ${s.dist} | ${s.first.slice(0, 90)}`); }
  if (!s.busy && !s.more && i > 10) { console.log(`  finished at ${((Date.now() - t0) / 1000).toFixed(1)}s: ${s.status}`); break; }
}
console.log(`  map services: ${answers.join('; ') || 'none answered'}`);
for (const b of blocked) console.log(`  browser said: ${b}`);
console.log(`  map shown: ${await page.evaluate(() => !document.getElementById('map').hidden)}; radius menu: ${await page.evaluate(() => document.getElementById('radiusSel').selectedOptions[0].textContent)}`);
await browser.close();
