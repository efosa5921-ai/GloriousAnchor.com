/**
 * YouTube Data API fallback for channel feeds.
 * YouTube's RSS feed server (youtube.com/feeds/videos.xml) answers GitHub's runners with sporadic 404s and 500s,
 * sometimes for most channels in a build. The official Data API is reliable and free: listing a channel's uploads
 * playlist costs 1 quota unit per call out of 10,000 a day. Needs a key in the YOUTUBE_API_KEY secret.
 */
export const API_BASE = 'https://www.googleapis.com/youtube/v3/playlistItems';

/** Every channel's uploads playlist id is its channel id with the "UC" prefix swapped for "UU". */
export function uploadsPlaylistId(channelId) {
  const id = String(channelId || '');
  return /^UC[\w-]{22}$/.test(id) ? `UU${id.slice(2)}` : null;
}

export function youtubeApiUrl(channelId, key, maxResults = 25) {
  const playlist = uploadsPlaylistId(channelId);
  if (!playlist || !key) return null;
  const u = new URL(API_BASE);
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('maxResults', String(Math.min(50, Math.max(1, maxResults))));
  u.searchParams.set('playlistId', playlist);
  u.searchParams.set('key', key);
  return u.toString();
}

/** Shape the API answer like a parsed YouTube RSS feed so the rest of the build needs no special case. */
export function apiToFeed(json, channelId) {
  const items = [];
  for (const it of json?.items || []) {
    const s = it.snippet || {};
    const id = s.resourceId?.videoId;
    if (!id || !s.title || s.title === 'Private video' || s.title === 'Deleted video') continue;
    const thumbs = Object.values(s.thumbnails || {}).filter((t) => t?.url).sort((a, b) => (b.width || 0) - (a.width || 0));
    items.push({
      id: `yt:video:${id}`,
      'yt:videoId': id,
      title: s.title,
      link: `https://www.youtube.com/watch?v=${id}`,
      isoDate: s.publishedAt,
      pubDate: s.publishedAt,
      author: s.videoOwnerChannelTitle || s.channelTitle || '',
      mediaGroup: {
        'media:description': [s.description || ''],
        'media:thumbnail': thumbs.map((t) => ({ $: { url: t.url, width: String(t.width || ''), height: String(t.height || '') } })),
      },
    });
  }
  const author = items[0]?.author || '';
  return { title: author, link: `https://www.youtube.com/channel/${channelId}`, items };
}
