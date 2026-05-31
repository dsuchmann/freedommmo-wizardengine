import { rand2 } from '../core/random.js';

const RULES = Object.freeze({
  forest: [{ kind: 'tree', threshold: 0.955 }, { kind: 'shrub', threshold: 0.987 }],
  dense_forest: [{ kind: 'tree', threshold: 0.91 }, { kind: 'fallen_log', threshold: 0.985 }],
  grassland: [{ kind: 'flower', threshold: 0.982 }, { kind: 'grass_tuft', threshold: 0.955 }],
  beach: [{ kind: 'shell', threshold: 0.988 }, { kind: 'driftwood', threshold: 0.994 }],
  hills: [{ kind: 'rock', threshold: 0.965 }],
  mountains: [{ kind: 'rock', threshold: 0.94 }],
  volcanic: [{ kind: 'basalt_rock', threshold: 0.94 }],
  swamp: [{ kind: 'reed', threshold: 0.965 }, { kind: 'bog_log', threshold: 0.992 }],
  savanna: [{ kind: 'dry_shrub', threshold: 0.97 }],
  steppe: [{ kind: 'grass_tuft', threshold: 0.975 }],
  desert: [{ kind: 'cactus', threshold: 0.992 }],
  taiga: [{ kind: 'tree', threshold: 0.945 }],
  tropical_forest: [{ kind: 'tree', threshold: 0.92 }, { kind: 'shrub', threshold: 0.975 }],
  tundra: [{ kind: 'ice_rock', threshold: 0.985 }],
  arctic: [{ kind: 'ice_rock', threshold: 0.965 }]
});

export function placeObjectsForTile(tile) {
  const rules = RULES[tile.biome] || [];
  const value = rand2(tile.wx, tile.wy, 777);
  const placed = [];
  for (const rule of rules) {
    if (value > rule.threshold) placed.push({ kind: rule.kind, wx: tile.wx, wy: tile.wy, layer: 'objects' });
  }
  return placed;
}
