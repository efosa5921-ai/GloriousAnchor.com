#!/usr/bin/env node
// Makes the downloadable mission document, src/assets/gain-mission.pdf, from the Operation GAIN article
// (articles/*operation-gain*.md): the document's own cover, then its chapters, without the site's
// question-and-answer section. Run it by hand whenever the article's text changes, and commit the PDF:
//   node scripts/mission-pdf.js
// It needs Playwright with Chromium (npm i --no-save playwright && npx playwright install chromium), which
// the site's own build does not, so the PDF is kept in the repository rather than made at build time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'assets', 'gain-mission.pdf');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The document's text: the article without its front matter, its links back into the site and its Q&A. */
export function missionBody(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const cut = [body.indexOf('\nFor what the network does online today'), body.indexOf('\n## Questions this article answers')].filter((i) => i >= 0);
  return (cut.length ? body.slice(0, Math.min(...cut)) : body).trim();
}

async function chromium() {
  for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright/index.mjs']) {
    try { const m = await import(spec); return (m.chromium || m.default.chromium); } catch { /* try the next */ }
  }
  throw new Error('Playwright is not installed: npm i --no-save playwright && npx playwright install chromium');
}

async function main() {
  const dir = path.join(ROOT, 'articles');
  const file = fs.readdirSync(dir).find((f) => /operation-gain.*\.md$/.test(f));
  if (!file) throw new Error('no articles/*operation-gain*.md');
  const md = fs.readFileSync(path.join(dir, file), 'utf8');
  const author = (md.match(/^author:\s*(.+)$/m) || [])[1] || '';
  const image = (md.match(/^image:\s*(.+)$/m) || [])[1];
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'feeds.json'), 'utf8')).site;
  const cover = image ? pathToFileURL(path.join(dir, image)).href : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The mission of ${esc(site.network || site.name)}</title><style>
@page { size: A4; margin: 24mm 22mm 22mm; }
@page :first { margin: 0; }
html { font-family: "Liberation Serif", "Times New Roman", Georgia, serif; font-size: 11.5pt; line-height: 1.55; color: #16202e; }
body { margin: 0; }
.cover { height: 297mm; width: 210mm; background: #0b1f3a; display: flex; align-items: center; justify-content: center; page-break-after: always; }
.cover img { max-width: 100%; max-height: 100%; }
.title { text-align: center; padding: 52mm 0 0; page-break-after: always; }
.title p { text-align: center; }
.title .k { font-family: "Liberation Sans", Arial, sans-serif; font-size: 10pt; letter-spacing: .28em; text-transform: uppercase; color: #a67c12; }
.title h1 { font-size: 34pt; line-height: 1.12; margin: 8mm 0 6mm; color: #0b1f3a; }
.title .sub { font-size: 15pt; font-style: italic; margin: 0 0 16mm; }
.title .by { font-size: 13pt; }
.title .motto { margin-top: 60mm; font-family: "Liberation Sans", Arial, sans-serif; font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: #5d6673; }
.title .web { font-family: "Liberation Sans", Arial, sans-serif; font-size: 10pt; color: #5d6673; margin-top: 3mm; }
h2 { font-size: 17pt; line-height: 1.25; color: #0b1f3a; margin: 9mm 0 3mm; page-break-after: avoid; border-bottom: 1px solid #c9961f; padding-bottom: 1.5mm; }
p { margin: 0 0 3.6mm; text-align: justify; orphans: 3; widows: 3; }
blockquote { margin: 4mm 0 5mm; padding: 1mm 0 1mm 6mm; border-left: 2.5pt solid #c9961f; color: #2b3646; }
blockquote p { text-align: left; }
strong { color: #0b1f3a; }
a { color: inherit; text-decoration: none; }
</style></head><body>
${cover ? `<div class="cover"><img src="${cover}" alt=""></div>` : ''}
<div class="title"><div class="k">The mission document</div><h1>Operation GAIN</h1><p class="sub">The mission of ${esc((site.network || site.name).replace(/\s*\([^)]*\)$/, ''))}</p><p class="by">${esc(author)}</p>
<p class="motto">${esc(site.motto || '')}</p><p class="web">${esc(String(site.url).replace(/^https?:\/\//, ''))}${site.contactEmail ? ` · ${esc(site.contactEmail)}` : ''}</p></div>
${marked.parse(missionBody(md))}
</body></html>`;
  const tmp = path.join(ROOT, '.mission-pdf.html');
  fs.writeFileSync(tmp, html);
  const browser = await (await chromium()).launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForLoadState('networkidle');
    await page.pdf({
      path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#777;padding:0 22mm;display:flex;justify-content:space-between"><span>${esc((site.network || site.name))}</span><span class="pageNumber"></span></div>`,
    });
  } finally { await browser.close(); fs.rmSync(tmp, { force: true }); }
  console.log(`${path.relative(ROOT, OUT)}: ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
