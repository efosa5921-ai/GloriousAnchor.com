#!/usr/bin/env node
// Generate the clips of a dramatised film with Google's Gemini Omni Flash video model (the Gemini API's video
// generator since Veo was retired from it in October 2026), through the Interactions API.
//
//   node scripts/drama-clips.js video-scripts/festac-77-drama-shots.md --list-models
//   node scripts/drama-clips.js video-scripts/festac-77-drama-shots.md --portraits          # one still per character
//   node scripts/drama-clips.js video-scripts/festac-77-drama-shots.md --shots 02-naira-note,04-pastor-speaks
//   node scripts/drama-clips.js video-scripts/festac-77-drama-shots.md --all [--model gemini-omni-1.2-flash]
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
  for (const m of charBlock.matchAll(/^- \*\*([\w-]+)\*\*:\s*(.+)$/gm)) chars[m[1]] = m[2].trim();
  const shots = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const lines = block.split('\n');
    const id = lines.shift().trim();
    const shot = { id, chars: [], seconds: 8, narration: '', prompt: '' };
    const body = [];
    for (const line of lines) {
      const m = line.match(/^(chars|seconds|narration):\s*(.*)$/);
      if (m && !body.length) {
        if (m[1] === 'chars') shot.chars = m[2].split(',').map(s => s.trim()).filter(Boolean);
        else if (m[1] === 'seconds') shot.seconds = Number(m[2]) || 8;
        else shot.narration = m[2].trim();
      } else if (line.trim() || body.length) body.push(line);
    }
    shot.prompt = body.join('\n').trim();
    if (shot.prompt) shots.push(shot);
  }
  return { style, negative, chars, shots };
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
    const prompt = `Photorealistic character reference portrait for a film, head and shoulders, neutral expression, facing camera, plain mid-grey background, soft studio light, 35mm film look. ${desc}. No text, no watermark.`;
    if (flag('dry-run')) { console.log(`  ${id}: ${prompt}`); continue; }
    const res = await api('POST', `models/${model}:generateContent`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    const part = (res.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
    if (!part) { console.log(`  ${id}: no image in answer: ${JSON.stringify(res).slice(0, 400)}`); continue; }
    fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
    console.log(`  ${id}: ${out}`);
  }
}

function refsFor(shot) {
  if (flag('no-refs')) return [];
  return shot.chars.slice(0, 3).map(c => {
    const p = path.join(WORK, 'portraits', `${c}.png`);
    if (!fs.existsSync(p)) { console.log(`  (no portrait for ${c}; run --portraits)`); return null; }
    return { image: { bytesBase64Encoded: fs.readFileSync(p).toString('base64'), mimeType: 'image/png' }, referenceType: 'asset' };
  }).filter(Boolean);
}

async function download(uri, out) {
  const res = await fetch(uri, { headers: headers(), redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${res.status}: ${(await res.text()).slice(0, 300)}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

async function generate(spec, ids) {
  const dir = path.join(WORK, 'clips'); fs.mkdirSync(dir, { recursive: true });
  let model = opt('model') || (flag('dry-run') ? '(chosen at run time)' : await pickModel('veo'));
  let candidates = model ? [model] : VEO_CANDIDATES;
  const resolution = opt('resolution', '1080p');
  console.log(`clips with ${model || candidates.join(' | ')} at ${resolution}`);
  const todo = spec.shots.filter(s => ids === 'all' || ids.includes(s.id));
  for (const shot of todo) {
    const out = path.join(dir, `${shot.id}.mp4`);
    if (fs.existsSync(out) && !flag('force')) { console.log(`${shot.id}: exists`); continue; }
    const cast = shot.chars.map(c => spec.chars[c]).filter(Boolean).join(' ');
    const prompt = `${spec.style}\n\n${shot.prompt}${cast ? `\n\nThe people: ${cast}` : ''}`;
    const refs = refsFor(shot);
    const body = {
      instances: [{ prompt, ...(refs.length ? { referenceImages: refs } : {}) }],
      parameters: { aspectRatio: '16:9', resolution, durationSeconds: shot.seconds, negativePrompt: spec.negative,
        personGeneration: refs.length ? 'allow_adult' : 'allow_all' },
    };
    if (flag('dry-run')) { console.log(`${shot.id}: ${refs.length} refs\n${prompt}\n`); continue; }
    process.stdout.write(`${shot.id}: submitting (${refs.length} refs)... `);
    const submit = async () => {
      let lastErr;
      for (const m of candidates) {
        try { const op = await api('POST', `models/${m}:predictLongRunning`, body); model = m; candidates = [m]; return op; }
        catch (e) { lastErr = e; if (/404|NOT_FOUND|not found|not supported/i.test(e.message) && candidates.length > 1) { console.log(`\n  ${m}: not available`); continue; } throw e; }
      }
      throw lastErr;
    };
    let op;
    try { op = await submit(); }
    catch (e) {
      if (refs.length && /reference/i.test(e.message)) {
        console.log('reference images refused; retrying without');
        delete body.instances[0].referenceImages; body.parameters.personGeneration = 'allow_all';
        op = await submit();
      } else throw e;
    }
    process.stdout.write(`${model} `);
    const started = Date.now();
    while (!op.done) {
      await new Promise(r => setTimeout(r, 10000));
      op = await api('GET', op.name);
      if (Date.now() - started > 15 * 60 * 1000) throw new Error(`${shot.id}: timed out`);
    }
    if (op.error) { console.log(`failed: ${JSON.stringify(op.error)}`); continue; }
    const r = op.response || {};
    const sample = r.generateVideoResponse?.generatedSamples?.[0] || r.generatedVideos?.[0] || r.videos?.[0];
    const uri = sample?.video?.uri || sample?.uri;
    if (!uri) { console.log(`no video: ${JSON.stringify(r).slice(0, 600)}`); continue; }
    await download(uri, out);
    console.log(`${out} (${Math.round(fs.statSync(out).size / 1024)} KB, ${Math.round((Date.now() - started) / 1000)} s)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!file && !flag('list-models')) { console.error('usage: node scripts/drama-clips.js <shots.md> --list-models | --portraits | --shots a,b | --all'); process.exit(2); }
  const spec = file ? parseShots(fs.readFileSync(file, 'utf8')) : null;
  try {
    if (flag('list-models')) await listModels();
    if (flag('portraits')) await portraits(spec);
    if (flag('all')) await generate(spec, 'all');
    else if (opt('shots')) await generate(spec, opt('shots').split(',').map(s => s.trim()));
    else if (!flag('list-models') && !flag('portraits')) { console.log(`${spec.shots.length} shots, ${Object.keys(spec.chars).length} characters; total ${spec.shots.reduce((a, s) => a + s.seconds, 0)} s`); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
