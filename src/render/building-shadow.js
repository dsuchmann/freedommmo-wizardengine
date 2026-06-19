// src/render/building-shadow.js — main-thread building GROUND shadows.
//
// Buildings cast a shadow on the ground, projected AWAY from the sun, with a length that
// grows with the building's height (aboveGroundFloors) and with how low the sun sits. The
// shape is the building footprint SWEPT in the shadow direction — i.e. the convex hull of
// {footprint corners} ∪ {footprint corners + projection vector} — filled once.
//
// Style matches the existing 2D object (tree) shadows in large-object-renderer.js:325 — a flat
// '#2a2e2b' fill at alpha 0.18, faded by day-night (sun.ambient) so shadows vanish at night.
// All building hulls go into ONE path and fill ONCE with nonzero winding, so overlapping
// neighbour shadows MERGE instead of double-darkening at their seams.
//
// Self-contained + worker-free on purpose: the chunk-bake worker is owned by another agent and
// is being edited live; this rides entirely on the 2D ctx after roofs (canvas-renderer.js:352),
// before the player/F2 sprites, so the player stands ON the shadow and tall walls occlude nothing.
//
// Phase 2 (drape onto neighbour walls — "drench a surface at a different height") builds on the
// SAME building set + sun vector and is layered on top later; this file is phase 1 (ground).

import { WALL_CONFIG } from './wall-config.js';

// Per-story height in tiles — matches the exterior wall stack (WALL_CONFIG.wallHeight = 4).
export const STORY_TILES = 4;
// Tree-shadow style (large-object-renderer.js:325-326): RGB 42,46,43 at 0.18 opacity.
export const SHADOW_TINT = '#2a2e2b';
export const BASE_ALPHA = 0.18;
// Clamp so a tall building at dusk (floors*3.75) can't sprawl a shadow across the whole town.
export const MAX_LENGTH_TILES = 16;
// Ground-shadow length multiplier, calibrated visually in tools/shadow-gallery.html (2026-06-19).
// window._buildingShadowScale overrides this at runtime.
export const DEFAULT_SCALE = 1.49;
// Above this floor count the building reads as a tower; floors are capped to keep length sane.
const MAX_FLOORS = 12;

/**
 * Andrew's monotone-chain convex hull. Pure. Input/Output: [{x,y},...].
 * Returns the hull in CCW order (consistent winding so merged fills never cancel).
 */
export function convexHull(pts) {
  const P = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const n = P.length;
  if (n < 3) return P;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (let i = 0; i < n; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], P[i]) <= 0) lower.pop();
    lower.push(P[i]);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], P[i]) <= 0) upper.pop();
    upper.push(P[i]);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Effective ground-length multiplier: the window override if valid (>0), else DEFAULT_SCALE. */
export function resolveScale(v) {
  const n = +v;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SCALE;
}

/** Above-ground floor count for a building (defensive — the lazy node/payload may be absent). */
export function buildingFloors(b) {
  try {
    const agf = b && b.footprint && b.footprint.node && b.footprint.node.payload
      && b.footprint.node.payload.aboveGroundFloors;
    if (agf && agf > 0) return Math.min(agf | 0, MAX_FLOORS);
  } catch (e) { /* honest absence -> single story */ }
  return 1;
}

/**
 * Screen-space shadow vector (projX, projY in px) and its length in tiles.
 * Direction = normalize(sun.shadowX, sun.shadowY) so the (unnormalized) signed sun fields set
 * only the ANGLE; length is driven separately by floors and the sun's shadowLength (low-sun stretch).
 *   lengthTiles = floors * shadowLength * scale, clamped to MAX_LENGTH_TILES.
 */
export function shadowProjection(sun, floors, tilePx, scale) {
  let ux = sun.shadowX, uy = sun.shadowY;
  const mag = Math.hypot(ux, uy) || 1;
  ux /= mag; uy /= mag;
  let lengthTiles = floors * sun.shadowLength * (scale || 1);
  if (lengthTiles > MAX_LENGTH_TILES) lengthTiles = MAX_LENGTH_TILES;
  const reach = lengthTiles * tilePx;
  return { projX: ux * reach, projY: uy * reach, lengthTiles };
}

/**
 * Screen-space convex-hull polygon of a building's cast ground shadow.
 * Footprint = boundingBox rectangle (phase 1); corners projected by the shadow vector and hulled.
 */
export function buildingShadowHull(b, sun, tilePx, camX, camY, scale) {
  const bb = b.footprint.boundingBox;
  const { projX, projY } = shadowProjection(sun, buildingFloors(b), tilePx, scale);
  const base = [
    [b.x, b.y], [b.x + bb.w, b.y], [b.x + bb.w, b.y + bb.h], [b.x, b.y + bb.h],
  ].map(([wx, wy]) => ({ x: wx * tilePx - camX, y: wy * tilePx - camY }));
  const pts = [];
  for (const c of base) { pts.push(c); pts.push({ x: c.x + projX, y: c.y + projY }); }
  return convexHull(pts);
}

// ── Phase 2: drape onto neighbour façades ─────────────────────────────
// When a building's ground shadow reaches a NEIGHBOUR building, the shadow shouldn't lie flat
// over its roof — it should climb the neighbour's visible south façade ("drench the surface at
// a different height"). The façade is the worker-baked south-wall stack; its screen geometry is
// derived from the SHARED WALL_CONFIG (wallHeight/wallYOffset) — the exact constants the worker
// uses (worker-chunk-renderer.js:1352-1469) — so this aligns by construction, not by copying it.

function floorSetOf(fp) {
  const s = new Set();
  for (const sec of fp.sections)
    for (let dy = 0; dy < sec.h; dy++)
      for (let dx = 0; dx < sec.w; dx++)
        s.add((sec.x0 + dx) + ',' + (sec.y0 + dy));
  return s;
}

/**
 * South-facing exterior façade columns, mirroring the worker's south-wall stack condition
 * (a column exists where the tile's south neighbour is OUTSIDE the footprint). Each entry:
 *   { wx: world tile x, baseWorldY: world y of the façade base = section bottom row + 1 }.
 */
export function southFacadeColumns(b) {
  const fp = b.footprint;
  if (!fp || !fp.sections) return [];
  const fs = floorSetOf(fp);
  const cols = [];
  for (const sec of fp.sections) {
    const lastRow = sec.y0 + sec.h - 1;
    const baseWorldY = b.y + sec.y0 + sec.h;
    for (let dx = 0; dx < sec.w; dx++) {
      const lx = sec.x0 + dx;
      if (fs.has(lx + ',' + (lastRow + 1))) continue; // south neighbour inside — no exterior wall here
      cols.push({ wx: b.x + lx, baseWorldY });
    }
  }
  return cols;
}

/**
 * Screen rect {x,y,w,h} of a south-façade column's stacked wall, matching the worker bake:
 * bottom edge at base*tilePx - camY + tilePx*wallYOffset, height = stories * tilePx * wallHeight.
 */
export function facadeRect(baseWorldY, wx, stories, tilePx, camX, camY) {
  const wHpx = tilePx * WALL_CONFIG.wallHeight;
  const yOff = tilePx * WALL_CONFIG.wallYOffset;
  const height = stories * wHpx;
  const yBottom = baseWorldY * tilePx - camY + yOff;
  return { x: wx * tilePx - camX, y: yBottom - height, w: tilePx, h: height };
}

/** Point-in-convex-polygon (winding-agnostic): inside if px,py is on one consistent side of every edge. */
export function pointInHull(px, py, hull) {
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
  }
  return true;
}

/** Per-building shadow hulls + screen bbox, computed once per frame. */
export function computeHulls(buildings, sun, tilePx, camX, camY, scale) {
  const out = [];
  for (const b of buildings) {
    if (!b || !b.footprint || !b.footprint.boundingBox) continue;
    const hull = buildingShadowHull(b, sun, tilePx, camX, camY, scale);
    if (hull.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of hull) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    out.push({ b, hull, bbox: { minX, minY, maxX, maxY } });
  }
  return out;
}

/**
 * Façade rects to darken: for every building, each south-façade column whose base sits inside
 * ANOTHER building's ground-shadow hull gets its full stacked wall drenched. Pure.
 */
export function drapeRects(buildings, hulls, tilePx, camX, camY) {
  const rects = [];
  for (const B of buildings) {
    if (!B || !B.footprint || !B.footprint.sections) continue;
    const stories = buildingFloors(B);
    for (const col of southFacadeColumns(B)) {
      // test the last interior tile centre of the column (the foot of the wall, on the ground)
      const tx = (col.wx + 0.5) * tilePx - camX;
      const ty = (col.baseWorldY - 0.5) * tilePx - camY;
      let drench = false;
      for (const c of hulls) {
        if (c.b === B) continue; // a building never drenches its own wall
        const bb = c.bbox;
        if (tx < bb.minX || tx > bb.maxX || ty < bb.minY || ty > bb.maxY) continue;
        if (pointInHull(tx, ty, c.hull)) { drench = true; break; }
      }
      if (drench) rects.push(facadeRect(col.baseWorldY, col.wx, stories, tilePx, camX, camY));
    }
  }
  return rects;
}

/** Screen rects of every building's actual footprint tiles (sections) — the area a shadow must
 *  NOT cover (it's under the building). Used to clip the ground-shadow fill. Pure. */
export function footprintRects(buildings, tilePx, camX, camY) {
  const rects = [];
  for (const b of buildings) {
    if (!b || !b.footprint || !b.footprint.sections) continue;
    for (const sec of b.footprint.sections) {
      rects.push({
        x: (b.x + sec.x0) * tilePx - camX, y: (b.y + sec.y0) * tilePx - camY,
        w: sec.w * tilePx, h: sec.h * tilePx,
      });
    }
  }
  return rects;
}

function fillPolys(ctx, polys) {
  ctx.beginPath();
  for (const poly of polys) {
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
  }
  ctx.fill(); // nonzero winding — overlapping regions merge at one alpha (no double-darkening)
}

/**
 * Draw building shadows. Call AFTER terrain/water/roofs and BEFORE the player/F2 sprites
 * (canvas-renderer.js, just after drawRoofs). Best-effort: never throws.
 *
 * Phase 1 = ground shadows: each building's footprint swept away from the sun. Only the WAKE
 * shows — the fill is clipped to EXCLUDE every building's footprint, so no shadow lies "under"
 * a building (a shadow that reaches a building is left to phase 2 to climb its wall instead).
 * Phase 2 = drape: where a shadow reaches a neighbour, it climbs that neighbour's south façade
 * (drawn UNCLIPPED, since it intentionally darkens the wall over the footprint).
 *
 * Debug toggles: window._buildingShadows=false hides all; window._buildingShadowDrape=false
 * disables only the façade drape (phase 2); window._buildingShadowScale tunes ground length.
 */
export function drawBuildingShadows(ctx, buildings, camX, camY, tilePx, w, h, sun) {
  if (!sun || !sun.isDaytime || !buildings || !buildings.length) return;
  if (typeof window !== 'undefined' && window._buildingShadows === false) return;
  const scale = resolveScale(typeof window !== 'undefined' ? window._buildingShadowScale : undefined);
  const drapeOn = !(typeof window !== 'undefined' && window._buildingShadowDrape === false);
  const dayNight = sun.ambient != null ? sun.ambient : 1;
  const alpha = BASE_ALPHA * dayNight;
  if (alpha < 0.01) return; // deep night — nothing to draw

  const hulls = computeHulls(buildings, sun, tilePx, camX, camY, scale);
  if (!hulls.length) return;

  const groundPolys = [];
  for (const c of hulls) {
    const bb = c.bbox;
    if (bb.maxX < 0 || bb.maxY < 0 || bb.minX > w || bb.minY > h) continue; // off-screen
    groundPolys.push(c.hull);
  }
  const drapePolys = [];
  if (drapeOn) {
    for (const r of drapeRects(buildings, hulls, tilePx, camX, camY)) {
      if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > w || r.y > h) continue;
      drapePolys.push(convexHull([
        { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
      ]));
    }
  }
  if (!groundPolys.length && !drapePolys.length) return;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SHADOW_TINT;

  // Ground shadows — clipped to (screen MINUS every footprint) so a building's own shadow (and a
  // neighbour's) never paints over the building itself. Only the wake, away from the light, shows.
  if (groundPolys.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    for (const fr of footprintRects(buildings, tilePx, camX, camY)) ctx.rect(fr.x, fr.y, fr.w, fr.h);
    ctx.clip('evenodd'); // even-odd: screen(1) with each footprint(+1) → footprints excluded
    fillPolys(ctx, groundPolys);
    ctx.restore(); // drop the footprint clip
  }

  // Drape — the shadow climbing a neighbour's façade. NOT clipped: the façade sits over the
  // footprint screen area on purpose (that IS the wall we want drenched).
  if (drapePolys.length) fillPolys(ctx, drapePolys);

  ctx.restore();
}
