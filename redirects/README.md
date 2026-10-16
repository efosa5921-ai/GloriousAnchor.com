# Network domain redirects

Each folder here is the complete contents of a small GitHub Pages repository for one Glorious Anchor International Network domain.
GitHub Pages allows one custom domain per repository, so each domain needs its own.

| Domain | Lands on | Repository to create |
| --- | --- | --- |
| gaintv.app | https://gloriousanchor.com/tv/ | `efosa5921-ai/gaintv.app` |
| gainradio.app | https://gloriousanchor.com/radio/ | `efosa5921-ai/gainradio.app` |

## Setting one up

1. On GitHub, create a **public** repository with the name above (no README).
2. Upload the folder's files to it (`index.html`, `404.html`, `CNAME`, `.nojekyll`, `README.md`) on the `main` branch.
3. Repository **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`, Save. The custom domain fills in from `CNAME`.
4. At the registrar, add DNS for the domain:
   - four **A** records for `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - one **CNAME** record for `www` → `efosa5921-ai.github.io`
5. Back in Settings → Pages, wait for "DNS check successful", then tick **Enforce HTTPS**. `.app` domains are HTTPS-only in every browser, so this step is required.

The pages carry a `noindex` tag and a canonical link, so search engines credit the destination on gloriousanchor.com rather than the redirect.
