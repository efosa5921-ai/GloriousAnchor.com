#!/usr/bin/env node
/** Reads dist/data/health.json and emits an alert summary for the workflow (GITHUB_OUTPUT) and the console. */
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { failingSources, alertBody } from './lib/health.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const threshold = Number(args[args.indexOf('--threshold') + 1]) || 3;

const health = JSON.parse(await readFile(path.join(ROOT, 'dist/data/health.json'), 'utf8').catch(() => '{}'));
const meta = JSON.parse(await readFile(path.join(ROOT, 'dist/data/meta.json'), 'utf8').catch(() => '{}'));
const failing = failingSources(health, threshold);
const body = failing.length ? alertBody(failing, meta.site?.name) : '';

console.log(failing.length ? `⚠ ${failing.length} source(s) failing ${threshold}+ builds in a row:` : `✓ No source has failed ${threshold}+ builds in a row.`);
for (const f of failing) console.log(`  - ${f.id}: ${f.failures} builds, ${f.error}`);

if (process.env.GITHUB_OUTPUT) {
  const delim = `EOF_${Date.now()}`;
  await appendFile(process.env.GITHUB_OUTPUT, `alert=${failing.length ? 'true' : 'false'}\ncount=${failing.length}\nbody<<${delim}\n${body}\n${delim}\n`);
}
