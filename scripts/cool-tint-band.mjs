// scripts/cool-tint-band.mjs <in.png> <out.png> [topFrac=0.16] [amt=0.5]
// Cool-tint the TOP eave/wallplate band of a tile so the shared pale-moonstone trim stops reading as a warm
// cream bar clashing on a cool COLOURED wall (e.g. amethyst/violet). Subtle, value-preserving: within the top
// `topFrac`, opaque pixels are pulled toward a cool blue-lilac of the SAME luminance by `amt` (0..1). The footing
// stays as-is (already a cool blue-grey). Idempotent enough for a one-shot trim pass.
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , inp, outp, fracA, amtA] = process.argv;
const frac = +(fracA || 0.16), amt = +(amtA || 0.5);
const img = await loadImage(inp); const W = img.width, H = img.height;
const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
const d = x.getImageData(0, 0, W, H); const p = d.data;
const bandH = Math.round(H * frac);
for (let y = 0; y < bandH; y++) for (let xx = 0; xx < W; xx++) {
  const i = (y * W + xx) * 4; if (p[i + 3] < 24) continue;
  const r = p[i], g = p[i + 1], b = p[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // cool target at this luminance: a touch of blue-lilac (B up, R down), neutral G
  const tr = lum * 0.90, tg = lum * 0.97, tb = Math.min(255, lum * 1.10);
  // feather the blend out over the lower third of the band so there's no hard line where the tint stops
  const w = amt * Math.min(1, (bandH - y) / (bandH * 0.5) + 0.5);
  p[i] = Math.round(r * (1 - w) + tr * w);
  p[i + 1] = Math.round(g * (1 - w) + tg * w);
  p[i + 2] = Math.round(b * (1 - w) + tb * w);
}
x.putImageData(new ImageData(p, W, H), 0, 0);
fs.writeFileSync(outp, c.toBuffer('image/png'));
console.log(`cool-tint ${inp.split(/[\\/]/).pop()} top ${Math.round(frac * 100)}% (amt ${amt}) -> ${outp.split(/[\\/]/).pop()}`);
