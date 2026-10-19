#!/usr/bin/env node
/**
 * Build script for Glorious Anchor.
 *
 * 1. Reads feeds.json (sources, categories, services, limits) and picks.json (hand-picked URLs).
 * 2. Resolves each source to a feed URL (RSS, YouTube, Reddit, Bluesky, Mastodon, RSSHub, RSS-Bridge).
 * 3. Fetches every feed concurrently (or reads fixtures with --fixtures <dir>).
 * 4. Unfurls each pick into a card (Open Graph / oEmbed), cached for a week.
 * 5. Normalises, de-duplicates and sorts; merges with the previous build so an outage never blanks a section.
 * 6. Writes dist/ (static site) with data/articles.json, data/meta.json and caches.
 */
import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Parser from 'rss-parser';
import { normaliseItem, dedupe, mergeWithPrevious, slimArticle, capOutput } from './lib/articles.js';
import { resolveFeedUrl, homepageFor, serviceUrl, expandEnv, feedLinksFromHtml, conventionalFeedPaths, relayUrl, youtubeCacheKey } from './lib/sources.js';
import { unfurl, pickToArticle, needsManualFields, PICKS_SOURCE, PICKS_TTL_MS } from './lib/picks.js';
import { fetchInstagramItems } from './lib/instagram.js';
import { fetchWithFallbacks } from './lib/fallbacks.js';
import { computeHealth } from './lib/health.js';
import { compilePost, postToArticle, renderPostPage, renderIndexPage, renderFeed, OWN_SOURCE } from './lib/posts.js';
import { normaliseChurch, geocodeKey, nominatimUrl, parseNominatim } from './lib/churches.js';
import { subscribeHtml, followHtml, sitemapXml, homeJsonLd, churchJsonLd, prerenderCards, metaTags, churchSlug, base as siteBase } from './lib/seo.js';
import { readdir } from 'node:fs/promises';
import { shareUrl, renderSharePage, relatedStories } from './lib/share.js';
import { fillMissingImages } from './lib/images.js';
import { dropGoneVideos } from './lib/videos.js';
import { validateQuizzes, renderQuizPage } from './lib/quiz.js';
import { pickDigest, digestDate, digestText, digestHtml, renderDigestPage, renderDigestFeed, renderTopFeed } from './lib/digest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(DIST, 'data');

const args = process.argv.slice(2);
const fixturesDir = argValue('--fixtures');
const verbose = args.includes('--verbose');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : path.resolve(ROOT, args[i + 1]);
}

// A real browser user agent: several publishers (Substack, Desiring God, ...) answer 403 to anything that says "bot".
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, application/json;q=0.8, */*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'dcCreator'],
      ['yt:videoId', 'yt:videoId'],
    ],
  },
});

/** Basic-auth credentials for self-hosted services, keyed by URL prefix. */
function authHeadersFor(url, services) {
  for (const name of Object.keys(services || {})) {
    if (name.startsWith('_') || typeof services[name] !== 'object') continue;
    const svc = serviceUrl(services, name);
    const basic = expandEnv(services[name].basicAuth || '');
    if (svc && basic && url.startsWith(svc.url)) return { Authorization: 'Basic ' + Buffer.from(basic).toString('base64') };
  }
  return {};
}

/** Some hosts (Reddit) rate-limit parallel requests: serialise per host with a gap, configured in limits.hostDelayMs. */
const hostQueues = new Map();
let hostDelays = {};
function throttled(url, fn) {
  let host;
  try { host = new URL(url).hostname.replace(/^(www|old)\./, ''); } catch { return fn(); }
  const delay = hostDelays[host];
  if (!delay) return fn();
  const prev = hostQueues.get(host) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => new Promise((r) => setTimeout(r, delay))).then(fn);
  hostQueues.set(host, next.catch(() => {}));
  return next;
}

let fixturePages = null;
async function fetchText(url, timeoutMs, services) {
  if (fixturesDir) {
    fixturePages ??= JSON.parse(await readFile(path.join(fixturesDir, 'pages.json'), 'utf8').catch(() => '{}'));
    const file = fixturePages[url];
    if (!file) throw new Error(`no fixture page for ${url}`);
    return readFile(path.join(fixturesDir, file), 'utf8');
  }
  const direct = () => throttled(url, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { ...HEADERS, ...authHeadersFor(url, services) } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'timeout' : String(err.message || err).split('\n')[0]);
    } finally {
      clearTimeout(timer);
    }
  });
  try {
    return await direct();
  } catch (err) {
    // Blocked or rate-limited from GitHub's IP range? Retry once through the self-hosted relay, if configured.
    const relay = BLOCKED_STATUS.test(err.message) ? relayUrl(services, url) : null;
    if (!relay) throw err;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(relay, { signal: controller.signal, headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err2) {
      throw new Error(`${err.message}; via relay: ${err2.name === 'AbortError' ? 'timeout' : String(err2.message || err2).split('\n')[0]}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
const BLOCKED_STATUS = /^HTTP (401|403|405|406|409|418|429|451|503)$/;

/**
 * Built-in last resort for plain RSS sources: read the site's homepage, follow its advertised feed link
 * (or try conventional paths), and remember what worked in resolved.json.
 */
async function discoverFeed(source, text, resolved) {
  const home = source.homepage || (() => { try { return new URL(source.url).origin; } catch { return null; } })();
  if (!home) throw new Error('no homepage to discover a feed from');
  const key = `discover:${source.id}`;
  const tried = new Set([source.url]);
  const candidates = [];
  if (resolved[key]) candidates.push(resolved[key]);
  let html = '';
  try { html = await text(home); } catch { /* homepage unreachable: fall through to conventional paths */ }
  candidates.push(...feedLinksFromHtml(html, home), ...conventionalFeedPaths(home));
  const errors = [];
  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const feed = await parser.parseString(await text(url));
      if (!feed.items?.length) throw new Error('no items');
      resolved[key] = url;
      return feed;
    } catch (err) { errors.push(`${url}: ${String(err.message || err).split('\n')[0]}`); }
  }
  throw new Error(`discovery failed (${errors.slice(0, 3).join('; ')})`);
}

/** Fetch one candidate (the primary source or one of its fallbacks) and parse it into a feed. */
async function fetchCandidate(candidate, index, limits, resolved, services) {
  const text = (u) => fetchText(u, limits.fetchTimeoutMs, services);
  if (fixturesDir) {
    const ext = candidate.type === 'instagram' ? 'json' : 'xml';
    const file = path.join(fixturesDir, `${candidate.id}${index ? `.fb${index}` : ''}.${ext}`);
    try { await access(file); } catch { throw new Error('no fixture'); }
    const body = await readFile(file, 'utf8');
    return candidate.type === 'instagram' ? (await import('./lib/instagram.js')).instagramToItems(body) : parser.parseString(body);
  }
  if (candidate.type === 'instagram') return fetchInstagramItems(candidate, text);
  if (candidate.type === 'discover') return discoverFeed(candidate, text, resolved);
  const feedUrl = await resolveFeedUrl(candidate, resolved, text, services);
  try {
    // YouTube's feed server answers GitHub's runners with sporadic 404s and 500s for perfectly good channels;
    // a second or third try a moment later usually succeeds.
    const flakyYouTube = /youtube\.com\/feeds\/videos\.xml/i.test(feedUrl);
    let body;
    for (let attempt = 1; ; attempt++) {
      try { body = await text(feedUrl); break; } catch (err) {
        if (!flakyYouTube || attempt >= 3 || !/HTTP (404|5\d\d)/.test(err.message)) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    const feed = await parser.parseString(body);
    if (!feed.items?.length) throw new Error('feed has no items'); // treat an empty feed as a failure so fallbacks run
    return feed;
  } catch (err) {
    // A cached YouTube handle → channel id that yields nothing is probably wrong: forget it so the next build re-resolves.
    // A 5xx is YouTube's problem, not a wrong id, so the cached id is kept in that case.
    const key = youtubeCacheKey(candidate);
    if (key && resolved[key] && !/HTTP 5\d\d/.test(err.message)) { delete resolved[key]; err.message += ' (cached channel id discarded; will re-resolve next build)'; }
    throw err;
  }
}

async function fetchFeed(source, limits, resolved, services) {
  // Plain RSS sources get homepage feed-discovery as an implicit final fallback.
  const withDiscovery = (source.type || 'rss') === 'rss' && !fixturesDir
    ? { ...source, fallbacks: [...(source.fallbacks || []), { type: 'discover', url: source.url, homepage: source.homepage }] }
    : source;
  const r = await fetchWithFallbacks(withDiscovery, (c, i) => fetchCandidate(c, i, limits, resolved, services));
  if (r.error) return { source, error: r.error };
  return { source, feed: r.feed, via: r.via, warnings: r.warnings };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function validate(config) {
  const ids = new Set();
  const catIds = new Set(config.categories.map((c) => c.id));
  for (const s of config.sources) {
    if (!s.id || ids.has(s.id)) throw new Error(`feeds.json: duplicate or missing source id "${s.id}"`);
    ids.add(s.id);
    if (s.categories) { if (!Array.isArray(s.categories) || !s.categories.length) throw new Error(`feeds.json: "categories" on "${s.id}" must be a non-empty list`); s.category = s.categories[0]; }
    for (const cat of s.categories || [s.category]) if (!catIds.has(cat)) throw new Error(`feeds.json: source "${s.id}" has unknown category "${cat}"`);
    if (s.category === 'top') throw new Error(`feeds.json: source "${s.id}" may not use the "top" pseudo-category; set "featured": true instead`);
    if (s.id === PICKS_SOURCE.id) throw new Error(`feeds.json: source id "${PICKS_SOURCE.id}" is reserved for picks.json`);
    if (s.id === OWN_SOURCE.id) throw new Error(`feeds.json: source id "${OWN_SOURCE.id}" is reserved for our own articles`);
    if (s.type === 'instagram' && !(s.username || s.handle)) throw new Error(`feeds.json: instagram source "${s.id}" needs a "username"`);
    if (s.fallbacks !== undefined && !Array.isArray(s.fallbacks)) throw new Error(`feeds.json: "fallbacks" on "${s.id}" must be a list`);
  }
}

/** The curated church directory: locate addresses once (OpenStreetMap Nominatim, cached) and write data/churches.json. */
async function buildChurches(cache, limits) {
  const raw = await readJson(path.join(ROOT, 'churches.json'), { churches: [] });
  const churches = (raw.churches || []).map(normaliseChurch).filter(Boolean);
  const problems = [];
  for (const c of churches) {
    if (c.lat != null) continue;
    const key = geocodeKey(c);
    if (cache[key]?.lat != null) { c.lat = cache[key].lat; c.lng = cache[key].lng; continue; }
    if (fixturesDir) { problems.push(`${c.name}: no coordinates (geocoding is skipped in fixture builds)`); continue; }
    if (cache[key]?.failedAt && Date.now() - cache[key].failedAt < 7 * 86400000) { problems.push(`${c.name}: address not found (retried weekly)`); continue; }
    try {
      await new Promise((r) => setTimeout(r, 1100)); // Nominatim asks for at most one request per second
      const hit = parseNominatim(await fetchText(nominatimUrl(c.address), limits.fetchTimeoutMs));
      if (!hit) throw new Error('address not found');
      cache[key] = { lat: hit.lat, lng: hit.lng, label: hit.label, at: Date.now() };
      c.lat = hit.lat; c.lng = hit.lng;
      if (verbose) console.log(`  ✓ located ${c.name}: ${hit.label}`);
    } catch (err) {
      cache[key] = { failedAt: Date.now(), error: String(err.message || err) };
      problems.push(`${c.name}: ${String(err.message || err)}`);
      console.warn(`  ✗ church ${c.name}: ${String(err.message || err)}`);
    }
  }
  return { churches, problems };
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** SEO pass: pre-rendered headlines, meta/JSON-LD on the home and finder pages, a page per listed church, sitemap. */
/** GoatCounter (free, no cookies) or Cloudflare Web Analytics (free, no cookies); both set from feeds.json → site. */
export function analyticsTag(site) {
  const tags = [];
  if (site.goatcounter) tags.push(`<script data-goatcounter="https://${escHtml(site.goatcounter)}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`);
  if (site.cloudflareAnalytics) tags.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${escHtml(site.cloudflareAnalytics)}"}'></script>`);
  return tags.join('\n  ');
}
async function walkHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'admin') out.push(...await walkHtml(p)); }
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

async function finalizeSeo({ site, articles, posts, churches }) {
  const b = siteBase(site);
  const social = `${b}/assets/social.jpg`;
  // Home page
  const indexPath = path.join(DIST, 'index.html');
  let index = await readFile(indexPath, 'utf8');
  const verification = site.googleSiteVerification ? `<meta name="google-site-verification" content="${escHtml(site.googleSiteVerification)}">` : '';
  index = index.replace('<!--seo:head-->', [metaTags({ title: `${site.name} — Christian News, Voices & Video`, description: site.tagline, url: `${b}/`, image: social, site }), verification, homeJsonLd(site)].filter(Boolean).join('\n  '));
  const footerFollow = [site.whatsappChannel && `<a href="${escHtml(site.whatsappChannel)}" target="_blank" rel="noopener">WhatsApp</a> · `, site.telegramChannel && `<a href="${escHtml(site.telegramChannel)}" target="_blank" rel="noopener">Telegram</a> · `].filter(Boolean).join('');
  index = index.replace('<!--prerender-->', prerenderCards(articles, 24, site.imageProxy)).replace('<!--subscribe-->', subscribeHtml(site)).replace('<!--followlinks-->', footerFollow);
  await writeFile(indexPath, index);

  // Branded entry pages (/tv/, /radio/): the same app, opening on a category, with their own name and meta.
  for (const [slug, brand] of Object.entries(site.brands || {})) {
    if (slug.startsWith('_') || !brand?.category) continue;
    let page = await readFile(path.join(SRC, 'index.html'), 'utf8');
    page = page.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(brand.name)} — ${escHtml(site.name)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(brand.description || brand.tagline || '')}">`)
      .replace('<!--seo:head-->', [metaTags({ title: brand.name, description: brand.description || brand.tagline, url: `${b}/${slug}/`, image: social, site }), `<meta name="ga-brand" content="${escHtml(slug)}">`, `<meta name="ga-category" content="${escHtml(brand.category)}">`].join('\n  '))
      .replace('<!--prerender-->', prerenderCards(articles.filter((a) => (a.categories || [a.category]).includes(brand.category)), 24, site.imageProxy))
      .replace('<!--subscribe-->', subscribeHtml(site)).replace('<!--followlinks-->', footerFollow)
      .replace(/<span class="brand__name">[^<]*<\/span>/, `<span class="brand__name">${escHtml(brand.name)}</span>`)
      .replace(/<span class="brand__tag">[^<]*<\/span>/, `<span class="brand__tag">${escHtml(brand.tagline || '')}</span>`)
      .replaceAll('href="assets/', 'href="../assets/').replaceAll('src="assets/', 'src="../assets/').replaceAll('href="styles.css"', 'href="../styles.css"').replaceAll('src="app.js"', 'src="../app.js"')
      .replaceAll('href="data/', 'href="../data/').replaceAll('href="feed.xml"', 'href="../feed.xml"').replaceAll('href="digest/', 'href="../digest/').replaceAll('href="quiz/', 'href="../quiz/').replaceAll('href="articles/', 'href="../articles/').replaceAll('href="churches/', 'href="../churches/').replaceAll('href="admin/', 'href="../admin/')
      .replace('<a class="brand" href="./"', '<a class="brand" href="./"');
    await mkdir(path.join(DIST, slug), { recursive: true });
    await writeFile(path.join(DIST, slug, 'index.html'), page);
  }
  const brandSlugs = Object.keys(site.brands || {}).filter((k) => !k.startsWith('_') && site.brands[k]?.category);

  // Bible quiz page
  const quizData = validateQuizzes(await readJson(path.join(ROOT, 'quizzes.json'), { quizzes: [] }));
  for (const p of quizData.problems) console.warn(`  ⚠ quizzes.json: ${p}`);
  await writeFile(path.join(DATA_DIR, 'quizzes.json'), JSON.stringify({ generatedAt: new Date().toISOString(), quizzes: quizData.quizzes }));
  const quizPath = path.join(DIST, 'quiz', 'index.html');
  const videoIds = new Set((await readdir(path.join(ROOT, 'videos', 'quiz')).catch(() => [])).filter((f) => f.endsWith('.mp4')).map((f) => f.slice(0, -4)));
  await writeFile(quizPath, renderQuizPage(await readFile(quizPath, 'utf8'), {
    site, quizzes: quizData.quizzes, videoIds, subscribe: subscribeHtml(site, { compact: true }),
    metaTags: metaTags({ title: `Bible Quiz — ${site.name}`, description: 'Test your Bible knowledge with a new quiz every day. Ten questions, instant answers with the verse, and a score to share.', url: `${b}/quiz/`, image: social, site }),
  }));

  // Church pages
  const located = churches.filter((c) => c.lat != null);
  for (const c of located) { c.slug = churchSlug(c); c.url = `${b}/churches/${c.slug}/`; }
  if (located.length) {
    const tpl = await readFile(path.join(SRC, 'church.html'), 'utf8');
    for (const c of located) {
      const description = `${c.name}${c.denomination ? `, ${c.denomination}` : ''}${c.address ? `, ${c.address}` : ''}. Directions, service times and details on ${site.name}.`;
      const details = [c.serviceTimes ? `<p><strong>Services:</strong> ${escHtml(c.serviceTimes)}</p>` : '', c.phone ? `<p><strong>Phone:</strong> <a href="tel:${escHtml(c.phone.replace(/\s+/g, ''))}">${escHtml(c.phone)}</a></p>` : '', c.notes ? `<p>${escHtml(c.notes)}</p>` : ''].join('');
      const vars = { name: escHtml(c.name), nameEnc: encodeURIComponent(c.name), site: escHtml(site.name), verse: escHtml(site.verse || ''), description: escHtml(description),
        denomination: escHtml(c.denomination || 'Church'), addressLine: c.address ? ` · ${escHtml(c.address)}` : '', details, lat: String(c.lat), lng: String(c.lng),
        websiteLink: c.website ? `<a class="btn btn--ghost" href="${escHtml(c.website)}" target="_blank" rel="noopener">Website ↗</a>` : '',
        meta: metaTags({ title: `${c.name} — ${site.name}`, description, url: c.url, image: social, site }), jsonld: churchJsonLd(c, site) };
      const out = path.join(DIST, 'churches', c.slug, 'index.html');
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''));
    }
  }
  // Finder page: meta + a static list of listed churches for crawlers
  const finderPath = path.join(DIST, 'churches', 'index.html');
  let finder = await readFile(finderPath, 'utf8');
  finder = finder.replace('<!--seo:head-->', metaTags({ title: `Find a church near you — ${site.name}`, description: 'Find Christian churches near you: search by your location or a town, see them on a map with distances, websites and directions.', url: `${b}/churches/`, image: social, site }));
  finder = finder.replace('<!--listed-->', located.length ? `<h2>Churches listed with ${escHtml(site.name)}</h2><ul class="article__more">${located.map((c) => `<li><a href="./${c.slug}/">${escHtml(c.name)}</a>${c.address ? ` <span class="muted">${escHtml(c.address)}</span>` : ''}</li>`).join('')}</ul>` : '');
  await writeFile(finderPath, finder);

  // Sitemap + robots
  const entries = [
    { url: `${b}/`, changefreq: 'hourly', priority: 1.0 },
    { url: `${b}/articles/`, changefreq: 'weekly', priority: 0.8 },
    ...posts.map((p) => ({ url: p.url, lastmod: p.publishedAt, changefreq: 'monthly', priority: 0.9 })),
    { url: `${b}/churches/`, changefreq: 'weekly', priority: 0.8 },
    { url: `${b}/digest/`, changefreq: 'daily', priority: 0.8 },
    { url: `${b}/quiz/`, changefreq: 'daily', priority: 0.8 },
    ...brandSlugs.map((s) => ({ url: `${b}/${s}/`, changefreq: 'hourly', priority: 0.9 })),
    ...located.map((c) => ({ url: c.url, changefreq: 'monthly', priority: 0.7 })),
  ];
  await writeFile(path.join(DIST, 'sitemap.xml'), sitemapXml(entries));
  const robotsPath = path.join(DIST, 'robots.txt');
  await writeFile(robotsPath, (await readFile(robotsPath, 'utf8')).trimEnd() + `\nSitemap: ${b}/sitemap.xml\n`);
  // Analytics (optional, privacy-friendly): injected into every page only when a site id is set.
  const analytics = analyticsTag(site);
  if (analytics) {
    for (const file of await walkHtml(DIST)) {
      const html = await readFile(file, 'utf8');
      if (html.includes('</head>') && !html.includes(analytics)) await writeFile(file, html.replace('</head>', `  ${analytics}\n</head>`));
    }
  }
  return { pages: located.length, sitemapEntries: entries.length, analytics: Boolean(analytics) };
}

/** Compile articles/*.md into pages under dist/articles/, an index, an RSS feed, and front-page cards. */
async function buildOwnArticles(site, catIds = null) {
  const dir = path.join(ROOT, 'articles');
  let files = [];
  try { files = (await readdir(dir)).filter((f) => /\.(md|markdown)$/i.test(f)).sort(); } catch { return { posts: [], articles: [] }; }
  const posts = [];
  for (const f of files) {
    const post = compilePost(f, await readFile(path.join(dir, f), 'utf8'), site);
    if (post && catIds && post.categories) {
      for (const c of post.categories) if (!catIds.has(c)) console.warn(`  ! article ${f}: unknown category "${c}" ignored`);
      post.categories = post.categories.filter((c) => catIds.has(c));
    }
    if (post) posts.push(post);
    else if (verbose) console.log(`  · article ${f}: skipped (draft or no title)`);
  }
  // CHANGELOG.md becomes the "What's new" article, dated by its newest entry.
  try {
    const log = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const newest = log.match(/^## (.+)$/m)?.[1];
    const date = newest ? new Date(newest + ' UTC') : null;
    const dated = date && !Number.isNaN(date.getTime()) ? log.replace(/^---\n/, `---\ndate: ${date.toISOString().slice(0, 10)}\nslug: whats-new\n`) : log.replace(/^---\n/, '---\nslug: whats-new\n');
    const post = compilePost('whats-new.md', dated, site);
    if (post) posts.push(post);
  } catch { /* no changelog */ }
  posts.sort((a, b) => b.publishedAt - a.publishedAt);
  if (!posts.length) return { posts, articles: [] };
  const template = await readFile(path.join(SRC, 'article.html'), 'utf8');
  for (const p of posts) {
    const out = path.join(DIST, p.path);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, renderPostPage(template, p, site, posts));
    if (verbose) console.log(`  ✓ article: ${p.title} → /articles/${p.slug}/`);
  }
  await writeFile(path.join(DIST, 'articles', 'index.html'), renderIndexPage(template, posts, site));
  await writeFile(path.join(DIST, 'articles', 'feed.xml'), renderFeed(posts, site));
  try { await cp(path.join(dir, 'images'), path.join(DIST, 'articles', 'images'), { recursive: true }); } catch { /* no images folder */ }
  return { posts, articles: posts.map((p) => postToArticle(p, site)) };
}

/** Build cards for every URL in picks.json, using a week-long cache of fetched metadata. */
async function buildPicks(picksConfig, cache, limits, services, catIds = null) {
  const picks = (picksConfig?.picks || []).filter((p) => p && p.url && p.enabled !== false).map((p) => {
    if (!catIds || !Array.isArray(p.categories)) return p;
    const known = p.categories.filter((c) => catIds.has(c));
    for (const c of p.categories) if (!catIds.has(c)) console.warn(`  ! pick ${p.url}: unknown category "${c}" ignored`);
    return { ...p, categories: known };
  });
  const status = { id: PICKS_SOURCE.id, name: PICKS_SOURCE.name, ok: true, count: 0, errors: [] };
  const now = Date.now();
  const articles = await mapWithConcurrency(picks, limits.concurrency, async (pick) => {
    const entry = cache[pick.url] || (cache[pick.url] = { firstSeen: now });
    const manualComplete = pick.title && (pick.image || needsManualFields(pick.url));
    const stale = !entry.data || now - (entry.fetchedAt || 0) > PICKS_TTL_MS;
    if (!manualComplete && stale) {
      try {
        entry.data = await unfurl(pick.url, (u) => fetchText(u, limits.fetchTimeoutMs, services));
        entry.fetchedAt = now;
        delete entry.error;
      } catch (err) {
        entry.error = String(err.message || err).split('\n')[0];
      }
    }
    const article = pickToArticle(pick, entry.data, entry.firstSeen);
    if (!article) {
      const why = entry.error || 'no title found';
      const hint = needsManualFields(pick.url) ? ' (Instagram/Facebook posts need a "title" in picks.json)' : '';
      status.errors.push(`${pick.url}: ${why}${hint}`);
      console.warn(`  ✗ pick ${pick.url}: ${why}${hint}`);
      return null;
    }
    if (verbose) console.log(`  ✓ pick ${article.source}: ${article.title.slice(0, 60)}`);
    return article;
  });
  // Forget cache entries for URLs no longer listed.
  const listed = new Set(picks.map((p) => p.url));
  for (const url of Object.keys(cache)) if (!listed.has(url)) delete cache[url];
  const out = articles.filter(Boolean);
  status.count = out.length;
  if (!status.errors.length) delete status.errors;
  return { articles: out, status };
}

async function main() {
  const started = Date.now();
  const config = JSON.parse(await readFile(path.join(ROOT, 'feeds.json'), 'utf8'));
  validate(config);
  const { categories, limits, site, services = {}, brands = {} } = config;
  site.brands = brands;
  hostDelays = limits.hostDelayMs || {};
  const sources = config.sources.filter((s) => s.enabled !== false);
  const disabled = config.sources.filter((s) => s.enabled === false);
  const picksConfig = await readJson(fixturesDir ? path.join(fixturesDir, 'picks.json') : path.join(ROOT, 'picks.json'), { picks: [] });
  const previous = await readJson(path.join(DATA_DIR, 'articles-full.json'), await readJson(path.join(DATA_DIR, 'articles.json'), []));
  const resolved = await readJson(path.join(DATA_DIR, 'resolved.json'), {});
  const picksCache = await readJson(path.join(DATA_DIR, 'picks-cache.json'), {});
  const previousHealth = await readJson(path.join(DATA_DIR, 'health.json'), {});
  const geocodeCache = await readJson(path.join(DATA_DIR, 'geocode-cache.json'), {});
  const ogCache = await readJson(path.join(DATA_DIR, 'og-cache.json'), {});
  const videoCache = await readJson(path.join(DATA_DIR, 'video-cache.json'), {});

  console.log(`Fetching ${sources.length} feeds${fixturesDir ? ' from fixtures' : ''}...`);
  const results = await mapWithConcurrency(sources, limits.concurrency, (s) => fetchFeed(s, limits, resolved, services));

  const fresh = [];
  const sourceStatus = [];
  for (const r of results) {
    if (r.error) {
      sourceStatus.push({ id: r.source.id, name: r.source.name, ok: false, error: r.error });
      console.warn(`  ✗ ${r.source.id}: ${r.error}`);
      continue;
    }
    const items = (r.feed.items || []).slice(0, limits.perSource);
    let kept = 0;
    // Podcast cover art stands in for episodes without a picture. Other feeds' channel images are usually a tiny
    // logo that looks terrible stretched across a card, so news and blog items simply go without.
    const feedImage = (r.source.kind === 'audio' && (r.feed.itunes?.image || r.feed.image?.url)) || null;
    for (const item of items) {
      const article = normaliseItem(item, r.source, r.feed);
      if (article) { if (!article.image && feedImage) article.image = feedImage; fresh.push(article); kept++; }
    }
    const st = { id: r.source.id, name: r.source.name, ok: true, count: kept };
    if (r.via) { st.via = r.via; st.warning = r.warnings.join(' | '); }
    sourceStatus.push(st);
    if (verbose) console.log(`  ✓ ${r.source.id}: ${kept} items${r.via ? ` (via fallback ${r.via}; ${r.warnings.join(' | ')})` : ''}`);
  }
  for (const s of disabled) sourceStatus.push({ id: s.id, name: s.name, ok: false, skipped: true, error: 'disabled in feeds.json' });

  const cutoff = fixturesDir ? 0 : Date.now() - limits.maxAgeHours * 3600 * 1000; // fixtures never age out
  const merged = mergeWithPrevious(fresh, previous.filter((p) => p?.sourceId !== PICKS_SOURCE.id && p?.sourceId !== OWN_SOURCE.id), sourceStatus, cutoff);
  let articles = dedupe(merged);

  // Videos that were made private or deleted since the feed listed them (ended livestreams, mostly).
  if (!fixturesDir) {
    const fetchStatus = async (url, method = 'GET') => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try { return (await fetch(url, { method, signal: controller.signal, redirect: 'follow', headers: HEADERS })).status; } finally { clearTimeout(timer); }
    };
    const v = await dropGoneVideos(articles, videoCache, { fetchStatus, concurrency: limits.concurrency });
    articles = v.kept;
    for (const a of v.dropped) if (verbose) console.log(`  ✗ video gone (${videoCache[a.videoId]?.status}): ${a.source}: ${a.title.slice(0, 70)}`);
    if (verbose) console.log(`  ✓ videos: ${v.checked} checked with YouTube, ${v.dropped.length} private or deleted removed, ${v.placeholders} grey placeholder thumbnails replaced by cover tiles`);
  }
  // Stories without a picture: ask the article page for its sharing image (cached a week, limited per build).
  if (limits.pageImages !== false) {
    const og = await fillMissingImages(articles, ogCache, { fetchText: (u, t) => fetchText(u, t, services), maxFetches: limits.pageImagesPerBuild || 60, concurrency: limits.concurrency });
    if (verbose) console.log(`  ✓ pictures: ${og.filled} stories given their page's sharing image (${og.fetched} pages fetched)`);
  }
  // Picks are owner-curated: regenerated every build, never aged out, and they win over feed copies of the same URL.
  console.log(`Unfurling ${(picksConfig.picks || []).length} picks...`);
  const picks = await buildPicks(picksConfig, picksCache, limits, services, new Set(categories.map((c) => c.id)));
  sourceStatus.push(picks.status);
  const pickUrls = new Set(picks.articles.map((a) => a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')));
  articles = articles.filter((a) => !pickUrls.has(a.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')));

  // Church directory: curated entries, located once and cached.
  const directory = await buildChurches(geocodeCache, limits);
  sourceStatus.push({ id: 'churches', name: 'Church directory', ok: true, count: directory.churches.length, ...(directory.problems.length ? { errors: directory.problems } : {}) });

  // Our own articles: Markdown in articles/ → pages on this site, never aged out.
  const own = await buildOwnArticles(site, new Set(categories.map((c) => c.id)));
  sourceStatus.push({ id: OWN_SOURCE.id, name: OWN_SOURCE.name, ok: true, count: own.articles.length });
  articles = [...own.articles, ...picks.articles, ...articles].sort((a, b) => b.publishedAt - a.publishedAt);

  const metaSources = sources.map((s) => ({ id: s.id, name: s.name, category: s.category, ...(s.categories ? { categories: s.categories } : {}), kind: s.kind || 'news', featured: Boolean(s.featured), homepage: homepageFor(s) }));
  let metaCategories = picks.articles.length ? categories : categories.filter((c) => c.id !== PICKS_SOURCE.category);
  if (!own.articles.length) metaCategories = metaCategories.filter((c) => c.id !== OWN_SOURCE.category);
  if (picks.articles.length) metaSources.push({ ...PICKS_SOURCE });
  if (own.articles.length) metaSources.push({ ...OWN_SOURCE });

  await mkdir(DATA_DIR, { recursive: true });
  await cp(SRC, DIST, { recursive: true });
  // Rendered quiz videos (made by the "Render quiz videos" workflow) ship with the site.
  const videosDir = path.join(ROOT, 'videos');
  try { await access(videosDir); await cp(videosDir, path.join(DIST, 'videos'), { recursive: true }); } catch { /* none yet */ }
  // Full set stays in the build cache (articles.json is re-read next build); the site gets a slim, capped copy.
  const published = capOutput(articles, limits.outputPerSource || 15, limits.outputMax || 700).map((a) => slimArticle(a));
  const pinnedFirst = [...published.filter((a) => a.pinned), ...published.filter((a) => !a.pinned)];
  await writeFile(path.join(DATA_DIR, 'articles.json'), JSON.stringify(published));
  await writeFile(path.join(DATA_DIR, 'latest.json'), JSON.stringify(pinnedFirst.slice(0, 48)));
  await writeFile(path.join(DATA_DIR, 'articles-full.json'), JSON.stringify(articles));
  await writeFile(path.join(DATA_DIR, 'resolved.json'), JSON.stringify(resolved, null, 2));
  await writeFile(path.join(DATA_DIR, 'picks-cache.json'), JSON.stringify(picksCache, null, 2));
  await writeFile(path.join(DATA_DIR, 'geocode-cache.json'), JSON.stringify(geocodeCache, null, 2));
  await writeFile(path.join(DATA_DIR, 'og-cache.json'), JSON.stringify(ogCache));
  await writeFile(path.join(DATA_DIR, 'video-cache.json'), JSON.stringify(videoCache));
  await writeFile(path.join(DATA_DIR, 'churches.json'), JSON.stringify({ generatedAt: new Date().toISOString(), churches: directory.churches, problems: directory.problems }));
  const health = computeHealth(previousHealth, sourceStatus);
  await writeFile(path.join(DATA_DIR, 'health.json'), JSON.stringify(health, null, 2));
  await writeFile(
    path.join(DATA_DIR, 'meta.json'),
    JSON.stringify({
      site,
      generatedAt: new Date().toISOString(),
      articleCount: articles.length,
      categories: metaCategories,
      sources: metaSources,
      sourceStatus,
    }, null, 2),
  );
  // Story pages: /s/<id>/ is the shareable address of every external story: our preview card when pasted,
  // and on our site the story card, a "read the full story" button and more from the same section.
  const external = published.filter((a) => !a.internal);
  const labelOf = (id) => categories.find((c) => c.id === id)?.label || '';
  await Promise.all(external.map(async (a) => {
    const dir = path.join(DIST, 's', encodeURIComponent(a.id));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), renderSharePage(a, site, relatedStories(a, published, 6), labelOf(a.category)));
  }));
  // Daily digest (page + WhatsApp text + RSS-to-email feed) and a plain top-stories feed.
  const digestFile = path.join(DATA_DIR, 'digests.json');
  const digests = await readJson(digestFile, {});
  const today = digestDate();
  const digestItems = pickDigest(published, { count: 8 });
  const text = digestText(digestItems, site, today);
  digests[today] = { html: digestHtml(digestItems, site, today), items: digestItems.map((a) => a.id) };
  for (const d of Object.keys(digests).sort().slice(0, -14)) delete digests[d];
  await writeFile(digestFile, JSON.stringify(digests));
  await mkdir(path.join(DIST, 'digest'), { recursive: true });
  await writeFile(path.join(DIST, 'digest', 'index.html'), renderDigestPage(digestItems, site, today, text));
  await writeFile(path.join(DIST, 'digest', 'digest.txt'), text);
  await writeFile(path.join(DIST, 'digest', 'feed.xml'), renderDigestFeed(digests, site));
  await writeFile(path.join(DIST, 'feed.xml'), renderTopFeed(published, site));
  await writeFile(path.join(DIST, '.nojekyll'), ''); // tell GitHub Pages not to run Jekyll
  const seo = await finalizeSeo({ site, articles, posts: own.posts, churches: directory.churches });
  if (verbose) console.log(`  ✓ seo: ${seo.sitemapEntries} sitemap entries, ${seo.pages} church pages, headlines pre-rendered`);
  // Stamp the service worker so every deploy invalidates the cached app shell.
  const swPath = path.join(DIST, 'sw.js');
  await writeFile(swPath, (await readFile(swPath, 'utf8')).replace('__BUILD__', Date.now().toString(36)));

  const okCount = sourceStatus.filter((s) => s.ok && !['picks', 'ours', 'churches'].includes(s.id)).length;
  const hash = createHash('sha1').update(JSON.stringify(articles.map((a) => a.id))).digest('hex').slice(0, 8);
  console.log(`Done: ${articles.length} items from ${okCount}/${sources.length} feeds + ${picks.articles.length} picks + ${own.articles.length} own articles in ${((Date.now() - started) / 1000).toFixed(1)}s (set ${hash}).`);
  if (okCount === 0 && articles.length === 0) {
    console.error('No feeds succeeded and no previous data exists.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
