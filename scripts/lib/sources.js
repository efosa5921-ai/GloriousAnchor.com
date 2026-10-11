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
 */

export const YT_FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const CHANNEL_ID = /UC[0-9A-Za-z_-]{22}/;

export function staticFeedUrl(source) {
  switch (source.type || 'rss') {
    case 'rss':
      return source.url || null;
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
  const patterns = [
    /"channelId":"(UC[0-9A-Za-z_-]{22})"/,
    /"externalId":"(UC[0-9A-Za-z_-]{22})"/,
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/,
    /feeds\/videos\.xml\?channel_id=(UC[0-9A-Za-z_-]{22})/,
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
export async function resolveFeedUrl(source, cache, fetchText) {
  const direct = staticFeedUrl(source);
  if (direct) return direct;
  if (source.type === 'youtube' && source.handle) {
    const key = `youtube:${source.handle.toLowerCase()}`;
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
