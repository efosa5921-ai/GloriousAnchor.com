#!/usr/bin/env node
// Generate the clips of a dramatised film with Google's Gemini Omni Flash video model (the Gemini API's video
// generator since Veo was retired from it in October 2026), through the Interactions API.
//
//   node scripts/drama-clips.js video-scripts/nigeria-the-lease-shots.md --list-models
//   node scripts/drama-clips.js video-scripts/nigeria-the-lease-shots.md --portraits          # one still per character
//   node scripts/drama-clips.js video-scripts/nigeria-the-lease-shots.md --shots 02-naira-note,04-pastor-speaks
//   node scripts/drama-clips.js video-scripts/nigeria-the-lease-shots.md --all [--model gemini-omni-1.2-flash]
//                             [--resolution 720p|1080p] [--no-refs] [--dry-run] [--force]
//
// The shot list is Markdown: a `style:` line and a `negative:` line, a "## Characters" list of `- **id**: description`,
// then one `### id` block per clip with `chars:`, `seconds:` and an optional `narration:` line, followed by the prompt.
// Portraits go to .video-work/drama/portraits/<char>.png and clips to .video-work/drama/clips/<id>.mp4 (both gitignored).
//
// The API key is never read from the shot list. In a cloud session the network proxy adds the x-goog-api-key header
// for generativelanguage.googleapis.com; elsewhere set GEMINI_API_KEY.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const WORK = path.join(process.cwd(), '.video-work', 'drama');
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

function headers(extra = {}) {
  const h = { 'content-type': 'application/json', ...extra };
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (key) h['x-goog-api-key'] = key;
  return h;
}

async function api(method, p, body) {
  const res = await fetch(p.startsWith('http') ? p : `${API}/${p}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 1500)}`);
  return json;
}

export function parseShots(md) {
  const style = (md.match(/^style:\s*(.+)$/m) || [])[1] || '';
  const negative = (md.match(/^negative:\s*(.+)$/m) || [])[1] || '';
  const chars = {};
  const charBlock = (md.split(/^## Characters\s*$/m)[1] || '').split(/^---\s*$/m)[0];
  const bases = {}; // a later look of the same person, drawn from the earlier portrait so the face stays the same
  for (const m of charBlock.matchAll(/^- \*\*([\w-]+)\*\*(?:\s*\(from ([\w-]+)\))?:\s*(.+)$/gm)) { chars[m[1]] = m[3].trim(); if (m[2]) bases[m[1]] = m[2]; }
  const shots = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const lines = block.split('\n');
    const id = lines.shift().trim();
    const shot = { id, chars: [], seconds: 8, narration: '', prompt: '' };
    const body = [];
    for (const line of lines) {
      const m = line.match(/^(chars|seconds|narration|trim):\s*(.*)$/);
      if (m && !body.length) {
        if (m[1] === 'chars') shot.chars = m[2].split(',').map(s => s.trim()).filter(Boolean);
        else if (m[1] === 'seconds') shot.seconds = Number(m[2]) || 8;
        else if (m[1] === 'trim') shot.trim = Number(m[2]) || 0; // use only the clip's first N seconds (the model sometimes adds stray words after the line)
        else shot.narration = m[2].trim();
      } else if (line.trim() || body.length) body.push(line);
    }
    shot.prompt = body.join('\n').trim();
    if (shot.prompt) shots.push(shot);
  }
  return { style, negative, chars, bases, shots };
}

async function listModels() {
  const out = await api('GET', 'models?pageSize=200');
  console.log(`${(out.models || []).length} models visible to this key`);
  for (const m of out.models || []) {
    const n = m.name.replace('models/', '');
    const methods = m.supportedGenerationMethods || [];
    if (/omni|veo|video|image/i.test(n) || flag('verbose')) console.log(n.padEnd(44), methods.join(','));
  }
}

async function pickModel(kind) {
  const out = await api('GET', 'models?pageSize=200');
  const names = (out.models || []).map(m => m.name.replace('models/', ''));
  const prefs = kind === 'veo' ? [/^gemini-omni-[\d.]+-flash$/, /omni/] : [/^gemini-3\.1-flash-image$/, /^gemini-3-pro-image$/, /flash-image$/, /image-preview$/, /image/];
  for (const re of prefs) { const hit = names.find(n => re.test(n) && !/exp/.test(n)); if (hit) return hit; }
  throw new Error(`no ${kind} model available to this key; run --list-models`);
}


async function portraits(spec) {
  const dir = path.join(WORK, 'portraits'); fs.mkdirSync(dir, { recursive: true });
  const model = opt('image-model') || (flag('dry-run') ? '(chosen at run time)' : await pickModel('image'));
  console.log(`portraits with ${model}`);
  for (const [id, desc] of Object.entries(spec.chars)) {
    const out = path.join(dir, `${id}.png`);
    if (fs.existsSync(out) && !flag('force')) { console.log(`  ${id}: exists`); continue; }
    const base = spec.bases?.[id], basePng = base ? path.join(dir, `${base}.png`) : null;
    if (base && !fs.existsSync(basePng)) { console.log(`  ${id}: needs the portrait of ${base} first`); continue; }
    const prompt = base
      ? `The attached image is the reference portrait of a film character. Make a new photorealistic reference portrait of the SAME person: the same face, bone structure, skin tone and features, instantly recognisable as the same individual. Change only what follows. ${desc}. Head and shoulders, neutral expression, facing camera, plain mid-grey background, soft studio light, 35mm film look. No text, no watermark.`
      : `Photorealistic character reference portrait for a film, head and shoulders, neutral expression, facing camera, plain mid-grey background, soft studio light, 35mm film look. ${desc}. No text, no watermark.`;
    if (flag('dry-run')) { console.log(`  ${id}: ${prompt}`); continue; }
    const res = await api('POST', `models/${model}:generateContent`, {
      contents: [{ parts: [...(base ? [{ inline_data: { mime_type: 'image/png', data: fs.readFileSync(basePng).toString('base64') } }] : []), { text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    const part = (res.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
    if (!part) { console.log(`  ${id}: no image in answer: ${JSON.stringify(res).slice(0, 400)}`); continue; }
    fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
    console.log(`  ${id}: ${out}`);
  }
}

function refsFor(shot) {
  // Omni takes up to 6 reference images, at most 2 characters: one portrait each for the first two characters.
  if (flag('no-refs')) return [];
  return shot.chars.slice(0, 2).map(c => {
    const p = path.join(WORK, 'portraits', `${c}.png`);
    if (!fs.existsSync(p)) { console.log(`  (no portrait for ${c}; run --portraits)`); return null; }
    return { id: c, part: { type: 'image', data: fs.readFileSync(p).toString('base64'), mime_type: 'image/png' } };
  }).filter(Boolean);
}

// A POST with no socket timeout: Omni answers synchronously and a 1080p clip can take several minutes.
function postLong(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(`${API}/${p}`);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { ...headers(), 'content-length': Buffer.byteLength(data) } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', d => text += d);
      res.on('end', () => {
        let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
        if (res.statusCode >= 300) reject(new Error(`POST ${p} -> ${res.statusCode}: ${text.slice(0, 1500)}`)); else resolve(json);
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

function findVideo(res) {
  if (res.output_video) return res.output_video;
  for (const step of res.steps || []) for (const c of step.content || []) if (c.type === 'video') return c;
  return null;
}

async function download(uri, out) {
  // uri is "files/<id>" or a full URL to that file. A clip that has been generated has been paid for, so a server error
  // while fetching it is retried patiently instead of giving the clip up.
  const name = uri.startsWith('http') ? (uri.match(/files\/[^/:?]+/) || [uri])[0] : uri.replace(/^\/+/, '');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0, errors = 0; i < 120; i++) {
    let f;
    try { f = await api('GET', name); } catch (e) { if (++errors > 6) break; await wait(10000); continue; } // then try the download anyway
    if (f.state === 'ACTIVE' || !f.state) break;
    if (f.state === 'FAILED') throw new Error(`file ${name} failed`);
    await wait(5000);
  }
  const urls = [uri.startsWith('http') ? uri : null, `${API}/${name}:download?alt=media`, `${API}/download/${name}:download?alt=media`].filter(Boolean);
  let last;
  for (let attempt = 1; attempt <= 8; attempt++) {
    for (const u of urls) {
      let res;
      try { res = await fetch(u, { headers: headers(), redirect: 'follow' }); } catch (e) { last = `${u} -> ${e.message}`; continue; }
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 100000) { fs.writeFileSync(out, buf); return; }
        last = `${u} -> only ${buf.length} bytes`; continue;
      }
      last = `${u} -> ${res.status} ${(await res.text()).slice(0, 200)}`;
    }
    await wait(15000);
  }
  throw new Error(`download failed after retries (the clip exists as ${name}; fetch it later with --fetch ${name}:<shot>): ${last}`);
}

// --recover: download every video the Files API still holds (generated clips are stored for a while) as recovered-N.mp4.
async function recover() {
  const dir = path.join(WORK, 'clips'); fs.mkdirSync(dir, { recursive: true });
  const out = await api('GET', 'files?pageSize=100');
  const files = (out.files || []).filter(f => /video/.test(f.mimeType || ''));
  console.log(`${(out.files || []).length} files, ${files.length} videos`);
  let n = 0;
  for (const f of files) {
    console.log(`  ${f.name} ${f.mimeType} ${f.sizeBytes || ''} ${f.createTime || ''} ${f.displayName || ''} ${f.uri || ''}`);
    const dest = path.join(dir, `recovered-${++n}.mp4`);
    try { await download(f.uri || f.name, dest); console.log(`    -> ${dest}`); } catch (e) { console.log(`    ${e.message}`); }
  }
}

async function generate(spec, ids) {
  const dir = path.join(WORK, 'clips'); fs.mkdirSync(dir, { recursive: true });
  const model = opt('model', 'gemini-omni-1.2-flash');
  const resolution = opt('resolution', '1080p');
  console.log(`clips with ${model} at ${resolution}`);
  const todo = spec.shots.filter(s => ids === 'all' || ids.includes(s.id));
  let failures = 0;
  // A run states what it is about to spend and refuses to start beyond its budget (seconds of video; --budget N).
  const pending = todo.filter(s => flag('force') || !fs.existsSync(path.join(dir, `${s.id}.mp4`)));
  const planned = pending.reduce((n, s) => n + s.seconds, 0), budget = Number(opt('budget', 60));
  console.log(`to generate: ${pending.length} clip(s), ${planned} s of video${pending.length ? ` (${pending.map(s => `${s.id} ${s.seconds}s`).join(', ')})` : ''}; budget ${budget} s`);
  if (planned > budget && !flag('dry-run')) { console.log(`NOT generating: ${planned} s is over the budget of ${budget} s. Pass --budget ${planned} to allow it.`); process.exitCode = 1; return; }
  for (const shot of todo) {
    const out = path.join(dir, `${shot.id}.mp4`);
    if (fs.existsSync(out) && !flag('force')) { console.log(`${shot.id}: exists`); continue; }
    // Never generate a shot whose characters' portraits are missing: the faces would be invented afresh.
    const lacking = flag('no-refs') ? [] : shot.chars.slice(0, 2).filter(ch => !fs.existsSync(path.join(WORK, 'portraits', `${ch}.png`)));
    if (lacking.length) { failures++; console.log(`${shot.id}: NOT generated, no portrait for ${lacking.join(', ')} (run --portraits first)`); continue; }
    const refs = refsFor(shot);
    const cast = shot.chars.map(c => spec.chars[c]).filter(Boolean).join(' ');
    const refNote = refs.length ? `\n\nThe reference image${refs.length > 1 ? 's show' : ' shows'} ${refs.map((r, i) => `${i === 0 ? 'first' : 'second'}: ${spec.chars[r.id].split(',')[0]}`).join('; ')}. Keep their faces, build and clothing exactly as shown.` : '';
    const prompt = `${spec.style} One continuous shot, no cuts.\n\n${shot.prompt}${cast ? `\n\nThe people: ${cast}` : ''}${refNote}\n\nDo not include: ${spec.negative}.`;
    const body = {
      model,
      input: [...refs.map(r => r.part), { type: 'text', text: prompt }],
      response_format: { type: 'video', aspect_ratio: '16:9', resolution, duration: `${shot.seconds}s`, delivery: 'uri' },
      background: false, store: true, stream: false,
    };
    if (flag('dry-run')) { console.log(`${shot.id}: ${refs.length} refs\n${prompt}\n`); continue; }
    process.stdout.write(`${shot.id}: generating (${refs.length} refs)... `);
    const started = Date.now();
    try {
      const res = await postLong('interactions', body);
      const v = findVideo(res);
      if (!v) { failures++; console.log(`no video: status ${res.status}; ${JSON.stringify(res).slice(0, 800)}`); continue; }
      console.log(`video: ${JSON.stringify({ ...v, data: v.data ? `${v.data.length} chars` : undefined })}`);
      if (v.data) fs.writeFileSync(out, Buffer.from(v.data, 'base64')); else await download(v.uri, out);
      console.log(`${path.relative(process.cwd(), out)} (${Math.round(fs.statSync(out).size / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s)`);
    } catch (e) { failures++; console.log(`failed: ${e.message.slice(0, 1200)}`); }
  }
  if (failures) { console.log(`${failures} clip(s) failed`); process.exitCode = 1; }
}

// --transcribe: ask a Gemini model to write down, for every clip with spoken lines, who says which words, and print it
// beside the scripted lines, so a line the video model handed to the wrong character is caught before assembly.
async function transcribe(spec, ids) {
  const model = opt('check-model', 'gemini-flash-latest');
  const previews = path.join(process.cwd(), 'video-scripts', 'drama', 'previews');
  const quoted = (p) => [...String(p).matchAll(/"([^"]{3,})"/g)].map((m) => m[1]);
  const todo = spec.shots.filter((s) => quoted(s.prompt).length && (ids === 'all' || ids.includes(s.id)));
  console.log(`transcribing ${todo.length} dialogue clips with ${model}`);
  for (const shot of todo) {
    const file = [path.join(previews, `${shot.id}.mp4`), path.join(WORK, 'clips', `${shot.id}.mp4`)].find((f) => fs.existsSync(f) && fs.statSync(f).size < 14 * 1024 * 1024);
    if (!file) { console.log(`\n== ${shot.id}: no clip small enough to send`); continue; }
    const body = { contents: [{ parts: [
      { inline_data: { mime_type: 'video/mp4', data: fs.readFileSync(file).toString('base64') } },
      { text: 'Watch and listen to this short film clip. List every spoken utterance in order. For each one give: who speaks, described by what is seen (for example "man in white agbada and cap", "woman in blue headwrap", "boy in striped T-shirt", "off-screen voice"), judged by whose lips move and by the voice; whether the voice is male, female or a child; and the exact words. Give the start and the end of each utterance in seconds to one decimal place. One utterance per line, in the form: [start-end] SPEAKER (voice): "words". Do not add commentary.' },
    ] }], generationConfig: { temperature: 0 } };
    try {
      const res = await api('POST', `models/${model}:generateContent`, body);
      const text = (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      console.log(`\n== ${shot.id}\n  script: ${quoted(shot.prompt).map((q) => `"${q}"`).join(' / ')}\n${text.split('\n').map((l) => `  heard:  ${l}`).join('\n')}`);
    } catch (e) { console.log(`\n== ${shot.id}: ${e.message.slice(0, 400)}`); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!file && !flag('list-models')) { console.error('usage: node scripts/drama-clips.js <shots.md> --list-models | --portraits | --shots a,b | --all'); process.exit(2); }
  const spec = file ? parseShots(fs.readFileSync(file, 'utf8')) : null;
  try {
    if (flag('list-models')) await listModels();
    if (flag('recover')) await recover();
    if (opt('fetch')) for (const pair of opt('fetch').split(',')) { // files/abc123:08-old-note-v2 — a clip that was generated but failed to download
      const k = pair.lastIndexOf(':'); const file = pair.slice(0, k), to = path.join(WORK, 'clips', `${pair.slice(k + 1)}.mp4`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try { await download(file, to); console.log(`fetched ${file} -> ${path.relative(process.cwd(), to)} (${Math.round(fs.statSync(to).size / 1024)} KB)`); } catch (e) { console.log(`fetch ${file} failed: ${e.message.slice(0, 300)}`); process.exitCode = 1; }
    }
    if (flag('transcribe')) await transcribe(spec, opt('shots') ? opt('shots').split(',').map(s => s.trim()) : 'all');
    if (opt('rename')) for (const pair of opt('rename').split(',')) { // recovered-3:02-naira-note
      const [from, to] = pair.split(':'); const a = path.join(WORK, 'clips', `${from}.mp4`), b = path.join(WORK, 'clips', `${to}.mp4`);
      if (fs.existsSync(a)) { fs.renameSync(a, b); console.log(`renamed ${from} -> ${to}`); } else console.log(`no ${from} to rename`);
    }
    if (flag('portraits')) await portraits(spec);
    if (flag('transcribe')) { /* checking only */ }
    else if (flag('all')) await generate(spec, 'all');
    else if (opt('shots')) await generate(spec, opt('shots').split(',').map(s => s.trim()));
    else if (!flag('list-models') && !flag('portraits') && !flag('recover') && !opt('rename')) { console.log(`${spec.shots.length} shots, ${Object.keys(spec.chars).length} characters; total ${spec.shots.reduce((a, s) => a + s.seconds, 0)} s`); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
