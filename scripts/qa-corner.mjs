// scripts/qa-corner.mjs — QA GATE for a finished wall-END (corner) tile.
//
// We generate ONE side (west) and horizontally flip it for the other (east), so the GENERATED side MUST
// come out clean. The recurring PixelLab defect: the quoin stones on one edge INTRUDE UP into the
// wall-plate (cap) beam — the dark cap beam doesn't run cleanly across the full top; lighter stones
// replace it at one top corner. Detect it deterministically so it never ships (or gets flipped onto both
// sides). Run on the RAW (pre-solidify) tile.
//
// Method: the cap beam is a DARK horizontal band across the top. For each column, check whether the top
// band contains enough dark (low-brightness) beam pixels. A clean tile has the beam in EVERY column. The
// defect shows as a contiguous run of "beam-missing" columns at the left or right edge (stones intruded).
//
// Usage: node scripts/qa-corner.mjs <tile.png>   → PASS/FAIL + the offending edge; exit 0 pass / 1 fail.
import { loadImage, createCanvas } from '@napi-rs/canvas';

const inp = process.argv[2];
if (!inp) { console.error('usage: qa-corner.mjs <tile.png>'); process.exit(2); }
const img = await loadImage(inp);
const W = img.width, H = img.height;
const ctx = createCanvas(W, H).getContext('2d');
ctx.drawImage(img, 0, 0);
const px = ctx.getImageData(0, 0, W, H).data;
const A = 40;
const lum = (i) => (px[i] + px[i + 1] + px[i + 2]) / 3;

// content x-range and per-column content-top
let cx0 = W, cx1 = -1;
const top = new Array(W).fill(-1);
for (let x = 0; x < W; x++) {
  for (let y = 0; y < H; y++) {
    if (px[(y * W + x) * 4 + 3] > A) { top[x] = y; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; break; }
  }
}
if (cx1 < 0) { console.log(`FAIL empty  [${inp}]`); process.exit(1); }

const tilePx = W / 4;
const BAND = Math.round(tilePx * 0.55);   // cap-beam band = top ~0.55 tile of each column's content
const DARK = 95;                          // beam (dark-oak) < this; stone (grey) > this
const MIN_DARK = Math.round(tilePx * 0.18); // a real beam contributes ≥ ~0.18 tile of dark pixels

const beamMissing = new Array(W).fill(false);
for (let x = cx0; x <= cx1; x++) {
  if (top[x] < 0) continue;
  let dark = 0;
  for (let y = top[x]; y < top[x] + BAND && y < H; y++) {
    const i = (y * W + x) * 4;
    if (px[i + 3] > A && lum(i) < DARK) dark++;
  }
  beamMissing[x] = dark < MIN_DARK;
}

// longest run of beam-missing columns touching the LEFT or RIGHT content edge
const edgeRun = (xs) => { let n = 0; for (const x of xs) { if (beamMissing[x]) n++; else break; } return n; };
const leftRun = edgeRun(Array.from({ length: cx1 - cx0 + 1 }, (_, k) => cx0 + k));
const rightRun = edgeRun(Array.from({ length: cx1 - cx0 + 1 }, (_, k) => cx1 - k));
const FAIL_RUN = Math.round(tilePx * 0.5); // an edge run ≥ ~0.5 tile of missing beam = intruding stones

const worst = Math.max(leftRun, rightRun);
const pass = worst < FAIL_RUN;
const side = leftRun >= rightRun ? 'WEST' : 'EAST';
console.log(`${pass ? 'PASS' : 'FAIL'}  cap-beam edge-gap: left=${leftRun}px right=${rightRun}px (fail ≥ ${FAIL_RUN}px, worst=${side})  [${inp}]`);
process.exit(pass ? 0 : 1);
