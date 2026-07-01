// Headless self-validation harness for the game (playwright-core + system Chrome).
// Loads the game, optionally enables GPU terrain, reports window STATE + console
// ERRORS (reliable), and best-effort screenshots the GL canvas (canvas 0).
//
// Usage (ALWAYS wrap in a hard timeout so it can never hang the session):
//   timeout 55 node scripts/pw-shot.mjs [--gpu] [--x=1312] [--y=1312] [--wait=16000] [--out=screenshots/pw.png]
//
// FINDINGS (2026-06-30): headless uses the REAL GPU (ANGLE/NVIDIA), the GL game
// renders (tilemap/bitmap/f2 stats populate), and JS/shader errors surface in the
// console feed — so STATE + ERROR validation is trustworthy. VISUAL capture is
// finicky: the present pass tints the scene by time-of-day (orange/cream wash) and
// headless streams few chunks, so screenshots validate "renders / no crash", not
// exact colours. Use the state/error output as the source of truth; treat the
// screenshot as a rough sanity check. Debug overlays live on a 2D canvas (z=1) +
// DOM; this hides everything but the GL canvas (0) before the shot.
import { chromium } from 'playwright-core';
import fs from 'fs';

const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k)); if (!m) return d; const v = m.split('=')[1]; return v === undefined ? true : v; };
const gpu = !!arg('gpu', false);
const x = arg('x', '1312'), y = arg('y', '1312');
const wait = parseInt(arg('wait', gpu ? '18000' : '12000'), 10);
const out = arg('out', 'screenshots/pw.png');

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 1024 } });
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 160)));
await p.goto(`http://localhost:8123/?x=${x}&y=${y}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(Math.min(9000, wait));
if (gpu) { await p.evaluate(() => { if (window.gpuTerrain) window.gpuTerrain(true); }); await p.waitForTimeout(Math.max(0, wait - 9000)); }
const state = await p.evaluate(() => ({
  gpuTerrain: !!window._gpuTerrain, ready: window._gpuTerrainReady, soilReady: window._gpuSoilReady, gcLumReady: window._gpuGcLumReady,
  gpuStats: window._gpuTerrainStats, drawProf: window._drawProf, roofProf: window._roofProf, bbWorst: window._bbWorst,
}));
console.log('STATE: ' + JSON.stringify(state));
console.log('ERRORS(' + errors.length + '): ' + JSON.stringify([...new Set(errors)].slice(0, 12)));
try {
  await p.evaluate(() => { const cs = [...document.querySelectorAll('canvas')]; const gl = cs[0]; const keep = new Set(); let n = gl; while (n) { keep.add(n); n = n.parentElement; } document.querySelectorAll('body *').forEach(el => { if (el === gl || keep.has(el)) return; el.style.display = 'none'; }); });
  await p.waitForTimeout(1500);
  const cdp = await p.context().newCDPSession(p);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('screenshots', { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('SHOT: ' + out + ' (' + shot.data.length + 'B)');
} catch (e) { console.log('SHOT failed: ' + e.message.slice(0, 80)); }
await b.close();
console.log('DONE');
