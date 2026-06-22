// scripts/flip-tile.mjs <in.png> <strip_out.png>
// MIRROR TILING test: lay the tile then its horizontal flip, alternating, so every seam is the same
// edge meeting itself → seamless with no art change. Red lines mark the joins; over grass.
import { loadImage, createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';
const ALPHA_MIN = 24;
const op = (p, i) => p[i * 4 + 3] > ALPHA_MIN;
function bbox(p, W, H) { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (op(p, y * W + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }

async function main() {
  const img = await loadImage(process.argv[2]); const W0 = img.width, H0 = img.height;
  const c0 = createCanvas(W0, H0); c0.getContext('2d').drawImage(img, 0, 0);
  const bb = bbox(c0.getContext('2d').getImageData(0, 0, W0, H0).data, W0, H0);
  const W = bb.w, H = bb.h;
  const t = createCanvas(W, H); t.getContext('2d').drawImage(c0, bb.x0, bb.y0, W, H, 0, 0, W, H);
  const N = +(process.env.N || 5), pad = 12;
  const strip = createCanvas(W * N + pad * 2, H + pad * 2); const x = strip.getContext('2d');
  x.imageSmoothingEnabled = false; x.fillStyle = '#5e7d3f'; x.fillRect(0, 0, strip.width, strip.height);
  for (let i = 0; i < N; i++) {
    x.save(); x.translate(pad + i * W, pad);
    if (i % 2 === 1) { x.translate(W, 0); x.scale(-1, 1); }   // flip odd columns
    x.drawImage(t, 0, 0); x.restore();
  }
  x.fillStyle = '#ff000044'; for (let i = 1; i < N; i++) x.fillRect(pad + i * W - 1, pad, 2, H);
  fs.writeFileSync(process.argv[3], strip.toBuffer('image/png'));
  console.log(`${process.argv[2].split(/[\\/]/).pop()}: ${W}x${H} -> ${N}x mirror-tiled ${process.argv[3]}`);
}
main();
