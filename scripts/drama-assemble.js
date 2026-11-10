#!/usr/bin/env node
/**
 * Assemble a dramatised film from AI-generated clips (scripts/drama-clips.js) and a narrator.
 *
 *   node scripts/drama-assemble.js --shots video-scripts/festac-77-drama-shots.md [--out videos/articles] [--no-tts]
 *
 * Reads the shot list, takes each shot's clip from .video-work/drama/clips/<id>.mp4 and lays the shot's `narration:`
 * line over it in the narrator's voice (edge-tts, en-NG-AbeoNeural). A narrated shot whose actors also speak plays the
 * narration first over its opening frame, then the clip with its own sound; a narrated shot without dialogue keeps
 * the clip moving under the narrator with its sound lowered, holding the last frame if the narration runs longer.
 * A title card opens the film and an end card closes it. Writes <out>/<slug>.mp4, <slug>.png and <slug>.youtube.txt.
 *
 * Needs ffmpeg, Chromium via Playwright and `pip install edge-tts`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseShots } from './drama-clips.js';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SHOTS = path.resolve(ROOT, arg('--shots', 'video-scripts/festac-77-drama-shots.md'));
const OUT = path.resolve(ROOT, arg('--out', 'videos/articles'));
const CLIPS = path.resolve(ROOT, arg('--clips', '.video-work/drama/clips'));
const NO_TTS = argv.includes('--no-tts');
const VOICE = arg('--voice', 'en-NG-AbeoNeural');
const RATE = arg('--rate', '-4%');
const FPS = 30, W = 1920, H = 1080;
const FF = ['-y', '-loglevel', 'error'];
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const spec of ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node-tools/node_modules/playwright/index.mjs', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean)) {
    try { return spec.endsWith('.mjs') ? await import(spec) : req(spec); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Run: npm i --no-save playwright && npx playwright install --with-deps chromium');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRAND = '<div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="#d4a62a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="2"/><path d="M12 6v16M5 12H2a10 10 0 0 0 20 0h-3M8 9h8"/></svg>Glorious Anchor · gloriousanchor.com</div>';

function cardHtml({ kicker, title, lines, bg }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0b1526}
  .c{position:relative;width:${W}px;height:${H}px;color:#fff;font-family:"Liberation Serif","DejaVu Serif",Georgia,serif;
     background:${bg ? `#000 url(${bg}) center/cover no-repeat` : 'radial-gradient(ellipse at 50% 40%,#1a2a48 0%,#0b1526 70%)'}}
  .c:before{content:"";position:absolute;inset:0;background:${bg ? 'linear-gradient(180deg,rgba(5,10,25,.35),rgba(5,10,25,.85))' : 'none'}}
  .k{position:absolute;left:120px;right:120px;top:300px;text-align:center;font-family:"Liberation Sans","DejaVu Sans",sans-serif;font-weight:700;font-size:30px;letter-spacing:.3em;text-transform:uppercase;color:#d4a62a}
  .t{position:absolute;left:120px;right:120px;top:360px;text-align:center;font-size:112px;line-height:1.05;text-shadow:0 4px 24px rgba(0,0,0,.7)}
  .l{position:absolute;left:200px;right:200px;top:640px;text-align:center;font-family:"Liberation Sans","DejaVu Sans",sans-serif;font-size:34px;line-height:1.5;color:#dfe6f3}
  .l b{color:#f3c969;font-weight:700}
  .brand{position:absolute;left:0;right:0;bottom:56px;text-align:center;font-family:"Liberation Sans","DejaVu Sans",sans-serif;font-size:28px;letter-spacing:.12em;text-transform:uppercase;color:#cfd6e3}
  .brand svg{width:34px;height:34px;vertical-align:-8px;margin-right:14px}
  </style></head><body><div class="c">
  ${kicker ? `<div class="k">${esc(kicker)}</div>` : ''}<div class="t">${esc(title)}</div>
  <div class="l">${lines.map(esc).join('<br>')}</div>${BRAND}</div></body></html>`;
}

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(stdout.trim());
}

async function speak(text, file) {
  if (NO_TTS) {
    const secs = Math.max(2, text.split(/\s+/).length / 2.4);
    await run('ffmpeg', [...FF, '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(secs), '-c:a', 'libmp3lame', '-q:a', '9', file]);
    return;
  }
  const args = ['-m', 'edge_tts', '--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', file];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await run('python3', args, { maxBuffer: 64 * 1024 * 1024 }); return; }
    catch (err) { if (attempt === 3) throw err; console.warn(`  (tts retry ${attempt}: ${String(err.message).split('\n')[0]})`); await new Promise((r) => setTimeout(r, 3000)); }
  }
}

const hasDialogue = (prompt) => /["“][^"”]{3,}["”]/.test(prompt);

/** A still card held for `secs` with a soft fade in and out and silence. */
async function cardSegment(png, secs, out) {
  await run('ffmpeg', [...FF, '-loop', '1', '-framerate', String(FPS), '-i', png, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', secs.toFixed(3),
    '-vf', `fade=t=in:d=0.6,fade=t=out:st=${(secs - 0.8).toFixed(2)}:d=0.8,format=yuv420p`, ...ENC, '-shortest', out], { maxBuffer: 16 * 1024 * 1024 });
}

async function main() {
  const spec = parseShots(await readFile(SHOTS, 'utf8'));
  const slug = path.basename(SHOTS, '.md').replace(/-shots$/, '');
  const work = path.join(ROOT, '.video-work', 'drama', 'assemble');
  await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true }); await mkdir(OUT, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  const segments = [];
  let total = 0, missing = [];

  // Title card over the first frame of the dawn shot when it exists.
  const titleBg = path.join(work, 'title-bg.jpg');
  const dawn = path.join(CLIPS, '01-theatre-dawn.mp4');
  let bgUrl = null;
  if (existsSync(dawn)) { await run('ffmpeg', [...FF, '-ss', '2', '-i', dawn, '-frames:v', '1', '-q:v', '3', titleBg]); bgUrl = `data:image/jpeg;base64,${(await readFile(titleBg)).toString('base64')}`; }
  const titlePng = path.join(work, 'title.png');
  await page.setContent(cardHtml({ kicker: 'A dramatisation', title: 'FESTAC 77: The Lease', bg: bgUrl,
    lines: ['Fifty years on from the four weeks that changed Nigeria.', 'The Oyelaran family is invented; the dates and facts are documented.'] }), { waitUntil: 'load' });
  await page.screenshot({ path: titlePng });
  const titleSeg = path.join(work, 'seg-000.mp4'); await cardSegment(titlePng, 6, titleSeg); segments.push(titleSeg); total += 6;

  let n = 0;
  for (const shot of spec.shots) {
    n++;
    const clip = path.join(CLIPS, `${shot.id}.mp4`);
    if (!existsSync(clip)) { missing.push(shot.id); console.warn(`  ${shot.id}: no clip, skipped`); continue; }
    const seg = path.join(work, `seg-${String(n).padStart(3, '0')}.mp4`);
    const clipSecs = await duration(clip);
    const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`;
    if (!shot.narration) {
      await run('ffmpeg', [...FF, '-i', clip, '-vf', `${norm},fade=t=in:d=0.3,fade=t=out:st=${(clipSecs - 0.3).toFixed(2)}:d=0.3,format=yuv420p`,
        '-af', `afade=t=in:d=0.2,afade=t=out:st=${(clipSecs - 0.3).toFixed(2)}:d=0.3`, ...ENC, seg], { maxBuffer: 16 * 1024 * 1024 });
      segments.push(seg); total += clipSecs; console.log(`  ${shot.id}: ${clipSecs.toFixed(1)}s`); continue;
    }
    const mp3 = path.join(work, `n${n}.mp3`);
    await speak(shot.narration, mp3);
    const nSecs = await duration(mp3) + 0.5;
    if (hasDialogue(shot.prompt)) {
      // Narration over the opening frame (slow push in), then the clip with its own sound.
      const still = path.join(work, `still${n}.png`), part1 = path.join(work, `p1-${n}.mp4`), part2 = path.join(work, `p2-${n}.mp4`);
      await run('ffmpeg', [...FF, '-i', clip, '-frames:v', '1', still]);
      const frames = Math.round(nSecs * FPS);
      await run('ffmpeg', [...FF, '-loop', '1', '-framerate', String(FPS), '-i', still, '-i', mp3, '-t', nSecs.toFixed(3),
        '-filter_complex', `[0:v]${norm},scale=2496:1404,zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},fade=t=in:d=0.3,format=yuv420p[v];[1:a]apad,aresample=48000[a]`,
        '-map', '[v]', '-map', '[a]', ...ENC, '-shortest', part1], { maxBuffer: 16 * 1024 * 1024 });
      await run('ffmpeg', [...FF, '-i', clip, '-vf', `${norm},fade=t=out:st=${(clipSecs - 0.3).toFixed(2)}:d=0.3,format=yuv420p`,
        '-af', `afade=t=out:st=${(clipSecs - 0.3).toFixed(2)}:d=0.3`, ...ENC, part2], { maxBuffer: 16 * 1024 * 1024 });
      await writeFile(path.join(work, `cat${n}.txt`), `file '${part1}'\nfile '${part2}'\n`);
      await run('ffmpeg', [...FF, '-f', 'concat', '-safe', '0', '-i', path.join(work, `cat${n}.txt`), '-c', 'copy', seg]);
      total += nSecs + clipSecs; console.log(`  ${shot.id}: ${nSecs.toFixed(1)}s narration, then ${clipSecs.toFixed(1)}s clip`);
    } else {
      // Narration over the moving clip; the clip's own sound under it; hold the last frame if the narrator runs longer.
      const secs = Math.max(clipSecs, nSecs);
      const hold = Math.max(0, secs - clipSecs);
      await run('ffmpeg', [...FF, '-i', clip, '-i', mp3,
        '-filter_complex', `[0:v]${norm},tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},fade=t=in:d=0.3,fade=t=out:st=${(secs - 0.4).toFixed(2)}:d=0.4,format=yuv420p[v];[0:a]volume=0.3,apad=pad_dur=${hold.toFixed(3)}[bg];[1:a]apad=pad_dur=${Math.max(0, secs - nSecs + 0.5).toFixed(3)},aresample=48000[nar];[bg][nar]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${(secs - 0.4).toFixed(2)}:d=0.4[a]`,
        '-map', '[v]', '-map', '[a]', '-t', secs.toFixed(3), ...ENC, seg], { maxBuffer: 16 * 1024 * 1024 });
      total += secs; console.log(`  ${shot.id}: ${secs.toFixed(1)}s with narration`);
    }
    segments.push(seg);
  }

  // End card.
  const endPng = path.join(work, 'end.png');
  await page.setContent(cardHtml({ kicker: 'Read the full account, with every source', title: 'gloriousanchor.com',
    lines: ['FESTAC 77: the four weeks Nigeria was leased to darkness,', 'the lease that expires on 12 February 2027, and the two jubilees the nation must choose between.', 'By Efosa Adun.'] }), { waitUntil: 'load' });
  await page.screenshot({ path: endPng });
  const endSeg = path.join(work, 'seg-999.mp4'); await cardSegment(endPng, 8, endSeg); segments.push(endSeg); total += 8;
  await browser.close();

  await writeFile(path.join(work, 'all.txt'), segments.map((s) => `file '${s}'`).join('\n') + '\n');
  const out = path.join(OUT, `${slug}.mp4`);
  await run('ffmpeg', [...FF, '-f', 'concat', '-safe', '0', '-i', path.join(work, 'all.txt'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { maxBuffer: 64 * 1024 * 1024 });
  await copyFile(titlePng, path.join(OUT, `${slug}.png`));
  const m = Math.floor(total / 60), s = Math.round(total % 60);
  console.log(`wrote ${path.relative(ROOT, out)} (${m}m ${String(s).padStart(2, '0')}s), ${segments.length} segments${missing.length ? `, missing clips: ${missing.join(', ')}` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
