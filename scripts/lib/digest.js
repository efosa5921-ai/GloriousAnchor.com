/**
 * Daily digest: a short, shareable summary of the day's best items.
 * Produces the /digest/ page, a WhatsApp-ready text, an RSS feed of daily digests (for RSS-to-email
 * services) and a plain top-stories feed for feed readers.
 */

import { shareUrl } from './share.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (site) => (site.url || '').replace(/\/$/, '');

const KIND_CAPS = { news: 4, article: 2, video: 1, audio: 1, social: 0, pick: 2 };

/** Pick a balanced handful: our articles and picks first, then one item per source with per-kind caps. */
export function pickDigest(articles, { count = 8, maxAgeHours = 36, now = Date.now() } = {}) {
  const cutoff = now - maxAgeHours * 3600 * 1000;
  const weekAgo = now - 7 * 86400 * 1000;
  // Our own articles and picks lead while they are recent; evergreen pinned pieces do not reappear every day.
  const fresh = articles.filter((a) => (a.internal || a.kind === 'pick') ? a.publishedAt >= weekAgo : a.publishedAt >= cutoff);
  const sorted = [...fresh].sort((a, b) => b.publishedAt - a.publishedAt);
  const lead = sorted.filter((a) => a.internal || a.kind === 'pick').slice(0, 2);
  const out = [...lead];
  const seenSource = new Set(lead.map((a) => a.sourceId));
  const perKind = {};
  for (const a of sorted) {
    if (out.length >= count) break;
    if (out.includes(a) || seenSource.has(a.sourceId)) continue;
    const kind = a.kind || 'news';
    if ((perKind[kind] || 0) >= (KIND_CAPS[kind] ?? 1)) continue;
    perKind[kind] = (perKind[kind] || 0) + 1;
    seenSource.add(a.sourceId);
    out.push(a);
  }
  // Still short (quiet day)? Fill with anything fresh, ignoring caps.
  for (const a of sorted) { if (out.length >= count) break; if (!out.includes(a)) out.push(a); }
  return out;
}

export function digestDate(d = new Date()) { return d.toISOString().slice(0, 10); }
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Plain text for WhatsApp, Telegram groups or an SMS. Bold title line, one item per paragraph. */
export function digestText(items, site, date) {
  const lines = [`*${site.name} — ${longDate(date)}*`, ''];
  for (const a of items) {
    const who = a.internal ? site.name : a.source;
    lines.push(`• ${a.title}${who ? ` — ${who}` : ''}`, shareUrl(a, site), '');
  }
  lines.push(`More every day at ${base(site)} ${site.tagline ? `— ${site.tagline}` : ''}`.trim());
  return lines.join('\n');
}

/**
 * HTML list of the day's items. inline=true (the RSS/email item) carries fixed colours for mail clients;
 * inline=false (the /digest/ page) uses classes so the site's light and dark themes apply.
 */
export function digestHtml(items, site, date, { inline = true } = {}) {
  const st = inline
    ? { li: ' style="margin:0 0 14px"', a: ' style="font-weight:600;color:#0b1f3a;text-decoration:none"', meta: ' style="color:#6b7280;font-size:14px"', date: ' style="color:#6b7280"', ul: ' style="list-style:none;padding:0;margin:0"' }
    : { li: ' class="digest__item"', a: ' class="digest__title"', meta: ' class="digest__meta"', date: ' class="digest__date"', ul: ' class="digest__list"' };
  const rows = items.map((a) => `<li${st.li}><a href="${esc(shareUrl(a, site))}"${st.a}>${esc(a.title)}</a><br><span${st.meta}>${esc(a.internal ? site.name : a.source)}${a.summary ? ` · ${esc(a.summary)}` : ''}</span></li>`).join('\n');
  return `<p${st.date}>${esc(longDate(date))}</p>\n<ul${st.ul}>\n${rows}\n</ul>\n<p>More every day at <a href="${esc(base(site))}/">${esc(base(site).replace(/^https?:\/\//, ''))}</a>.</p>`;
}

/** The /digest/ page: readable on its own, with one-tap copy for WhatsApp. */
export function renderDigestPage(items, site, date, text) {
  const b = base(site);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily digest — ${esc(site.name)}</title>
  <meta name="description" content="Today's best Christian news, articles and video in one short list from ${esc(site.name)}.">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0b1f3a">
  <link rel="canonical" href="${esc(b)}/digest/">
  <meta property="og:title" content="Daily digest — ${esc(site.name)}">
  <meta property="og:description" content="Today's best Christian news, articles and video in one short list.">
  <meta property="og:image" content="${esc(b)}/assets/social.jpg">
  <meta property="og:url" content="${esc(b)}/digest/">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../assets/anchor.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="${esc(site.name)} — Daily digest" href="feed.xml">
  <link rel="stylesheet" href="../styles.css">
</head>
<body class="article-page">
  <header class="masthead"><div class="wrap masthead__row">
    <a class="brand" href="../" aria-label="${esc(site.name)} home"><svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><use href="../assets/anchor.svg#anchor"/></svg><span class="brand__text"><span class="brand__name">${esc(site.name)}</span><span class="brand__tag">Daily digest</span></span></a>
  </div></header>
  <main class="wrap article">
    <h1>Today on ${esc(site.name)}</h1>
    <p class="article__lede">The day's best stories in one short list. Copy it into a WhatsApp or Telegram group, or subscribe by email.</p>
    <div class="digest__actions">
      <button class="btn" id="copyWa" type="button">Copy for WhatsApp</button>
      <a class="btn btn--ghost" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Share on WhatsApp</a>
      <a class="btn btn--ghost" href="feed.xml">Email / RSS feed</a>
    </div>
    <div class="article__body digest__body">
${digestHtml(items, site, date, { inline: false })}
    </div>
    <pre id="digestText" hidden>${esc(text)}</pre>
    <p class="footer__meta">Subscribe by email: paste <code>${esc(b)}/digest/feed.xml</code> into any RSS-to-email service, or read it in a feed reader.</p>
  </main>
  <footer class="footer"><div class="wrap"><p class="footer__meta"><a href="../">${esc(site.name)}</a> · <a href="../articles/">Our articles</a> · <a href="../churches/">Find a church</a></p></div></footer>
  <script>
    document.getElementById('copyWa').addEventListener('click', async (e) => {
      const t = document.getElementById('digestText').textContent;
      try { await navigator.clipboard.writeText(t); e.target.textContent = 'Copied!'; } catch { window.prompt('Copy this text', t); }
      setTimeout(() => { e.target.textContent = 'Copy for WhatsApp'; }, 2000);
    });
  </script>
</body>
</html>
`;
}

/** One RSS item per day; RSS-to-email services send each new item once. */
export function renderDigestFeed(history, site) {
  const b = base(site);
  const days = Object.keys(history).sort().reverse().slice(0, 14);
  const items = days.map((d) => `    <item>
      <title>${esc(`${site.name} — ${longDate(d)}`)}</title>
      <link>${esc(b)}/digest/?d=${d}</link>
      <guid isPermaLink="false">digest-${d}</guid>
      <pubDate>${new Date(`${d}T06:00:00Z`).toUTCString()}</pubDate>
      <description><![CDATA[${history[d].html.replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)} — Daily digest</title>
    <link>${esc(b)}/digest/</link>
    <atom:link href="${esc(b)}/digest/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(`The day's best Christian news, articles and video from ${site.name}, once a day.`)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/** A plain feed of the latest items for feed readers and automation (Zapier, IFTTT, Buffer). */
export function renderTopFeed(articles, site, limit = 40) {
  const b = base(site);
  const items = articles.slice(0, limit).map((a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${esc(a.url)}</link>
      <guid isPermaLink="false">${esc(a.id)}</guid>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      <source url="${esc(b)}/feed.xml">${esc(a.internal ? site.name : a.source)}</source>
      <description>${esc(`${a.internal ? site.name : a.source}${a.summary ? ` · ${a.summary}` : ''}`)}</description>${a.image ? `\n      <enclosure url="${esc(a.image)}" type="image/jpeg" length="0"/>` : ''}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)} — Top Stories</title>
    <link>${esc(b)}/</link>
    <atom:link href="${esc(b)}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(site.tagline || `Latest from ${site.name}`)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
