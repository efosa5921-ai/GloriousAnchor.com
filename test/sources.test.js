import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticFeedUrl, resolveFeedUrl, channelIdFromHtml, homepageFor, YT_FEED } from '../scripts/lib/sources.js';

test('staticFeedUrl builds URLs for each source type', () => {
  assert.equal(staticFeedUrl({ url: 'https://ex.com/feed' }), 'https://ex.com/feed');
  assert.equal(staticFeedUrl({ type: 'youtube', channelId: 'UCVfwlh9XpX2Y_tQfjeln9QA' }), YT_FEED + 'UCVfwlh9XpX2Y_tQfjeln9QA');
  assert.equal(staticFeedUrl({ type: 'youtube', handle: '@x' }), null, 'handles need resolving');
  assert.equal(staticFeedUrl({ type: 'reddit', subreddit: 'Christianity' }), 'https://www.reddit.com/r/Christianity/hot/.rss');
  assert.equal(staticFeedUrl({ type: 'bluesky', handle: '@ct.bsky.social' }), 'https://bsky.app/profile/ct.bsky.social/rss');
  assert.equal(staticFeedUrl({ type: 'mastodon', instance: 'mastodon.social', user: 'someone' }), 'https://mastodon.social/@someone.rss');
  assert.equal(staticFeedUrl({ type: 'tiktok' }), null);
});

test('channelIdFromHtml finds the id in several page shapes', () => {
  assert.equal(channelIdFromHtml('..."channelId":"UCVfwlh9XpX2Y_tQfjeln9QA",...'), 'UCVfwlh9XpX2Y_tQfjeln9QA');
  assert.equal(channelIdFromHtml('<link rel="canonical" href="https://www.youtube.com/channel/UCVfwlh9XpX2Y_tQfjeln9QA">'), 'UCVfwlh9XpX2Y_tQfjeln9QA');
  assert.equal(channelIdFromHtml('<html>nothing</html>'), null);
});

test('resolveFeedUrl resolves YouTube handles once and caches them', async () => {
  const cache = {};
  let calls = 0;
  const fetchText = async (url) => { calls++; assert.equal(url, 'https://www.youtube.com/@bibleproject'); return '"externalId":"UCVfwlh9XpX2Y_tQfjeln9QA"'; };
  const src = { id: 'yt', type: 'youtube', handle: '@bibleproject' };
  assert.equal(await resolveFeedUrl(src, cache, fetchText), YT_FEED + 'UCVfwlh9XpX2Y_tQfjeln9QA');
  assert.equal(await resolveFeedUrl(src, cache, fetchText), YT_FEED + 'UCVfwlh9XpX2Y_tQfjeln9QA');
  assert.equal(calls, 1);
  assert.equal(cache['youtube:@bibleproject'], 'UCVfwlh9XpX2Y_tQfjeln9QA');
  await assert.rejects(resolveFeedUrl({ id: 'bad', type: 'youtube', handle: '@nope' }, {}, async () => '<html/>'), /could not resolve/);
});

test('homepageFor derives a sensible link per type', () => {
  assert.equal(homepageFor({ type: 'youtube', handle: '@bibleproject' }), 'https://www.youtube.com/@bibleproject');
  assert.equal(homepageFor({ type: 'reddit', subreddit: 'Reformed' }), 'https://www.reddit.com/r/Reformed/');
  assert.equal(homepageFor({ url: 'https://www.challies.com/feed/' }), 'https://www.challies.com');
  assert.equal(homepageFor({ homepage: 'https://x.y', url: 'https://z' }), 'https://x.y');
});
