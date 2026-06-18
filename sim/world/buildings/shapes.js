// sim/world/buildings/shapes.js — building-shape archetypes + size tiers (spec
// 2026-06-18 §5, plan S2.1). A thin layer ABOVE patterns.js: it never replaces the
// primitives — `realizeFootprintFromShape` delegates to `generatePattern` byte-for-byte
// for primitive archetypes, and builds the larger sprawling/interconnected compounds
// (twin-wing, double-court, campus, long-arcade) here as connected section-unions
// (rectangle blocks joined by 1-wide corridors). Pure + deterministic; cross-building
// bridges/tunnels are a district-level concern handled outside this per-building module.

import { rand, mix } from '../../kernel/rng.js';
import { generatePattern } from './patterns.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ── size tiers ───────────────────────────────────────────────────────────
// Bounding-box ranges, monotone non-decreasing small → medium → large.
export const SIZE_TIERS = ['small', 'medium', 'large'];
const TIER_BOUNDS = {
  small:  { minW: 6,  maxW: 10, minH: 6,  maxH: 10 },
  medium: { minW: 11, maxW: 18, minH: 10, maxH: 16 },
  large:  { minW: 19, maxW: 34, minH: 16, maxH: 28 },
};

export function boundsForSizeTier(sizeTier) {
  return TIER_BOUNDS[sizeTier] || TIER_BOUNDS.medium;
}

// ── archetype palette ─────────────────────────────────────────────────────
// kind:'primitive' → delegates to patterns.js (`pattern` is the generatePattern name).
// kind:'compound'  → built by a local section-union generator below.
const ARCHETYPES = {
  rect:        { kind: 'primitive', pattern: 'rect' },
  ell:         { kind: 'primitive', pattern: 'L' },
  tee:         { kind: 'primitive', pattern: 'T' },
  round:       { kind: 'primitive', pattern: 'round' },
  winged:      { kind: 'primitive', pattern: 'winged' },
  courtyard:   { kind: 'primitive', pattern: 'courtyard' },
  compound:    { kind: 'primitive', pattern: 'compound' },
  twinWing:    { kind: 'compound' },
  doubleCourt: { kind: 'compound' },
  campus:      { kind: 'compound' },
  longArcade:  { kind: 'compound' },
};

// Per-size palettes — bigger/central lots unlock the sprawling compounds. Order
// matters: later entries are the more complex shapes and are favoured as centrality rises.
const PALETTE = {
  small:  ['rect', 'rect', 'ell', 'tee', 'round'],
  medium: ['rect', 'ell', 'tee', 'round', 'winged', 'courtyard', 'compound'],
  large:  ['rect', 'ell', 'winged', 'courtyard', 'compound', 'twinWing', 'doubleCourt', 'campus', 'longArcade'],
};

const TIER_RANK = { hamlet: 0, village: 1, town: 2, city: 3, fortress: 3, world_capital: 4 };
const MAX_TIER_RANK = 4;

function tierFrac(tier) {
  if (typeof tier === 'number') return clamp01(tier);
  const r = TIER_RANK[tier];
  return r == null ? 0.5 : r / MAX_TIER_RANK;
}

function typeSalt(buildingType) {
  const s = typeof buildingType === 'string'
    ? buildingType
    : (buildingType && (buildingType.id || buildingType.typeId || buildingType.name)) || '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h & 0xffff;
}

function typeSizeBias(buildingType) {
  if (buildingType && typeof buildingType === 'object') {
    if (typeof buildingType.sizeBias === 'number') return clamp01(buildingType.sizeBias);
    if (typeof buildingType.maxW === 'number') return clamp01((buildingType.maxW - 4) / 24);
  }
  return 0.5;
}

function pickSizeTier(seed, sizeBias, tier, centrality) {
  const score = 0.40 * sizeBias
    + 0.30 * centrality
    + 0.20 * tierFrac(tier)
    + 0.10 * rand(seed, 0x7101);
  if (score < 0.42) return 'small';
  if (score < 0.70) return 'medium';
  return 'large';
}

function pickBounds(seed, sizeTier) {
  const b = boundsForSizeTier(sizeTier);
  const w = b.minW + Math.floor(rand(seed, 0x7201) * (b.maxW - b.minW + 1));
  const h = b.minH + Math.floor(rand(seed, 0x7202) * (b.maxH - b.minH + 1));
  return { w, h };
}

function pickArchetype(seed, sizeTier, centrality) {
  const palette = PALETTE[sizeTier] || PALETTE.medium;
  // Weight later (more complex) entries higher as centrality rises.
  const weights = palette.map((_, i) => 1 + centrality * (i / (palette.length - 1 || 1)) * 2);
  const total = weights.reduce((a, w) => a + w, 0);
  let r = rand(seed, 0x7301) * total;
  for (let i = 0; i < palette.length; i++) {
    r -= weights[i];
    if (r <= 0) return palette[i];
  }
  return palette[palette.length - 1];
}

/**
 * Resolve a building's shape from its identity + position.
 * @param {number} seed          deterministic seed
 * @param {string|object} buildingType  type id, or object carrying {sizeBias|maxW}
 * @param {string|number} tier   settlement tier name or rank fraction [0,1]
 * @param {number} centrality    [0,1] — distance-to-centre inverted (1 = downtown)
 * @returns {{archetype, kind, pattern:string|null, sizeTier, w, h}}
 */
export function resolveShape(seed, buildingType, tier, centrality) {
  const c = clamp01(centrality == null ? 0.5 : centrality);
  const salt = typeSalt(buildingType);
  const sizeTier = pickSizeTier(mix(seed, 0x7000 ^ salt), typeSizeBias(buildingType), tier, c);
  const { w, h } = pickBounds(mix(seed, 0x7100 ^ salt), sizeTier);
  const archetype = pickArchetype(mix(seed, 0x7300 ^ salt), sizeTier, c);
  const a = ARCHETYPES[archetype];
  return { archetype, kind: a.kind, pattern: a.pattern || null, sizeTier, w, h };
}

// ── compound generators (connected section-unions) ─────────────────────────

function twinWing(w, h, seed) {
  const barH = Math.max(2, Math.floor(h * (0.22 + rand(seed, 0x01) * 0.12)));
  const cx = Math.floor(w / 2);
  const midH = Math.max(1, h - 2 * barH);
  return { sections: [
    { x0: 0, y0: 0, w, h: barH },               // top wing
    { x0: 0, y0: h - barH, w, h: barH },         // bottom wing
    { x0: cx, y0: barH, w: 1, h: midH },         // connector corridor
  ] };
}

function doubleCourt(w, h, seed) {
  const wHalf = Math.max(5, Math.floor(w / 2));
  const left = generatePattern('courtyard', wHalf, h, seed).sections;
  const right = generatePattern('courtyard', w - wHalf, h, mix(seed, 0x99)).sections
    .map(s => ({ x0: s.x0 + wHalf, y0: s.y0, w: s.w, h: s.h }));
  return { sections: [...left, ...right] }; // two rings adjacent at the shared middle column
}

function campus(w, h, seed) {
  const gap = 1;
  const lw = Math.max(3, Math.floor((w - gap) / 2));
  const rw = Math.max(3, w - lw - gap);
  const th = Math.max(3, Math.floor((h - gap) / 2));
  const bh = Math.max(3, h - th - gap);
  const totW = lw + gap + rw, totH = th + gap + bh;
  return { sections: [
    { x0: 0, y0: 0, w: lw, h: th },                 // top-left block
    { x0: lw + gap, y0: 0, w: rw, h: th },          // top-right block
    { x0: 0, y0: th + gap, w: lw, h: bh },          // bottom-left block
    { x0: lw + gap, y0: th + gap, w: rw, h: bh },   // bottom-right block
    { x0: 0, y0: th, w: totW, h: gap },             // horizontal spine
    { x0: lw, y0: 0, w: gap, h: totH },             // vertical spine (forms a + linking all)
  ] };
}

function longArcade(w, h, seed) {
  const vertical = h >= w;
  const span = vertical ? h : w;        // along the spine
  const cross = vertical ? w : h;       // across it
  const spineW = 3;
  const cAxis = Math.floor((cross - spineW) / 2);
  const shopLen = Math.max(3, Math.floor(span / 4));
  const sections = [];
  // spine runs the full length
  sections.push(vertical
    ? { x0: cAxis, y0: 0, w: spineW, h: span }
    : { x0: 0, y0: cAxis, w: span, h: spineW });
  const sideA = cAxis;                  // width of the near side
  const sideB = cross - cAxis - spineW; // width of the far side
  for (let pos = 0; pos + shopLen <= span; pos += shopLen + 1) {
    if (sideA >= 2) sections.push(vertical
      ? { x0: 0, y0: pos, w: sideA, h: shopLen }
      : { x0: pos, y0: 0, w: shopLen, h: sideA });
    if (sideB >= 2) sections.push(vertical
      ? { x0: cAxis + spineW, y0: pos, w: sideB, h: shopLen }
      : { x0: pos, y0: cAxis + spineW, w: shopLen, h: sideB });
  }
  return { sections };
}

const COMPOUND = { twinWing, doubleCourt, campus, longArcade };

/**
 * Realize a shape descriptor into footprint sections. Primitive archetypes delegate
 * to `generatePattern` BYTE-FOR-BYTE (same seed) so existing behaviour is preserved;
 * compounds are built by the local generators above.
 * @returns {{ sections: Array<{x0,y0,w,h}> }}
 */
export function realizeFootprintFromShape(shape, seed) {
  if (shape.kind === 'primitive') {
    return generatePattern(shape.pattern, shape.w, shape.h, seed);
  }
  const gen = COMPOUND[shape.archetype];
  if (!gen) throw new Error(`unknown compound archetype: ${shape.archetype}`);
  return gen(shape.w, shape.h, seed);
}
