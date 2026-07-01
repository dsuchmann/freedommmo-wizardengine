// scripts/probe-cpu-breakdown.mjs — find the per-frame MAIN-THREAD CPU cost
// (the game is CPU-bound: GPU idle, ~20fps at rest). Reports percentiles, not
// EMA, so it's robust at low frame counts. F2 forEach time is pure-JS at steady
// state (warm atlas) so it's accurate even under software GL.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8124;
// try to get a real GPU in headless; falls back to swiftshader if unavailable
const browser = await chromium.launch({ executablePath: exe, headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://localhost:${PORT}/?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok
  && window.__f2prof, null, { timeout: 240000 });
await page.waitForTimeout(8000); // warm atlas + settle

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const r = window._dbgRenderer, cam = window._camera;
  const gpu = (() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })();

  // patch draw for total CPU time
  if (!window.__drawProf) {
    window.__drawProf = [];
    const od = r.draw.bind(r);
    r.draw = function (...a) { const t = performance.now(); const x = od(...a); window.__drawProf.push(performance.now() - t); if (window.__drawProf.length > 600) window.__drawProf.shift(); return x; };
  }
  const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return +s[Math.floor(s.length * p)].toFixed(1); };
  const measure = async (label, ms) => {
    window.__drawProf.length = 0; window.__f2prof.forEach.length = 0; window.__f2prof.active.length = 0;
    await wait(ms);
    return { label, frames: window.__drawProf.length,
      drawP50: pct(window.__drawProf, .5), drawP95: pct(window.__drawProf, .95),
      f2P50: pct(window.__f2prof.forEach, .5), f2P95: pct(window.__f2prof.forEach, .95),
      activeP50: pct(window.__f2prof.active, .5) };
  };

  cam.targetZoom = 1.37; await wait(2500);
  const idleIn = await measure('idle-zoomed-in', 2500);
  cam.targetZoom = 0.45; await wait(4000);
  const idleOut = await measure('idle-zoomed-out', 2500);
  cam.targetZoom = 1.37;
  return { gpu: gpu.slice(0, 48), poolN: window._f2PoolN, idleIn, idleOut };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
