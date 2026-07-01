// probe-framesplit.mjs — split the frame into update / draw-issue / between-frame GAP.
// update() is pure CPU (no GL) so it's representative even on software-GL.
// update = FRAME_JS - draw  (both include the same inflated SW-GL issue cost, so it cancels).
// GAP (between rAF callbacks) is SW-GL-inflated for the GPU part, but if FRAME_JS itself
// is huge the bottleneck is CPU regardless.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.ok, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(12000); // settle streaming/hot-load

  const r = window._dbgRenderer;
  const draws = []; const od = r.draw.bind(r);
  r.draw = function (...a) { const t = performance.now(); const x = od.apply(r, a); draws.push(performance.now() - t); return x; };

  const frameJS = [], gaps = []; let lastEnd = 0;
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRAF(function (t) {
      const s = performance.now();
      if (lastEnd) gaps.push(s - lastEnd);
      cb(t);
      const e = performance.now();
      frameJS.push(e - s);
      lastEnd = e;
    });
  };
  await wait(6000);
  window.requestAnimationFrame = origRAF; r.draw = od;

  const p = (a, q) => a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length * q)].toFixed(1) : 0;
  const frameJS_p50 = p(frameJS, .5), draw_p50 = p(draws, .5), gap_p50 = p(gaps, .5);
  const period = frameJS_p50 + gap_p50;
  return {
    samples: frameJS.length,
    period_p50: +period.toFixed(1),
    fps_est: period ? Math.round(1000 / period) : 0,
    frameJS_p50, frameJS_p95: p(frameJS, .95),
    draw_p50, draw_p95: p(draws, .95),
    update_est_p50: +(frameJS_p50 - draw_p50).toFixed(1), // pure-CPU, representative
    gap_p50, gap_p95: p(gaps, .95),                       // SW-GL inflates GPU part
    f2Pool: window._f2PoolN, zoom: window._camera ? +window._camera.zoom.toFixed(2) : 0,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
