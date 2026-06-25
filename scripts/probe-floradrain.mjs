// probe-floradrain.mjs — validate the flora despawn/drain fix (separate from the overmap
// fix, already confirmed). swiftshader builds the GPU pool slowly, so we settle LONG, then
// walk in larger steps with long gaps so each amortized rebuild completes between steps —
// this mimics real-hardware steady state where builds keep up. The fix is correct if poolN
// holds near its baseline while walking (old behaviour: monotonic drain 2527 -> 132).
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._player && window._f2Stats && window._debugChunks && window._debugProvider, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const poolN = () => window._f2PoolN || 0;

  // Settle LONG in vegetated grassland so the GPU pool fully builds at swiftshader fps.
  window._player.x = 11000; window._player.y = -6000;
  window._debugChunks.streamAround(11000, -6000);
  window._debugProvider.initPreload(11000, -6000, true);
  let baseline = 0;
  for (let i = 0; i < 30; i++) { // up to ~45s, stop early once the pool is built & stable
    await wait(1500);
    const n = poolN();
    if (n > 0 && n === baseline) break; // stable
    baseline = n;
  }

  // Walk south in 4-tile steps with 4s gaps (each rebuild completes in the gap). Confirm
  // the pool does NOT drain. moved fires every GPU_REBUILD_MARGIN tiles (~every 3 steps).
  const r0 = window._f2Stats.rebuilds;
  const skip0 = window._f2Stats.commitSkipped || 0;
  const samples = [{ y: window._player.y, poolN: poolN() }];
  let poolMin = poolN();
  for (let step = 0; step < 16; step++) {
    for (let k = 0; k < 4; k++) { window._player.y += 1; window._debugChunks.streamAround(window._player.x, window._player.y); await wait(120); }
    await wait(3200); // let the rebuild (if any) finish
    const n = poolN();
    if (n < poolMin) poolMin = n;
    samples.push({ y: window._player.y, poolN: n });
  }

  return {
    baseline,
    poolMinDuringWalk: poolMin,
    poolEnd: poolN(),
    rebuilds: window._f2Stats.rebuilds - r0,
    commitSkipped: (window._f2Stats.commitSkipped || 0) - skip0,
    drainPct: baseline > 0 ? +(100 * (1 - poolMin / baseline)).toFixed(1) : null,
    samples,
  };
});

console.log(JSON.stringify({ ...res, pageErrors: errors.slice(0, 5) }, null, 2));
await browser.close();
