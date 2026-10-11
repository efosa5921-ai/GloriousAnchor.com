#!/usr/bin/env node
/**
 * Build script for Glorious Anchor.
 *
 * 1. Reads feeds.json (sources, categories, limits).
 * 2. Resolves each source to a feed URL (RSS, YouTube channel, Reddit, Bluesky, Mastodon).
 * 3. Fetches every feed concurrently (or reads fixtures with --fixtures <dir>).
 * 4. Normalises, de-duplicates and sorts the items.
 * 5. Merges with the previous build's data so a single failed feed never blanks a section.
 * 6. Writes dist/ (static site) with data/articles.json, data/meta.json and data/resolved.json.
 */
import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Parser from 'rss-parser';
import { normaliseItem, dedupe, mergeWithPrevious } from './lib/articles.js';
import { resolveFeedUrl, homepageFor } from './lib/sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(DIST, 'data');

const args = process.argv.slice(2);
const fixturesDir = argValue('--fixtures');
const verbose = args.includes('--verbose');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : path.resolve(ROOT, args[i + 1]);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GloriousAnchorBot/1.0; +https://gloriousanchor.com)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
      ['yt:videoId', 'yt:videoId'],
    ],
  },
});

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'timeout' : String(err.message || err).split('\n')[0]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeed(source, limits, resolved) {
  try {
    let xml;
    if (fixturesDir) {
      const file = path.join(fixturesDir, `${source.id}.xml`);
      try { await access(file); } catch { return { source, error: 'no fixture' }; }
      xml = await readFile(file, 'utf8');
    } else {
      const feedUrl = await resolveFeedUrl(source, resolved, (u) => fetchText(u, limits.fetchTimeoutMs));
      xml = await fetchText(feedUrl, limits.fetchTimeoutMs);
    }
    return { source, feed: await parser.parseString(xml) };
  } catch (err) {
    return { source, error: String(err.message || err).split('\n')[0] };
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function validate(config) {
  const ids = new Set();
  const catIds = new Set(config.categories.map((c) => c.id));
  for (const s of config.sources) {
    if (!s.id || ids.has(s.id)) throw new Error(`feeds.json: duplicate or missing source id "${s.id}"`);
    ids.add(s.id);
    if (!catIds.has(s.category)) throw new Error(`feeds.json: source "${s.id}" has unknown category "${s.category}"`);
    if (s.category === 'top') throw new Error(`feeds.json: source "${s.id}" may not use the "top" pseudo-category; set "featured": true instead`);
  }
}

async function main() {
  const started = Date.now();
  const config = JSON.parse(await readFile(path.join(ROOT, 'feeds.json'), 'utf8'));
  validate(config);
  const { sources, categories, limits, site } = config;
  const previous = await readJson(path.join(DATA_DIR, 'articles.json'), []);
  const resolved = await readJson(path.join(DATA_DIR, 'resolved.json'), {});

  console.log(`Fetching ${sources.length} feeds${fixturesDir ? ' from fixtures' : ''}...`);
  const results = await mapWithConcurrency(sources, limits.concurrency, (s) => fetchFeed(s, limits, resolved));

  const fresh = [];
  const sourceStatus = [];
  for (const r of results) {
    if (r.error) {
      sourceStatus.push({ id: r.source.id, name: r.source.name, ok: false, error: r.error });
      console.warn(`  ✗ ${r.source.id}: ${r.error}`);
      continue;
    }
    const items = (r.feed.items || []).slice(0, limits.perSource);
    let kept = 0;
    for (const item of items) {
      const article = normaliseItem(item, r.source, r.feed);
      if (article) { fresh.push(article); kept++; }
    }
    sourceStatus.push({ id: r.source.id, name: r.source.name, ok: true, count: kept });
    if (verbose) console.log(`  ✓ ${r.source.id}: ${kept} items`);
  }

  const cutoff = Date.now() - limits.maxAgeHours * 3600 * 1000;
  const merged = mergeWithPrevious(fresh, previous, sourceStatus, cutoff);
  const articles = dedupe(merged).sort((a, b) => b.publishedAt - a.publishedAt);

  await mkdir(DATA_DIR, { recursive: true });
  await cp(SRC, DIST, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'articles.json'), JSON.stringify(articles));
  await writeFile(path.join(DATA_DIR, 'resolved.json'), JSON.stringify(resolved, null, 2));
  await writeFile(
    path.join(DATA_DIR, 'meta.json'),
    JSON.stringify({
      site,
      generatedAt: new Date().toISOString(),
      articleCount: articles.length,
      categories,
      sources: sources.map((s) => ({ id: s.id, name: s.name, category: s.category, kind: s.kind || 'news', featured: Boolean(s.featured), homepage: homepageFor(s) })),
      sourceStatus,
    }, null, 2),
  );
  await writeFile(path.join(DIST, '.nojekyll'), ''); // tell GitHub Pages not to run Jekyll
  // Stamp the service worker so every deploy invalidates the cached app shell.
  const swPath = path.join(DIST, 'sw.js');
  await writeFile(swPath, (await readFile(swPath, 'utf8')).replace('__BUILD__', Date.now().toString(36)));

  const okCount = sourceStatus.filter((s) => s.ok).length;
  const hash = createHash('sha1').update(JSON.stringify(articles.map((a) => a.id))).digest('hex').slice(0, 8);
  console.log(`Done: ${articles.length} items from ${okCount}/${sources.length} feeds in ${((Date.now() - started) / 1000).toFixed(1)}s (set ${hash}).`);
  if (okCount === 0 && articles.length === 0) {
    console.error('No feeds succeeded and no previous data exists.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
