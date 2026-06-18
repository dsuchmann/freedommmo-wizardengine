// scripts/probe-f2-perf.mjs — does the persistent pool actually stay
// persistent? Asserts rebuild/dirty invariants via window._f2Stats while
// panning the camera. Run with dev server up; PROBE_PORT to override :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const PORT = process.env.PROBE_PORT || 8741;
await page.goto(`http://localhost:${PORT}/?x=1312&y=1312`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._f2Stats && window._dbgRenderer && window._lighting
  && window._f2Stats.rebuilds > 0, null, { timeout: 240000 });
await page.waitForTimeout(5000); // let chunk loads + initial rebuilds settle

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window._lighting.paused = true;
  window._lighting.time = 0.5;
  const p = window._player || window._dbgPlayer;
  // settle: wait until rebuilds stop changing
  let last = window._f2Stats.rebuilds;
  for (let i = 0; i < 20; i++) { await wait(500); if (window._f2Stats.rebuilds === last) break; last = window._f2Stats.rebuilds; }

  // Leg 1: stand still 3s — zero rebuilds, dirty stays small.
  const r0 = window._f2Stats.rebuilds;
  let maxDirty = 0, samples = 0, dirtySum = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    await wait(100);
    maxDirty = Math.max(maxDirty, window._f2Stats.dirtyInstances);
    dirtySum += window._f2Stats.dirtyInstances; samples++;
  }
  const idleRebuilds = window._f2Stats.rebuilds - r0;

  // Leg 2: sub-tile pan — move the player by 0.4 tiles (no floor() change).
  const r1 = window._f2Stats.rebuilds;
  const startX = p.x;
  for (let s = 0; s < 8; s++) { p.x = startX + 0.05 * (s + 1); await wait(100); }
  p.x = startX;
  await wait(300);
  const subTileRebuilds = window._f2Stats.rebuilds - r1;

  // Leg 3: cross a few tile boundaries but stay WITHIN the hysteresis margin
  // (3 tiles < REBUILD_MARGIN) — the pool must NOT rebuild (the whole point).
  const r2 = window._f2Stats.rebuilds;
  p.x = startX + 3;
  await wait(800);
  const subMarginRebuilds = window._f2Stats.rebuilds - r2;

  // Leg 4: move PAST the margin (6 tiles > REBUILD_MARGIN) — exactly one
  // re-center rebuild (a handful at most), not one-per-tile.
  const r3 = window._f2Stats.rebuilds;
  p.x = startX + 9;
  await wait(900);
  const crossRebuilds = window._f2Stats.rebuilds - r3;
  p.x = startX;
  await wait(900);

  return { idleRebuilds, subTileRebuilds, subMarginRebuilds, crossRebuilds, maxDirty,
    avgDirty: dirtySum / samples, poolN: window._f2PoolN || 0,
    activeCount: window._f2Stats.activeCount };
});

console.log(JSON.stringify(res, null, 2));
await browser.close();
// maxDirty: in headless mode rAF is ~1fps, so wind-triggered blades
// accumulate between frames and most of the pool appears active. The real
// invariant is that dirty << poolN (no full rebuilds every frame). At 60fps
// the active set is typically ~50-200; in headless it can be most of the pool.
const ok = res.idleRebuilds === 0 && res.subTileRebuilds === 0
  && res.subMarginRebuilds === 0           // hysteresis: sub-margin walk = no rebuild
  && res.crossRebuilds >= 1 && res.crossRebuilds <= 4
  && res.maxDirty < res.poolN;
console.log(ok ? 'F2 PERF PROBE PASSED' : 'F2 PERF PROBE FAILED');
process.exit(ok ? 0 : 1);
