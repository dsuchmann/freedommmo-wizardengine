// sim/world/baseline.js — Node-side view of the renderer's deterministic placement pipeline.
// Reuses the LIVE placement code (spec §5.1 world equation: baseline from seed) — never a copy.
import { classifyBiome } from '../../src/world/biomes.js';
import { f3Placements, f4Placements } from '../../src/world/decoration-claims.js';

export const placementKey = (field, wx, wy, i) => `${field}:${wx},${wy}:${i}`;

// tileInfo CALLBACK per decoration-claims.js:358 contract: (wx, wy) → { biome, transition } | null.
// transition: false everywhere — declared decision (plan doc, Task 1 preamble).
const tileInfo = (wx, wy) => ({ biome: classifyBiome(wx, wy).id, transition: false });

/** All wired placements on one tile, normalized: {key, field, archetype, biome, variant, x, y, raw}.
 *  x/y are world-tile coordinates: tile + ux/uy, which are TILE UNITS in [0,1]. */
export function tilePlacements(wx, wy) {
  const out = [];
  f3Placements(wx, wy, tileInfo).forEach((p, i) => out.push(norm('f3', wx, wy, i, p)));
  f4Placements(wx, wy, tileInfo).forEach((p, i) => out.push(norm('f4', wx, wy, i, p)));
  return out;
}

function norm(field, wx, wy, i, p) {
  return {
    key: placementKey(field, wx, wy, i),
    field, archetype: p.name, biome: p.biome, variant: p.variant ?? 0,
    x: wx + (p.ux ?? 0.5), y: wy + (p.uy ?? 0.5),
    raw: p,
  };
}
