// roof-renderer.js — 3/4 oblique CANVAS renderer for a roof grid.
//
// Pure procedural: no images. Projects each tile's four (smoothed) corners into a
// 3/4 view, sorts back-to-front, shades each facet by its normal vs a light, hands
// the quad to the MATERIAL to skin, then draws eave fascia, accent creases, and
// finally the FEATURE pass (turrets / buttresses / crenellations / decks …).

const VIEW = { yScale: 0.60, hScaleFactor: 1.0 };

// Build a view transform that fits `grid` into a w×h canvas with margin.
export function computeView(grid, cw, ch, margin = 0.86) {
  const span = grid.W, depth = grid.H;
  const yScale = VIEW.yScale, hf = VIEW.hScaleFactor;
  // pick a tile size that fits both axes (height lifts the top edge up)
  const tileW = (cw * margin) / span;
  const tileH = (ch * margin) / (depth * yScale + grid.maxHeight * hf + 2.5);
  const tile = Math.max(4, Math.min(tileW, tileH));
  const view = {
    tile, yScale, hScale: tile * hf,
    ox: 0, oy: 0,
    cx0: grid.gox, cy0: grid.goy,
    project(gx, gy, hh) {
      return {
        x: this.ox + (gx - grid.gox) * this.tile,
        y: this.oy + (gy - grid.goy) * this.tile * this.yScale - hh * this.hScale,
      };
    },
  };
  // center: project every corner with origin 0, then translate to canvas center
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let cy = 0; cy <= grid.H; cy++) for (let cx = 0; cx <= grid.W; cx++) {
    const hh = grid.cornerH[cy * grid.CW + cx];
    const x = (cx) * tile, y = (cy) * tile * yScale - hh * view.hScale;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  view.ox = cw / 2 - (minX + maxX) / 2;
  view.oy = ch / 2 - (minY + maxY) / 2;
  return view;
}

// GAME-PROJECTION view: matches the shipped renderer exactly — flat 1:1 top-down
// (sx = wx*tilePx - camX, sy = wy*tilePx - camY), with roof HEIGHT expressed as a
// pure upward pixel lift sitting on top of the building's wall band. originWx/Wy =
// the building's world tile origin (b.x/b.y); grid tile coords are added to it.
export function makeGameView(originWx, originWy, camX, camY, tilePx, opts = {}) {
  const wallLift = opts.wallLift ?? 3.75 * tilePx; // wall top: (wallHeight - yOffset)*tilePx
  const hScale = opts.heightScale ?? tilePx * 0.55;
  // UNIFORM lift: every eave sits on its wall top (north AND south walls are both the
  // tall 4-tile sprite), so the roof never terminates short of the north wall. The
  // roof not extending past the north edge is handled by CAPPING the roof height to
  // the building depth (see roof-ingame.js), so the ridge can't rise north of the eave.
  return {
    tile: tilePx, yScale: 1, hScale, game: true,
    project(gx, gy, hh) {
      return {
        x: (originWx + gx) * tilePx - camX,
        y: (originWy + gy) * tilePx - camY - wallLift - hh * hScale,
      };
    },
  };
}

function corner(grid, view, cx, cy) {
  const hh = grid.cornerH[cy * grid.CW + cx];
  return view.project(grid.gox + cx, grid.goy + cy, hh);
}

// expand a quad outward from its centroid so neighbours overlap ~0.5px → no seams
function inflateQuad(q, frac) {
  let cx = 0, cy = 0; for (const p of q) { cx += p.x; cy += p.y; } cx /= 4; cy /= 4;
  const s = 1 + frac;
  return [
    { x: cx + (q[0].x - cx) * s, y: cy + (q[0].y - cy) * s },
    { x: cx + (q[1].x - cx) * s, y: cy + (q[1].y - cy) * s },
    { x: cx + (q[2].x - cx) * s, y: cy + (q[2].y - cy) * s },
    { x: cx + (q[3].x - cx) * s, y: cy + (q[3].y - cy) * s },
  ];
}

function tileQuad(grid, view, t) {
  return [
    corner(grid, view, t.i, t.j),
    corner(grid, view, t.i + 1, t.j),
    corner(grid, view, t.i + 1, t.j + 1),
    corner(grid, view, t.i, t.j + 1),
  ];
}

function facetNormal(grid, t) {
  const i = t.i, j = t.j, CW = grid.CW;
  const h00 = grid.cornerH[j * CW + i], h10 = grid.cornerH[j * CW + i + 1];
  const h01 = grid.cornerH[(j + 1) * CW + i];
  const nx = h00 - h10, ny = h00 - h01, nz = 1;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function lightVec(angleDeg, elevDeg) {
  const a = (angleDeg * Math.PI) / 180, e = (elevDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

// SMOOTH shade: use the geometry's per-tile corner-averaged normal (t.normal) instead
// of the raw 2-corner facetNormal, plus a tiny along-run gradient (slightly darker
// toward the eave) so equal-distEdge hip rings stop reading as flat color terraces.
export function smoothNormalShade(grid, t, light, ambient) {
  const n = t.normal || facetNormal(grid, t);
  const lambert = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
  let shade = ambient + (1 - ambient) * lambert;
  // along-run gradient: 0 at the eave, 1 at the ridge — lifts the ridge ~6% so the
  // surface reads as a continuous slope, not stepped color rings.
  const sa = t.slopeAxis;
  if (sa && sa.runMax > 0) shade *= 0.94 + 0.06 * (sa.run / sa.runMax);
  return shade;
}

// Continuous slope-space UV for one tile. v runs eave(0)->ridge(1) using the tile's
// slopeAxis.run (a per-face course counter), so adjacent tiles on the same face share
// the boundary v value and the texture courses flow UNBROKEN (no per-tile restart).
export function slopeUV(t) {
  const sa = t.slopeAxis || { run: Math.max(0, (t.distEdge || 1) - 1), runMax: 1, dir: 'n' };
  const runMax = sa.runMax > 0 ? sa.runMax : 1;
  const v0 = sa.run / runMax;
  const v1 = (sa.run + 1) / runMax;
  return { v0, v1, dir: sa.dir || 'n' };
}

// Texture-map a facet quad with a CONTINUOUS slope-space UV: u along the ridge, v
// eave->ridge (from slopeUV), sampling the FULL tex.width x tex.height so courses flow
// unbroken across tile boundaries instead of restarting a fixed 32px crop per tile.
function drawTexturedTile(ctx, q, tex, shade, t) {
  const TW = tex.width || 32, TH = tex.height || 32;
  const { v0, v1, dir } = slopeUV(t);
  // source window: v selects the eave->ridge band; u uses the tile's along-ridge index
  // (gx for n/s faces, gy for e/w) modulo the swatch so horizontal courses tile seamlessly.
  const along = (dir === 'n' || dir === 's') ? (t.gx | 0) : (t.gy | 0);
  const u0frac = (((along % 2) + 2) % 2) / 2;          // 2-tile horizontal repeat
  const sx = u0frac * TW, sw = TW / 2;
  // textures are authored eave-at-bottom: flip v so eave(v0) samples the bottom course.
  const sy0 = (1 - v1) * TH, sy1 = (1 - v0) * TH;
  const sy = Math.min(sy0, sy1), sh = Math.max(1, Math.abs(sy1 - sy0));
  const TL = q[0], TR = q[1], BL = q[3];
  ctx.save();
  // NO per-cell clip: clipping anti-aliases each cell edge → sub-pixel transparent seams
  // that read as see-through. The affine drawImage fills the (already-inflated) quad and
  // overlaps neighbours, covering the seams.
  ctx.imageSmoothingEnabled = false;
  // affine maps the chosen source window onto the quad — divide by the window size (sw,sh),
  // not a fixed 32, so the slope band stretches over the facet correctly.
  ctx.transform((TR.x - TL.x) / sw, (TR.y - TL.y) / sw, (BL.x - TL.x) / sh, (BL.y - TL.y) / sh, TL.x, TL.y);
  try { ctx.drawImage(tex, sx, sy, sw, sh, 0, 0, sw, sh); } catch (e) { /* bad bitmap */ }
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y); ctx.closePath();
  ctx.fillStyle = shade < 1 ? `rgba(0,0,0,${Math.min(0.55, (1 - shade) * 0.7)})`
    : `rgba(255,250,230,${Math.min(0.35, (shade - 1) * 0.5)})`;
  ctx.fill();
}

// Average colour of a texture, sampled once to a 1×1 canvas and cached per bitmap.
// Used as an opaque BASE COAT under the textured facets: the dark slits the user saw
// are hairline inter-facet seams exposing the dark roof→wall SKIRT drawn underneath
// (the facets are planar in projection, so the affine fill is exact — not a gap). A
// roof-coloured base coat makes any residual seam read as roof, never a dark slit.
const _texAvg = new WeakMap();
function sampledBaseColor(tex) {
  if (_texAvg.has(tex)) return _texAvg.get(tex);
  let c = null;
  try {
    let cv = null;
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(1, 1);
    else if (typeof document !== 'undefined') { cv = document.createElement('canvas'); cv.width = 1; cv.height = 1; }
    if (cv) {
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingEnabled = true;
      cx.drawImage(tex, 0, 0, tex.width || 32, tex.height || 32, 0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      if (d[3] > 0) c = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
    }
  } catch (e) { c = null; }
  _texAvg.set(tex, c);
  return c;
}

function isPerimeter(grid, t) {
  const W = grid.W, H = grid.H;
  const roof = (i, j) => i >= 0 && j >= 0 && i < W && j < H && (grid.fp[j * W + i] || grid.isOverhang[j * W + i]);
  return !roof(t.i, t.j - 1) || !roof(t.i, t.j + 1) || !roof(t.i + 1, t.j) || !roof(t.i - 1, t.j);
}

export function drawRoof(ctx, grid, material, features, cfg, view) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  if (!cfg.noClear) ctx.clearRect(0, 0, cw, ch);
  if (cfg.background !== false && !cfg.noClear) { ctx.fillStyle = cfg.background || '#0e1014'; ctx.fillRect(0, 0, cw, ch); }

  const light = lightVec(cfg.lightAngle ?? 235, cfg.lightElev ?? 52);
  const ambient = cfg.ambient ?? 0.34;

  // painter order: back (north) and low first; features drawn last
  const order = grid.tiles.slice().sort((a, b) => (a.gy - b.gy) || (a.h - b.h) || (a.gx - b.gx));

  // ground shadow (soft ellipse under the footprint) — skip when overlaying the game
  if (!cfg.noShadow) drawGroundShadow(ctx, grid, view);

  // ROOF→WALL SKIRT (the "roof-wall tile"): drop every perimeter edge straight down
  // to the wall-top plane (h=0 in the game projection) so the roof terminates flush
  // on the south wall / gable ends instead of floating above it. Drawn FIRST so the
  // roof surface sits cleanly on top.
  if (!cfg.noSkirt) for (const t of order) {
    if (t.isOverhang || t.role === 'eave') drawSkirt(ctx, grid, view, t, material);
  }

  // overlap tiles slightly to kill inter-facet seams
  const infl = 1.4 / Math.max(8, view.tile);
  for (const t of order) {
    const quad = inflateQuad(tileQuad(grid, view, t), infl);
    let shade = smoothNormalShade(grid, t, light, ambient);
    if (t.isOverhang) shade *= 0.82;
    // cfg.texture = a 32×32 ImageBitmap (e.g. the biome ground tile) → texture-map it
    // onto the facet + slope-shade; else fall back to the procedural material.
    if (cfg.texture) {
      // base coat (roof's own colour) UNDER the texture so a hairline facet seam shows
      // roof, not the dark skirt beneath — kills the "see-through" dark slits.
      const base = sampledBaseColor(cfg.texture);
      if (base) {
        ctx.fillStyle = base;
        ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y);
        for (let kk = 1; kk < 4; kk++) ctx.lineTo(quad[kk].x, quad[kk].y);
        ctx.closePath(); ctx.fill();
      }
      drawTexturedTile(ctx, quad, cfg.texture, shade, t);
    } else material.fillTile(ctx, quad, t, shade, view, grid);
  }

  if (!cfg.noAccents) drawAccents(ctx, grid, view, cfg);
  if (material.trim) material.trim(ctx, grid, view, cfg);
  if (features && features.draw) features.draw(ctx, grid, view, cfg, { light, ambient });
}

// Should this perimeter edge bridge down to the wall top as a gable/rake board?
// SOUTH always bridges (the visible roof->wall cliff). E/W bridge as the gable/rake
// ends so they terminate on the wall, not as flat cuts. NORTH never bridges in the
// game view (it would poke past the north wall into the neighbour). Only the GAME
// projection bridges; the oblique gallery keeps the thin eave fascia everywhere.
export function isGableRakeEdge(grid, t, d, game) {
  if (!game) return false;
  if (d === 'n') return false;        // noNorthOverhang guard
  return d === 's' || d === 'e' || d === 'w';
}

// The roof-wall transition piece. In the GAME projection (view.game) the perimeter
// drops to h=0 = the wall top, so it reads as a gable end / rake board terminating
// on the wall. In the oblique gallery it's just a thin eave fascia.
function drawSkirt(ctx, grid, view, t, material, cfg) {
  const baseDrop = (grid.params && grid.params.fascia) || 0.5;
  const edges = [
    [[t.i, t.j], [t.i + 1, t.j], 'n'],
    [[t.i + 1, t.j], [t.i + 1, t.j + 1], 'e'],
    [[t.i + 1, t.j + 1], [t.i, t.j + 1], 's'],
    [[t.i, t.j + 1], [t.i, t.j], 'w'],
  ];
  const outside = (i, j) => {
    if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) return true;
    return !(grid.fp[j * grid.W + i] || grid.isOverhang[j * grid.W + i]);
  };
  const nb = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  for (const [c1, c2, d] of edges) {
    const [oi, oj] = nb[d];
    if (!outside(t.i + oi, t.j + oj)) continue;
    const ch1 = grid.cornerH[c1[1] * grid.CW + c1[0]], ch2 = grid.cornerH[c2[1] * grid.CW + c2[0]];
    // Only the SOUTH face bridges all the way down to the wall top (h=0) — that's the
    // visible "roof→wall cliff" the user wants terminated. N/E/W keep a thin eave
    // fascia so the overhang still curves/flares (no dark erased gable faces).
    const toWall = view.game && d === 's';
    const bH1 = toWall ? 0 : Math.max(0, ch1 - baseDrop);
    const bH2 = toWall ? 0 : Math.max(0, ch2 - baseDrop);
    if (ch1 - bH1 < 0.02 && ch2 - bH2 < 0.02) continue; // nothing to bridge
    const top1 = corner(grid, view, c1[0], c1[1]), top2 = corner(grid, view, c2[0], c2[1]);
    const bot1 = view.project(grid.gox + c1[0], grid.goy + c1[1], bH1);
    const bot2 = view.project(grid.gox + c2[0], grid.goy + c2[1], bH2);
    ctx.beginPath();
    ctx.moveTo(top1.x, top1.y); ctx.lineTo(top2.x, top2.y);
    ctx.lineTo(bot2.x, bot2.y); ctx.lineTo(bot1.x, bot1.y); ctx.closePath();
    const dShade = d === 's' ? 0.88 : d === 'n' ? 0.5 : 0.66; // sunlit south / shadowed north
    ctx.fillStyle = material.fasciaColor ? material.fasciaColor(dShade) : 'rgba(30,24,18,0.9)';
    ctx.fill();
  }
}

function drawGroundShadow(ctx, grid, view) {
  const c = view.project(grid.bbox.x0 + grid.bbox.w / 2, grid.bbox.y0 + grid.bbox.h / 2, 0);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + grid.bbox.h * view.tile * view.yScale * 0.18,
    grid.bbox.w * view.tile * 0.55, grid.bbox.h * view.tile * view.yScale * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ridge / hip / valley creases as subtle strokes
function drawAccents(ctx, grid, view, cfg) {
  ctx.save();
  ctx.lineWidth = Math.max(1, view.tile * 0.06);
  for (const t of grid.tiles) {
    if (t.role === 'ridge' || t.role === 'peak') {
      const q = tileQuad(grid, view, t);
      ctx.strokeStyle = 'rgba(255,255,235,0.30)';
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(q[k].x, q[k].y);
      ctx.closePath(); ctx.stroke();
    } else if (t.role === 'valley') {
      const q = tileQuad(grid, view, t);
      ctx.strokeStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[2].x, q[2].y); ctx.stroke();
    }
  }
  ctx.restore();
}

// utilities shared with features/materials
export { corner, tileQuad, facetNormal, lightVec };
