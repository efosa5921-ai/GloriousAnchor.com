/**
 * Our own articles: Markdown files in articles/ become pages on the site, cards on the front page,
 * and an RSS feed at /articles/feed.xml.
 *
 * A file looks like:
 *   ---
 *   title: Why we started Glorious Anchor
 *   date: 2026-10-15
 *   author: The Glorious Anchor team
 *   summary: One or two sentences shown on the card.
 *   image: images/anchor-sunrise.jpg        (a file in articles/images/, or a full URL; optional)
 *   pinned: true                            (optional: lead the front page)
 *   draft: true                             (optional: build ignores the file)
 *   ---
 *   Body in Markdown. **Bold**, *italic*, headings, lists, links, images, quotes.
 */
import { marked } from 'marked';
import { stripHtml, truncate, makeId } from './articles.js';
import { articleJsonLd, metaTags } from './seo.js';

export const OWN_SOURCE = { id: 'ours', name: 'Glorious Anchor', category: 'ours', kind: 'article', featured: true, homepage: '/articles/' };

export function parseFrontMatter(text) {
  const m = String(text).replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: String(text) };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    meta[kv[1].toLowerCase()] = v;
  }
  return { meta, body: m[2] };
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';
}

export function slugFromFilename(name) {
  return slugify(name.replace(/\.(md|markdown)$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
}

function parseDate(meta, filename) {
  const raw = meta.date || (filename.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!raw) return null;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Turn one Markdown file into a post object (or null for drafts/invalid files). */
export function compilePost(filename, text, site) {
  const { meta, body } = parseFrontMatter(text);
  if (meta.draft === true) return null;
  const html = marked.parse(body, { gfm: true, breaks: false });
  const title = stripHtml(meta.title || (body.match(/^#\s+(.+)$/m) || [])[1] || '');
  if (!title) return null;
  const slug = meta.slug ? slugify(meta.slug) : slugFromFilename(filename);
  const publishedAt = parseDate(meta, filename) ?? Date.now();
  const text_ = stripHtml(html);
  const summary = stripHtml(meta.summary || '') || truncate(text_, 200);
  let image = meta.image ? String(meta.image) : null;
  if (image && !/^https?:\/\//i.test(image)) image = `${site.url.replace(/\/$/, '')}/articles/${image.replace(/^\/?(articles\/)?/, '')}`;
  const words = text_.split(/\s+/).filter(Boolean).length;
  return {
    slug, title, html, summary, image,
    author: stripHtml(meta.author || site.name),
    publishedAt,
    pinned: meta.pinned === true,
    readingMinutes: Math.max(1, Math.round(words / 220)),
    url: `${site.url.replace(/\/$/, '')}/articles/${slug}/`,
    path: `articles/${slug}/index.html`,
  };
}

/** The aggregator card for a post. */
export function postToArticle(post) {
  return {
    id: makeId(post.url, post.title),
    title: post.title,
    url: post.url,
    summary: post.summary,
    image: post.image,
    author: post.author,
    publishedAt: post.publishedAt,
    kind: 'article',
    source: OWN_SOURCE.name,
    sourceId: OWN_SOURCE.id,
    sourceHome: OWN_SOURCE.homepage,
    category: OWN_SOURCE.category,
    featured: true,
    pinned: post.pinned,
    internal: true,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** Fill the article page template. Placeholders: {{title}} {{description}} {{url}} {{image}} {{author}} {{date}} {{isoDate}} {{minutes}} {{body}} {{more}} {{site}} {{verse}} */
export function renderPostPage(template, post, site, others) {
  const more = others.filter((p) => p.slug !== post.slug).slice(0, 4)
    .map((p) => `<li><a href="../${esc(p.slug)}/">${esc(p.title)}</a> <span class="muted">${esc(fmtDate(p.publishedAt))}</span></li>`).join('');
  const vars = {
    title: esc(post.title), description: esc(post.summary), url: esc(post.url), image: esc(post.image || ''),
    author: esc(post.author), date: esc(fmtDate(post.publishedAt)), isoDate: new Date(post.publishedAt).toISOString(),
    minutes: String(post.readingMinutes), body: post.html, more: more ? `<ul class="article__more">${more}</ul>` : '',
    site: esc(site.name), verse: esc(site.verse || ''),
    hero: post.image ? `<img class="article__hero" src="${esc(post.image)}" alt="">` : '',
    meta: metaTags({ title: post.title, description: post.summary, url: post.url, image: post.image || `${site.url.replace(/\/$/, '')}/assets/social.jpg`, type: 'article', site }),
    jsonld: articleJsonLd(post, site),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export function renderIndexPage(template, posts, site) {
  const items = posts.map((p) => `<li class="article-list__item"><a href="./${esc(p.slug)}/"><h2>${esc(p.title)}</h2></a><p class="muted">${esc(p.author)} · ${esc(fmtDate(p.publishedAt))} · ${p.readingMinutes} min read</p><p>${esc(p.summary)}</p></li>`).join('');
  const body = `<h1 class="article-list__title">Articles from ${esc(site.name)}</h1><ul class="article-list">${items || '<li>Nothing published yet.</li>'}</ul>`;
  const vars = { title: `Articles from ${esc(site.name)}`, description: esc(`Original articles from ${site.name}.`), url: esc(`${site.url.replace(/\/$/, '')}/articles/`),
    author: '', date: '', isoDate: '', minutes: '', body, more: '', site: esc(site.name), verse: esc(site.verse || ''), hero: '', image: '',
    meta: metaTags({ title: `Articles from ${site.name}`, description: `Original articles from ${site.name}.`, url: `${site.url.replace(/\/$/, '')}/articles/`, image: `${site.url.replace(/\/$/, '')}/assets/social.jpg`, site }), jsonld: '' };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export function renderFeed(posts, site) {
  const base = site.url.replace(/\/$/, '');
  const items = posts.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(p.url)}</link>
      <guid isPermaLink="true">${esc(p.url)}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <dc:creator>${esc(p.author)}</dc:creator>
      <description>${esc(p.summary)}</description>${p.image ? `\n      <enclosure url="${esc(p.image)}" type="image/jpeg" length="0"/>` : ''}
      <content:encoded><![CDATA[${p.html.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)} — Articles</title>
    <link>${esc(base)}/articles/</link>
    <atom:link href="${esc(base)}/articles/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(`Original articles from ${site.name}.`)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
