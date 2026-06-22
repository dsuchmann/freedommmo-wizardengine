// scripts/solidify.mjs <in.png> <out.png>
// DETERMINISTIC opacity guarantee. PixelLab renders wall mortar / plaster bays as TRANSPARENT at
// random (measured 2%–78% holes across identical prompts), so we stop relying on the prompt and fill
// it in code: every transparent pixel INSIDE the tile's opaque content box is filled by growing the
// surrounding wall texture inward (8-neighbour dilation, synchronous per-pass). The result is a SOLID
// opaque rectangle — which is exactly the right target shape for a wall tile, because seamless
// mirror-tiling needs full-bleed left/right/top/bottom edges. Idempotent: a solid tile stays identical.
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const ALPHA_MIN = 24;
const DX = [-1, 1, 0, 0, -1, -1, 1, 1], DY = [0, 0, -1, 1, -1, 1, -1, 1];

async function main() {
  const inp = process.argv[2], outp = process.argv[3];
  const img = await loadImage(inp); const W = img.width, H = img.height;
  const c = createCanvas(W, H); const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
  const p = cx.getImageData(0, 0, W, H).data;

  // content bbox (opaque pixels)
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > ALPHA_MIN) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { console.log('empty ' + inp); return; }

  const op = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) op[i] = p[i * 4 + 3] > ALPHA_MIN ? 1 : 0;

  let holes = 0, area = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { area++; if (!op[y * W + x]) holes++; }

  let changed = true, pass = 0;
  while (changed && pass < 600) {
    changed = false; pass++;
    const idx = [], col = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x; if (op[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < 8; k++) { const nx = x + DX[k], ny = y + DY[k]; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const ni = ny * W + nx; if (op[ni]) { r += p[ni * 4]; g += p[ni * 4 + 1]; b += p[ni * 4 + 2]; n++; } }
      if (n > 0) { idx.push(i); col.push((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)); }
    }
    if (idx.length) { changed = true; for (let j = 0; j < idx.length; j++) { const i = idx[j], rgb = col[j]; p[i * 4] = rgb >> 16; p[i * 4 + 1] = (rgb >> 8) & 255; p[i * 4 + 2] = rgb & 255; p[i * 4 + 3] = 255; op[i] = 1; } }
  }

  cx.putImageData(new ImageData(p, W, H), 0, 0);
  const ow = x1 - x0 + 1, oh = y1 - y0 + 1;
  const oc = createCanvas(ow, oh); oc.getContext('2d').drawImage(c, x0, y0, ow, oh, 0, 0, ow, oh);
  fs.writeFileSync(outp, oc.toBuffer('image/png'));
  console.log(`solidify ${inp.split(/[\\/]/).pop()} -> ${ow}x${oh}  ${(100 * holes / area).toFixed(0)}% holes -> 0%  (${pass} passes)`);
}
main();
