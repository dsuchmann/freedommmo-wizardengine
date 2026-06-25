// scripts/probe-zoom-phases.mjs — fresh-context (no module cache) phase profiler.
// Measures where draw() time goes at normal zoom vs zoomed-out, to locate the
// O(1/zoom^2) cost. Requires the [TEMP PROFILER] markers in canvas-renderer.js.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://localhost:${PORT}/?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });

// Wait until the NEW code is running (window.__phase populated by the markers).
await page.waitForFunction(() => window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok
  && window.__phase && Object.keys(window.__phase).length > 0, null, { timeout: 240000 });
await page.waitForTimeout(4000);

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const cam = window._camera;
  const r = window._dbgRenderer;
  const p = window._player;

  // real frame-period sampler
  function fpsProbe(ms) {
    return new Promise(resolve => {
      const ts = []; let go = true;
      const t = (x) => { if (!go) return; ts.push(x); requestAnimationFrame(t); };
      requestAnimationFrame(t);
      setTimeout(() => { go = false; const ps = []; for (let i = 1; i < ts.length; i++) ps.push(ts[i] - ts[i - 1]);
        resolve({ fps: ts.length > 1 ? Math.round(1000 * (ts.length - 1) / (ts[ts.length - 1] - ts[0])) : 0,
                  maxGapMs: ps.length ? Math.round(Math.max(...ps)) : 0 }); }, ms);
    });
  }
  const snap = () => { const o = {}; for (const k in window.__phase) o[k] = +window.__phase[k].toFixed(1); return o; };

  cam.targetZoom = 1.37; await wait(2500);
  const idle = { zoom: +cam.zoom.toFixed(2), phase: snap(), ...(await fpsProbe(1500)) };

  cam.targetZoom = 0.45; await wait(4500);
  const zoomedOut = { zoom: +cam.zoom.toFixed(2), phase: snap(), ...(await fpsProbe(2000)) };

  cam.targetZoom = 1.37;
  return { idle, zoomedOut, poolN: window._f2PoolN };
});

console.log(JSON.stringify(res, null, 2));
await browser.close();
