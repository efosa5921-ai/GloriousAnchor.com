/**
 * Picks: hand-chosen single URLs (articles, posts, videos) listed in picks.json.
 * Each URL is "unfurled" at build time into a card using the page's Open Graph tags,
 * or a public oEmbed endpoint for X, TikTok and YouTube. Manual fields in picks.json
 * always override what was fetched (needed for Instagram and Facebook, which block bots).
 */
import { stripHtml, truncate, cleanUrl, makeId } from './articles.js';

export const PICKS_SOURCE = { id: 'picks', name: 'Picks', category: 'picks', kind: 'pick', featured: true, homepage: null };
export const PICKS_TTL_MS = 7 * 24 * 3600 * 1000;
const PLATFORMS = new Set(['X', 'Instagram', 'Facebook', 'TikTok', 'YouTube', 'Threads', 'Bluesky', 'Substack']);

export function providerFor(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\.|^m\.|^mobile\./, ''); } catch { return 'Web'; }
  if (/^(x\.com|twitter\.com)$/.test(host)) return 'X';
  if (host.endsWith('instagram.com')) return 'Instagram';
  if (host.endsWith('facebook.com') || host === 'fb.watch') return 'Facebook';
  if (host.endsWith('tiktok.com')) return 'TikTok';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube';
  if (host.endsWith('threads.net')) return 'Threads';
  if (host.endsWith('bsky.app')) return 'Bluesky';
  if (host.endsWith('substack.com')) return 'Substack';
  return host;
}

export function strategyFor(url) {
  const p = providerFor(url);
  if (p === 'X') return 'twitter';
  if (p === 'TikTok') return 'tiktok';
  if (p === 'YouTube') return 'youtube';
  return 'html';
}

export function oembedUrl(url) {
  const enc = encodeURIComponent(url);
  switch (strategyFor(url)) {
    case 'twitter': return `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${enc}`;
    case 'tiktok': return `https://www.tiktok.com/oembed?url=${enc}`;
    case 'youtube': return `https://www.youtube.com/oembed?format=json&url=${enc}`;
    default: return null;
  }
}

function meta(html, names) {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
    const tag = html.match(re);
    if (!tag) continue;
    const content = tag[0].match(/content=["']([^"']*)["']/i);
    if (content && content[1].trim()) return stripHtml(content[1]);
  }
  return null;
}

export function parseOpenGraph(html, url) {
  if (!html) return {};
  const head = html.slice(0, 200000);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const image = meta(head, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  const canonical = head.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  let absImage = null;
  if (image) { try { absImage = new URL(image, url).toString(); } catch { absImage = null; } }
  return {
    title: meta(head, ['og:title', 'twitter:title']) || (titleTag ? stripHtml(titleTag[1]) : null),
    description: meta(head, ['og:description', 'twitter:description', 'description']),
    image: absImage,
    siteName: meta(head, ['og:site_name', 'application-name']),
    author: meta(head, ['author', 'article:author', 'twitter:creator']),
    publishedAt: meta(head, ['article:published_time', 'og:updated_time', 'date', 'datePublished']),
    canonical: canonical ? canonical[1] : null,
  };
}

export function parseOembed(json, strategy) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json) : json; } catch { return {}; }
  if (!data || typeof data !== 'object') return {};
  const out = { author: data.author_name || null, image: data.thumbnail_url || null, siteName: data.provider_name || null };
  if (strategy === 'twitter') {
    // X returns the tweet as HTML: <blockquote><p>text</p>— Name (@user) <a>date</a></blockquote>
    const p = String(data.html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.title = p ? stripHtml(p[1]) : null;
    const date = String(data.html || '').match(/<a[^>]*>([A-Z][a-z]+ \d{1,2}, \d{4})<\/a>/);
    if (date) out.publishedAt = date[1];
  } else {
    out.title = data.title || null;
  }
  return out;
}

/** Fetch metadata for one URL. `fetchText(url)` is injected (so fixtures and tests can stub it). */
export async function unfurl(url, fetchText) {
  const strategy = strategyFor(url);
  const oe = oembedUrl(url);
  if (oe) {
    try {
      const data = parseOembed(await fetchText(oe), strategy);
      if (data.title) return { ...data, strategy };
    } catch { /* fall through to HTML */ }
  }
  const html = await fetchText(url);
  return { ...parseOpenGraph(html, url), strategy: 'html' };
}

export function needsManualFields(url) {
  const p = providerFor(url);
  return p === 'Instagram' || p === 'Facebook' || p === 'Threads';
}

/** Turn a picks.json entry plus fetched data into an article object. */
export function pickToArticle(pick, fetched, firstSeen) {
  const url = cleanUrl(pick.url);
  if (!url) return null;
  const f = fetched || {};
  const title = stripHtml(pick.title || f.title || '');
  if (!title) return null;
  const provider = providerFor(url);
  const descr = stripHtml(pick.summary ?? f.description ?? '');
  const dateRaw = pick.added || pick.date || f.publishedAt;
  let publishedAt = dateRaw ? Date.parse(dateRaw) : NaN;
  if (Number.isNaN(publishedAt)) publishedAt = firstSeen || Date.now();
  return {
    id: makeId(url, title),
    title,
    url,
    summary: descr && descr.toLowerCase() !== title.toLowerCase() ? truncate(descr) : '',
    note: pick.note ? stripHtml(pick.note) : '',
    image: cleanUrl(pick.image || f.image) || null,
    author: stripHtml(pick.author || f.author || '') || null,
    publishedAt,
    kind: 'pick',
    source: pick.source || (PLATFORMS.has(provider) ? provider : (f.siteName || provider)),
    sourceId: PICKS_SOURCE.id,
    sourceHome: pick.homepage || null,
    category: PICKS_SOURCE.category,
    featured: true,
    pinned: Boolean(pick.pinned),
  };
}
