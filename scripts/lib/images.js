/**
 * Missing pictures: when a feed item has no image, the article page usually names one for sharing (og:image).
 * We fetch that once per URL, remember it for a week (hits and misses), and skip anything that is plainly a logo.
 */
import { parseOpenGraph } from './picks.js';
import { AD_IMAGE_RE } from './articles.js';

export const OG_TTL_MS = 7 * 24 * 3600 * 1000;
const LOGO_RE = /logo|favicon|\/icon|icon[-_.]|avatar|placeholder|default[-_.]?(img|image)|sprite|badge|1x1|pixel/i;

export function looksLikeLogo(url) {
  if (!url) return true;
  let path = url;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { /* keep raw */ }
  return LOGO_RE.test(url) || AD_IMAGE_RE.test(path);
}

/** Which stories are worth a page fetch: ordinary news and articles without a picture, or with one scraped from the article HTML (possibly an advert). */
export function wantsImage(a) {
  return (!a.image || a.imageFromBody === true) && !a.internal && ['news', 'article'].includes(a.kind || 'news') && /^https?:/.test(a.url || '');
}

/**
 * Fill in images from each article page's Open Graph tags.
 * cache: { [url]: { image: string|null, at: number } } — mutated in place; returns { fetched, filled }.
 */
export async function fillMissingImages(articles, cache, { fetchText, now = Date.now(), maxFetches = 60, concurrency = 6, timeoutMs = 8000 } = {}) {
  // Stories with no picture at all go first; upgrades of body-scraped pictures use whatever budget is left.
  const todo = articles.filter(wantsImage).sort((a, b) => Number(Boolean(a.image)) - Number(Boolean(b.image)));
  let fetched = 0, filled = 0;
  const queue = [];
  const apply = (a, image) => { if (image) { a.image = image; delete a.imageFromBody; filled++; } };
  for (const a of todo) {
    const hit = cache[a.url];
    if (hit && now - hit.at < OG_TTL_MS) { apply(a, hit.image); continue; }
    if (queue.length < maxFetches) queue.push(a);
  }
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const a = queue[i++];
      let image = null;
      try {
        const html = await fetchText(a.url, timeoutMs);
        const og = parseOpenGraph(html, a.url);
        image = og.image && !looksLikeLogo(og.image) ? og.image : null;
      } catch { image = null; }
      fetched++;
      cache[a.url] = { image, at: now };
      apply(a, image);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  // Forget stale entries so the cache stays small.
  for (const [url, v] of Object.entries(cache)) if (now - v.at > OG_TTL_MS * 2) delete cache[url];
  return { fetched, filled };
}
