/**
 * Drop YouTube videos that have gone away. Churches often stream a service, then make the recording private or
 * delete it; the feed entry lingers for days and YouTube serves a grey "no thumbnail" placeholder for it.
 * YouTube's oEmbed endpoint answers 401 for private and 404 for deleted videos (403 means embedding is off,
 * which is fine). Results are cached: fresh videos are re-checked every 12 hours for 3 days, since a stream is
 * usually hidden soon after it ends; a video found missing stays out for 14 days.
 */
export const OEMBED = (id) => `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
const HOUR = 3600 * 1000;
const RECHECK_MS = 12 * HOUR, FRESH_MS = 3 * 24 * HOUR, GONE_MS = 14 * 24 * HOUR, STALE_MS = 30 * 24 * HOUR;

export function needsCheck(entry, article, now) {
  if (!entry) return true;
  if (!entry.ok) return now - entry.at > GONE_MS;
  const fresh = (article.publishedAt || 0) > now - FRESH_MS;
  return fresh ? now - entry.at > RECHECK_MS : now - entry.at > STALE_MS;
}

/**
 * @param articles  all items; only kind "video" with a videoId are considered
 * @param cache     mutable map videoId -> { ok, status, at }
 * @param fetchStatus async (url) => HTTP status number (throws on network failure)
 */
export async function dropGoneVideos(articles, cache, { fetchStatus, now = Date.now(), concurrency = 6, maxChecks = 150 } = {}) {
  const candidates = articles.filter((a) => a.kind === 'video' && a.videoId);
  const toCheck = candidates.filter((a) => needsCheck(cache[a.videoId], a, now)).slice(0, maxChecks);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, toCheck.length) }, async () => {
    while (i < toCheck.length) {
      const a = toCheck[i++];
      try {
        const status = await fetchStatus(OEMBED(a.videoId));
        cache[a.videoId] = { ok: !(status === 401 || status === 404), status, at: now };
      } catch { /* network trouble: leave it unknown and keep the video */ }
    }
  });
  await Promise.all(workers);
  const gone = new Set(candidates.filter((a) => cache[a.videoId] && !cache[a.videoId].ok).map((a) => a.id));
  for (const id of Object.keys(cache)) if (now - (cache[id].at || 0) > STALE_MS + GONE_MS) delete cache[id];
  return { kept: articles.filter((a) => !gone.has(a.id)), dropped: articles.filter((a) => gone.has(a.id)), checked: toCheck.length };
}
