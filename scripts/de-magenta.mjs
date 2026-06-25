// scripts/de-magenta.mjs <in.png> <out.png>
// Zero the alpha of stray magenta/pink KEY pixels PixelLab occasionally bakes into an object (≈ RGB 246,4,252
// + its antialiased pink halo). Run BEFORE solidify so those spots get filled with neighbouring wall colour
// instead of being spread by the dilation into pink smears across the tile (seen on the moonstone v7 base).
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
const [, , inp, outp] = process.argv;
const img = await loadImage(inp); const W = img.width, H = img.height;
const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
const im = x.getImageData(0, 0, W, H); const p = im.data; let n = 0;
for (let k = 0; k < p.length; k += 4) {
  const r = p[k], g = p[k + 1], b = p[k + 2];
  if (r > 125 && g < 115 && (r - g) > 26 && (b - g) > 16) { p[k + 3] = 0; n++; } // magenta/pink, not natural stone
}
x.putImageData(new ImageData(p, W, H), 0, 0);
fs.writeFileSync(outp, c.toBuffer('image/png'));
console.log(`de-magenta ${inp.split(/[\\/]/).pop()}: zeroed ${n}`);
