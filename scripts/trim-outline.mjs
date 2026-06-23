// scripts/trim-outline.mjs — CROP PixelLab's near-black OUTLINE off a tile's left/right (and optionally
// top/bottom) edges, so the textured material reaches the edge. Fixes BOTH the mirror-tiling seam (at a
// base·flip join the two outline columns met → a dark vertical seam) AND the hard black border on the
// building's terminating edge. The outline width is AUTO-DETECTED per edge (the leading near-black run,
// ~7px for fieldstone), so we crop exactly the outline — not interior black (windows/beams are never the
// leading edge run). 60th-percentile run length per edge → robust to a few lines where a dark feature
// touches the edge.
//
// Usage: node scripts/trim-outline.mjs <in> <out> [edges=lr] [dark=50] [max=15]
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , inp, outp, edges = 'lr', darkS = '50', maxS = '15'] = process.argv;
if (!inp || !outp) { console.error('usage: trim-outline.mjs <in> <out> [edges] [dark] [max]'); process.exit(2); }
const dark = +darkS, max = +maxS;
const img = await loadImage(inp);
const W = img.width, H = img.height;
const ctx = createCanvas(W, H).getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, W, H).data;
const lum = i => (d[i] + d[i + 1] + d[i + 2]) / 3;
// Edge garbage = the leading run we want gone: either PixelLab's near-black outline OR a transparent
// margin. Crop until the first SOLID TEXTURED pixel (opaque AND brighter than `dark`).
const isGarbage = i => d[i + 3] < 20 || lum(i) < dark;

const runLen = (idxAt, lines) => {
  const runs = [];
  for (let l = 0; l < lines; l++) {
    let k = 0; for (; k < max; k++) { if (isGarbage(idxAt(l, k))) continue; else break; }
    runs.push(k);
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length * 0.8)] || 0;   // 80th percentile leading garbage run (robust)
};

const cl = edges.includes('l') ? runLen((y, k) => (y * W + k) * 4, H) : 0;
const cr = edges.includes('r') ? runLen((y, k) => (y * W + (W - 1 - k)) * 4, H) : 0;
const ct = edges.includes('t') ? runLen((x, k) => (k * W + x) * 4, W) : 0;
const cb = edges.includes('b') ? runLen((x, k) => ((H - 1 - k) * W + x) * 4, W) : 0;

const nW = W - cl - cr, nH = H - ct - cb;
const out = createCanvas(nW, nH); const ox = out.getContext('2d'); ox.imageSmoothingEnabled = false;
ox.drawImage(img, cl, ct, nW, nH, 0, 0, nW, nH);
fs.writeFileSync(outp, out.toBuffer('image/png'));
console.log(`trim-outline ${edges}: crop L${cl} R${cr} T${ct} B${cb} -> ${nW}x${nH}  [${outp}]`);
