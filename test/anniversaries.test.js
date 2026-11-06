import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anniversaryFor, parseLifeDate, dayIn } from '../scripts/lib/anniversaries.js';
import { compilePost, postToArticle } from '../scripts/lib/posts.js';
import { selectAnniversaries, selectNew } from '../scripts/lib/announce.js';

const site = { name: 'Glorious Anchor', url: 'https://example.com' };
const nov7 = Date.parse('2026-11-07T02:00:00Z'); // 3 am in Lagos, 7 November

test('parseLifeDate and dayIn', () => {
  assert.deepEqual(parseLifeDate('1918-11-07'), { year: 1918, month: 11, day: 7 });
  assert.deepEqual(parseLifeDate('1909'), { year: 1909, month: null, day: null });
  assert.equal(parseLifeDate('7 Nov 1918'), null);
  assert.equal(dayIn(Date.parse('2026-11-06T23:30:00Z')), '2026-11-07', 'Lagos is an hour ahead of UTC');
});

test('anniversaryFor finds a birthday or homegoing that falls today, homegoing first', () => {
  const b = anniversaryFor({ born: '1918-11-07', died: '2018-02-21' }, nov7);
  assert.equal(b.kind, 'born'); assert.equal(b.label, 'Born this day, 1918'); assert.equal(b.headline, 'Born on this day in 1918');
  assert.equal(b.at, Date.parse('2026-11-07T23:59:59+01:00'));
  const d = anniversaryFor({ born: '1918-11-07', died: '2018-11-07' }, nov7);
  assert.equal(d.kind, 'died'); assert.equal(d.headline, 'Went home to the Lord 8 years ago today');
  assert.equal(anniversaryFor({ born: '1918-11-08' }, nov7), null);
  assert.equal(anniversaryFor({ born: '1909' }, nov7), null, 'a year alone never matches');
  assert.equal(anniversaryFor({}, nov7), null);
});

test('an article about a general is pinned and labelled on the day, and announced once a year', () => {
  const md = '---\ntitle: Billy Graham\nperson: Billy Graham\nborn: 1918-11-07\ndied: 2018-02-21\ncategories: generals\n---\n\nBody text.';
  const onDay = compilePost('2026-11-06-billy-graham.md', md, site, nov7);
  assert.equal(onDay.pinned, true); assert.equal(onDay.anniversary, 'Born this day, 1918'); assert.equal(onDay.person, 'Billy Graham');
  const offDay = compilePost('2026-11-06-billy-graham.md', md, site, nov7 + 86400 * 1000);
  assert.equal(offDay.pinned, false); assert.equal(offDay.anniversary, undefined);
  const a = postToArticle(onDay, site);
  assert.equal(a.anniversaryAt, onDay.anniversaryAt); assert.equal(a.pinned, true);
  // Already announced as a new article: the anniversary post goes out once this year, under its own id.
  const announced = { [a.id]: 1 };
  const items = selectAnniversaries([a], announced, { now: nov7, year: 2026 });
  assert.equal(items.length, 1); assert.equal(items[0].id, `${a.id}@2026`);
  assert.equal(items[0].shareTitle, 'Born on this day in 1918: Billy Graham');
  announced[`${a.id}@2026`] = nov7;
  assert.equal(selectAnniversaries([a], announced, { now: nov7, year: 2026 }).length, 0, 'not twice in a year');
  assert.equal(selectAnniversaries([a], {}, { now: nov7, year: 2026 }).length, 0, 'a never-announced article is left to the new-item post');
  assert.equal(selectNew([a], {}, { now: nov7 }).length, 1);
});
