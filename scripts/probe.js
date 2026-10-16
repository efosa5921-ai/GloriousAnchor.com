#!/usr/bin/env node
/**
 * Diagnostic: fetch a URL the way the build does and print what came back.
 *   node scripts/probe.js https://example.com/feed/
 *   node scripts/probe.js @somehandle          (YouTube handle → shows how it resolves)
 * Run it from GitHub Actions (workflow "Probe a feed") to see what a publisher serves to GitHub's IP range.
 */
import Parser from 'rss-parser';
import { channelIdFromHtml, feedLinksFromHtml, YT_FEED } from './lib/sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let target = process.argv[2];
if (!target) { console.error('usage: node scripts/probe.js <url | @youtubehandle>'); process.exit(1); }

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7', 'Accept-Encoding': 'gzip, br' } });
  const ttfb = Date.now() - t0;
  const body = await res.text();
  console.log(`\n=== ${url}`);
  console.log(`status: ${res.status} ${res.statusText}  final url: ${res.url}  ttfb: ${ttfb} ms  total: ${Date.now() - t0} ms  content-encoding: ${res.headers.get('content-encoding') || 'none'}`);
  for (const h of ['content-type', 'server', 'cf-ray', 'x-cache', 'cache-control', 'content-length']) if (res.headers.get(h)) console.log(`${h}: ${res.headers.get(h)}`);
  console.log(`body: ${body.length} chars`);
  return { res, body };
}

if (target.startsWith('@')) {
  const { body } = await get(`https://www.youtube.com/${target}`);
  const ids = {};
  for (const m of body.matchAll(/UC[0-9A-Za-z_-]{22}/g)) ids[m[0]] = (ids[m[0]] || 0) + 1;
  console.log('channel ids seen (count):', Object.entries(ids).sort((a, b) => b[1] - a[1]).slice(0, 8));
  console.log('canonical:', body.match(/<link rel="canonical" href="([^"]+)"/)?.[1]);
  console.log('<title>:', body.match(/<title>([^<]*)<\/title>/)?.[1]);
  const id = channelIdFromHtml(body);
  console.log('resolver picks:', id);
  if (id) target = YT_FEED + id; else process.exit(0);
}

const { body } = await get(target);
console.log('--- first 700 chars ---\n' + body.slice(0, 700).replace(/\s+/g, ' ') + '\n---');
try {
  const feed = await new Parser().parseString(body);
  console.log(`parsed as feed: title="${feed.title}" items=${feed.items?.length ?? 0}`);
  for (const it of (feed.items || []).slice(0, 3)) console.log(`  - ${it.isoDate || it.pubDate || ''} ${it.title}`);
} catch (err) {
  console.log('not a feed:', String(err.message).split('\n')[0]);
  const links = feedLinksFromHtml(body, target);
  console.log('advertised feed links:', links.length ? links : 'none');
}
