// scripts/probe-field-tuning.mjs — field-tuning integration probe.
// Asserts: (1) empty tree -> placements identical before/after a tuner
// round-trip; (2) density 0 hides an F3 biome; (3) F4 size x2 doubles
// sizeTiles. Run with the dev server up on :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
// grassland teleport spot (tiles guaranteed loaded around the player)
await page.goto('http://localhost:8741/?x=1312&y=1312', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._claims && window._fieldTuning && window._dbgChunkStore
  && window._dbgChunkStore.tileAt(1312, 1312), null, { timeout: 60000 });
await page.waitForTimeout(2000); // let nearby chunks finish

const res = await page.evaluate(() => {
  const sample = (fn) => {
    const out = [];
    for (let wy = 1300; wy < 1325; wy++)
      for (let wx = 1300; wx < 1325; wx++)
        out.push(fn(wx, wy));
    return JSON.stringify(out);
  };
  const f3 = () => sample((x, y) => window._claims.placements(x, y).map(p => [p.name, p.variant, +p.scale.toFixed(4)]));
  const f4 = () => sample((x, y) => window._claims.f4(x, y).map(p => [p.name, p.variant, +p.sizeTiles.toFixed(4)]));

  const baseF3 = f3(), baseF4 = f4();

  // (2) F3 grassland density 0 -> no placements
  window._fieldTuning.set({ f2: {}, f3: { biomes: { grassland: { density: 0 } } }, f4: {} });
  const f3Hidden = f3();
  const hiddenOk = JSON.parse(f3Hidden).every(a => a.length === 0);

  // (3) F4 grassland size 2x -> every sizeTiles doubles
  window._fieldTuning.set({ f2: {}, f3: {}, f4: { biomes: { grassland: { size: 2 } } } });
  const f4Big = JSON.parse(f4()), f4Base = JSON.parse(baseF4);
  let doubleOk = true, pairs = 0;
  for (let i = 0; i < f4Base.length; i++) {
    for (let j = 0; j < f4Base[i].length; j++) {
      pairs++;
      if (Math.abs(f4Big[i][j][2] - f4Base[i][j][2] * 2) > 1e-3) doubleOk = false;
    }
  }

  // (1) reset -> byte-identical to baseline (regression gate)
  window._fieldTuning.set({ f2: {}, f3: {}, f4: {} });
  const resetOk = f3() === baseF3 && f4() === baseF4;

  return { hiddenOk, doubleOk, pairs, resetOk, f3Count: JSON.parse(baseF3).flat().length };
});
console.log(JSON.stringify(res));
await browser.close();
if (!res.hiddenOk || !res.doubleOk || !res.resetOk || res.pairs === 0 || res.f3Count === 0) {
  console.error('FIELD TUNING PROBE FAILED');
  process.exit(1);
}
console.log('FIELD TUNING PROBE PASSED');
