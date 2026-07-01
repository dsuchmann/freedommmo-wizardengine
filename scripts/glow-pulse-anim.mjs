// scripts/glow-pulse-anim.mjs <window_tile.png> <out_dir> [amp=0.55] [frames=9] [cx=0.5] [cy=0.40] [rad=0.20] [rgb=170,220,255]
// Deterministic, distortion-free "magic glow" window animation. A leaded/glass mystic window has NO moving
// parts, so v3 animate_object invents motion by breathing/scaling the whole wall (qa-frames flags HF_SPIKE /
// SETTLE-FAIL). Instead we keep the geometry PERFECTLY static and only pulse a soft glow over the window:
// composite an additive radial glow (masked to the building silhouette so it never leaks onto the transparent
// surround), easing 0 → peak → 0 across the frames. No wall distortion → passes qa-frames. Reusable for every
// glow-window material. The glow colour defaults to cool moonlight-blue (mystic); pass an `r,g,b` triple as the
// last arg for a warm ember glow (volcanic) or any other tint. Frames written frame_000..frame_00(N-1), full-tile.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , inp, outDir, ampA, framesA, cxA, cyA, radA, rgbA] = process.argv;
const amp = +(ampA || 0.55), N = +(framesA || 9);
const cxf = +(cxA || 0.5), cyf = +(cyA || 0.40), radf = +(radA || 0.20);
const [gr, gg, gb] = (rgbA && /^\d+,\d+,\d+$/.test(rgbA)) ? rgbA.split(',').map(Number) : [170, 220, 255];

const img = await loadImage(inp);
const W = img.width, H = img.height;
const baseC = createCanvas(W, H); baseC.getContext('2d').drawImage(img, 0, 0);

const cxp = W * cxf, cyp = H * cyf, rad = W * radf;
fs.mkdirSync(outDir, { recursive: true });
for (let t = 0; t < N; t++) {
  const a = amp * Math.sin(Math.PI * t / (N - 1)); // 0 → amp (mid) → 0
  const c = createCanvas(W, H); const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(baseC, 0, 0);
  if (a > 0.002) {
    // build the glow on a tmp canvas, then clip it to the building silhouette (base alpha) before compositing
    const tmp = createCanvas(W, H); const tx = tmp.getContext('2d');
    const g = tx.createRadialGradient(cxp, cyp, 0, cxp, cyp, rad);
    g.addColorStop(0, `rgba(${gr},${gg},${gb},1)`);
    g.addColorStop(0.45, `rgba(${Math.round(gr * 0.78)},${Math.round(gg * 0.84)},${Math.round(gb * 0.92)},0.55)`);
    g.addColorStop(1, `rgba(${Math.round(gr * 0.72)},${Math.round(gg * 0.82)},${Math.round(gb * 0.92)},0)`);
    tx.fillStyle = g; tx.fillRect(0, 0, W, H);
    tx.globalCompositeOperation = 'destination-in'; tx.drawImage(baseC, 0, 0); // keep glow only where wall is opaque
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = a; x.drawImage(tmp, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  }
  fs.writeFileSync(`${outDir}/frame_${String(t).padStart(3, '0')}.png`, c.toBuffer('image/png'));
}
console.log(`glow-pulse ${N} frames -> ${outDir} (amp ${amp}, centre ${cxf},${cyf} r${radf})`);
