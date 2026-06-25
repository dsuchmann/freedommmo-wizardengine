// scripts/probe-field-studio.mjs — headless smoke for tools/field-studio.html (self-serving)
// Spins up a tiny static server rooted at the worktree repo root, then Playwright-drives the dashboard.
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/tools/field-studio.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
let exitCode = 0;
try {
  await page.goto(`${base}/tools/field-studio.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.cell', { timeout: 20000 });
  const nCells = await page.$$eval('.cell', els => els.length);
  if (nCells < 100) throw new Error(`too few cells: ${nCells}`);
  await page.click('.cell');
  const omitted = await page.$eval('.cell', el => el.classList.contains('omit'));
  const picks = await page.evaluate(() => window.__exportPicks());
  const total = Object.values(picks.decisions).reduce((n, d) => n + d.omit.length, 0);
  console.log(`cells=${nCells} firstOmit=${omitted} exportOmits=${total} field=${picks.field}`);
  if (!omitted || total < 1) throw new Error('omit toggle/export failed');
  console.log('PASS');
} catch (e) {
  console.error('FAIL', e.message); exitCode = 1;
} finally {
  await browser.close(); server.close();
}
process.exit(exitCode);
