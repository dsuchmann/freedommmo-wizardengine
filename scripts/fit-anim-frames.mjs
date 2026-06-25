// scripts/fit-anim-frames.mjs <materialDir> <kind>   (kind = door | window)
// Make an aperture's animation frames render at EXACTLY the same size/placement as its static tile, so the
// door/window does NOT visibly resize or shift when the animation triggers.
//
// Root cause: the static tile (`ground_<kind>__v0.png`) is solidify-cropped so its content fills the image
// edge-to-edge, but `animate_object` frames are the raw 256x256 canvas with the wall content INSET (transparent
// margin + a downward offset). The renderer (`drawAperture` in building-tiles.js) maps the WHOLE image into a
// fixed door box, so the inset frames render smaller + lower than the closed static tile.
//
// Fix (deterministic, idempotent): crop EVERY frame to frame_000's opaque bbox (one fixed rect → the static wall
// stays put while the leaf swings within), fill any transparent holes (so the swinging door is never see-through),
// then resize to the static tile's exact dims. After this, frame N == static framing → seamless trigger.
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const [, , dir, kind] = process.argv;
if (!dir || !kind) { console.error('usage: fit-anim-frames.mjs <materialDir> <door|window>'); process.exit(2); }
const ALPHA_MIN = 24;
const DX = [-1, 1, 0, 0, -1, -1, 1, 1], DY = [0, 0, -1, 1, -1, 1, -1, 1];

const staticPath = `${dir}/ground_${kind}__v0.png`;
const animDir = `${dir}/anim/${kind}`;
if (!fs.existsSync(staticPath) || !fs.existsSync(animDir)) { console.log(`skip ${dir} ${kind} (no static or anim)`); process.exit(0); }
const sImg = await loadImage(staticPath);
const Ws = sImg.width, Hs = sImg.height;
const frames = fs.readdirSync(animDir).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
if (!frames.length) { console.log(`skip ${dir} ${kind} (no frames)`); process.exit(0); }

const opaqueBBox = (img) => {
  const W = img.width, H = img.height;
  const c = createCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let xp = 0; xp < W; xp++) if (d[(y * W + xp) * 4 + 3] > ALPHA_MIN) { if (xp < x0) x0 = xp; if (xp > x1) x1 = xp; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

const f0 = await loadImage(`${animDir}/${frames[0]}`);
const bb = opaqueBBox(f0);                 // ONE fixed crop rect (the static wall box) for every frame
const cw = bb.w, ch = bb.h;

for (const fn of frames) {
  const img = await loadImage(`${animDir}/${fn}`);
  // 1) crop to the fixed frame_000 bbox
  const cc = createCanvas(cw, ch); const cx = cc.getContext('2d'); cx.imageSmoothingEnabled = false;
  cx.drawImage(img, bb.x0, bb.y0, cw, ch, 0, 0, cw, ch);
  // 2) fill transparent holes by 8-neighbour dilation (so the animated aperture is fully opaque like the static)
  const p = cx.getImageData(0, 0, cw, ch).data;
  const op = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) op[i] = p[i * 4 + 3] > ALPHA_MIN ? 1 : 0;
  let changed = true, pass = 0;
  while (changed && pass < 400) {
    changed = false; pass++; const idx = [], col = [];
    for (let y = 0; y < ch; y++) for (let xp = 0; xp < cw; xp++) {
      const i = y * cw + xp; if (op[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < 8; k++) { const nx = xp + DX[k], ny = y + DY[k]; if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue; const ni = ny * cw + nx; if (op[ni]) { r += p[ni * 4]; g += p[ni * 4 + 1]; b += p[ni * 4 + 2]; n++; } }
      if (n > 0) { idx.push(i); col.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]); }
    }
    if (idx.length) { changed = true; for (let j = 0; j < idx.length; j++) { const i = idx[j]; p[i * 4] = col[j][0]; p[i * 4 + 1] = col[j][1]; p[i * 4 + 2] = col[j][2]; p[i * 4 + 3] = 255; op[i] = 1; } }
  }
  cx.putImageData(new ImageData(p, cw, ch), 0, 0);
  // 3) resize to the static tile's exact dims so renderer framing matches 1:1
  let out = cc;
  if (cw !== Ws || ch !== Hs) { const rc = createCanvas(Ws, Hs); const rx = rc.getContext('2d'); rx.imageSmoothingEnabled = false; rx.drawImage(cc, 0, 0, cw, ch, 0, 0, Ws, Hs); out = rc; }
  fs.writeFileSync(`${animDir}/${fn}`, out.toBuffer('image/png'));
}
console.log(`fit ${dir.split(/[\\/]/).slice(-1)} ${kind}: ${frames.length} frames  ${f0.width}x${f0.height} → crop ${cw}x${ch} → ${Ws}x${Hs} (static)`);
