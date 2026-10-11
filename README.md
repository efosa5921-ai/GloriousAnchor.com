# Glorious Anchor

**Christian news, voices and video, anchored in one place.**

Glorious Anchor is a fast, static aggregator for the Christian web. A build script pulls public feeds from Christian
news outlets, faith-and-culture magazines, teaching ministries, personal writers and Substacks, YouTube channels and
social communities. It normalises and de-duplicates everything into one readable page. GitHub Actions rebuilds the site
every hour and publishes it to GitHub Pages, so there is no server to run and nothing to pay for.

> *We have this hope as an anchor for the soul, firm and secure.* — Hebrews 6:19

## What it gathers

| Section | Kind | Examples |
| --- | --- | --- |
| News | news | Christianity Today, The Christian Post, Religion News Service, Baptist Press, CNA, Premier, CBN News, WORLD |
| Faith & Culture | article | RELEVANT, The Gospel Coalition, Mere Orthodoxy, First Things, Plough, Crossway |
| Teaching & Devotional | article | Desiring God, Ligonier, Our Daily Bread, Bible Gateway Blog, Got Questions |
| Writers & Blogs | article | Tim Challies, Kevin DeYoung, Ann Voskamp, Trevin Wax, Scot McKnight, Jemar Tisby, Kristin Du Mez |
| YouTube | video | BibleProject, Desiring God, Ligonier, Mike Winger, Cliffe Knechtle, Elevation Worship, Bethel Music |
| Social | social | r/Christianity, r/TrueChristian, r/Reformed, r/Catholicism, Bluesky accounts |
| Picks | pick | Any single link you choose: an article, an X post, a TikTok, a YouTube video, an Instagram or Facebook post |
| X / Instagram / TikTok / Facebook accounts | social, video | Through your own feed server, see [server/README.md](server/README.md) |

**Top Stories** mixes every section, capped per source so a busy channel or subreddit cannot crowd out the rest.

## Features

- Search across headlines, summaries, video descriptions and posts, with highlighting (press `/` to focus)
- Filter by source; sort newest-first or group by publisher; show only articles, only videos or only posts
- Content-type badges, play overlay for videos, quote styling for social posts, author bylines
- **My Feed**: follow just the publishers, writers, channels and communities you want, with a source picker; choices are stored in your browser only
- Save items for later (stored in your browser only)
- Installable mobile app (PWA) with offline reading; light/dark theme, keyboard accessible, no trackers, no cookies
- Resilient builds: if a feed is down, its recent items from the previous build are kept

## Mobile app

Glorious Anchor is a Progressive Web App, so it installs like a native app from the browser with no app store:

- **iPhone / iPad**: open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android**: open the site in Chrome and tap **Install** (the download icon in the header, or the browser's own prompt).
- **Desktop**: Chrome and Edge show an install icon in the address bar.

Once installed it opens full-screen with its own icon, keeps the last headlines for offline reading, offers home-screen
shortcuts to My Feed, YouTube and Saved, and updates itself after each hourly rebuild (a "new version" banner appears).

If you later want listings in the App Store or Google Play, the same code can be wrapped without a rewrite using
[PWABuilder](https://www.pwabuilder.com) (generates store packages from the live URL) or
[Capacitor](https://capacitorjs.com) (a native shell around the web app, with access to push notifications).

## Quick start

```bash
npm install
npm run build          # fetches live feeds -> dist/
npm run serve          # http://localhost:8080
```

Offline (no network) you can build from the test fixtures instead:

```bash
npm run build:offline
```

Run the unit tests with `npm test`.

## Configuring sources

Everything lives in [`feeds.json`](feeds.json). Each source has an `id` (unique, stable), a `name`, a `category`
(one of the `categories` ids other than `top`), a `kind` (`news`, `article`, `video` or `social`) and optionally
`featured: true` to give it more room on the front page.

```jsonc
// Any RSS/Atom feed (news sites, blogs, Substack, podcasts)
{ "id": "challies", "name": "Tim Challies", "url": "https://www.challies.com/feed/", "category": "articles", "kind": "article" }

// YouTube channel by handle (resolved to a channel id at build time and cached) or by channelId
{ "id": "yt-bibleproject", "name": "BibleProject", "type": "youtube", "handle": "@bibleproject", "category": "video", "kind": "video" }
{ "id": "yt-x", "name": "Some Channel", "type": "youtube", "channelId": "UCxxxxxxxxxxxxxxxxxxxxxx", "category": "video", "kind": "video" }

// Social
{ "id": "r-reformed", "name": "r/Reformed", "type": "reddit", "subreddit": "Reformed", "category": "social", "kind": "social" }
{ "id": "bsky-rns", "name": "Religion News Service", "type": "bluesky", "handle": "religionnews.com", "category": "social", "kind": "social" }
{ "id": "masto-x", "name": "Someone", "type": "mastodon", "instance": "mastodon.social", "user": "someone", "category": "social", "kind": "social" }
```

- **Substack**: use `https://<name>.substack.com/feed`.
- **Your own articles**: point an entry at your blog's feed and give it `"featured": true`.
- **Pause a source** without deleting it: `"enabled": false`.
- **X, Instagram, Facebook, TikTok accounts** publish no public feeds. Run the small feed server in
  [`server/`](server/README.md) (Docker, one command) and add sources with `"type": "rsshub"` or `"type": "rssbridge"`.
  Disabled examples are already in `feeds.json`. A hosted alternative such as rss.app also works: paste its feed URL as a
  normal `url` source.
- `limits` controls items per feed, how many hours of history to keep, timeouts and concurrency.

## Picks: single links you choose

[`picks.json`](picks.json) holds hand-picked URLs. Paste any link and the build turns it into a card using the page's own
preview data (Open Graph tags), or the public oEmbed endpoint for X, TikTok and YouTube. Fetched data is cached for a week.

```jsonc
{ "url": "https://www.christianitytoday.com/2026/10/some-article", "note": "Worth your time this week.", "pinned": true }
{ "url": "https://x.com/BibleProject/status/1234567890" }
{ "url": "https://www.tiktok.com/@bibleproject/video/7000000000000000000" }
{ "url": "https://www.instagram.com/p/ABC123/", "title": "Sunday service highlights", "image": "https://example.com/photo.jpg", "source": "Instagram · @yourchurch" }
```

- Optional fields `title`, `summary`, `image`, `author`, `source`, `added` (date) override whatever was fetched.
- **Instagram and Facebook** block automated previews, so give those posts a `title` (and ideally an `image`).
- `note` shows as an editor's note on the card. `pinned: true` puts the pick at the top of Top Stories.
- Picks never age out; remove the line to remove the card. `"enabled": false` hides one temporarily.

After each build, `dist/data/meta.json` lists every source with `ok: true/false` and an error message, so a wrong
URL or handle is easy to spot. Feed URLs and YouTube handles in the shipped config are best-effort; check the first
build's log and correct any that fail.

## Deployment

The workflow in `.github/workflows/build.yml` builds on every push to `main`, hourly on a schedule, and on demand.

1. In the repository settings, open **Pages** and set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually). The site appears at `https://<user>.github.io/GloriousAnchor.com/`.
3. For the custom domain, rename `CNAME.example` to `src/CNAME`, add `gloriousanchor.com` in **Pages → Custom domain**,
   and point the domain's DNS at GitHub Pages (`A` records to GitHub's Pages IPs, or a `CNAME` for `www`).

## Project layout

```
feeds.json              sources, categories, feed-server settings and limits
picks.json              hand-picked single links (articles, posts, videos)
server/                 optional self-hosted feed server for X, Instagram, TikTok, Facebook (Docker)
scripts/build.js        resolve + fetch + normalise + write dist/
scripts/lib/sources.js  turns a source entry into a feed URL (YouTube, Reddit, Bluesky, Mastodon)
scripts/lib/articles.js pure helpers for normalising and de-duplicating items (tested)
scripts/lib/picks.js    unfurls a single URL into a card via Open Graph or oEmbed (tested)
scripts/serve.js        tiny local preview server
src/                    static frontend (copied to dist/ as-is); sw.js is the service worker
test/                   unit tests and feed fixtures for offline builds
```

## Content and attribution

Glorious Anchor links out to the original publishers, channels and posts. Headlines, summaries and thumbnails belong
to their creators and are shown only as provided in their public feeds, with a prominent link back to the source. If
you publish a feed and would prefer not to be included, remove the entry from `feeds.json` or open an issue.
