# Glorious Anchor feed server

X, Instagram, TikTok and Facebook publish no feeds, so this small server makes them. It runs two open-source
feed generators behind one HTTPS address:

- **RSSHub** (`/rsshub/...`) for X, Instagram, TikTok and hundreds of other sites. Protected by an access key.
- **RSS-Bridge** (`/rss-bridge/...`) as a second option, mainly for Facebook pages. Protected by a password.

The site's hourly build on GitHub Actions calls this server for the sources in `feeds.json` that use
`"type": "rsshub"` or `"type": "rssbridge"`. Nothing else about the site changes.

> Honest note: these platforms actively fight scraping. X and Instagram need cookies from a logged-in account and
> break from time to time; Facebook is the least reliable. When a route breaks, `dist/data/meta.json` shows the error,
> the site keeps the last items it had, and updating the Docker image usually fixes it.

## 1. Get a machine

Any small VPS works (1 CPU, 2 GB RAM is plenty): Hetzner, DigitalOcean, Linode, Oracle free tier, or a home server with
a public port. Install Docker: `curl -fsSL https://get.docker.com | sh`.

Create a DNS **A record** for a hostname, for example `feeds.gloriousanchor.com`, pointing at the machine's IP.
Caddy will fetch an HTTPS certificate for it automatically.

## 2. Configure

```bash
git clone https://github.com/efosa5921-ai/GloriousAnchor.com.git
cd GloriousAnchor.com/server
cp .env.example .env
nano .env
```

Fill in:

- `DOMAIN`: the hostname above.
- `RSSHUB_ACCESS_KEY`: any long random string (`openssl rand -hex 24`).
- `BASIC_AUTH_USER` / `BASIC_AUTH_HASH`: a username and a *hashed* password. Make the hash with
  `docker run --rm caddy:2 caddy hash-password --plaintext 'your-password'`.
- For **X**: log in to x.com in a browser with a spare account, open the browser's developer tools → Application →
  Cookies, and copy the value of `auth_token` into `TWITTER_AUTH_TOKEN`.
- For **Instagram**: log in with a spare account, open developer tools → Network, click any request to instagram.com,
  and copy the whole `Cookie` request header into `IG_COOKIE`.
- TikTok needs nothing extra.

## 3. Run

```bash
docker compose up -d
docker compose logs -f rsshub     # watch it start
```

Test in a browser (replace the key):

- `https://feeds.gloriousanchor.com/rsshub/tiktok/user/@bibleproject?key=YOUR_KEY`
- `https://feeds.gloriousanchor.com/rsshub/twitter/user/BibleProject?key=YOUR_KEY`
- `https://feeds.gloriousanchor.com/rsshub/instagram/user/bibleproject?key=YOUR_KEY`
- `https://feeds.gloriousanchor.com/rss-bridge/?action=display&bridge=Facebook&context=User&u=BibleProject&format=Atom` (asks for the password)

Each should return XML. Routes for other sites are listed at https://docs.rsshub.app and https://rss-bridge.org.

## 4. Tell the site about it

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
| --- | --- |
| `FEEDS_SERVER_URL` | `https://feeds.gloriousanchor.com` |
| `RSSHUB_ACCESS_KEY` | the same key as in `.env` |
| `FEEDS_BASIC_AUTH` | `anchor:your-password` (user, colon, the *plain* password) |

Then in `feeds.json`, add sources like these (there are disabled examples already in the file; set `"enabled": true`
or delete the line):

```jsonc
{ "id": "x-bibleproject", "name": "BibleProject on X", "type": "rsshub", "route": "/twitter/user/BibleProject",
  "profile": "https://x.com/BibleProject", "category": "social", "kind": "social" }

{ "id": "ig-bibleproject", "name": "BibleProject on Instagram", "type": "rsshub", "route": "/instagram/user/bibleproject",
  "profile": "https://www.instagram.com/bibleproject/", "category": "social", "kind": "social" }

{ "id": "tt-bibleproject", "name": "BibleProject on TikTok", "type": "rsshub", "route": "/tiktok/user/@bibleproject",
  "profile": "https://www.tiktok.com/@bibleproject", "category": "video", "kind": "video" }

{ "id": "fb-bibleproject", "name": "BibleProject on Facebook", "type": "rssbridge", "bridge": "Facebook",
  "params": { "context": "User", "u": "BibleProject" }, "profile": "https://www.facebook.com/BibleProject",
  "category": "social", "kind": "social" }
```

`route` is any RSSHub route; `bridge` + `params` are any RSS-Bridge bridge and its parameters. `profile` is the link
shown on the site. The next build picks them up.

## 5. Keep it running

```bash
docker compose pull && docker compose up -d   # update (fixes most broken routes)
docker compose logs --tail=100 rsshub          # troubleshoot
```

Cookies expire every few months; when X or Instagram routes start failing, refresh the values in `.env` and run
`docker compose up -d` again.

## Alternative: a hosted service

If running a server becomes a chore, services such as rss.app or FetchRSS produce a feed URL for a social account.
Paste that URL into `feeds.json` as a normal `"url"` source (it may contain `${SOME_SECRET}` to keep keys out of git).
