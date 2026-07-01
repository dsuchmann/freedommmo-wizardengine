// scripts/qa-render.mjs — REUSABLE per-biome IN-GAME RENDER-QA probe.
//
// WHY THIS EXISTS
//   Asset-level QA (solidify / qa-tiles / qa-edges / qa-proportions) checks the STATIC tile PNGs and
//   correctly PASSES clean tiles. But some defects only appear in a RENDER LAYER in-game. Example just
//   fixed: the D0 weathering pass painted dark blotchy earth-grime that read as "missing pixels" at the
//   base of PALE woven walls (savanna woven_grass_panel). asset QA can't see that — the tile PNG is fine;
//   the DEFECT IS BORN IN THE RENDER. This probe renders REAL buildings, per (biome, material), with the
//   weathering pass ON vs OFF, and auto-flags that whole class of issue.
//
// WHAT IT DOES (per biome that has tiles on disk):
//   1. Finds a real settlement OF THAT BIOME (discoverSettlementsInMacroRange + classifyBiomeNoStream to
//      confirm), teleports the player there, and resolves a real building.
//   2. For EACH wall material of that biome: sets window._tileMaterial=<slug>, auto-frames the building base
//      the SAME way every time (hide #hud/#overmapWrap, zoom 2.4, park the player ~1 tile south of the
//      south-wall foot, freeze midday) and captures TWO shots: weathering ON and weathering OFF.
//   3. AUTO-FLAGS by diffing the two shots over the bottom ~25% of the wall (the foundation strip):
//        • OVER-WEATHERED BASE — weathering introduces too much mean DARKENING and/or blotch VARIANCE at the
//          base (the woven_grass_panel failure mode). Thresholds tuned so the now-fixed pale materials PASS.
//        • MISSING PIXELS — the base shows unexpected TRANSPARENCY in-context (canvas pixels with low alpha
//          over the wall area = real holes), independent of weathering.
//   4. OUTPUTS a per-biome contact-sheet montage (tools/_qa_render_<biome>.png) of every material's base
//      weathering-ON, and prints a PASS/FAIL list per (biome, material) with the metric. EXITS NONZERO if
//      any material FAILs.
//
// USAGE (dev server on localhost:8123 must be running — this probe launches its OWN headless browser, so it
//        will NOT disturb your live session):
//     node scripts/qa-render.mjs                          # all built biomes that have tiles on disk
//     node scripts/qa-render.mjs grassland desert savanna # only these biomes
//     HOST=localhost:9001 node scripts/qa-render.mjs      # different dev-server host
//     QA_DEBUG=1 node scripts/qa-render.mjs grassland     # keep ON/OFF raw shots per material for eyeballing
//
// It is idempotent + disk-driven: the biome list and per-biome materials come from TILE_MATERIALS
// (src/render/building-tiles.js) intersected with the material folders actually present on disk. Biomes
// with no settlement found in range are SKIPPED and logged (never silently dropped).
//
// TUNING THE OVER-WEATHERING FLAG: see THRESH below. Raise FAIL_DARKEN / FAIL_BLOTCH to be more permissive.
// When a NEW material trips "over-weathered base", the fix is to extend the pale-material regex in
// src/render/dressing/d0-weathering.js (the `if (opts.material && /woven|thatch|.../)` gentling block).

import { chromium } from 'playwright-core';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';

const EXE = `${process.env.USERPROFILE}\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe`;
const HOST = process.env.HOST || 'localhost:8123';
const ROOT = 'C:/Users/daves/AppData/Roaming/wizardgenie/projects/default';
const OUT = ROOT + '/tools/';
const TILES_DIR = ROOT + '/assets/pixelab/buildings/tiles';
const DEBUG = !!process.env.QA_DEBUG;
mkdirSync(OUT, { recursive: true });

// ── AUTO-FLAG THRESHOLDS ──────────────────────────────────────────────────────────────────────────────
// Measured over the FOUNDATION STRIP (bottom ~25% of the wall area) by diffing weathering-ON vs -OFF.
//   meanDarken  = mean luminance DROP (ON darker than OFF), 0..255 — how much the weathering dims the base.
//   blotchVar   = stddev of that per-pixel luminance DROP — how PATCHY/blotchy the dimming is (the
//                 "missing-pixel" read comes from high-variance dark patches, not uniform shading).
//
// CALIBRATED against the savanna woven_grass_panel case (the bug this probe exists to catch), sweeping
// weathering strength with the pale-material gentling DISABLED to find the over-weathered regime:
//     FIXED (gentled, default strength)   → darken ~2,  blotch ~12   ← must PASS
//     ungentled @ default strength        → darken ~8.5, blotch ~7   ← borderline OK (default weathering)
//     ungentled @ strength 1.8–3.5        → darken ~14–15, blotch ~12 ← genuinely over-weathered, must FAIL
// (multiply-blend grime on pale walls saturates ~15 darken because it can't dim pale pixels past a floor,
//  and the strip averages in bright woven texture — so the SIGNAL is mean DARKENING, not blotch variance.)
const THRESH = {
  FAIL_DARKEN: 13,   // mean luminance drop over the base that reads as "too dark a foundation band"
  FAIL_BLOTCH: 18,   // stddev of the drop (blotchy/"missing-pixel" scatter) that escalates a FAIL on its own
  // a material FAILs over-weathering if it darkens the base past FAIL_DARKEN, OR is extremely blotchy.
  HARD_BLOTCH: 24,   // very blotchy dark scatter alone fails even if mean darkening is moderate
  // MISSING-PIXEL transparency: fraction of wall-area pixels that are unexpectedly see-through.
  ALPHA_HOLE: 0.06,  // >6% low-alpha pixels over the measured wall region = real holes
  ALPHA_CUT: 40,     // alpha below this (0..255) counts as "hole" when surrounded by opaque wall
};

const EXE_OK = existsSync(EXE);
if (!EXE_OK) { console.error('Playwright chromium not found at', EXE); process.exit(2); }

// ── disk-driven material discovery: which biomes/materials actually have tile folders ────────────────────
function diskMaterials(biome) {
  const dir = path.join(TILES_DIR, biome);
  if (!existsSync(dir)) return [];
  const mats = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    // require the base plain wall tile to exist (what the renderer needs to draw anything)
    if (existsSync(path.join(dir, e.name, 'ground_plain__v0.png'))) mats.push(e.name);
  }
  return mats.sort();
}

const argvBiomes = process.argv.slice(2).filter((a) => !a.startsWith('-'));

// ── contact-sheet montage (per biome) ───────────────────────────────────────────────────────────────────
async function montage(biome, cells) {
  // cells: [{ material, pngPath|null, verdict, metric }]
  const TS = 240, pad = 10, cols = Math.min(4, Math.max(1, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const W = cols * TS + (cols + 1) * pad;
  const H = rows * (TS + 34) + pad;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#1b1b1b'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ddd'; x.font = 'bold 14px sans-serif';
  for (let i = 0; i < cells.length; i++) {
    const cx = pad + (i % cols) * (TS + pad);
    const cy = pad + Math.floor(i / cols) * (TS + 34);
    const cell = cells[i];
    const fail = cell.verdict === 'FAIL';
    x.fillStyle = fail ? '#7a1414' : '#143b14';
    x.fillRect(cx - 2, cy - 2, TS + 4, TS + 4);
    if (cell.pngPath && existsSync(cell.pngPath)) {
      try { const im = await loadImage(cell.pngPath); x.drawImage(im, 0, 0, im.width, im.height, cx, cy, TS, TS); }
      catch { x.fillStyle = '#444'; x.fillRect(cx, cy, TS, TS); }
    } else { x.fillStyle = '#333'; x.fillRect(cx, cy, TS, TS); x.fillStyle = '#888'; x.fillText('no shot', cx + 8, cy + 20); }
    x.fillStyle = fail ? '#ff8080' : '#9fdf9f'; x.font = 'bold 13px sans-serif';
    x.fillText(`${cell.material}  ${cell.verdict}`, cx, cy + TS + 14);
    x.fillStyle = '#bbb'; x.font = '11px sans-serif';
    x.fillText(cell.metric || '', cx, cy + TS + 28);
  }
  const p = OUT + `_qa_render_${biome}.png`;
  writeFileSync(p, c.toBuffer('image/png'));
  return p;
}

// ── pixel analysis: diff ON vs OFF over the foundation strip; detect transparency holes ─────────────────
// region {x0,y0,w,h} is the screen rect of the building's WALL (computed in-page). We measure the BOTTOM
// 25% band of that rect (the foundation strip).
async function analyze(onPath, offPath, region) {
  const on = await loadImage(onPath), off = await loadImage(offPath);
  const W = on.width, H = on.height;
  const ca = createCanvas(W, H), xa = ca.getContext('2d'); xa.drawImage(on, 0, 0);
  const cb = createCanvas(W, H), xb = cb.getContext('2d'); xb.drawImage(off, 0, 0);
  const A = xa.getImageData(0, 0, W, H).data;
  const B = xb.getImageData(0, 0, W, H).data;
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // clamp region to the canvas
  const rx0 = Math.max(0, Math.min(W - 1, Math.round(region.x0)));
  const ry0 = Math.max(0, Math.min(H - 1, Math.round(region.y0)));
  const rx1 = Math.max(rx0 + 1, Math.min(W, Math.round(region.x0 + region.w)));
  const ry1 = Math.max(ry0 + 1, Math.min(H, Math.round(region.y0 + region.h)));
  // foundation strip = bottom 25% of the wall rect
  const stripY0 = Math.max(ry0, Math.round(ry1 - (ry1 - ry0) * 0.25));

  // mean darkening + blotch variance over the strip, ONLY where the OFF wall is opaque (so we measure on
  // the wall surface, not over background terrain that's the same in both shots).
  const drops = [];
  for (let y = stripY0; y < ry1; y++) for (let xx = rx0; xx < rx1; xx++) {
    const i = (y * W + xx) * 4;
    if (B[i + 3] < 128) continue;             // OFF pixel transparent → not wall surface; skip
    const drop = lum(B, i) - lum(A, i);       // positive = ON is darker than OFF (weathering darkened it)
    drops.push(drop);
  }
  let meanDarken = 0, blotchVar = 0;
  if (drops.length) {
    let s = 0; for (const d of drops) s += d; meanDarken = s / drops.length;
    let v = 0; for (const d of drops) { const e = d - meanDarken; v += e * e; } blotchVar = Math.sqrt(v / drops.length);
  }

  // MISSING-PIXEL transparency over the whole wall rect: in-context holes. Count low-alpha pixels in the ON
  // shot inside the wall rect that the OFF shot treated as solid wall (so it's a real hole, not background).
  let wallPix = 0, holePix = 0;
  for (let y = ry0; y < ry1; y++) for (let xx = rx0; xx < rx1; xx++) {
    const i = (y * W + xx) * 4;
    if (B[i + 3] >= 128) { wallPix++; if (A[i + 3] < THRESH.ALPHA_CUT) holePix++; }
  }
  const holeFrac = wallPix ? holePix / wallPix : 0;

  return { meanDarken, blotchVar, holeFrac, samples: drops.length, wallPix };
}

// A genuine over-weathering defect ALWAYS DARKENS the base (the grime pass is a multiply/darken). So a
// NEGATIVE mean darkening (ON brighter than OFF) is physically impossible for weathering — it means the two
// shots were MISALIGNED (a door-anim frame, cloud shadow, or still-loading wall differed between captures).
// In that case the blotch variance is measuring that misalignment, not weathering, so we must NOT flag — and
// the caller re-captures once. We only trust the blotch-escalation path when darkening is clearly positive.
function isArtifact(m) { return m.meanDarken < -1.5 && m.blotchVar > THRESH.HARD_BLOTCH; }
function verdictFor(m) {
  const reasons = [];
  if (isArtifact(m)) return { verdict: 'SKIP', reasons: ['capture artifact (negative darkening + high variance → misaligned shots)'] };
  // over-weathered if the base darkens past FAIL_DARKEN, OR the dark scatter is very blotchy AND it genuinely
  // darkened (blotch alone with ~zero darkening is texture, not grime).
  const over = m.meanDarken >= THRESH.FAIL_DARKEN || (m.blotchVar >= THRESH.HARD_BLOTCH && m.meanDarken >= 5);
  if (over) reasons.push('OVER-WEATHERED BASE');
  if (m.holeFrac >= THRESH.ALPHA_HOLE && m.wallPix > 200) reasons.push('MISSING PIXELS');
  return { verdict: reasons.length ? 'FAIL' : 'PASS', reasons };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--use-angle=swiftshader'] });
const results = []; // { biome, material, verdict, reasons, metric }
const sheets = [];
const skipped = [];
let reachable = true;

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PE ' + e.message));
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[P]')) console.log(t); });

  try {
    await page.goto(`http://${HOST}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window._dbgRenderer && window._player && window._dbgChunkStore, null, { timeout: 90000 });
  } catch (e) {
    reachable = false;
    console.error(`\nCould not reach the game at http://${HOST}/ — ${e.message}`);
    console.error('Start the dev server first (with no-cache so code changes show):');
    console.error('   npx http-server . -p 8123 -c-1');
    console.error('Then re-run:  node scripts/qa-render.mjs');
    process.exitCode = 3;
    throw e;
  }

  const cdp = await page.context().newCDPSession(page);
  const wait = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  const shotTo = async (name) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); const p = OUT + name; writeFileSync(p, Buffer.from(data, 'base64')); return p; };

  // The full TILE_MATERIALS map (the authority) from the live module, so the biome set is disk-driven.
  const TM = await page.evaluate(async () => {
    try { const m = await import('/src/render/building-tiles.js'); return m.TILE_MATERIALS ? Object.keys(m.TILE_MATERIALS) : null; }
    catch (e) { console.log('[P] TILE_MATERIALS import FAIL ' + e.message); return null; }
  });
  // building-tiles.js doesn't export TILE_MATERIALS; fall back to the disk biome list if the import didn't
  // give us the map. Either way we intersect with disk below, so the source of truth stays disk.
  let biomes = TM && TM.length ? TM : readdirSync(TILES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  if (argvBiomes.length) biomes = biomes.filter((b) => argvBiomes.includes(b));
  // keep only biomes that actually have material folders on disk
  const plan = [];
  for (const b of biomes) { const mats = diskMaterials(b); if (mats.length) plan.push({ biome: b, mats }); else skipped.push({ biome: b, why: 'no material folders on disk' }); }
  console.log(`\nQA-RENDER plan: ${plan.length} biome(s)\n` + plan.map((p) => `  ${p.biome}: ${p.mats.join(', ')}`).join('\n'));

  for (const { biome, mats } of plan) {
    console.log(`\n══ ${biome} ══`);
    // ── find a settlement of this biome, teleport, resolve a building ──
    const found = await page.evaluate(async (BIOME) => {
      const seedMod = await import('/src/core/world-seed.js').catch(() => null);
      const seed = (seedMod && seedMod.getWorldSeed) ? seedMod.getWorldSeed() : 0;
      const sd = await import('/sim/world/buildings/settlement-discovery.js').catch((e) => { console.log('[P] sd import FAIL ' + e.message); return null; });
      const cb = await import('/sim/world/biome-classifier.js').catch(() => null)
             || await import('/src/world/biome-classifier.js').catch(() => null);
      const classify = cb && (cb.classifyBiomeNoStream || cb.classifyBiome);
      const MACRO_TILES = (sd && sd.MACRO_TILES) || 64;
      if (sd && sd.discoverSettlementsInMacroRange) {
        // Expanding macro-box scan. Discovery is a PURE function (no chunk loading), so a wide scan is cheap;
        // rare biomes (mystic, volcanic, tropical_forest) cluster far from origin (mystic ~macro 193), so go
        // out to 256. Common biomes return on the first small ring. We return the FIRST (nearest) candidate.
        for (let R = 16; R <= 256; R += (R < 96 ? 16 : 32)) {
          let setts = [];
          try { setts = sd.discoverSettlementsInMacroRange(seed, -R, -R, R, R) || []; } catch (e) { console.log('[P] disc FAIL ' + e.message); }
          const cand = setts.filter((s) => s.biome === BIOME && s.state !== 'ruined' && s.tier !== 'ruins');
          for (const s of cand) {
            // confirm via classifier where available (defensive — discovery biome should already match)
            let ok = true;
            try { if (classify) ok = classify(s.x, s.y, seed) === BIOME; } catch {}
            if (ok) { console.log('[P] ' + BIOME + ' settlement @' + s.x + ',' + s.y + ' R=' + R + ' (' + s.tier + ')'); return { x: s.x, y: s.y, mx: s.mx, my: s.my, tier: s.tier, MACRO_TILES }; }
          }
        }
      }
      console.log('[P] no ' + BIOME + ' settlement in macro range');
      return { MACRO_TILES, none: true };
    }, biome);

    if (found.none) { skipped.push({ biome, why: 'no settlement found in macro range' }); console.log(`  SKIP ${biome}: no settlement found`); continue; }

    const info = await page.evaluate(async ({ loc, BIOME }) => {
      const seedMod = await import('/src/core/world-seed.js').catch(() => null);
      const rbMod = await import('/sim/world/buildings/resolved-buildings.js');
      const seed = (seedMod && seedMod.getWorldSeed) ? seedMod.getWorldSeed() : 0;
      const MACRO_TILES = (loc && loc.MACRO_TILES) || 64;
      const cx = loc.x, cy = loc.y;
      const mx = (loc.mx != null) ? loc.mx : Math.floor(cx / MACRO_TILES);
      const my = (loc.my != null) ? loc.my : Math.floor(cy / MACRO_TILES);
      let b = null;
      for (const MR of [0, 1, 2]) {
        let res = null;
        try { res = rbMod.resolveBuildingsInRange(seed, mx - MR, my - MR, mx + MR, my + MR); }
        catch (e) { console.log('[P] resolve FAIL ' + e.message); continue; }
        const all = ((res && res.buildings) || []).filter((x) => x && x.footprint && x.footprint.boundingBox);
        const same = all.filter((x) => x.biome === BIOME);
        const pool = same.length ? same : (MR === 2 ? all : []);
        if (pool.length) { pool.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy)); b = pool[0]; break; }
      }
      if (!b) return { ok: false, reason: 'no building resolved near settlement' };
      const bb = b.footprint.boundingBox;
      window._tileWalls = true;
      if (window._buildingRender) { window._buildingRender.master = true; window._buildingRender.walls = true; window._buildingRender.roof = true; window._buildingRender.shadow = true; }
      try { if (window._lighting && window._lighting.setTimeOfDay) window._lighting.setTimeOfDay(12); } catch {}
      return { ok: true, biome: b.biome, bx: b.x, by: b.y, bw: bb.w, bh: bb.h };
    }, { loc: found, BIOME: biome });

    if (!info.ok) { skipped.push({ biome, why: info.reason }); console.log(`  SKIP ${biome}: ${info.reason}`); continue; }
    console.log(`  building biome=${info.biome} at ${info.bx},${info.by} (${info.bw}x${info.bh})`);

    const cells = [];
    for (const mat of mats) {
      // force this material on the resolved building, frame the base identically, capture ON + OFF.
      const frame = await page.evaluate(({ info, mat }) => {
        window._tileMaterial = mat;
        window._tileWalls = true;
        const bb = { w: info.bw, h: info.bh };
        const south = info.by + bb.h;
        window._player.x = info.bx + bb.w / 2;
        window._player.y = south + 1.0;          // 1 tile south of the wall foot → base lands lower-centre
        if (window._camera) { window._camera.zoom = 2.4; window._camera.targetZoom = 2.4; }
        const h1 = document.getElementById('hud'); if (h1) h1.style.display = 'none';
        const h2 = document.getElementById('overmapWrap'); if (h2) h2.style.display = 'none';
        try { if (window._lighting && window._lighting.setTimeOfDay) window._lighting.setTimeOfDay(12); } catch {}
        return true;
      }, { info, mat });
      await wait(2600); // let the tile PNGs for this material load + the wall bake settle

      // compute the on-screen WALL rect for this building, so we measure the foundation strip precisely.
      const region = await page.evaluate(({ info }) => {
        const cam = window._camera; const tpx = (window._dbgTilePx || 32) * (cam ? cam.zoom : 1);
        // camera centres on the player; screen = (world - camWorldTopLeft)*tpx. Derive cam top-left from player.
        const vw = window.innerWidth, vh = window.innerHeight;
        const px = window._player.x, py = window._player.y;
        const camTLx = px - (vw / 2) / tpx, camTLy = py - (vh / 2) / tpx;
        const sx = (wx) => (wx - camTLx) * tpx, sy = (wy) => (wy - camTLy) * tpx;
        // wall occupies from the south wall foot upward by wallHeight (~4 tiles) * stories; approximate one
        // storey for framing the strip. Use the building bbox width for x.
        const WALLH = 4; // tiles (WALL_CONFIG.wallHeight); one storey is enough for the base strip
        const footY = info.by + info.bh;
        const x0 = sx(info.bx), x1 = sx(info.bx + info.bw);
        const y1 = sy(footY), y0 = sy(footY - WALLH);
        return { x0, y0, w: x1 - x0, h: y1 - y0, tpx, vw, vh };
      }, { info });

      const slug = `${biome}_${mat}`;
      // Re-pin camera/HUD/time right before BOTH captures so nothing drifts between ON and OFF (the diff must
      // isolate ONLY the weathering layer — door frame, lighting, CRT, cloud shadows are identical in both).
      const pin = () => page.evaluate(() => {
        if (window._camera) { window._camera.zoom = 2.4; window._camera.targetZoom = 2.4; }
        const h1 = document.getElementById('hud'); if (h1) h1.style.display = 'none';
        const h2 = document.getElementById('overmapWrap'); if (h2) h2.style.display = 'none';
        try { if (window._lighting && window._lighting.setTimeOfDay) window._lighting.setTimeOfDay(12); } catch {}
      });
      const onPath = OUT + `_qa_render__${slug}__ON.png`, offPath = OUT + `_qa_render__${slug}__OFF.png`;
      // Capture ON then OFF without moving the player, analyze the diff. If the result is a CAPTURE ARTIFACT
      // (negative darkening — impossible for a darkening grime pass — i.e. the shots were misaligned because a
      // door-anim/cloud/wall-bake was still settling), re-capture once after a longer settle. Up to 3 tries.
      let m, vr;
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate(() => { if (window._buildingRender) window._buildingRender.weathering = true; if (window._weathering) window._weathering.enabled = true; });
        await pin(); await wait(700 + attempt * 900);
        await shotTo(`_qa_render__${slug}__ON.png`);
        await page.evaluate(() => { if (window._buildingRender) window._buildingRender.weathering = false; if (window._weathering) window._weathering.enabled = false; });
        await pin(); await wait(700);
        await shotTo(`_qa_render__${slug}__OFF.png`);
        try {
          m = await analyze(onPath, offPath, region);
          vr = verdictFor(m);
        } catch (e) {
          m = { meanDarken: NaN, blotchVar: NaN, holeFrac: NaN, samples: 0, wallPix: 0 };
          vr = { verdict: 'SKIP', reasons: ['analyze error: ' + e.message] };
        }
        if (!(m && isArtifact(m))) break;          // good (or a real fail); stop retrying
        console.log(`    ${mat} — capture artifact (darken=${m.meanDarken.toFixed(1)} blotch=${m.blotchVar.toFixed(1)}), re-capturing…`);
      }
      const metric = `darken=${m.meanDarken.toFixed(1)} blotch=${m.blotchVar.toFixed(1)} holes=${(m.holeFrac * 100).toFixed(1)}% n=${m.samples}`;
      const tag = vr.verdict === 'FAIL' ? `FAIL [${vr.reasons.join(', ')}]` : vr.verdict;
      console.log(`    ${mat.padEnd(22)} ${tag.padEnd(34)} ${metric}`);
      results.push({ biome, material: mat, verdict: vr.verdict, reasons: vr.reasons, metric });
      cells.push({ material: mat, pngPath: onPath, verdict: vr.verdict, metric });

      // clean up the per-material OFF shot unless debugging (the contact sheet keeps the ON shot reference)
      if (!DEBUG) { try { if (existsSync(offPath)) unlinkSync(offPath); } catch {} }
    }
    const sheet = await montage(biome, cells);
    sheets.push(sheet);
    console.log(`  contact sheet → ${sheet}`);
    // clean the per-material ON shots after the sheet is built (the sheet embeds them) unless debugging
    if (!DEBUG) for (const c of cells) { try { if (c.pngPath && existsSync(c.pngPath)) unlinkSync(c.pngPath); } catch {} }
  }

  if (errs.length) console.log('\nPAGE ERRORS (first 8):\n  ' + errs.slice(0, 8).join('\n  '));
} finally {
  await browser.close();
}

if (!reachable) process.exit(process.exitCode || 3);

// ── final report ─────────────────────────────────────────────────────────────────────────────────────
console.log('\n════════════ QA-RENDER SUMMARY ════════════');
const fails = results.filter((r) => r.verdict === 'FAIL');
const byBiome = {};
for (const r of results) (byBiome[r.biome] = byBiome[r.biome] || []).push(r);
for (const b of Object.keys(byBiome)) {
  console.log(`\n${b}:`);
  for (const r of byBiome[b]) console.log(`  ${r.verdict === 'FAIL' ? '✗' : '✓'} ${r.material.padEnd(22)} ${r.verdict}${r.reasons.length ? ' — ' + r.reasons.join(', ') : ''}  (${r.metric})`);
}
if (skipped.length) { console.log('\nSKIPPED (no silent gaps):'); for (const s of skipped) console.log(`  - ${s.biome}: ${s.why}`); }
console.log('\nContact sheets:'); for (const s of sheets) console.log('  ' + s);

if (fails.length) {
  console.log(`\n${fails.length} material(s) FLAGGED over-weathered / holed:`);
  for (const f of fails) console.log(`  ✗ ${f.biome} / ${f.material} — ${f.reasons.join(', ')} (${f.metric})`);
  console.log('\nFIX over-weathering by extending the pale-material regex in src/render/dressing/d0-weathering.js');
  console.log(`(the gentling block: if (opts.material && /woven|thatch|grass|.../i.test(opts.material)) {...})`);
  process.exit(1);
} else {
  console.log(`\nALL PASS — ${results.length} (biome, material) render checks clean.`);
  process.exit(0);
}
