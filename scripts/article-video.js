#!/usr/bin/env node
/**
 * Render a narrated article video (1920×1080) from a scene script in video-scripts/<slug>.md.
 *
 * Script format: a header (title:, voice:, rate:) then scenes separated by a line of "---". Each scene has optional
 * "image:", "kicker:" and "caption:" lines; every other line is narration. Narration is spoken by Microsoft Edge's
 * neural voices through edge-tts (Nigerian English by default); the frame for each scene is an HTML card rendered by
 * Chromium; ffmpeg stitches frames and speech into the film and writes a thumbnail and a YouTube description beside it.
 *
 * Usage: node scripts/article-video.js --script video-scripts/festac-77-at-fifty.md [--out videos/articles] [--no-tts]
 * Needs ffmpeg, Chromium via Playwright and `pip install edge-tts`. --no-tts renders silence of the spoken length, for checks.
 */
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SCRIPT = path.resolve(ROOT, arg('--script', ''));
const OUT = path.resolve(ROOT, arg('--out', 'videos/articles'));
const NO_TTS = argv.includes('--no-tts');
const FRAMES_ONLY = argv.includes('--frames-only');
const PAUSE = 0.8; // seconds of silence after each scene
if (!arg('--script')) { console.error('usage: node scripts/article-video.js --script video-scripts/<slug>.md'); process.exit(2); }

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const spec of ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return spec.endsWith('.mjs') ? await import(spec) : req(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Run: npm i --no-save playwright && npx playwright install --with-deps chromium');
}

export function parseScript(text) {
  const blocks = String(text).replace(/\r/g, '').split(/^---\s*$/m);
  const head = {};
  for (const line of blocks[0].split('\n')) { const m = line.match(/^(\w+):\s*(.*)$/); if (m) head[m[1]] = m[2].trim(); }
  const scenes = blocks.slice(1).map((b) => {
    const s = { narration: [] };
    for (const line of b.split('\n')) {
      const m = line.match(/^(image|kicker|caption|style):\s*(.*)$/);
      if (m) s[m[1]] = m[2].trim(); else if (line.trim()) s.narration.push(line.trim());
    }
    s.narration = s.narration.join(' ');
    return s;
  }).filter((s) => s.narration);
  return { head, scenes };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRAND = '<div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="#d4a62a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M12 6v16M5 12H2a10 10 0 0 0 20 0h-3M8 9h8"/></svg>Glorious Anchor · gloriousanchor.com</div>';

function frameHtml(scene, index, total, imageDataUrl) {
  const pct = ((index + 1) / total * 100).toFixed(1);
  const common = `
  * { box-sizing: border-box; } html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; font-family: Georgia, "Times New Roman", serif; color: #fff; background: #0b1f3a; }
  .brand { position: absolute; right: 64px; bottom: 44px; display: flex; align-items: center; gap: 14px; font: 700 26px/1 "Helvetica Neue", Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.85); }
  .brand svg { width: 34px; height: 34px; }
  .bar { position: absolute; left: 0; bottom: 0; height: 8px; width: ${pct}%; background: #d4a62a; }
  .kicker { color: #d4a62a; font: 700 30px/1 "Helvetica Neue", Arial, sans-serif; letter-spacing: .22em; text-transform: uppercase; margin-bottom: 22px; }`;
  if (imageDataUrl && scene.style === 'plain') {
    // A designed picture that already carries its own words: show it whole, with only the progress bar.
    return `<!doctype html><html><head><meta charset="utf-8"><style>${common} .bg { position: absolute; inset: 0; background: url(${imageDataUrl}) center/cover no-repeat; }</style></head><body><div class="bg"></div><div class="bar"></div></body></html>`;
  }
  if (imageDataUrl) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>${common}
    .bg { position: absolute; inset: 0; background: url(${imageDataUrl}) center/cover no-repeat; }
    .shade { position: absolute; inset: 0; background: linear-gradient(0deg, rgba(6,16,34,.94) 0%, rgba(6,16,34,.55) 38%, rgba(6,16,34,.08) 70%); }
    .text { position: absolute; left: 96px; right: 420px; bottom: 120px; text-shadow: 0 3px 24px rgba(0,0,0,.6); }
    .caption { font-size: 64px; line-height: 1.12; font-weight: 700; text-wrap: balance; }
    </style></head><body><div class="bg"></div><div class="shade"></div>
    <div class="text"><div class="kicker">${esc(scene.kicker || '')}</div><div class="caption">${esc(scene.caption || '')}</div></div>${BRAND}<div class="bar"></div></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${common}
    body { background: radial-gradient(120% 90% at 50% 0%, #1f3f6e 0%, #0b1f3a 55%, #07142a 100%); }
    .ring { position: absolute; left: 50%; top: 50%; width: 1400px; height: 1400px; transform: translate(-50%, -50%); border-radius: 50%; border: 2px solid rgba(212,166,42,.18); }
    .text { position: absolute; left: 160px; right: 160px; top: 50%; transform: translateY(-50%); text-align: center; }
    .kicker { margin-bottom: 40px; }
    .caption { font-size: 68px; line-height: 1.25; font-weight: 700; font-style: italic; text-wrap: balance; }
    </style></head><body><div class="ring"></div>
    <div class="text"><div class="kicker">${esc(scene.kicker || '')}</div><div class="caption">${esc(scene.caption || '')}</div></div>${BRAND}<div class="bar"></div></body></html>`;
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(stdout.trim());
}

async function speak(text, file, head) {
  if (NO_TTS) {
    const secs = Math.max(2, text.split(/\s+/).length / 2.4);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(secs), '-c:a', 'libmp3lame', '-q:a', '9', file]);
    return;
  }
  const args = ['-m', 'edge_tts', '--voice', head.voice || 'en-NG-AbeoNeural', '--text', text, '--write-media', file];
  if (head.rate) args.push('--rate', head.rate);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await run('python3', args, { maxBuffer: 64 * 1024 * 1024 }); return; }
    catch (err) { if (attempt === 3) throw err; console.warn(`  (tts retry ${attempt}: ${String(err.message).split('\n')[0]})`); await new Promise((r) => setTimeout(r, 3000)); }
  }
}

async function main() {
  const { head, scenes } = parseScript(await readFile(SCRIPT, 'utf8'));
  const slug = path.basename(SCRIPT).replace(/\.md$/, '');
  const work = path.join(ROOT, '.video-work', slug);
  await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true }); await mkdir(OUT, { recursive: true });
  console.log(`${head.title || slug}: ${scenes.length} scenes, voice ${head.voice || 'en-NG-AbeoNeural'}${NO_TTS ? ' (silent check)' : ''}`);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const frames = [], clips = [];
  let total = 0;
  for (const [i, scene] of scenes.entries()) {
    const n = String(i + 1).padStart(2, '0');
    let dataUrl = null;
    if (scene.image) {
      const buf = await readFile(path.resolve(ROOT, scene.image));
      dataUrl = `data:image/${scene.image.endsWith('.png') ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
    }
    const png = path.join(work, `f${n}.png`);
    await page.setContent(frameHtml(scene, i, scenes.length, dataUrl), { waitUntil: 'load' });
    await page.screenshot({ path: png });
    if (FRAMES_ONLY) { console.log(`  frame ${n}: ${scene.caption || scene.image || ''}`); continue; }
    const mp3 = path.join(work, `s${n}.mp3`), padded = path.join(work, `s${n}.m4a`);
    await speak(scene.narration, mp3, head);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-af', `apad=pad_dur=${PAUSE}`, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', padded]);
    const secs = await duration(padded);
    total += secs; frames.push({ png, secs }); clips.push(padded);
    console.log(`  scene ${n}: ${secs.toFixed(1)}s  ${scene.caption || ''}`);
  }
  await browser.close();
  if (FRAMES_ONLY) { console.log(`frames written to ${path.relative(ROOT, work)}`); return; }

  await writeFile(path.join(work, 'frames.txt'), frames.map((f) => `file '${f.png}'\nduration ${f.secs.toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).png}'\n`);
  await writeFile(path.join(work, 'audio.txt'), clips.map((c) => `file '${c}'`).join('\n') + '\n');
  const audio = path.join(work, 'audio.m4a');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'audio.txt'), '-c', 'copy', audio]);
  await copyFile(frames[0].png, path.join(OUT, `${slug}.png`));
  const out = path.join(OUT, `${slug}.mp4`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-i', audio, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-threads', '2', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { maxBuffer: 64 * 1024 * 1024 });
  const m = Math.floor(total / 60), s = Math.round(total % 60);
  console.log(`wrote ${path.relative(ROOT, out)} (${m}m ${String(s).padStart(2, '0')}s) and ${slug}.png`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
