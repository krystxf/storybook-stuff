# Visual regression

A self-contained, Chromatic-style visual regression check that runs on pull requests
and posts a **single, auto-updating** comment with before/after/diff images of every
Storybook story that changed — no external services. Visual **changes block the PR**
until they're approved with a comment.

## How it works

On each PR (`.github/workflows/visual-regression.yml`):

1. **Build & screenshot HEAD** — builds `storybook-static`, then `capture.mts` serves it
   and screenshots every story (light + dark) with Playwright/Chromium.
2. **Build & screenshot BASE** — checks out the PR's base commit in a nested git worktree,
   builds its Storybook with the root `node_modules`, and screenshots it the same way.
3. **Diff** — `diff.mts` compares the two with `pixelmatch`, emitting `before/after/diff`
   PNGs and a `report.json` for every story that changed / was added / was removed.
4. **Publish images** — `publish-snapshots.sh` commits the diff PNGs (+ `report.json`) to an
   orphan `vrt-snapshots` branch under `pr-<n>/<sha>/`.
5. **Comment & gate** — `evaluate.mts` upserts one sticky comment (images embedded via
   `https://github.com/<owner>/<repo>/raw/<sha>/...` URLs) and sets the
   **`visual-regression` commit status**: `failure` while any changed story is unapproved,
   else `success`.

A separate `approve` job re-runs `evaluate.mts` when someone comments `approve changes …`
(no re-screenshot — it reads the published `report.json`).

### Why `github.com/.../raw/...` URLs

The repo is private. GitHub proxies *external* comment images through Camo (which has no
auth), so `raw.githubusercontent.com` URLs 404. Images on `github.com` itself are **not**
proxied — they load with the viewer's session — so committing images to a branch in this
same repo and linking them as `github.com/<repo>/raw/<sha>/<path>` renders for anyone with
repo access, while staying private to everyone else.

### Snapshot storage

Diff images accumulate on the `vrt-snapshots` branch and are **not** auto-removed (each
push to a PR replaces that PR's own previous images, so only its latest set is kept). They're
small PNGs, but to reclaim space just delete the branch:

```bash
git push origin --delete vrt-snapshots
```

The next PR run recreates it as an orphan; open PRs' comment images repopulate on their next push.

## Blocking & approvals

- A story whose pixels **changed** sets the `visual-regression` status to **failure** —
  the PR is blocked until approved. **Added** and **removed** stories never block.
- Approve by commenting (one line each, repo owner/member/collaborator only):

  ```
  approve changes UI/Button            # every variant of the component (both themes)
  approve changes UI/Button › Default  # a single story
  ```

- To make this actually prevent merging, add **`visual-regression`** as a required status
  check in branch protection (Settings → Branches). Without that it still shows a red ✕,
  but GitHub won't hard-block the merge button.
- Approvals are component/story-level and persist across pushes (re-approval isn't required
  for later commits to the same component).
- **Revoking:** delete your approval comment (or edit the line out) and the gate
  re-evaluates immediately — the approval is withdrawn and the status re-blocks if needed.

## Tuning

- `THEMES` (workflow env) — comma-separated themes to capture. Default `light,dark`.
- `MIN_DIFF_PIXELS` (default `20`) — ignore diffs smaller than this many pixels.
- `PIXELMATCH_THRESHOLD` (default `0.1`) — per-pixel color sensitivity (0–1).
- `MAX_OPEN` (default `8`) / `MAX_RENDER` (default `60`) — how many changed stories render
  expanded / at all in the comment.
- `VRT_IGNORE_STORY_NAMES` (default `All Variants`) — comma-separated, case-insensitive
  substrings; stories whose name matches are skipped (composite stories duplicate the
  individual variants). Set empty to capture everything.

## Run the diff locally

The scripts are TypeScript (`.mts`) run directly via Node's native type stripping —
**Node ≥ 24** (or ≥ 22.18) is required. On older Node, add `--experimental-strip-types`.

```bash
pnpm build-storybook
node scripts/visual-regression/capture.mts --static storybook-static --out .vrt/head --themes light,dark
# ...check out the base revision, rebuild, capture to .vrt/base...
node scripts/visual-regression/diff.mts --base .vrt/base --head .vrt/head --out .vrt/out
DRY_RUN=1 GITHUB_TOKEN=x GITHUB_REPOSITORY=o/r PR_NUMBER=1 \
  SNAP_SHA=abc SNAP_PATH_PREFIX=pr-1/abc node scripts/visual-regression/evaluate.mts
```
