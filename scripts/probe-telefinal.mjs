import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player && window._f2Stats && window._debugChunks && window._debugProvider, null, { timeout: 240000 });
const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(8000);
  const G = [11000, -6000];
  // OLD path: no initPreload, long settle
  window._player.x = G[0]; window._player.y = G[1]; window._debugChunks.streamAround(...G);
  await wait(22000); const oldFull = window._f2PoolN || 0;
  // reset
  window._player.x = 300; window._player.y = 300; await wait(8000);
  // FIXED path
  window._player.x = G[0]; window._player.y = G[1]; window._debugChunks.streamAround(...G); window._debugProvider.initPreload(G[0], G[1], true);
  const early = []; let prev=0; for (const t of [800,1500,3000]) { await wait(t-prev); prev=t; early.push({t, n: window._f2PoolN||0}); }
  await wait(20000); const fixFull = window._f2PoolN || 0;
  return { oldFull, fixEarly: early, fixFull };
});
console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0,5) }, null, 2));
await browser.close();
