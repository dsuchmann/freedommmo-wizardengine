import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._f2Stats, null, { timeout: 240000 });
const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(12000);
  const r0 = window._f2Stats.rebuilds;
  await wait(3000);
  const rebuildsIn3s = window._f2Stats.rebuilds - r0;
  // expose a tiny hook: count, over one frame, how many active sprites are at restFrame
  // (frameIdx unchanged => memo-eligible) vs animating. We piggyback by reading meta.
  // _pool isn't exported, but window._f2dbg can be added; fall back to stats only.
  return { rebuildsIn3s, activeCount: window._f2Stats.activeCount, ticks: window._f2Stats.ticks, hasF2dbg: !!window._f2dbg };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
