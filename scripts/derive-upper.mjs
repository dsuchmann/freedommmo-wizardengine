// scripts/derive-upper.mjs <ground_base.png> <out_upper.png> [foundFrac=0.16]
// Derive a stackable UPPER-storey tile from a solid ground tile by cropping off the bottom foundation
// course (the bottom foundFrac of the image). Deterministic — used when PixelLab's generated upper_plain
// state comes back unusable. The cap/wall-plate at the top and the wall face are kept intact.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const [, , inp, outp, ff] = process.argv;
const foundFrac = +(ff || 0.16);
const img = await loadImage(inp); const W = img.width, H = img.height;
const keepH = Math.round(H * (1 - foundFrac));
const oc = createCanvas(W, keepH); const c = oc.getContext('2d'); c.imageSmoothingEnabled = false;
c.drawImage(img, 0, 0, W, keepH, 0, 0, W, keepH);
fs.writeFileSync(outp, oc.toBuffer('image/png'));
console.log(`derive-upper ${inp.split(/[\\/]/).pop()} -> ${W}x${keepH} (cropped bottom ${Math.round(foundFrac * 100)}%)`);
