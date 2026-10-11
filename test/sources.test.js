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

import { expandEnv, serviceUrl } from '../scripts/lib/sources.js';

test('expandEnv and serviceUrl read configuration from the environment', () => {
  const env = { FEEDS_SERVER_URL: 'https://feeds.example.com', RSSHUB_ACCESS_KEY: 'k1' };
  assert.equal(expandEnv('${FEEDS_SERVER_URL}/rsshub', env), 'https://feeds.example.com/rsshub');
  assert.equal(expandEnv('${MISSING}/x', env), '/x');
  const services = { rsshub: { url: '${FEEDS_SERVER_URL}/rsshub/', key: '${RSSHUB_ACCESS_KEY}' } };
  assert.deepEqual(serviceUrl(services, 'rsshub', env), { url: 'https://feeds.example.com/rsshub', key: 'k1' });
  assert.equal(serviceUrl({ rsshub: { url: '${FEEDS_SERVER_URL}' } }, 'rsshub', {}), null, 'unset server → not configured');
});

test('staticFeedUrl builds RSSHub and RSS-Bridge URLs against the configured server', () => {
  const env = { FEEDS_SERVER_URL: 'https://feeds.example.com', RSSHUB_ACCESS_KEY: 'k1' };
  const services = { rsshub: { url: '${FEEDS_SERVER_URL}/rsshub', key: '${RSSHUB_ACCESS_KEY}' }, rssbridge: { url: '${FEEDS_SERVER_URL}/rss-bridge' } };
  assert.equal(staticFeedUrl({ type: 'rsshub', route: '/twitter/user/BibleProject' }, services, env), 'https://feeds.example.com/rsshub/twitter/user/BibleProject?key=k1');
  assert.equal(staticFeedUrl({ type: 'rssbridge', bridge: 'Facebook', params: { context: 'User', u: 'BibleProject' } }, services, env),
    'https://feeds.example.com/rss-bridge/?action=display&bridge=Facebook&format=Atom&context=User&u=BibleProject');
  assert.throws(() => staticFeedUrl({ type: 'rsshub', route: '/x' }, services, {}), /not configured/);
  assert.throws(() => staticFeedUrl({ type: 'rsshub', route: 'no-slash' }, services, env), /route/);
  assert.equal(homepageFor({ type: 'rsshub', route: '/x', profile: 'https://x.com/a' }), 'https://x.com/a');
});
