import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadsPlaylistId, youtubeApiUrl, apiToFeed } from '../scripts/lib/youtube.js';
import { extractImage, youtubeVideoId } from '../scripts/lib/articles.js';

test('uploads playlist id and API url', () => {
  assert.equal(uploadsPlaylistId('UC3X8sYjKJuDefK1kiY9H4LA'), 'UU3X8sYjKJuDefK1kiY9H4LA');
  assert.equal(uploadsPlaylistId('nonsense'), null);
  const u = new URL(youtubeApiUrl('UC3X8sYjKJuDefK1kiY9H4LA', 'KEY', 15));
  assert.equal(u.searchParams.get('playlistId'), 'UU3X8sYjKJuDefK1kiY9H4LA');
  assert.equal(u.searchParams.get('key'), 'KEY'); assert.equal(u.searchParams.get('maxResults'), '15');
  assert.equal(youtubeApiUrl('UC3X8sYjKJuDefK1kiY9H4LA', ''), null);
});

test('apiToFeed looks like a parsed YouTube RSS feed', () => {
  const json = { items: [
    { snippet: { title: 'A video', description: 'About it', publishedAt: '2026-10-18T10:00:00Z', videoOwnerChannelTitle: 'Prophecy Watchers', resourceId: { videoId: 'abcdefghijk' },
      thumbnails: { default: { url: 'https://i.ytimg.com/vi/abcdefghijk/default.jpg', width: 120, height: 90 }, high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', width: 480, height: 360 } } } },
    { snippet: { title: 'Private video', resourceId: { videoId: 'zzzzzzzzzzz' } } },
  ] };
  const feed = apiToFeed(json, 'UC3X8sYjKJuDefK1kiY9H4LA');
  assert.equal(feed.title, 'Prophecy Watchers'); assert.equal(feed.items.length, 1);
  const it = feed.items[0];
  assert.equal(it.link, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(youtubeVideoId(it), 'abcdefghijk');
  assert.equal(extractImage(it), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  assert.deepEqual(it.mediaGroup['media:description'], ['About it']);
});
