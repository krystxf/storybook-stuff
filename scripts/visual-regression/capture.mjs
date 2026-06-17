// Screenshot every Storybook story (per theme) from a built `storybook-static` dir.
//
//   node capture.mjs --static <storybook-static> --out <dir> [--themes light,dark] [--concurrency 4]
//
// Writes <out>/<storyId>__<theme>.png and <out>/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { listStories, ensureDir, safe, parseArgs } from './lib.mjs';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain',
};

function serve(root) {
  const resolvedRoot = path.resolve(root);
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/' || p === '') p = '/index.html';
        const file = path.join(resolvedRoot, p);
        if (!file.startsWith(resolvedRoot)) {
          res.writeHead(403); res.end(); return;
        }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          res.writeHead(404); res.end('not found'); return;
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const args = parseArgs(process.argv.slice(2));
const staticDir = args.static;
const outDir = args.out;
const themes = String(args.themes || 'light').split(',').map((s) => s.trim()).filter(Boolean);
const concurrency = parseInt(args.concurrency || '4', 10);

if (!staticDir || !outDir) {
  console.error('Usage: capture.mjs --static <dir> --out <dir> [--themes light,dark]');
  process.exit(1);
}

ensureDir(outDir);
const stories = listStories(staticDir);
const server = await serve(staticDir);
const { port } = server.address();
const browser = await chromium.launch();

const tasks = [];
for (const s of stories) for (const theme of themes) tasks.push({ s, theme });

const manifest = [];
let cursor = 0;

async function worker() {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  for (;;) {
    const t = tasks[cursor++];
    if (!t) break;
    const { s, theme } = t;
    const url = `http://127.0.0.1:${port}/iframe.html?id=${encodeURIComponent(s.id)}&viewMode=story&globals=theme:${theme}`;
    const file = `${safe(s.id)}__${theme}.png`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Kill animations/transitions and the blinking caret for stable pixels.
      await page.addStyleTag({
        content: '*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;caret-color:transparent!important}',
      });
      await page.waitForSelector('#storybook-root', { state: 'attached', timeout: 15000 });
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      await page.waitForTimeout(150);

      const root = await page.$('#storybook-root');
      const box = root && (await root.boundingBox());
      let buf;
      if (root && box && box.width > 1 && box.height > 1) {
        buf = await root.screenshot({ animations: 'disabled' });
      } else {
        buf = await page.screenshot({ animations: 'disabled', fullPage: true });
      }
      fs.writeFileSync(path.join(outDir, file), buf);
      manifest.push({ id: s.id, title: s.title, name: s.name, theme, file });
    } catch (e) {
      console.error(`  ✗ ${s.id} [${theme}]: ${e.message}`);
      manifest.push({ id: s.id, title: s.title, name: s.name, theme, file: null, error: e.message });
    }
  }
  await ctx.close();
}

await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) || 1 }, worker));
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
server.close();

const ok = manifest.filter((m) => m.file).length;
console.log(`captured ${ok}/${tasks.length} screenshots (themes: ${themes.join(', ')}) -> ${outDir}`);
if (ok < tasks.length) process.exitCode = 1;
