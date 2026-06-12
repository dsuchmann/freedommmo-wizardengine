// src/world/field-tuning.js
// Runtime tuning tree for decoration fields (F2 small flora, F3 small
// scatter, F4 medium flora). Size and density multipliers combine
// MULTIPLICATIVELY down the tree: master (field) x biome x object x variant.
// Missing node = 1.0, so an empty tree is byte-identical to baked defaults.
// Pure + deterministic — safe to import from chunk workers.
//
// Tree shape (all keys optional):
// { f2: { size, density, biomes: { grassland: { size|sizeMin+sizeMax, density,
//     objects: { tall_grass_blade: { size|sizeMin+sizeMax, density,
//       anims: { wind_sway: false },
//       variants: { 3: { size|sizeMin+sizeMax } } } } } } }, f3: {...}, f4: {...} }
// Density stops at object level (variants keep their catalog weights).
import { rand2 } from '../core/random.js';

export var FIELD_TUNING = { f2: {}, f3: {}, f4: {} };

export function setFieldTuning(tree) {
  FIELD_TUNING = tree && typeof tree === 'object'
    ? { f2: tree.f2 || {}, f3: tree.f3 || {}, f4: tree.f4 || {} }
    : { f2: {}, f3: {}, f4: {} };
}

// One node's size contribution. Range nodes roll deterministically from the
// tile coords + salt (stable across frames/reloads — same hash as placement).
function nodeSize(node, wx, wy, salt) {
  if (!node) return 1;
  if (node.sizeMin != null && node.sizeMax != null) {
    if (node.sizeMax <= node.sizeMin) return node.sizeMin;
    return node.sizeMin + rand2(wx, wy, salt) * (node.sizeMax - node.sizeMin);
  }
  return node.size != null ? node.size : 1;
}

// master x biome x object x variant size multiplier for one placement.
// salt, salt+1, salt+2 are consumed for biome/object/variant range rolls.
export function tuneSize(field, biome, obj, variant, wx, wy, salt) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var s = f.size != null ? f.size : 1;
  var b = f.biomes && f.biomes[biome];
  if (!b) return s;
  s *= nodeSize(b, wx, wy, salt);
  var o = b.objects && b.objects[obj];
  if (!o) return s;
  s *= nodeSize(o, wx, wy, salt + 1);
  var v = o.variants && o.variants[variant];
  if (v) s *= nodeSize(v, wx, wy, salt + 2);
  return s;
}

// master x biome density multiplier (applies to whole-tile counts/chances).
export function tuneBiomeDensity(field, biome) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var d = f.density != null ? f.density : 1;
  var b = f.biomes && f.biomes[biome];
  if (b && b.density != null) d *= b.density;
  return d;
}

// Object-level density multiplier ONLY (biome/master part excluded so callers
// that already applied tuneBiomeDensity to a tile-level roll don't double it).
export function tuneObjDensity(field, biome, obj) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var b = f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  return o && o.density != null ? o.density : 1;
}

// Per-object, per-category animation toggle. Categories today: 'wind_sway'
// (consumed by field2-animator) and 'player_walk' (generated on disk;
// renderer wiring pending). Missing node/key = enabled (true).
export function tuneAnimEnabled(field, biome, obj, category) {
  var f = FIELD_TUNING[field];
  var b = f && f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  return !(o && o.anims && o.anims[category] === false);
}
