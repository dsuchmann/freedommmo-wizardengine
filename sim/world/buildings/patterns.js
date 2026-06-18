// sim/world/buildings/patterns.js — World Compiler Phase A: footprint pattern generators.
// Pure, deterministic shape generators that produce sections from a bounding w×h
// and a seed.  Each section is { x0, y0, w, h } relative to origin (0, 0).
// No kernel state, no side effects.

import { rand, mix } from '../../kernel/rng.js';

// ── individual pattern generators ─────────────────────────────────────

function patternRect(w, h, _seed) {
  return { sections: [{ x0: 0, y0: 0, w, h }] };
}

function patternL(w, h, seed) {
  // Two rectangles forming an L.  Seed picks which of 4 corners is cut.
  const corner = Math.floor(rand(seed, 0xAA01) * 4); // 0=TR,1=TL,2=BR,3=BL
  const cutW = Math.max(1, Math.floor(w * (0.3 + rand(seed, 0xAA02) * 0.3)));
  const cutH = Math.max(1, Math.floor(h * (0.3 + rand(seed, 0xAA03) * 0.3)));
  const mainW = w - cutW;
  const mainH = h - cutH;

  let a, b;
  switch (corner) {
    case 0: // cut top-right → bottom bar + left column top
      a = { x0: 0, y0: cutH, w, h: mainH };           // full bottom bar
      b = { x0: 0, y0: 0, w: mainW, h: cutH };        // left top stub
      break;
    case 1: // cut top-left → bottom bar + right column top
      a = { x0: 0, y0: cutH, w, h: mainH };
      b = { x0: cutW, y0: 0, w: mainW, h: cutH };
      break;
    case 2: // cut bottom-right → top bar + left column bottom
      a = { x0: 0, y0: 0, w, h: mainH };
      b = { x0: 0, y0: mainH, w: mainW, h: cutH };
      break;
    case 3: // cut bottom-left → top bar + right column bottom
      a = { x0: 0, y0: 0, w, h: mainH };
      b = { x0: cutW, y0: mainH, w: mainW, h: cutH };
      break;
  }
  return { sections: [a, b] };
}

function patternT(w, h, seed) {
  // Horizontal bar + vertical stem.  Seed picks stem position.
  const barH = Math.max(1, Math.floor(h * (0.3 + rand(seed, 0xBB01) * 0.2)));
  const stemW = Math.max(2, Math.floor(w * (0.3 + rand(seed, 0xBB02) * 0.2)));
  const stemPos = Math.floor((w - stemW) * rand(seed, 0xBB03));
  // bar on top, stem hangs down
  const flip = rand(seed, 0xBB04) < 0.5;
  if (flip) {
    // bar on bottom
    return { sections: [
      { x0: 0, y0: h - barH, w, h: barH },                          // bottom bar
      { x0: stemPos, y0: 0, w: stemW, h: h - barH },                // stem up
    ]};
  }
  return { sections: [
    { x0: 0, y0: 0, w, h: barH },                                    // top bar
    { x0: stemPos, y0: barH, w: stemW, h: h - barH },                // stem down
  ]};
}

function patternCourtyard(w, h, seed) {
  // Four walls of a hollow rectangle.  Thickness is seeded, but >= 3 so the
  // encircling band is a believable hallway (>= 1 interior tile, not a 1-tile sliver).
  const thick = Math.max(3, Math.floor(Math.min(w, h) * (0.2 + rand(seed, 0xCC01) * 0.15)));
  const innerW = w - 2 * thick;
  const innerH = h - 2 * thick;
  if (innerW < 1 || innerH < 1) {
    // too small for courtyard → fall back to rect
    return patternRect(w, h, seed);
  }
  return { sections: [
    { x0: 0,           y0: 0,           w,     h: thick },          // top wall
    { x0: 0,           y0: h - thick,   w,     h: thick },          // bottom wall
    { x0: 0,           y0: thick,       w: thick, h: innerH },      // left wall
    { x0: w - thick,   y0: thick,       w: thick, h: innerH },      // right wall
  ]};
}

function patternWinged(w, h, seed) {
  // Center body + 2 side wings.
  const bodyW = Math.max(2, Math.floor(w * (0.3 + rand(seed, 0xDD01) * 0.2)));
  const bodyX = Math.floor((w - bodyW) / 2);
  const wingH = Math.max(2, Math.floor(h * (0.4 + rand(seed, 0xDD02) * 0.2)));
  const wingY = Math.floor((h - wingH) * rand(seed, 0xDD03));
  const leftW = bodyX;
  const rightW = w - bodyX - bodyW;
  const sections = [
    { x0: bodyX, y0: 0, w: bodyW, h },                              // center body
  ];
  if (leftW > 0) sections.push({ x0: 0, y0: wingY, w: leftW, h: wingH });
  if (rightW > 0) sections.push({ x0: bodyX + bodyW, y0: wingY, w: rightW, h: wingH });
  return { sections };
}

function patternRound(w, h, seed) {
  // 3 horizontal slices approximating an ellipse.
  const topH = Math.max(1, Math.floor(h * (0.2 + rand(seed, 0xEE01) * 0.1)));
  const botH = Math.max(1, Math.floor(h * (0.2 + rand(seed, 0xEE02) * 0.1)));
  const midH = h - topH - botH;
  if (midH < 1) return patternRect(w, h, seed);
  const inset = Math.max(1, Math.floor(w * (0.15 + rand(seed, 0xEE03) * 0.15)));
  const topW = Math.max(1, w - 2 * inset);
  const botW = Math.max(1, w - 2 * inset);
  return { sections: [
    { x0: inset, y0: 0, w: topW, h: topH },                        // narrow top
    { x0: 0, y0: topH, w, h: midH },                                // full middle
    { x0: inset, y0: topH + midH, w: botW, h: botH },              // narrow bottom
  ]};
}

function patternCompound(w, h, seed) {
  // 2-3 rectangular buildings connected by 1-wide corridors.
  const numBuildings = 2 + (rand(seed, 0xFF01) < 0.5 ? 1 : 0);
  const sections = [];
  if (numBuildings === 2) {
    const bw1 = Math.max(2, Math.floor(w * (0.35 + rand(seed, 0xFF02) * 0.15)));
    const bw2 = Math.max(2, Math.floor(w * (0.35 + rand(seed, 0xFF03) * 0.15)));
    const gap = Math.max(1, w - bw1 - bw2);
    const corridorY = Math.floor(h * (0.3 + rand(seed, 0xFF04) * 0.4));
    sections.push(
      { x0: 0, y0: 0, w: bw1, h },                                 // left building
      { x0: w - bw2, y0: 0, w: bw2, h },                            // right building
      { x0: bw1, y0: corridorY, w: gap, h: 1 },                     // corridor
    );
  } else {
    const bw = Math.max(2, Math.floor(w * (0.25 + rand(seed, 0xFF05) * 0.1)));
    const bh = Math.max(2, Math.floor(h * (0.35 + rand(seed, 0xFF06) * 0.15)));
    const cx = Math.floor((w - bw) / 2);
    // three buildings: left, right, bottom-center, connected by corridors
    const leftW = Math.max(2, cx);
    const rightW = Math.max(2, w - cx - bw);
    sections.push(
      { x0: 0, y0: 0, w: leftW, h: bh },                           // left
      { x0: cx + bw, y0: 0, w: rightW, h: bh },                    // right
      { x0: cx, y0: h - bh, w: bw, h: bh },                        // bottom
      { x0: leftW, y0: Math.floor(bh / 2), w: cx - leftW + bw, h: 1 }, // top corridor
      { x0: cx, y0: bh, w: 1, h: h - 2 * bh },                     // vertical corridor
    );
  }
  return { sections };
}

// ── dispatcher ────────────────────────────────────────────────────────

const GENERATORS = {
  rect:      patternRect,
  L:         patternL,
  T:         patternT,
  courtyard: patternCourtyard,
  winged:    patternWinged,
  round:     patternRound,
  compound:  patternCompound,
};

/**
 * Generate a footprint pattern.
 * @param {string} patternName  One of: rect, L, T, courtyard, winged, round, compound
 * @param {number} w            Width of bounding box
 * @param {number} h            Height of bounding box
 * @param {number} seed         Deterministic seed
 * @returns {{ sections: Array<{x0:number,y0:number,w:number,h:number}> }}
 */
export function generatePattern(patternName, w, h, seed) {
  const gen = GENERATORS[patternName];
  if (!gen) throw new Error(`unknown pattern: ${patternName}`);
  return gen(w, h, seed);
}
