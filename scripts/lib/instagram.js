/**
 * Instagram via Meta's official Graph API ("Business Discovery").
 * Returns the public posts of any Business or Creator account by username. No cookies, no scraping.
 *
 * Needs two environment variables (GitHub Actions secrets):
 *   IG_USER_ID       your own Instagram professional account id (numeric)
 *   IG_ACCESS_TOKEN  a Page access token for the Facebook Page linked to that account (does not expire)
 * Run `node scripts/instagram-setup.js` once to obtain both. See server/README.md → Instagram.
 */
import { expandEnv } from './sources.js';

export const GRAPH = 'https://graph.facebook.com/v21.0';
const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count';

export function businessDiscoveryUrl(username, igUserId, token, limit = 25) {
  const u = String(username).replace(/^@/, '').trim();
  if (!/^[\w.]{1,30}$/.test(u)) throw new Error(`instagram: invalid username "${username}"`);
  const fields = `business_discovery.username(${u}){username,name,profile_picture_url,media.limit(${limit}){${FIELDS}}}`;
  return `${GRAPH}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
}

/** Convert a Business Discovery response into rss-parser-shaped items so normaliseItem() can handle them. */
export function instagramToItems(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data?.error) throw new Error(`instagram: ${data.error.message || 'API error'}${data.error.code ? ` (code ${data.error.code})` : ''}`);
  const bd = data?.business_discovery;
  if (!bd) throw new Error('instagram: no business_discovery in response (is the account a Business/Creator account?)');
  const items = [];
  for (const m of bd.media?.data || []) {
    if (!m.permalink) continue;
    const caption = (m.caption || '').trim();
    const firstLine = caption.split('\n').find((l) => l.trim()) || '';
    const isVideo = m.media_type === 'VIDEO';
    const image = isVideo ? (m.thumbnail_url || m.media_url) : m.media_url;
    items.push({
      title: firstLine.slice(0, 160) || (isVideo ? 'Reel' : 'Post'),
      link: m.permalink,
      guid: m.id,
      isoDate: m.timestamp,
      contentSnippet: caption,
      creator: '@' + (m.username || bd.username || ''),
      mediaThumbnail: image ? [{ $: { url: image, width: '1080' } }] : [],
      igType: m.media_type,
    });
  }
  return { title: bd.name || bd.username, link: `https://www.instagram.com/${bd.username}/`, items };
}

export async function fetchInstagramItems(source, fetchText, env = process.env) {
  const igUserId = expandEnv('${IG_USER_ID}', env);
  const token = expandEnv('${IG_ACCESS_TOKEN}', env);
  if (!igUserId || !token) throw new Error('instagram not configured (set IG_USER_ID and IG_ACCESS_TOKEN)');
  const username = source.username || source.handle;
  if (!username) throw new Error(`instagram source ${source.id} needs a "username"`);
  const body = await fetchText(businessDiscoveryUrl(username, igUserId, token, source.limit || 25));
  return instagramToItems(body);
}
