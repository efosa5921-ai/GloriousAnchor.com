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
| Prophecy in the News | article, video | Our own articles on current events read in the light of Scripture, plus Lamb & Lion Ministries, Prophecy Watchers, Prophecy News Watch and Endtime Ministries |
| The Holy Spirit | news, article | Charisma News, Charisma Magazine, The Pneuma Review, Influence Magazine |
| YouTube | video | BibleProject, Desiring God, Ligonier, Mike Winger, Cliffe Knechtle, Elevation Worship, Bethel Music |
| Radio | audio | The Briefing, BibleProject Podcast, Truth for Life, Renewing Your Mind, The Holy Post, Gospelbound, Focus on the Family |
| Social | social | r/Christianity, r/TrueChristian, r/Reformed, r/Catholicism, Bluesky accounts |
| Picks | pick | Any single link you choose: an article, an X post, a TikTok, a YouTube video, an Instagram or Facebook post |
| Instagram accounts | social | Official Meta Graph API, no scraping: `"type": "instagram"` (see below) |
| X / TikTok / Facebook accounts | social, video | Through your own feed server, see [server/README.md](server/README.md) |

**Top Stories** mixes every section, capped per source so a busy channel or subreddit cannot crowd out the rest.

## Section landing pages

Every category except Top Stories and Our Articles is also built as a page of its own at `/<slug>/` (`/news/`, `/eschatology/`, `/writers/` for Writers & Blogs, …): the same app opening on that category, with its own title, description, an intro heading, the category's latest cards prerendered, CollectionPage + ItemList + breadcrumb JSON-LD, and a sitemap entry. A category's `slug` in `feeds.json` overrides its id (needed when the id is a fixed path such as `articles`); categories covered by a brand page (`/tv/`, `/radio/`) use that page. Every page's footer links all sections.

## Features

- Search across headlines, summaries, video descriptions and posts, with highlighting (press `/` to focus)
- Filter by source; sort newest-first or group by publisher; show only articles, videos, audio or posts
- Content-type badges, play overlay for videos, inline player for podcast episodes, quote styling for social posts, author bylines
- **Branded entry pages**: `/tv/` (GAIN TV) and `/radio/` (GAIN Radio) are the same app opening on one section, with their own name, tagline and share card; configured under `site.brands` in `feeds.json`, so other network domains can redirect to them. The redirect sites for gaintv.app and gainradio.app live in [`redirects/`](redirects/README.md)
- **Find a church**: nearby churches from OpenStreetMap plus your own listed directory, with map and directions
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
(one of the `categories` ids other than `top`), a `kind` (`news`, `article`, `video`, `audio` or `social`; `audio` sources are podcast feeds and get an inline player) and optionally
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
- **Instagram** (any Business or Creator account, which most ministries and outlets are): add
  `{ "id": "ig-bibleproject", "name": "BibleProject on Instagram", "type": "instagram", "username": "bibleproject", "category": "social", "kind": "social" }`.
  One-time setup: run `node scripts/instagram-setup.js` on your computer (instructions are printed in the file) and add
  the two values it prints as GitHub secrets `IG_USER_ID` and `IG_ACCESS_TOKEN`. The token does not expire.
- **Fallbacks**: any source may list other ways to fetch the same account, tried in order when the primary fails:
  `"fallbacks": [ { "type": "rssbridge", "bridge": "Twitter", "params": { "context": "By username", "u": "BibleProject" } }, { "url": "https://rss.app/feeds/XXXX.xml" } ]`.
  The build log and `meta.json` say when a fallback was used.
- **Blocked by the publisher?** Some sites (Substack, Desiring God, Reddit, ...) refuse requests from GitHub's
  datacenter IP range. If you run the feed server, the build automatically retries such fetches through its `relay`
  service, which usually gets through. Nothing to configure beyond the server secrets.
- **Alerts**: the hourly build tracks consecutive failures per source. When any source has failed three builds in a
  row, the workflow opens (or updates) a GitHub issue labelled `feed-health` listing what is down and the last error, and
  closes it when everything recovers. GitHub emails you about the issue, so an expired cookie or a dead feed is noticed
  within hours.
- **X, Instagram, Facebook, TikTok accounts** publish no public feeds. Run the small feed server in
  [`server/`](server/README.md) (Docker, one command) and add sources with `"type": "rsshub"` or `"type": "rssbridge"`.
  Disabled examples are already in `feeds.json`. A hosted alternative such as rss.app also works: paste its feed URL as a
  normal `url` source.
- `limits` controls items per feed, how many hours of history to keep, timeouts and concurrency.

## Church finder

`gloriousanchor.com/churches/` finds Christian churches near a visitor: by their location or any town, within a chosen
radius, listed nearest-first with a map, denominations, websites and directions. Results come from OpenStreetMap
(worldwide, free, no key) merged with your own directory in [`churches.json`](churches.json), which shows first with a
"Listed" badge. Add churches from the admin (Churches tab) or by editing the file; addresses are located automatically
at build time and cached. Give `lat`/`lng` directly for precision.

## Search engines (SEO)

Every build also produces `sitemap.xml` (home, article index, each article, the church finder and each listed church),
pre-renders the latest headlines into the home page HTML so crawlers see content without JavaScript, and adds
structured data: Organization and WebSite on the home page, Article on each of your articles, Church (address, map
position, service times) on each listed church's page at `/churches/<name>/`. Every page carries a canonical URL and
social preview tags (`assets/social.jpg` by default). `robots.txt` points at the sitemap and keeps `/admin/` out.

One-time steps for you: add the site in Google Search Console (verify with a DNS TXT record at your registrar, or
paste the HTML-tag code into the admin's Settings tab), submit `https://gloriousanchor.com/sitemap.xml`, and tick
Enforce HTTPS in GitHub Pages settings. Then publish original articles and fill the church directory; those are the
pages that rank.

## Admin page

Everything below can also be done from **gloriousanchor.com/admin/** without touching files: add and pin picks, add,
pause or feature sources, write and edit articles (with image upload and preview), change site settings, see build
status and feed health, and trigger a rebuild. It talks straight to this repository through GitHub's API, so there is
no server and every change is still a normal commit.

One-time setup: create a fine-grained personal access token at GitHub → Settings → Developer settings → Fine-grained
tokens, limited to this repository, with **Contents: Read and write** and **Actions: Read and write**. Paste it into
the admin page; it is stored only in that browser. Sign out from the Settings tab to forget it. The page is not
indexed by search engines and is useless without a token.

## Our Articles: publish your own writing

Drop a Markdown file into [`articles/`](articles/) and the next build turns it into a page at
`gloriousanchor.com/articles/<name>/`, a card on the front page under the **Our Articles** tab, and an entry in the
site's own feed at `/articles/feed.xml` that others can subscribe to. On GitHub: open the `articles` folder, click
**Add file → Create new file**, name it like `2026-10-20-my-title.md`, paste the text below, and commit.

```markdown
---
title: Why we started Glorious Anchor
date: 2026-10-20
author: Your Name
summary: One or two sentences shown on the card.
image: images/sunrise.jpg
pinned: true
---

Write the article here in Markdown. **Bold**, *italic*, ## headings, lists, quotes and links all work.
```

- `title` and `date` are the only required lines. The date part of the file name is used if `date` is missing.
- `image` is a file you uploaded to `articles/images/`, or a full `https://` URL. Optional.
- `pinned: true` makes the article lead the front page. `draft: true` keeps it out of the build until you remove it.
- Edit a file to update the article; delete it to unpublish. The address comes from the file name after the date.

### What's new

`CHANGELOG.md` is published as the article at `/articles/whats-new/`, dated by its newest heading. Add a dated entry at
the top whenever a feature ships; the welcome article should keep describing the whole site.

## YouTube reliability

YouTube's RSS feed server (`youtube.com/feeds/videos.xml`) answers GitHub's runners with sporadic 404s and 500s, at times for most channels in a build. The build retries each channel up to three times, and when a `YOUTUBE_API_KEY` secret is set it falls back to the YouTube Data API (`scripts/lib/youtube.js`): the channel's uploads playlist, 1 quota unit per call against a free 10,000-unit daily quota. Create the key in Google Cloud Console (APIs & Services → Credentials → API key, with "YouTube Data API v3" enabled) and add it under Settings → Secrets and variables → Actions.

## Gone videos

Churches often stream a service and then hide or delete the recording, while the feed entry lingers and YouTube serves a grey placeholder thumbnail. `scripts/lib/videos.js` asks YouTube's oEmbed endpoint about each video (401 = private, 404 = deleted) and drops those; results are cached in `dist/data/video-cache.json`, re-checking fresh videos every 12 hours for three days. The thumbnail is checked as well: YouTube answers 404 with a grey placeholder image for a video that has no picture yet (browsers display it regardless), so such videos keep their card but get the cover tile.

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
- `categories` (a list of tab ids from `feeds.json`, e.g. `["holyspirit"]`) shows the pick in those tabs as well as Picks. Unknown ids are ignored with a warning. Own articles take the same field in their front matter (`categories: eschatology, pitn`).
- Picks never age out; remove the line to remove the card. `"enabled": false` hides one temporarily.

After each build, `dist/data/meta.json` lists every source with `ok: true/false` and an error message, so a wrong
URL or handle is easy to spot. Feed URLs and YouTube handles in the shipped config are best-effort; check the first
build's log and correct any that fail.

## Bible Quiz

`quizzes.json` holds the quizzes (id, title, description, difficulty, questions with `options` and the `answer` index, optional `ref` and `note`). The build validates them (`scripts/lib/quiz.js`), publishes `data/quizzes.json` and renders `/quiz/` from `src/quiz/index.html`; `src/quiz/quiz.js` plays a quiz with shuffled questions and options, shows the reference after each answer, keeps best scores in the browser and offers WhatsApp, X and share-sheet buttons with a link back to that quiz. The quiz of the day rotates by UTC day. The admin's Quizzes view edits quizzes in a plain text format (`Q:`, `A:` with `*` on the right answer, `Ref:`, `Note:`).

**Quiz videos.** `scripts/quiz-video.js` renders a quiz as a 1080×1920 MP4: title card, then per question a reading card, a countdown and the answer with its reference, then an end card, with a soft tick and chime (Chromium screenshots assembled by ffmpeg). The "Render quiz videos" workflow (`quiz-video.yml`, started from the admin's ▶ buttons or Actions → Run workflow) renders and commits the files to `videos/quiz/<id>.mp4`; the build copies `videos/` into the site and the quiz page shows "Watch or download the video version" for quizzes that have one. Locally: `npm i --no-save playwright && npx playwright install --with-deps chromium`, then `node scripts/quiz-video.js --quiz gospels --limit 5`.

## Pictures

Feed items often lack an image. A picture scraped from the item's own HTML is a last resort and is filtered (`firstImageFromHtml` in `scripts/lib/articles.js` skips adverts, banners, buttons, logos, avatars and tiny images by URL, class, alt text and size), and such items are marked `imageFromBody` so the page's `og:image` replaces the scraped picture when it can be fetched. The build fetches the article page's `og:image` for news and article items without one, or with only a scraped one (`scripts/lib/images.js`): results, including misses, are cached for a week in `dist/data/og-cache.json`, obvious logos are rejected, and at most `limits.pageImagesPerBuild` (default 60) pages are fetched per build so builds stay quick; `limits.pageImages: false` turns it off. Anything still without a picture, on the app, the story pages and the prerendered cards alike, shows a branded cover (source name on one of six gradients chosen by hashing the source id) rather than an empty box; social posts keep their quote style.

## Growth: sharing, digest, feeds, auto-posting, analytics

- **Share buttons** on every card (WhatsApp, X, Facebook, Telegram, email, copy link; native share sheet on touch devices). Every external story is shared as `/s/<id>/`, a **story page**: Glorious Anchor Open Graph tags (title, source, picture) so previews in WhatsApp, X and Telegram carry the brand, then on the site the headline, summary and a "Read the full story at <source>" button (inline player for podcasts), plus up to six more stories from the same section linking to their own story pages. Pages are `noindex` with a canonical link to the source, generated for the published set; a story that has aged off lands on `404.html`. The digest and auto-posts use the same links.
- **Digest on WhatsApp**: WhatsApp shows one link preview per message, so the digest page offers "Share as picture" (a tall canvas image with every story's thumbnail and headline, drawn client-side through the image proxy, which allows cross-origin drawing) and "Post story by story" (copy or share each story on its own so each post carries its own picture).
- **Daily digest** at `/digest/`: `pickDigest` chooses up to 8 items (own articles and picks from the last week first, then one item per source with per-kind caps). Written as a page, `digest/digest.txt` (WhatsApp-ready) and `digest/feed.xml` (one item per day, kept 14 days in `dist/data/digests.json`, so RSS-to-email services such as Buttondown, Mailchimp or Substack send one email a day).
- **Top-stories feed** at `/feed.xml` for feed readers and automation tools (Zapier, IFTTT, Buffer).
- **Auto-posting**: `scripts/announce.js` runs after each build and posts every new own article and pick plus up to three fresh stories to a Telegram channel (secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) and/or X (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`; OAuth 1.0a, free tier is enough). State lives in `dist/data/announced.json`; the first run records existing items without posting. X posts carry the item's picture (uploaded through the media API). X charges per post, so X receives only own articles and picks unless `X_STORIES_PER_RUN` adds fresh stories per build. To post one item again (to Telegram and X), run the Build workflow by hand with `repost` set to its URL, id or a title fragment (`REPOST`). Skipped when no secrets are set; `--dry-run` prints what would be posted.
- **Analytics**: set `site.goatcounter` (GoatCounter site code) or `site.cloudflareAnalytics` (token) in `feeds.json` or the admin settings; the snippet is injected into every page except the admin. Both are free and cookie-free.
- `site.xHandle` adds "via @handle" to shares and posts.
- **Newsletter sign-up**: `site.newsletter` (admin → Settings → Growth) is the public sign-up page. A Buttondown address renders an inline form posting to Buttondown's embed endpoint on the front page, brand pages, digest and story pages; any other address renders a Subscribe button. The digest page shows a confirmation notice when opened with `?subscribed=1` or `?confirmed=1` (set those as Buttondown's redirects) and has a "Copy for email" button that yields Markdown for the newsletter editor, for sending by hand on Buttondown's free plan.

## Deployment

The workflow in `.github/workflows/build.yml` builds on every push to `main`, hourly on a schedule, and on demand.

1. In the repository settings, open **Pages** and set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually). The site appears at `https://<user>.github.io/GloriousAnchor.com/`.
3. Custom domain (`src/CNAME` already contains `gloriousanchor.com`): at the registrar, add four `A` records for `@`
   pointing to 185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153, and a `CNAME` record for `www`
   pointing to `efosa5921-ai.github.io`. Then in **Settings → Pages → Custom domain** enter `gloriousanchor.com`, save,
   wait for the DNS check to pass and tick **Enforce HTTPS**.

## Project layout

```
feeds.json              sources, categories, feed-server settings and limits
picks.json              hand-picked single links (articles, posts, videos)
churches.json           your church directory (shown in the church finder)
articles/               your own articles in Markdown (published at /articles/<name>/)
server/                 optional self-hosted feed server for X, Instagram, TikTok, Facebook (Docker)
scripts/build.js        resolve + fetch + normalise + write dist/
scripts/lib/sources.js  turns a source entry into a feed URL (YouTube, Reddit, Bluesky, Mastodon)
scripts/lib/articles.js pure helpers for normalising and de-duplicating items (tested)
scripts/lib/picks.js    unfurls a single URL into a card via Open Graph or oEmbed (tested)
scripts/lib/seo.js      sitemap, JSON-LD structured data, pre-rendered cards, meta tags (tested)
scripts/serve.js        tiny local preview server
scripts/probe.js        diagnostic: fetch a URL or @youtubehandle and show what came back (also as the "Probe a feed" Actions workflow)
src/                    static frontend (copied to dist/ as-is); sw.js is the service worker; article.html is the article template
src/admin/              the admin page (edits the repository through GitHub's API with your token)
test/                   unit tests and feed fixtures for offline builds
```

## Content and attribution

Glorious Anchor links out to the original publishers, channels and posts. Headlines, summaries and thumbnails belong
to their creators and are shown only as provided in their public feeds, with a prominent link back to the source. If
you publish a feed and would prefer not to be included, remove the entry from `feeds.json` or open an issue.
