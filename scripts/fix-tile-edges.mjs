// scripts/fix-tile-edges.mjs <materialDir>
// Two post-process fixes the build-biome pipeline was missing (user 2026-06-25 — hills black edges + window
// size mismatch). Run AFTER solidify, on every wall tile of a material:
//  (1) DE-OUTLINE the L/R edges. PixelLab bakes a near-black OPAQUE outline on tile edges (not transparency —
//      the pixels are solid black). On a building's left/right edge (the corner tiles) and on pale walls it reads
//      as a black line that breaks the wall-edge illusion, and at a base·flip mirror join it makes a dark seam.
//      Per row, replace the contiguous near-black-opaque run at each L/R edge with the first interior pixel
//      (extends the wall texture outward) — preserves dims AND the shaped edge, just kills the black line.
//  (2) NORMALIZE STATE DIMS. solidify crops each state to its own content bbox, so ground_window can end up 11px
//      taller than ground_plain → the renderer draws it a different size and windows don't line up. Scale every
//      ground_* state to ground_plain's exact dims and every upper_* state to upper_plain's dims (a few-px scale,
//      visually imperceptible, guarantees the apertures register on the wall grid).
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('usage: fix-tile-edges.mjs <materialDir>'); process.exit(3); }
const lum = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];

async function load(p) { const im = await loadImage(p); const c = createCanvas(im.width, im.height); const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(im, 0, 0); return { c, x, W: im.width, H: im.height }; }

function deoutline(g) {
  const id = g.x.getImageData(0, 0, g.W, g.H), d = id.data, W = g.W, H = g.H;
  const dark = (i) => d[i + 3] > 40 && lum(d, i) < 34;
  const MAX = Math.max(4, Math.round(W * 0.05)); // cap the run we'll eat (~13px on 256) — outlines are 5-7px
  const cp = (di, si) => { d[di] = d[si]; d[di + 1] = d[si + 1]; d[di + 2] = d[si + 2]; d[di + 3] = d[si + 3]; };
  for (let y = 0; y < H; y++) {
    let xs = 0; while (xs < MAX && dark((y * W + xs) * 4)) xs++;
    if (xs > 0 && xs < W) { const s = (y * W + xs) * 4; for (let xx = 0; xx < xs; xx++) cp((y * W + xx) * 4, s); }
    let xe = W - 1, cnt = 0; while (cnt < MAX && xe > 0 && dark((y * W + xe) * 4)) { xe--; cnt++; }
    if (cnt > 0) { const s = (y * W + xe) * 4; for (let xx = W - 1; xx > xe; xx--) cp((y * W + xx) * 4, s); }
  }
  g.x.putImageData(id, 0, 0);
}

const files = fs.readdirSync(dir).filter((f) => /^(ground|upper)_.*__v\d+\.png$/.test(f));
// (1) de-outline every wall tile in place
for (const f of files) { const g = await load(`${dir}/${f}`); deoutline(g); fs.writeFileSync(`${dir}/${f}`, g.c.toBuffer('image/png')); }
// (2) normalize each state to its plain's dims
const dimsOf = async (n) => { const p = `${dir}/${n}__v0.png`; if (!fs.existsSync(p)) return null; const im = await loadImage(p); return { W: im.width, H: im.height }; };
const gp = await dimsOf('ground_plain'), up = await dimsOf('upper_plain');
let scaled = 0;
for (const f of files) {
  const base = f.replace(/__v\d+\.png$/, '');
  if (base === 'ground_plain' || base === 'upper_plain') continue;
  const ref = base.startsWith('upper_') ? up : gp; if (!ref) continue;
  const im = await loadImage(`${dir}/${f}`);
  if (im.width === ref.W && im.height === ref.H) continue;
  const c = createCanvas(ref.W, ref.H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(im, 0, 0, ref.W, ref.H);
  fs.writeFileSync(`${dir}/${f}`, c.toBuffer('image/png')); scaled++;
}
console.log(`fix-tile-edges ${dir.split(/[\\/]/).slice(-1)[0]}: de-outlined ${files.length} tiles, normalized ${scaled} states → ground ${gp ? gp.W + 'x' + gp.H : '?'}, upper ${up ? up.W + 'x' + up.H : '?'}`);
