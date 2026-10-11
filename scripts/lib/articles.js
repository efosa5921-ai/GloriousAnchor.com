/**
 * Pure helpers for turning raw feed items into normalised articles.
 * Kept free of I/O so they can be unit-tested.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$|src$|cmp$|ns_|at_)/i;

export const KINDS = ['news', 'article', 'video', 'social', 'pick'];

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
    .trim();
}

export function truncate(text, max = 220) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–—]$/, '') + '…';
}

function firstImageFromHtml(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function mediaAttrs(m) {
  // xml2js gives either { $: {...attrs} } or a plain attrs object depending on nesting.
  if (!m) return null;
  if (m.$) return m.$;
  if (typeof m === 'object' && m.url) return m;
  return null;
}

export function extractImage(item) {
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
  if (fromHtml) candidates.push({ url: fromHtml, width: 0 });

  // YouTube: derive a thumbnail from the video id if the feed carried none.
  const vid = youtubeVideoId(item);
  if (vid) candidates.push({ url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, width: -1 });

  candidates.sort((a, b) => b.width - a.width);
  for (const c of candidates) {
    const url = cleanUrl(c.url);
    if (url && !/\.(gif|svg)(\?|$)/i.test(url) && !/pixel|tracker|1x1|feedburner|doubleclick|emoji/i.test(url)) return url;
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

  return {
    id: makeId(url, title),
    title,
    url,
    summary,
    image: extractImage(item),
    author,
    publishedAt,
    kind,
    source: source.name,
    sourceId: source.id,
    sourceHome: source.homepage || (feed && feed.link) || null,
    category: source.category,
    featured: Boolean(source.featured),
    videoId: kind === 'video' ? youtubeVideoId(item) : undefined,
  };
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
