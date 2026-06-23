// scripts/flip-h.mjs — horizontal mirror of a PNG. Deterministic corner derivation: we generate ONLY
// the good side of a finished wall-end corner and FLIP it to produce the opposite side, so left/right
// corners are always perfectly symmetric (PixelLab is unreliable per-side). Usage:
//   node scripts/flip-h.mjs <in.png> <out.png>
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const [, , inp, outp] = process.argv;
if (!inp || !outp) { console.error('usage: flip-h.mjs <in.png> <out.png>'); process.exit(1); }
const img = await loadImage(inp);
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
ctx.translate(img.width, 0); ctx.scale(-1, 1);
ctx.drawImage(img, 0, 0);
fs.writeFileSync(outp, cv.toBuffer('image/png'));
console.log(`flip-h ${inp} -> ${outp} (${img.width}x${img.height})`);
