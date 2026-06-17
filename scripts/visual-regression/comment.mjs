// Upsert a single sticky PR comment summarizing visual changes.
// Images are referenced from the snapshot branch via github.com/<repo>/raw/<sha>/...
// (these render in private-repo comments; raw.githubusercontent.com does not).
//
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER  (always required)
//      SNAP_SHA, SNAP_PATH_PREFIX, COMMIT_SHA, GITHUB_SERVER_URL, REPORT  (report mode)
//      MODE=closed  -> replace comment with a "cleaned up" note (no report needed)
//      DRY_RUN=1    -> print body, don't call the API
import fs from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const pr = process.env.PR_NUMBER;
const MARKER = '<!-- visual-regression-bot -->';
const HEADING = '## 🖼️ Visual regression';

if (!token || !repo || !pr) {
  console.error('Missing GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER');
  process.exit(1);
}

let body;

if (process.env.MODE === 'closed') {
  body = `${MARKER}\n${HEADING}\n\n🔒 PR closed — visual snapshots cleaned up.`;
} else {
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const snapSha = process.env.SNAP_SHA || '';
  const prefix = (process.env.SNAP_PATH_PREFIX || '').replace(/\/+$/, '');
  const commitSha = process.env.COMMIT_SHA || '';
  const reportPath = process.env.REPORT || '.vrt/out/report.json';
  const MAX_RENDER = parseInt(process.env.MAX_RENDER || '60', 10); // stay under GitHub's ~65k comment limit
  const MAX_OPEN = parseInt(process.env.MAX_OPEN || '8', 10); // first N expanded, rest collapsed

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const { totals, items } = report;
  const short = commitSha ? commitSha.slice(0, 7) : '';

  const imgUrl = (file) => `${server}/${repo}/raw/${snapSha}/${prefix}/${file}`;
  const img = (file, w = 260) => `<img src="${imgUrl(file)}" width="${w}" alt="">`;
  const pct = (r) => `${(r * 100).toFixed(2)}%`;
  const titleOf = (i) => `${i.title} › ${i.name} · <i>${i.theme}</i>`;

  const changed = items.filter((i) => i.status === 'changed');
  const added = items.filter((i) => i.status === 'added');
  const removed = items.filter((i) => i.status === 'removed');
  const hasChanges = changed.length + added.length + removed.length > 0;

  body = `${MARKER}\n${HEADING}\n\n`;

  if (!hasChanges) {
    body += `✅ **No visual changes** detected across ${totals.unchanged} stor${totals.unchanged === 1 ? 'y' : 'ies'}`;
    body += short ? ` · \`${short}\`\n` : `\n`;
  } else {
    const parts = [];
    if (changed.length) parts.push(`🔴 **${changed.length}** changed`);
    if (added.length) parts.push(`🟢 **${added.length}** added`);
    if (removed.length) parts.push(`⚪ **${removed.length}** removed`);
    parts.push(`${totals.unchanged} unchanged`);
    body += `${parts.join(' · ')}${short ? ` · \`${short}\`` : ''}\n\n`;

    if (changed.length) {
      body += `### 🔴 Changed\n\n`;
      changed.slice(0, MAX_RENDER).forEach((i, idx) => {
        const sz = i.sizeChanged ? ' · size changed' : '';
        const open = idx < MAX_OPEN ? ' open' : '';
        body += `<details${open}>\n<summary><b>${titleOf(i)}</b> — ${i.diffPixels.toLocaleString()} px (${pct(i.ratio)})${sz}</summary>\n\n`;
        body += `| Before | After | Diff |\n| :--: | :--: | :--: |\n`;
        body += `| ${img(i.images.before)} | ${img(i.images.after)} | ${img(i.images.diff)} |\n\n`;
        body += `</details>\n\n`;
      });
      if (changed.length > MAX_RENDER) body += `_…and ${changed.length - MAX_RENDER} more changed stories._\n\n`;
    }
    if (added.length) {
      body += `### 🟢 Added\n\n`;
      for (const i of added.slice(0, MAX_RENDER)) {
        body += `<details>\n<summary><b>${titleOf(i)}</b> — new story</summary>\n\n${img(i.images.after, 320)}\n\n</details>\n\n`;
      }
    }
    if (removed.length) {
      body += `### ⚪ Removed\n\n`;
      for (const i of removed.slice(0, MAX_RENDER)) {
        body += `<details>\n<summary><b>${titleOf(i)}</b> — removed</summary>\n\n${img(i.images.before, 320)}\n\n</details>\n\n`;
      }
    }
  }
  body += `\n<sub>🤖 Visual regression bot · compares this PR against its base branch · updates on every push.</sub>`;
}

if (process.env.DRY_RUN) {
  console.log(body);
  process.exit(0);
}

const api = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
  'user-agent': 'visual-regression-bot',
};

async function gh(method, url, bodyObj) {
  const res = await fetch(url, { method, headers, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const comments = await gh('GET', `${api}/repos/${repo}/issues/${pr}/comments?per_page=100`);
const existing = comments.find((c) => c.body && c.body.includes(MARKER));
if (existing) {
  await gh('PATCH', `${api}/repos/${repo}/issues/comments/${existing.id}`, { body });
  console.log(`updated sticky comment ${existing.id}`);
} else {
  const created = await gh('POST', `${api}/repos/${repo}/issues/${pr}/comments`, { body });
  console.log(`created sticky comment ${created.id}`);
}
