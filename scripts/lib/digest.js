/**
 * Daily digest: a short, shareable summary of the day's best items.
 * Produces the /digest/ page, a WhatsApp-ready text, an RSS feed of daily digests (for RSS-to-email
 * services) and a plain top-stories feed for feed readers.
 */

import { shareUrl } from './share.js';
import { cardHtml, subscribeHtml } from './seo.js';
import { previewImage } from './share.js';

/** Markdown version for pasting into a newsletter editor (Buttondown, Substack, etc.). */
export function digestMarkdown(items, site, date) {
  const lines = [`## Today on ${site.name} — ${longDate(date)}`, ''];
  for (const a of items) {
    const who = a.internal ? site.name : a.source;
    lines.push(`**[${a.title}](${shareUrl(a, site)})**  `, `${who}${a.summary ? ` · ${a.summary}` : ''}`, '');
  }
  lines.push(`More every day at [${base(site).replace(/^https?:\/\//, '')}](${base(site)}/).`);
  return lines.join('\n');
}

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
  const md = digestMarkdown(items, site, date);
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
<body class="article-page digest-page">
  <header class="masthead"><div class="wrap masthead__row">
    <a class="brand" href="../" aria-label="${esc(site.name)} home"><svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><use href="../assets/anchor.svg#anchor"/></svg><span class="brand__text"><span class="brand__name">${esc(site.name)}</span><span class="brand__tag">Daily digest</span></span></a>
    <nav class="masthead__tools article-nav"><a href="../">← All headlines</a></nav>
  </div></header>
  <main class="wrap">
    <section class="digest__head">
      <p class="digest__notice" id="notice" hidden></p>
      <p class="digest__kicker">Daily digest · ${esc(longDate(date))}</p>
      <h1 class="digest__h1">Today on ${esc(site.name)}</h1>
      <p class="digest__lede">The day's best stories, chosen from every section. Pass them on to your group, or have them land in your inbox each morning.</p>
      <div class="digest__actions">
        <button class="btn" id="copyWa" type="button">Copy for WhatsApp</button>
        <a class="btn btn--ghost" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Share on WhatsApp</a>
        ${site.newsletter ? `<a class="btn btn--ghost" href="#subscribe">Get it by email</a>` : `<a class="btn btn--ghost" href="feed.xml">RSS feed</a>`}
        <button class="btn btn--ghost" id="copyMd" type="button" title="Markdown for a newsletter editor">Copy for email</button>
        <button class="btn btn--ghost" id="shareCard" type="button" title="A picture of today's headlines to post on WhatsApp, Instagram or Facebook">Share as picture</button>
      </div>
      <p class="digest__hint" id="cardHint" hidden></p>
    </section>
    <section class="digest__stories grid">
${items.map((a, i) => cardHtml(a, { href: shareUrl(a, site), imageProxy: site.imageProxy, site, summary: true, date: false, extra: i === 0 ? 'card--lead' : '' })).join('\n')}
    </section>
    <div id="subscribe">${subscribeHtml(site)}</div>
    <section class="digest__foot">
      <p>${esc(site.verse || '')}</p>
      <p class="footer__meta">Feed readers and automation: <code>${esc(b)}/digest/feed.xml</code> carries one digest a day; <code>${esc(b)}/feed.xml</code> carries every new item.</p>
    </section>
    <pre id="digestText" hidden>${esc(text)}</pre>
    <script type="application/json" id="digestData">${JSON.stringify({ site: site.name, date: longDate(date), url: b.replace(/^https?:\/\//, ''), items: items.map((a) => ({ title: a.title, source: a.internal ? site.name : a.source, image: a.image ? previewImage(a, site) : null })) }).replace(/</g, '\\u003c')}</script>
    <pre id="digestMd" hidden>${esc(md)}</pre>
  </main>
  <footer class="footer"><div class="wrap"><p class="footer__meta"><a href="../">${esc(site.name)}</a> · <a href="../articles/">Our articles</a> · <a href="../churches/">Find a church</a></p></div></footer>
  <script>
    const copier = (btnId, srcId, label) => document.getElementById(btnId).addEventListener('click', async (e) => {
      const t = document.getElementById(srcId).textContent;
      try { await navigator.clipboard.writeText(t); e.target.textContent = 'Copied!'; } catch { window.prompt('Copy this text', t); }
      setTimeout(() => { e.target.textContent = label; }, 2000);
    });
    copier('copyWa', 'digestText', 'Copy for WhatsApp');
    copier('copyMd', 'digestMd', 'Copy for email');
    // "Share as picture": draw a branded card of today's headlines and hand it to the phone's share sheet (or download it).
    const cardBtn = document.getElementById('shareCard'), hint = document.getElementById('cardHint');
    async function digestCard() {
      const d = JSON.parse(document.getElementById('digestData').textContent);
      const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1f3f6e'); g.addColorStop(.6, '#0b1f3a'); g.addColorStop(1, '#07142a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      // anchor mark
      x.save(); x.translate(72, 64); x.scale(2.6, 2.6); x.fillStyle = '#0b1f3a'; x.beginPath(); x.arc(16, 16, 15, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#e8b84a'; x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.arc(16, 7.5, 2.5, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(16, 10); x.lineTo(16, 25); x.stroke(); x.beginPath(); x.moveTo(11, 13.5); x.lineTo(21, 13.5); x.stroke();
      x.beginPath(); x.moveTo(7, 19); x.bezierCurveTo(7, 23, 11, 26, 16, 26); x.bezierCurveTo(21, 26, 25, 23, 25, 19); x.stroke();
      x.beginPath(); x.moveTo(7, 19); x.lineTo(5, 17.5); x.moveTo(7, 19); x.lineTo(9.5, 18.5); x.moveTo(25, 19); x.lineTo(27, 17.5); x.moveTo(25, 19); x.lineTo(22.5, 18.5); x.stroke(); x.restore();
      x.fillStyle = '#fff'; x.font = '700 44px Georgia, "Times New Roman", serif'; x.fillText(d.site, 172, 100);
      x.fillStyle = '#e8b84a'; x.font = '700 26px Inter, Arial, sans-serif'; x.fillText('DAILY DIGEST · ' + d.date.toUpperCase(), 172, 138);
      // lead picture (if the proxy allows cross-origin drawing)
      let y = 200;
      const lead = d.items.find((i) => i.image);
      if (lead) {
        try {
          const img = await new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = lead.image; });
          const bw = W - 144, bh = 380, r = Math.max(bw / img.width, bh / img.height), sw = bw / r, sh = bh / r;
          x.save(); x.beginPath(); x.roundRect(72, y, bw, bh, 24); x.clip(); x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 72, y, bw, bh); x.restore();
          y += bh + 40;
        } catch { /* no picture, headlines only */ }
      }
      x.fillStyle = '#fff'; x.font = '700 56px Georgia, "Times New Roman", serif'; x.fillText('Today on ' + d.site, 72, y + 50); y += 110;
      const wrap = (t, max) => { const words = t.split(' '), lines = []; let line = ''; for (const w of words) { const test = line ? line + ' ' + w : w; if (x.measureText(test).width > max && line) { lines.push(line); line = w; } else line = test; } if (line) lines.push(line); return lines; };
      const slotsAvail = Math.floor((H - 120 - y) / 118);
      for (const it of d.items.slice(0, Math.max(3, Math.min(8, slotsAvail)))) {
        x.fillStyle = '#e8b84a'; x.beginPath(); x.arc(84, y + 14, 7, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#fff'; x.font = '600 36px Inter, Arial, sans-serif';
        const lines = wrap(it.title, W - 190).slice(0, 2); if (lines.length === 2 && wrap(it.title, W - 190).length > 2) lines[1] = lines[1].replace(/\s?\S*$/, '…');
        lines.forEach((l, i) => x.fillText(l, 110, y + 26 + i * 44));
        x.fillStyle = 'rgba(255,255,255,.65)'; x.font = '400 26px Inter, Arial, sans-serif'; x.fillText(it.source, 110, y + 26 + lines.length * 44 - 6);
        y += 40 + lines.length * 44 + 18;
      }
      x.fillStyle = '#e8b84a'; x.font = '700 32px Inter, Arial, sans-serif'; x.fillText(d.url + '/digest', 72, H - 60);
      x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '400 26px Inter, Arial, sans-serif'; x.textAlign = 'right'; x.fillText('Follow for more every day', W - 72, H - 60); x.textAlign = 'left';
      return new Promise((res) => c.toBlob(res, 'image/png'));
    }
    cardBtn.addEventListener('click', async () => {
      cardBtn.disabled = true; cardBtn.textContent = 'Preparing…';
      try {
        const blob = await digestCard(); window.__digestCardSize = blob.size;
        const file = new File([blob], 'glorious-anchor-digest.png', { type: 'image/png' });
        const caption = document.getElementById('digestText').textContent;
        try { await navigator.clipboard.writeText(caption); } catch { /* ignore */ }
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: caption });
          hint.textContent = 'Shared. The headline text is on your clipboard to paste as the caption.';
        } else {
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          hint.textContent = 'Picture downloaded, and the headline text is on your clipboard to paste as the caption.';
        }
        hint.hidden = false;
      } catch (err) { if (err?.name !== 'AbortError') { hint.textContent = 'Could not make the picture: ' + err.message; hint.hidden = false; } }
      cardBtn.disabled = false; cardBtn.textContent = 'Share as picture';
    });
    const q = new URLSearchParams(location.search), notice = document.getElementById('notice');
    if (q.has('subscribed')) { notice.textContent = 'Almost there: check your inbox and tap the confirmation link.'; notice.hidden = false; }
    else if (q.has('confirmed')) { notice.textContent = 'You are in. The next digest lands in your inbox tomorrow morning.'; notice.hidden = false; }
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
