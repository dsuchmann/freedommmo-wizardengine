// probe-walkverify.mjs — verify the walk-stutter fixes.
//  (1) Overmap: a recenter while walking should now be an incremental strip (~ a few ms),
//      NOT the old ~1000ms synchronous full resample. We establish the base with one
//      forced full redraw, then step the player by one snapped pixel (chunkScale*chunkSize
//      tiles) and time draw() — that is the walking-recenter cost.
//  (2) Flora: walking south should keep the pool FULL (no 2527->132 drain / despawn).
// Uses the temp hooks added to main.js (_dbgOvermap, _dbgFrame) + _f2Stats/_f2PoolN.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player && window._f2Stats && window._dbgOvermap && window._debugChunks && window._debugProvider, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ov = window._dbgOvermap;
  const CHUNK = 64; // WORLD.chunkSize
  const cs = ov.chunkScale || 2;

  // Settle in vegetated grassland.
  window._player.x = 11000; window._player.y = -6000;
  window._debugChunks.streamAround(11000, -6000);
  window._debugProvider.initPreload(11000, -6000, true);
  await wait(12000);

  // (1) OVERMAP recenter cost. First a forced full redraw (baseline ~1s, establishes base).
  let t0 = performance.now();
  ov.draw(true);
  const fullMs = performance.now() - t0;
  // Now step ONE snapped pixel east (cs*CHUNK tiles) and time the incremental recenter.
  const recenterMs = [];
  for (let i = 0; i < 4; i++) {
    window._player.x += cs * CHUNK; // moves the snapped base center by exactly 1 pixel
    t0 = performance.now();
    ov.draw();
    recenterMs.push(+(performance.now() - t0).toFixed(2));
  }

  // (2) FLORA drain while walking south. Reset to grassland, let the pool build, then walk.
  window._player.x = 11000; window._player.y = -6000;
  window._debugChunks.streamAround(11000, -6000);
  window._debugProvider.initPreload(11000, -6000, true);
  await wait(12000); // build the pool

  const r0 = window._f2Stats.rebuilds;
  const skip0 = window._f2Stats.commitSkipped || 0;
  window._dbgFrame.overmapMs = 0; window._dbgFrame.overmapMax = 0; window._dbgFrame.overmapCalls = 0;
  const startY = window._player.y;
  const samples = [];
  let poolMin = Infinity, poolStart = window._f2PoolN || 0;
  for (let i = 0; i < 80; i++) {
    window._player.y += 1; // step south one tile
    window._debugChunks.streamAround(window._player.x, window._player.y);
    await wait(150);
    const n = window._f2PoolN || 0;
    if (n < poolMin) poolMin = n;
    if (i % 8 === 0 || i === 79) samples.push({ y: window._player.y, poolN: n, rebuilds: window._f2Stats.rebuilds - r0, overmapMax: +window._dbgFrame.overmapMax.toFixed(1) });
  }

  return {
    overmap: { fullMs: +fullMs.toFixed(1), recenterMs, chunkScale: cs },
    flora: {
      tilesWalked: window._player.y - startY,
      poolStart, poolMin: poolMin === Infinity ? 0 : poolMin, poolEnd: window._f2PoolN || 0,
      rebuilds: window._f2Stats.rebuilds - r0,
      commitSkipped: (window._f2Stats.commitSkipped || 0) - skip0,
      overmapMaxDuringWalk: +window._dbgFrame.overmapMax.toFixed(1),
      samples,
    },
  };
});

console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0, 5) }, null, 2));
await browser.close();
