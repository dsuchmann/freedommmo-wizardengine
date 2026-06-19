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

// Per-story height in tiles — matches the exterior wall stack (WALL_CONFIG.wallHeight = 4).
export const STORY_TILES = 4;
// Tree-shadow style (large-object-renderer.js:325-326): RGB 42,46,43 at 0.18 opacity.
export const SHADOW_TINT = '#2a2e2b';
export const BASE_ALPHA = 0.18;
// Clamp so a tall building at dusk (floors*3.75) can't sprawl a shadow across the whole town.
export const MAX_LENGTH_TILES = 16;
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

/**
 * Draw ground shadows for every building. Call AFTER terrain/water/roofs and BEFORE the
 * player/F2 sprites (canvas-renderer.js, just after drawRoofs). Best-effort: never throws.
 * Debug: window._buildingShadows = false to hide; window._buildingShadowScale to tune length.
 */
export function drawBuildingShadows(ctx, buildings, camX, camY, tilePx, w, h, sun) {
  if (!sun || !sun.isDaytime || !buildings || !buildings.length) return;
  if (typeof window !== 'undefined' && window._buildingShadows === false) return;
  const scale = (typeof window !== 'undefined' && +window._buildingShadowScale) || 1;
  const dayNight = sun.ambient != null ? sun.ambient : 1;
  const alpha = BASE_ALPHA * dayNight;
  if (alpha < 0.01) return; // deep night — nothing to draw

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SHADOW_TINT;
  ctx.beginPath();
  let any = false;
  for (const b of buildings) {
    if (!b || !b.footprint || !b.footprint.boundingBox) continue;
    const hull = buildingShadowHull(b, sun, tilePx, camX, camY, scale);
    if (hull.length < 3) continue;
    // cull hulls entirely off-screen
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of hull) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    if (maxX < 0 || maxY < 0 || minX > w || minY > h) continue;
    ctx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
    ctx.closePath();
    any = true;
  }
  // ONE fill (nonzero winding) — overlapping neighbour shadows merge at a single alpha.
  if (any) ctx.fill();
  ctx.restore();
}
