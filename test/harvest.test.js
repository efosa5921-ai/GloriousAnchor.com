import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyComment, tallyComments, updateHarvest, renderHarvestPage, harvestWidgetHtml, emptyState } from '../scripts/lib/harvest.js';

test('classifyComment counts first-person testimonies only', () => {
  assert.equal(classifyComment('I left Islam two years ago after watching these debates.'), 'left');
  assert.equal(classifyComment("I'm an ex-Muslim from Pakistan, thank you David"), 'left');
  assert.equal(classifyComment('I was a Muslim for 30 years but now I follow Jesus Christ'), 'christ');
  assert.equal(classifyComment('I accepted Jesus last month. Please pray for my family.'), 'christ');
  assert.equal(classifyComment('i got baptized yesterday!!!'), 'christ');
  assert.equal(classifyComment('Jesus is my Lord and Saviour, I left Islam in 2019'), 'christ');
  assert.equal(classifyComment('Why are so many people leaving Islam?'), null);
  assert.equal(classifyComment('My friend says he left Islam but I do not believe him'), null);
  assert.equal(classifyComment('I will never leave Islam, Allah is one'), null);
  assert.equal(classifyComment("I'm not an ex-Muslim, I'm a proud Muslim"), null);
  assert.equal(classifyComment('Ex-Muslim here, from Egypt. These videos helped me.'), 'left');
  assert.equal(classifyComment('As an ex muslim I can confirm everything he says'), 'left');
  assert.equal(classifyComment('I became a Christian after 25 years in Islam'), 'christ');
  assert.equal(classifyComment("I'm a former Muslim and I was baptized in March"), 'christ');
  assert.equal(classifyComment('I come from a Muslim family in Pakistan and today I believe in Jesus'), 'christ');
  assert.equal(classifyComment('We gave our lives to Christ last Easter'), 'christ');
  assert.equal(classifyComment('Great video'), null);
});

test('tallyComments counts each author once and upgrades left to christ', () => {
  const comments = [
    { text: 'I left Islam', authorId: 'a' },
    { text: 'I left Islam last year', authorId: 'a' },
    { text: 'I accepted Jesus', authorId: 'a' },
    { text: 'I accepted Jesus too', authorId: 'b' },
    { text: 'nice', authorId: 'c' },
  ];
  const { counts, added } = tallyComments(comments);
  assert.deepEqual(counts, { left: 0, christ: 2, comments: 5 });
  assert.equal(Object.keys(added).length, 2);
  const again = tallyComments([{ text: 'I was baptized', authorId: 'b' }], added);
  assert.equal(again.counts.christ, 0);
});

function fakeFetcher(responses) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const resource = u.pathname.split('/').pop();
    const body = typeof responses[resource] === 'function' ? responses[resource](u) : responses[resource];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetcher, calls };
}

test('updateHarvest reads reach and comments, dedupes, and skips videos read recently', async () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  const { fetcher, calls } = fakeFetcher({
    channels: { items: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', snippet: { title: 'Ch A', customUrl: '@cha' }, statistics: { subscriberCount: '1000', viewCount: '50000', videoCount: '10' } }] },
    playlistItems: { items: [{ snippet: { resourceId: { videoId: 'v1' }, title: 'Video 1', publishedAt: '2026-10-30T00:00:00Z' } }] },
    commentThreads: { items: [
      { snippet: { topLevelComment: { snippet: { textDisplay: 'I left Islam', authorChannelId: { value: 'x' }, publishedAt: '2026-10-31T10:00:00Z' } } } },
      { snippet: { topLevelComment: { snippet: { textDisplay: 'I found Jesus!', authorChannelId: { value: 'y' }, publishedAt: '2026-10-31T09:00:00Z' } } } },
      { snippet: { topLevelComment: { snippet: { textDisplay: 'nice', authorChannelId: { value: 'z' }, publishedAt: '2026-10-31T08:00:00Z' } } } },
    ] },
  });
  const channels = [{ id: 'a', name: 'Ch A', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }];
  let state = await updateHarvest(emptyState(), { key: 'k', channels, fetcher, now });
  assert.equal(state.channels.UCaaaaaaaaaaaaaaaaaaaaaa.subscribers, 1000);
  assert.deepEqual(state.totals, { left: 1, christ: 1, comments: 3, videos: 1 });
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].reach, 1000);
  assert.equal(state.startedAt, '2026-10-31');
  assert.ok(!JSON.stringify(state).includes('"x"'), 'author ids are not stored in clear');
  const before = calls.length;
  state = await updateHarvest(state, { key: 'k', channels, fetcher, now: now + 3600000 });
  assert.equal(calls.filter((u) => u.includes('commentThreads')).length, 1, 'video not re-read within six hours');
  assert.deepEqual(state.totals, { left: 1, christ: 1, comments: 3, videos: 1 });
  state = await updateHarvest(state, { key: 'k', channels, fetcher, now: now + 7 * 3600000 });
  assert.equal(calls.filter((u) => u.includes('commentThreads')).length, 2, 're-read after six hours');
  assert.deepEqual(state.totals, { left: 1, christ: 1, comments: 3, videos: 1 }, 'same comments are not counted twice');
  assert.ok(calls.length > before);
});

test('updateHarvest without a key leaves the state untouched', async () => {
  const state = await updateHarvest(emptyState(), { key: '', channels: [{ channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }] });
  assert.deepEqual(state.totals, emptyState().totals);
});

test('renderHarvestPage shows counts, figures, channels and trends', () => {
  const config = { channels: [{ id: 'a', name: 'Ch A', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }], figures: [{ value: '1 in 4', label: 'Left', detail: 'd', source: 'Pew', url: 'https://pew.example', date: '2025' }], trends: { keywords: ['ex muslim'], geos: ['NG'] }, testimonyForm: '' };
  const state = { ...emptyState(), totals: { left: 12, christ: 34, comments: 5600, videos: 20 }, channels: { UCaaaaaaaaaaaaaaaaaaaaaa: { title: 'Ch A', subscribers: 805000, views: 540000000, videoCount: 3716 } }, history: [{ date: '2026-10-30', left: 10, christ: 30, reach: 800000 }, { date: '2026-10-31', left: 12, christ: 34, reach: 805000 }], updatedAt: '2026-10-31T12:00:00Z' };
  const html = renderHarvestPage({ config, state, site: { name: 'Glorious Anchor', url: 'https://gloriousanchor.com/' }, videos: [] });
  assert.ok(html.includes('>34<') && html.includes('>12<') && html.includes('805k subscribers'));
  assert.ok(html.includes('1 in 4') && html.includes('https://pew.example'));
  assert.ok(html.includes('trends.google.com/trends/embed/explore/TIMESERIES') && html.includes('Nigeria'));
  assert.ok(html.includes('<polyline'));
  assert.ok(html.includes('t.me/gloriousanchor'));
  assert.ok(html.includes('"@type":"Dataset"'));
});

test('harvestWidgetHtml is empty before the first count and shows the headline numbers after', () => {
  assert.equal(harvestWidgetHtml(emptyState()), '');
  const html = harvestWidgetHtml({ ...emptyState(), totals: { left: 2, christ: 3, comments: 4059, videos: 24 }, channels: { a: { subscribers: 805000 }, b: { subscribers: 417000 } } });
  assert.ok(html.includes('<b>5</b>') && html.includes('1.2m') && html.includes('4.1k') && html.includes('href="harvest/"'));
  const dated = harvestWidgetHtml({ ...emptyState(), startedAt: '2026-10-31', totals: { left: 1, christ: 0, comments: 10, videos: 1 }, channels: { a: { subscribers: 10 } } });
  assert.ok(dated.includes('since 31 October 2026'));
});

test('updateHarvest re-reads everything when the pattern version changes', async () => {
  const old = { ...emptyState(), version: 1, totals: { left: 9, christ: 9, comments: 99, videos: 9 }, authors: { x: 'left' }, videos: { v: { done: true } }, channels: { keep: { subscribers: 5 } } };
  const state = await updateHarvest(old, { key: '', channels: [] });
  assert.equal(state.version, 2);
  assert.deepEqual(state.totals, emptyState().totals);
  assert.deepEqual(state.videos, {});
  assert.equal(state.channels.keep.subscribers, 5);
});
