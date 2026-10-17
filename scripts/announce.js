#!/usr/bin/env node
/**
 * Post new items to a Telegram channel and/or X after a build.
 * Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and/or X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET.
 * Keeps dist/data/announced.json so nothing is posted twice; the first run only records what exists (no flood).
 * Usage: node scripts/announce.js [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNew, telegramMessage, xText, oauthHeader } from './lib/announce.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data');
const dry = process.argv.includes('--dry-run');
const env = process.env;

const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID } : null;
const x = env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
  ? { consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET } : null;

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; } };

async function postTelegram(a, site) {
  const res = await fetch(`https://api.telegram.org/bot${telegram.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: telegram.chat, text: telegramMessage(a, site), parse_mode: 'HTML', link_preview_options: { url: a.url, prefer_large_media: true } }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function postX(a, site) {
  const url = 'https://api.twitter.com/2/tweets';
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: oauthHeader({ method: 'POST', url, ...x }) },
    body: JSON.stringify({ text: xText(a, site) }),
  });
  if (!res.ok) throw new Error(`X ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  if (!telegram && !x && !dry) { console.log('announce: no Telegram or X credentials set, skipping.'); return; }
  const articles = await readJson(path.join(DATA, 'articles.json'), []);
  const meta = await readJson(path.join(DATA, 'meta.json'), {});
  const site = meta.site || { name: 'Glorious Anchor', url: 'https://gloriousanchor.com' };
  const stateFile = path.join(DATA, 'announced.json');
  const announced = await readJson(stateFile, null);
  const now = Date.now();
  if (!announced) {
    // First run: remember everything so only genuinely new items get announced from now on.
    const seed = Object.fromEntries(articles.map((a) => [a.id, now]));
    if (!dry) await writeFile(stateFile, JSON.stringify(seed));
    console.log(`announce: first run, recorded ${articles.length} existing items without posting.`);
    return;
  }
  const items = selectNew(articles, announced, { now });
  console.log(`announce: ${items.length} new item(s) to post${dry ? ' (dry run)' : ''}${telegram ? ' · Telegram' : ''}${x ? ' · X' : ''}`);
  let failures = 0;
  for (const a of items) {
    const targets = [];
    if (telegram) targets.push(['Telegram', postTelegram]);
    if (x) targets.push(['X', postX]);
    let ok = true;
    for (const [name, fn] of targets) {
      if (dry) { console.log(`  [${name}] ${a.title}`); continue; }
      try { await fn(a, site); console.log(`  ✓ ${name}: ${a.title}`); }
      catch (err) { ok = false; failures++; console.warn(`  ✗ ${name}: ${a.title} — ${err.message}`); }
    }
    if (ok || dry) announced[a.id] = now;
  }
  // Forget ids older than 30 days so the state file stays small.
  for (const [id, t] of Object.entries(announced)) if (now - t > 30 * 86400 * 1000) delete announced[id];
  if (!dry) await writeFile(stateFile, JSON.stringify(announced));
  if (failures) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
