// scripts/qa-frames.mjs — validate generated ANIMATION frame sequences for glitches the eye would catch but
// the pipeline silently ships: a corrupt final frame (PixelLab's zigzag-triangle artifacts), a frozen/
// duplicate frame (the door that never finishes opening), or a high-frequency-noise spike.
//
// Signal: a door/window animation is a SMOOTH swing that SETTLES at the end. We score each frame by its
// per-pixel diff from the previous frame (MSE) and its edge energy (mean |Laplacian| over opaque pixels):
//   • FROZEN   — MSE < 1 (pixel-identical to the previous frame) mid-sequence → the anim is stuck.
//   • SETTLE   — the LAST frame's diff exceeds 1.4x the median swing diff → it should be settling, not
//                changing the most; this is the signature of a corrupt final frame.
//   • HF_SPIKE — a frame's edge energy exceeds 1.3x the mean of its neighbours → injected noise/triangles.
//
// Flags are a SCREEN, not a hard gate — it also writes tools/_qa_frames/<seq>.png montages of every flagged
// sequence so a human confirms. Usage: node scripts/qa-frames.mjs [rootDir]
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'assets/pixelab/buildings/tiles/grassland';
const OUT = 'tools/_qa_frames';
fs.mkdirSync(OUT, { recursive: true });

// Find every <...>/anim/<kind>/ directory holding frame_NNN.png sequences.
function findSeqDirs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    const files = fs.readdirSync(p).filter((f) => /^frame_\d+\.png$/.test(f));
    if (files.length >= 2) acc.push({ dir: p, files: files.sort() });
    else findSeqDirs(p, acc);
  }
  return acc;
}

function frameStats(img) {
  const W = img.width, H = img.height;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let hf = 0, n = 0;
  for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
    const i = (y * W + xx) * 4; if (d[i + 3] < 128) continue;
    hf += Math.abs(4 * lum(i) - lum(i - 4) - lum(i + 4) - lum(i - W * 4) - lum(i + W * 4)); n++;
  }
  return { W, H, data: d, hf: n ? hf / n : 0 };
}
function mse(a, b) { if (a.W !== b.W || a.H !== b.H) return Infinity; let s = 0; const A = a.data, B = b.data, n = A.length / 4;
  for (let k = 0; k < A.length; k += 4) { const r = A[k] - B[k], g = A[k + 1] - B[k + 1], bl = A[k + 2] - B[k + 2]; s += r * r + g * g + bl * bl; } return s / n; }
const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
// Opaque content bbox (alpha>24) — used by the FIT check to see whether a frame's content fills the image or is
// inset inside a transparent margin (the raw-256-canvas case that makes an animated aperture render smaller).
function bboxOf(img) {
  const W = img.width, H = img.height; const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let xp = 0; xp < W; xp++) if (d[(y * W + xp) * 4 + 3] > 24) { if (xp < x0) x0 = xp; if (xp > x1) x1 = xp; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function montage(name, imgs, flags) {
  const TS = 110, pad = 6;
  const c = createCanvas((TS + pad) * imgs.length + pad, TS + 28); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < imgs.length; i++) { const ox = pad + i * (TS + pad);
    if (flags[i]) { x.fillStyle = '#a00'; x.fillRect(ox - 2, 16, TS + 4, TS + 4); }
    if (imgs[i]) x.drawImage(imgs[i], 0, 0, imgs[i].width, imgs[i].height, ox, 18, TS, TS);
    x.fillStyle = flags[i] ? '#f66' : '#fff'; x.font = 'bold 11px sans-serif'; x.fillText('f' + i + (flags[i] ? ' ✗' : ''), ox, 12);
  }
  fs.writeFileSync(path.join(OUT, name + '.png'), c.toBuffer('image/png'));
}

const seqs = findSeqDirs(ROOT);
let problems = 0;
for (const seq of seqs) {
  const imgs = []; for (const f of seq.files) { try { imgs.push(await loadImage(path.join(seq.dir, f))); } catch { imgs.push(null); } }
  const stats = imgs.map((im) => (im ? frameStats(im) : null));
  const diffs = []; for (let i = 1; i < stats.length; i++) diffs.push(stats[i] && stats[i - 1] ? mse(stats[i], stats[i - 1]) : Infinity);
  const med = median(diffs.filter((v) => isFinite(v) && v > 0));
  const flags = new Array(imgs.length).fill(false); const reasons = [];
  // SIZE_DRIFT: v3 grows the canvas as the moving leaf extends the bbox, so frames end up different sizes; the
  // renderer stretches every frame to the same wH, so the (static) wall+foundation then drift/lift. This is
  // deterministic and AUTO-FIXABLE (no regen) — normalize every frame to the idle frame's size.
  const sz0 = imgs[0] && `${imgs[0].width}x${imgs[0].height}`;
  if (sz0 && imgs.some((im) => im && `${im.width}x${im.height}` !== sz0)) {
    imgs.forEach((im, i) => { if (im && `${im.width}x${im.height}` !== sz0) flags[i] = true; });
    reasons.push(`SIZE_DRIFT (frames not all ${sz0}) — AUTO-FIX: node scripts/normalize-anim-frames.mjs <dir>`);
  }
  // FIT: the anim frames must render at the SAME size AND fill the image edge-to-edge like the material's STATIC
  // tile (ground_<kind>__v0.png). The renderer (drawAperture) maps the WHOLE frame into a fixed door/window box,
  // so a raw 256² frame whose wall is inset inside a transparent margin draws SMALLER + lower than the solidify-
  // cropped static tile — the aperture visibly resizes when the animation triggers. Deterministic + AUTO-FIXABLE.
  {
    const kind = path.basename(seq.dir);                       // door | window
    const matDir = path.dirname(path.dirname(seq.dir));        // .../<biome>/<material>
    const staticP = path.join(matDir, `ground_${kind}__v0.png`);
    if (fs.existsSync(staticP) && imgs[0]) {
      const st = await loadImage(staticP);
      const bb0 = bboxOf(imgs[0]);
      const dimBad = imgs.some((im) => im && (im.width !== st.width || im.height !== st.height));
      const insetBad = bb0.w < imgs[0].width - 2 || bb0.h < imgs[0].height - 2; // content doesn't fill (transparent margin)
      if (dimBad || insetBad) {
        imgs.forEach((im, i) => { if (im) flags[i] = true; });
        const fix = `node scripts/fit-anim-frames.mjs ${path.relative(process.cwd(), matDir).replace(/\\/g, '/')} ${kind}`;
        reasons.push(`FIT-FAIL: frames ${imgs[0].width}x${imgs[0].height}${insetBad ? ` (content only ${bb0.w}x${bb0.h}@${bb0.x0},${bb0.y0})` : ''} ≠ static ${st.width}x${st.height} edge-to-edge — aperture will RESIZE on trigger. AUTO-FIX: ${fix}`);
      }
    }
  }
  // FROZEN only applies to NON-final frames (a door that stalls mid-open). A FINAL frame identical to its
  // predecessor is a correctly SETTLED end pose (see settle-final-frame.mjs), not a bug — so exempt it.
  for (let i = 1; i < imgs.length - 1; i++) {
    if (diffs[i - 1] < 1) { flags[i] = true; reasons.push(`f${i}: FROZEN (identical to f${i - 1})`); }
  }
  const last = diffs.length - 1;
  if (isFinite(diffs[last]) && diffs[last] > 1.4 * med && diffs[last] > 200) { flags[imgs.length - 1] = true; reasons.push(`f${imgs.length - 1}: SETTLE-FAIL (final diff ${diffs[last] | 0} > 1.4×median ${med | 0}) — corrupt final frame?`); }
  for (let i = 1; i < stats.length - 1; i++) {
    if (!stats[i] || !stats[i - 1] || !stats[i + 1]) continue;
    const nbr = (stats[i - 1].hf + stats[i + 1].hf) / 2;
    if (stats[i].hf > 1.3 * nbr) { flags[i] = true; reasons.push(`f${i}: HF_SPIKE (edge energy ${stats[i].hf.toFixed(1)} > 1.3×neighbours ${nbr.toFixed(1)})`); }
  }
  const rel = path.relative(ROOT, seq.dir).replace(/[\\/]/g, '·');
  if (reasons.length) { problems++; console.log(`✗ ${rel}`); for (const r of reasons) console.log(`    ${r}`); await montage(rel, imgs, flags); }
  else console.log(`✓ ${rel}`);
}
console.log(`\n${problems} sequence(s) flagged of ${seqs.length}. Montages of flagged sequences in ${OUT}/`);
