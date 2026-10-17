import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDigest, digestText, digestHtml, renderDigestFeed, renderTopFeed, renderDigestPage } from '../scripts/lib/digest.js';

const now = Date.parse('2026-10-17T08:00:00Z');
const h = (n) => now - n * 3600 * 1000;
const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com/', tagline: 'Anchored.' };
const mk = (id, extra) => ({ id, title: `Title ${id}`, url: `https://ex.com/${id}`, publishedAt: h(1), kind: 'news', source: `Source ${id}`, sourceId: `s-${id}`, summary: 'Sum', ...extra });

test('pickDigest leads with our articles and picks, caps per kind and one per source, skips stale items', () => {
  const list = [
    mk('own', { internal: true, source: 'Glorious Anchor', sourceId: 'ours', publishedAt: h(100), pinned: true }),
    mk('pick', { kind: 'pick', sourceId: 'picks', publishedAt: h(50) }),
    mk('n1'), mk('n2'), mk('n3'), mk('n4'), mk('n5'), mk('n6'),
    mk('n1b', { sourceId: 's-n1' }), // same source as n1
    mk('v1', { kind: 'video' }), mk('v2', { kind: 'video' }),
    mk('a1', { kind: 'article' }), mk('soc', { kind: 'social' }),
    mk('old', { publishedAt: h(72) }),
    mk('evergreen', { internal: true, sourceId: 'ours', pinned: true, publishedAt: h(24 * 30) }),
  ];
  const got = pickDigest(list, { count: 8, now });
  assert.deepEqual(got.slice(0, 2).map((a) => a.id), ['pick', 'own']);
  assert.equal(got.length, 8);
  assert.equal(got.filter((a) => a.kind === 'news' && !a.internal).length, 4);
  assert.equal(got.filter((a) => a.kind === 'video').length, 1);
  assert.ok(!got.some((a) => ['n1b', 'soc', 'old', 'evergreen'].includes(a.id)));
});

test('pickDigest fills up on a quiet day', () => {
  const got = pickDigest([mk('a'), mk('b', { sourceId: 's-a' }), mk('c', { sourceId: 's-a' })], { count: 3, now });
  assert.equal(got.length, 3);
});

test('digestText is WhatsApp-ready and digestHtml escapes', () => {
  const t = digestText([mk('a', { title: 'Hello <b>' })], site, '2026-10-17');
  assert.match(t, /^\*Glorious Anchor — Saturday, 17 October 2026\*/);
  assert.match(t, /• Hello <b> — Source a\nhttps:\/\/gloriousanchor\.com\/s\/a\//);
  assert.match(t, /More every day at https:\/\/gloriousanchor\.com — Anchored\./);
  const html = digestHtml([mk('a', { title: 'Hello <b>' })], site, '2026-10-17');
  assert.match(html, /Hello &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('renderDigestFeed has one item per day with a stable guid; renderTopFeed lists items with sources', () => {
  const feed = renderDigestFeed({ '2026-10-16': { html: '<p>y</p>' }, '2026-10-17': { html: '<p>t ]]> x</p>' } }, site);
  assert.equal((feed.match(/<item>/g) || []).length, 2);
  assert.ok(feed.indexOf('digest-2026-10-17') < feed.indexOf('digest-2026-10-16'), 'newest first');
  assert.match(feed, /\]\]\]\]><!\[CDATA\[>/);
  const top = renderTopFeed([mk('a', { image: 'https://i.jpg' }), mk('b')], site, 1);
  assert.equal((top.match(/<item>/g) || []).length, 1);
  assert.match(top, /<source url="https:\/\/gloriousanchor\.com\/feed\.xml">Source a<\/source>/);
  assert.match(top, /<enclosure url="https:\/\/i\.jpg"/);
});

test('renderDigestPage embeds the text for copying and a WhatsApp share link', () => {
  const page = renderDigestPage([mk('a')], site, '2026-10-17', 'TEXT & more');
  assert.match(page, /<pre id="digestText" hidden>TEXT &amp; more<\/pre>/);
  assert.match(page, /https:\/\/wa\.me\/\?text=TEXT%20%26%20more/);
  assert.match(page, /<link rel="canonical" href="https:\/\/gloriousanchor\.com\/digest\/">/);
});

test('the digest page uses theme classes while the email item keeps inline colours', () => {
  const items = [mk('a')];
  assert.match(digestHtml(items, site, '2026-10-17'), /style="font-weight:600;color:#0b1f3a/);
  const page = renderDigestPage(items, site, '2026-10-17', 'T');
  assert.match(page, /<article class="card card--news card--cover card--lead"/);
  assert.match(page, /href="https:\/\/gloriousanchor\.com\/s\/a\/"/);
  assert.doesNotMatch(page, /color:#0b1f3a/);
});

test('digest page carries the subscribe form, both copy buttons and Markdown for the editor', async () => {
  const { digestMarkdown } = await import('../scripts/lib/digest.js');
  const s = { ...site, newsletter: 'https://buttondown.com/gloriousanchor' };
  const page = renderDigestPage([mk('a')], s, '2026-10-17', 'T');
  assert.match(page, /embed-subscribe\/gloriousanchor/);
  assert.match(page, /id="copyMd"/);
  assert.match(page, /href="#subscribe">Get it by email/);
  const md = digestMarkdown([mk('a', { summary: 'Sum' })], s, '2026-10-17');
  assert.match(md, /^## Today on Glorious Anchor — Saturday, 17 October 2026/);
  assert.match(md, /\*\*\[Title a\]\(https:\/\/gloriousanchor\.com\/s\/a\/\)\*\*  \nSource a · Sum/);
});
