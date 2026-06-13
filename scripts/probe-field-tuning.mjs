// scripts/probe-field-tuning.mjs — field-tuning integration probe.
// Asserts: (1) empty tree -> placements identical before/after a tuner
// round-trip; (2) density 0 hides an F3 biome; (3) F4 size x2 doubles
// sizeTiles; (4) field registry order includes f5; (5) F5 density/size/state
// tuning works. Run with the dev server up on :8741 (or $PROBE_PORT).
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
// grassland teleport spot (tiles guaranteed loaded around the player)
const PORT = process.env.PROBE_PORT || 8741;
await page.goto(`http://localhost:${PORT}/?x=1312&y=1312`, { waitUntil: 'domcontentloaded' });
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

  // (4) registry-driven tabs include f5 in order
  // NOTE: update this expected list when F6/F7 register in the field registry.
  const registryOk = JSON.stringify(window._fieldRegistry) === JSON.stringify(['f2', 'f3', 'f4', 'f5', 'f6']);

  // (5) F5 placements exist and respond to density/size/state tuning
  const f5 = () => sample((x, y) => window._claims.f5(x, y).map(p => [p.name, p.variant, +p.sizeTiles.toFixed(4), p.state]));
  // reset tuning to a clean state before capturing the F5 baseline (F4 size:2 set above)
  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: {} });
  const baseF5Str = f5();
  const baseF5 = JSON.parse(baseF5Str);
  const f5Count = baseF5.reduce((n, a) => n + a.length, 0);

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { density: 0 } } } });
  const f5HiddenOk = JSON.parse(f5()).every(a => a.length === 0);

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { size: 2 } } } });
  const f5Big = JSON.parse(f5());
  let f5DoubleOk = true, f5Pairs = 0;
  for (let i = 0; i < baseF5.length; i++) {
    for (let j = 0; j < baseF5[i].length; j++) {
      f5Pairs++;
      if (Math.abs(f5Big[i][j][2] - baseF5[i][j][2] * 2) > 1e-3) f5DoubleOk = false;
    }
  }

  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: { biomes: { grassland: { states: { enchanted: 1 } } } } });
  const f5EnchOk = JSON.parse(f5()).every(a => a.every(p => p[3] === 'enchanted'));

  // (1) reset -> byte-identical to baseline (regression gate)
  window._fieldTuning.set({ f2: {}, f3: {}, f4: {}, f5: {} });
  const resetOk = f3() === baseF3 && f4() === baseF4 && f5() === baseF5Str;

  return { hiddenOk, doubleOk, pairs, resetOk, f3Count: JSON.parse(baseF3).flat().length,
    registryOk, f5Count, f5HiddenOk, f5DoubleOk, f5Pairs, f5EnchOk };
});
console.log(JSON.stringify(res));
await browser.close();
console.log(`registryOk=${res.registryOk} f5Count=${res.f5Count} f5HiddenOk=${res.f5HiddenOk} f5DoubleOk=${res.f5DoubleOk} (pairs=${res.f5Pairs}) f5EnchOk=${res.f5EnchOk}`);
if (!res.hiddenOk || !res.doubleOk || !res.resetOk || res.pairs === 0 || res.f3Count === 0
  || !res.registryOk || !(res.f5Count > 0) || !res.f5HiddenOk || !(res.f5DoubleOk && res.f5Pairs > 0) || !res.f5EnchOk) {
  console.error('FIELD TUNING PROBE FAILED');
  process.exit(1);
}
console.log('FIELD TUNING PROBE PASSED');
