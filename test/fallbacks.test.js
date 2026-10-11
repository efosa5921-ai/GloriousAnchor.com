import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, fetchWithFallbacks } from '../scripts/lib/fallbacks.js';

const src = { id: 'x-bp', name: 'BP on X', category: 'social', kind: 'social', type: 'rsshub', route: '/twitter/user/BP',
  fallbacks: [{ type: 'rssbridge', bridge: 'Twitter', params: { u: 'BP' } }, { url: 'https://rss.app/feeds/1.xml' }] };

test('candidatesFor keeps identity fields and swaps fetch settings per fallback', () => {
  const c = candidatesFor(src);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], { id: 'x-bp', name: 'BP on X', category: 'social', kind: 'social', type: 'rsshub', route: '/twitter/user/BP' });
  assert.equal(c[1].type, 'rssbridge'); assert.equal(c[1].bridge, 'Twitter'); assert.equal(c[1].route, undefined); assert.equal(c[1].id, 'x-bp');
  assert.equal(c[2].type, 'rss'); assert.equal(c[2].url, 'https://rss.app/feeds/1.xml'); assert.equal(c[2].bridge, undefined);
  assert.equal(candidatesFor({ id: 'a', url: 'https://a/feed' }).length, 1);
});

test('fetchWithFallbacks tries candidates in order and reports which one worked', async () => {
  const tried = [];
  const r = await fetchWithFallbacks(src, async (c, i) => { tried.push(i); if (i < 2) throw new Error(`fail ${i}`); return { items: [1] }; });
  assert.deepEqual(tried, [0, 1, 2]);
  assert.equal(r.via, 2);
  assert.deepEqual(r.warnings, ['primary: fail 0', 'fallback 1: fail 1']);
  const ok = await fetchWithFallbacks(src, async () => ({ items: [] }));
  assert.equal(ok.via, 0); assert.deepEqual(ok.warnings, []);
  const bad = await fetchWithFallbacks(src, async (c, i) => { throw new Error(`boom ${i}`); });
  assert.equal(bad.error, 'primary: boom 0 | fallback 1: boom 1 | fallback 2: boom 2');
});
