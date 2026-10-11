/**
 * Fallbacks: a source may list alternative ways to fetch the same account/site.
 *   { "id": "x-bp", "type": "rsshub", "route": "/twitter/user/BibleProject",
 *     "fallbacks": [ { "type": "rssbridge", "bridge": "Twitter", "params": { "context": "By username", "u": "BibleProject" } },
 *                    { "url": "https://rss.app/feeds/XXXX.xml" } ] }
 * Each fallback inherits id/name/category/kind from the primary; its own keys replace the primary's fetch settings.
 */
const FETCH_KEYS = ['type', 'url', 'route', 'params', 'bridge', 'handle', 'channelId', 'subreddit', 'instance', 'user', 'username', 'limit'];

export function candidatesFor(source) {
  const base = { ...source };
  delete base.fallbacks;
  const list = [base];
  for (const fb of source.fallbacks || []) {
    if (!fb || typeof fb !== 'object') continue;
    const c = { ...base };
    for (const k of FETCH_KEYS) delete c[k];
    list.push({ ...c, ...fb, type: fb.type || (fb.url ? 'rss' : base.type) });
  }
  return list;
}

/**
 * Try each candidate in order. `fetchOne(candidate, index)` resolves to a feed or throws.
 * Resolves to { feed, via, warnings } or { error } with every attempt's message.
 */
export async function fetchWithFallbacks(source, fetchOne) {
  const candidates = candidatesFor(source);
  const errors = [];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const feed = await fetchOne(candidates[i], i);
      return { feed, via: i, warnings: errors };
    } catch (err) {
      errors.push(`${i === 0 ? 'primary' : `fallback ${i}`}: ${String(err.message || err).split('\n')[0]}`);
    }
  }
  return { error: errors.join(' | ') };
}
