import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillMissingImages, looksLikeLogo, wantsImage, OG_TTL_MS } from '../scripts/lib/images.js';

const page = (img) => `<html><head><meta property="og:image" content="${img}"><title>t</title></head><body></body></html>`;
const now = 1_000_000_000_000;

test('wantsImage and looksLikeLogo', () => {
  assert.equal(wantsImage({ url: 'https://ex.com/a', kind: 'news' }), true);
  assert.equal(wantsImage({ url: 'https://ex.com/a', kind: 'news', image: 'x' }), false);
  assert.equal(wantsImage({ url: 'https://ex.com/a', kind: 'social' }), false);
  assert.equal(wantsImage({ url: 'https://ex.com/a', kind: 'article', internal: true }), false);
  assert.equal(looksLikeLogo('https://ex.com/wp-content/uploads/rns-logo.png'), true);
  assert.equal(looksLikeLogo('https://ex.com/favicon.ico'), true);
  assert.equal(looksLikeLogo('https://ex.com/2026/10/pope-leo.jpg'), false);
});

test('fillMissingImages fetches once, caches hits and misses, skips logos and respects the budget', async () => {
  const calls = [];
  const fetchText = async (url) => { calls.push(url); if (url.endsWith('/logo')) return page('https://ex.com/logo.png'); if (url.endsWith('/fail')) throw new Error('HTTP 403'); return page(`https://ex.com/img/${url.split('/').pop()}.jpg`); };
  const arts = [
    { url: 'https://ex.com/a', kind: 'news' }, { url: 'https://ex.com/logo', kind: 'news' }, { url: 'https://ex.com/fail', kind: 'news' },
    { url: 'https://ex.com/has', kind: 'news', image: 'keep' }, { url: 'https://ex.com/post', kind: 'social' },
  ];
  const cache = {};
  const r1 = await fillMissingImages(arts, cache, { fetchText, now });
  assert.deepEqual(r1, { fetched: 3, filled: 1 });
  // A body-scraped picture is upgraded to the page's og:image when one exists, and kept when the page has none.
  const scraped = [{ url: 'https://ex.com/up', kind: 'news', image: 'https://ex.com/maybe-ad.jpg', imageFromBody: true }, { url: 'https://ex.com/logo', kind: 'news', image: 'https://ex.com/body.jpg', imageFromBody: true }];
  await fillMissingImages(scraped, {}, { fetchText: async (u) => (u.endsWith('/logo') ? page('https://ex.com/logo.png') : page('https://ex.com/img/up.jpg')), now });
  assert.equal(scraped[0].image, 'https://ex.com/img/up.jpg'); assert.equal(scraped[0].imageFromBody, undefined);
  assert.equal(scraped[1].image, 'https://ex.com/body.jpg');
  assert.equal(arts[0].image, 'https://ex.com/img/a.jpg');
  assert.equal(arts[1].image, undefined);
  assert.equal(cache['https://ex.com/logo'].image, null);
  assert.equal(cache['https://ex.com/fail'].image, null);
  assert.equal(arts[3].image, 'keep');
  // Second run inside the TTL: nothing fetched, image restored from cache.
  const again = [{ url: 'https://ex.com/a', kind: 'news' }, { url: 'https://ex.com/fail', kind: 'news' }];
  const r2 = await fillMissingImages(again, cache, { fetchText, now: now + 1000 });
  assert.deepEqual(r2, { fetched: 0, filled: 1 });
  assert.equal(calls.length, 3);
  // After the TTL the page is asked again; the budget caps fetches per build.
  const many = Array.from({ length: 5 }, (_, i) => ({ url: `https://ex.com/n${i}`, kind: 'news' }));
  const r3 = await fillMissingImages(many, cache, { fetchText, now: now + OG_TTL_MS + 1, maxFetches: 2 });
  assert.equal(r3.fetched, 2);
});
