/**
 * Turns a source entry from feeds.json into a concrete feed URL.
 *
 * Supported `type`s:
 *   rss      (default) `url` is the feed.
 *   youtube  `channelId` (UC…) or `handle` (@name). Handles are resolved to a channel id by
 *            fetching the channel page once; results are cached in dist/data/resolved.json.
 *   reddit   `subreddit` → https://www.reddit.com/r/<sub>/hot/.rss
 *   bluesky  `handle` (e.g. example.bsky.social or a custom domain) → https://bsky.app/profile/<handle>/rss
 *   mastodon `instance` + `user` → https://<instance>/@<user>.rss
 *   rsshub   `route` on your self-hosted RSSHub (X, Instagram, TikTok, Facebook pages, …)
 *   rssbridge `bridge` + `params` on your self-hosted RSS-Bridge
 *   instagram `username` via Meta's official Graph API (needs IG_USER_ID + IG_ACCESS_TOKEN; see lib/instagram.js)
 * Any source may carry `"enabled": false` to keep it in the file without fetching it.
 */

export const YT_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const CHANNEL_ID = /UC[0-9A-Za-z_-]{22}/;

/** Replace ${VAR} with process.env.VAR (empty string when unset). */
export function expandEnv(str, env = process.env) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, k) => env[k] ?? '');
}

/**
 * Self-hosted feed services (see server/README.md). Configured in feeds.json under `services`,
 * values may reference environment variables, e.g. "url": "${FEEDS_SERVER_URL}/rsshub".
 */
export function serviceUrl(services, name, env = process.env) {
  const svc = services?.[name];
  if (!svc || typeof svc !== 'object' || typeof svc.url !== 'string') return null; // ignores "_help" notes etc.
  const url = expandEnv(svc.url, env).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/i.test(url)) return null; // unset ${VAR} leaves a relative path: treat as not configured
  return { url, key: expandEnv(svc.key || '', env) };
}

export function staticFeedUrl(source, services, env = process.env) {
  switch (source.type || 'rss') {
    case 'rss':
      return expandEnv(source.url, env) || null;
    case 'rsshub': {
      // RSSHub route, e.g. "/twitter/user/BibleProject" or "/tiktok/user/@bibleproject"
      const svc = serviceUrl(services, 'rsshub', env);
      if (!svc) throw new Error('rsshub service not configured (set FEEDS_SERVER_URL)');
      if (!source.route?.startsWith('/')) throw new Error('rsshub source needs a "route" starting with /');
      const u = new URL(svc.url + source.route);
      if (svc.key) u.searchParams.set('key', svc.key);
      for (const [k, v] of Object.entries(source.params || {})) u.searchParams.set(k, expandEnv(String(v), env));
      return u.toString();
    }
    case 'rssbridge': {
      // RSS-Bridge bridge, e.g. "bridge": "Instagram", "params": { "context": "Username", "u": "bibleproject" }
      const svc = serviceUrl(services, 'rssbridge', env);
      if (!svc) throw new Error('rssbridge service not configured (set FEEDS_SERVER_URL)');
      if (!source.bridge) throw new Error('rssbridge source needs a "bridge" name');
      const u = new URL(svc.url + '/');
      u.searchParams.set('action', 'display');
      u.searchParams.set('bridge', source.bridge);
      u.searchParams.set('format', 'Atom');
      for (const [k, v] of Object.entries(source.params || {})) u.searchParams.set(k, expandEnv(String(v), env));
      return u.toString();
    }
    case 'youtube':
      return source.channelId && CHANNEL_ID.test(source.channelId) ? YT_FEED + source.channelId : null;
    case 'reddit':
      return source.subreddit ? `https://www.reddit.com/r/${encodeURIComponent(source.subreddit)}/hot/.rss` : null;
    case 'bluesky':
      return source.handle ? `https://bsky.app/profile/${encodeURIComponent(source.handle.replace(/^@/, ''))}/rss` : null;
    case 'mastodon':
      return source.instance && source.user
        ? `https://${source.instance}/@${encodeURIComponent(source.user.replace(/^@/, ''))}.rss`
        : null;
    default:
      return null;
  }
}

export function homepageFor(source) {
  if (source.homepage) return source.homepage;
  switch (source.type) {
    case 'rsshub':
    case 'rssbridge':
      return source.profile || null;
    case 'instagram':
      return `https://www.instagram.com/${String(source.username || source.handle || '').replace(/^@/, '')}/`;
    case 'youtube':
      return source.handle ? `https://www.youtube.com/${source.handle.startsWith('@') ? source.handle : '@' + source.handle}` :
        source.channelId ? `https://www.youtube.com/channel/${source.channelId}` : 'https://www.youtube.com';
    case 'reddit':
      return `https://www.reddit.com/r/${source.subreddit}/`;
    case 'bluesky':
      return `https://bsky.app/profile/${source.handle.replace(/^@/, '')}`;
    case 'mastodon':
      return `https://${source.instance}/@${source.user.replace(/^@/, '')}`;
    default:
      try { return new URL(source.url).origin; } catch { return null; }
  }
}

/** Extract a YouTube channel id from a channel page's HTML. */
export function channelIdFromHtml(html) {
  if (!html) return null;
  // Order matters: the page's canonical link and externalId name *this* channel; the first
  // "channelId" in the page data can belong to a featured or related channel.
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/,
    /<meta itemprop="identifier" content="(UC[0-9A-Za-z_-]{22})"/,
    /"externalId":"(UC[0-9A-Za-z_-]{22})"/,
    /feeds\/videos\.xml\?channel_id=(UC[0-9A-Za-z_-]{22})/,
    /"channelId":"(UC[0-9A-Za-z_-]{22})"/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Resolve a source to a feed URL, using (and updating) `cache` for YouTube handles.
 * `fetchText(url)` is injected so this stays testable.
 */
export function youtubeCacheKey(source) {
  return source.type === 'youtube' && source.handle ? `youtube:${source.handle.toLowerCase()}` : null;
}

export async function resolveFeedUrl(source, cache, fetchText, services) {
  const direct = staticFeedUrl(source, services);
  if (direct) return direct;
  if (source.type === 'youtube' && source.handle) {
    const key = youtubeCacheKey(source);
    if (cache[key] && CHANNEL_ID.test(cache[key])) return YT_FEED + cache[key];
    const handle = source.handle.startsWith('@') ? source.handle : '@' + source.handle;
    const html = await fetchText(`https://www.youtube.com/${handle}`);
    const id = channelIdFromHtml(html);
    if (!id) throw new Error(`could not resolve YouTube handle ${handle}`);
    cache[key] = id;
    return YT_FEED + id;
  }
  throw new Error(`source ${source.id}: cannot build a feed URL (type=${source.type || 'rss'})`);
}

/**
 * Feed auto-discovery: find <link rel="alternate" type="application/rss+xml|atom+xml"> tags in a page,
 * plus a few conventional paths, so a wrong feed URL can heal itself from the site's homepage.
 */
export function feedLinksFromHtml(html, baseUrl) {
  const out = [];
  if (html) {
    const re = /<link\b[^>]*>/gi;
    for (const tag of String(html).slice(0, 300000).match(re) || []) {
      if (!/rel=["'][^"']*alternate[^"']*["']/i.test(tag)) continue;
      if (!/type=["'][^"']*(rss|atom|feed)[^"']*["']/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i);
      if (!href) continue;
      try { out.push(new URL(href[1], baseUrl).toString()); } catch { /* skip */ }
    }
  }
  return [...new Set(out)];
}

export function conventionalFeedPaths(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    return ['/feed/', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feeds/posts/default'].map((p) => origin + p);
  } catch { return []; }
}

/** URL that fetches `url` through the self-hosted relay, or null when no relay is configured. */
export function relayUrl(services, url, env = process.env) {
  const svc = serviceUrl(services, 'relay', env);
  if (!svc || !svc.key) return null;
  const u = new URL(svc.url + '/');
  u.searchParams.set('key', svc.key);
  u.searchParams.set('url', url);
  return u.toString();
}
