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
  // FRACTIONAL EAVE OVERHANG: the geometry generates a full 1-tile DROOPING overhang ring (the eave tiles hang
  // BELOW the wall-top plane — that droop is what gives the roof its 3-D eave edge). Here we COMPRESS that
  // ring's outward reach to `overhangTiles` of a tile, leaving the FOOTPRINT untouched. So the eave keeps its
  // drooped dimension but only juts out a fraction of a tile, and the pitch is preserved (widening the
  // footprint would flatten the roof). Only vertices OUTSIDE the footprint bbox move; interior ones don't.
  const oh = opts.overhangTiles ?? 0;
  const fpX0 = opts.fpX0, fpX1 = opts.fpX1, fpY0 = opts.fpY0, fpY1 = opts.fpY1;
  const squeeze = (v, lo, hi) => {
    if (!(oh > 0) || lo == null) return v;
    if (v < lo) return lo - (lo - v) * oh;   // overhang beyond the low edge → pulled in to `oh` of its reach
    if (v > hi) return hi + (v - hi) * oh;    // overhang beyond the high edge
    return v;                                  // inside the footprint → unchanged (true pitch preserved)
  };
  // UNIFORM lift: every eave sits on its wall top (north AND south walls are both the
  // tall 4-tile sprite), so the roof never terminates short of the north wall. The
  // roof not extending past the north edge is handled by CAPPING the roof height to
  // the building depth (see roof-ingame.js), so the ridge can't rise north of the eave.
  return {
    tile: tilePx, yScale: 1, hScale, game: true,
    project(gx, gy, hh) {
      const ex = squeeze(gx, fpX0, fpX1);
      const ey = squeeze(gy, fpY0, fpY1);
      return {
        x: (originWx + ex) * tilePx - camX,
        y: (originWy + ey) * tilePx - camY - wallLift - hh * hScale,
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

// PER-FACET texture frame (Problem B). A tile's quad is always [TL,TR,BR,BL] with
// TL=(i,j); so the grid-+x edge is q[1]-q[0] and the grid-+y edge is q[3]-q[0]. The
// texture must flow DOWN the facet's actual slope: courses run along that facet's eave
// (the u axis) and the texture flows down-slope (the v axis, eave->ridge). For a N/S
// facet down-slope is the grid-Y axis (v = grid-Y edge, u = grid-X edge); for an E/W
// facet down-slope is the grid-X axis, so the frame ROTATES (v = grid-X edge, u =
// grid-Y edge). Returns the projection-space origin + the u/v edge vectors so the
// affine maps the texture onto the facet in its OWN orientation, not a single global one.
export function slopeFrame(t, q) {
  const ex = { x: q[1].x - q[0].x, y: q[1].y - q[0].y }; // grid-+x quad edge
  const ey = { x: q[3].x - q[0].x, y: q[3].y - q[0].y }; // grid-+y quad edge
  const dir = (t.dir && t.dir !== 'flat') ? t.dir : (t.slopeAxis && t.slopeAxis.dir) || 'n';
  // down-slope (v: eave at v=0 near the LOW edge, ridge at v=1 near the HIGH edge).
  // The eave (low) is on the DOWNHILL side; ridge (high) is uphill.
  // We return the origin at the EAVE corner and vEdge pointing toward the ridge.
  if (dir === 'e' || dir === 'w') {
    // slope runs along grid-X. eave is on the downhill x side.
    const vEdge = dir === 'e' ? { x: -ex.x, y: -ex.y } : { x: ex.x, y: ex.y }; // eave->ridge
    const origin = dir === 'e' ? { x: q[1].x, y: q[1].y } : { x: q[0].x, y: q[0].y };
    return { origin, uEdge: ey, vEdge };
  }
  // N/S facet: slope runs along grid-Y.
  const vEdge = dir === 's' ? { x: -ey.x, y: -ey.y } : { x: ey.x, y: ey.y };
  const origin = dir === 's' ? { x: q[3].x, y: q[3].y } : { x: q[0].x, y: q[0].y };
  return { origin, uEdge: ex, vEdge };
}

// How many ROOF TILES one full texture height spans along the slope, and one full
// texture width spans along the eave. Bigger => the authored course/brick pattern is
// SUBTLE (a gentle texture), not graph-paper: fewer, larger courses per slope. This is
// the main lever for Problem A "fewer lines, more structural". Tuned for the dense brick
// roof_top swatches; overridable via grid.params.texCourseTiles / texEaveTiles.
const TEX_COURSE_TILES = 3.0; // 1 texture height every ~3 roof tiles up the slope
const TEX_EAVE_TILES = 3.0;   // 1 texture width every ~3 roof tiles along the eave

// Texture-map a facet quad in the facet's OWN slope frame (Problem B): u runs along the
// facet's eave, v runs eave->ridge DOWN that facet's slope (rotated per facet via
// slopeFrame). Samples a COARSE window of the swatch (TEX_COURSE_TILES/TEX_EAVE_TILES)
// so the authored brick/course pattern reads as a subtle texture, not a dense grid; the
// window advances continuously by the tile's run/along index so courses flow unbroken
// across tile boundaries (no per-tile restart, no 2-tile half-crop seam).
function drawTexturedTile(ctx, q, tex, shade, t, opts) {
  const TW = tex.width || 32, TH = tex.height || 32;
  const courseTiles = (opts && opts.courseTiles) || TEX_COURSE_TILES;
  const eaveTiles = (opts && opts.eaveTiles) || TEX_EAVE_TILES;
  const fr = slopeFrame(t, q);
  const dir = (t.dir && t.dir !== 'flat') ? t.dir : (t.slopeAxis && t.slopeAxis.dir) || 'n';
  // v: eave->ridge run, in texture-heights. run advances per tile up the slope; dividing
  // by courseTiles stretches the swatch over several tiles so courses are sparse.
  const run = (t.slopeAxis && t.slopeAxis.run) || 0;
  const v0 = run / courseTiles, v1 = (run + 1) / courseTiles;
  // u: along-eave index in texture-widths, continuous (no half-crop). Use the grid coord
  // perpendicular to the slope so the swatch tiles seamlessly along the eave.
  const along = (dir === 'n' || dir === 's') ? (t.gx | 0) : (t.gy | 0);
  const u0 = along / eaveTiles, u1 = (along + 1) / eaveTiles;
  // source rect (wrap into the swatch; eave-at-bottom => flip v).
  const sx = ((u0 % 1) + 1) % 1 * TW, sw = (u1 - u0) * TW;
  const sy1 = (1 - ((v0 % 1) + 1) % 1) * TH; // bottom (eave)
  const sh = (v1 - v0) * TH;                 // band height (signed up the swatch)
  const sy = sy1 - sh;
  // The frame's affine maps a unit (u,v) square -> the facet, oriented per facet.
  // origin is the EAVE corner; uEdge along the eave; vEdge eave->ridge.
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.transform(fr.uEdge.x, fr.uEdge.y, fr.vEdge.x, fr.vEdge.y, fr.origin.x, fr.origin.y);
  // we sample a sub-window [sx,sy,sw,sh] of the swatch but draw it into the unit square
  // [0..1]x[0..1] of the frame; drawImage's dest is the unit square so divide nothing.
  try { ctx.drawImage(tex, sx, sy, sw, sh, 0, 0, 1, 1); } catch (e) { /* bad bitmap */ }
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
    if (t.isOverhang || t.role === 'eave') drawSkirt(ctx, grid, view, t, material, cfg);
  }

  // Texture sampling knobs (Problem A): how many roof tiles one swatch spans + how much
  // base-colour wash mutes the dense brick/course pattern into a subtle texture. Pulled
  // from cfg so the in-game bridge / preview can tune without touching the renderer.
  const texOpts = { courseTiles: cfg.texCourseTiles, eaveTiles: cfg.texEaveTiles };
  // _roofTexWash: live knob for surface texture contrast — higher = more base-colour wash =
  // the dense authored brick/course pattern is muted into a subtler texture. Read defensively.
  const texWash = roofKnob('_roofTexWash', cfg.texWash ?? 0.42);

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
      drawTexturedTile(ctx, quad, cfg.texture, shade, t, texOpts);
      // CONTRAST WASH (Problem A): the authored roof_top swatches are dense brick/course
      // patterns with hard dark mortar lines; tiled across a roof they read as graph paper.
      // A semi-transparent base-colour wash mutes that hard grid into a subtle texture so
      // the only PROMINENT lines left are true structure (ridge/hip/valley/eave accents).
      if (base && texWash > 0) {
        ctx.save(); ctx.globalAlpha = texWash; ctx.fillStyle = base;
        ctx.beginPath(); ctx.moveTo(quad[0].x, quad[0].y);
        for (let kk = 1; kk < 4; kk++) ctx.lineTo(quad[kk].x, quad[kk].y);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    } else material.fillTile(ctx, quad, t, shade, view, grid);
  }

  if (!cfg.noAccents) {
    // Round-3 (A): accents are DARK SHADES OF THE ROOF'S OWN COLOUR (a shadowed crease in
    // the same-coloured tiles), not bright cream stripes. Derive that colour from whatever
    // is actually skinning the roof: the texture's average colour on the in-game texture
    // path, else this material's own base colour on the procedural (preview) path.
    let accentBase = null;
    if (cfg.texture) accentBase = parseRgb(sampledBaseColor(cfg.texture));
    if (!accentBase && material && material.baseColor) accentBase = material.baseColor();
    drawAccents(ctx, grid, view, cfg, accentBase);
  }
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
    // SOUTH + E/W rake ends bridge all the way down to the wall top (h=0) so the roof
    // terminates as a gable/rake board on the wall, not a flat cut. NORTH is excluded
    // by isGableRakeEdge (it would poke past the north wall). Where we don't bridge,
    // a thin eave fascia remains so the overhang still flares.
    const toWall = isGableRakeEdge(grid, t, d, view.game);
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
    const fasciaTex = cfg && cfg.roofFascia;
    if (fasciaTex) {
      // skin the eave/rake board with the authored roof_fascia.png, clipped to the skirt
      // quad, then dShade-darkened. Degrades to the procedural fasciaColor below if absent.
      ctx.save();
      ctx.clip();
      const minX = Math.min(top1.x, top2.x, bot1.x, bot2.x), maxX = Math.max(top1.x, top2.x, bot1.x, bot2.x);
      const minY = Math.min(top1.y, top2.y), maxY = Math.max(bot1.y, bot2.y);
      ctx.imageSmoothingEnabled = false;
      try {
        ctx.drawImage(fasciaTex, 0, 0, fasciaTex.width || 64, fasciaTex.height || 64,
          minX, minY, Math.max(1, maxX - minX), Math.max(1, maxY - minY));
      } catch (e) { /* bad bitmap */ }
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, (1 - dShade) * 1.1)})`;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = material.fasciaColor ? material.fasciaColor(dShade) : 'rgba(30,24,18,0.9)';
      ctx.fill();
    }
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

// STRUCTURAL EDGES — the only lines that should read as PROMINENT on a roof (live
// feedback A: "fewer lines, more structurally placed"). We walk adjacent roof-tile
// pairs and emit the SHARED grid edge wherever the two tiles face DIFFERENT slope
// directions — that boundary is a real ridge / hip / valley crease. Convex creases
// (the shared edge sits at/above both tile heights: a ridge or hip) read as a bright
// highlight line; concave ones (the edge dips below: a valley) read as a dark line.
// Returns grid-corner segments [{ax,ay,bx,by,kind}] in GRID COORDS (testable without a
// canvas); drawAccents projects + strokes them. This replaces the old per-ridge-tile
// full-quad outline that produced graph paper.
export function structuralEdges(grid) {
  const W = grid.W, H = grid.H;
  const out = [];
  // index tiles for O(1) lookup
  const byKey = new Map(grid.tiles.map(t => [t.i + ',' + t.j, t]));
  const at = (i, j) => byKey.get(i + ',' + j) || null;
  const hAt = (i, j) => { const t = at(i, j); return t ? t.h : null; };
  // axis: 'x' = vertical edge between (i,j)&(i+1,j); 'y' = horizontal edge between (i,j)&(i,j+1).
  const consider = (a, b, c1, c2, axis) => {
    if (!a || !b || a.dir === 'flat' || b.dir === 'flat') return;
    if (a.dir === b.dir) return;                 // same-facing tiles: no crease
    if (a.isOverhang || b.isOverhang) return;    // creases live on the roof body, not the eave lip
    // Convex (ridge/hip) vs concave (valley): probe the height profile across the edge.
    // The edge line height ~= max(a.h,b.h) at the seam; compare to the OUTER neighbours
    // one step further out on each side. If the seam tops both outer neighbours the
    // surface bulges UP (ridge/hip); if it sits below them it dips DOWN (valley).
    const seam = Math.max(a.h, b.h);
    let outerA, outerB;
    if (axis === 'x') { outerA = hAt(a.i - 1, a.j); outerB = hAt(b.i + 1, b.j); }
    else { outerA = hAt(a.i, a.j - 1); outerB = hAt(b.i, b.j + 1); }
    // missing outer neighbour (perimeter) => use the tile itself as the reference.
    const oA = outerA == null ? a.h : outerA, oB = outerB == null ? b.h : outerB;
    const convex = seam >= Math.max(oA, oB) - 1e-6;
    out.push({ ax: c1[0], ay: c1[1], bx: c2[0], by: c2[1], kind: convex ? 'crease' : 'valley' });
  };
  for (const t of grid.tiles) {
    if (t.isOverhang) continue;
    // EAST neighbour shares the vertical edge at x=i+1 (corners (i+1,j)-(i+1,j+1))
    consider(t, at(t.i + 1, t.j), [t.i + 1, t.j], [t.i + 1, t.j + 1], 'x');
    // SOUTH neighbour shares the horizontal edge at y=j+1 (corners (i,j+1)-(i+1,j+1))
    consider(t, at(t.i, t.j + 1), [t.i, t.j + 1], [t.i + 1, t.j + 1], 'y');
  }
  return out;
}

// parse 'rgb(r,g,b)' / '#rrggbb' -> {r,g,b}; null on failure.
function parseRgb(str) {
  if (!str) return null;
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(str);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  const h = /^#?([0-9a-f]{6})$/i.exec(str.trim());
  if (h) { const n = parseInt(h[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  return null;
}
// multiply an {r,g,b} toward black by `k` (0..1; 0.7 => 70% as bright = a shadow).
function darkenRgb(c, k) {
  return { r: Math.round(c.r * k), g: Math.round(c.g * k), b: Math.round(c.b * k) };
}

// Live console knobs (mirror window._foam*/_interior*). Read DEFENSIVELY each draw so the
// user can fine-tune by eye with no code change; fall back to the documented defaults.
// _roofAccentDark: how dark the crease (ridge/hip) is vs the roof colour (lower = darker).
// _roofAccentAlpha: accent stroke opacity.
const ROOF_ACCENT_DARK = 0.62;  // crease = 62% brightness of the roof colour (a soft fold)
const ROOF_ACCENT_ALPHA = 0.5;  // crease opacity
function roofKnob(name, fallback) {
  try {
    const g = (typeof window !== 'undefined') ? window
      : (typeof globalThis !== 'undefined') ? globalThis : null;
    if (g && typeof g[name] === 'number' && isFinite(g[name])) return g[name];
  } catch (e) { /* no window */ }
  return fallback;
}

// ridge / hip / valley creases as clean STRUCTURAL strokes (not per-tile outlines).
// Round-3 (A): the stroke is a DARK SHADE of `accentBase` (the roof's own colour), so a
// hip reads as a shadowed crease in same-coloured tiles — NOT a bright cream stripe.
// Convex (ridge/hip) = a subtle dark step; concave (valley) = darker still. Both dark.
function drawAccents(ctx, grid, view, cfg, accentBase) {
  const edges = structuralEdges(grid);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const lw = Math.max(1.2, view.tile * 0.12);
  const proj = (cx, cy) => view.project(grid.gox + cx, grid.goy + cy, grid.cornerH[cy * grid.CW + cx]);
  // accent colour from the roof's own base, darkened into a shadow. Knobs override live.
  const base = accentBase || { r: 60, g: 50, b: 40 }; // neutral dark fallback (never cream)
  const dark = roofKnob('_roofAccentDark', cfg.accentDark ?? ROOF_ACCENT_DARK);
  const alpha = roofKnob('_roofAccentAlpha', cfg.accentAlpha ?? ROOF_ACCENT_ALPHA);
  const creaseCol = darkenRgb(base, dark);          // ridge/hip: subtle dark step
  const valleyCol = darkenRgb(base, dark * 0.72);   // valley: a bit darker still
  // valleys first (deepest), then creases — both dark shades of the same roof colour.
  for (const pass of ['valley', 'crease']) {
    const c = pass === 'crease' ? creaseCol : valleyCol;
    ctx.lineWidth = pass === 'crease' ? lw : lw * 0.9;
    ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${pass === 'crease' ? alpha : Math.min(1, alpha * 1.15)})`;
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== pass) continue;
      const a = proj(e.ax, e.ay), b = proj(e.bx, e.by);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// utilities shared with features/materials
export { corner, tileQuad, facetNormal, lightVec, parseRgb, darkenRgb };
