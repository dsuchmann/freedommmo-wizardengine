// scripts/probe-perf-counters.mjs — read the engine's own perf counters
// (window._perf.updateMs is pure-JS = accurate even headless) to split the
// frame into update() vs draw() and find the ~27ms/frame that's OUTSIDE draw.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8124;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://localhost:${PORT}/?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._perf && window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok, null, { timeout: 240000 });

// Wait for the world to fully settle: poll until updateMs stops dropping.
const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // let chunk streaming settle (up to 40s)
  let prev = 1e9, stable = 0;
  for (let i = 0; i < 40; i++) {
    await wait(1000);
    const u = window._perf.updateMs;
    if (Math.abs(u - prev) < 0.5) { stable++; if (stable >= 3) break; } else stable = 0;
    prev = u;
  }
  // sample steady state over 4s
  const samples = [];
  for (let i = 0; i < 40; i++) {
    await wait(100);
    samples.push({ u: window._perf.updateMs, d: window._perf.drawMs, fps: window._perf.fps, frame: window._perf.frameMs });
  }
  const avg = k => +(samples.reduce((s, x) => s + x[k], 0) / samples.length).toFixed(1);
  return {
    fps: avg('fps'), frameMs: avg('frame'), updateMs: avg('u'), drawMs: avg('d'),
    outsideDrawMs: +(avg('frame') - avg('d')).toFixed(1),
    f2ForEachP50: window.__f2prof && window.__f2prof.forEach.length ? +[...window.__f2prof.forEach].sort((a, b) => a - b)[Math.floor(window.__f2prof.forEach.length / 2)].toFixed(1) : 0,
    activeP50: window.__f2prof && window.__f2prof.active.length ? window.__f2prof.active[window.__f2prof.active.length - 1] : 0,
    poolN: window._f2PoolN,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
