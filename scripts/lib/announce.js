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
  const seen = new Set(Object.keys(announced));
  const fresh = articles.filter((a) => !seen.has(a.id));
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

export function telegramMessage(a, site) {
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const who = a.internal ? site.name : a.source;
  const tag = a.internal ? 'New on' : a.kind === 'pick' ? 'Our pick, via' : a.kind === 'video' ? 'Video via' : a.kind === 'audio' ? 'Listen via' : 'Via';
  return `<b>${esc(a.title)}</b>\n${esc(who)} · ${tag} ${esc(site.name)}\n${esc(shareUrl(a, site))}`;
}

export function xText(a, site) {
  const who = a.internal ? '' : ` — ${a.source}`;
  const handle = site.xHandle ? ` via @${site.xHandle.replace(/^@/, '')}` : '';
  const link = shareUrl(a, site);
  const tail = `${who}${handle}\n${link}`;
  const room = X_MAX - (tail.length - link.length + URL_LEN) - 1;
  const title = a.title.length > room ? `${a.title.slice(0, Math.max(0, room - 1)).trimEnd()}…` : a.title;
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
