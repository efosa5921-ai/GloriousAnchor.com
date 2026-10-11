import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDiscoveryUrl, instagramToItems, fetchInstagramItems } from '../scripts/lib/instagram.js';
import { normaliseItem } from '../scripts/lib/articles.js';

const sample = {
  business_discovery: {
    username: 'bibleproject', name: 'BibleProject',
    media: { data: [
      { id: '1', caption: 'Hesed: loyal love.\n\nNew video on the book of Ruth. #bible', media_type: 'IMAGE', media_url: 'https://scontent.cdninstagram.com/a.jpg', permalink: 'https://www.instagram.com/p/AAA/', timestamp: '2026-10-10T15:00:00+0000', username: 'bibleproject' },
      { id: '2', caption: '', media_type: 'VIDEO', media_url: 'https://v.cdninstagram.com/b.mp4', thumbnail_url: 'https://scontent.cdninstagram.com/b.jpg', permalink: 'https://www.instagram.com/reel/BBB/', timestamp: '2026-10-09T15:00:00+0000', username: 'bibleproject' },
      { id: '3', media_type: 'IMAGE', timestamp: '2026-10-08T15:00:00+0000' },
    ] },
  },
};

test('businessDiscoveryUrl builds the Graph API request and rejects bad usernames', () => {
  const u = businessDiscoveryUrl('@BibleProject', '1784', 'tok', 10);
  assert.ok(u.startsWith('https://graph.facebook.com/v21.0/1784?fields='));
  assert.ok(decodeURIComponent(u).includes('business_discovery.username(BibleProject){username,name,profile_picture_url,media.limit(10){'));
  assert.ok(u.endsWith('&access_token=tok'));
  assert.throws(() => businessDiscoveryUrl('not a user', '1', 't'), /invalid username/);
});

test('instagramToItems maps posts and reels to feed items normaliseItem understands', () => {
  const feed = instagramToItems(sample);
  assert.equal(feed.title, 'BibleProject');
  assert.equal(feed.items.length, 2, 'item without permalink dropped');
  const [post, reel] = feed.items;
  assert.equal(post.title, 'Hesed: loyal love.');
  assert.equal(reel.title, 'Reel');
  const src = { id: 'ig', name: 'BibleProject on Instagram', category: 'social', kind: 'social' };
  const a = normaliseItem(post, src, feed);
  assert.equal(a.url, 'https://www.instagram.com/p/AAA/');
  assert.equal(a.image, 'https://scontent.cdninstagram.com/a.jpg');
  assert.equal(a.author, '@bibleproject');
  assert.equal(a.publishedAt, Date.parse('2026-10-10T15:00:00+0000'));
  assert.equal(a.summary, 'Hesed: loyal love. New video on the book of Ruth. #bible');
  const r = normaliseItem(reel, src, feed);
  assert.equal(r.image, 'https://scontent.cdninstagram.com/b.jpg', 'reel uses its thumbnail');
});

test('instagramToItems surfaces API errors clearly', () => {
  assert.throws(() => instagramToItems({ error: { message: 'Invalid OAuth access token', code: 190 } }), /Invalid OAuth access token \(code 190\)/);
  assert.throws(() => instagramToItems({}), /business_discovery/);
});

test('fetchInstagramItems requires configuration and a username', async () => {
  await assert.rejects(fetchInstagramItems({ id: 'x', username: 'a' }, async () => '{}', {}), /not configured/);
  await assert.rejects(fetchInstagramItems({ id: 'x' }, async () => '{}', { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' }), /needs a "username"/);
  const feed = await fetchInstagramItems({ id: 'x', username: 'bibleproject' }, async (u) => { assert.ok(u.includes('access_token=t')); return JSON.stringify(sample); }, { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' });
  assert.equal(feed.items.length, 2);
});
