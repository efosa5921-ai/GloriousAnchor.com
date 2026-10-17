/**
 * Bible quizzes: validated from quizzes.json, published as data/quizzes.json and played at /quiz/.
 * The quiz of the day rotates through the list, one per day, the same for everyone.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validateQuizzes(data) {
  const problems = [];
  const quizzes = [];
  const ids = new Set();
  for (const [i, q] of (data?.quizzes || []).entries()) {
    const where = `quiz ${i + 1}${q?.title ? ` (${q.title})` : ''}`;
    if (!q || typeof q !== 'object') { problems.push(`${where}: not an object`); continue; }
    if (q.enabled === false) continue;
    if (!q.id || !/^[a-z0-9-]+$/.test(q.id)) { problems.push(`${where}: id must be lowercase letters, digits and dashes`); continue; }
    if (ids.has(q.id)) { problems.push(`${where}: duplicate id "${q.id}"`); continue; }
    if (!q.title) { problems.push(`${where}: missing title`); continue; }
    const questions = [];
    for (const [j, qu] of (q.questions || []).entries()) {
      const w = `${where}, question ${j + 1}`;
      if (!qu?.q) { problems.push(`${w}: missing question text`); continue; }
      if (!Array.isArray(qu.options) || qu.options.length < 2 || qu.options.length > 6) { problems.push(`${w}: needs 2 to 6 options`); continue; }
      if (!Number.isInteger(qu.answer) || qu.answer < 0 || qu.answer >= qu.options.length) { problems.push(`${w}: answer must be an option index`); continue; }
      questions.push({ q: String(qu.q), options: qu.options.map(String), answer: qu.answer, ...(qu.ref ? { ref: String(qu.ref) } : {}), ...(qu.note ? { note: String(qu.note) } : {}) });
    }
    if (questions.length < 3) { problems.push(`${where}: needs at least 3 valid questions`); continue; }
    ids.add(q.id);
    quizzes.push({ id: q.id, title: String(q.title), description: q.description ? String(q.description) : '', difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium', questions });
  }
  return { quizzes, problems };
}

/** Index of today's quiz: advances by one each UTC day, so everyone gets the same quiz. */
export function dailyIndex(count, now = Date.now()) {
  if (!count) return -1;
  return Math.floor(now / 86400000) % count;
}

export function renderQuizPage(template, { site, quizzes, metaTags, subscribe }) {
  const today = quizzes[dailyIndex(quizzes.length)];
  const list = quizzes.map((q) => `<li><a href="?q=${esc(q.id)}"><strong>${esc(q.title)}</strong> <span class="muted">· ${q.questions.length} questions · ${esc(q.difficulty)}</span></a>${q.description ? `<br><span class="muted">${esc(q.description)}</span>` : ''}</li>`).join('\n');
  return template
    .replace('<!--seo:head-->', metaTags)
    .replace('<!--subscribe-->', subscribe)
    .replace('<!--quizlist-->', list)
    .replace(/\{\{todayTitle\}\}/g, esc(today?.title || ''))
    .replace(/\{\{site\}\}/g, esc(site.name));
}
