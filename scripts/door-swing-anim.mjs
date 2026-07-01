// scripts/door-swing-anim.mjs <materialDir> [frames=9] [hinge=left]
// DETERMINISTIC, artifact-free door-open animation — replaces PixelLab v3 animate_object for doors (v3 bakes
// sparkles / scanline streaks / wall-melt into the opening frames; qa can't reliably catch them). Same precedent
// as glow-pulse for no-shutter windows: synthesize clean motion in code instead of trusting v3.
//
// How: the door OPENING is located by diffing the two static tiles we already have — ground_door (D, leaf shut)
// vs ground_plain (P, no door). The diff bbox IS the door; we inset it to isolate the swinging LEAF from its
// static frame/trim. Each frame keeps ALL of D (wall, eave, footing, frame trim) untouched and only repaints the
// opening rect: a plain dark interior, with the leaf drawn at the hinge horizontally foreshortened to (1-open)
// width and darkening as it swings in. frame_000 == D exactly (leaf full width over the dark fill = the shut door
// the user already likes). Output dims == static tile, so NO fit/freeze/normalize needed afterwards.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const matDir = process.argv[2];
const N = +(process.argv[3] || 9);
const hinge = (process.argv[4] || 'left');
// Optional explicit door rect as fractions of the tile: --rect x0,y0,x1,y1 (0..1). When the diff/warm/geometric
// auto-locate picks the wrong spot (e.g. a door-state re-gen that repaints the whole wall, so the strong-diff
// spreads everywhere and the grow walks off the real door), pass the measured frame box to force the location.
const rectArg = (() => { const i = process.argv.indexOf('--rect'); return i >= 0 ? process.argv[i + 1] : null; })();
const Dp = `${matDir}/ground_door__v0.png`, Pp = `${matDir}/ground_plain__v0.png`;
if (!fs.existsSync(Dp)) { console.error('no ground_door at', Dp); process.exit(3); }

const D = await loadImage(Dp);
const W = D.width, H = D.height;
const dC = createCanvas(W, H); const dx = dC.getContext('2d'); dx.imageSmoothingEnabled = false; dx.drawImage(D, 0, 0);
const dData = dx.getImageData(0, 0, W, H);

// plain tile, resized to door dims, for the diff
const pC = createCanvas(W, H); const px = pC.getContext('2d'); px.imageSmoothingEnabled = false;
if (fs.existsSync(Pp)) { const P = await loadImage(Pp); px.drawImage(P, 0, 0, W, H); }
const pData = px.getImageData(0, 0, W, H);

// Locate the door by STRONG, CONTIGUOUS, CENTRAL diff (two separate PixelLab gens differ in scattered wall
// pixels too, so a plain bbox of diff>60 balloons to the whole tile — instead score columns/rows by STRONG-diff
// count and grow only the contiguous central cluster around the peak).
const dd = dData.data, pd = pData.data;
const STRONG = 95;
const colScore = new Float64Array(W), rowScore = new Float64Array(H);
const strong = (x, y) => { const i = (y * W + x) * 4; if (dd[i + 3] < 80) return false; return (Math.abs(dd[i] - pd[i]) + Math.abs(dd[i + 1] - pd[i + 1]) + Math.abs(dd[i + 2] - pd[i + 2])) > STRONG; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (strong(x, y)) { colScore[x]++; rowScore[y]++; }
const peak = (arr, lo, hi) => { let p = Math.floor((lo + hi) / 2), mv = -1; for (let i = lo; i < hi; i++) if (arr[i] > mv) { mv = arr[i]; p = i; } return { p, mv }; };
const grow = (arr, center, thr, maxGap) => { let lo = center, hi = center, gap = 0; for (let i = center - 1; i >= 0; i--) { if (arr[i] >= thr) { lo = i; gap = 0; } else if (++gap > maxGap) break; } gap = 0; for (let i = center + 1; i < arr.length; i++) { if (arr[i] >= thr) { hi = i; gap = 0; } else if (++gap > maxGap) break; } return [lo, hi]; };
// door center is the strongest-diff column within the central 60% of the tile
const cpk = peak(colScore, Math.floor(W * 0.2), Math.floor(W * 0.8));
let [cx0, cx1] = grow(colScore, cpk.p, Math.max(2, cpk.mv * 0.30), Math.round(W * 0.03));
let [ry0, ry1] = grow(rowScore, peak(rowScore, Math.floor(H * 0.1), Math.floor(H * 0.95)).p, Math.max(2, peak(rowScore, Math.floor(H * 0.1), Math.floor(H * 0.95)).mv * 0.25), Math.round(H * 0.05));
// clamp to a sane door (≤46% wide, ≤88% tall) so noise can't widen it
let cw = Math.min(cx1 - cx0, W * 0.46), ch = Math.min(ry1 - ry0, H * 0.88);
let minX = (cx0 + cx1) / 2 - cw / 2, minY = ry0, maxX = minX + cw, maxY = ry0 + ch;

// A valid door rect is centred, sane-width, and TALL. The diff path is degenerate if its FINAL clamped rect
// collapses (too thin/short — noise) — which also covers the case where ground_door/ground_plain have mismatched
// solidify-crop dims (resizing P shifts every feature, so the diff balloons and the clamp then collapses it).
// Test the FINAL rect (NOT the raw column spread — the clamp already caps width, so a wide raw spread is fine).
const bad = (a, c, e, f) => !(c > a) || !(f > e) || (c - a) < W * 0.16 || (f - e) < H * 0.45;
if (bad(minX, maxX, minY, maxY)) {
  // (1) WARM-WOOD signature — only when it has real signal (a honey/amber door on a darker/cooler wall).
  const warmCol = new Float64Array(W), warmRow = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; if (dd[i + 3] < 80) continue;
    const r = dd[i], g = dd[i + 1], b = dd[i + 2];
    if (r > 110 && r - g > 28 && g - b > 8) { warmCol[x]++; warmRow[y]++; }
  }
  const wcp = peak(warmCol, Math.floor(W * 0.15), Math.floor(W * 0.85));
  const wrp = peak(warmRow, Math.floor(H * 0.05), Math.floor(H * 0.97));
  const [wx0, wx1] = grow(warmCol, wcp.p, Math.max(2, wcp.mv * 0.30), Math.round(W * 0.04));
  const [wy0, wy1] = grow(warmRow, wrp.p, Math.max(2, wrp.mv * 0.25), Math.round(H * 0.08));
  const wcw = Math.min(wx1 - wx0, W * 0.46), wch = Math.min(wy1 - wy0, H * 0.92);
  const wmnX = (wx0 + wx1) / 2 - wcw / 2, wmxX = wmnX + wcw, wmxY = wy0 + wch;
  if (wcp.mv > 6 && !bad(wmnX, wmxX, wy0, wmxY)) {
    minX = wmnX; maxX = wmxX; minY = wy0; maxY = wmxY;
    console.error(`door-swing: diff degenerate → warm-wood fallback ${Math.round(wcw)}x${Math.round(wch)}`);
  } else {
    // (2) GEOMETRIC centred door — robust for ANY material (doors are placed centred), can never be 0x0.
    minX = W * 0.32; maxX = W * 0.68; minY = H * 0.13; maxY = H * 0.95;
    console.error('door-swing: diff+warm degenerate → geometric centred door rect');
  }
}
// explicit-rect override wins over any auto-located rect
if (rectArg) {
  const [fx0, fy0, fx1, fy1] = rectArg.split(',').map(Number);
  minX = W * fx0; minY = H * fy0; maxX = W * fx1; maxY = H * fy1;
  console.error(`door-swing: explicit --rect ${rectArg} → ${Math.round(maxX - minX)}x${Math.round(maxY - minY)}`);
}
// isolate the swinging LEAF: drop the thin static frame/trim ring around the opening
const bw = maxX - minX, bh = maxY - minY;
const ox = Math.round(minX + bw * 0.10), oW = Math.round(bw * 0.80);
const oy = Math.round(minY + bh * 0.06), oH = Math.round(bh * 0.92);

// leaf sprite = the closed-door content inside the opening rect
const leaf = createCanvas(oW, oH); leaf.getContext('2d').drawImage(dC, ox, oy, oW, oH, 0, 0, oW, oH);

const outDir = `${matDir}/anim/door`;
fs.mkdirSync(outDir, { recursive: true });
// clear any stale frames (e.g. a 10-frame v3 anim leaving a frame_009 orphan after we write 9) so the synth is authoritative
for (const f of fs.readdirSync(outDir)) if (/^frame_\d+\.png$/.test(f)) fs.rmSync(`${outDir}/${f}`);
for (let t = 0; t < N; t++) {
  const open = t / (N - 1);                 // 0 shut → 1 open
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(dC, 0, 0);                     // full static tile (wall/eave/footing/trim all preserved)
  // plain dark interior behind the leaf
  const g = x.createLinearGradient(0, oy, 0, oy + oH);
  g.addColorStop(0, '#070708'); g.addColorStop(0.6, '#0c0c0f'); g.addColorStop(1, '#040405');
  x.fillStyle = g; x.fillRect(ox, oy, oW, oH);
  // the leaf, foreshortened toward the hinge and darkening as it swings inward
  const lw = Math.max(1, Math.round(oW * (1 - open * 0.92)));
  const lx = hinge === 'left' ? ox : ox + oW - lw;
  if (open < 0.995) {
    x.globalAlpha = 1; x.drawImage(leaf, lx, oy, lw, oH);
    if (open > 0) { x.globalAlpha = 0.45 * open; x.fillStyle = '#000'; x.fillRect(lx, oy, lw, oH); x.globalAlpha = 1; }
    // thin shaded jamb edge on the opening side so the reveal reads as depth
    x.fillStyle = 'rgba(0,0,0,0.5)'; const jx = hinge === 'left' ? lx + lw : ox; x.fillRect(jx, oy, 1, oH);
  }
  fs.writeFileSync(`${outDir}/frame_${String(t).padStart(3, '0')}.png`, c.toBuffer('image/png'));
}
console.log(`door-swing ${N} frames -> ${outDir}  (opening rect ${oW}x${oH}@${ox},${oy}, hinge ${hinge})`);
