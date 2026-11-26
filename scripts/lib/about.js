/**
 * The About us page (/about/): who Glorious Anchor International Network is, every place to follow it,
 * how to reach it, and the mission document to download. Everything shown comes from the "site" block of
 * feeds.json, so a handle or contact detail added in the admin appears here without a code change.
 */

import { base, subscribeHtml } from './seo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bare = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const handle = (h) => String(h || '').trim().replace(/^@/, '');
/** "@name" from a profile link such as https://www.youtube.com/@name or https://t.me/name; '' when there is none. */
const handleFrom = (url) => { const m = String(url || '').match(/\/@?([\w.-]+)\/?$/); return m ? `@${m[1]}` : ''; };
/** A handle or a full link, for the accounts the admin lets the owner give either way. */
const profile = (value, prefix) => { const v = String(value || '').trim(); return /^https?:\/\//i.test(v) ? v : `${prefix}${handle(v)}`; };

/** Every place the network can be followed, in the order shown: [{ key, name, label, url }]. */
export function socialLinks(site) {
  const out = [];
  const add = (key, name, label, url) => { if (url) out.push({ key, name, label, url }); };
  add('whatsapp', 'WhatsApp channel', site.name || 'Glorious Anchor', site.whatsappChannel);
  add('telegram', 'Telegram', handleFrom(site.telegramChannel) || bare(site.telegramChannel), site.telegramChannel);
  add('youtube', 'YouTube', handleFrom(site.youtubeChannel) || bare(site.youtubeChannel), site.youtubeChannel);
  if (site.xHandle) add('x', 'X (Twitter)', `@${handle(site.xHandle)}`, `https://x.com/${encodeURIComponent(handle(site.xHandle))}`);
  if (site.facebookPage) add('facebook', 'Facebook', bare(profile(site.facebookPage, 'https://www.facebook.com/')), profile(site.facebookPage, 'https://www.facebook.com/'));
  if (site.instagram) add('instagram', 'Instagram', /^https?:/i.test(site.instagram) ? bare(site.instagram) : `@${handle(site.instagram)}`, profile(site.instagram, 'https://www.instagram.com/'));
  if (site.tiktok) add('tiktok', 'TikTok', /^https?:/i.test(site.tiktok) ? bare(site.tiktok) : `@${handle(site.tiktok)}`, profile(site.tiktok, 'https://www.tiktok.com/@'));
  return out;
}

/** How to reach the network: [{ name, label, url }]. */
export function contactDetails(site) {
  const out = [];
  if (site.contactEmail) out.push({ name: 'Email', label: site.contactEmail, url: `mailto:${site.contactEmail}` });
  if (site.phone) out.push({ name: 'Phone', label: site.phone, url: `tel:${String(site.phone).replace(/[^\d+]/g, '')}` });
  if (site.whatsappNumber) out.push({ name: 'WhatsApp', label: site.whatsappNumber, url: `https://wa.me/${String(site.whatsappNumber).replace(/\D/g, '')}` });
  if (site.address) out.push({ name: 'Address', label: site.address, url: '' });
  out.push({ name: 'Website', label: bare(site.url), url: `${base(site)}/` });
  return out;
}

/** The same details as plain text, ready to paste under a greeting or an announcement. */
export function detailsText(site, { mission } = {}) {
  const b = base(site);
  const lines = [`Website: ${b}`, `About us: ${b}/about/`, 'GAIN TV: https://gaintv.app', 'GAIN Radio: https://gainradio.app'];
  for (const s of socialLinks(site)) lines.push(`${s.name}: ${s.url}`);
  for (const c of contactDetails(site)) if (c.name !== 'Website') lines.push(`${c.name}: ${c.label}`);
  if (mission) lines.push(`Our mission (download): ${b}/${mission.path}`);
  return lines.join('\n');
}

const row = ({ name, label, url }) => `<li class="about__item"><span class="about__name">${esc(name)}</span>${url
  ? `<a class="about__value" href="${esc(url)}"${/^https?:/.test(url) ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}</a>`
  : `<span class="about__value">${esc(label)}</span>`}</li>`;

/**
 * @param site     the "site" block of feeds.json
 * @param mission  { path, bytes, pages } of the mission document inside the site, or null when there is none
 */
export function renderAboutPage(site, { mission = null } = {}) {
  const b = base(site);
  const network = site.network || site.name;
  const short = (network.match(/\(([^)]+)\)/) || [])[1] || site.name;
  const full = network.replace(/\s*\([^)]*\)\s*$/, '');
  const socials = socialLinks(site);
  const contacts = contactDetails(site);
  const description = `About ${full} (${short}): who we are, our mission, how to contact us, and where to follow us on ${socials.slice(0, 4).map((s) => s.name.replace(/ channel| \(Twitter\)/, '')).join(', ')}.`;
  const size = !mission ? '' : mission.bytes < 1024 * 1024 ? `${Math.round(mission.bytes / 1024)} KB` : `${(mission.bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    url: `${b}/about/`,
    name: `About ${full}`,
    mainEntity: {
      '@type': 'Organization',
      name: full,
      alternateName: [short, site.name].filter((v, i, a) => v && a.indexOf(v) === i),
      url: `${b}/`,
      logo: `${b}/assets/icon-512.png`,
      ...(site.motto ? { slogan: site.motto } : {}),
      ...(site.contactEmail ? { email: site.contactEmail } : {}),
      ...(site.phone ? { telephone: site.phone } : {}),
      sameAs: [...socials.map((s) => s.url), 'https://gaintv.app', 'https://gainradio.app'],
    },
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>About us — ${esc(full)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#0b1f3a">
  <link rel="canonical" href="${esc(b)}/about/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="About us — ${esc(full)} (${esc(short)})">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(b)}/assets/social.jpg">
  <meta property="og:url" content="${esc(b)}/about/">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../assets/anchor.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../styles.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body class="article-page about-page">
  <header class="masthead"><div class="wrap masthead__row">
    <a class="brand" href="../" aria-label="${esc(site.name)} home"><svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><use href="../assets/anchor.svg#anchor"/></svg><span class="brand__text"><span class="brand__name">${esc(site.name)}</span><span class="brand__tag">About us</span></span></a>
    <nav class="masthead__tools article-nav"><a href="../">← All headlines</a></nav>
  </div></header>
  <main class="wrap about">
    <section class="about__head">
      <p class="digest__kicker">About us</p>
      <h1 class="digest__h1">${esc(full)} <span class="about__short">(${esc(short)})</span></h1>
      ${site.motto ? `<p class="about__motto">${esc(site.motto)}</p>` : ''}
      ${site.verse ? `<p class="about__verse">${esc(site.verse)}</p>` : ''}
    </section>

    <section class="about__section">
      <h2>Who we are</h2>
      <p>${esc(full)} is an outreach ministry, powered by prayer and training, that exists to proclaim the word of God with Jesus as the centrepoint and His work of salvation as the focus. Our assignment is Isaiah 61:1-2 and Luke 4:18-19: good news to the poor, healing for the broken-hearted, deliverance for the captives, and the proclamation of the acceptable year of the Lord.</p>
      <p>The name comes from Hebrews 6:19, the hope we have in Christ "as an anchor of the soul, both sure and stedfast". The initials, ${esc(short)}, say what we are for: in Paul's words, "that I might gain the more" (1 Corinthians 9:19). We are gainers of souls. We pray to gather, even as we gather to pray.</p>
    </section>

    <section class="about__section">
      <h2>What we do</h2>
      <ul class="about__list">
        <li class="about__item"><span class="about__name">${esc(site.name)}</span><span class="about__value"><a href="../">${esc(bare(site.url))}</a>: Christian news, voices and video from across the church, gathered in one place every day, with <a href="../articles/">our own articles</a>, a <a href="../digest/">daily digest</a>, a <a href="../churches/">church finder</a>, <a href="../harvest/">The Harvest</a> and a <a href="../quiz/">Bible quiz</a>.</span></li>
        <li class="about__item"><span class="about__name">GAIN TV</span><span class="about__value"><a href="https://gaintv.app">gaintv.app</a>: new Christian teaching, apologetics and worship videos every day.</span></li>
        <li class="about__item"><span class="about__name">GAIN Radio</span><span class="about__value"><a href="https://gainradio.app">gainradio.app</a>: sermons, podcasts and music to listen to.</span></li>
      </ul>
    </section>
${mission ? `
    <section class="about__section about__mission" id="mission">
      <h2>Our mission</h2>
      <p>The mission document records the encounters that gave birth to ${esc(short)}, the meaning of the name, and the what, why, how, when and where of the vision.</p>
      <p><a class="btn" href="../${esc(mission.path)}" download>Download the mission document</a> <span class="about__file">PDF${mission.pages ? `, ${mission.pages} pages` : ''}, ${esc(size)}</span></p>
    </section>
` : ''}
    <section class="about__section" id="follow">
      <h2>Follow us</h2>
      <ul class="about__list">
        ${socials.map(row).join('\n        ')}
        ${site.newsletter ? row({ name: 'Email newsletter', label: 'The daily digest in your inbox', url: site.newsletter }) : ''}
        ${row({ name: 'RSS', label: `${bare(site.url)}/feed.xml`, url: `${b}/feed.xml` })}
      </ul>
    </section>

    <section class="about__section" id="contact">
      <h2>Contact us</h2>
      <ul class="about__list">
        ${contacts.map(row).join('\n        ')}
      </ul>
    </section>

    ${subscribeHtml(site)}
  </main>
  <footer class="footer">
    <div class="wrap footer__row">
      <div><p class="footer__verse">${esc(site.verse || '')}</p><p><strong>${esc(site.name)}</strong> · <a href="../">Back to the headlines</a></p></div>
    </div>
  </footer>
</body>
</html>
`;
}
