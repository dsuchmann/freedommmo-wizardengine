// scripts/normalize-blocks.mjs <in.png> <out.png>
// DETERMINISTIC cleanup/normalization of a raw PixelLab building object → a consistent block.
// PixelLab adds grass, smoke, gigantic foundations, stray debris; this removes them in code so the
// output is consistent regardless of what the model did.
//   1. green-key the base band            (attached grass tufts → transparent)
//   2. keep the LARGEST connected component (detached grass / smoke wisps / rocks / 2nd building → gone)
//   3. foundation crop                     (find the door base = ground line; cut below door_base+1course)
//   4. alpha-trim to content
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const ALPHA_MIN = 24;
const FOUND_TILES = +(process.env.FOUND_TILES || 0.7);  // foundation course height kept below the door base, in tiles

const isGrass = (r, g, b) => g > 44 && g > r * 1.10 && g > b * 1.12 && (g - Math.max(r, b)) > 14;
const op = (p, i) => p[i * 4 + 3] > ALPHA_MIN;

function bbox(p, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (op(p, y * W + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// label opaque pixels (8-conn); return {label:Int32Array, comps:[{area,minX,maxX,minY,maxY}]}
function components(p, W, H, mask) {
  const N = W * H, label = new Int32Array(N), comps = [{}]; const st = [];
  const ok = mask ? (i) => mask[i] : (i) => op(p, i);
  let next = 0;
  for (let s = 0; s < N; s++) {
    if (label[s] || !ok(s)) continue;
    const id = ++next; let area = 0, minX = W, maxX = 0, minY = H, maxY = 0;
    st.length = 0; st.push(s); label[s] = id;
    while (st.length) {
      const c = st.pop(), cy = (c / W) | 0, cx = c - cy * W; area++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const ni = ny * W + nx;
        if (!label[ni] && ok(ni)) { label[ni] = id; st.push(ni); }
      }
    }
    comps[id] = { area, minX, maxX, minY, maxY };
  }
  return { label, comps, next };
}

async function main() {
  const inp = process.argv[2], outp = process.argv[3];
  const img = await loadImage(inp); const W = img.width, H = img.height;
  const c = createCanvas(W, H); const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, W, H); const p = id.data;
  const tilePx = W / 8; // 256px = 8 tiles

  // 1. green-key the base band (bottom 45%)
  let bb = bbox(p, W, H); if (!bb) { console.log('empty ' + inp); return; }
  const bandTop = bb.y0 + Math.round(bb.h * 0.55);
  for (let y = bandTop; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++) { const i = y * W + x; if (op(p, i) && isGrass(p[i * 4], p[i * 4 + 1], p[i * 4 + 2])) p[i * 4 + 3] = 0; }

  // 1b. smoke key — light grey, low-saturation wisps in the TOP band (chimney smoke; roofs are coloured)
  const smokeBot = bb.y0 + Math.round(bb.h * 0.18);
  for (let y = bb.y0; y <= smokeBot; y++) for (let x = bb.x0; x <= bb.x1; x++) {
    const i = y * W + x; if (!op(p, i)) continue;
    const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 175 && (mx - mn) < 30) p[i * 4 + 3] = 0;
  }

  // 2. keep largest connected component
  { const { label, comps, next } = components(p, W, H); let big = 1; for (let k = 2; k <= next; k++) if (comps[k].area > comps[big].area) big = k; for (let i = 0; i < W * H; i++) if (label[i] && label[i] !== big) p[i * 4 + 3] = 0; }

  // 3. foundation crop — door base = largest BROWN component in the center-lower region
  bb = bbox(p, W, H); if (!bb) { console.log('empty after clean ' + inp); return; }
  const brown = new Uint8Array(W * H);
  for (let y = Math.round(bb.y0 + bb.h * 0.35); y <= bb.y1; y++) for (let x = Math.round(bb.x0 + bb.w * 0.30); x <= Math.round(bb.x0 + bb.w * 0.70); x++) {
    const i = y * W + x; if (!op(p, i)) continue; const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
    if (r > 45 && r < 160 && r > g + 8 && g + 6 >= b) brown[i] = 1;
  }
  const bc = components(p, W, H, brown); let door = 0; for (let k = 1; k <= bc.next; k++) if (bc.comps[k].area && (!door || bc.comps[k].area > bc.comps[door].area)) door = k;
  if (door && bc.comps[door].area > tilePx) {
    const doorBaseY = bc.comps[door].maxY;
    const cut = Math.min(H, doorBaseY + Math.round(tilePx * FOUND_TILES));
    for (let y = cut; y < H; y++) for (let x = 0; x < W; x++) p[(y * W + x) * 4 + 3] = 0;
  }

  // 4. trim to content
  cx.putImageData(new ImageData(p, W, H), 0, 0);
  bb = bbox(p, W, H); if (!bb) { console.log('empty final ' + inp); return; }
  const oc = createCanvas(bb.w, bb.h); const ox = oc.getContext('2d'); ox.drawImage(c, bb.x0, bb.y0, bb.w, bb.h, 0, 0, bb.w, bb.h);
  fs.writeFileSync(outp, oc.toBuffer('image/png'));
  console.log(`norm ${inp.split(/[\\/]/).pop()} -> ${bb.w}x${bb.h}  door=${door ? 'y' : 'n'}`);
}
main();
