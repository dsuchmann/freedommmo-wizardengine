// scripts/window-shutter-anim.mjs <materialDir> [frames=9]
// DETERMINISTIC, artifact-free SHUTTER-window animation — replaces PixelLab v3 animate_object for shuttered
// windows on PALE walls. v3 reliably MELTS a small timber-shutter window across a pale, low-contrast wall:
// it latches onto the only high-contrast (timber) element and grows the shutters to fill the WHOLE tile
// (verified: felt_frame frame_008 turned the entire wall into giant shutters). Same precedent + machinery as
// door-swing-anim.mjs / glow-pulse: synthesize clean motion in code instead of trusting v3.
//
// How: the WINDOW opening is located by diffing the two static tiles we already have — ground_window (Wn, the
// small shut-shutter window) vs ground_plain (P, blank wall). The strong-diff bbox IS the window. We keep ALL of
// Wn untouched (wall, eave, footing, felt skin, frame, sill) and only repaint INSIDE the opening rect: a plain
// dark interior, with TWO shutter leaves (split from the closed-window content) that swing open toward their
// side jambs, foreshortening to (1-open) width. frame_000 == Wn exactly (both leaves full width over the dark
// fill = the shut window). Output dims == the static window tile, so NO fit/freeze/normalize needed afterwards.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const matDir = process.argv[2];
const N = +(process.argv[3] || 9);
const Wnp = `${matDir}/ground_window__v0.png`, Pp = `${matDir}/ground_plain__v0.png`;
if (!fs.existsSync(Wnp)) { console.error('no ground_window at', Wnp); process.exit(3); }

const Wn = await loadImage(Wnp);
const W = Wn.width, H = Wn.height;
const wC = createCanvas(W, H); const wx = wC.getContext('2d'); wx.imageSmoothingEnabled = false; wx.drawImage(Wn, 0, 0);
const wData = wx.getImageData(0, 0, W, H);

// plain tile, resized to window dims, for the diff
const pC = createCanvas(W, H); const px = pC.getContext('2d'); px.imageSmoothingEnabled = false;
if (fs.existsSync(Pp)) { const P = await loadImage(Pp); px.drawImage(P, 0, 0, W, H); }
const pData = px.getImageData(0, 0, W, H);

// Locate the window by STRONG, CONTIGUOUS diff (two PixelLab gens differ in scattered wall pixels too, so a
// plain bbox of diff>60 balloons; instead score cols/rows by strong-diff count and grow the cluster around the
// peak). Window is small + roughly centred — search the central band.
const wd = wData.data, pd = pData.data;
const STRONG = 95;
const colScore = new Float64Array(W), rowScore = new Float64Array(H);
const strong = (x, y) => { const i = (y * W + x) * 4; if (wd[i + 3] < 80) return false; return (Math.abs(wd[i] - pd[i]) + Math.abs(wd[i + 1] - pd[i + 1]) + Math.abs(wd[i + 2] - pd[i + 2])) > STRONG; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (strong(x, y)) { colScore[x]++; rowScore[y]++; }
const peak = (arr, lo, hi) => { let p = Math.floor((lo + hi) / 2), mv = -1; for (let i = lo; i < hi; i++) if (arr[i] > mv) { mv = arr[i]; p = i; } return { p, mv }; };
const grow = (arr, center, thr, maxGap) => { let lo = center, hi = center, gap = 0; for (let i = center - 1; i >= 0; i--) { if (arr[i] >= thr) { lo = i; gap = 0; } else if (++gap > maxGap) break; } gap = 0; for (let i = center + 1; i < arr.length; i++) { if (arr[i] >= thr) { hi = i; gap = 0; } else if (++gap > maxGap) break; } return [lo, hi]; };
const cpk = peak(colScore, Math.floor(W * 0.15), Math.floor(W * 0.85));
let [cx0, cx1] = grow(colScore, cpk.p, Math.max(2, cpk.mv * 0.30), Math.round(W * 0.03));
const rpk = peak(rowScore, Math.floor(H * 0.08), Math.floor(H * 0.85));
let [ry0, ry1] = grow(rowScore, rpk.p, Math.max(2, rpk.mv * 0.30), Math.round(H * 0.04));
// clamp to a sane window (≤44% wide, ≤44% tall — a window is small) so noise can't widen it
let cw = Math.min(cx1 - cx0, W * 0.44), ch = Math.min(ry1 - ry0, H * 0.44);
let minX = (cx0 + cx1) / 2 - cw / 2, minY = (ry0 + ry1) / 2 - ch / 2, maxX = minX + cw, maxY = minY + ch;

// degenerate diff (mismatched dims / noise) → geometric centred small window
const bad = (a, c, e, f) => !(c > a) || !(f > e) || (c - a) < W * 0.10 || (f - e) < H * 0.10;
if (bad(minX, maxX, minY, maxY)) {
  minX = W * 0.36; maxX = W * 0.64; minY = H * 0.22; maxY = H * 0.50;
  console.error('window-shutter: diff degenerate → geometric centred window rect');
}

// isolate the swinging LEAVES: drop the thin static frame/sill ring around the opening, then split L/R
const bw = maxX - minX, bh = maxY - minY;
const ox = Math.round(minX + bw * 0.12), oW = Math.round(bw * 0.76);
const oy = Math.round(minY + bh * 0.10), oH = Math.round(bh * 0.78);
const half = Math.floor(oW / 2);
// shutter leaf sprites = the closed-window content inside each half of the opening
const leafL = createCanvas(half, oH); leafL.getContext('2d').drawImage(wC, ox, oy, half, oH, 0, 0, half, oH);
const leafR = createCanvas(oW - half, oH); leafR.getContext('2d').drawImage(wC, ox + half, oy, oW - half, oH, 0, 0, oW - half, oH);

const outDir = `${matDir}/anim/window`;
fs.mkdirSync(outDir, { recursive: true });
// clear stale v3 frames so the synth is authoritative
for (const f of fs.readdirSync(outDir)) if (/^frame_\d+\.png$/.test(f)) fs.rmSync(`${outDir}/${f}`);
for (let t = 0; t < N; t++) {
  const open = t / (N - 1);                  // 0 shut → 1 open
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(wC, 0, 0);                      // full static window tile (wall/eave/footing/frame/sill preserved)
  // plain dark interior behind the leaves
  const g = x.createLinearGradient(0, oy, 0, oy + oH);
  g.addColorStop(0, '#070708'); g.addColorStop(0.6, '#0c0c0f'); g.addColorStop(1, '#040405');
  x.fillStyle = g; x.fillRect(ox, oy, oW, oH);
  // LEFT leaf: hinged on the left jamb, foreshortens toward ox; RIGHT leaf: hinged on the right jamb
  const lw = Math.max(1, Math.round(half * (1 - open * 0.90)));
  const rw = Math.max(1, Math.round((oW - half) * (1 - open * 0.90)));
  if (open < 0.995) {
    x.globalAlpha = 1; x.drawImage(leafL, ox, oy, lw, oH);
    x.drawImage(leafR, ox + oW - rw, oy, rw, oH);
    if (open > 0) {
      x.globalAlpha = 0.42 * open; x.fillStyle = '#000';
      x.fillRect(ox, oy, lw, oH); x.fillRect(ox + oW - rw, oy, rw, oH); x.globalAlpha = 1;
    }
    // thin shaded inner jamb edges so the reveal reads as depth
    x.fillStyle = 'rgba(0,0,0,0.5)';
    x.fillRect(ox + lw, oy, 1, oH); x.fillRect(ox + oW - rw - 1, oy, 1, oH);
  }
  fs.writeFileSync(`${outDir}/frame_${String(t).padStart(3, '0')}.png`, c.toBuffer('image/png'));
}
console.log(`window-shutter ${N} frames -> ${outDir}  (opening rect ${oW}x${oH}@${ox},${oy}, two leaves)`);
