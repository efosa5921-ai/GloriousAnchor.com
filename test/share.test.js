import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareUrl, renderSharePage } from '../scripts/lib/share.js';

const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com/', imageProxy: 'https://wsrv.nl/?url={url}&w={w}' };

test('shareUrl wraps external stories and leaves our own pages alone', () => {
  assert.equal(shareUrl({ id: 'ab c', url: 'https://ex.com/x' }, site), 'https://gloriousanchor.com/s/ab%20c/');
  assert.equal(shareUrl({ id: 'o', url: 'https://gloriousanchor.com/articles/o/', internal: true }, site), 'https://gloriousanchor.com/articles/o/');
});

test('renderSharePage carries the story preview, the brand, and forwards to the article', () => {
  const html = renderSharePage({ id: 'x1', title: 'Hope & "joy"', url: 'https://ex.com/a?b=1', source: 'Example', summary: 'Sum', image: 'https://ex.com/i.jpg', kind: 'video' }, site);
  assert.match(html, /<meta property="og:title" content="Hope &amp; &quot;joy&quot;">/);
  assert.match(html, /<meta property="og:site_name" content="Glorious Anchor">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/wsrv\.nl\/\?url=https%3A%2F%2Fex\.com%2Fi\.jpg&amp;w=1200">/);
  assert.match(html, /<meta http-equiv="refresh" content="0; url=https:\/\/ex\.com\/a\?b=1">/);
  assert.match(html, /location\.replace\("https:\/\/ex\.com\/a\?b=1"\)/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ex\.com\/a\?b=1">/);
  assert.match(html, /Watch at Example/);
  const noImg = renderSharePage({ id: 'x2', title: 'T', url: 'https://ex.com/b', source: 'S', kind: 'news' }, site);
  assert.match(noImg, /og:image" content="https:\/\/gloriousanchor\.com\/assets\/social\.jpg"/);
  assert.match(noImg, /Read at S/);
});
