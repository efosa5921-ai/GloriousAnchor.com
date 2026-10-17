import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNew, telegramMessage, xText, oauthHeader, X_MAX } from '../scripts/lib/announce.js';

const now = Date.parse('2026-10-17T08:00:00Z');
const h = (n) => now - n * 3600 * 1000;
const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com', xHandle: '@gloriousanchor' };
const mk = (id, extra) => ({ id, title: `Title ${id}`, url: `https://ex.com/${id}`, publishedAt: h(1), kind: 'news', source: `Source ${id}`, sourceId: `s-${id}`, ...extra });

test('selectNew posts every new own article and pick, then a few fresh stories, never repeats', () => {
  const list = [mk('own', { internal: true, publishedAt: h(30) }), mk('pick', { kind: 'pick' }), mk('seen'), mk('n1'), mk('n2'), mk('n3'), mk('n4'), mk('old', { publishedAt: h(30) }), mk('soc', { kind: 'social' })];
  const got = selectNew(list, { seen: now }, { maxStories: 3, now });
  assert.deepEqual(got.map((a) => a.id), ['own', 'pick', 'n1', 'n2', 'n3']);
});

test('messages are formatted and X text never exceeds the limit', () => {
  assert.equal(telegramMessage(mk('a', { title: 'A & B' }), site), '<b>A &amp; B</b>\nSource a · Via Glorious Anchor\nhttps://gloriousanchor.com/s/a/');
  assert.match(telegramMessage(mk('o', { internal: true }), site), /Glorious Anchor · New on Glorious Anchor/);
  const long = xText(mk('l', { title: 'x'.repeat(400) }), site);
  assert.ok(long.length - 'https://gloriousanchor.com/s/l/'.length + 23 <= X_MAX);
  assert.match(long, /…\s—\sSource l via @gloriousanchor\nhttps:\/\/gloriousanchor\.com\/s\/l\/$/);
  assert.equal(xText(mk('s'), site), 'Title s — Source s via @gloriousanchor\nhttps://gloriousanchor.com/s/s/');
  assert.equal(xText(mk('o', { internal: true, url: 'https://gloriousanchor.com/articles/o/' }), site), 'Title o via @gloriousanchor\nhttps://gloriousanchor.com/articles/o/');
});

test('oauthHeader reproduces the signature from the OAuth 1.0a worked example', () => {
  const header = oauthHeader({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json',
    params: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.match(header, /^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce=/);
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});
