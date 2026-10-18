#!/usr/bin/env node
/**
 * Post new items to a Telegram channel and/or X after a build.
 * Needs TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and/or X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET.
 * Keeps dist/data/announced.json so nothing is posted twice; the first run only records what exists (no flood).
 * X charges per post, so by default X receives only our own articles and picks; set X_STORIES_PER_RUN to add
 * that many fresh stories per build on top (Telegram is free and always gets everything selected).
 * X posts carry the item's picture when it has one. Set X_REPOST to an article URL, id or title fragment to post
 * that one item to X again (with its picture) even though it was announced before.
 * Usage: node scripts/announce.js [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNew, telegramMessage, xText, oauthHeader, findRepost } from './lib/announce.js';
import { previewImage } from './lib/share.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dist', 'data');
const dry = process.argv.includes('--dry-run');
// Trim every secret: a stray newline or space pasted into a GitHub secret breaks the OAuth signature (X answers 401).
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

const telegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? { token: env.TELEGRAM_BOT_TOKEN, chat: env.TELEGRAM_CHAT_ID } : null;
const x = env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
  ? { consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET } : null;

const readJson = async (f, fallback) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; } };

async function postTelegram(a, site) {
  const call = async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${telegram.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
  const text = telegramMessage(a, site);
  if (a.image) {
    // A photo post with the headline as caption; if Telegram cannot fetch the picture, fall back to a link post.
    try { await call('sendPhoto', { chat_id: telegram.chat, photo: previewImage(a, site), caption: text, parse_mode: 'HTML' }); return; } catch (err) { console.warn(`  (photo failed, sending link instead: ${err.message})`); }
  }
  await call('sendMessage', { chat_id: telegram.chat, text, parse_mode: 'HTML', link_preview_options: { prefer_large_media: true } });
}

/** Upload the item's picture to X and return its media id, or null when there is none or the upload fails. */
async function uploadXImage(a, site) {
  if (!a.image) return null;
  try {
    const img = await fetch(previewImage(a, site), { headers: { 'User-Agent': 'GloriousAnchor/1.0' } });
    if (!img.ok) throw new Error(`image ${img.status}`);
    const bytes = await img.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('image over 5 MB');
    const type = img.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const attempt = async (url, extra = {}) => {
      const form = new FormData();
      form.append('media', new Blob([bytes], { type }), 'picture.jpg');
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      // OAuth 1.0a signs only the oauth_* parameters for multipart bodies.
      const res = await fetch(url, { method: 'POST', headers: { authorization: oauthHeader({ method: 'POST', url, ...x }) }, body: form });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 160)}`);
      const json = JSON.parse(text);
      return json.data?.id || json.media_id_string || null;
    };
    try { return await attempt('https://api.x.com/2/media/upload', { media_category: 'tweet_image', media_type: type }); }
    catch (err) { console.warn(`  (v2 media upload failed: ${err.message}; trying v1.1)`); return await attempt('https://upload.twitter.com/1.1/media/upload.json'); }
  } catch (err) {
    console.warn(`  (picture skipped for X: ${err.message})`);
    return null;
  }
}

async function postX(a, site) {
  const url = 'https://api.twitter.com/2/tweets';
  const mediaId = await uploadXImage(a, site);
  const body = { text: xText(a, site), ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) };
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: oauthHeader({ method: 'POST', url, ...x }) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`X ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (mediaId) console.log('  (with picture)');
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
  let failures = 0;
  if (env.X_REPOST) {
    const a = findRepost(articles, env.X_REPOST);
    if (!a) { console.warn(`repost: nothing matches "${env.X_REPOST}"`); failures++; }
    else if (!x) console.warn('repost: X credentials not set');
    else if (dry) console.log(`  [X repost] ${a.title}`);
    else {
      try { await postX(a, site); console.log(`  ✓ X repost: ${a.title}`); }
      catch (err) { failures++; console.warn(`  ✗ X repost: ${a.title} — ${err.message}`); }
    }
  }
  const items = selectNew(articles, announced, { now });
  const xStoryBudget = Number(env.X_STORIES_PER_RUN || 0) || 0;
  let xStoriesUsed = 0;
  console.log(`announce: ${items.length} new item(s) to post${dry ? ' (dry run)' : ''}${telegram ? ' · Telegram' : ''}${x ? ' · X' : ''}`);
  for (const a of items) {
    const targets = [];
    if (telegram) targets.push(['Telegram', postTelegram]);
    const priority = a.internal || a.kind === 'pick';
    if (x && (priority || xStoriesUsed < xStoryBudget)) { targets.push(['X', postX]); if (!priority) xStoriesUsed++; }
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
