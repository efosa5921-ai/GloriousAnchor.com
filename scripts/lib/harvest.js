/**
 * The Harvest page (/harvest/): tracks Muslims leaving Islam and coming to Christ, as far as that can be tracked.
 *
 * Nobody counts apostasy, and in most of the Muslim world admitting it is a crime, so the page never invents a number.
 * It shows four honest things: (1) a scoreboard of published survey figures with their dates and sources (from
 * harvest.json); (2) the live reach of the channels that carry the gospel to Muslims, read from the YouTube Data API
 * each build; (3) a tally of people who, in the comments under those channels' newest videos, say in their own words
 * that they have left Islam or come to Christ; (4) a stream of the channels' newest videos and a Google Trends pulse.
 *
 * Privacy: comment text and names are never stored or shown. Each commenter counts once, by a salted hash of their
 * YouTube channel id, so nobody can be identified from the data file. Many write from countries where it would cost
 * them their lives.
 *
 * Quota: channels.list 1 unit, playlistItems 1 unit per channel, commentThreads 1 unit per page of 100 comments.
 * With the defaults (3 channels, 8 videos each, up to 3 pages a video) a build spends under 80 units; hourly builds
 * stay well inside the free 10,000 a day.
 */
import { createHash } from 'node:crypto';
import { uploadsPlaylistId } from './youtube.js';
import { cardHtml, subscribeHtml, metaTags } from './seo.js';

const API = 'https://www.googleapis.com/youtube/v3';

// First-person statements only: "why are people leaving islam?" is not a testimony, "I left islam" is.
const LEFT = [
  /\b(?:i|we|i'?ve|i have|i had|we have)\s+(?:finally\s+|recently\s+|officially\s+|just\s+|already\s+)?(?:left|leave|quit|renounced|abandoned|rejected|walked away from|got out of|escaped(?: from)?)\s+islam\b/i,
  /\b(?:i|i'?m|i am|we are|we'?re)\s+(?:an?\s+|now\s+an?\s+|a proud\s+|former\s+)?(?:ex[- ]?muslim|apostate|former muslim|no longer (?:a )?muslim)\b/i,
  /\bi\s+(?:was|used to be|grew up(?: as)?|was raised(?: as)?|was born)\s+(?:a\s+)?muslim\b[^.!?\n]{0,80}\b(?:but|until|before|and now|now)\b/i,
  /\b(?:i|we)\s+(?:have\s+)?(?:stopped|quit)\s+(?:being\s+(?:a\s+)?muslim|praying to allah|believing in (?:islam|allah|muhammad))\b/i,
  /\b(?:my|our)\s+(?:whole\s+)?(?:family|parents|brother|sister|wife|husband)\s+(?:and i\s+)?(?:have\s+|has\s+)?(?:left|abandoned|renounced)\s+islam\b/i,
  /\b(?:as an?|being an?|speaking as an?)\s+ex[- ]?muslim\b/i,
  /\bex[- ]?muslim\s+here\b/i,
  /\b(?:i|we)\s+(?:have\s+)?(?:left|abandoned|renounced)\s+(?:the\s+)?(?:religion of islam|muslim faith|deen)\b/i,
];
const CHRIST = [
  /\b(?:i|we|i'?ve|i have|we have)\s+(?:finally\s+|recently\s+|just\s+|now\s+)?(?:accepted|received|found|met|encountered|chose|chosen|believed in|surrendered to|given my life to|gave my life to|given my heart to|gave my heart to|came to|come to|turned to|trust(?:ed)? in|now follow|started following|decided to follow)\s+(?:the lord\s+)?(?:jesus|christ|yeshua|isa(?: al[- ]masih)?)\b/i,
  /\b(?:i|we)\s+(?:was|were|got|am|am getting|have been|will be)\s+baptized\b/i,
  /\b(?:i|i'?m|i am|we are|we'?re)\s+(?:now\s+)?(?:a\s+)?(?:born[- ]again\s+)?(?:christian|follower of (?:jesus|christ)|believer in (?:jesus|christ))\b[^.!?\n]{0,80}\b(?:now|muslim|islam|former|used to|converted|convert)\b/i,
  /\b(?:i|we)\s+(?:have\s+)?converted\s+(?:from islam\s+)?to\s+christianity\b/i,
  /\bjesus\s+(?:christ\s+)?(?:is|became|is now|has become)\s+my\s+(?:lord|saviou?r|king)\b/i,
  /\b(?:i|we)\s+(?:was|were|got|have been|am|are)\s+(?:a\s+)?muslim\b[^.!?\n]{0,80}\b(?:now|today)\s+(?:i|we)\s+(?:am|are|follow|believe in|love|serve)\s+(?:a\s+christian|jesus|christ)\b/i,
  /\b(?:i|we|i'?ve|i have)\s+(?:finally\s+|recently\s+|just\s+)?(?:became|become|converted to|turned)\s+(?:a\s+)?christian\b/i,
  /\b(?:i|i'?m|i am)\s+(?:a\s+)?(?:former|ex)[- ]?muslim\b[^.!?\n]{0,60}\b(?:christian|jesus|christ|baptized|saved|born again)\b/i,
  /\b(?:from|raised in|born into)\s+(?:a\s+)?muslim\s+(?:family|home|background|country)\b[^.!?\n]{0,80}\b(?:i|we)\s+(?:now\s+)?(?:believe in|follow|accepted|love|belong to|gave my life to|serve)\s+(?:jesus|christ)\b/i,
  /\b(?:i|we)\s+(?:have\s+)?(?:given|gave)\s+(?:my|our)\s+(?:life|lives|heart)\s+to\s+(?:jesus|christ)\b/i,
];
const NEGATED = /\b(?:never|not|no way|n't|won'?t|will never|would never|cannot|can'?t|nobody|no one|if\s+i|why would i|i will not)\b[^.!?\n]{0,30}$/i;
const QUESTION_OR_REPORTED = /\b(?:why|how|when|do you|did you|have you|says?|said|claims?|told me|my friend|he|she|they)\b[^.!?\n]{0,25}$/i;

export function classifyComment(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (t.length < 8 || t.length > 2000) return null;
  const hit = (list) => list.some((re) => {
    const m = re.exec(t);
    if (!m) return false;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    return !NEGATED.test(before) && !QUESTION_OR_REPORTED.test(before);
  });
  const christ = hit(CHRIST), left = hit(LEFT);
  if (christ) return 'christ';
  if (left) return 'left';
  return null;
}

export function authorKey(authorId, salt = 'glorious-anchor-harvest') {
  if (!authorId) return null;
  return createHash('sha256').update(`${salt}:${authorId}`).digest('hex').slice(0, 24);
}

/** Count comments by kind, one per author; returns the authors newly counted so totals can be deduped across videos. */
export function tallyComments(comments, seen = {}) {
  const counts = { left: 0, christ: 0, comments: 0 };
  const added = {};
  for (const c of comments || []) {
    counts.comments++;
    const kind = classifyComment(c.text);
    if (!kind) continue;
    const key = authorKey(c.authorId) || `anon:${createHash('sha256').update(String(c.text)).digest('hex').slice(0, 16)}`;
    const prior = seen[key] || added[key];
    if (prior === 'christ' || prior === kind) continue;
    // A commenter who first said "I left Islam" and later "I found Jesus" moves from left to christ.
    if (prior === 'left' && kind === 'christ') counts.left--;
    added[key] = kind;
    counts[kind]++;
  }
  return { counts, added };
}

export function emptyState() {
  return { version: 1, totals: { left: 0, christ: 0, comments: 0, videos: 0 }, authors: {}, videos: {}, channels: {}, history: [], updatedAt: null };
}

async function apiGet(fetcher, key, resource, params) {
  const u = new URL(`${API}/${resource}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set('key', key);
  const res = await fetcher(u.toString());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(`${resource} ${res.status}: ${json?.error?.errors?.[0]?.reason || json?.error?.message || ''}`); err.status = res.status; err.reason = json?.error?.errors?.[0]?.reason; throw err; }
  return json;
}

/**
 * Refresh channel statistics and scan new comments. Mutates and returns `state`.
 * @param {object} state  previous harvest state (from dist/data/harvest.json)
 * @param {object} opts   { key, channels: [{id, channelId, name}], fetcher, now, videosPerChannel, pagesPerVideo, log }
 */
export async function updateHarvest(state, { key, channels = [], fetcher = fetch, now = Date.now(), videosPerChannel = 8, pagesPerVideo = 3, log = () => {} } = {}) {
  state = { ...emptyState(), ...(state || {}) };
  state.totals = { ...emptyState().totals, ...(state.totals || {}) };
  if (!key || !channels.length) return state;
  const ids = channels.map((c) => c.channelId).filter(Boolean);
  // Reach: subscribers, views and video counts for every channel in one call.
  try {
    const json = await apiGet(fetcher, key, 'channels', { part: 'snippet,statistics', id: ids.join(','), maxResults: 50 });
    for (const it of json.items || []) {
      state.channels[it.id] = { title: it.snippet?.title, handle: it.snippet?.customUrl || '', subscribers: Number(it.statistics?.subscriberCount || 0), views: Number(it.statistics?.viewCount || 0), videoCount: Number(it.statistics?.videoCount || 0), checkedAt: now };
    }
  } catch (err) { log(`harvest: channels.list failed: ${err.message}`); }

  // Comments: the newest videos of each channel, newest comments first, up to a few pages each.
  let spent = 1;
  for (const ch of channels) {
    const playlist = uploadsPlaylistId(ch.channelId);
    if (!playlist) continue;
    let vids = [];
    try {
      const json = await apiGet(fetcher, key, 'playlistItems', { part: 'snippet', playlistId: playlist, maxResults: videosPerChannel });
      spent++;
      vids = (json.items || []).map((it) => ({ id: it.snippet?.resourceId?.videoId, title: it.snippet?.title, publishedAt: Date.parse(it.snippet?.publishedAt || '') || now })).filter((v) => v.id);
    } catch (err) { log(`harvest: playlistItems failed for ${ch.name}: ${err.message}`); continue; }
    for (const v of vids) {
      const rec = state.videos[v.id] || { channel: ch.channelId, title: v.title, publishedAt: v.publishedAt, left: 0, christ: 0, comments: 0, scannedAt: 0, done: false };
      // A video is re-read while it is under 30 days old and at most once every 6 hours; older ones are left alone.
      const ageDays = (now - rec.publishedAt) / 86400000;
      if (rec.done || (rec.scannedAt && now - rec.scannedAt < 6 * 3600000) || (ageDays > 30 && rec.scannedAt)) { state.videos[v.id] = rec; continue; }
      let pageToken = '';
      const fresh = [];
      try {
        for (let p = 0; p < pagesPerVideo; p++) {
          const json = await apiGet(fetcher, key, 'commentThreads', { part: 'snippet', videoId: v.id, maxResults: 100, order: 'time', textFormat: 'plainText', ...(pageToken ? { pageToken } : {}) });
          spent++;
          for (const t of json.items || []) {
            const s = t.snippet?.topLevelComment?.snippet || {};
            const at = Date.parse(s.publishedAt || '') || 0;
            if (rec.newestSeen && at <= rec.newestSeen) { pageToken = ''; break; }
            fresh.push({ text: s.textDisplay || s.textOriginal || '', authorId: s.authorChannelId?.value || '', at });
          }
          pageToken = json.nextPageToken || '';
          if (!pageToken) { if (!rec.newestSeen) rec.done = ageDays > 30; break; }
        }
      } catch (err) {
        if (err.reason === 'commentsDisabled' || err.status === 403) rec.done = true;
        else log(`harvest: comments failed for ${v.id}: ${err.message}`);
      }
      const { counts, added } = tallyComments(fresh, state.authors);
      Object.assign(state.authors, added);
      rec.left += counts.left; rec.christ += counts.christ; rec.comments += counts.comments;
      rec.newestSeen = Math.max(rec.newestSeen || 0, ...fresh.map((c) => c.at));
      rec.scannedAt = now;
      state.videos[v.id] = rec;
      state.totals.left += counts.left; state.totals.christ += counts.christ; state.totals.comments += counts.comments;
    }
  }
  state.totals.videos = Object.keys(state.videos).length;
  // Keep the data file small: per-video records for a year, one history point a day.
  for (const [id, rec] of Object.entries(state.videos)) if (now - rec.publishedAt > 366 * 86400000) delete state.videos[id];
  const day = new Date(now).toISOString().slice(0, 10);
  const reach = Object.values(state.channels).reduce((n, c) => n + (c.subscribers || 0), 0);
  const point = { date: day, left: state.totals.left, christ: state.totals.christ, reach };
  state.history = [...(state.history || []).filter((h) => h.date !== day), point].slice(-400);
  state.updatedAt = new Date(now).toISOString();
  state.quotaSpent = spent;
  return state;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => { n = Number(n || 0); if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}m`; if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`; return String(n); };
const base = (site) => String(site.url || '').replace(/\/+$/, '');

function trendsIframe(widget, keywords, geo = '', time = 'today 5-y') {
  const req = { comparisonItem: keywords.map((keyword) => ({ keyword, geo, time })), category: 0, property: '' };
  const src = `https://trends.google.com/trends/embed/explore/${widget}?req=${encodeURIComponent(JSON.stringify(req))}&tz=0&hl=en`;
  return `<iframe class="harvest__trend" src="${esc(src)}" title="Google Trends: ${esc(keywords.join(', '))}${geo ? ' in ' + esc(geo) : ''}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
}

function sparkline(points, key) {
  const vals = points.map((p) => Number(p[key] || 0));
  if (vals.length < 2) return '';
  const max = Math.max(...vals, 1), w = 240, h = 48;
  const d = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg class="harvest__spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${d}"/></svg>`;
}

/** A one-line strip for the homepage: the headline counts and a link to the page. Empty until the first count. */
export function harvestWidgetHtml(state, config = {}, prefix = '') {
  const t = state?.totals || {};
  const reach = Object.values(state?.channels || {}).reduce((n, c) => n + (c.subscribers || 0), 0);
  const said = Number(t.left || 0) + Number(t.christ || 0);
  if (!reach && !t.comments) return '';
  return `<a class="harvest-widget" href="${prefix}harvest/" aria-label="The Harvest: Muslims leaving Islam, as far as it can be counted">
      <span class="harvest-widget__kicker">The Harvest</span>
      <span class="harvest-widget__stat"><b>${esc(fmt(said))}</b> said they left Islam or found Christ</span>
      <span class="harvest-widget__stat"><b>${esc(fmt(reach))}</b> reached by the channels we follow</span>
      <span class="harvest-widget__stat"><b>${esc(fmt(t.comments))}</b> comments read</span>
      <span class="harvest-widget__more">See the count →</span>
    </a>`;
}

/**
 * Render the page. `videos` are the channels' newest items (already normalised articles) for the stream.
 */
export function renderHarvestPage({ config, state, site, videos = [], now = Date.now() }) {
  const b = base(site);
  const url = `${b}/harvest/`;
  const t = state?.totals || emptyState().totals;
  const channels = (config.channels || []).map((c) => ({ ...c, ...(state?.channels?.[c.channelId] || {}) }));
  const reach = channels.reduce((n, c) => n + (c.subscribers || 0), 0);
  const views = channels.reduce((n, c) => n + (c.views || 0), 0);
  const updated = state?.updatedAt ? new Date(state.updatedAt) : null;
  const figures = config.figures || [];
  const trends = config.trends || { keywords: ['ex muslim', 'leaving islam'], geos: [] };
  const geoNames = { NG: 'Nigeria', EG: 'Egypt', PK: 'Pakistan', SA: 'Saudi Arabia', ID: 'Indonesia', IR: 'Iran', TR: 'Turkey', BD: 'Bangladesh', MA: 'Morocco', DZ: 'Algeria', GB: 'the United Kingdom', US: 'the United States' };
  const title = `The Harvest: Muslims leaving Islam and coming to Christ — ${site.name}`;
  const description = 'Live tracker of Muslims leaving Islam and coming to Christ: survey figures, the reach of the channels taking the gospel to Muslims, and people saying in their own words that they have left Islam.';
  const streamHtml = videos.slice(0, 12).map((a) => cardHtml(a, { href: a.url, imageProxy: site.imageProxy, site, summary: false, date: true })).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${metaTags({ title, description, url, image: `${b}/assets/social.jpg`, site })}
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0b1f3a">
  <link rel="icon" href="../assets/anchor.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../styles.css">
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Dataset', name: 'The Harvest: Muslims leaving Islam', description, url, creator: { '@type': 'Organization', name: site.name, url: b }, dateModified: state?.updatedAt || null, license: 'https://creativecommons.org/licenses/by/4.0/' }).replace(/</g, '\\u003c')}</script>
</head>
<body class="article-page harvest-page">
  <header class="masthead"><div class="wrap masthead__row">
    <a class="brand" href="../" aria-label="${esc(site.name)} home"><svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><use href="../assets/anchor.svg#anchor"/></svg><span class="brand__text"><span class="brand__name">${esc(site.name)}</span><span class="brand__tag">The Harvest</span></span></a>
    <nav class="masthead__tools article-nav"><a href="../apologetics/">Apologetics</a><a href="../">← All headlines</a></nav>
  </div></header>
  <main class="wrap">
    <section class="digest__head">
      <p class="digest__kicker">The Harvest · updated ${updated ? esc(updated.toUTCString().replace(/:\d\d GMT$/, ' GMT')) : 'at the next build'}</p>
      <h1 class="digest__h1">Muslims are leaving Islam. Here is what can be counted.</h1>
      <p class="digest__lede">Nobody counts apostasy, and in most of the Muslim world admitting it is a crime, so no honest site can show a live number of Muslims leaving Islam. This page shows what <em>can</em> be measured: the published surveys, the reach of the channels taking the gospel to Muslims, and the people who say in their own words, under those channels' videos, that they have left Islam or found Christ. <em>"The harvest is plentiful, but the labourers are few"</em> (Matthew 9:37).</p>
    </section>

    <section class="harvest__stats" aria-label="Live counts">
      <div class="harvest__stat"><div class="harvest__num">${fmt(t.christ)}</div><div class="harvest__label">people who said they have come to Christ</div><div class="harvest__sub">in comments read so far</div>${sparkline(state?.history || [], 'christ')}</div>
      <div class="harvest__stat"><div class="harvest__num">${fmt(t.left)}</div><div class="harvest__label">more who said they have left Islam</div><div class="harvest__sub">and have not yet said where they are going</div>${sparkline(state?.history || [], 'left')}</div>
      <div class="harvest__stat"><div class="harvest__num">${fmt(reach)}</div><div class="harvest__label">subscribers to the channels we follow</div><div class="harvest__sub">${fmt(views)} video views in all</div>${sparkline(state?.history || [], 'reach')}</div>
      <div class="harvest__stat"><div class="harvest__num">${fmt(t.comments)}</div><div class="harvest__label">comments read</div><div class="harvest__sub">under ${fmt(t.videos)} videos; each person counted once</div></div>
    </section>
    <p class="harvest__method">How the count works: each build reads the newest comments under the latest videos of the channels below and counts the writers who say, in the first person, that they have left Islam ("I left Islam", "I'm an ex-Muslim") or come to Christ ("I accepted Jesus", "I was baptized"). Questions, reports about other people and denials are not counted. Each person is counted once, by an anonymous code; no names or comments are stored. It is a floor, not a total: most who leave never say so anywhere.</p>

    <section class="harvest__section">
      <h2>What the surveys say</h2>
      <div class="harvest__figures">
${figures.map((f) => `        <article class="harvest__figure"><div class="harvest__fnum">${esc(f.value)}</div><h3 class="harvest__ftitle">${esc(f.label)}</h3><p>${esc(f.detail)}</p><p class="harvest__fsource">${f.url ? `<a href="${esc(f.url)}" rel="noopener" target="_blank">${esc(f.source)}</a>` : esc(f.source)}${f.date ? ` · ${esc(f.date)}` : ''}</p></article>`).join('\n')}
      </div>
    </section>

    <section class="harvest__section">
      <h2>The channels reaching Muslims</h2>
      <div class="harvest__channels">
${channels.map((c) => `        <a class="harvest__channel" href="https://www.youtube.com/channel/${esc(c.channelId)}" rel="noopener" target="_blank"><strong>${esc(c.title || c.name)}</strong><span>${c.subscribers ? `${fmt(c.subscribers)} subscribers · ${fmt(c.views)} views · ${fmt(c.videoCount)} videos` : 'reach not read yet'}</span></a>`).join('\n')}
      </div>
    </section>

    <section class="harvest__section">
      <h2>What the world is searching for</h2>
      <p class="digest__lede">Google's own record of how often people search for "${esc(trends.keywords[0] || 'ex muslim')}": worldwide over five years, and where the searches come from. A rising line in a Muslim country is the exodus asking its first question.</p>
      ${trendsIframe('TIMESERIES', trends.keywords.slice(0, 3))}
      ${trendsIframe('GEO_MAP', trends.keywords.slice(0, 1))}
${(trends.geos || []).slice(0, 4).map((g) => `      <h3 class="harvest__geo">${esc(geoNames[g] || g)}</h3>\n      ${trendsIframe('TIMESERIES', trends.keywords.slice(0, 2), g)}`).join('\n')}
    </section>

    <section class="harvest__section">
      <h2>Latest from the channels</h2>
      <div class="grid">
${streamHtml}
      </div>
    </section>

    <section class="harvest__section harvest__tell" id="tell">
      <h2>Have you left Islam for Jesus?</h2>
      ${config.testimonyForm
        ? `<p class="digest__lede">Tell us your story, as much or as little as you like. We read every one, publish only with your permission, and never show a name without it.</p><iframe class="harvest__form" src="${esc(config.testimonyForm)}" title="Tell your story" loading="lazy">Loading…</iframe>`
        : `<p class="digest__lede">We would love to hear your story and, with your permission, tell it. Write to us on <a href="${esc(site.telegram || 'https://t.me/gloriousanchor')}" rel="noopener">Telegram</a>, where nobody has to use a real name.</p>`}
    </section>

    <section class="harvest__section">
      <h2>Read more</h2>
      <ul class="harvest__links">
        <li><a href="../articles/muslims-leaving-islam-david-wood-2-million/">Muslims are leaving Islam every day: David Wood on the "avalanche of apostasy"</a></li>
        <li><a href="../articles/prophet-isa-el-buba-former-muslim-occultist-turned-prophet/">Prophet Isa El-Buba: a former Muslim and occultist turned prophet</a></li>
        <li><a href="../apologetics/">Our Apologetics section</a></li>
      </ul>
    </section>
    <div id="subscribe">${subscribeHtml(site)}</div>
    <section class="digest__foot"><p>${esc(site.verse || '')}</p><p class="footer__meta">Data: <code>${esc(b)}/data/harvest.json</code> (counts only, no names). Figures are from the sources named; the comment tally is self-reported and unverified.</p></section>
  </main>
</body>
</html>`;
}
