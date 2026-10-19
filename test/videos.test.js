import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropGoneVideos, needsCheck, OEMBED } from '../scripts/lib/videos.js';

const now = Date.parse('2026-10-19T08:00:00Z');
const H = 3600 * 1000;
const vid = (id, extra = {}) => ({ id: `a-${id}`, kind: 'video', videoId: id, publishedAt: now - 12 * H, title: id, ...extra });

test('private and deleted videos are dropped, others kept, results cached', async () => {
  const statuses = { v1: 200, v2: 401, v3: 404, v4: 403 };
  const calls = [];
  const fetchStatus = async (url, method) => {
    if (method === 'HEAD') { calls.push('thumb'); return url.includes('/v4/') ? 404 : 200; }
    const id = decodeURIComponent(url).match(/v=([\w-]+)/)[1]; calls.push(id); return statuses[id];
  };
  const cache = {};
  const list = [vid('v1', { image: 'https://i.ytimg.com/vi/v1/hqdefault.jpg' }), vid('v2'), vid('v3'), vid('v4', { image: 'https://i.ytimg.com/vi/v4/hqdefault.jpg' }), { id: 'n1', kind: 'news', title: 'news' }];
  const r = await dropGoneVideos(list, cache, { fetchStatus, now });
  assert.deepEqual(r.kept.map((a) => a.id), ['a-v1', 'a-v4', 'n1']);
  // v1 keeps its real thumbnail; v4's grey placeholder (404) is removed so the cover tile shows.
  assert.equal(r.kept[0].image, 'https://i.ytimg.com/vi/v1/hqdefault.jpg');
  assert.equal(r.kept[1].image, null); assert.equal(r.placeholders, 1);
  assert.equal(calls.filter((c) => c === 'thumb').length, 2);
  assert.deepEqual(r.dropped.map((a) => a.videoId), ['v2', 'v3']);
  assert.equal(r.checked, 4);
  assert.equal(cache.v2.ok, false); assert.equal(cache.v4.ok, true);
  // Second run within 12 hours: nothing re-fetched, gone ones still dropped.
  calls.length = 0;
  const r2 = await dropGoneVideos(list, cache, { fetchStatus, now: now + H });
  assert.equal(calls.length, 0); assert.equal(r2.dropped.length, 2);
});

test('needsCheck re-checks fresh videos every 12 hours and old ones rarely', () => {
  const fresh = vid('f'); const old = vid('o', { publishedAt: now - 10 * 24 * H });
  assert.equal(needsCheck(undefined, fresh, now), true);
  assert.equal(needsCheck({ ok: true, at: now - 13 * H }, fresh, now), true);
  assert.equal(needsCheck({ ok: true, at: now - 11 * H }, fresh, now), false);
  assert.equal(needsCheck({ ok: true, at: now - 13 * H }, old, now), false);
  assert.equal(needsCheck({ ok: false, at: now - 2 * 24 * H }, fresh, now), false);
  assert.equal(needsCheck({ ok: false, at: now - 15 * 24 * H }, fresh, now), true);
});

test('network failures keep the video and leave it unchecked', async () => {
  const cache = {};
  const r = await dropGoneVideos([vid('x')], cache, { fetchStatus: async () => { throw new Error('offline'); }, now });
  assert.equal(r.kept.length, 1); assert.equal(cache.x, undefined);
  assert.match(OEMBED('abc'), /youtube\.com\/oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Dabc/);
});
