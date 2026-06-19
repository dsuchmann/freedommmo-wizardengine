// roof-geometry.js — TOPOLOGY axis of the roof system.
//
// Pure function of a footprint (a union of axis-aligned rectangles, the SAME
// `sections` shape the game's buildings already emit: {x0,y0,w,h}). It builds a
// heightmap, derives smooth corner heights + slope normals, and classifies every
// tile into a ROLE (eave / slope / ridge / hip / valley / peak / deck). Roofs are
// thus quantized into per-tile pieces — the atlas/wall-section requirement — while
// the continuous corner surface keeps the render seamless.
//
// The height comes from a STYLE function (roof-styles.js): geometry computes the
// metrics, the style maps metrics -> height, geometry does everything else. This
// keeps "one engine, many forms".

import { STYLES, PER_SECTION_STYLES } from './roof-styles.js';

const SQRT2 = Math.SQRT2;
export const ROLE = {
  EAVE: 'eave', SLOPE: 'slope', RIDGE: 'ridge', HIP: 'hip',
  VALLEY: 'valley', PEAK: 'peak', DECK: 'deck',
};

// ─── footprint helpers ───────────────────────────────────────────────────────

function footprintBBox(sections) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sections) {
    x0 = Math.min(x0, s.x0); y0 = Math.min(y0, s.y0);
    x1 = Math.max(x1, s.x0 + s.w); y1 = Math.max(y1, s.y0 + s.h);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

function tileInSection(gx, gy, s) {
  return gx >= s.x0 && gx < s.x0 + s.w && gy >= s.y0 && gy < s.y0 + s.h;
}

// ─── distance transforms (chamfer, two-pass) ─────────────────────────────────

// distance from each fp tile to the nearest non-fp (background) tile.
function chamferDistance(fp, W, H, diagCost) {
  const INF = 1e9;
  const d = new Float64Array(W * H);
  for (let k = 0; k < d.length; k++) d[k] = fp[k] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!fp[y * W + x]) continue;
    let v = d[y * W + x];
    v = Math.min(v, at(x - 1, y) + 1, at(x, y - 1) + 1,
      at(x - 1, y - 1) + diagCost, at(x + 1, y - 1) + diagCost);
    d[y * W + x] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    if (!fp[y * W + x]) continue;
    let v = d[y * W + x];
    v = Math.min(v, at(x + 1, y) + 1, at(x, y + 1) + 1,
      at(x + 1, y + 1) + diagCost, at(x - 1, y + 1) + diagCost);
    d[y * W + x] = v;
  }
  return d;
}

// per-tile distance to nearest footprint edge along each cardinal direction.
function axisEdgeDistance(fp, W, H) {
  const dN = new Int32Array(W * H), dS = new Int32Array(W * H);
  const dE = new Int32Array(W * H), dWst = new Int32Array(W * H);
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && fp[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!fp[y * W + x]) continue;
    dN[y * W + x] = inside(x, y - 1) ? dN[(y - 1) * W + x] + 1 : 1;
    dWst[y * W + x] = inside(x - 1, y) ? dWst[y * W + x - 1] + 1 : 1;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    if (!fp[y * W + x]) continue;
    dS[y * W + x] = inside(x, y + 1) ? dS[(y + 1) * W + x] + 1 : 1;
    dE[y * W + x] = inside(x + 1, y) ? dE[y * W + x + 1] + 1 : 1;
  }
  return { dN, dS, dE, dW: dWst };
}

// ─── main builder ────────────────────────────────────────────────────────────

export function buildRoofGrid(sections, opts = {}) {
  const style = opts.style || 'hip';
  const p = opts.params || {};
  const ovh = Math.max(0, Math.round(opts.overhang ?? 1)); // overhang ring count
  const bbox = footprintBBox(sections);

  const gox = bbox.x0 - ovh, goy = bbox.y0 - ovh;
  const W = bbox.w + 2 * ovh, H = bbox.h + 2 * ovh;
  const idx = (i, j) => j * W + i;

  // footprint mask (grid-local) + section assignment
  const fp = new Uint8Array(W * H);
  const sectionId = new Int32Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const gx = gox + i, gy = goy + j;
    for (let s = 0; s < sections.length; s++) {
      if (tileInSection(gx, gy, sections[s])) { fp[idx(i, j)] = 1; sectionId[idx(i, j)] = s; break; }
    }
  }

  // metrics
  const distEdge = chamferDistance(fp, W, H, SQRT2);
  const distCheb = chamferDistance(fp, W, H, 1);
  const { dN, dS, dE, dW } = axisEdgeDistance(fp, W, H);

  // GLOBAL footprint centroid + max radial (for cone/dome/pyramid). Using the
  // whole-footprint centroid — not per-rectangle — so a disc made of many 1-row
  // sections (the game's `round` pattern) yields ONE cone, not a tent per row.
  let gsx = 0, gsy = 0, gn = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (sectionId[idx(i, j)] < 0) continue;
    gsx += gox + i; gsy += goy + j; gn++;
  }
  const gCx = gn ? gsx / gn : 0, gCy = gn ? gsy / gn : 0;
  let gMaxR = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (sectionId[idx(i, j)] < 0) continue;
    const r = Math.hypot(gox + i - gCx, goy + j - gCy);
    if (r > gMaxR) gMaxR = r;
  }
  const secCentroid = [{ cx: gCx, cy: gCy }];

  // footprint-wide constants
  let maxDEdgeNS = 0, maxDEdgeEW = 0;
  for (let k = 0; k < W * H; k++) {
    if (!fp[k]) continue;
    maxDEdgeNS = Math.max(maxDEdgeNS, Math.min(dN[k], dS[k]));
    maxDEdgeEW = Math.max(maxDEdgeEW, Math.min(dE[k], dW[k]));
  }

  const styleFn = STYLES[style] || STYLES.hip;
  const perSection = PER_SECTION_STYLES.has(style);

  // height field over footprint tiles
  const height = new Float64Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = idx(i, j); if (!fp[k]) continue;
    const m = {
      gx: gox + i, gy: goy + j,
      distEdge: distEdge[k], distEdgeCheb: distCheb[k],
      dEdgeNS: Math.min(dN[k], dS[k]), dEdgeEW: Math.min(dE[k], dW[k]),
      maxDEdgeNS, maxDEdgeEW,
      radial: Math.hypot(gox + i - gCx, goy + j - gCy),
      maxRadial: gMaxR,
      acrossEW: i - ovh, acrossNS: j - ovh,
      fpW: bbox.w, fpH: bbox.h,
      span: Math.max(bbox.w, bbox.h),
      normX: bbox.w > 1 ? (i - ovh) / (bbox.w - 1) : 0,
      normY: bbox.h > 1 ? (j - ovh) / (bbox.h - 1) : 0,
    };
    height[k] = Math.max(0, styleFn(m, p));
  }

  // overhang tiles: extend the eave slope outward and downward
  const isOverhang = new Uint8Array(W * H);
  if (ovh > 0) {
    const droop = opts.overhangDroop ?? 0.35;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = idx(i, j); if (fp[k]) continue;
      // nearest footprint tile (small search within overhang ring)
      let best = null, bestD = 1e9, bestJ = -1;
      for (let dj = -ovh; dj <= ovh; dj++) for (let di = -ovh; di <= ovh; di++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        if (!fp[idx(ni, nj)]) continue;
        const dd = Math.hypot(di, dj);
        if (dd < bestD) { bestD = dd; best = idx(ni, nj); bestJ = nj; }
      }
      if (best != null && bestD <= ovh + 0.5) {
        // Skip NORTH-side overhang (nearest footprint tile is to the SOUTH): a north
        // eave/overhang would poke up past the north wall into the building behind.
        if (opts.noNorthOverhang && bestJ > j) continue;
        isOverhang[k] = 1;
        height[k] = height[best] - droop * bestD;
      }
    }
  }
  const roof = (k) => fp[k] || isOverhang[k];

  // smooth corner heights ((W+1) x (H+1)); average the up-to-4 roof tiles
  const CW = W + 1;
  const cornerH = new Float64Array((W + 1) * (H + 1));
  for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
    let sum = 0, n = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const i = cx + di, j = cy + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      if (!roof(idx(i, j))) continue;
      sum += height[idx(i, j)]; n++;
    }
    cornerH[cy * CW + cx] = n ? sum / n : 0;
  }

  // assemble per-tile records with normals + roles
  const tiles = [];
  let maxHeight = 0;
  const hAt = (i, j) => (i < 0 || j < 0 || i >= W || j >= H || !roof(idx(i, j)) ? null : height[idx(i, j)]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = idx(i, j); if (!roof(k)) continue;
    const h = height[k];
    maxHeight = Math.max(maxHeight, h);
    // normal from the four corner heights of this cell
    const c00 = cornerH[j * CW + i], c10 = cornerH[j * CW + i + 1];
    const c01 = cornerH[(j + 1) * CW + i], c11 = cornerH[(j + 1) * CW + i + 1];
    const dx = (c10 + c11 - c00 - c01) / 2;
    const dy = (c01 + c11 - c00 - c10) / 2;
    const nlen = Math.hypot(dx, dy, 1) || 1;
    const normal = [-dx / nlen, -dy / nlen, 1 / nlen];
    // downhill cardinal direction
    let dir = 'flat';
    if (Math.abs(dx) > 0.04 || Math.abs(dy) > 0.04) {
      dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
    }
    tiles.push({
      i, j, gx: gox + i, gy: goy + j, h, normal, dir,
      isOverhang: !!isOverhang[k], sectionId: sectionId[k],
      role: ROLE.SLOPE, // filled below
      distEdge: fp[k] ? distEdge[k] : 0,
    });
  }

  // role classification (needs neighbor heights)
  const byKey = new Map(tiles.map(t => [t.i + ',' + t.j, t]));
  const get = (i, j) => byKey.get(i + ',' + j);
  for (const t of tiles) {
    if (t.isOverhang) { t.role = ROLE.EAVE; continue; }
    const { i, j, h } = t;
    const n = hAt(i, j - 1), s = hAt(i, j + 1), e = hAt(i + 1, j), w = hAt(i - 1, j);
    const flatish = Math.abs((t.normal[0])) < 0.06 && Math.abs(t.normal[1]) < 0.06;
    const neigh = [n, s, e, w].filter(v => v != null);
    const localMax = neigh.every(v => h >= v - 1e-6);
    const localMin = neigh.every(v => h <= v + 1e-6);
    const ridgeNS = n != null && s != null && h >= n - 1e-6 && h >= s - 1e-6 && (e == null || w == null || h < Math.max(e, w) + 0.5);
    const ridgeEW = e != null && w != null && h >= e - 1e-6 && h >= w - 1e-6 && (n == null || s == null || h < Math.max(n, s) + 0.5);
    if (t.distEdge <= 1.2) t.role = ROLE.EAVE;
    else if (flatish && h > 0.25) t.role = ROLE.DECK;
    else if (localMax && h > 0.5) t.role = ROLE.PEAK;
    else if (localMin && neigh.length >= 3 && h > 0.2) t.role = ROLE.VALLEY;
    else if ((ridgeNS || ridgeEW) && h > 0.4) t.role = ROLE.RIDGE;
    else t.role = ROLE.SLOPE;
  }

  const byRole = (r) => tiles.filter(t => t.role === r);
  return {
    W, H, gox, goy, ovh, bbox, sections, style, params: p,
    tiles, cornerH, CW,
    fp, isOverhang, height,
    maxHeight,
    roleTiles: {
      eave: byRole(ROLE.EAVE), peak: byRole(ROLE.PEAK), ridge: byRole(ROLE.RIDGE),
      valley: byRole(ROLE.VALLEY), deck: byRole(ROLE.DECK), slope: byRole(ROLE.SLOPE),
    },
    sectionCentroids: secCentroid,
    sectionMaxR: [gMaxR],
    cornerHeightAt: (cx, cy) => cornerH[cy * CW + cx],
  };
}
