/** SEO helpers: sitemap, JSON-LD structured data, and pre-rendered headline cards for crawlers. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const base = (site) => String(site.url || '').replace(/\/$/, '');

export function sitemapXml(entries) {
  const rows = entries.map((e) => `  <url><loc>${esc(e.url)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ''}${e.priority != null ? `<priority>${e.priority}</priority>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

/** Serialise JSON-LD safely inside a <script> tag. */
export const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export function homeJsonLd(site) {
  const b = base(site);
  return jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', '@id': `${b}/#org`, name: site.name, url: `${b}/`, logo: `${b}/assets/icon-512.png`, description: site.tagline },
    { '@type': 'WebSite', '@id': `${b}/#site`, name: site.name, url: `${b}/`, publisher: { '@id': `${b}/#org` }, potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${b}/?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
  ] });
}

export function articleJsonLd(post, site) {
  const b = base(site);
  return jsonLd({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', '@id': `${post.url}#article`, headline: post.title, description: post.summary, url: post.url, mainEntityOfPage: post.url,
      datePublished: new Date(post.publishedAt).toISOString(), dateModified: new Date(post.publishedAt).toISOString(),
      author: { '@type': 'Person', name: post.author }, publisher: { '@id': `${b}/#org` }, ...(post.image ? { image: [post.image] } : {}), wordCount: post.readingMinutes * 220 },
    { '@type': 'Organization', '@id': `${b}/#org`, name: site.name, url: `${b}/`, logo: `${b}/assets/icon-512.png` },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: site.name, item: `${b}/` },
      { '@type': 'ListItem', position: 2, name: 'Articles', item: `${b}/articles/` },
      { '@type': 'ListItem', position: 3, name: post.title, item: post.url } ] },
  ] });
}

export function churchJsonLd(c, site) {
  const b = base(site);
  const out = { '@context': 'https://schema.org', '@type': 'Church', '@id': `${c.url}#church`, name: c.name, url: c.url, ...(c.website ? { sameAs: c.website } : {}),
    ...(c.address ? { address: { '@type': 'PostalAddress', streetAddress: c.address } } : {}),
    ...(c.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: c.lat, longitude: c.lng } } : {}),
    ...(c.phone ? { telephone: c.phone } : {}), ...(c.denomination ? { additionalType: c.denomination } : {}), ...(c.serviceTimes ? { openingHours: c.serviceTimes } : {}),
    isPartOf: { '@type': 'WebSite', '@id': `${b}/#site` } };
  return jsonLd(out);
}

/** Static cards for the front page so crawlers (and no-JS visitors) see real headlines. Replaced by the app once data loads. */
export const proxied = (template, url, w) => (template && url && !/^https?:\/\/gloriousanchor\.com\//.test(url) ? template.replace(/\{url\}/g, encodeURIComponent(url)).replace('{w}', String(w)) : url);

/** A designed stand-in for cards without a picture: the source name on one of six brand gradients, with the anchor. */
export function coverIndex(key = '') { let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 6; }
export function coverHtml(a) {
  return `<span class="cover cover--${coverIndex(a.sourceId || a.source)}" aria-hidden="true"><svg viewBox="0 0 32 32"><use href="/assets/anchor.svg#anchor"/></svg><b>${esc(a.source || '')}</b></span>`;
}
const KIND_LABEL = { news: 'News', article: 'Article', video: 'Video', audio: 'Audio', social: 'Post', pick: 'Pick' };
const IMG_FALLBACK = `onerror="if(this.dataset.alt&amp;&amp;this.src!==this.dataset.alt){this.src=this.dataset.alt}else{var c=this.closest('.card');c&amp;&amp;c.classList.add(c.classList.contains('card--social')?'card--noimg':'card--cover');this.parentNode.innerHTML=c&amp;&amp;c.dataset.cover||''}"`;
/**
 * A static story card in the site's card markup (used by the digest, story pages and prerendered headlines).
 * href: where the card links; summary/date: whether to show them; extra: extra classes.
 */
export function cardHtml(a, { href = a.url, imageProxy = '', site = null, summary = true, date = true, extra = '' } = {}) {
  const who = a.internal && site ? site.name : (a.source || '');
  const cls = `card card--${a.kind || 'news'}${a.image ? '' : a.kind === 'social' ? ' card--noimg' : ' card--cover'}${a.pinned ? ' card--pinned' : ''}${extra ? ` ${extra}` : ''}`;
  const cover = a.kind === 'social' ? '' : coverHtml({ ...a, source: who });
  const media = a.image
    ? `<a class="card__media" href="${esc(href)}"><img loading="lazy" decoding="async" src="${esc(proxied(imageProxy, a.image, 480))}" data-alt="${esc(a.image)}" alt="" ${IMG_FALLBACK}></a>`
    : cover ? `<a class="card__media" href="${esc(href)}">${cover}</a>` : '';
  const kind = a.internal ? (a.pinned ? 'Pinned' : 'Ours') : a.pinned ? 'Pinned pick' : (KIND_LABEL[a.kind] || 'News');
  return `<article class="${cls}" data-cover="${esc(cover)}">
  ${media}
  <div class="card__body">
    <div class="card__meta"><span class="card__kind">${kind}</span><span class="card__source">${esc(who)}</span>${date ? `<span class="dot">·</span><time datetime="${new Date(a.publishedAt).toISOString()}">${new Date(a.publishedAt).toISOString().slice(0, 10)}</time>` : ''}</div>
    <h3 class="card__title"><a href="${esc(href)}"${a.internal ? '' : ' rel="noopener"'}>${esc(a.title)}</a></h3>
    ${summary && a.summary ? `<p class="card__summary">${esc(a.summary)}</p>` : ''}
  </div>
</article>`;
}
export function prerenderCards(articles, n = 24, imageProxy = '') {
  const pinned = articles.filter((a) => a.pinned);
  const rest = articles.filter((a) => !a.pinned);
  const list = [...pinned, ...rest].slice(0, n);
  return list.map((a) => `<article class="card${a.image ? '' : a.kind === 'social' ? ' card--noimg' : ' card--cover'}">
  ${a.image ? `<a class="card__media" href="${esc(a.url)}"><img loading="lazy" decoding="async" src="${esc(proxied(imageProxy, a.image, 480))}" data-alt="${esc(a.image)}" alt="" onerror="if(this.dataset.alt&amp;&amp;this.src!==this.dataset.alt){this.src=this.dataset.alt}else{this.closest('.card')?.classList.add('card--noimg');this.parentNode.remove()}"></a>` : a.kind === 'social' ? '' : `<a class="card__media" href="${esc(a.url)}">${coverHtml(a)}</a>`}
  <div class="card__body">
    <div class="card__meta"><span class="card__source">${esc(a.source)}</span><span class="dot">·</span><time datetime="${new Date(a.publishedAt).toISOString()}">${new Date(a.publishedAt).toISOString().slice(0, 10)}</time></div>
    <h3 class="card__title"><a href="${esc(a.url)}"${a.internal ? '' : ' rel="noopener"'}>${esc(a.title)}</a></h3>
    ${a.summary ? `<p class="card__summary">${esc(a.summary)}</p>` : ''}
  </div>
</article>`).join('\n');
}

export function metaTags({ title, description, url, image, type = 'website', site }) {
  return [
    url ? `<link rel="canonical" href="${esc(url)}">` : '',
    `<meta property="og:type" content="${type}">`, `<meta property="og:site_name" content="${esc(site.name)}">`,
    url ? `<meta property="og:url" content="${esc(url)}">` : '', title ? `<meta property="og:title" content="${esc(title)}">` : '',
    description ? `<meta property="og:description" content="${esc(description)}">` : '', image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`, title ? `<meta name="twitter:title" content="${esc(title)}">` : '',
    description ? `<meta name="twitter:description" content="${esc(description)}">` : '', image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
  ].filter(Boolean).join('\n  ');
}

export const churchSlug = (c) => String(c.name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'church';
