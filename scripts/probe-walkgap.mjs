// probe-walkgap.mjs — attribute the residual walk stutter (the between-frame GAP).
// During a walk: sum worker.onmessage handler time BY message type, collect longtask
// durations (full task = structured-clone + handler), and draw times. If longtask
// time >> handler time, the cost is the structured CLONE (pre-handler) -> transfer
// buffers. If chunkSlice handler time dominates, it's the copy loop. If draw spikes,
// it's render/F2.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.ok && window._dbgChunkStore?.provider?.workers?.length, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(10000); // settle

  const prov = window._dbgChunkStore.provider;
  const handler = {}; const count = {};
  prov.workers.forEach(w => {
    const orig = w.onmessage;
    if (!orig) return;
    w.onmessage = function (e) {
      const ty = (e.data && e.data.type) || 'other';
      const t0 = performance.now();
      orig.call(this, e);
      handler[ty] = (handler[ty] || 0) + (performance.now() - t0);
      count[ty] = (count[ty] || 0) + 1;
    };
  });

  const longtasks = [];
  let obs = null;
  try { obs = new PerformanceObserver(l => { for (const e of l.getEntries()) longtasks.push(e.duration); }); obs.observe({ entryTypes: ['longtask'] }); } catch (e) {}

  const r = window._dbgRenderer; const draws = []; const od = r.draw.bind(r);
  r.draw = function (...a) { const t = performance.now(); const x = od.apply(r, a); draws.push(performance.now() - t); return x; };

  const t0 = performance.now();
  const startX = window._player.x;
  const walk = setInterval(() => { if (window._player) window._player.x += 0.6; }, 60);
  await wait(18000);
  clearInterval(walk);
  const wallSecs = (performance.now() - t0) / 1000;
  const walked = +(window._player.x - startX).toFixed(0);
  if (obs) obs.disconnect(); r.draw = od;

  const p = (a, q) => a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(1) : 0;
  const sum = a => +a.reduce((x, y) => x + y, 0).toFixed(0);
  const handlerMs = {}; for (const k in handler) handlerMs[k] = { ms: +handler[k].toFixed(0), n: count[k] };
  return {
    walkedTiles: walked, wallSecs: +wallSecs.toFixed(1),
    handlerTimeByType: handlerMs,
    handlerTotalMs: +Object.values(handler).reduce((a, b) => a + b, 0).toFixed(0),
    longtasks: { n: longtasks.length, totalMs: sum(longtasks), p95: p(longtasks, .95), max: p(longtasks, 1) },
    draw: { p50: p(draws, .5), p95: p(draws, .95), max: p(draws, 1) },
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
