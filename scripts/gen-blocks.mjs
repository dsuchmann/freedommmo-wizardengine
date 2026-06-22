// scripts/gen-blocks.mjs — post-process façade COMPONENT BLOCKS.
//
// PixelLab returns an OPAQUE near-white background (rgba ~253,252,251,255). We key it to
// transparent by a BORDER FLOOD-FILL through near-white pixels — so the white SURROUND goes
// transparent but interior near-white (plaster panels, window glaze) is preserved (it isn't
// border-connected). Then we emit a VERIFICATION composite of each keyed piece over DARK and over
// GRASS, so a surviving white box is impossible to miss (the bug that shipped last time was hidden
// by light-background captures).
//
// Usage: node scripts/gen-blocks.mjs [dir]   (default assets/pixelab/buildings/blocks/grassland/timber_frame)
//   env WHITE_MIN (default 236) = min channel value to count as background white.

import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, process.argv[2] || 'assets/pixelab/buildings/blocks/grassland/timber_frame');
const WHITE_MIN = +(process.env.WHITE_MIN || 236);
const SAT_MAX = +(process.env.SAT_MAX || 16);

const TOL = +(process.env.TOL || 42);

// border flood-fill: sample the BACKGROUND COLOR from the 4 corners (PixelLab uses an arbitrary
// uniform light bg — white OR lavender OR …), then alpha→0 for pixels within TOL of that colour
// reachable from the image edge. Interior plaster/glass (not border-connected) is preserved.
function keyBackground(p, W, H) {
  const corner = (X, Y) => { const i = (Y * W + X) * 4; return [p[i], p[i + 1], p[i + 2]]; };
  const cs = [corner(1, 1), corner(W - 2, 1), corner(1, H - 2), corner(W - 2, H - 2)];
  const bg = [0, 1, 2].map((k) => Math.round(cs.reduce((s, c) => s + c[k], 0) / 4));
  const T2 = TOL * TOL;
  const near = (i) => { const dr = p[i * 4] - bg[0], dg = p[i * 4 + 1] - bg[1], db = p[i * 4 + 2] - bg[2]; return dr * dr + dg * dg + db * db <= T2; };
  const N = W * H, seen = new Uint8Array(N), q = [];
  const push = (i) => { if (!seen[i]) { seen[i] = 1; if (p[i * 4 + 3] > 8 && near(i)) { p[i * 4 + 3] = 0; q.push(i); } } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (q.length) {
    const i = q.pop(), y = (i / W) | 0, x = i - y * W;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
}

function alphaBBox(p, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Crop the keyed art into roof-cap / wall-slice / foundation at the given fractions, then stack:
// roof on top · N wall-slices · ONE foundation at base — proving foundations don't repeat. Over grass.
async function assembleStack(name, roofB, foundT, stories, tag) {
  const f = path.join(DIR, `keyed__${name}.png`);
  if (!fs.existsSync(f)) return;
  const img = await loadImage(f); const W = img.width, H = img.height;
  const rB = Math.round(roofB * H), fT = Math.round(foundT * H);
  const roH = rB, slH = fT - rB, foH = H - fT;
  const pad = 16, cv = createCanvas(W + pad * 2, roH + slH * stories + foH + pad * 2);
  const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#5e7d3f'; x.fillRect(0, 0, cv.width, cv.height);
  let y = pad;
  x.drawImage(img, 0, 0, W, roH, pad, y, W, roH); y += roH;
  for (let s = 0; s < stories; s++) { x.drawImage(img, 0, rB, W, slH, pad, y, W, slH); y += slH; }
  x.drawImage(img, 0, fT, W, foH, pad, y, W, foH);
  fs.writeFileSync(path.join(DIR, `assemble__${tag}.png`), cv.toBuffer('image/png'));
  console.log(`assembled ${tag}: roof + ${stories}×slice + 1 foundation -> assemble__${tag}.png`);
}

function main() {
  const raws = fs.readdirSync(DIR).filter((f) => /^raw__.*\.png$/.test(f)).sort();
  if (!raws.length) { console.log('no raw__ files in ' + DIR); return; }
  return (async () => {
    for (const raw of raws) {
      const name = raw.replace(/^raw__/, '').replace(/\.png$/, '');
      const img = await loadImage(path.join(DIR, raw));
      const W = img.width, H = img.height;
      const c = createCanvas(W, H); const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const id = cx.getImageData(0, 0, W, H); const p = id.data;
      keyBackground(p, W, H);
      cx.putImageData(new ImageData(p, W, H), 0, 0);
      const bb = alphaBBox(p, W, H);
      // crop to content
      const cw = bb.w, ch = bb.h;
      const keyed = createCanvas(cw, ch); const kx = keyed.getContext('2d');
      kx.drawImage(c, bb.x0, bb.y0, cw, ch, 0, 0, cw, ch);
      fs.writeFileSync(path.join(DIR, `keyed__${name}.png`), keyed.toBuffer('image/png'));
      // corner alpha sample (should be 0)
      const ca = (X, Y) => p[(Y * W + X) * 4 + 3];
      // verify composite: [dark | piece]  [grass | piece]
      const pad = 12, vw = cw * 2 + pad * 3, vh = ch + pad * 2;
      const v = createCanvas(vw, vh); const vx = v.getContext('2d');
      vx.fillStyle = '#1a1a1a'; vx.fillRect(0, 0, vw / 2, vh);
      vx.fillStyle = '#5e7d3f'; vx.fillRect(vw / 2, 0, vw / 2, vh); // grass green
      vx.drawImage(keyed, pad, pad);
      vx.drawImage(keyed, vw / 2 + pad, pad);
      fs.writeFileSync(path.join(DIR, `verify__${name}.png`), v.toBuffer('image/png'));
      console.log(`✓ ${name}  ${W}x${H} -> keyed ${cw}x${ch}  corners α(tl,tr,bl,br)=${ca(2,2)},${ca(W-3,2)},${ca(2,H-3)},${ca(W-3,H-3)}`);
    }
    console.log('\nwrote keyed__ + verify__ (composited over dark + grass) to ' + DIR);
    await assembleStack('facade_entry__v0', 0.36, 0.89, 1, 'entry_v0_1story');
    await assembleStack('facade_entry__v0', 0.36, 0.89, 2, 'entry_v0_2story');
  })();
}

main();
