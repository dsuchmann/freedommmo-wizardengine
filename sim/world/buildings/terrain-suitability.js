// Pure, cached terrain-suitability checks for building placement. Shared by the settlement
// LAYOUT (placement-time avoidance) and the RESOLVED building set (filter + relocation), so a
// site judged buildable by layout is never re-judged unbuildable downstream — and both pay the
// expensive terrain classifiers only once per tile.
import { classifyBiomeNoStream } from '../../../src/world/biomes.js';
import { classifyTerrainForm } from '../../../src/world/terrain-forms.js';

// Basin water rejects a building site. 'stream' (the 1-wide additive hydrology channel) is
// intentionally NOT here: placement uses the stream-free classifier, so a building may clip a
// creek (it just covers it) — same policy as settlement discovery, and it keeps the cold
// streamAt() neighbourhood trace out of the per-building water test.
export const WATER = new Set(['ocean', 'deep_ocean', 'lake', 'river', 'shallow_water']);
export const CLAIM_MARGIN = 2;   // footprint margin (flora suppression; matches building-renderer)
export const NORTH_CLAIM = 8;    // north band the wall+roof lift into

// Terrain is a pure, immutable function of (x,y), but the classifiers are expensive and these
// checks re-sample the same tiles many times (esp. relocation). Cache per-tile verdicts in
// bounded persistent maps — deterministic (same input → same verdict) and safe across resolves
// (terrain never changes). This is what makes placement + relocation affordable.
const _waterTileCache = new Map();
export function isWaterTile(px, py) {
  const k = px + ',' + py;
  let v = _waterTileCache.get(k);
  if (v === undefined) {
    v = WATER.has(classifyBiomeNoStream(px, py).id);
    if (_waterTileCache.size < 400000) _waterTileCache.set(k, v);
  }
  return v;
}
const _formTileCache = new Map();
export function tileForm(px, py) {
  const k = px + ',' + py;
  let v = _formTileCache.get(k);
  if (v === undefined) {
    const tf = classifyTerrainForm(px, py);
    v = { form: tf.form, level: tf.plateauLevel };
    if (_formTileCache.size < 400000) _formTileCache.set(k, v);
  }
  return v;
}

// Does a building's footprint (5 sample points: 4 corners + center) touch basin water?
export function buildingTouchesWater(b) {
  const bb = b.footprint.boundingBox;
  const pts = [
    [b.x, b.y], [b.x + bb.w - 1, b.y],
    [b.x, b.y + bb.h - 1], [b.x + bb.w - 1, b.y + bb.h - 1],
    [b.x + Math.floor(bb.w / 2), b.y + Math.floor(bb.h / 2)],
  ];
  return pts.some(([px, py]) => isWaterTile(px, py));
}

// Does the footprint (perimeter + north claim band) cross a cliff/step or a plateau-level change?
export function buildingSpansCliff(b) {
  const bb = b.footprint.boundingBox;
  const y0 = b.y - NORTH_CLAIM;
  const y1 = b.y + bb.h + CLAIM_MARGIN - 1;
  const x0 = b.x - CLAIM_MARGIN;
  const x1 = b.x + bb.w + CLAIM_MARGIN - 1;
  const pts = [
    [x0, y0], [x1, y0], [x0, y1], [x1, y1],
    [Math.floor((x0 + x1) / 2), y0], [Math.floor((x0 + x1) / 2), y1],
    [x0, Math.floor((y0 + y1) / 2)], [x1, Math.floor((y0 + y1) / 2)],
    [Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)],
    [b.x, b.y],
  ];
  const originLevel = tileForm(b.x, b.y).level;
  for (const [px, py] of pts) {
    const tf = tileForm(px, py);
    if (tf.form === 'cliff' || tf.form === 'step') return true;
    if (tf.level !== originLevel) return true;
  }
  return false;
}

// Convenience for layout: is a footprint at (wx,wy) on a buildable site (not water, not a cliff)?
export function siteBuildable(wx, wy, footprint) {
  const b = { x: wx, y: wy, footprint };
  return !buildingTouchesWater(b) && !buildingSpansCliff(b);
}
