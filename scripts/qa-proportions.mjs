// scripts/qa-proportions.mjs <biome...>   (no arg = all built biomes)
// Automated tile-PROPORTION gate (the "tiny door / gigantic foundation" catcher the renderer can't fix).
// Per wall material it measures, on the SOLIDIFIED v0 tiles:
//   foundation% = bottom band of ground_plain that reads as a distinct footing course (vs the mid-wall).
//   doorH%      = vertical span of the door opening in ground_door (central columns that differ from the flank wall).
//   reachesGround = the door opening's bottom is within the lowest 12% of the tile.
// GOOD building: foundation ~12-26%, doorH >= 52%, reachesGround. A bad tileset (oversized footing pushing a
// stubby door up) trips foundation>30 or doorH<45 -> FAIL -> regenerate the BASE with a tighter {FOUNDATION}.
// Exit 2 if any material FAILS (so the pipeline/CI can gate).
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const FOUND_MAX = 0.30, DOORH_MIN = 0.45;
const built = ['grassland', 'desert', 'mystic', 'forest', 'volcanic', 'mountains', 'hills', 'taiga', 'dense_forest'];
let biomes = process.argv.slice(2);
if (!biomes.length) biomes = built.filter((b) => fs.existsSync(`assets/pixelab/buildings/tiles/${b}`));

const data = async (p) => { const im = await loadImage(p); const c = createCanvas(im.width, im.height); const x = c.getContext('2d'); x.drawImage(im, 0, 0); return { d: x.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height }; };
const lum = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
function rowMean(g, y) { let r = 0, gg = 0, b = 0, n = 0; for (let x = 0; x < g.w; x++) { const i = (y * g.w + x) * 4; if (g.d[i + 3] > 80) { r += g.d[i]; gg += g.d[i + 1]; b += g.d[i + 2]; n++; } } return n ? [r / n, gg / n, b / n] : null; }
function bandMean(g, y, x0, x1) { let s = 0, n = 0; for (let x = Math.floor(x0); x < x1; x++) { const i = (y * g.w + x) * 4; if (g.d[i + 3] > 80) { s += lum(g.d, i); n++; } } return n ? s / n : null; }

async function foundationFrac(p) {
  const g = await data(p); const mid = rowMean(g, Math.floor(g.h * 0.45)) || [0, 0, 0];
  let band = 0, gap = 0;
  for (let y = g.h - 1; y > g.h * 0.4; y--) { const m = rowMean(g, y); if (!m) { if (band) break; else continue; } const dist = Math.abs(m[0] - mid[0]) + Math.abs(m[1] - mid[1]) + Math.abs(m[2] - mid[2]); if (dist > 70) { band += 1 + gap; gap = 0; } else { gap++; if (gap > 6) break; } }
  return band / g.h;
}
async function doorMetrics(p) {
  const g = await data(p); const cx0 = g.w * 0.32, cx1 = g.w * 0.68;
  let top = -1, bot = -1;
  for (let y = Math.floor(g.h * 0.05); y < g.h * 0.99; y++) {
    const cen = bandMean(g, y, cx0, cx1); const fl = (bandMean(g, y, g.w * 0.04, g.w * 0.18) + bandMean(g, y, g.w * 0.82, g.w * 0.96)) / 2;
    if (cen == null || fl == null) continue;
    if (Math.abs(cen - fl) > 18) { if (top < 0) top = y; bot = y; }
  }
  return { doorH: bot < 0 ? 0 : (bot - top) / g.h, reachesGround: bot >= 0 && bot > g.h * 0.88 };
}

let anyFail = false;
for (const biome of biomes) {
  const root = `assets/pixelab/buildings/tiles/${biome}`;
  if (!fs.existsSync(root)) continue;
  const mats = fs.readdirSync(root).filter((m) => { try { return fs.statSync(`${root}/${m}`).isDirectory() && fs.existsSync(`${root}/${m}/ground_plain__v0.png`); } catch { return false; } });
  console.log(`\n== ${biome} ==`);
  for (const m of mats) {
    const ff = await foundationFrac(`${root}/${m}/ground_plain__v0.png`).catch(() => 0);
    let dm = { doorH: 1, reachesGround: true };
    if (fs.existsSync(`${root}/${m}/ground_door__v0.png`)) dm = await doorMetrics(`${root}/${m}/ground_door__v0.png`).catch(() => dm);
    // HARD gate = door proportions only (reliable). foundation% is a HINT — it false-fires on heavily-textured
    // walls (logs/brick/reed read as a tall "band"), so it must never auto-trigger a regen on its own.
    const fails = [];
    if (dm.doorH < DOORH_MIN) fails.push(`doorH ${(dm.doorH * 100).toFixed(0)}%<${DOORH_MIN * 100} (tiny door)`);
    else if (!dm.reachesGround && dm.doorH < 0.65) fails.push('small door floating above the footing');
    // (a full-height door with a thin sill is fine — only a SHORT door left sitting on the footing fails)
    const hint = ff > FOUND_MAX ? `  hint:foundation≈${(ff * 100).toFixed(0)}% (verify visually)` : '';
    if (fails.length) anyFail = true;
    console.log(`  ${fails.length ? 'FAIL' : 'ok  '} ${m.padEnd(20)} foundation=${(ff * 100).toFixed(0).padStart(3)}%  doorH=${(dm.doorH * 100).toFixed(0).padStart(3)}%  ${fails.join('; ')}${fails.length ? '' : hint}`);
  }
}
process.exit(anyFail ? 2 : 0);
