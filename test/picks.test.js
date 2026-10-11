import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerFor, strategyFor, oembedUrl, parseOpenGraph, parseOembed, unfurl, pickToArticle, needsManualFields } from '../scripts/lib/picks.js';

test('providerFor and strategyFor recognise the big platforms', () => {
  assert.equal(providerFor('https://x.com/a/status/1'), 'X');
  assert.equal(providerFor('https://twitter.com/a/status/1'), 'X');
  assert.equal(providerFor('https://www.instagram.com/p/abc/'), 'Instagram');
  assert.equal(providerFor('https://m.facebook.com/x/posts/1'), 'Facebook');
  assert.equal(providerFor('https://www.tiktok.com/@a/video/1'), 'TikTok');
  assert.equal(providerFor('https://youtu.be/abc'), 'YouTube');
  assert.equal(providerFor('https://www.challies.com/articles/x'), 'challies.com');
  assert.equal(strategyFor('https://x.com/a/status/1'), 'twitter');
  assert.equal(strategyFor('https://www.challies.com/x'), 'html');
  assert.ok(oembedUrl('https://www.tiktok.com/@a/video/1').startsWith('https://www.tiktok.com/oembed?url='));
  assert.equal(oembedUrl('https://example.com/a'), null);
  assert.equal(needsManualFields('https://www.instagram.com/p/abc/'), true);
  assert.equal(needsManualFields('https://example.com/'), false);
});

test('parseOpenGraph reads og tags, resolves relative images and falls back to <title>', () => {
  const html = `<html><head><title>Fallback | Site</title>
    <meta property="og:title" content="Real &amp; Title"><meta name="description" content="Desc here">
    <meta property="og:image" content="/img/a.jpg"><meta property="og:site_name" content="Site">
    <meta property="article:published_time" content="2026-10-08T14:00:00Z"></head></html>`;
  const og = parseOpenGraph(html, 'https://site.org/post');
  assert.equal(og.title, 'Real & Title');
  assert.equal(og.description, 'Desc here');
  assert.equal(og.image, 'https://site.org/img/a.jpg');
  assert.equal(og.siteName, 'Site');
  assert.equal(og.publishedAt, '2026-10-08T14:00:00Z');
  assert.equal(parseOpenGraph('<title>Only title</title>', 'https://a.b').title, 'Only title');
  assert.deepEqual(parseOpenGraph('', 'https://a.b'), {});
});

test('parseOembed extracts tweet text and date, and generic titles', () => {
  const tw = parseOembed('{"author_name":"BP","html":"<blockquote><p lang=\\"en\\">Hello &amp; welcome <a href=\\"x\\">link</a></p>&mdash; BP (@bp) <a href=\\"y\\">October 9, 2026</a></blockquote>"}', 'twitter');
  assert.equal(tw.title, 'Hello & welcome link');
  assert.equal(tw.author, 'BP');
  assert.equal(tw.publishedAt, 'October 9, 2026');
  const tt = parseOembed({ title: 'A video', author_name: 'Someone', thumbnail_url: 'https://i/x.jpg' }, 'tiktok');
  assert.equal(tt.title, 'A video');
  assert.equal(tt.image, 'https://i/x.jpg');
  assert.deepEqual(parseOembed('not json', 'tiktok'), {});
});

test('unfurl uses oEmbed when available and falls back to HTML', async () => {
  const calls = [];
  const fetchText = async (u) => { calls.push(u); if (u.includes('oembed')) return '{"title":"From oEmbed","author_name":"A"}'; return '<meta property="og:title" content="From HTML">'; };
  const a = await unfurl('https://www.tiktok.com/@a/video/1', fetchText);
  assert.equal(a.title, 'From oEmbed');
  assert.equal(calls.length, 1);
  const b = await unfurl('https://example.com/post', fetchText);
  assert.equal(b.title, 'From HTML');
  const failing = async (u) => { if (u.includes('oembed')) throw new Error('HTTP 404'); return '<meta property="og:title" content="HTML after oEmbed failure">'; };
  const c = await unfurl('https://x.com/a/status/1', failing);
  assert.equal(c.title, 'HTML after oEmbed failure');
});

test('pickToArticle merges manual overrides over fetched data and handles dates', () => {
  const fetched = { title: 'Fetched', description: 'Fetched desc', image: 'https://i/f.jpg', author: 'F', siteName: 'Site', publishedAt: '2026-10-08T14:00:00Z' };
  const a = pickToArticle({ url: 'https://site.org/p?utm_source=x', note: 'Read it', pinned: true }, fetched, 1000);
  assert.equal(a.url, 'https://site.org/p');
  assert.equal(a.title, 'Fetched');
  assert.equal(a.summary, 'Fetched desc');
  assert.equal(a.note, 'Read it');
  assert.equal(a.pinned, true);
  assert.equal(a.kind, 'pick');
  assert.equal(a.sourceId, 'picks');
  assert.equal(a.source, 'Site');
  assert.equal(a.publishedAt, Date.parse('2026-10-08T14:00:00Z'));
  const b = pickToArticle({ url: 'https://www.instagram.com/p/abc/', title: 'Manual', image: 'https://i/m.jpg', added: '2026-10-10' }, {}, 1000);
  assert.equal(b.title, 'Manual'); assert.equal(b.image, 'https://i/m.jpg'); assert.equal(b.source, 'Instagram');
  assert.equal(b.publishedAt, Date.parse('2026-10-10'));
  const c = pickToArticle({ url: 'https://x.com/a/status/1' }, { title: 'T' }, 1234);
  assert.equal(c.publishedAt, 1234, 'falls back to first-seen time');
  assert.equal(pickToArticle({ url: 'https://www.facebook.com/x/posts/1' }, {}, 1), null, 'no title → no card');
});
