import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxied, sitemapXml, jsonLd, homeJsonLd, articleJsonLd, churchJsonLd, prerenderCards, metaTags, churchSlug } from '../scripts/lib/seo.js';
const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com/', tagline: 'Tag' };

test('sitemapXml lists urls with optional lastmod', () => {
  const xml = sitemapXml([{ url: 'https://g.com/', priority: 1 }, { url: 'https://g.com/a/?x=1&y=2', lastmod: Date.parse('2026-10-15T12:00:00Z') }]);
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes('<loc>https://g.com/</loc>'));
  assert.ok(xml.includes('<loc>https://g.com/a/?x=1&amp;y=2</loc><lastmod>2026-10-15</lastmod>'));
});

test('jsonLd escapes closing tags and the graphs carry the essentials', () => {
  assert.ok(!jsonLd({ a: '</script>' }).includes('</script>'.repeat(2)));
  const home = homeJsonLd(site); assert.ok(home.includes('"@type":"WebSite"') && home.includes('"@type":"Organization"') && home.includes('https://gloriousanchor.com/?q={search_term_string}'));
  const art = articleJsonLd({ title: 'T', summary: 'S', url: 'https://gloriousanchor.com/articles/t/', publishedAt: 0, author: 'A', readingMinutes: 2, image: null }, site);
  assert.ok(art.includes('"@type":"Article"') && art.includes('"headline":"T"') && art.includes('"@type":"BreadcrumbList"'));
  const ch = churchJsonLd({ name: 'Grace', url: 'https://gloriousanchor.com/churches/grace/', address: '1 Rd', lat: 6.3, lng: 5.6, phone: '+234', serviceTimes: 'Su 09:00' }, site);
  assert.ok(ch.includes('"@type":"Church"') && ch.includes('"latitude":6.3') && ch.includes('"openingHours":"Su 09:00"'));
});

test('prerenderCards puts pinned first, escapes text and caps the count', () => {
  const html = prerenderCards([{ title: 'A <b>', url: 'https://x/a', source: 'S', publishedAt: 0, summary: 'sum' }, { title: 'Pinned', url: 'https://x/p', source: 'S', publishedAt: 0, pinned: true, image: 'https://i/p.jpg' }, { title: 'C', url: 'https://x/c', source: 'S', publishedAt: 0 }], 2);
  assert.ok(html.indexOf('Pinned') < html.indexOf('A &lt;b&gt;'));
  assert.ok(!html.includes('>C<'));
  assert.ok(html.includes('card--noimg') && html.includes('src="https://i/p.jpg"'));
});

test('metaTags and churchSlug', () => {
  const m = metaTags({ title: 'T "q"', description: 'D', url: 'https://g.com/x/', image: 'https://g.com/s.png', site });
  assert.ok(m.includes('<link rel="canonical" href="https://g.com/x/">') && m.includes('content="T &quot;q&quot;"') && m.includes('summary_large_image'));
  assert.equal(churchSlug({ name: 'St. Matthew\'s Catholic Church, Benin' }), 'st-matthew-s-catholic-church-benin');
});

test('proxied rewrites third-party images through the template but leaves our own alone', () => {
  const t = 'https://wsrv.nl/?url={url}&w={w}&default={url}';
  assert.equal(proxied(t, 'https://cdn.example.com/a.jpg', 480), 'https://wsrv.nl/?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&w=480&default=https%3A%2F%2Fcdn.example.com%2Fa.jpg');
  assert.equal(proxied(t, 'https://gloriousanchor.com/assets/social.jpg', 480), 'https://gloriousanchor.com/assets/social.jpg');
  assert.equal(proxied('', 'https://cdn.example.com/a.jpg', 480), 'https://cdn.example.com/a.jpg');
});

test('cardHtml renders the site card markup with picture, cover or quote style', async () => {
  const { cardHtml } = await import('../scripts/lib/seo.js');
  const base = { id: 'k', title: 'T <1>', url: 'https://ex.com/k', source: 'Src', sourceId: 'src', publishedAt: 0, kind: 'news' };
  const pic = cardHtml({ ...base, image: 'https://ex.com/p.jpg', summary: 'S' }, { imageProxy: 'https://p/?u={url}&w={w}' });
  assert.match(pic, /^<article class="card card--news" data-cover="/);
  assert.match(pic, /src="https:\/\/p\/\?u=https%3A%2F%2Fex\.com%2Fp\.jpg&amp;w=480"/);
  assert.match(pic, /<p class="card__summary">S<\/p>/);
  assert.match(pic, /T &lt;1&gt;/);
  assert.match(cardHtml(base, {}), /class="card card--news card--cover"[^]*<span class="cover cover--\d"/);
  assert.match(cardHtml({ ...base, kind: 'social' }, {}), /class="card card--social card--noimg" data-cover="">\s*<div class="card__body">/);
  assert.match(cardHtml({ ...base, internal: true, pinned: true }, { site: { name: 'GA' } }), /card__kind">Pinned<\/span><span class="card__source">GA</);
});

test('subscribeHtml renders a Buttondown form, a plain button for other services, nothing when unset', async () => {
  const { subscribeHtml } = await import('../scripts/lib/seo.js');
  const bd = subscribeHtml({ name: 'GA', newsletter: 'https://buttondown.com/gloriousanchor' });
  assert.match(bd, /action="https:\/\/buttondown\.com\/api\/emails\/embed-subscribe\/gloriousanchor" method="post"/);
  assert.match(bd, /<input type="email" name="email"/);
  const other = subscribeHtml({ name: 'GA', newsletter: 'https://example.substack.com/subscribe' });
  assert.match(other, /<a class="btn" href="https:\/\/example\.substack\.com\/subscribe"/);
  assert.doesNotMatch(other, /<form/);
  assert.equal(subscribeHtml({ name: 'GA' }), '');
});
