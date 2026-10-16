import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sitemapXml, jsonLd, homeJsonLd, articleJsonLd, churchJsonLd, prerenderCards, metaTags, churchSlug } from '../scripts/lib/seo.js';
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
