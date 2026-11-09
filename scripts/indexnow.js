#!/usr/bin/env node
/**
 * IndexNow: tell Bing, Yandex and the other IndexNow engines which of our pages are new or changed, right after a
 * deploy, instead of waiting for them to crawl. Google does not use IndexNow; the sitemap covers it.
 * The key is public by design: the engines verify it by fetching https://gloriousanchor.com/<key>.txt.
 * Usage: node scripts/indexnow.js [--dry-run]   (reads dist/data/articles.json and dist/data/meta.json)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'a46ab9c0e5dc2945777bd5780943c045';
const dry = process.argv.includes('--dry-run');
const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; } };

const articles = await readJson(path.join(ROOT, 'dist', 'data', 'articles.json'), []);
const meta = await readJson(path.join(ROOT, 'dist', 'data', 'meta.json'), {});
const base = String(meta.site?.url || 'https://gloriousanchor.com').replace(/\/$/, '');
const host = new URL(base).host;
const fresh = Date.now() - 48 * 3600 * 1000;
const urls = [...new Set([
  `${base}/`,
  ...articles.filter((a) => a.internal && (a.publishedAt > fresh || (a.updatedAt || 0) > fresh)).map((a) => a.url),
])];
if (urls.length <= 1) { console.log('indexnow: nothing new in the last 48 hours.'); process.exit(0); }
console.log(`indexnow: ${urls.length} url(s)${dry ? ' (dry run)' : ''}`); for (const u of urls) console.log('  ' + u);
if (dry) process.exit(0);
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key: KEY, keyLocation: `${base}/${KEY}.txt`, urlList: urls }),
});
console.log(`indexnow: HTTP ${res.status}`);
if (res.status >= 400) { console.log(await res.text()); process.exitCode = 1; }
