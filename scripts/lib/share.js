/**
 * Story pages: every external story gets a short gloriousanchor.com address (/s/<id>/). Shared anywhere, it shows a
 * Glorious Anchor preview card; opened, it shows the story card on our site with a clear "read the full story" button
 * and more stories from the same section, so a shared link always introduces the site before sending readers on.
 */
import { proxied } from './seo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (site) => (site.url || '').replace(/\/$/, '');
const KIND_LABEL = { news: 'News', article: 'Article', video: 'Video', audio: 'Audio', social: 'Post', pick: 'Pick' };
const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Our own pages are shared as themselves; everything else goes through the story page. */
export function shareUrl(a, site) {
  return a.internal ? a.url : `${base(site)}/s/${encodeURIComponent(a.id)}/`;
}

/** Up to n other stories from the same section, newest first, pictures preferred. */
export function relatedStories(a, articles, n = 6) {
  const cats = new Set(a.categories || [a.category]);
  const same = articles.filter((b) => b.id !== a.id && (b.categories || [b.category]).some((c) => cats.has(c)));
  const withImg = same.filter((b) => b.image);
  const pool = withImg.length >= n ? withImg : same;
  return pool.sort((x, y) => y.publishedAt - x.publishedAt).slice(0, n);
}

function verb(a) { return a.kind === 'video' ? 'Watch' : a.kind === 'audio' ? 'Listen' : a.kind === 'social' ? 'See the post' : 'Read the full story'; }

export function renderSharePage(a, site, more = [], categoryLabel = '') {
  const b = base(site);
  const who = a.source || site.name;
  const description = `${who}${a.summary ? ` · ${a.summary}` : ''}`;
  const image = a.image ? proxied(site.imageProxy, a.image, 1200) : `${b}/assets/social.jpg`;
  const hero = a.image ? `<a class="story__media" href="${esc(a.url)}" rel="noopener"><img class="article__hero" src="${esc(proxied(site.imageProxy, a.image, 960))}" alt="" fetchpriority="high"></a>` : '';
  const cta = a.kind === 'audio' && a.audio
    ? `<audio class="story__audio" controls preload="none" src="${esc(a.audio)}"></audio>\n      <a class="btn btn--ghost story__cta" href="${esc(a.url)}" rel="noopener">Episode page at ${esc(who)} →</a>`
    : `<a class="btn story__cta" href="${esc(a.url)}" rel="noopener">${verb(a)} at ${esc(who)} →</a>`;
  const moreHtml = more.map((m) => `<article class="card${m.image ? '' : ' card--noimg'} card--${esc(m.kind || 'news')}">
  ${m.image ? `<a class="card__media" href="${esc(shareUrl(m, site))}"><img loading="lazy" decoding="async" src="${esc(proxied(site.imageProxy, m.image, 480))}" alt=""></a>` : ''}
  <div class="card__body">
    <div class="card__meta"><span class="card__kind">${KIND_LABEL[m.kind] || 'News'}</span><span class="card__source">${esc(m.internal ? site.name : m.source)}</span></div>
    <h3 class="card__title"><a href="${esc(shareUrl(m, site))}">${esc(m.title)}</a></h3>
  </div>
</article>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(a.title)} — ${esc(site.name)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0b1f3a">
  <link rel="canonical" href="${esc(a.url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(a.title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:url" content="${esc(shareUrl(a, site))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(a.title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <link rel="icon" href="../../assets/anchor.svg" type="image/svg+xml">
  <link rel="manifest" href="../../assets/site.webmanifest">
  <link rel="stylesheet" href="../../styles.css">
</head>
<body class="article-page story-page">
  <header class="masthead">
    <div class="wrap masthead__row">
      <a class="brand" href="../../" aria-label="${esc(site.name)} home">
        <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><use href="../../assets/anchor.svg#anchor"/></svg>
        <span class="brand__text"><span class="brand__name">${esc(site.name)}</span><span class="brand__tag">${esc(site.tagline || '')}</span></span>
      </a>
      <nav class="masthead__tools article-nav"><a href="../../">← All headlines</a></nav>
    </div>
  </header>
  <main class="wrap article">
    <article class="story">
      <p class="article__meta story__meta"><span class="card__kind">${KIND_LABEL[a.kind] || 'News'}</span> <strong>${esc(who)}</strong>${a.author && a.author.toLowerCase() !== who.toLowerCase() ? ` · ${esc(a.author)}` : ''} · <time datetime="${new Date(a.publishedAt).toISOString()}">${fmtDate(a.publishedAt)}</time></p>
      <h1 class="article__title"><a href="${esc(a.url)}" rel="noopener">${esc(a.title)}</a></h1>
      ${hero}
      ${a.summary ? `<p class="story__summary">${esc(a.summary)}</p>` : ''}
      ${cta}
      <p class="story__note">Found on ${esc(site.name)}. We link to the original; the full story belongs to ${esc(who)}.</p>
    </article>
    ${more.length ? `<aside class="article__aside story__more">
      <h2>More ${categoryLabel ? `in ${esc(categoryLabel)}` : `from ${esc(site.name)}`}</h2>
      <div class="grid">
${moreHtml}
      </div>
      <p><a class="btn btn--ghost" href="../../${a.category && a.category !== 'top' ? `?c=${encodeURIComponent(a.category)}` : ''}">See all headlines →</a> &nbsp; <a class="btn btn--ghost" href="../../digest/">Today's digest</a></p>
    </aside>` : ''}
  </main>
  <footer class="footer">
    <div class="wrap footer__row">
      <div><p class="footer__verse">${esc(site.verse || '')}</p><p><strong>${esc(site.name)}</strong> · <a href="../../">Front page</a> · <a href="../../churches/">Find a church</a> · <a href="../../articles/">Our articles</a></p></div>
    </div>
  </footer>
</body>
</html>
`;
}
