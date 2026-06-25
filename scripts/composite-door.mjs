// scripts/composite-door.mjs <materialDir>
// DETERMINISTIC door recovery for PALE walls whose door-state gens always alpha-matte the FLANKING wall
// (measured 30-37% holes across 3 packed-snow rolls — the DOOR itself is fine, only the snow blocks beside it
// go translucent and solidify then smears them). Instead of burning unlimited re-rolls, keep the PRISTINE base
// wall (ground_plain, low-hole) and graft ONLY the central door+frame column from the door gen onto it.
// Result: clean opaque snow flanks + the good ground-reaching door, fully opaque, dims == base tile.
//
// How: load base (P) and door (D), resize D to P's dims. Locate the door COLUMN by the strong central diff
// between D and P (the door/frame differs hard from the snow; the flanks barely differ). Take a centred column
// rect covering the door, and paste D's pixels there onto a copy of P. Feather a 2px seam so the graft blends.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const matDir = process.argv[2];
const Pp = `${matDir}/ground_plain__v0.png`, Dp = `${matDir}/ground_door__v0.png`;
const outp = process.argv[3] || `${matDir}/ground_door__v0.png`;
if (!fs.existsSync(Pp) || !fs.existsSync(Dp)) { console.error('need ground_plain + ground_door'); process.exit(3); }

const Pimg = await loadImage(Pp);
const W = Pimg.width, H = Pimg.height;
const pc = createCanvas(W, H); const px = pc.getContext('2d'); px.imageSmoothingEnabled = false; px.drawImage(Pimg, 0, 0);
const pData = px.getImageData(0, 0, W, H);

const Dimg = await loadImage(Dp);
const dc = createCanvas(W, H); const dx = dc.getContext('2d'); dx.imageSmoothingEnabled = false;
dx.drawImage(Dimg, 0, 0, Dimg.width, Dimg.height, 0, 0, W, H);   // resize door to base dims
const dData = dx.getImageData(0, 0, W, H);

const pd = pData.data, dd = dData.data;
// column-score the STRONG central diff (door/frame vs snow)
const colScore = new Float64Array(W);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  if (dd[i + 3] < 80) continue;
  const diff = Math.abs(dd[i] - pd[i]) + Math.abs(dd[i + 1] - pd[i + 1]) + Math.abs(dd[i + 2] - pd[i + 2]);
  if (diff > 70) colScore[x]++;
}
// peak within central 60%, grow contiguous
let peak = Math.floor(W / 2), mv = -1;
for (let x = Math.floor(W * 0.2); x < W * 0.8; x++) if (colScore[x] > mv) { mv = colScore[x]; peak = x; }
const thr = Math.max(2, mv * 0.30); const maxGap = Math.round(W * 0.04);
let lo = peak, hi = peak, gap = 0;
for (let x = peak - 1; x >= 0; x--) { if (colScore[x] >= thr) { lo = x; gap = 0; } else if (++gap > maxGap) break; }
gap = 0;
for (let x = peak + 1; x < W; x++) { if (colScore[x] >= thr) { hi = x; gap = 0; } else if (++gap > maxGap) break; }
// clamp to a sane centred door column (<=46% wide), pad a touch to include the frame trim
let cw = Math.min(hi - lo, W * 0.46);
const cxc = (lo + hi) / 2;
let x0 = Math.max(0, Math.round(cxc - cw / 2) - 3);
let x1 = Math.min(W, Math.round(cxc + cw / 2) + 3);
if (x1 - x0 < W * 0.16) { x0 = Math.round(W * 0.32); x1 = Math.round(W * 0.68); }  // geometric fallback

// graft: copy door column from D onto P, feather 2px at each vertical seam
const out = pc;  // mutate base copy
const oData = px.getImageData(0, 0, W, H); const od = oData.data;
const feather = 2;
for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
  const i = (y * W + x) * 4;
  // blend weight: 0 at the outer 2px seam → 1 inside
  let w = 1;
  if (x < x0 + feather) w = (x - x0 + 1) / (feather + 1);
  else if (x > x1 - 1 - feather) w = (x1 - 1 - x + 1) / (feather + 1);
  for (let k = 0; k < 3; k++) od[i + k] = Math.round(dd[i + k] * w + od[i + k] * (1 - w));
  od[i + 3] = 255;
}
px.putImageData(oData, 0, 0);
fs.writeFileSync(outp, pc.toBuffer('image/png'));
console.log(`composite-door -> ${outp}  door column x[${x0}..${x1}] (${x1 - x0}px, ${((x1 - x0) / W * 100).toFixed(0)}% of ${W})`);
