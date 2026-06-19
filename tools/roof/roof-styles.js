// roof-styles.js — FORM/STYLE axis of the roof system.
//
// A "style" is purely a HEIGHT-FIELD transform over a footprint. The geometry
// module (roof-geometry.js) precomputes a set of per-tile METRICS (distance to
// the footprint edge, per-axis edge distances, radial distance from the section
// centroid, etc.) and hands them to a style function, which returns a height in
// tile units. Roles, slope normals and corner heights are then derived
// generically from the height field — so every style flows through the SAME
// geometry/render pipeline. This is the "one engine, many forms" separation.
//
// Each style function signature: (m, p) -> height
//   m = per-tile metrics (see roof-geometry.js buildMetrics)
//   p = resolved params for this roof (pitch, ridgeOrientation, clampHeight, …)
//
// Heights are in TILE units (1.0 == one tile of rise). The renderer scales them.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ─── individual style height fields ──────────────────────────────────────────

// Hip: classic — height grows with distance from ANY edge. On a rectangle this
// makes four sloped faces meeting at a ridge; on an L it grows valleys for free.
function hip(m, p) {
  return m.distEdge * p.pitch;
}

// Pyramidal: a single apex. Identical math to hip but intended for square/round
// footprints where the distance transform funnels to one point.
function pyramidal(m, p) {
  return m.distEdgeCheb * p.pitch;
}

// Gable: a single ridge line. Height depends only on distance to the two edges
// perpendicular to the ridge, so the other two ends are vertical gable walls.
function gable(m, p) {
  const d = p.ridgeOrientation === 'ns' ? m.dEdgeEW : m.dEdgeNS;
  return d * p.pitch;
}

// Cross-gabled: the higher of the two gable orientations — a '+' of ridges.
function crossGabled(m, p) {
  return Math.max(m.dEdgeNS, m.dEdgeEW) * p.pitch;
}

// Shed / lean-to: a single plane that slopes DOWN to the south (high back wall,
// low front eave) so it reads as a roof in the 3/4 top-down view instead of a
// giant south wall.
function shed(m, p) {
  return Math.max(0, (m.fpH - 1) - m.acrossNS) * p.pitch;
}

// Flat: a thin slab. Walkable. clampHeight sets the deck thickness.
function flat(m, p) {
  return p.clampHeight;
}

// Parapet: a flat deck with a raised lip around the perimeter (battlement base).
function parapet(m, p) {
  return m.distEdge <= 1 ? p.clampHeight + p.parapetRise : p.clampHeight;
}

// Mansard: steep lower slope near the eaves, shallow (near-flat) deck on top.
function mansard(m, p) {
  const knee = p.knee;
  const lower = Math.min(m.distEdge, knee) * p.pitch;
  const upper = Math.max(m.distEdge - knee, 0) * p.pitch * 0.25;
  return clamp(lower + upper, 0, p.capHeight);
}

// Gambrel: the gable-oriented cousin of mansard (barn roof).
function gambrel(m, p) {
  const d = p.ridgeOrientation === 'ns' ? m.dEdgeEW : m.dEdgeNS;
  const knee = p.knee;
  const lower = Math.min(d, knee) * p.pitch;
  const upper = Math.max(d - knee, 0) * p.pitch * 0.25;
  return clamp(lower + upper, 0, p.capHeight);
}

// Conical: a cone — height falls off linearly from the centroid. For round
// towers and spires. sharpness > 1 makes a needle spire.
function conical(m, p) {
  const r = m.maxRadial <= 0 ? 0 : 1 - m.radial / m.maxRadial;
  return Math.pow(clamp(r, 0, 1), 1 / p.sharpness) * m.maxRadial * p.pitch;
}

// Domed: a hemisphere — sqrt falloff from the centroid.
function domed(m, p) {
  const R = m.maxRadial;
  if (R <= 0) return 0;
  const r = Math.min(m.radial, R);
  return Math.sqrt(Math.max(0, R * R - r * r)) * p.pitch;
}

// Stepped / ziggurat: quantize the hip field into terraces (each walkable).
function stepped(m, p) {
  const step = Math.max(1, p.stepWidth);
  return Math.floor(m.distEdge / step) * p.stepRise;
}

// Sawtooth: repeated single-pitch slopes (north-light factory roof).
function sawtooth(m, p) {
  const w = Math.max(1, p.toothWidth);
  const t = m.acrossEW % w;
  return t * p.pitch;
}

// Butterfly: inverted gable — two slopes draining to a central valley.
function butterfly(m, p) {
  const d = p.ridgeOrientation === 'ns' ? m.dEdgeEW : m.dEdgeNS;
  const dMax = p.ridgeOrientation === 'ns' ? m.maxDEdgeEW : m.maxDEdgeNS;
  return (dMax - d) * p.pitch;
}

// Half-hip (jerkinhead): gable whose ends are clipped back into small hips.
function halfHip(m, p) {
  const g = gable(m, p);
  const h = hip(m, p);
  return Math.min(g, h + p.pitch * 1.5);
}

export const STYLES = {
  hip, pyramidal, gable, crossGabled, shed, flat, parapet,
  mansard, gambrel, conical, domed, stepped, sawtooth, butterfly, halfHip,
};

// Styles whose height is governed by radial distance from a single centroid,
// and so should be capped PER terminal section rather than over the whole
// footprint union (a spire belongs on one tower, not smeared across an L).
export const PER_SECTION_STYLES = new Set(['conical', 'domed', 'pyramidal']);

// Styles that produce a flat, walkable upper surface (deck / terrace / terraces).
export const WALKABLE_STYLES = new Set(['flat', 'parapet', 'stepped', 'mansard']);

// Default param ranges per style knob — the gallery turns these into sliders.
// (group, kind, min, max, step, default). Shared knobs live in PARAM_GROUPS.
export const STYLE_KNOBS = {
  pitch:           { group: 'shape', kind: 'range', min: 0.2, max: 2.2, step: 0.05, default: 0.9 },
  ridgeOrientation:{ group: 'shape', kind: 'enum', options: ['ew', 'ns'], default: 'ew' },
  clampHeight:     { group: 'style', kind: 'range', min: 0.2, max: 2.0, step: 0.1, default: 0.6 },
  parapetRise:     { group: 'style', kind: 'range', min: 0.0, max: 1.2, step: 0.05, default: 0.5 },
  knee:            { group: 'style', kind: 'range', min: 1, max: 6, step: 0.5, default: 2.5 },
  capHeight:       { group: 'style', kind: 'range', min: 1, max: 8, step: 0.5, default: 4 },
  sharpness:       { group: 'style', kind: 'range', min: 0.6, max: 4, step: 0.1, default: 1.4 },
  stepWidth:       { group: 'style', kind: 'range', min: 1, max: 4, step: 1, default: 2 },
  stepRise:        { group: 'style', kind: 'range', min: 0.3, max: 1.5, step: 0.1, default: 0.7 },
  toothWidth:      { group: 'style', kind: 'range', min: 2, max: 8, step: 1, default: 4 },
};

export function resolveStyleParams(overrides = {}) {
  const p = {};
  for (const [k, def] of Object.entries(STYLE_KNOBS)) p[k] = def.default;
  return Object.assign(p, overrides);
}
