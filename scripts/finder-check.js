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
// "servers" as the first argument: time every candidate map server from a page on our site, as a visitor's browser
// would reach it, for a five-mile church search in Atlanta. Shows which are usable (answer, and allow our pages).
if (process.argv[2] === 'servers') {
  const page = await browser.newPage();
  await page.goto('https://gloriousanchor.com/about/', { waitUntil: 'load' });
  const q = encodeURIComponent('[out:json][timeout:25];nwr["amenity"="place_of_worship"]["religion"="christian"](around:8047,33.749,-84.388);out center tags qt 500;');
  const urls = [...['overpass.openstreetmap.fr', 'overpass-api.de', 'z.overpass-api.de', 'lz4.overpass-api.de', 'overpass.private.coffee', 'overpass.kumi.systems', 'overpass.osm.jp'].map((h) => `https://${h}/api/interpreter?data=${q}`),
    'https://photon.komoot.io/reverse?lat=33.749&lon=-84.388&radius=8&limit=50&osm_tag=amenity:place_of_worship',
    'https://nominatim.openstreetmap.org/search?q=church&format=jsonv2&limit=40&bounded=1&extratags=1&viewbox=-84.475,33.821,-84.301,33.677'];
  const out = await page.evaluate((list) => Promise.all(list.map(async (u) => {
    const t = Date.now(), host = new URL(u).host;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(40000) });
      const text = await r.text(); let n = '';
      try { const j = JSON.parse(text); n = `${(j.elements || j.features || j).length} items`; } catch { n = text.slice(0, 80).replace(/\s+/g, ' '); }
      return `${host}: ${r.status} in ${((Date.now() - t) / 1000).toFixed(1)}s, ${n}`;
    } catch (e) { return `${host}: FAILED after ${((Date.now() - t) / 1000).toFixed(1)}s (${e.name})`; }
  })), urls);
  console.log('Map servers as a browser on gloriousanchor.com sees them:');
  for (const line of out) console.log(`  ${line}`);
  await browser.close();
  process.exit(0);
}
const context = await browser.newContext({ timezoneId, geolocation: { latitude: lat, longitude: lng }, permissions: ['geolocation'], viewport: { width: 390, height: 800 } });
const page = await context.newPage();
const answers = [];
page.on('response', (r) => { if (/interpreter|nominatim|photon|geoapify/.test(r.url())) answers.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.status()} ${new URL(r.url()).host}`); });
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
