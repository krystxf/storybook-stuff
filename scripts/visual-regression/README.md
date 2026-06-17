# Visual regression

A self-contained, Chromatic-style visual regression check that runs on pull requests
and posts a **single, auto-updating** comment with before/after/diff images of every
Storybook story that changed — no external services.

## How it works

On each PR (`.github/workflows/visual-regression.yml`):

1. **Build & screenshot HEAD** — builds `storybook-static`, then `capture.mjs` serves it
   and screenshots every story (light + dark) with Playwright/Chromium.
2. **Build & screenshot BASE** — checks out the PR's base commit in a nested git worktree,
   builds its Storybook with the root `node_modules`, and screenshots it the same way.
3. **Diff** — `diff.mjs` compares the two with `pixelmatch`, emitting `before/after/diff`
   PNGs and a `report.json` for every story that changed / was added / was removed.
4. **Publish images** — `publish-snapshots.sh` commits the diff PNGs to an orphan
   `vrt-snapshots` branch under `pr-<n>/<sha>/`.
5. **Comment** — `comment.mjs` upserts one sticky comment, embedding the images via
   `https://github.com/<owner>/<repo>/raw/<sha>/...` URLs.

### Why `github.com/.../raw/...` URLs

The repo is private. GitHub proxies *external* comment images through Camo (which has no
auth), so `raw.githubusercontent.com` URLs 404. Images on `github.com` itself are **not**
proxied — they load with the viewer's session — so committing images to a branch in this
same repo and linking them as `github.com/<repo>/raw/<sha>/<path>` renders for anyone with
repo access, while staying private to everyone else.

## Tuning

- `THEMES` (workflow env) — comma-separated themes to capture. Default `light,dark`.
- `MIN_DIFF_PIXELS` (default `20`) — ignore diffs smaller than this many pixels.
- `PIXELMATCH_THRESHOLD` (default `0.1`) — per-pixel color sensitivity (0–1).
- `MAX_OPEN` (default `8`) / `MAX_RENDER` (default `60`) — how many changed stories render
  expanded / at all in the comment.

## Run the diff locally

```bash
npm run build-storybook
node scripts/visual-regression/capture.mjs --static storybook-static --out .vrt/head --themes light,dark
# ...check out the base revision, rebuild, capture to .vrt/base...
node scripts/visual-regression/diff.mjs --base .vrt/base --head .vrt/head --out .vrt/out
DRY_RUN=1 GITHUB_TOKEN=x GITHUB_REPOSITORY=o/r PR_NUMBER=1 \
  SNAP_SHA=abc SNAP_PATH_PREFIX=pr-1/abc node scripts/visual-regression/comment.mjs
```
