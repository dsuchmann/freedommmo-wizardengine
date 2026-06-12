// scripts/probe-f6-visual.mjs — do F6 trees render, and are the tuner
// sliders live? F6 (192px trees) draws per-frame onto the main 2d canvas
// via the field2-animator pool. We teleport to forest, freeze lighting,
// silence F2/F4 (density 0) so wind sway can't pollute captures, then:
//   1. density: F6 master density 0 vs 30 must move >= 2000 pixels
//      (one 192px tree alone clears that; density 30 -> ~0.9 trees/tile).
//   2. size: at density 30, master size 1.0 vs 0.5 must move >= 500 pixels.
// Defaults are restored at the end. Run with dev server up on :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', m => { if (/fieldTuning|error/i.test(m.text())) console.log('[page]', m.text()); });
const PORT = process.env.PROBE_PORT || 8741;

const FOREST_F6 = ['apple', 'beech', 'oak']; // LG_CATALOG forest roster

// Deterministic forest hunt: fixed candidate order, first 'forest' tile wins.
// First spot is the tuner's own forest teleport (src/dev/field-tuner.js).
const SPOTS = [
  { x: -480, y: 2080 }, { x: -512, y: 2112 }, { x: -448, y: 2048 },
  { x: -416, y: 2144 }, { x: -544, y: 2016 }, { x: -480, y: 2208 },
];
let spot = null;
for (const s of SPOTS) {
  await page.goto(`http://localhost:${PORT}/?x=${s.x}&y=${s.y}`, { waitUntil: 'domcontentloaded' });
  // Wait for the player's own chunk bitmap (chunkSize = 64) to be painted.
  await page.waitForFunction(() => window._fieldTuning && window._dbgRenderer && window._lighting
    && window._debugProvider && window._player
    && window._debugProvider.getBitmap(Math.floor(window._player.x / 64), Math.floor(window._player.y / 64)),
    null, { timeout: 240000 });
  await page.waitForTimeout(5000); // let painting + preload settle
  const biome = await page.evaluate(() => {
    const p = window._player;
    const t = window._dbgChunkStore.tileAt(Math.floor(p.x), Math.floor(p.y));
    return t ? t.biome : null;
  });
  if (biome === 'forest') { spot = s; break; }
  console.log(`spot ${s.x},${s.y} is '${biome}' — trying next candidate`);
}
if (!spot) {
  console.log('FAIL: no forest tile found in deterministic scan list');
  await browser.close();
  process.exit(1);
}
console.log(`forest spot: ${spot.x},${spot.y}`);

const res = await page.evaluate(async (objNames) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Force the Canvas 2D path so F6 lands on the readable #game canvas,
  // and freeze the day/night cycle (full cycle is ~83s — major pixel drift).
  window._dbgRenderer.useGL = false;
  window._lighting.paused = true;
  window._lighting.time = 0.5; // midday
  await wait(800);

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const RW = 768, RH = 512;
  const rx = (canvas.width - RW) >> 1, ry = (canvas.height - RH) >> 1;

  function capture() {
    return ctx.getImageData(rx, ry, RW, RH).data.slice();
  }
  function diffCount(a, b) { // pixels whose summed RGB delta exceeds noise
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
    }
    return n;
  }
  // Quiet tree: F2/F4 silenced, F6 wind gated off per-object, plus extras.
  // F2 density 0 still leaves fertility accent blades (bladeCount =
  // 0 + floor(fertility*3)), so forest F2 wind anims are gated off too.
  const wil = await import('/src/render/wang-image-list.js');
  const f2Objects = {};
  for (const name of (wil.SF_BIOME_OBJECTS_LIST.forest || []))
    f2Objects[name] = { anims: { wind_sway: false } };
  function setTree(f6extra) {
    const objects = {};
    for (const name of objNames) objects[name] = { anims: { wind_sway: false } };
    const t = window._fieldTuning.tree();
    t.f2 = { density: 0, biomes: { forest: { objects: f2Objects } } };
    t.f4 = { density: 0 };
    t.f6 = Object.assign({ biomes: { forest: { objects } } }, f6extra || {});
    window._fieldTuning.apply('f6');
  }

  // --- noise floor: two captures at F6 density 0, nothing else moving ---
  setTree({ density: 0 });
  await wait(4000); // async chunk repaints pollute captures — let them settle
  const d0 = capture();
  await wait(1500);
  const floor = diffCount(d0, capture());

  // --- density leg: 0 -> 30 must put trees on screen ---
  setTree({ density: 30 });
  await wait(5000); // settle + first-time tree sprite loads
  const d30 = capture();
  const densityDiff = diffCount(d0, d30);

  // Diagnostics: ask the placement oracle directly how many trees are near
  // the player at density 30 (same module instance the renderer uses).
  const m = await import('/src/world/decoration-claims.js');
  const p = window._player;
  const ti = (x, y) => window._dbgChunkStore.tileAt(x, y);
  let placements = 0;
  for (let dy = -10; dy <= 10; dy++)
    for (let dx = -10; dx <= 10; dx++)
      placements += m.f6Placements(Math.floor(p.x) + dx, Math.floor(p.y) + dy, ti).length;

  // --- size leg: density 30, master size 1.0 vs 0.5 ---
  setTree({ density: 30, size: 0.5 });
  await wait(4000);
  const s05 = capture();
  const sizeDiff = diffCount(d30, s05);

  // --- restore defaults (empty nodes = baked defaults) ---
  const t = window._fieldTuning.tree();
  t.f2 = {}; t.f4 = {}; t.f6 = {};
  window._fieldTuning.apply('f6');
  await wait(1000);

  return { floor, densityDiff, sizeDiff, placements };
}, FOREST_F6);

console.log(JSON.stringify(res, null, 2));
await browser.close();

// 1. density 0 -> 30 must move >= 2000 pixels (192px trees are huge).
// 2. size 1.0 -> 0.5 at density 30 must move >= 500 pixels.
// Both must also clear the frozen-scene noise floor by 3x.
const densityOk = res.densityDiff >= 2000 && res.densityDiff > res.floor * 3;
const sizeOk = res.sizeDiff >= 500 && res.sizeDiff > res.floor * 3;
if (!densityOk) console.log(`FAIL density: diff ${res.densityDiff} px (need >= 2000, floor ${res.floor}); oracle saw ${res.placements} placements near player — if 0, f6 tuning isn't reaching f6Placements`);
if (!sizeOk) console.log(`FAIL size: diff ${res.sizeDiff} px (need >= 500, floor ${res.floor})`);
console.log(`density 0->30: ${res.densityDiff} px; size 1.0->0.5: ${res.sizeDiff} px; floor ${res.floor}; placements ${res.placements}`);
console.log(densityOk && sizeOk ? 'F6 VISUAL PROBE PASSED' : 'F6 VISUAL PROBE FAILED');
process.exit(densityOk && sizeOk ? 0 : 1);
