import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateQuizzes, dailyIndex, renderQuizPage } from '../scripts/lib/quiz.js';

test('the shipped quizzes.json is valid and every answer index points at an option', async () => {
  const data = JSON.parse(await readFile(new URL('../quizzes.json', import.meta.url), 'utf8'));
  const { quizzes, problems } = validateQuizzes(data);
  assert.deepEqual(problems, []);
  assert.equal(quizzes.length, 4);
  for (const q of quizzes) { assert.equal(q.questions.length, 10); for (const qu of q.questions) assert.ok(qu.options[qu.answer]); }
});

test('validateQuizzes reports bad ids, bad answers, duplicates and too-short quizzes; skips disabled', () => {
  const qs = [{ q: 'a', options: ['1', '2'], answer: 0 }, { q: 'b', options: ['1', '2'], answer: 1 }, { q: 'c', options: ['1', '2'], answer: 0 }];
  const { quizzes, problems } = validateQuizzes({ quizzes: [
    { id: 'Bad Id', title: 'x', questions: qs },
    { id: 'ok', title: 'Ok', questions: qs },
    { id: 'ok', title: 'Dup', questions: qs },
    { id: 'short', title: 'Short', questions: qs.slice(0, 2) },
    { id: 'bad-answer', title: 'Bad', questions: [...qs, { q: 'd', options: ['1', '2'], answer: 5 }] },
    { id: 'off', title: 'Off', enabled: false, questions: qs },
  ] });
  assert.deepEqual(quizzes.map((q) => q.id), ['ok', 'bad-answer']);
  assert.equal(quizzes[1].questions.length, 3);
  assert.equal(problems.length, 4);
});

test('dailyIndex rotates once per UTC day and renderQuizPage fills the template', () => {
  const day = 86400000;
  assert.equal(dailyIndex(3, 10 * day + 5), 1);
  assert.equal(dailyIndex(3, 11 * day), 2);
  assert.equal(dailyIndex(3, 12 * day), 0);
  assert.equal(dailyIndex(0), -1);
  const html = renderQuizPage('<head><!--seo:head--></head><h1>{{todayTitle}}</h1><ul><!--quizlist--></ul><!--subscribe-->{{site}}', {
    site: { name: 'GA' }, quizzes: [{ id: 'a', title: 'A & B', description: 'D', difficulty: 'easy', questions: [1, 2, 3] }], metaTags: '<meta x>', subscribe: '<form>', });
  assert.match(html, /<meta x>/); assert.match(html, /<h1>A &amp; B<\/h1>/); assert.match(html, /href="\?q=a"/); assert.match(html, /<form>GA$/);
});

test('renderQuizPage links a video when one has been rendered', () => {
  const html = renderQuizPage('<ul><!--quizlist--></ul>', { site: { name: 'GA' }, quizzes: [{ id: 'a', title: 'A', difficulty: 'easy', questions: [1, 2, 3] }, { id: 'b', title: 'B', difficulty: 'easy', questions: [1, 2, 3] }], metaTags: '', subscribe: '', videoIds: new Set(['a']) });
  assert.match(html, /data-id="a"[^]*href="\.\.\/videos\/quiz\/a\.mp4" download/);
  assert.doesNotMatch(html, /videos\/quiz\/b\.mp4/);
});
