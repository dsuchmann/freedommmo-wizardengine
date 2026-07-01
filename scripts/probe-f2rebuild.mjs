// probe-f2rebuild.mjs — confirm + decompose the F2 pool-rebuild walk spike.
// Reads window._f2Stats (rebuilds, lastRebuildMs) and counts gl.texSubImage2D calls
// (atlas packing) during a walk. Tells us: rebuild frequency, rebuild cost, and how
// much of it is atlas-pack (SW-GL-inflated, real-GPU-cheap) vs CPU re-resolve.
import { chromium } from 'playwright-core';
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8130;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?x=-16672&y=14816`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window._dbgRenderer?.glc?.gl && window._f2Stats, null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30 && !window._f2PoolN; i++) await wait(1000);
  await wait(10000);

  const gl = window._dbgRenderer.glc.gl;
  // count atlas packs (texSubImage2D) + a coarse pixel total
  let packs = 0, packPx = 0;
  const oSub = gl.texSubImage2D.bind(gl);
  gl.texSubImage2D = function (...a) {
    packs++;
    // texSubImage2D(target, level, xoff, yoff, w, h, fmt, type, src) OR (...,src)
    if (typeof a[4] === 'number' && typeof a[5] === 'number') packPx += a[4] * a[5];
    else if (a[a.length - 1] && a[a.length - 1].width) packPx += a[a.length - 1].width * a[a.length - 1].height;
    return oSub(...a);
  };

  const rebuildMsSamples = [];
  const s0 = window._f2Stats.rebuilds;
  let lastSeen = s0;
  const startX = window._player.x;
  const walk = setInterval(() => { if (window._player) window._player.x += 0.6; }, 60);
  // poll lastRebuildMs each time the rebuild counter advances
  const poll = setInterval(() => {
    const st = window._f2Stats;
    if (st.rebuilds !== lastSeen) { rebuildMsSamples.push(+st.lastRebuildMs.toFixed(1)); lastSeen = st.rebuilds; }
  }, 30);
  await wait(18000);
  clearInterval(walk); clearInterval(poll);
  gl.texSubImage2D = oSub;

  const walked = +(window._player.x - startX).toFixed(0);
  const rebuilds = window._f2Stats.rebuilds - s0;
  const p = (a, q) => a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(1) : 0;
  return {
    walkedTiles: walked, poolN: window._f2PoolN,
    rebuilds, rebuildsPerTile: +(rebuilds / Math.max(1, walked)).toFixed(2),
    rebuildMs: { p50: p(rebuildMsSamples, .5), p95: p(rebuildMsSamples, .95), max: p(rebuildMsSamples, 1), samples: rebuildMsSamples.length },
    atlasPacks: packs, atlasPackMegapixels: +(packPx / 1e6).toFixed(1),
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
