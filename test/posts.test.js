import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter, slugFromFilename, compilePost, postToArticle, renderPostPage, renderFeed, seoWarnings } from '../scripts/lib/posts.js';

const site = { name: 'Glorious Anchor', url: 'https://gloriousanchor.com', verse: 'Hebrews 6:19' };

test('parseFrontMatter reads key: value pairs and leaves the body', () => {
  const { meta, body } = parseFrontMatter('---\ntitle: "Hello & welcome"\ndate: 2026-10-15\npinned: true\n---\n# Heading\n\nText.');
  assert.deepEqual(meta, { title: 'Hello & welcome', date: '2026-10-15', pinned: true });
  assert.equal(body, '# Heading\n\nText.');
  assert.deepEqual(parseFrontMatter('no front matter').meta, {});
});

test('slugFromFilename drops the date prefix and extension', () => {
  assert.equal(slugFromFilename('2026-10-15-Why We Started!.md'), 'why-we-started');
  assert.equal(slugFromFilename('hello.markdown'), 'hello');
});

test('compilePost renders markdown, derives metadata and skips drafts', () => {
  const p = compilePost('2026-10-15-welcome.md', '---\ntitle: Welcome\nauthor: Team\nimage: images/a.jpg\n---\nFirst **para**.\n\n## Section\n\nMore.', site);
  assert.equal(p.slug, 'welcome');
  assert.equal(p.url, 'https://gloriousanchor.com/articles/welcome/');
  assert.equal(p.image, 'https://gloriousanchor.com/articles/images/a.jpg');
  assert.ok(p.html.includes('<strong>para</strong>'));
  assert.equal(p.summary, 'First para. Section More.');
  assert.equal(p.publishedAt, Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(p.author, 'Team');
  const d = compilePost('2026-10-19-x.md', '---\ndraft: true\ntitle: X\n---\nbody', site);
  assert.equal(d.draft, true); assert.equal(d.url, 'https://gloriousanchor.com/drafts/x/'); assert.equal(d.path, 'drafts/x/index.html');
  const dp = renderPostPage('{{robots}}|{{draftBanner}}|{{share}}', d, site, []);
  assert.match(dp, /noindex/); assert.match(dp, /Draft preview/); assert.doesNotMatch(dp, /sharebar/);
  const k = compilePost('2026-10-19-k.md', '---\ntitle: K\nkeywords: seven spirits of God, Isaiah 11:2\nupdated: 2026-10-21\n---\nbody', site);
  assert.deepEqual(k.keywords, ['seven spirits of God', 'Isaiah 11:2']); assert.equal(k.updatedAt, Date.parse('2026-10-21T12:00:00Z'));
  assert.match(renderPostPage('{{jsonld}}', k, site, [k]), /"keywords":"seven spirits of God, Isaiah 11:2".*"dateModified":"2026-10-21T12:00:00.000Z"|"dateModified":"2026-10-21T12:00:00.000Z".*"keywords":"seven spirits of God, Isaiah 11:2"/);
  const c = compilePost('2026-10-19-c.md', '---\ntitle: C\ncategories: eschatology, pitn, ours, eschatology\n---\nbody', site);
  assert.deepEqual(c.categories, ['eschatology', 'pitn']);
  assert.deepEqual(postToArticle(c, site).categories, ['ours', 'eschatology', 'pitn']);
  assert.equal(compilePost('2026-10-19-d.md', '---\ntitle: D\n---\nbody', site).categories, undefined);
  assert.equal(compilePost('x.md', 'no title anywhere', site), null);
  assert.equal(compilePost('x.md', '# From heading\n\nbody', site).title, 'From heading', 'title falls back to first heading');
  const card = postToArticle(p);
  assert.equal(card.sourceId, 'ours'); assert.equal(card.internal, true); assert.equal(card.kind, 'article');
});

test('renderPostPage and renderFeed escape text and include the essentials', () => {
  const p = compilePost('2026-10-15-a.md', '---\ntitle: A <b>title</b> & more\nsummary: Sum "quoted"\n---\nBody', site);
  const q = compilePost('2026-10-14-b.md', '---\ntitle: Other\n---\nBody', site);
  const html = renderPostPage('<title>{{title}}</title>{{body}}{{more}}', p, site, [p, q]);
  const withPic = compilePost('2026-10-15-c.md', '---\ntitle: Welcome\nimage: images/a.jpg\n---\nBody', site);
  assert.match(renderPostPage('{{hero}}', withPic, site, [withPic]), /class="article__hero"[^>]*alt="Welcome"/);
  const withShare = renderPostPage('{{share}}', p, site, [p]);
  assert.match(withShare, /class="sharebar"/); assert.match(withShare, /wa\.me\/\?text=/); assert.match(withShare, /data-copy/);
  assert.match(withShare, /data-copy-post/); assert.match(withShare, /data-post="A title &amp; more\n\nSum &quot;quoted&quot;\n\nhttps:/, 'Copy post carries headline, summary and link');
  assert.ok(html.includes('<title>A title &amp; more</title>'));
  assert.ok(html.includes('<p>Body</p>'));
  assert.ok(html.includes('href="../b/"'), 'links to the other post by slug');
  const xml = renderFeed([p, q], site);
  assert.ok(xml.includes('<title>A title &amp; more</title>'));
  assert.ok(xml.includes('<link>https://gloriousanchor.com/articles/a/</link>'));
  assert.ok(xml.includes('<![CDATA[<p>Body</p>'));
});

test('searchTitle drives the tab and meta title while the heading keeps the full title; seoWarnings flags gaps', () => {
  const long = compilePost('2026-10-18-noah.md', '---\ntitle: How did Noah inform people from Africa, Japan, Europe and America about the great flood and Ark?\nsearchTitle: How Did Noah Warn the Whole World About the Flood?\nsummary: ' + 'x'.repeat(140) + '\nkeywords: Noah, flood\nimage: images/n.jpg\n---\n' + 'word '.repeat(350), site);
  const page = renderPostPage('<title>{{pageTitle}}</title><h1>{{title}}</h1>{{meta}}', long, site, [long]);
  assert.match(page, /<title>How Did Noah Warn the Whole World About the Flood\?<\/title>/);
  assert.match(page, /<h1>How did Noah inform people/);
  assert.match(page, /og:title" content="How Did Noah Warn the Whole World About the Flood\?"/);
  assert.deepEqual(seoWarnings(long), []);
  const bare = compilePost('2026-10-18-b.md', '---\ntitle: ' + 'T'.repeat(70) + '\nsummary: short\n---\nfew words', site);
  const w = seoWarnings(bare).join(' | ');
  assert.match(w, /under 65/); assert.match(w, /only 5 characters/); assert.match(w, /no keywords/); assert.match(w, /no picture/); assert.match(w, /words/);
});
