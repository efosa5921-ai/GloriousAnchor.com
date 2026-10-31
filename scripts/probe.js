#!/usr/bin/env node
/**
 * Diagnostic: fetch a URL the way the build does and print what came back.
 *   node scripts/probe.js https://example.com/feed/
 *   node scripts/probe.js @somehandle          (YouTube handle → shows how it resolves)
 *   node scripts/probe.js https://www.youtube.com/watch?v=ID   (prints the video's details, description and caption transcript)
 * Run it from GitHub Actions (workflow "Probe a feed") to see what a publisher serves to GitHub's IP range.
 */
import Parser from 'rss-parser';
import { channelIdFromHtml, feedLinksFromHtml, YT_FEED } from './lib/sources.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let target = process.argv[2];
if (!target) { console.error('usage: node scripts/probe.js <url | @youtubehandle | podcast:<search terms>> [more targets...]'); process.exit(1); }

// Several targets at once (space-separated, in one workflow input): one short line each, for checking a batch of
// candidate sources. A target "podcast:Some Show" looks the show up in Apple's podcast directory and prints its feed URL.
const targets = process.argv.slice(2).join(' ').split(/\s+/).filter(Boolean);
if (targets.length > 1 || targets[0].startsWith('podcast:')) {
  const brief = async (t) => {
    try {
      if (t.startsWith('podcast:')) {
        const term = t.slice(8).replace(/[+_]/g, ' ');
        const res = await fetch(`https://itunes.apple.com/search?media=podcast&limit=3&term=${encodeURIComponent(term)}`);
        const json = await res.json();
        return `${t}: ` + ((json.results || []).map((r) => `"${r.collectionName}" by ${r.artistName} → ${r.feedUrl}`).join(' | ') || 'no results');
      }
      if (t.startsWith('@')) {
        const res = await fetch(`https://www.youtube.com/${t}`, { headers: { 'User-Agent': UA } });
        const body = await res.text();
        const id = channelIdFromHtml(body);
        return `${t}: ${res.status} title="${body.match(/<title>([^<]*)<\/title>/)?.[1] || ''}" channel=${id || 'unresolved'} canonical=${body.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || ''}`;
      }
      const res = await fetch(t, { redirect: 'follow', headers: { 'User-Agent': UA } });
      const body = await res.text();
      try {
        const feed = await new Parser().parseString(body);
        return `${t}: ${res.status} FEED title="${feed.title}" items=${feed.items?.length ?? 0} latest=${feed.items?.[0]?.isoDate || feed.items?.[0]?.pubDate || ''}`;
      } catch {
        return `${t}: ${res.status} page title="${body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim().slice(0, 80) || ''}" feeds=${JSON.stringify(feedLinksFromHtml(body, t).slice(0, 4))}`;
      }
    } catch (err) { return `${t}: ERROR ${String(err.message).split('\n')[0]}`; }
  };
  for (const line of await Promise.all(targets.map(brief))) console.log(line);
  process.exit(0);
}

async function get(url) {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7', 'Accept-Encoding': 'gzip, br' } });
  const ttfb = Date.now() - t0;
  const body = await res.text();
  console.log(`\n=== ${url}`);
  console.log(`status: ${res.status} ${res.statusText}  final url: ${res.url}  ttfb: ${ttfb} ms  total: ${Date.now() - t0} ms  content-encoding: ${res.headers.get('content-encoding') || 'none'}`);
  for (const h of ['content-type', 'server', 'cf-ray', 'x-cache', 'cache-control', 'content-length']) if (res.headers.get(h)) console.log(`${h}: ${res.headers.get(h)}`);
  console.log(`body: ${body.length} chars`);
  return { res, body };
}

if (target.startsWith('@')) {
  const { body } = await get(`https://www.youtube.com/${target}`);
  const ids = {};
  for (const m of body.matchAll(/UC[0-9A-Za-z_-]{22}/g)) ids[m[0]] = (ids[m[0]] || 0) + 1;
  console.log('channel ids seen (count):', Object.entries(ids).sort((a, b) => b[1] - a[1]).slice(0, 8));
  console.log('canonical:', body.match(/<link rel="canonical" href="([^"]+)"/)?.[1]);
  console.log('<title>:', body.match(/<title>([^<]*)<\/title>/)?.[1]);
  const id = channelIdFromHtml(body);
  console.log('resolver picks:', id);
  if (id) target = YT_FEED + id; else process.exit(0);
}

const { body } = await get(target);
console.log('--- first 700 chars ---\n' + body.slice(0, 700).replace(/\s+/g, ' ') + '\n---');
// A YouTube watch page: print the video's details, description and caption transcript so a video can be checked.
if (/youtube\.com\/watch|youtu\.be\//.test(target) && body.includes('ytInitialPlayerResponse')) await youtubeDetails(body);

function jsonAfter(hay, marker) {
  const start = hay.indexOf(marker);
  if (start < 0) return null;
  let i = hay.indexOf('{', start), depth = 0, inStr = false, esc = false;
  for (let j = i; j < hay.length; j++) {
    const c = hay[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { return JSON.parse(hay.slice(i, j + 1)); } catch { return null; } }
  }
  return null;
}

async function youtubeDetails(html) {
  const pr = jsonAfter(html, 'ytInitialPlayerResponse = ');
  if (!pr) { console.log('youtube: could not parse ytInitialPlayerResponse'); return; }
  const d = pr.videoDetails || {}, mf = pr.microformat?.playerMicroformatRenderer || {};
  console.log(`--- youtube video ---\ntitle: ${d.title}\nchannel: ${d.author} (${d.channelId})\nlength: ${d.lengthSeconds}s  views: ${d.viewCount}  published: ${mf.publishDate || ''}  uploaded: ${mf.uploadDate || ''}  category: ${mf.category || ''}`);
  if (d.keywords?.length) console.log('keywords:', d.keywords.slice(0, 30).join(', '));
  console.log('description:\n' + (d.shortDescription || '').slice(0, 2500) + '\n---');
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log('caption tracks:', tracks.map((t) => `${t.languageCode}${t.kind ? '/' + t.kind : ''}`).join(', ') || 'none');
  const track = tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') || tracks.find((t) => t.languageCode?.startsWith('en')) || tracks[0];
  if (!track) return;
  try {
    const res = await fetch(track.baseUrl + '&fmt=json3', { headers: { 'User-Agent': UA } });
    const json = await res.json();
    const text = (json.events || []).flatMap((e) => (e.segs || []).map((s) => s.utf8)).join('').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`--- transcript (${track.languageCode}${track.kind ? '/' + track.kind : ''}, ${text.length} chars) ---\n` + text.slice(0, 20000) + '\n---');
  } catch (err) { console.log('transcript fetch failed:', String(err.message).split('\n')[0]); }
}
// Social/preview metadata and any image or video URLs the page names: handy for finding a thumbnail.
for (const m of body.matchAll(/<meta[^>]+(?:property|name)=["'](?:og|twitter):[^"']+["'][^>]*>/gi)) console.log('meta:', m[0].replace(/\s+/g, ' ').slice(0, 300));
const media = new Set();
for (const m of body.matchAll(/https?:\\?\/\\?\/(?:pbs\.twimg\.com|video\.twimg\.com|i\.ytimg\.com)[^"'\s<>\\]+/g)) media.add(m[0].replace(/\\\//g, '/'));
for (const m of body.matchAll(/"(?:media_url_https|thumbnail_url|poster|url)":"(https?:[^"]+\.(?:jpg|jpeg|png|webp|mp4)[^"]*)"/g)) media.add(m[1].replace(/\\\//g, '/'));
if (media.size) console.log('media urls:\n  ' + [...media].slice(0, 40).join('\n  '));
try {
  const feed = await new Parser().parseString(body);
  console.log(`parsed as feed: title="${feed.title}" items=${feed.items?.length ?? 0}`);
  for (const it of (feed.items || []).slice(0, 3)) console.log(`  - ${it.isoDate || it.pubDate || ''} ${it.title}`);
} catch (err) {
  console.log('not a feed:', String(err.message).split('\n')[0]);
  const links = feedLinksFromHtml(body, target);
  console.log('advertised feed links:', links.length ? links : 'none');
  // Readable text of the page (headline, dates and paragraphs), so a story can be checked against its source.
  const scope = body.match(/<article[\s\S]*?<\/article>/i)?.[0] || body;
  const text = [...scope.matchAll(/<(h1|h2|h3|p|time|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '\u2019').replace(/&#8220;|&ldquo;/g, '\u201c').replace(/&#8221;|&rdquo;/g, '\u201d').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 2);
  if (text.length) console.log('--- page text ---\n' + text.join('\n').slice(0, 12000) + '\n---');
}
