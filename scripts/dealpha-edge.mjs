// scripts/dealpha-edge.mjs — strip PixelLab's near-black OUTLINE off a tile's edge.
//
// The dark outline on tile edges causes TWO artifacts: (1) at internal mirror-tiling seams (base·flip)
// two outline columns meet → a dark vertical seam; (2) at the building's outer terminating edge it reads
// as a hard black border against grass. This removes the leading near-black run on the chosen edge.
//
// MODES:
//   fill  — replace the outline run with the first textured pixel's colour (OPAQUE) → seamless tiling
//           (texture continues to the edge so the mirror seam is texture-on-texture, no dark line).
//   alpha — clear the outline run to transparent → clean alpha edge for the building's OUTER edge vs grass.
//
// DELICATE: only the LEADING near-black run (darker than `dark`) up to `pad` px deep, STOPPING at the
// first textured pixel per line. Interior black (windows, beams, thresholds) is never touched.
//
// Usage: node scripts/dealpha-edge.mjs <in> <out> <left|right|top|bottom> <fill|alpha> [pad=4] [dark=45]
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , inp, outp, edge = 'left', mode = 'alpha', padS = '4', darkS = '45'] = process.argv;
if (!inp || !outp) { console.error('usage: dealpha-edge.mjs <in> <out> <edge> <fill|alpha> [pad] [dark]'); process.exit(2); }
const pad = +padS, dark = +darkS;
const img = await loadImage(inp);
const W = img.width, H = img.height;
const cv = createCanvas(W, H); const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const id = ctx.getImageData(0, 0, W, H), d = id.data;
const lum = i => (d[i] + d[i + 1] + d[i + 2]) / 3;
let changed = 0;

const processLine = (idxAt) => {
  let runLen = 0, stop = -1;
  for (let k = 0; k <= pad; k++) {
    const i = idxAt(k); if (i < 0) break;
    if (d[i + 3] > 20 && lum(i) < dark) runLen = k + 1; else { stop = i; break; }
  }
  if (runLen === 0) return;
  for (let k = 0; k < runLen; k++) {
    const i = idxAt(k);
    if (mode === 'alpha') d[i + 3] = 0;
    else if (mode === 'fill' && stop >= 0) { d[i] = d[stop]; d[i + 1] = d[stop + 1]; d[i + 2] = d[stop + 2]; d[i + 3] = d[stop + 3]; }
  }
  changed += runLen;
};

if (edge === 'left') for (let y = 0; y < H; y++) processLine(k => (y * W + k) * 4);
else if (edge === 'right') for (let y = 0; y < H; y++) processLine(k => (y * W + (W - 1 - k)) * 4);
else if (edge === 'top') for (let x = 0; x < W; x++) processLine(k => (k * W + x) * 4);
else if (edge === 'bottom') for (let x = 0; x < W; x++) processLine(k => ((H - 1 - k) * W + x) * 4);
else { console.error('edge must be left|right|top|bottom'); process.exit(2); }

ctx.putImageData(id, 0, 0);
fs.writeFileSync(outp, cv.toBuffer('image/png'));
console.log(`dealpha-edge ${edge} ${mode} pad=${pad} dark=${dark}: ${changed}px  [${outp}]`);
