#!/usr/bin/env node
/**
 * Post a thread to X from a Markdown file: posts separated by a line containing only "---".
 * The first post may carry a picture: a line "image: https://..." anywhere in the file (removed from the text).
 * Each post must be 280 characters or fewer (links count as 23). Runs in GitHub Actions with the X secrets.
 * Usage: node scripts/thread.js threads/festac-77.md [--dry-run]
 */
import { readFile } from 'node:fs/promises';
import { oauthHeader, X_MAX } from './lib/announce.js';

// Secrets pasted into GitHub sometimes carry a trailing line break; trim everything, as announce.js does.
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
const file = process.argv[2];
const dry = process.argv.includes('--dry-run');
if (!file) { console.error('usage: node scripts/thread.js <file.md> [--dry-run]'); process.exit(2); }
const x = env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
  ? { consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET } : null;

let text = await readFile(file, 'utf8');
const image = text.match(/^image:\s*(\S+)\s*$/m)?.[1] || null;
text = text.replace(/^image:.*$/m, '');
const posts = text.split(/^\s*---\s*$/m).map((p) => p.trim()).filter(Boolean);
const length = (p) => p.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
let bad = false;
posts.forEach((p, i) => { const n = length(p); console.log(`${i + 1}/${posts.length} (${n}) ${p.split('\n')[0].slice(0, 70)}`); if (n > X_MAX) { bad = true; console.error(`  post ${i + 1} is ${n} characters; the limit is ${X_MAX}`); } });
if (bad) process.exit(1);
if (dry) { console.log('dry run: nothing posted'); process.exit(0); }
if (!x) { console.error('no X credentials'); process.exit(1); }

async function uploadImage(url) {
  try {
    const img = await fetch(url, { headers: { 'User-Agent': 'GloriousAnchor/1.0' } });
    if (!img.ok) throw new Error(`image ${img.status}`);
    const bytes = await img.arrayBuffer();
    const type = img.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const attempt = async (u, extra = {}) => {
      const form = new FormData(); form.append('media', new Blob([bytes], { type }), 'picture.jpg');
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      const res = await fetch(u, { method: 'POST', headers: { authorization: oauthHeader({ method: 'POST', url: u, ...x }) }, body: form });
      const t = await res.text(); if (!res.ok) throw new Error(`${res.status}: ${t.slice(0, 160)}`);
      const j = JSON.parse(t); return j.data?.id || j.media_id_string || null;
    };
    try { return await attempt('https://api.x.com/2/media/upload', { media_category: 'tweet_image', media_type: type }); }
    catch (err) { console.warn(`  (v2 media upload failed: ${err.message}; trying v1.1)`); return await attempt('https://upload.twitter.com/1.1/media/upload.json'); }
  } catch (err) { console.warn(`  (picture skipped: ${err.message})`); return null; }
}

let replyTo = null;
const mediaId = image ? await uploadImage(image) : null;
for (const [i, p] of posts.entries()) {
  const url = 'https://api.twitter.com/2/tweets';
  const body = { text: p, ...(i === 0 && mediaId ? { media: { media_ids: [mediaId] } } : {}), ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: oauthHeader({ method: 'POST', url, ...x }) }, body: JSON.stringify(body) });
  const t = await res.text();
  if (!res.ok) { console.error(`  ✗ post ${i + 1}: X ${res.status}: ${t.slice(0, 200)}`); process.exit(1); }
  replyTo = JSON.parse(t).data.id; console.log(`  ✓ post ${i + 1}: https://x.com/i/status/${replyTo}`);
  await new Promise((r) => setTimeout(r, 1500));
}
