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
  window.__mh = 0; window.__mm = 0;
  await wait(3000);
  const hit = window.__mh|0, miss = window.__mm|0;
  return { active: window._f2Stats.activeCount, hit, miss, hitRate: +(hit/(hit+miss||1)).toFixed(3), total: hit+miss };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
