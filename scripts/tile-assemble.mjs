// scripts/tile-assemble.mjs <base.png> <out.png>
// PROOF of the tile-level model: cut identity-tagged TILES from ONE clean base building, then
// re-assemble a wider/taller building from those tiles. Because every tile is cut from the SAME
// image, adjacent tiles share the exact pattern → perfect horizontal + vertical tiling.
//
// Tiles cut (32px columns, full wall-band tall):
//   left-edge · plain · window · door · right-edge   (south face)
// Assembly: [left-edge][plain][window][plain][door][plain][window][plain][right-edge], over grass.
// (Roof = procedural in-game; here we keep each tile's own wall band + a shared cap row for the demo.)
import { loadImage, createCanvas, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const ALPHA_MIN = 24;
const op = (p, i) => p[i * 4 + 3] > ALPHA_MIN;
function bbox(p, W, H) { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (op(p, y * W + x)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }

async function main() {
  const base = await loadImage(process.argv[2]);
  const W = base.width, H = base.height;
  const bc = createCanvas(W, H); const bx = bc.getContext('2d'); bx.drawImage(base, 0, 0);
  const bb = bbox(bx.getImageData(0, 0, W, H).data, W, H);

  // The base is a single-storey front: roof (top) + wall band + foundation. We treat the WALL BAND
  // (from just under the eave to the base) as the tile source. Eave ≈ where the gable meets the
  // full-width wall; approximate as the top of the widest run. Simpler: take the lower ~62% of the
  // content as the wall band (skips the gable roof).
  const wallTop = Math.round(bb.y0 + bb.h * 0.42);
  const wallH = bb.y1 - wallTop + 1;
  const TILE = Math.round(bb.w / 8);             // ~32px column unit (8 columns across the base)
  const colAt = (frac) => Math.round(bb.x0 + bb.w * frac);

  // cut a column tile [cx, cx+TILE) x [wallTop, y1]
  const cut = (cx) => { const t = createCanvas(TILE, wallH); t.getContext('2d').drawImage(bc, cx, wallTop, TILE, wallH, 0, 0, TILE, wallH); return t; };
  const tiles = {
    leftEdge: cut(bb.x0),                         // building's left edge (corner)
    rightEdge: cut(bb.x1 - TILE + 1),             // right edge (corner)
    door: cut(colAt(0.5) - (TILE >> 1)),          // centre = door
    window: cut(colAt(0.22)),                     // a window column
    plain: cut(colAt(0.40)),                      // a blank wall column (between door & window)
  };

  // assemble a wider south face from the tiles
  const seq = ['leftEdge', 'plain', 'window', 'plain', 'door', 'plain', 'window', 'plain', 'rightEdge'];
  const pad = 18, sw = seq.length * TILE, sh = wallH;
  const cv = createCanvas(sw + pad * 2, sh + pad * 2); const x = cv.getContext('2d');
  x.imageSmoothingEnabled = false; x.fillStyle = '#5e7d3f'; x.fillRect(0, 0, cv.width, cv.height);
  seq.forEach((k, i) => x.drawImage(tiles[k], pad + i * TILE, pad));
  fs.writeFileSync(process.argv[3], cv.toBuffer('image/png'));
  console.log(`tiles cut (TILE=${TILE}px, wallH=${wallH}) -> assembled ${seq.length}-tile face -> ${process.argv[3]}`);
}
main();
