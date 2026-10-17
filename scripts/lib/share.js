/**
 * Share links: every story gets a short gloriousanchor.com address (/s/<id>/) that shows a Glorious Anchor
 * preview card wherever it is pasted, then sends the reader straight on to the original article.
 */
import { proxied } from './seo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (site) => (site.url || '').replace(/\/$/, '');

/** Our own pages are shared as themselves; everything else goes through the branded share page. */
export function shareUrl(a, site) {
  return a.internal ? a.url : `${base(site)}/s/${encodeURIComponent(a.id)}/`;
}

export function renderSharePage(a, site) {
  const b = base(site);
  const who = a.source || site.name;
  const description = `${who}${a.summary ? ` · ${a.summary}` : ''}`;
  const image = a.image ? proxied(site.imageProxy, a.image, 1200) : `${b}/assets/social.jpg`;
  const kindWord = a.kind === 'video' ? 'Watch' : a.kind === 'audio' ? 'Listen' : 'Read';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(a.title)} — ${esc(site.name)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="noindex">
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
  <meta http-equiv="refresh" content="0; url=${esc(a.url)}">
  <script>location.replace(${JSON.stringify(a.url)});</script>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #0b1f3a; color: #fff; text-align: center; padding: 24px; }
    a { color: #e8b84a; } .btn { display: inline-block; margin-top: 12px; padding: 10px 18px; border-radius: 999px; background: #e8b84a; color: #0b1f3a; font-weight: 600; text-decoration: none; }
    p { margin: 6px 0; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <h1 style="font-size:1.25rem;margin:0 0 4px">${esc(a.title)}</h1>
    <p>${esc(who)} · found on <a href="${esc(b)}/">${esc(site.name)}</a></p>
    <a class="btn" href="${esc(a.url)}">${kindWord} at ${esc(who)} →</a>
  </main>
</body>
</html>
`;
}
