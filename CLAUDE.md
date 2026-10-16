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

## Conventions

- Vanilla HTML/CSS/JS in `src/`; no frameworks. Keep pages fast: no new third-party scripts without a reason.
- Owner-facing tasks go in GitHub issue #2 ("My to-do list"); automated feed problems appear in the `feed-health` issue.
- Never commit secrets. Keys live in GitHub Actions secrets and are read through `${VAR}` placeholders in `feeds.json`.
