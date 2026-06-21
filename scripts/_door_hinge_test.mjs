// Verify the decoupled door: a doorway-opening wall piece + a normalized door leaf swung on a
// hinge (procedural, no generated animation). Renders 4 open positions side by side per material.
// Output: scripts/_door_hinge_test.png
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'fs';

const t = 44, WH = t * 4;           // 4-tile wall height
const FACADE = 128;
const LEAF_HINGE_FRAC = 11 / 64;    // hinge x within the 64-wide leaf canvas (DX0)
const OPENS = [1.0, 0.62, 0.34, 0.12]; // closed → open
const TESTS = [
  { mat: 'timber_frame', leaf: 'plank' },
  { mat: 'wattle_daub',  leaf: 'ledged' },
  { mat: 'fieldstone',   leaf: 'arched' },
];

const cellW = FACADE / 128 * t * 4; // draw facade at 4 tiles wide
const pad = 10;
const W = 120 + OPENS.length * (cellW + pad) + pad;
const H = TESTS.length * (WH + 30) + pad;
const cv = createCanvas(W, H); const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
ctx.fillStyle = '#3a6b32'; ctx.fillRect(0, 0, W, H);

function drawDoorway(ctx, img, dx, dy) {
  // whole doorway facade at 4 tiles wide
  ctx.drawImage(img, 0, 0, 128, 128, dx, dy, 4 * t, WH);
}
function drawLeaf(ctx, leaf, dx, dy, open) {
  // the door piece occupies the centre 2 tiles of the 4-tile facade → dest [dx+t, dy, 2t, WH]
  const px = dx + t, pw = 2 * t;
  const hingeX = px + LEAF_HINGE_FRAC * pw;
  ctx.save();
  ctx.translate(hingeX, dy); ctx.scale(open, 1); ctx.translate(-hingeX, -dy);
  ctx.drawImage(leaf, 0, 0, 64, 128, px, dy, pw, WH);
  ctx.restore();
}

let y = pad;
for (const test of TESTS) {
  const dwy = `assets/pixelab/buildings/walls/grassland/${test.mat}/south_doorway__normal.png`;
  const lf = `assets/pixelab/buildings/doors/${test.leaf}__norm.png`;
  ctx.fillStyle = '#dfe'; ctx.font = '12px sans-serif';
  ctx.fillText(`${test.mat} + ${test.leaf}`, 6, y + WH / 2);
  if (existsSync(dwy) && existsSync(lf)) {
    const dimg = await loadImage(dwy), limg = await loadImage(lf);
    let x = 120;
    for (const open of OPENS) {
      drawDoorway(ctx, dimg, x, y);
      drawLeaf(ctx, limg, x, y, open);
      ctx.fillStyle = '#9fb'; ctx.font = '10px sans-serif';
      ctx.fillText(open === 1 ? 'closed' : (open === OPENS[OPENS.length - 1] ? 'open' : open.toFixed(2)), x + t, y + WH + 12);
      x += cellW + pad;
    }
  } else {
    ctx.fillStyle = '#f88'; ctx.fillText('MISSING ' + (existsSync(dwy) ? 'leaf' : 'doorway'), 120, y + 20);
  }
  y += WH + 30;
}
writeFileSync('scripts/_door_hinge_test.png', cv.toBuffer('image/png'));
console.log('wrote scripts/_door_hinge_test.png', cv.width + 'x' + cv.height);
