// scripts/normalize-anim-frames.mjs <animDir>
// v3 animate_object grows the canvas as a door/window opens (the moving leaf extends the bbox), so frames
// end up DIFFERENT heights. The renderer stretches every frame to the same wH, so a taller frame compresses
// the (supposedly static) wall+foundation more → the foundation drifts/lifts and detaches from the wall.
// Fix: resize EVERY frame to frame_000's dimensions (the idle frame == the static tile), so the wall content
// maps to the same screen rows in all frames. Idempotent (skips frames already matching).
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: normalize-anim-frames.mjs <animDir>'); process.exit(2); }
const files = fs.readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
if (files.length < 2) { console.log('no frame sequence in', dir); process.exit(0); }
const f0 = await loadImage(path.join(dir, files[0]));
const W = f0.width, H = f0.height;
let fixed = 0;
for (const f of files) {
  const img = await loadImage(path.join(dir, f));
  if (img.width === W && img.height === H) continue;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, img.width, img.height, 0, 0, W, H); // stretch the full frame onto the idle size
  fs.writeFileSync(path.join(dir, f), c.toBuffer('image/png'));
  fixed++;
}
console.log(`normalized ${files.length} frames to ${W}x${H} (${fixed} resized) in ${dir}`);
