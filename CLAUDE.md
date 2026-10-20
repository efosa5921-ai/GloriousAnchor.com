# Working on Glorious Anchor

Static site built by `scripts/build.js` from `feeds.json`, `picks.json`, `churches.json` and `articles/*.md`; deployed by
GitHub Actions to GitHub Pages at gloriousanchor.com. Read `README.md` for the architecture.

## Routine for every user-facing change

1. Add a dated entry at the top of `CHANGELOG.md` (one line per feature, plain language for readers, newest first). The
   build publishes it as the "What's new" article at `/articles/whats-new/`.
2. If the change adds or renames a section or a visitor-facing feature, update the overview in
   `articles/2026-10-15-welcome-to-glorious-anchor.md` so it keeps describing everything the site does.
3. Run `npm test` and `npm run build:offline`; verify in headless Chromium when the change touches the frontend.
4. Commit on `claude/christian-news-aggregator`, fast-forward `main`, and push both. Pushing `main` deploys.

## Articles: the owner reads before anything goes public

- A new article Claude writes starts with `draft: true`. The build renders it as an unlisted preview at
  `/drafts/<slug>/` (noindex, not in cards, feeds or the sitemap). Send the owner that link and wait for approval.
- Remove `draft: true` only when the owner says to publish. Publishing announces the article to Telegram and X.
- Edits to an already published article may go straight out, unless they change its substance.

## Every article is primed for search before it is published

Do this for every article (the build prints a ⚠ line for anything missed):

- Title that leads with the phrase people search for; under 65 characters as shown in search. If the heading must be
  longer (a reader's question, say), add a shorter `searchTitle` for the tab, search results and previews.
- `summary` of 120–155 characters that names the key phrases and scriptures; it is the search snippet and the preview text.
- `keywords`: 5–10 phrases people would type, including scripture references. They go into the structured data.
- A real `image` (stored in `articles/images/`, under 200 KB), not the site default.
- 300+ words, with `##` subheadings that use the key phrases, and a closing "Questions this article answers" section
  whose headings are the exact questions people search, answered in two or three sentences each.
- Links to related articles and sections on the site, and `categories` so it sits in the right tabs.
- `updated:` when a published article is substantively changed.

## Conventions

- Vanilla HTML/CSS/JS in `src/`; no frameworks. Keep pages fast: no new third-party scripts without a reason.
- Owner-facing tasks go in GitHub issue #2 ("My to-do list"); automated feed problems appear in the `feed-health` issue.
- Never commit secrets. Keys live in GitHub Actions secrets and are read through `${VAR}` placeholders in `feeds.json`.
