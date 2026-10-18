import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareUrl, renderSharePage, relatedStories } from '../scripts/lib/share.js';

const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com/', imageProxy: 'https://wsrv.nl/?url={url}&w={w}', tagline: 'Tag', verse: 'V' };
const mk = (id, extra) => ({ id, title: `Title ${id}`, url: `https://ex.com/${id}`, publishedAt: Date.parse('2026-10-17T08:00:00Z'), kind: 'news', source: `Source ${id}`, sourceId: `s-${id}`, category: 'news', ...extra });

test('shareUrl wraps external stories and leaves our own pages alone', () => {
  assert.equal(shareUrl({ id: 'ab c', url: 'https://ex.com/x' }, site), 'https://gloriousanchor.com/s/ab%20c/');
  assert.equal(shareUrl({ id: 'o', url: 'https://gloriousanchor.com/articles/o/', internal: true }, site), 'https://gloriousanchor.com/articles/o/');
});

test('relatedStories picks same-section stories, newest first, pictures preferred, never itself', () => {
  const me = mk('me', { categories: ['news', 'culture'] });
  const list = [me, mk('a', { image: 'i' }), mk('b', { category: 'culture', image: 'i', publishedAt: Date.parse('2026-10-17T09:00:00Z') }), mk('c', { category: 'video' }), mk('d')];
  assert.deepEqual(relatedStories(me, list, 2).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(relatedStories(me, list, 6).map((x) => x.id).sort(), ['a', 'b', 'd']);
});

test('renderSharePage shows the story, the brand, the read button and related stories, hidden from search', () => {
  const a = { id: 'x1', title: 'Hope & "joy"', url: 'https://ex.com/a?b=1', source: 'Example', summary: 'Sum', image: 'https://ex.com/i.jpg', kind: 'video', publishedAt: Date.parse('2026-10-17T08:00:00Z'), category: 'video' };
  const html = renderSharePage(a, site, [mk('r1', { image: 'https://ex.com/r.jpg' })], 'YouTube');
  assert.match(html, /<meta property="og:title" content="Hope &amp; &quot;joy&quot;">/);
  assert.match(html, /<meta property="og:site_name" content="Glorious Anchor">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/wsrv\.nl\/\?url=https%3A%2F%2Fex\.com%2Fi\.jpg&amp;w=1200">/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ex\.com\/a\?b=1">/);
  assert.doesNotMatch(html, /http-equiv="refresh"|location\.replace/);
  assert.match(html, /class="btn story__cta" href="https:\/\/ex\.com\/a\?b=1" rel="noopener">Watch at Example →<\/a>/);
  assert.match(html, /<h2>More in YouTube<\/h2>/);
  assert.match(html, /href="https:\/\/gloriousanchor\.com\/s\/r1\/"[^>]*>Title r1<\/a>/);
  assert.match(html, /href="\.\.\/\.\.\/\?c=video"/);
  const pod = renderSharePage({ ...a, kind: 'audio', audio: 'https://ex.com/ep.mp3', image: null }, site, [], '');
  assert.match(pod, /<audio class="story__audio" controls preload="none" src="https:\/\/ex\.com\/ep\.mp3">/);
  assert.match(pod, /og:image" content="https:\/\/gloriousanchor\.com\/assets\/social\.jpg"/);
  assert.doesNotMatch(pod, /story__more/);
});

test('story page pictures fall back to the original, then hide, when the proxy fails', () => {
  const a = { id: 'f1', title: 'T', url: 'https://ex.com/t', source: 'S', image: 'https://ex.com/p.jpg', kind: 'news', publishedAt: 0, category: 'news' };
  const html = renderSharePage(a, site, [{ ...a, id: 'f2' }], 'News');
  const imgs = html.match(/<img[^>]+>/g);
  assert.equal(imgs.length, 2);
  for (const img of imgs) { assert.match(img, /data-alt="https:\/\/ex\.com\/p\.jpg"/); assert.match(img, /onerror="/); }
  assert.match(imgs[1], /card--noimg/);
});

test('cards without a picture get a branded cover; social posts keep the quote style', () => {
  const a = { id: 'c1', title: 'T', url: 'https://ex.com/t', source: 'Religion News Service', sourceId: 'rns', kind: 'news', publishedAt: 0, category: 'news' };
  const html = renderSharePage(a, site, [{ ...a, id: 'c2' }, { ...a, id: 'c3', kind: 'social', source: 'r/x' }], 'News');
  assert.match(html, /<article class="card card--news card--cover" data-cover="[^"]*">\s*<a class="card__media" href="https:\/\/gloriousanchor\.com\/s\/c2\/"><span class="cover cover--\d" aria-hidden="true"><svg[^]*?<b>Religion News Service<\/b><\/span><\/a>/);
  assert.match(html, /<article class="card card--social card--noimg" data-cover="">\s*<div class="card__body">/);
});

test('previewImage is a JPEG from the proxy, or the site card when there is no picture', async () => {
  const { previewImage } = await import('../scripts/lib/share.js');
  const s = { url: 'https://gloriousanchor.com', imageProxy: 'https://wsrv.nl/?url={url}&w={w}&output=webp&q=75' };
  assert.equal(previewImage({ image: 'https://ex.com/p.jpg' }, s), 'https://wsrv.nl/?url=https%3A%2F%2Fex.com%2Fp.jpg&w=1200&output=jpg&q=75');
  assert.equal(previewImage({}, s), 'https://gloriousanchor.com/assets/social.jpg');
});
