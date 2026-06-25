// probe-walkstutter.mjs — empirical diagnosis of the "stutter while walking + despawn/respawn
// on stop" symptom. Drives the ALREADY-RUNNING dev server (port 8123) with playwright-core +
// swiftshader. swiftshader runs ~1-2fps so absolute seconds are dilated, but per-op COSTS and
// per-tile-walked trigger COUNTS are valid. We reproduce a WALK by stepping window._player.y in
// small increments (positions drive rebuild/overmap/stream triggers; we do NOT teleport-jump).
//
// Measures: (A) MICROBENCH of overmap full redraw + resolveBuildings (fps-independent),
//           (B) WALK SIM (rebuild count, overmap redraws, amort spikes, poolN min while walking),
//           (C) AFTER STOP (does poolN drop toward 0 then climb back = despawn/respawn cycle).
import { chromium } from 'playwright-core';

const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1217/chrome-win64/chrome.exe';
const PORT = process.env.PROBE_PORT || 8123;

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1382, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => window._dbgRenderer?.glc?.gl && window._player && window._f2Stats && window._dbgOvermap
        && window._dbgResolveBuildings && window._debugChunks && window._debugProvider,
  null, { timeout: 240000 }
);

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const now = () => performance.now();
  const poolN = () => window._f2PoolN || 0;
  const out = { microbench: {}, walk: {}, afterStop: {}, rawNotes: '' };
  const notes = [];

  // ---- settle, then teleport to a vegetated grassland and let chunks stream in ----
  await wait(6000);
  const TX = 11000, TY = -6000;
  window._player.x = TX; window._player.y = TY;
  try { window._debugChunks.streamAround(TX, TY); } catch (e) { notes.push('streamAround(setup) threw: ' + e); }
  try { window._debugProvider.initPreload(TX, TY, true); } catch (e) { notes.push('initPreload(setup) threw: ' + e); }
  await wait(12000); // wait for chunks to be ready around the destination

  // ===================== (A) MICROBENCH — fps independent =====================
  // (i) force a full overmap redraw 3x and time each
  const overmapFullRedrawMs = [];
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = now();
      window._dbgOvermap.draw(true); // force full redraw (152x152 grid, ~69k sampleRegionalMapChunk calls)
      overmapFullRedrawMs.push(+(now() - t0).toFixed(3));
    } catch (e) {
      notes.push('overmap.draw(true) #' + i + ' threw: ' + e);
      overmapFullRedrawMs.push(-1);
    }
    await wait(200);
  }
  out.microbench.overmapFullRedrawMs = overmapFullRedrawMs;

  // (ii) resolveBuildings for a few fresh macro-cells near the player. Try a couple of macro
  // sizes (64 and 256) plus offsets so each (mx,my) is a distinct, likely-uncached cell.
  const px = window._player.x, py = window._player.y;
  const cells = [];
  for (const macro of [64, 256]) {
    const mx = Math.floor(px / macro), my = Math.floor(py / macro);
    cells.push({ macro, mx, my });
    cells.push({ macro, mx: mx + 1, my: my + 1 }); // an adjacent, separate cell
  }
  const resolveBuildings = [];
  for (const c of cells) {
    try {
      const r = window._dbgResolveBuildings(c.mx, c.my); // {ms,n}
      resolveBuildings.push({ macro: c.macro, mx: c.mx, my: c.my, ms: +r.ms.toFixed(3), n: r.n });
    } catch (e) {
      notes.push(`resolveBuildings(${c.mx},${c.my}) threw: ` + e);
      resolveBuildings.push({ macro: c.macro, mx: c.mx, my: c.my, ms: -1, n: -1, err: String(e) });
    }
  }
  out.microbench.resolveBuildings = resolveBuildings;

  // ===================== (B) WALK SIM — step SOUTH (+y) one tile at a time =====================
  const startTiles = { x: window._player.x, y: window._player.y };
  const r0 = window._f2Stats.rebuilds;
  _f2Stats.amortStepMaxMs = 0; // reset the running max so we capture only walk-phase spikes
  window._dbgFrame.overmapMs = 0; window._dbgFrame.overmapMax = 0; window._dbgFrame.overmapCalls = 0;

  const samples = [];
  const walkStart = now();
  let amortStepMaxMs = 0;
  while (now() - walkStart < 12000) {
    window._player.y += 1.0; // one tile south; positions drive moved/recenter/stream triggers
    try { window._debugChunks.streamAround(window._player.x, window._player.y); } catch (e) { /* per-frame stream */ }
    const am = window._f2Stats.amortStepMaxMs || 0;
    if (am > amortStepMaxMs) amortStepMaxMs = am;
    samples.push({
      t: +(now() - walkStart).toFixed(0),
      y: +window._player.y.toFixed(1),
      poolN: poolN(),
      rebuilds: window._f2Stats.rebuilds - r0,
      amortMax: +am.toFixed(3),
      overmapCalls: window._dbgFrame.overmapCalls,
      overmapMax: +(window._dbgFrame.overmapMax).toFixed(3),
    });
    await wait(150);
  }

  const poolNs = samples.map(s => s.poolN);
  out.walk = {
    tilesWalked: +(window._player.y - startTiles.y).toFixed(1),
    rebuilds: window._f2Stats.rebuilds - r0,
    overmapFullRedraws: window._dbgFrame.overmapCalls, // overmap.draw() invocations in the loop during walk
    overmapMaxMs: +(window._dbgFrame.overmapMax).toFixed(3),
    amortStepMaxMs: +amortStepMaxMs.toFixed(3),
    poolNStart: poolNs.length ? poolNs[0] : 0,
    poolNMin: poolNs.length ? Math.min(...poolNs) : 0,
    poolNEnd: poolNs.length ? poolNs[poolNs.length - 1] : 0,
    samples,
  };

  // ===================== (C) AFTER STOP — stop stepping y, watch poolN =====================
  const r1 = window._f2Stats.rebuilds;
  const poolNCurve = [];
  const stopStart = now();
  while (now() - stopStart < 6000) {
    poolNCurve.push({ t: +(now() - stopStart).toFixed(0), poolN: poolN() });
    await wait(300);
  }
  out.afterStop = {
    rebuilds: window._f2Stats.rebuilds - r1,
    poolNCurve,
  };

  // ---- narrative ----
  const wMin = out.walk.poolNMin, wStart = out.walk.poolNStart, wEnd = out.walk.poolNEnd;
  const stopVals = poolNCurve.map(s => s.poolN);
  const stopMin = stopVals.length ? Math.min(...stopVals) : 0;
  const stopMax = stopVals.length ? Math.max(...stopVals) : 0;
  notes.push(`WALK poolN start=${wStart} min=${wMin} end=${wEnd}; ${wMin <= 1 ? 'flora DESPAWNED toward 0 DURING walk' : (wMin < wStart * 0.5 ? 'flora dipped substantially during walk' : 'flora stayed populated during walk')}.`);
  notes.push(`AFTER-STOP poolN min=${stopMin} max=${stopMax} (curve start=${stopVals[0]} end=${stopVals[stopVals.length-1]}); ${stopMin <= 1 && stopMax > stopMin + 2 ? 'flora DROPPED to ~0 then CLIMBED BACK (despawn->respawn cycle)' : 'no clear despawn/respawn cycle observed after stop'}.`);
  notes.push(`WALK: rebuilds=${out.walk.rebuilds} over ${out.walk.tilesWalked} tiles; overmap.draw() invocations=${out.walk.overmapFullRedraws}, worst single overmap.draw=${out.walk.overmapMaxMs}ms; worst amort step=${out.walk.amortStepMaxMs}ms.`);
  notes.push(`MICROBENCH: overmap full redraw = [${overmapFullRedrawMs.join(', ')}] ms; resolveBuildings = ${resolveBuildings.map(r => `(${r.macro}:${r.mx},${r.my})=${r.ms}ms n=${r.n}`).join('; ')}.`);
  out.rawNotes = notes.join(' ');
  return out;
});

const final = { ...res, pageErrors: errors.slice(0, 8) };
console.log('PROBE_RESULT_JSON_START');
console.log(JSON.stringify(final, null, 2));
console.log('PROBE_RESULT_JSON_END');
await browser.close();
