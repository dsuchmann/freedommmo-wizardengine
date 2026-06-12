// Headless probe: sim debug overlay draws path/road/delta shapes + ticker.
// Injects a fake _simClient (no sim server needed); toggles via window._simDebugOverlay.
// Like probe-f2-visual.mjs: force the Canvas 2D path (overlay draws on the
// readable #game canvas) and freeze the day/night cycle for a quiet baseline.
// Run with dev server up on :8741.
import { chromium } from 'playwright-core';

const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', m => { if (/error/i.test(m.text())) console.log('[page]', m.text()); });
await page.goto('http://localhost:8741/?x=1312&y=1312', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._simDebugOverlay && window._dbgRenderer && window._lighting && window._fieldTuning, null, { timeout: 60000 });
await page.waitForTimeout(4000); // let chunks render

const GRASSLAND_F2 = ['tall_grass_blade', 'dandelion_stem', 'wild_herb'];

const result = await page.evaluate(async (objNames) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Force Canvas 2D so the overlay lands on the readable #game canvas,
  // freeze the day/night cycle, and disable F2 wind_sway (ambient drift
  // and flora animation would pollute the pixel diffs).
  window._dbgRenderer.useGL = false;
  window._lighting.paused = true;
  window._lighting.time = 0.5; // midday
  {
    const objects = {};
    for (const name of objNames) objects[name] = { anims: { wind_sway: false } };
    const t = window._fieldTuning.tree();
    t.f2 = { biomes: { grassland: { objects } } };
    window._fieldTuning.apply('f2');
  }
  await wait(4000); // let the f2 re-tune's chunk repaint fully settle

  // fake sim state centered on the player so shapes land on screen
  const px = 1312, py = 1312;
  const entities = new Map();
  for (let i = 0; i < 6; i++) entities.set('p' + i, { id: 'p' + i, type: 'path', x: px - 3 + i, y: py, wear: i * 2 });
  entities.set('r0', { id: 'r0', type: 'matter', archetype: 'road_segment', x: px, y: py + 2 });
  window._simClient = { tick: 999, entities, deltas: [{ id: 1, tick: 1, x: px + 1, y: py + 2, target: 'r0', kind: 'paved', attrs: {} }], events: [{ id: 1, tick: 998, type: 'settlement_founded', actor: 5, targets: [], magnitude: 1 }] };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const grab = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice();
  const diffCount = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i+1] !== b[i+1] || a[i+2] !== b[i+2]) n++; return n; };

  await wait(500);
  const before = grab();
  window._simDebugOverlay.toggle();
  await wait(500);
  const after = grab();
  window._simDebugOverlay.toggle();
  await wait(500);
  const restored = grab();
  return { enabledDiff: diffCount(before, after), restoredDiff: diffCount(before, restored), enabled: window._simDebugOverlay.isEnabled() };
}, GRASSLAND_F2);

console.log(JSON.stringify(result));
await browser.close();
// overlay must change a meaningful pixel area when on, and mostly restore when off
if (result.enabledDiff < 500) { console.error('FAIL: overlay drew almost nothing'); process.exit(1); }
if (result.restoredDiff > result.enabledDiff * 0.5) { console.error('FAIL: overlay did not clear on toggle-off'); process.exit(1); }
console.log('PROBE PASS: overlay draws and clears');
