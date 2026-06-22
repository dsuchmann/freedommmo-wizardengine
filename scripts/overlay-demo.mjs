// scripts/overlay-demo.mjs <base.png> <aperture_state.png> <out.png>
// Demonstrate the fix for color drift: the WALL is always the base; the aperture (window/door) is
// masked out of the state and composited onto the base, so the wall tone never varies.
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
const ALPHA_MIN = 24;
async function main() {
  const base = await loadImage(process.argv[2]); const W = base.width, H = base.height;
  const ap = await loadImage(process.argv[3]);
  const bc = createCanvas(W, H); const bx = bc.getContext('2d'); bx.drawImage(base, 0, 0);
  const ac = createCanvas(W, H); ac.getContext('2d').drawImage(ap, 0, 0, ap.width, ap.height, 0, 0, W, H);
  const bd = bx.getImageData(0, 0, W, H); const p = bd.data;
  const ad = ac.getContext('2d').getImageData(0, 0, W, H).data;
  // mask the aperture in the centre region: dark opening OR wood-brown frame/shutter (NOT light stone)
  const x0 = W * 0.20, x1 = W * 0.80, y0 = H * 0.10, y1 = H * 0.78;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4; if (ad[i + 3] <= ALPHA_MIN) continue;
    const r = ad[i], g = ad[i + 1], b = ad[i + 2], mx = Math.max(r, g, b);
    const dark = mx < 115, brown = r > 55 && r < 165 && r > g + 12 && g + 4 >= b;
    if (dark || brown) { p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = ad[i + 3]; }
  }
  bx.putImageData(new ImageData(p, W, H), 0, 0);
  // montage: base | aperture state | composited result, over grass
  const pad = 12, cell = W;
  const m = createCanvas(cell * 3 + pad * 4, cell + pad * 2); const mx2 = m.getContext('2d');
  mx2.imageSmoothingEnabled = false; mx2.fillStyle = '#5e7d3f'; mx2.fillRect(0, 0, m.width, m.height);
  mx2.drawImage(base, pad, pad); mx2.drawImage(ap, pad * 2 + cell, pad, cell, cell); mx2.drawImage(bc, pad * 3 + cell * 2, pad);
  fs.writeFileSync(process.argv[4], m.toBuffer('image/png'));
  console.log('overlay demo -> ' + process.argv[4]);
}
main();
