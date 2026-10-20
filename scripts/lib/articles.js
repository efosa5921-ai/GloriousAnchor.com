/**
 * Pure helpers for turning raw feed items into normalised articles.
 * Kept free of I/O so they can be unit-tested.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$|src$|cmp$|ns_|at_)/i;

export const KINDS = ['news', 'article', 'video', 'social', 'pick', 'audio'];

export function cleanUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)])/g, '$1') // "para ." → "para." after a closing tag
    .trim();
}

export function truncate(text, max = 220) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–—]$/, '') + '…';
}

/** Pictures that are not the story: adverts, banners, buttons, badges, logos, avatars, tracking pixels. */
export const AD_IMAGE_RE = /(^|[^a-z])(ads?|advert\w*|adserver|adsystem|banner\w*|promo\w*|sponsor\w*|affiliate|doubleclick|googlesyndication|taboola|outbrain|widget|button|badge|icon|logo|avatar|gravatar|share|social|subscribe|donate|newsletter|signup|sign-up|cta|pixel|tracker|counter|1x1|feedburner|emoji|spacer|blank|placeholder)([^a-z]|$)/i;
const AD_TEXT_RE = /\b(ad|ads|advert\w*|advertisement|banner|sponsor\w*|promo\w*|subscribe|donate|logo|avatar|badge|button|icon)\b/i;

/** The first <img> in article HTML that looks like a real picture: not an ad, banner, logo or tiny decoration. */
export function firstImageFromHtml(html) {
  if (!html) return null;
  for (const m of String(html).matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    const src = attrs.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (!src || /^data:/i.test(src)) continue;
    const num = (name) => { const v = attrs.match(new RegExp(`\\s${name}=["']?(\\d+)`, 'i'))?.[1]; return v ? Number(v) : null; };
    const w = num('width'), h = num('height');
    if ((w !== null && w < 200) || (h !== null && h < 120)) continue; // thumbnails, icons, pixels, skyscraper ads
    const alt = attrs.match(/\salt=["']([^"']*)["']/i)?.[1] || '';
    const cls = attrs.match(/\sclass=["']([^"']*)["']/i)?.[1] || '';
    if (AD_TEXT_RE.test(alt) || AD_TEXT_RE.test(cls)) continue;
    let path = src;
    try { path = decodeURIComponent(new URL(src, 'https://x/').pathname); } catch { /* keep raw */ }
    if (AD_IMAGE_RE.test(path) || /\b\d{2,4}x\d{2,4}\b/.test(path) && /\b(728x90|300x250|320x50|160x600|970x250|300x600|468x60)\b/.test(path)) continue;
    return src;
  }
  return null;
}

function mediaAttrs(m) {
  // xml2js gives either { $: {...attrs} } or a plain attrs object depending on nesting.
  if (!m) return null;
  if (m.$) return m.$;
  if (typeof m === 'object' && m.url) return m;
  return null;
}

export function extractImage(item, info = null) {
  const candidates = [];
  const pushMedia = (arr) => {
    for (const m of [].concat(arr || [])) {
      const attrs = mediaAttrs(m);
      if (attrs?.url) {
        const type = attrs.type || attrs.medium || '';
        if (!type || /image/.test(type)) candidates.push({ url: attrs.url, width: Number(attrs.width) || 0 });
      }
    }
  };
  pushMedia(item.mediaContent);
  pushMedia(item.mediaThumbnail);
  if (item.mediaGroup) {
    pushMedia(item.mediaGroup['media:content']);
    pushMedia(item.mediaGroup['media:thumbnail']);
  }
  if (item.enclosure?.url && (!item.enclosure.type || /^image\//.test(item.enclosure.type))) {
    candidates.push({ url: item.enclosure.url, width: 0 });
  }
  if (item.itunes?.image) candidates.push({ url: item.itunes.image, width: 0 });
  const fromHtml = firstImageFromHtml(item.contentEncoded) || firstImageFromHtml(item.content) || firstImageFromHtml(item.description);
  if (fromHtml) candidates.push({ url: fromHtml, width: 0, body: true });

  // YouTube: derive a thumbnail from the video id if the feed carried none.
  const vid = youtubeVideoId(item);
  if (vid) candidates.push({ url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, width: -1 });

  candidates.sort((a, b) => b.width - a.width);
  for (const c of candidates) {
    const url = cleanUrl(c.url);
    if (url && !/\.(gif|svg)(\?|$)/i.test(url) && !/pixel|tracker|1x1|feedburner|doubleclick|emoji/i.test(url)) {
      if (info) info.body = Boolean(c.body);
      return url;
    }
  }
  return null;
}

export function youtubeVideoId(item) {
  if (item['yt:videoId']) return String(item['yt:videoId']);
  const id = String(item.id || item.guid || '');
  const m = id.match(/^yt:video:([\w-]{11})$/);
  if (m) return m[1];
  const l = String(item.link || '').match(/[?&]v=([\w-]{11})/);
  return l ? l[1] : null;
}

export function parseDate(item) {
  const raw = item.isoDate || item.pubDate || item.published || item.updated || item['dc:date'];
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  // Reject dates more than 1 day in the future (misconfigured feeds).
  if (t > Date.now() + 86400000) return null;
  return t;
}

export function makeId(url, title) {
  // Deterministic, short id suitable for keys and bookmarks.
  let h = 2166136261;
  const s = (url || '') + '|' + (title || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

export function normaliseTitle(title) {
  return stripHtml(title)
    .toLowerCase()
    .replace(/[’'"“”‘]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REDDIT_BOILERPLATE = /\s*submitted by\s+\/u\/\S+.*$/i;

export function normaliseItem(item, source, feed) {
  const kind = KINDS.includes(source.kind) ? source.kind : 'news';
  const url = cleanUrl(item.link || (typeof item.guid === 'string' ? item.guid : null));
  const bodyHtml = item.contentEncoded || item.content || item.description || item.summary || '';
  const mediaDesc = item.mediaGroup?.['media:description'];
  const bodyText = stripHtml(
    item.contentSnippet || (Array.isArray(mediaDesc) ? mediaDesc[0] : mediaDesc) || bodyHtml,
  ).replace(REDDIT_BOILERPLATE, '').trim();

  let title = stripHtml(item.title);
  // Social posts often have no title: use the post text itself.
  if (!title && kind === 'social' && bodyText) title = truncate(bodyText, 160);
  if (!url || !title) return null;

  const publishedAt = parseDate(item) ?? Date.now();
  let summary = kind === 'social' && title.startsWith(bodyText.slice(0, Math.min(40, bodyText.length)))
    ? '' // the title already *is* the post
    : truncate(bodyText);
  if (summary && summary.toLowerCase() === title.toLowerCase()) summary = '';

  const author = stripHtml(item.creator || item.dcCreator || item.author?.name || item.author || '') || null;

  const imageInfo = {};
  const image = extractImage(item, imageInfo);
  return {
    id: makeId(url, title),
    title,
    url,
    summary,
    image,
    // A picture scraped from the article's own HTML may be an advert or a banner; the page's og:image is preferred when it can be fetched.
    ...(image && imageInfo.body ? { imageFromBody: true } : {}),
    author,
    publishedAt,
    kind,
    source: source.name,
    sourceId: source.id,
    sourceHome: source.homepage || (feed && feed.link) || null,
    category: (source.categories && source.categories[0]) || source.category,
    categories: source.categories && source.categories.length > 1 ? source.categories : undefined,
    featured: Boolean(source.featured),
    videoId: kind === 'video' ? youtubeVideoId(item) : undefined,
    audio: kind === 'audio' ? audioEnclosure(item) : undefined,
    duration: kind === 'audio' ? parseDuration(item.itunes?.duration) : undefined,
  };
}

export function audioEnclosure(item) {
  const e = item.enclosure;
  if (e?.url && (/^audio\//.test(e.type || '') || /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(e.url))) return cleanUrl(e.url);
  for (const m of [].concat(item.mediaContent || [])) { const a = m?.$ || m; if (a?.url && /^audio\//.test(a.type || '')) return cleanUrl(a.url); }
  return null;
}

/** itunes:duration as seconds: "3600", "1:02:03" or "45:10". */
export function parseDuration(d) {
  if (d == null) return undefined;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Collapse exact-URL duplicates and near-duplicate titles from the same source.
 * Newest copy wins.
 */
export function dedupe(articles) {
  const byUrl = new Set();
  const byTitle = new Set();
  const out = [];
  const sorted = [...articles].sort((a, b) => b.publishedAt - a.publishedAt);
  for (const a of sorted) {
    const urlKey = a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    if (byUrl.has(urlKey)) continue;
    const titleKey = a.sourceId + '::' + normaliseTitle(a.title);
    if (byTitle.has(titleKey)) continue;
    byUrl.add(urlKey);
    byTitle.add(titleKey);
    out.push(a);
  }
  return out;
}

/**
 * Combine freshly fetched articles with the previous build's articles.
 * - Fresh articles always win.
 * - Previous articles from any still-configured source are kept while within cutoff,
 *   so a feed outage or a short feed never blanks a section.
 * - Anything older than cutoff, or from a source removed from config, is dropped.
 */
export function mergeWithPrevious(fresh, previous, sourceStatus, cutoff) {
  const knownSources = new Set(sourceStatus.map((s) => s.id));
  const freshIds = new Set(fresh.map((a) => a.id));
  const kept = fresh.filter((a) => a.publishedAt >= cutoff);
  for (const p of previous) {
    if (!p || typeof p !== 'object') continue;
    if (!knownSources.has(p.sourceId)) continue;
    if (p.publishedAt < cutoff) continue;
    if (freshIds.has(p.id)) continue;
    kept.push(p);
  }
  return kept;
}

/** Trim what the browser downloads: shorter summaries, no per-item fields the page can look up from meta.sources. */
export function slimArticle(a, summaryMax = 160) {
  const out = { id: a.id, title: a.title, url: a.url, summary: a.summary ? truncate(a.summary, summaryMax) : '', image: a.image || null, author: a.author || null,
    publishedAt: a.publishedAt, kind: a.kind, source: a.source, sourceId: a.sourceId, category: a.category };
  if (a.categories) out.categories = a.categories;
  if (a.audio) out.audio = a.audio;
  if (a.duration) out.duration = a.duration;
  if (a.pinned) out.pinned = true;
  if (a.internal) out.internal = true;
  if (a.note) out.note = a.note;
  return out;
}

/** Keep at most `perSource` items per feed and `max` overall (newest first); picks and our own articles are never dropped. */
export function capOutput(articles, perSource = 15, max = 700) {
  const counts = new Map();
  const out = [];
  for (const a of articles) {
    const exempt = a.sourceId === 'picks' || a.sourceId === 'ours';
    const n = counts.get(a.sourceId) || 0;
    if (!exempt && n >= perSource) continue;
    counts.set(a.sourceId, n + 1);
    out.push(a);
  }
  const exempt = out.filter((a) => a.sourceId === 'picks' || a.sourceId === 'ours');
  const rest = out.filter((a) => !(a.sourceId === 'picks' || a.sourceId === 'ours')).slice(0, Math.max(0, max - exempt.length));
  return [...exempt, ...rest].sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Drop stories the owner has hidden: each entry in the list is a story id (as in /s/<id>/) or a link; a link matches
 * when the story's address starts with it (so a whole section of a site can be hidden with one entry).
 */
export function applyHidden(articles, hidden) {
  const list = (Array.isArray(hidden) ? hidden : []).map((h) => String(h || '').trim()).filter(Boolean);
  if (!list.length) return articles;
  const norm = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
  const ids = new Set(list.filter((h) => !/[./]/.test(h)));
  const prefixes = list.filter((h) => /[./]/.test(h)).map((h) => norm(h.replace(/^https?:\/\/(www\.)?gloriousanchor\.com\/s\/([^/]+)\/?$/i, '$2')));
  const ids2 = new Set(prefixes.filter((p) => !/[./]/.test(p)));
  return articles.filter((a) => !ids.has(a.id) && !ids2.has(a.id) && !prefixes.some((p) => /[./]/.test(p) && norm(a.url).startsWith(p)));
}
