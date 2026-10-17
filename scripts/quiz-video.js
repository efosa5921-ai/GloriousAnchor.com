#!/usr/bin/env node
/**
 * Render a Bible quiz as a vertical video (1080×1920, for YouTube Shorts, TikTok, Instagram Reels, WhatsApp status).
 * Each question: card to read, a countdown, then the answer with its reference. Title and end cards carry the brand.
 *
 * Usage: node scripts/quiz-video.js [--quiz <id>|all] [--limit <n>] [--out videos/quiz]
 * Needs Chromium via Playwright (npm i --no-save playwright && npx playwright install --with-deps chromium) and ffmpeg.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validateQuizzes } from './lib/quiz.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WANT = arg('--quiz', 'all'), LIMIT = Number(arg('--limit', 0)) || 0, OUT = path.resolve(ROOT, arg('--out', 'videos/quiz'));
const T = { title: 3, read: 2.5, count: 4, reveal: 2.5, end: 4 }; // seconds

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const spec of ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return spec.endsWith('.mjs') ? await import(spec) : req(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Run: npm i --no-save playwright && npx playwright install --with-deps chromium');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = 'ABCDEF';
function page(body, extra = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #fff;
         background: radial-gradient(120% 80% at 50% 0%, #1f3f6e 0%, #0b1f3a 55%, #07142a 100%); display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 22px; padding: 80px 80px 0; }
  .top svg { width: 84px; height: 84px; }
  .top .name { font-family: Georgia, "Times New Roman", serif; font-size: 44px; font-weight: 700; }
  .top .sub { font-size: 30px; color: #e8b84a; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; }
  .main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 80px; }
  .num { color: #e8b84a; font-size: 34px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 26px; }
  .q { font-family: Georgia, "Times New Roman", serif; font-size: 72px; line-height: 1.2; font-weight: 700; margin: 0 0 56px; text-wrap: balance; }
  .opts { display: grid; gap: 22px; }
  .opt { display: flex; align-items: center; gap: 26px; padding: 30px 34px; border-radius: 26px; background: rgba(255,255,255,.1); border: 3px solid rgba(255,255,255,.18); font-size: 44px; line-height: 1.25; }
  .opt b { flex: 0 0 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.16); font-size: 36px; }
  .opt.right { background: #16a34a; border-color: #16a34a; }
  .opt.right b { background: #fff; color: #14532d; }
  .opt.dim { opacity: .45; }
  .count { position: absolute; right: 80px; top: 180px; width: 150px; height: 150px; border-radius: 50%; border: 8px solid #e8b84a; display: grid; place-items: center; font-size: 84px; font-weight: 800; color: #e8b84a; }
  .ref { margin-top: 48px; font-size: 40px; color: #e8b84a; font-style: italic; }
  .note { margin-top: 18px; font-size: 34px; color: rgba(255,255,255,.75); line-height: 1.35; }
  .bottom { padding: 0 80px 90px; font-size: 34px; color: rgba(255,255,255,.7); }
  .hero { font-family: Georgia, serif; font-size: 120px; line-height: 1.05; font-weight: 700; margin: 0 0 30px; text-wrap: balance; }
  .lede { font-size: 48px; line-height: 1.35; color: rgba(255,255,255,.85); }
  .cta { margin-top: 60px; display: inline-block; padding: 26px 46px; border-radius: 999px; background: #e8b84a; color: #0b1f3a; font-size: 44px; font-weight: 800; }
  ${extra}
  </style></head><body>
  <div class="top"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#0b1f3a"/><g fill="none" stroke="#e8b84a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="7.5" r="2.5"/><path d="M16 10v15"/><path d="M11 13.5h10"/><path d="M7 19c0 4 4 7 9 7s9-3 9-7"/><path d="M7 19l-2-1.5M7 19l2.5-.5M25 19l2-1.5M25 19l-2.5-.5"/></g></svg><div><div class="name">Glorious Anchor</div><div class="sub">Bible Quiz</div></div></div>
  ${body}
  <div class="bottom">gloriousanchor.com/quiz</div>
  </body></html>`;
}
const titleCard = (q, n) => page(`<div class="main"><div class="num">${esc(q.difficulty)} · ${n} questions</div><h1 class="hero">${esc(q.title)}</h1><p class="lede">${esc(q.description || 'How many can you get right? Answer before the timer runs out.')}</p></div>`);
const questionCard = (qu, i, n, { count = null, reveal = false } = {}) => page(`
  ${count != null ? `<div class="count">${count}</div>` : ''}
  <div class="main"><div class="num">Question ${i + 1} of ${n}</div><h1 class="q">${esc(qu.q)}</h1>
  <div class="opts">${qu.options.map((o, k) => `<div class="opt${reveal ? (k === qu.answer ? ' right' : ' dim') : ''}"><b>${LETTERS[k]}</b><span>${esc(o)}</span></div>`).join('')}</div>
  ${reveal && qu.ref ? `<div class="ref">${esc(qu.ref)}</div>` : ''}${reveal && qu.note ? `<div class="note">${esc(qu.note)}</div>` : ''}</div>`);
const endCard = (q, n) => page(`<div class="main"><div class="num">That's all ${n}</div><h1 class="hero">How many did you get?</h1><p class="lede">Tell us in the comments, then play "${esc(q.title)}" and more quizzes on the site. A new quiz every day.</p><div><span class="cta">gloriousanchor.com/quiz</span></div></div>`);

async function renderQuiz(browser, quiz, outDir) {
  const n = LIMIT ? Math.min(LIMIT, quiz.questions.length) : quiz.questions.length;
  const questions = quiz.questions.slice(0, n);
  const work = path.join(outDir, `.work-${quiz.id}`);
  await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const frames = []; // [file, seconds, sound]
  let k = 0;
  const shot = async (html, secs, sound = null) => { const f = path.join(work, `f${String(k++).padStart(3, '0')}.png`); await p.setContent(html); await p.screenshot({ path: f }); frames.push([f, secs, sound]); };
  await shot(titleCard(quiz, n), T.title);
  for (const [i, qu] of questions.entries()) {
    await shot(questionCard(qu, i, n), T.read);
    for (let c = T.count; c >= 1; c--) await shot(questionCard(qu, i, n, { count: c }), 1, 'tick');
    await shot(questionCard(qu, i, n, { reveal: true }), T.reveal, 'ding');
  }
  await shot(endCard(quiz, n), T.end);
  await ctx.close();

  // Video: concat demuxer with per-image durations.
  const list = frames.map(([f, s]) => `file '${f}'\nduration ${s}`).join('\n') + `\nfile '${frames.at(-1)[0]}'\n`;
  await writeFile(path.join(work, 'frames.txt'), list);
  // Audio: a soft tick per countdown second and a chime at each reveal, laid on silence to the same timeline.
  const tick = path.join(work, 'tick.wav'), ding = path.join(work, 'ding.wav');
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.07', '-af', 'volume=0.35,afade=t=out:st=0.03:d=0.04', tick]);
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=1318:duration=0.5', '-af', 'volume=0.4,afade=t=out:st=0.1:d=0.4', ding]);
  const total = frames.reduce((a, [, s]) => a + s, 0);
  let t = 0; const mixInputs = ['-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo']; const delays = [];
  for (const [, s, sound] of frames) { if (sound) { mixInputs.push('-i', sound === 'tick' ? tick : ding); delays.push(Math.round(t * 1000)); } t += s; }
  const filter = delays.map((d, i) => `[${i + 1}:a]adelay=${d}|${d}[s${i}]`).join(';') + `;[0:a]${delays.map((_, i) => `[s${i}]`).join('')}amix=inputs=${delays.length + 1}:normalize=0[a]`;
  const audio = path.join(work, 'audio.m4a');
  await run('ffmpeg', ['-y', ...mixInputs, '-filter_complex', filter, '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', audio]);
  const out = path.join(outDir, `${quiz.id}.mp4`);
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-i', audio, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
  await rm(work, { recursive: true, force: true });
  return { out, seconds: total, questions: n };
}

async function main() {
  const data = validateQuizzes(JSON.parse(await readFile(path.join(ROOT, 'quizzes.json'), 'utf8')));
  const quizzes = WANT === 'all' ? data.quizzes : data.quizzes.filter((q) => q.id === WANT);
  if (!quizzes.length) throw new Error(`No quiz with id "${WANT}". Available: ${data.quizzes.map((q) => q.id).join(', ')}`);
  await mkdir(OUT, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    for (const q of quizzes) {
      const r = await renderQuiz(browser, q, OUT);
      console.log(`✓ ${path.relative(ROOT, r.out)} — ${r.questions} questions, ${Math.round(r.seconds)}s`);
    }
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
