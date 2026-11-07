/**
 * Auto-posting: announce new items on a Telegram channel and on X.
 * Pure helpers here (selection, message text, OAuth 1.0a signing); scripts/announce.js does the network calls.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { shareUrl } from './share.js';

export const X_MAX = 280;
const URL_LEN = 23; // X counts every link as 23 characters

/** Which items to announce this run: every new own article and pick, plus a few fresh top stories. */
export function selectNew(articles, announced, { maxStories = 3, maxAgeHours = 24, now = Date.now() } = {}) {
  // An item's id changes with its title, so a retitled article is also recognised by its URL (see rememberUrls).
  const seen = new Set(Object.keys(announced));
  const fresh = articles.filter((a) => !seen.has(a.id) && !seen.has(`u:${a.url}`));
  const priority = fresh.filter((a) => a.internal || a.kind === 'pick');
  const cutoff = now - maxAgeHours * 3600 * 1000;
  const stories = fresh
    .filter((a) => !a.internal && a.kind !== 'pick' && a.kind !== 'social' && a.publishedAt >= cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt);
  const perSource = new Set(priority.map((a) => a.sourceId));
  const picked = [];
  for (const a of stories) { if (picked.length >= maxStories) break; if (perSource.has(a.sourceId)) continue; perSource.add(a.sourceId); picked.push(a); }
  return [...priority, ...picked];
}

/**
 * Record one item's outcome. It counts as announced as soon as any channel took it, so a failure on one channel
 * (X out of credits, say) never makes the other channel repeat the post on the next run. A failed X post goes into
 * `pending` to be retried on a later run; a successful one clears it.
 */
export function recordOutcome(announced, pending, a, results, now = Date.now()) {
  const attempted = Object.keys(results);
  const anyOk = attempted.some((k) => results[k]);
  if (anyOk || attempted.length === 0) announced[a.id] = now;
  if (results.X === false && anyOk) pending[a.id] = pending[a.id] || now;
  else if (results.X === true) delete pending[a.id];
}

/**
 * Articles whose subject was born or went home on this day: announced once a year, under an id of their own, with the
 * anniversary in front of the title. An article not yet announced at all is left to the ordinary new-item post.
 */
export function selectAnniversaries(articles, announced, { now = Date.now(), year = new Date(now).getUTCFullYear() } = {}) {
  return articles
    .filter((a) => a.internal && a.anniversary && announced[a.id] && !announced[`${a.id}@${year}`])
    .map((a) => ({ ...a, id: `${a.id}@${year}`, shareTitle: `${a.anniversaryHeadline}: ${postTitle(a)}` }));
}

/** Record the URL of every announced item, so that a change of title (and so of id) never announces it again. */
export function rememberUrls(articles, announced, now = Date.now()) {
  for (const a of articles) if (announced[a.id] && a.url) announced[`u:${a.url}`] = now;
}

/** Podcast feeds often title episodes by date or number alone; prefix the show name so a post never reads "23.10.26". */
export function postTitle(a) {
  if (a.shareTitle) return a.shareTitle;
  const bare = /^[\d\s.,/:#-]+$|^(ep(isode)?\.?\s*\d+|#\d+)$/i.test(a.title.trim());
  return bare && a.source ? `${a.source}: ${a.title.trim()}` : a.title;
}
export function telegramMessage(a, site) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const who = a.internal ? site.name : a.source;
  const tag = a.internal ? 'New on' : a.kind === 'pick' ? 'Our pick, via' : a.kind === 'video' ? 'Video via' : a.kind === 'audio' ? 'Listen via' : 'Via';
  return `<b>${esc(postTitle(a))}</b>\n${esc(who)} · ${tag} ${esc(site.name)}\n${esc(shareUrl(a, site))}`;
}

/** The item to repost: matched by id, by URL (article page or source link), or by a title fragment. */
export function findRepost(articles, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return null;
  const norm = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  return articles.find((a) => a.id === n)
    || articles.find((a) => norm(a.url) === norm(n) || (a.slug && norm(n).endsWith(`/articles/${a.slug}`)))
    || articles.find((a) => String(a.title || '').toLowerCase().includes(n))
    || null;
}

export function xText(a, site) {
  const who = a.internal ? '' : ` — ${a.source}`;
  const handle = site.xHandle ? ` via @${site.xHandle.replace(/^@/, '')}` : '';
  const link = shareUrl(a, site);
  const tail = `${who}${handle}\n${link}`;
  const room = X_MAX - (tail.length - link.length + URL_LEN) - 1;
  const full = postTitle(a);
  const title = full.length > room ? `${full.slice(0, Math.max(0, room - 1)).trimEnd()}…` : full;
  return `${title}${tail}`;
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a HMAC-SHA1 Authorization header (what X's v2 "create tweet" endpoint accepts for a single account). */
export function oauthHeader({ method, url, params = {}, consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all).map((k) => [enc(k), enc(all[k])]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const baseString = [method.toUpperCase(), enc(url), enc(paramString)].join('&');
  const key = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', key).update(baseString).digest('base64');
  return `OAuth ${Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ')}`;
}
