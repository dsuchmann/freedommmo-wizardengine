// scripts/extract-aperture.mjs <state.png> <out.png> [xy0 xy1 yy0 yy1]
// Extract ONLY the aperture (door/window: dark opening + wood-brown frame/shutters) from a state tile
// onto a transparent canvas, so it can overlay any base wall. Region fractions default to the centre.
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
const ALPHA_MIN = 24;
const A = process.argv;
async function main() {
  const img = await loadImage(A[2]); const W = img.width, H = img.height;
  const c = createCanvas(W, H); c.getContext('2d').drawImage(img, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(W * H * 4);
  const fx0 = +(A[4] ?? 0.28), fx1 = +(A[5] ?? 0.72), fy0 = +(A[6] ?? 0.18), fy1 = +(A[7] ?? 0.92);
  const x0 = Math.floor(W * fx0), x1 = Math.ceil(W * fx1), y0 = Math.floor(H * fy0), y1 = Math.ceil(H * fy1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4; if (d[i + 3] <= ALPHA_MIN) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b);
    // wood (door/shutter/frame): r noticeably > g; true opening/threshold: near-black; glass: bluish.
    // grey fieldstone wall (r≈g≈b, brightness ~75-99) is EXCLUDED by all three so only the aperture is kept.
    const dark = mx < 55, brown = r > 55 && r < 185 && r > g + 12 && g + 5 >= b, glass = b > r + 10 && b > 50 && mx < 160;
    if (dark || brown || glass) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = d[i + 3]; }
  }
  // keep the LARGEST 8-connected component (drops the floating lintel/masonry fragments that the
  // colour mask catches near the aperture) so only the connected door/window assembly survives.
  {
    const N = W * H, lab = new Int32Array(N), st = []; let next = 0, big = 0, bigArea = 0; const area = [];
    const opx = (i) => out[i * 4 + 3] > ALPHA_MIN;
    for (let s = 0; s < N; s++) {
      if (lab[s] || !opx(s)) continue; const id = ++next; let a = 0; st.length = 0; st.push(s); lab[s] = id;
      while (st.length) { const c = st.pop(), cy = (c / W) | 0, cx = c - cy * W; a++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const ni = ny * W + nx; if (!lab[ni] && opx(ni)) { lab[ni] = id; st.push(ni); } } }
      area[id] = a; if (a > bigArea) { bigArea = a; big = id; }
    }
    for (let i = 0; i < N; i++) if (lab[i] !== big) out[i * 4 + 3] = 0;
  }
  // trim to content
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (out[(y * W + x) * 4 + 3] > ALPHA_MIN) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) { console.log('empty aperture ' + A[2]); return; }
  const oc = createCanvas(W, H); oc.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;
  const fin = createCanvas(cw, ch); fin.getContext('2d').drawImage(oc, bx0, by0, cw, ch, 0, 0, cw, ch);
  fs.writeFileSync(A[3], fin.toBuffer('image/png'));
  console.log(`aperture ${A[2].split(/[\\/]/).pop()} -> ${cw}x${ch} ${A[3]}`);
}
main();
