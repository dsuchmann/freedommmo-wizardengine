// scripts/gen-wall-body.mjs <bodyIn.png> <stripOut.png> [tileOut.png]
// (Version-controlled copy of the gitignored _wall_body.mjs helper — the `_*` ignore rule
// kept the seamless algorithm out of git, so this is the tracked source of truth.)
// Turn a create_map_object face-on wall swatch into (a) a seamless+opaque body TILE and
// (b) a 4-tall wall STRIP ready to drop in as south_base. PixelLab can't make seamless face-on
// walls or force opacity, so we do it here:
//   1. crop the opaque region to a centred square
//   2. force every pixel opaque (no see-through walls)
//   3. make it seamless by EDGE-WRAP CROSS-FADE — blend a margin band at each edge with the
//      pixel wrapped from the OPPOSITE edge, so left==right and top==bottom with no centre smudge.
//      (The old offset-by-half + mirror-across-the-centre-cross left a visible smear down the
//      middle; this keeps the swatch centre untouched and only heals the four edges.)
//   4. optional gentle de-contrast so dark pebble gaps don't make the repeat obvious
//   5. stack 4 tiles into a column strip (NO v-mirror — a mirror flips lighting and reads as a
//      seam itself; with seamless edges the straight repeat is clean)
import { createCanvas, loadImage, ImageData } from '@napi-rs/canvas';
import fs from 'node:fs';

const inp = process.argv[2];
const stripOut = process.argv[3] || 'tools/_wall_strip.png';
const tileOut = process.argv[4] || 'tools/_wall_tile.png';
const TILE = +(process.env.TILE || 64);            // body tile px (1 game tile)
const FEATHER = +(process.env.FEATHER || 0.22);    // edge-blend band as a fraction of TILE
const DECON = +(process.env.DECON || 0.0);         // 0..1 pull toward the mean (flatten contrast)
const ROWS = +(process.env.ROWS || 4);             // tiles tall in the strip

const img = await loadImage(inp);
const W = img.width, H = img.height;
const c = createCanvas(W, H); const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
const p = cx.getImageData(0, 0, W, H).data;

// 1. opaque bbox -> centred square (inset a couple px so the soft anti-aliased swatch RIM — which
//    can carry stray coloured fringe pixels — never enters the tile)
let x0 = W, y0 = H, x1 = -1, y1 = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[(y * W + x) * 4 + 3] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
const RIM = 2;
x0 += RIM; y0 += RIM; x1 -= RIM; y1 -= RIM;
const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(bw, bh);
const sx0 = x0 + ((bw - s) >> 1), sy0 = y0 + ((bh - s) >> 1);

// extract -> TILE, force opaque
const t = createCanvas(TILE, TILE); const tc = t.getContext('2d'); tc.imageSmoothingEnabled = true;
tc.drawImage(c, sx0, sy0, s, s, 0, 0, TILE, TILE);
const tid = tc.getImageData(0, 0, TILE, TILE); const tp = tid.data;
for (let i = 0; i < TILE * TILE; i++) tp[i * 4 + 3] = 255;          // 2. force opaque

// 4. optional flatten: pull each channel toward the global mean by DECON
if (DECON > 0) {
  let mr = 0, mg = 0, mb = 0; const n = TILE * TILE;
  for (let i = 0; i < n; i++) { mr += tp[i * 4]; mg += tp[i * 4 + 1]; mb += tp[i * 4 + 2]; }
  mr /= n; mg /= n; mb /= n;
  for (let i = 0; i < n; i++) {
    tp[i * 4]     = tp[i * 4]     + (mr - tp[i * 4])     * DECON;
    tp[i * 4 + 1] = tp[i * 4 + 1] + (mg - tp[i * 4 + 1]) * DECON;
    tp[i * 4 + 2] = tp[i * 4 + 2] + (mb - tp[i * 4 + 2]) * DECON;
  }
}

// 3. EDGE-WRAP CROSS-FADE. For a pixel within `band` of an edge, blend it toward the pixel wrapped
//    in from the OPPOSITE edge (same column for top/bottom, same row for left/right) with a cosine
//    weight that is 0.5 exactly AT the edge (so the two edges meet identically) and 0 at band depth.
//    Doing the horizontal then the vertical pass on the SAME buffer also heals the 4 corners.
const band = Math.max(3, Math.round(TILE * FEATHER));
const src = tp.slice();
const at = (buf, x, y, k) => buf[(((y % TILE) + TILE) % TILE) * TILE * 4 + (((x % TILE) + TILE) % TILE) * 4 + k];
// horizontal: near x=0 blend with x=TILE-... wrap (i.e. the right edge), and symmetrically near x=TILE-1
function pass(horizontal) {
  const base = src.slice();
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const d = horizontal ? Math.min(x, TILE - 1 - x) : Math.min(y, TILE - 1 - y);
    if (d >= band) continue;
    // cosine weight: w=0.5 at the very edge (d=0), tapering to 0 at d=band
    const w = 0.5 * (1 + Math.cos(Math.PI * d / band)) * 0.5; // 0.5..0  -> at d=0 =>0.5, d=band=>0
    const near0 = horizontal ? (x < TILE / 2) : (y < TILE / 2);
    // partner = the pixel that should match across this edge = wrap to the opposite side
    const px = horizontal ? (near0 ? x + TILE : x - TILE) : x;
    const py = horizontal ? y : (near0 ? y + TILE : y - TILE);
    for (let k = 0; k < 4; k++) {
      const a = base[(y * TILE + x) * 4 + k];
      const b = at(base, px, py, k);
      src[(y * TILE + x) * 4 + k] = a * (1 - w) + b * w;
    }
  }
}
pass(true);   // heal left/right seam
pass(false);  // heal top/bottom seam
for (let i = 0; i < src.length; i++) tp[i] = src[i];
tc.putImageData(new ImageData(tp, TILE, TILE), 0, 0);
fs.writeFileSync(tileOut, t.toBuffer('image/png'));

// 5. ROWS-tall column strip — straight repeat (seamless edges already match, no mirror).
// horizontal roll dx (px): the renderer's south_base + rb1..rb3 variants want a per-column
// mortar-joint SHIFT so a tiled wall doesn't read as a fixed 1-tile repeat. A seamless tile is
// seamless under any horizontal roll, so roll the tile by dx (wrapping) before stacking.
function buildStrip(dx) {
  const strip = createCanvas(TILE, TILE * ROWS); const stc = strip.getContext('2d'); stc.imageSmoothingEnabled = false;
  for (let i = 0; i < ROWS; i++) { stc.drawImage(t, dx, TILE * i); stc.drawImage(t, dx - TILE, TILE * i); }
  return strip.toBuffer('image/png');
}
fs.writeFileSync(stripOut, buildStrip(0));
console.log(`tile -> ${tileOut} (${TILE}x${TILE}), strip -> ${stripOut} (${TILE}x${TILE * ROWS}) band=${band} decon=${DECON}`);

// RB_OUT=<prefix> → also emit the run-bond variant set: <prefix>__normal/rb1/rb2/rb3.png, rolled
// 0/16/32/48 px so adjacent wall columns use shifted joints (drop straight into south_base__*).
// Pass RB_ROLL=0 for IDENTICAL variants (e.g. timber: keep the beam lattice aligned across columns).
const rbOut = process.env.RB_OUT;
if (rbOut) {
  const roll = process.env.RB_ROLL != null ? +process.env.RB_ROLL : 1;
  const names = ['__normal', '__rb1', '__rb2', '__rb3'];
  const offs = roll ? [0, 16, 32, 48].map((o) => Math.round(o * TILE / 64)) : [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) fs.writeFileSync(`${rbOut}${names[i]}.png`, buildStrip(offs[i]));
  console.log(`rb set -> ${rbOut}{__normal,__rb1,__rb2,__rb3}.png roll=${roll ? offs.join('/') : 'identical'}`);
}
