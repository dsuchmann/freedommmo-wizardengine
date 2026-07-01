// probe-buildresolve.mjs — confirm the building-resolve freeze is gone in a REAL browser.
// resolveBuildingsInRange is pure CPU, so swiftshader (slow GPU) doesn't distort it.
// Walks the player across many macro-cell boundaries and reads the worst resolve + breakdown.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(6000); // let the world settle
  window._dbgResolveMax = 0; window._dbgResolveN = 0; window._dbgResolveBreakdown = null;
  // Walk diagonally across many macro boundaries (64 tiles each) to force fresh resolves.
  const startX = window._player.x, startY = window._player.y;
  const walk = setInterval(() => { if (window._player) { window._player.x += 1.1; window._player.y += 0.5; } }, 30);
  await wait(28000);
  clearInterval(walk);
  return {
    resolveCalls: window._dbgResolveN || 0,
    worstResolveMs: +(window._dbgResolveMax || 0).toFixed(1),
    worstBreakdown: window._dbgResolveBreakdown,
    tilesWalked: Math.round(window._player.x - startX) + ',' + Math.round(window._player.y - startY),
  };
});
console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0, 5) }, null, 2));
await browser.close();
