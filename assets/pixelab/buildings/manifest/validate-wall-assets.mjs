// assets/pixelab/buildings/manifest/validate-wall-assets.mjs
// Asset gate for building wall PIECES. Rejects the exact bugs from
// docs/superpowers/specs/2026-06-21-building-render-quality-design.md (Lane A):
//   - internal alpha holes in the solid wall-surface region (the see-through daub),
//   - non-seamless horizontal tiling (left column != right column) on 32-wide strips,
//   - a south_corner_east that is a pixel-duplicate of south_base (no east post),
//   - a transparent OUTER shoulder strip on the stone_brick fallback corners.
//
// Pure-JS PNG decode reused from scripts/audit-png-alpha.mjs (read-only import).
//
// Run:  node --test assets/pixelab/buildings/manifest/validate-wall-assets.mjs
//
// SCOPE NOTE: this gate is intentionally conservative about which pieces must be
// hole-free. SURFACE pieces (south_base / interior_base / north_back) carry the
// wall plane the player sees; they must not be see-through to terrain. Corners,
// doorways and windows legitimately carry alpha (post shoulder, door cut, window
// surround) and are checked for OTHER properties (dup / outer-strip / seam) only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPngRgba } from '../../../../scripts/audit-png-alpha.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WALLS = path.resolve(HERE, '..', 'walls');
const STONE_BRICK = path.join(WALLS, 'stone_brick_tiles');

const WEARS = ['normal', 'weathered', 'damaged', 'mossy'];
const SURFACE = ['south_base', 'interior_base', 'north_back'];

function alphaAt(img, x, y) { return img.data[(y * img.width + x) * 4 + 3]; }

// Fraction of pixels with alpha < 16 inside an inner rect. The inner rect excludes
// the top sky band (rows < 8) and the bottom foundation/edge course (rows > 75% h),
// where transparency is legitimate. We inset the sides too so a transparent corner
// shoulder doesn't count against a flat surface piece.
function innerTransparentFrac(img, inset) {
  const x0 = inset, x1 = img.width - inset;
  const y0 = 8, y1 = Math.round(img.height * 0.75);
  let trans = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    total++; if (alphaAt(img, x, y) < 16) trans++;
  }
  return trans / total;
}

// Seamless horizontal tile: the left edge column must equal the right edge column
// (alpha + RGB within tolerance) so abutting copies hide the seam.
function colsMatch(img) {
  let worst = 0;
  for (let y = 8; y < img.height - 8; y++) {
    const li = (y * img.width + 0) * 4, ri = (y * img.width + (img.width - 1)) * 4;
    for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(img.data[li + c] - img.data[ri + c]));
  }
  return worst;
}

// Near-duplicate detector: the south_corner_east bug ships as a VISUAL copy of
// south_base (no east post). We compare the COMPOSITED-over-black image
// (premultiply RGB by alpha) so that the stored RGB of fully/partly-transparent
// pixels — which the PixelLab exporter leaves as arbitrary noise — does not count.
// What's left is exactly what the player sees. Treat <0.5% visibly-differing pixels
// as "duplicate / no east post".
function premulDiffFrac(a, b, tol = 12) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const px = a.width * a.height;
  let diffPx = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3], ab = b.data[i + 3];
    let d = Math.abs(aa - ab);
    for (let c = 0; c < 3; c++) {
      const va = Math.round(a.data[i + c] * aa / 255);
      const vb = Math.round(b.data[i + c] * ab / 255);
      d = Math.max(d, Math.abs(va - vb));
    }
    if (d > tol) diffPx++;
  }
  return diffPx / px;
}
function pixelsNearDuplicate(a, b) { return premulDiffFrac(a, b) < 0.005; }

// Horizontal mirror of a decoded RGBA image.
function flipH(img) {
  const { width: w, height: h, data } = img;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = (y * w + (w - 1 - x)) * 4;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
  }
  return { width: w, height: h, data: out };
}

// Mean luminance of opaque pixels in a vertical column band [x0,x1) over rows [y0,y1).
function bandLuma(img, x0, x1, y0, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (alphaAt(img, x, y) < 120) continue;
    const i = (y * img.width + x) * 4;
    sum += 0.3 * img.data[i] + 0.59 * img.data[i + 1] + 0.11 * img.data[i + 2]; n++;
  }
  return n ? sum / n : null;
}

// Per-column transparent count over the full height — used to detect an outer
// shoulder strip (e.g. the stone_brick corner reveals terrain on its outer edge).
function columnTransparent(img, x) {
  let c = 0;
  for (let y = 0; y < img.height; y++) if (alphaAt(img, x, y) < 16) c++;
  return c;
}

function eachMaterialDir(cb) {
  if (!fs.existsSync(WALLS)) return;
  for (const biome of fs.readdirSync(WALLS)) {
    const bdir = path.join(WALLS, biome);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const mat of fs.readdirSync(bdir)) {
      const mdir = path.join(bdir, mat);
      if (fs.statSync(mdir).isDirectory()) cb(biome, mat, mdir);
    }
  }
}

// ---------------------------------------------------------------------------

test('wall SURFACE pieces have NO internal alpha holes in the solid region (<5%)', () => {
  // 5% tolerance: the solid wall plane may carry a few legitimately-transparent
  // mortar nicks / overgrowth gaps, but must not be wholesale see-through. The
  // see-through daub bug measured 30-83% here.
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    for (const base of SURFACE) {
      for (const w of WEARS) {
        const p = path.join(mdir, `${base}__${w}.png`);
        if (!fs.existsSync(p)) continue;
        const img = readPngRgba(p);
        const frac = innerTransparentFrac(img, Math.max(1, Math.round(img.width * 0.06)));
        if (frac > 0.05) bad.push(`${biome}/${mat}/${base}__${w}.png: ${(frac * 100).toFixed(1)}% transparent in solid region`);
      }
    }
  });
  assert.equal(bad.length, 0, 'see-through wall surface(s):\n' + bad.join('\n'));
});

test('south_base inner region stays >=99% opaque (regression guard, do not re-author)', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    const p = path.join(mdir, 'south_base__normal.png');
    if (!fs.existsSync(p)) return;
    const img = readPngRgba(p);
    const frac = innerTransparentFrac(img, Math.max(1, Math.round(img.width * 0.06)));
    if (frac > 0.01) bad.push(`${biome}/${mat}/south_base__normal.png: ${(frac * 100).toFixed(1)}% transparent (should be <1%)`);
  });
  assert.equal(bad.length, 0, 'south_base no longer opaque in-region:\n' + bad.join('\n'));
});

test('seamless surface strips: left column == right column (32-wide strips only)', () => {
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    const p = path.join(mdir, 'south_base__normal.png');
    if (!fs.existsSync(p)) return;
    const img = readPngRgba(p);
    if (img.width > 64) return; // whole-facade legacy tiles are not strip-tiled; skip
    const worst = colsMatch(img);
    if (worst > 8) bad.push(`${biome}/${mat}/south_base__normal.png: left/right column diff ${worst} (>8)`);
  });
  assert.equal(bad.length, 0, 'non-seamless strips:\n' + bad.join('\n'));
});

test('south_corner_east has a real east post (mirror of south_corner_west, NOT a south_base copy)', () => {
  // The bug: south_corner_east lacks the corner pilaster that south_corner_west
  // carries on its left edge — it reads as a plain bay. The fix builds east as a
  // horizontal flip of west, so the post lands on the RIGHT. We assert BOTH:
  //   (a) east is NOT a near-duplicate of south_base (no post), and
  //   (b) east's outer (right) edge carries the same pilaster contrast that west's
  //       outer (left) edge does — i.e. east ≈ flip(west) where a post exists.
  const bad = [];
  eachMaterialDir((biome, mat, mdir) => {
    for (const w of WEARS) {
      const baseP = path.join(mdir, `south_base__${w}.png`);
      const eastP = path.join(mdir, `south_corner_east__${w}.png`);
      const westP = path.join(mdir, `south_corner_west__${w}.png`);
      if (!fs.existsSync(eastP)) continue;
      const east = readPngRgba(eastP);
      if (fs.existsSync(baseP) && pixelsNearDuplicate(readPngRgba(baseP), east)) {
        bad.push(`${biome}/${mat}/south_corner_east__${w}.png: pixel-duplicate of south_base (no east post)`);
        continue;
      }
      if (!fs.existsSync(westP)) continue;
      const west = readPngRgba(westP);
      if (east.width !== west.width || east.height !== west.height) continue;
      // The west corner's outer (left) edge band should stand apart from its own
      // mid band (the pilaster). The east corner's outer (right) edge must show the
      // SAME contrast — otherwise it has no east post.
      const w0 = Math.max(2, Math.round(west.width * 0.10));
      const y0 = Math.round(west.height * 0.15), y1 = Math.round(west.height * 0.80);
      const mxa = Math.round(west.width * 0.42), mxb = Math.round(west.width * 0.58);
      const westEdge = bandLuma(west, 0, w0, y0, y1);
      const westMid = bandLuma(west, mxa, mxb, y0, y1);
      const eastEdge = bandLuma(east, east.width - w0, east.width, y0, y1);
      if (westEdge == null || westMid == null || eastEdge == null) continue;
      const westContrast = Math.abs(westEdge - westMid);
      if (westContrast < 15) continue; // west itself has no obvious pilaster; can't infer
      // east outer edge should be near west outer edge (post mirrored across).
      if (Math.abs(eastEdge - westEdge) > 25) {
        bad.push(`${biome}/${mat}/south_corner_east__${w}.png: outer-edge luma ${eastEdge?.toFixed(0)} != west pilaster ${westEdge?.toFixed(0)} (no mirrored east post)`);
      }
    }
  });
  assert.equal(bad.length, 0, 'missing/incorrect east pilaster:\n' + bad.join('\n'));
});

test('stone_brick fallback corners have NO transparent OUTER shoulder strip (reveals terrain)', () => {
  // The fallback corners are 32x128. The OUTER edge (west: x0; east: x31) must not
  // be a tall transparent strip, or it reveals terrain where two walls meet.
  const bad = [];
  const checks = [
    ['south_corner_west.png', 0],
    ['south_corner_east.png', 31],
  ];
  for (const [f, outerX] of checks) {
    const p = path.join(STONE_BRICK, f);
    if (!fs.existsSync(p)) continue;
    const img = readPngRgba(p);
    const x = outerX < 0 ? img.width - 1 : Math.min(outerX, img.width - 1);
    const tc = columnTransparent(img, x);
    // allow the normal ~16px top sky band; flag a column that is mostly transparent
    if (tc > img.height * 0.30) bad.push(`stone_brick_tiles/${f}: outer column x=${x} is ${tc}/${img.height} transparent`);
  }
  assert.equal(bad.length, 0, 'stone_brick corner outer see-through:\n' + bad.join('\n'));
});
