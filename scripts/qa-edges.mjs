// scripts/qa-edges.mjs <biome...>   (no arg = all built biomes)
// Gate for the two issues the user caught in-game (2026-06-25) that solidify/qa-tiles missed:
//   (1) BAKED BLACK EDGE — PixelLab bakes a near-black OPAQUE outline on tile edges; on a building's L/R edge it
//       reads as a black line. `fix-tile-edges.mjs` de-outlines it; this gate FAILs if a CORNER's outer edge is
//       STILL >40% near-black-opaque after that (a too-dark quoin/outline wider than the de-outline cap →
//       regenerate that material's corner/base with a LIGHTER mid-grey edge, do not just strip wider).
//   (2) STATE-DIM MISMATCH — a window/door/corner state a different size than ground_plain → it renders the wrong
//       size and apertures don't line up. `fix-tile-edges.mjs` normalizes it; this gate FAILs if any remain.
// Near-black = lum<34 & alpha≥40 (an OPAQUE dark line, distinct from transparency).
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const CORNER_BLK_MAX = 40;
const built = ['grassland', 'desert', 'mystic', 'forest', 'volcanic', 'mountains', 'hills', 'taiga', 'dense_forest', 'savanna', 'steppe', 'tundra', 'arctic', 'tropical_forest', 'beach', 'river', 'lake', 'shallow_water', 'ocean', 'deep_ocean'];
let biomes = process.argv.slice(2);
if (!biomes.length) biomes = built.filter((b) => fs.existsSync(`assets/pixelab/buildings/tiles/${b}`));
const lum = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
const px = async (p) => { const im = await loadImage(p); const c = createCanvas(im.width, im.height); const x = c.getContext('2d'); x.drawImage(im, 0, 0); return { d: x.getImageData(0, 0, im.width, im.height).data, W: im.width, H: im.height }; };
const colBlk = (g, xc) => { let blk = 0, op = 0; for (let y = 0; y < g.H; y++) { const i = (y * g.W + xc) * 4; if (g.d[i + 3] > 40) { op++; if (lum(g.d, i) < 34) blk++; } } return Math.round(blk / Math.max(1, op) * 100); };
let anyFail = false;
for (const biome of biomes) {
  const root = `assets/pixelab/buildings/tiles/${biome}`;
  if (!fs.existsSync(root)) continue;
  const mats = fs.readdirSync(root).filter((m) => { try { return fs.existsSync(`${root}/${m}/ground_plain__v0.png`); } catch { return false; } });
  console.log(`\n== ${biome} ==`);
  for (const m of mats) {
    const fails = [];
    const lc = `${root}/${m}/ground_left_corner__v0.png`, rc = `${root}/${m}/ground_right_corner__v0.png`;
    if (fs.existsSync(lc)) { const g = await px(lc); const b = colBlk(g, 0); if (b > CORNER_BLK_MAX) fails.push(`left-corner outer edge ${b}% black`); }
    if (fs.existsSync(rc)) { const g = await px(rc); const b = colBlk(g, g.W - 1); if (b > CORNER_BLK_MAX) fails.push(`right-corner outer edge ${b}% black`); }
    const pg = await px(`${root}/${m}/ground_plain__v0.png`); const ref = `${pg.W}x${pg.H}`;
    for (const st of ['ground_window', 'ground_door', 'ground_left_corner', 'ground_right_corner']) {
      const p = `${root}/${m}/${st}__v0.png`; if (!fs.existsSync(p)) continue;
      const g = await px(p); if (`${g.W}x${g.H}` !== ref) fails.push(`${st} ${g.W}x${g.H} != plain ${ref}`);
    }
    if (fails.length) anyFail = true;
    console.log(`  ${fails.length ? 'FAIL' : 'ok  '} ${m.padEnd(20)} ${fails.join('; ')}`);
  }
}
process.exit(anyFail ? 2 : 0);
