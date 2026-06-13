// scripts/probe-f2-visual.mjs — do F2 tuner edits visibly change the frame?
// F2 (small flora) draws per-frame onto the main 2d canvas. To get a quiet
// noise floor we freeze the day/night cycle and use the tuner's own
// wind_sway anim gate (which doubles as a visual check of that gate), then
// require density-0 / size-2 edits to move pixels well beyond the floor.
// Run with dev server up on :8741.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('console', m => { if (/fieldTuning|error/i.test(m.text())) console.log('[page]', m.text()); });
const PORT = process.env.PROBE_PORT || 8741;
await page.goto(`http://localhost:${PORT}/?x=1312&y=1312`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._fieldTuning && window._dbgRenderer && window._lighting
  && window._debugProvider && window._debugProvider.getBitmap(20, 20), null, { timeout: 240000 });
await page.waitForTimeout(5000); // let painting + F2 preload settle

const GRASSLAND_F2 = ['tall_grass_blade', 'dandelion_stem', 'wild_herb'];

const res = await page.evaluate(async (objNames) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Force the Canvas 2D path so F2 lands on the readable #game canvas,
  // and freeze the day/night cycle (full cycle is ~83s — major pixel drift).
  window._dbgRenderer.useGL = false;
  window._lighting.paused = true;
  window._lighting.time = 0.5; // midday
  // Remove F4/F6 for the whole session: their random ambient sway gusts
  // (192px trees especially) land differently between the baseline and
  // reset captures and swamp the dReset gate. Constant across all captures,
  // so the F2-only measurements stay valid.
  {
    const t = window._fieldTuning.tree();
    t.f4 = { density: 0 };
    t.f6 = { density: 0 };
    window._fieldTuning.apply('f4');
    window._fieldTuning.apply('f6');
  }
  await wait(1200);

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const RW = 512, RH = 512;
  const rx = (canvas.width - RW) >> 1, ry = (canvas.height - RH) >> 1;

  function capture() {
    return ctx.getImageData(rx, ry, RW, RH).data.slice();
  }
  function mad(a, b) { // mean abs diff per sampled channel
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 16) { s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
    return s / n;
  }
  function animsOffTree(extra) {
    const objects = {};
    for (const name of objNames) objects[name] = { anims: { wind_sway: false } };
    return Object.assign({ biomes: { grassland: { objects } } }, extra || {});
  }
  function setF2(f2) {
    const t = window._fieldTuning.tree();
    t.f2 = f2;
    window._fieldTuning.apply('f2');
  }

  // Motion with wind_sway ON vs OFF — verifies the anim gate visually.
  const m1 = capture(); await wait(1500);
  const motionOn = mad(m1, capture());

  setF2(animsOffTree());
  await wait(1200);
  const q1 = capture(); await wait(1500);
  const motionOff = mad(q1, capture());

  // Drift control: F2 ambient-life sway (~7% of sprites self-trigger every
  // 6-15s and freeze on a different frame) moves pixels over multi-second
  // spans even with wind_sway off. Measure that drift over the same span the
  // edit legs take so the reset gate compares against real ambient noise,
  // not the (much smaller) quiet-window motion floor.
  const base = capture();
  await wait(6000);
  const driftCtl = mad(base, capture());

  setF2(animsOffTree({ density: 0 }));
  await wait(1200);
  const d0 = capture();

  setF2(animsOffTree({ size: 2.0 }));
  await wait(1200);
  const s2 = capture();

  setF2(animsOffTree());
  await wait(1200);
  const rst = capture();

  return {
    motionOn, motionOff, driftCtl,
    dDensity0: mad(base, d0),
    dSize2: mad(base, s2),
    dD0vsS2: mad(d0, s2),
    dReset: mad(base, rst),
  };
}, GRASSLAND_F2);

console.log(JSON.stringify(res, null, 2));
await browser.close();
// 1. Anim gate: disabling wind_sway must visibly still the scene.
// 2. density-0 (no F2) and size-2 (double F2) must each differ from the
//    quiet baseline, and from each other, by well more than the floor.
// 3. reset must return to within ambient-drift noise of the baseline
//    (driftCtl x2 headroom), and stay well below the edit signals.
const floor = Math.max(res.motionOff * 3, res.driftCtl * 1.5, 0.4);
const gateOk = res.motionOff < res.motionOn * 0.5;
const resetLimit = Math.max(res.driftCtl * 2, res.motionOff * 3, 0.8);
const ok = gateOk
  && res.dDensity0 > floor && res.dSize2 > floor && res.dD0vsS2 > floor
  && res.dReset < resetLimit && res.dReset < res.dDensity0 * 0.5;
console.log(`anim gate: motion ${res.motionOn.toFixed(3)} -> ${res.motionOff.toFixed(3)} (${gateOk ? 'ok' : 'FAIL'}); floor=${floor.toFixed(3)} driftCtl=${res.driftCtl.toFixed(3)} resetLimit=${resetLimit.toFixed(3)}`);
console.log(ok ? 'F2 VISUAL PROBE PASSED' : 'F2 VISUAL PROBE FAILED');
process.exit(ok ? 0 : 1);
