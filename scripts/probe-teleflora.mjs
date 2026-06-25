// probe-teleflora.mjs — verify the teleport flora fix. Compares the OLD teleport path
// (set player.x/y + streamAround, NO initPreload) against the FIXED path (also calls
// provider.initPreload(x,y,true)). Uses the real exposed hooks window._debugChunks /
// window._debugProvider. Flora is pure-CPU-driven so swiftshader timing is representative
// of "did it load", though absolute seconds run slower than 60fps.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player && window._f2Stats && window._debugChunks && window._debugProvider, null, { timeout: 240000 });

// Vegetated destinations (grassland/hills/taiga) far apart so each forces fresh streaming.
const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const poolN = () => window._f2PoolN || 0;
  await wait(8000);

  async function teleport(x, y, withFix) {
    window._player.x = x; window._player.y = y;
    window._debugChunks.streamAround(x, y);
    if (withFix) window._debugProvider.initPreload(x, y, true); // the fix
    const curve = [];
    let prev = 0;
    for (const t of [1000, 2000, 4000, 8000, 15000]) { await wait(t - prev); prev = t; curve.push({ t, poolN: poolN() }); }
    return curve;
  }

  return {
    OLD_noPreload_grassland: await teleport(11000, -6000, false),
    spacer1: (window._player.x = 300, window._player.y = 300, await wait(6000), 'reset'),
    FIX_withPreload_hills: await teleport(-3000, -9000, true),
    spacer2: (window._player.x = 300, window._player.y = 300, await wait(6000), 'reset'),
    FIX_withPreload_taiga: await teleport(8000, 8000, true),
  };
});

console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0, 5) }, null, 2));
await browser.close();
