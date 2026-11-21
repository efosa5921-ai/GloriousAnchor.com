#!/usr/bin/env node
// Makes cinematic cover illustrations for articles with Google's image model (cover-art/prompts.json).
//   node scripts/cover-art.js --names gods-jubilee,noah-ark [--max 4] [--size 2K] [--dry-run]
// Writes .cover-work/<name>.jpg. Only the names asked for are made, never more than --max in one run (default 4),
// so a run cannot spend more than a few cents by accident. The key is GEMINI_API_KEY.
// Illustrations are for teaching and Bible subjects; reports of real events and people keep real photographs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.cover-work');
const API = 'https://generativelanguage.googleapis.com/v1beta/';
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = name => argv.includes(`--${name}`);

async function post(pathname, body) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(API + pathname, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

// The image, wherever the answer carries it: {type:'image', data}, {inlineData:{data}} or {inline_data:{data}}.
export function findImage(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const hit = findImage(n); if (hit) return hit; } return null; }
  const inline = node.inlineData || node.inline_data;
  if (inline && typeof inline.data === 'string' && inline.data.length > 1000) return inline.data;
  if (typeof node.data === 'string' && node.data.length > 1000 && (node.type === 'image' || /^image\//.test(node.mime_type || node.mimeType || ''))) return node.data;
  for (const v of Object.values(node)) { const hit = findImage(v); if (hit) return hit; }
  return null;
}

async function make(prompt, size) {
  // 1. The Interactions API with the current image model (the cheaper of the two).
  const tries = [
    ['interactions (gemini-nano-banana-2.1)', () => post('interactions', {
      model: 'gemini-nano-banana-2.1', input: prompt,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: size },
    })],
    // 2. The model and call the film's portraits were made with.
    ['generateContent (gemini-3.1-flash-image)', () => post('models/gemini-3.1-flash-image:generateContent', {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: size } },
    })],
  ];
  for (const [label, call] of tries) {
    const res = await call();
    const data = res.status === 200 ? findImage(res.json) : null;
    if (data) return { label, data };
    console.log(`    ${label}: ${res.status} ${res.text.replace(/"data":\s*"[^"]{200,}"/g, '"data":"…"').slice(0, 500)}`);
    if (res.status === 402 || res.status === 429) throw new Error(`stopped: ${res.status} (credits or daily limit)`);
  }
  return null;
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'cover-art', 'prompts.json'), 'utf8'));
  const names = (opt('names') || '').split(',').map(s => s.trim()).filter(Boolean);
  const max = Number(opt('max') || 4), size = opt('size') || '2K';
  if (!names.length) { console.log(`names: ${Object.keys(spec.art).join(', ')}`); return; }
  const unknown = names.filter(n => !spec.art[n]);
  if (unknown.length) throw new Error(`no prompt for: ${unknown.join(', ')}`);
  if (names.length > max) throw new Error(`${names.length} images asked for, but --max is ${max}; nothing made`);
  fs.mkdirSync(WORK, { recursive: true });
  console.log(`to make: ${names.length} image(s) at ${size}`);
  for (const name of names) {
    const prompt = `${spec.style} ${spec.art[name]} ${spec.negative}`;
    if (flag('dry-run')) { console.log(`  ${name}: ${prompt}`); continue; }
    const hit = await make(prompt, size);
    if (!hit) { console.log(`  ${name}: NOT made`); continue; }
    const out = path.join(WORK, `${name}.jpg`);
    fs.writeFileSync(out, Buffer.from(hit.data, 'base64'));
    console.log(`  ${name}: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB) via ${hit.label}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(err => { console.error(err.message); process.exit(1); });
