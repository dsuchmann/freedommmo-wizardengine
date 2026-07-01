// scripts/probe-7fps.mjs — at steady-state (full load), split the frame into
// draw vs outside-draw to locate the 7fps cost. Patches renderer.draw (no source
// hook needed). Counts chunkRepainted-driven busyness via console.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
let repaints = 0;
page.on('console', m => { if (m.text().includes('REPAINT') || m.text().includes('painted incomplete')) repaints++; });
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer && window._dbgRenderer.glc && window._dbgRenderer.glc.ok, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const r = window._dbgRenderer;
  // settle: wait until f2 pool exists + extra time for background load/repaints to quiet
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(20000); // let the background load + progressive repaints finish

  // patch draw for CPU draw time
  const draws = []; const od = r.draw.bind(r);
  r.draw = function (...a) { const t = performance.now(); const x = od(...a); draws.push(performance.now() - t); return x; };
  // count drawChunk calls/frame too
  const glc = r.glc; let cc = 0; const odc = glc.drawChunk.bind(glc); glc.drawChunk = function (...a) { cc++; return odc(...a); };

  // real frame periods
  const ts = []; let go = 1; const tk = t => { if (!go) return; ts.push(t); requestAnimationFrame(tk); }; requestAnimationFrame(tk);
  await wait(5000);
  go = 0; r.draw = od; glc.drawChunk = odc;

  const periods = []; for (let i = 1; i < ts.length; i++) periods.push(ts[i] - ts[i - 1]);
  const sortNum = a => [...a].sort((x, y) => x - y);
  const pct = (a, p) => a.length ? +sortNum(a)[Math.floor(a.length * p)].toFixed(1) : 0;
  const realFps = ts.length > 1 ? Math.round(1000 * (ts.length - 1) / (ts.at(-1) - ts[0])) : 0;
  const frameP50 = pct(periods, .5);
  const drawP50 = pct(draws, .5);
  return {
    realFps, frameMs_p50: frameP50, drawMs_p50: drawP50, drawMs_p95: pct(draws, .95),
    outsideDrawMs_p50: +(frameP50 - drawP50).toFixed(1),
    chunkDrawsPerFrame: draws.length ? Math.round(cc / draws.length) : 0,
    f2PoolN: window._f2PoolN, zoom: window._camera ? +window._camera.zoom.toFixed(2) : 0,
  };
});
console.log(JSON.stringify({ ...res, repaintLogsDuringRun: repaints }, null, 2));
await browser.close();
