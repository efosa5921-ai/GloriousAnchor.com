/* Bible Quiz: loads data/quizzes.json, plays one quiz, shares the score. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const stage = $('#qStage'), title = $('#qTitle'), desc = $('#qDesc'), kicker = $('#qKicker');
  const SITE = document.querySelector('.brand__name')?.textContent || 'Glorious Anchor';
  const BASE = `${location.origin}/quiz/`;
  const loadJSON = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); } n.append(...kids); return n; };
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

  let quizzes = [], quiz = null, order = [], i = 0, score = 0;

  function pick() {
    const want = new URLSearchParams(location.search).get('q');
    const daily = quizzes[Math.floor(Date.now() / 86400000) % quizzes.length];
    quiz = quizzes.find((q) => q.id === want) || daily;
    kicker.textContent = quiz === daily && !want ? 'Quiz of the day' : `Bible Quiz · ${quiz.difficulty}`;
    document.title = `${quiz.title} — Bible Quiz — ${SITE}`;
    start();
  }

  function start() {
    order = shuffle(quiz.questions.map((_, k) => k)); i = 0; score = 0;
    title.textContent = quiz.title; desc.textContent = quiz.description || '';
    const v = document.querySelector(`#qList li[data-id="${CSS.escape(quiz.id)}"] .quiz__video`);
    document.querySelector('#qVideo')?.remove();
    if (v) desc.after(el('p', { id: 'qVideo' }, el('a', { class: 'btn btn--ghost', href: v.getAttribute('href'), download: '' }, '▶ Watch or download the video version')));
    question();
  }

  function question() {
    const q = quiz.questions[order[i]];
    const best = loadJSON('ga:quiz:best', {})[quiz.id];
    stage.innerHTML = '';
    const head = el('div', { class: 'quiz__progress' }, el('span', {}, `Question ${i + 1} of ${quiz.questions.length}`), el('span', {}, `Score ${score}${best != null ? ` · best ${best}` : ''}`));
    const bar = el('div', { class: 'quiz__bar' }, el('span', { style: `width:${(i / quiz.questions.length) * 100}%` }));
    const qEl = el('h2', { class: 'quiz__q' }, q.q);
    const opts = el('div', { class: 'quiz__options', role: 'group', 'aria-label': 'Answers' });
    const choices = shuffle(q.options.map((text, k) => ({ text, correct: k === q.answer })));
    choices.forEach((c, k) => opts.appendChild(el('button', { type: 'button', class: 'quiz__opt', 'data-correct': String(c.correct), onclick: () => answer(c, opts, q) }, el('b', {}, String.fromCharCode(65 + k)), c.text)));
    stage.append(head, bar, qEl, opts);
  }

  function answer(choice, opts, q) {
    for (const b of opts.querySelectorAll('button')) {
      b.disabled = true;
      if (b.dataset.correct === 'true') b.classList.add('quiz__opt--right');
      else if (b.lastChild.textContent === choice.text) b.classList.add('quiz__opt--wrong');
    }
    if (choice.correct) score++;
    const fb = el('div', { class: `quiz__feedback ${choice.correct ? 'quiz__feedback--right' : 'quiz__feedback--wrong'}` },
      el('strong', {}, choice.correct ? 'Correct!' : `Not quite. The answer is ${q.options[q.answer]}.`),
      q.ref ? el('span', { class: 'quiz__ref' }, ` ${q.ref}`) : '',
      q.note ? el('p', { class: 'muted' }, q.note) : '');
    const next = el('button', { type: 'button', class: 'btn', onclick: () => { i++; if (i < quiz.questions.length) question(); else finish(); } }, i + 1 < quiz.questions.length ? 'Next question →' : 'See my score');
    stage.append(fb, next); next.focus();
  }

  function finish() {
    const n = quiz.questions.length;
    const best = loadJSON('ga:quiz:best', {}); if (!(best[quiz.id] >= score)) { best[quiz.id] = score; saveJSON('ga:quiz:best', best); }
    const pct = score / n;
    const verdict = pct === 1 ? 'Perfect! You know your Bible.' : pct >= 0.8 ? 'Excellent. A scholar in the making.' : pct >= 0.5 ? 'Good going. A few verses to look up.' : 'A great reason to open the Book. Try again?';
    const link = `${BASE}?q=${encodeURIComponent(quiz.id)}`;
    const text = `I scored ${score}/${n} on the ${SITE} Bible Quiz: ${quiz.title}. Can you beat it? ${link}`;
    stage.innerHTML = '';
    const share = el('div', { class: 'quiz__share' },
      el('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
      el('a', { class: 'btn btn--ghost', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Post on X'),
      el('button', { type: 'button', class: 'btn btn--ghost', onclick: async (e) => { if (navigator.share) { try { await navigator.share({ text, url: link }); return; } catch { /* fall through */ } } try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied!'; } catch { window.prompt('Copy this', text); } } }, navigator.share ? 'Share…' : 'Copy'),
    );
    stage.append(
      el('div', { class: 'quiz__result' }, el('div', { class: 'quiz__score' }, `${score} / ${n}`), el('p', { class: 'quiz__verdict' }, verdict)),
      share,
      el('div', { class: 'quiz__again' }, el('button', { type: 'button', class: 'btn btn--ghost', onclick: start }, 'Play again'), el('a', { class: 'btn btn--ghost', href: '#qList' }, 'Try another quiz')),
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  fetch('../data/quizzes.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => { quizzes = d.quizzes || []; if (!quizzes.length) throw new Error('none'); pick(); })
    .catch(() => { desc.textContent = 'The quiz could not load. Please try again shortly.'; });
  window.addEventListener('popstate', () => quizzes.length && pick());
})();
