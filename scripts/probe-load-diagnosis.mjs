// scripts/probe-load-diagnosis.mjs — why does the world never finish loading?
// Captures console volume + what's spamming + ready-state over 90s, on the
// isolated perf-opt worktree (port 8130).
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();

// tally console messages by normalized prefix
const tally = new Map();
let total = 0;
page.on('console', m => {
  total++;
  const t = m.text().replace(/-?\d+/g, '#').slice(0, 60);
  tally.set(t, (tally.get(t) || 0) + 1);
});
page.on('pageerror', e => { tally.set('PAGEERROR: ' + e.message.slice(0, 80), (tally.get('PAGEERROR') || 0) + 1); });

await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });

const samples = [];
for (let i = 0; i < 18; i++) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => {
    const r = window._dbgRenderer;
    let chunkCount = -1;
    try { chunkCount = window._chunks ? (window._chunks.size ?? window._chunks.count ?? -1) : -1; } catch (e) {}
    return {
      glcOk: !!(r && r.glc && r.glc.ok),
      f2Ready: (typeof window.__f2ready !== 'undefined') ? window.__f2ready : null,
      f2PoolN: window._f2PoolN ?? null,
      perf: window._perf ? { fps: +window._perf.fps.toFixed(0), upd: +window._perf.updateMs.toFixed(0), draw: +window._perf.drawMs.toFixed(0) } : null,
      consoleTotal: 0,
    };
  });
  s.t = (i + 1) * 5;
  s.consoleTotal = total;
  samples.push(s);
}

// top console spammers — PRINT FIRST (screenshot can hang on a busy page)
const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(JSON.stringify({
  totalConsoleMessages: total,
  msgsPerSecApprox: +(total / 90).toFixed(1),
  topSpammers: top.map(([k, v]) => `${v}x  ${k}`),
  samples,
}, null, 2));
try {
  await page.screenshot({ path: 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default/screenshots/perf-opt-load.png', timeout: 8000, animations: 'disabled' });
  console.log('screenshot saved');
} catch (e) { console.log('screenshot skipped (page busy):', e.message.slice(0, 40)); }
await browser.close();
