// Base-sprite review: for each grassland wall material, show the raw 128² base, the same base
// tiled 3× HORIZONTALLY (exposes seams at the 128 repeat boundary) and stacked 2× VERTICALLY
// (exposes the cap/foundation stacking seam between stories). Tells us whether the tiling/
// stacking problem is in the SPRITES (regen) or the RENDERER (placement).
// Run: node scripts/_base_sprite_review.mjs
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'fs';

const BASE = 'assets/pixelab/buildings/walls/grassland';
const MATS = ['wattle_daub', 'timber_frame', 'fieldstone', 'cob'];
const S = 96;                 // display size of one 128 piece (scaled)
const pad = 16, lab = 150;

const rowH = S * 2 + pad * 2;  // tall enough for the 2× vertical stack
const cv = createCanvas(lab + (S * 3 + pad) + (S + pad) + pad * 3, MATS.length * rowH + pad);
const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, cv.width, cv.height);

let y = pad;
for (const m of MATS) {
  const p = `${BASE}/${m}/south_base__normal.png`;
  ctx.fillStyle = '#cfe'; ctx.font = '14px sans-serif';
  ctx.fillText(m, 8, y + 20);
  if (existsSync(p)) {
    const img = await loadImage(p);
    // raw
    ctx.fillStyle = '#7aa'; ctx.font = '10px sans-serif';
    // H-tiled 3× (full facade repeated — the renderer's 4-tile unit boundary)
    const hx = lab;
    for (let i = 0; i < 3; i++) ctx.drawImage(img, 0, 0, 128, 128, hx + i * S, y, S, S);
    ctx.strokeStyle = '#e44'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(hx + i * S, y); ctx.lineTo(hx + i * S, y + S); ctx.stroke(); } // mark seams
    ctx.fillStyle = '#7aa'; ctx.fillText('H-tile 3× (red = 128 seam)', hx, y + S + 12);
    // V-stack 2×
    const vx = hx + 3 * S + pad;
    ctx.drawImage(img, 0, 0, 128, 128, vx, y, S, S);
    ctx.drawImage(img, 0, 0, 128, 128, vx, y - S, S, S); // upper story
    ctx.strokeStyle = '#4e4'; ctx.beginPath(); ctx.moveTo(vx, y); ctx.lineTo(vx + S, y); ctx.stroke(); // story seam
    ctx.fillStyle = '#7aa'; ctx.fillText('V-stack 2× (green=floor seam)', vx, y + S + 12);
  } else {
    ctx.fillStyle = '#e66'; ctx.fillText('MISSING', lab, y + 20);
  }
  y += rowH;
}
writeFileSync('scripts/_base_sprite_review.png', cv.toBuffer('image/png'));
console.log('wrote scripts/_base_sprite_review.png', cv.width + 'x' + cv.height);
