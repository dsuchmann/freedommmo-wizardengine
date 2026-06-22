// scripts/seamless-tile.mjs <in.png> <strip_out.png> [seamless_out.png]
// Make a wall tile tile HORIZONTALLY seamless (left col == right col) via edge-wrap cross-fade, then
// emit a 3-wide tiled strip over grass so the seam is obvious. The cross-fade blends a margin band at
// each side toward the pixel wrapped from the opposite side (cosine weight 0.5 at the edge → 0 at band).
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
const FEATHER = +(process.env.FEATHER || 0.12);
const ALPHA_MIN = 24;
const op = (p, i) => p[i * 4 + 3] > ALPHA_MIN;
function bbox(p, W, H) { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (op(p, y * W + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }

async function main() {
  const img = await loadImage(process.argv[2]); const W0 = img.width, H0 = img.height;
  const c0 = createCanvas(W0, H0); c0.getContext('2d').drawImage(img, 0, 0);
  const bb = bbox(c0.getContext('2d').getImageData(0, 0, W0, H0).data, W0, H0);
  const W = bb.w, H = bb.h;
  const c = createCanvas(W, H); const cx = c.getContext('2d'); cx.drawImage(c0, bb.x0, bb.y0, W, H, 0, 0, W, H);
  const id = cx.getImageData(0, 0, W, H); const p = id.data; const src = p.slice();
  const band = Math.max(3, Math.round(W * FEATHER));
  const at = (buf, x, y, k) => buf[(((y % H) + H) % H) * W * 4 + (((x % W) + W) % W) * 4 + k];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, W - 1 - x); if (d >= band) continue;
    const w = 0.5 * (1 + Math.cos(Math.PI * d / band)) * 0.5;        // 0.5 at edge → 0 at band
    const near0 = x < W / 2; const px = near0 ? x + W : x - W;
    for (let k = 0; k < 4; k++) { const a = src[(y * W + x) * 4 + k]; const b = at(src, px, y, k); p[(y * W + x) * 4 + k] = a * (1 - w) + b * w; }
  }
  cx.putImageData(new ImageData(p, W, H), 0, 0);
  if (process.argv[4]) fs.writeFileSync(process.argv[4], c.toBuffer('image/png'));
  // 3-wide tiled strip over grass
  const pad = 12, sw = W * 3, sh = H;
  const strip = createCanvas(sw + pad * 2, sh + pad * 2); const sx = strip.getContext('2d');
  sx.imageSmoothingEnabled = false; sx.fillStyle = '#5e7d3f'; sx.fillRect(0, 0, strip.width, strip.height);
  for (let i = 0; i < 3; i++) sx.drawImage(c, pad + i * W, pad);
  // red seam markers at the joins
  sx.fillStyle = '#ff000055'; sx.fillRect(pad + W - 1, pad, 2, sh); sx.fillRect(pad + 2 * W - 1, pad, 2, sh);
  fs.writeFileSync(process.argv[3], strip.toBuffer('image/png'));
  console.log(`${process.argv[2].split(/[\\/]/).pop()}: ${W}x${H} band=${band} -> 3x strip ${process.argv[3]}`);
}
main();
