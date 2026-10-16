import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, stripHtml, truncate, extractImage, dedupe, mergeWithPrevious, normaliseItem, makeId, slimArticle, capOutput, audioEnclosure, parseDuration } from '../scripts/lib/articles.js';

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

test('slimArticle drops lookup fields and shortens summaries; capOutput limits per source but keeps picks and ours', () => {
  const a = slimArticle({ id: '1', title: 'T', url: 'https://x/1', summary: 'word '.repeat(60), image: null, author: null, publishedAt: 5, kind: 'news', source: 'S', sourceId: 's', sourceHome: 'https://s', category: 'news', featured: true, videoId: 'abc', pinned: true });
  assert.equal(a.sourceHome, undefined); assert.equal(a.featured, undefined); assert.equal(a.videoId, undefined); assert.equal(a.pinned, true);
  assert.ok(a.summary.length <= 161);
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ id: 'a' + i, sourceId: 'a', publishedAt: 100 - i });
  for (let i = 0; i < 5; i++) many.push({ id: 'p' + i, sourceId: 'picks', publishedAt: 1 });
  many.push({ id: 'o', sourceId: 'ours', publishedAt: 0 });
  const out = capOutput(many, 10, 12);
  assert.equal(out.filter((x) => x.sourceId === 'a').length, 6, 'overall cap leaves room after exempt items');
  assert.equal(out.filter((x) => x.sourceId === 'picks').length, 5); assert.ok(out.some((x) => x.id === 'o'));
  assert.equal(capOutput(many, 10, 1000).filter((x) => x.sourceId === 'a').length, 10);
});

test('audio episodes carry their enclosure and duration', () => {
  const src = { id: 'pod', name: 'Pod', kind: 'audio', category: 'radio' };
  const ep = normaliseItem({ title: 'Ep 1', link: 'https://ex.com/ep1', pubDate: 'Mon, 13 Oct 2026 09:00:00 +0000', enclosure: { url: 'https://cdn.ex.com/ep1.mp3?utm_source=rss', type: 'audio/mpeg' }, itunes: { duration: '24:30' } }, src);
  assert.equal(ep.kind, 'audio');
  assert.equal(ep.audio, 'https://cdn.ex.com/ep1.mp3');
  assert.equal(ep.duration, 24 * 60 + 30);
  assert.equal(slimArticle(ep).audio, ep.audio);
  assert.equal(slimArticle(ep).duration, ep.duration);
  // Non-audio sources never get a player, even with an enclosure.
  const news = normaliseItem({ title: 'N', link: 'https://ex.com/n', pubDate: 'Mon, 13 Oct 2026 09:00:00 +0000', enclosure: { url: 'https://cdn.ex.com/n.mp3', type: 'audio/mpeg' } }, { id: 'n', name: 'N', category: 'news' });
  assert.equal(news.audio, undefined);
});

test('audioEnclosure accepts audio types or audio file extensions, parseDuration handles every itunes form', () => {
  assert.equal(audioEnclosure({ enclosure: { url: 'https://ex.com/a.m4a', type: '' } }), 'https://ex.com/a.m4a');
  assert.equal(audioEnclosure({ enclosure: { url: 'https://ex.com/a.jpg', type: 'image/jpeg' } }), null);
  assert.equal(audioEnclosure({ mediaContent: [{ $: { url: 'https://ex.com/a.mp3', type: 'audio/mpeg' } }] }), 'https://ex.com/a.mp3');
  assert.equal(audioEnclosure({}), null);
  assert.equal(parseDuration('3600'), 3600);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('45:10'), 2710);
  assert.equal(parseDuration(undefined), undefined);
  assert.equal(parseDuration('n/a'), undefined);
});
