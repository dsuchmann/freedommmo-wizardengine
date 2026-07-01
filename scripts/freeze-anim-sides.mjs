// scripts/freeze-anim-sides.mjs <materialDir> <kind> [leftFrac=0.14] [rightFrac=0.14]
// Companion to freeze-anim-band.mjs (which freezes the TOP eave). v3 animate_object can also MELT the wall on the
// LEFT/RIGHT of a door/window (zigzag/triangle artifacts) even though only the central leaf should move. Those
// margins are static wall, so composite them straight from the static tile (`ground_<kind>__v0.png`) over each
// frame's left/right band. The central door column (leaf + opening) keeps its v3 motion. Run AFTER fit-anim-frames
// (frames must already be at the static dims). Idempotent.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , dir, kind, lA, rA] = process.argv;
if (!dir || !kind) { console.error('usage: freeze-anim-sides.mjs <materialDir> <door|window> [leftFrac] [rightFrac]'); process.exit(2); }
const lf = +(lA || 0.14), rf = +(rA || 0.14);
const staticP = `${dir}/ground_${kind}__v0.png`;
const animDir = `${dir}/anim/${kind}`;
if (!fs.existsSync(staticP) || !fs.existsSync(animDir)) { console.log(`skip ${dir} ${kind}`); process.exit(0); }
const st = await loadImage(staticP);
const W = st.width, H = st.height;
const lw = Math.round(W * lf), rw = Math.round(W * rf);
const frames = fs.readdirSync(animDir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
for (const fn of frames) {
  const fr = await loadImage(`${animDir}/${fn}`);
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(fr, 0, 0, fr.width, fr.height, 0, 0, W, H);     // frame body (already fit to static dims)
  if (lw > 0) x.drawImage(st, 0, 0, lw, H, 0, 0, lw, H);      // clean static LEFT margin
  if (rw > 0) x.drawImage(st, W - rw, 0, rw, H, W - rw, 0, rw, H); // clean static RIGHT margin
  fs.writeFileSync(`${animDir}/${fn}`, c.toBuffer('image/png'));
}
console.log(`freeze-sides ${dir.split(/[\\/]/).slice(-1)} ${kind}: L${lw}px R${rw}px → ${frames.length} frames`);
