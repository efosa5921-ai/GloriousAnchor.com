import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, stripHtml, truncate, extractImage, dedupe, mergeWithPrevious, normaliseItem, makeId } from '../scripts/lib/articles.js';

test('cleanUrl strips tracking params and hash, rejects non-http', () => {
  assert.equal(cleanUrl('https://ex.com/a?utm_source=x&id=1#frag'), 'https://ex.com/a?id=1');
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl('not a url'), null);
  assert.equal(cleanUrl(null), null);
});

test('stripHtml removes tags and decodes entities', () => {
  assert.equal(stripHtml('<p>It&#8217;s <b>bold</b> &amp; &quot;quoted&quot;</p>'), 'It’s bold & "quoted"');
  assert.equal(stripHtml('<script>x()</script>hi'), 'hi');
});

test('truncate cuts at word boundary with ellipsis', () => {
  const s = 'word '.repeat(100).trim();
  const t = truncate(s, 50);
  assert.ok(t.length <= 51);
  assert.ok(t.endsWith('…'));
  assert.equal(truncate('short', 50), 'short');
});

test('extractImage prefers largest media:thumbnail, falls back to enclosure/html', () => {
  assert.equal(extractImage({ mediaThumbnail: [{ $: { url: 'https://i/240.jpg', width: '240' } }, { $: { url: 'https://i/1024.jpg', width: '1024' } }] }), 'https://i/1024.jpg');
  assert.equal(extractImage({ enclosure: { url: 'https://i/e.jpg', type: 'image/jpeg' } }), 'https://i/e.jpg');
  assert.equal(extractImage({ enclosure: { url: 'https://i/e.mp3', type: 'audio/mpeg' } }), null);
  assert.equal(extractImage({ content: '<img src="https://i/c.png">' }), 'https://i/c.png');
  assert.equal(extractImage({ content: '<img src="https://i/pixel.gif">' }), null);
  assert.equal(extractImage({}), null);
});

test('normaliseItem builds a complete article and skips invalid items', () => {
  const src = { id: 'x', name: 'X News', category: 'world', homepage: 'https://x.news' };
  const a = normaliseItem({ title: 'Hello <i>World</i>', link: 'https://x.news/1?fbclid=abc', pubDate: 'Sat, 10 Oct 2026 12:00:00 GMT', contentSnippet: 'Hello World' }, src, {});
  assert.equal(a.title, 'Hello World');
  assert.equal(a.url, 'https://x.news/1');
  assert.equal(a.summary, '', 'summary identical to title is dropped');
  assert.equal(a.category, 'world');
  assert.equal(a.publishedAt, Date.parse('2026-10-10T12:00:00Z'));
  assert.equal(a.id, makeId('https://x.news/1', 'Hello World'));
  assert.equal(normaliseItem({ title: 'No link' }, src, {}), null);
  assert.equal(normaliseItem({ link: 'https://x.news/2' }, src, {}), null);
});

test('dedupe collapses same URL (ignoring www/trailing slash) and same title per source, keeping newest', () => {
  const list = [
    { id: '1', url: 'https://www.ex.com/a/', title: 'A story', sourceId: 's', publishedAt: 100 },
    { id: '2', url: 'https://ex.com/a', title: 'A story', sourceId: 's', publishedAt: 200 },
    { id: '3', url: 'https://ex.com/b', title: 'A Story!', sourceId: 's', publishedAt: 150 },
    { id: '4', url: 'https://ex.com/c', title: 'A story', sourceId: 'other', publishedAt: 120 },
  ];
  const out = dedupe(list).map((a) => a.id);
  assert.deepEqual(out, ['2', '4']);
});

test('mergeWithPrevious keeps previous items for failed sources, drops stale and removed-source items', () => {
  const cutoff = 1000;
  const fresh = [{ id: 'f1', sourceId: 'a', publishedAt: 2000 }];
  const previous = [
    { id: 'p1', sourceId: 'b', publishedAt: 1500 }, // failed source, recent -> keep
    { id: 'p2', sourceId: 'b', publishedAt: 500 },  // stale -> drop
    { id: 'p3', sourceId: 'zzz', publishedAt: 1500 }, // removed source -> drop
    { id: 'f1', sourceId: 'a', publishedAt: 1900 }, // already fresh -> drop
    { id: 'p4', sourceId: 'a', publishedAt: 1800 }, // succeeded source, scrolled off feed -> keep
  ];
  const status = [{ id: 'a', ok: true }, { id: 'b', ok: false }];
  const out = mergeWithPrevious(fresh, previous, status, cutoff).map((a) => a.id).sort();
  assert.deepEqual(out, ['f1', 'p1', 'p4']);
});

test('social posts without a title use the post text as the title', () => {
  const src = { id: 'bsky', name: 'CT', category: 'social', kind: 'social' };
  const a = normaliseItem({ link: 'https://bsky.app/profile/x/post/1', description: 'Short post text here.', pubDate: 'Sat, 10 Oct 2026 12:00:00 GMT' }, src, {});
  assert.equal(a.title, 'Short post text here.');
  assert.equal(a.summary, '', 'title already is the post');
  assert.equal(a.kind, 'social');
});

test('YouTube entries get a video id, media description summary and derived thumbnail', () => {
  const src = { id: 'yt', name: 'BP', category: 'video', kind: 'video' };
  const item = { title: 'A video', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'yt:video:dQw4w9WgXcQ', isoDate: '2026-10-10T12:00:00Z',
    mediaGroup: { 'media:description': ['Line one.\n\nLine two.'] } };
  const a = normaliseItem(item, src, {});
  assert.equal(a.videoId, 'dQw4w9WgXcQ');
  assert.equal(a.summary, 'Line one. Line two.');
  assert.equal(a.image, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  const withThumb = normaliseItem({ ...item, mediaGroup: { 'media:thumbnail': [{ $: { url: 'https://i2.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: '480' } }] } }, src, {});
  assert.equal(withThumb.image, 'https://i2.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

test('reddit "submitted by" boilerplate is stripped from summaries', () => {
  const src = { id: 'r', name: 'r/x', category: 'social', kind: 'social' };
  const a = normaliseItem({ title: 'A post', link: 'https://www.reddit.com/r/x/comments/1/a/', content: '<p>Body text.</p> submitted by /u/someone [link] [comments]' }, src, {});
  assert.equal(a.summary, 'Body text.');
});

test('a source can belong to several categories; the first is primary', () => {
  const src = { id: 'yt', name: 'Y', category: 'video', categories: ['video', 'apologetics'], kind: 'video' };
  const a = normaliseItem({ title: 'T', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', isoDate: '2026-10-10T12:00:00Z' }, src, {});
  assert.equal(a.category, 'video'); assert.deepEqual(a.categories, ['video', 'apologetics']);
  const b = normaliseItem({ title: 'T', link: 'https://x/1', isoDate: '2026-10-10T12:00:00Z' }, { id: 'x', name: 'X', category: 'news', kind: 'news' }, {});
  assert.equal(b.categories, undefined);
});
