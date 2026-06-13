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
import { DEFAULT_FIELD_TUNING } from './field-tuning-defaults.js';

// Deep-merge two plain-object nodes: default values are overridden key-by-key
// by the live tree. Non-object (scalar) values from live always win outright.
function mergeNode(def, live) {
  if (!def) return live; if (!live) return def;
  var out = {}, k;
  for (k in def) out[k] = def[k];
  for (k in live) {
    out[k] = (live[k] && typeof live[k] === 'object' && def[k] && typeof def[k] === 'object')
      ? mergeNode(def[k], live[k]) : live[k];
  }
  return out;
}

// Module-init: start with baked defaults so workers that import this module
// before any setFieldTuning call already see the calibrated values.
export var FIELD_TUNING = {
  f2: mergeNode(DEFAULT_FIELD_TUNING.f2, {}),
  f3: mergeNode(DEFAULT_FIELD_TUNING.f3, {}),
  f4: mergeNode(DEFAULT_FIELD_TUNING.f4, {}),
  f5: mergeNode(DEFAULT_FIELD_TUNING.f5, {}),
  f6: mergeNode(DEFAULT_FIELD_TUNING.f6 || {}, {})
};

export function setFieldTuning(tree) {
  var t = (tree && typeof tree === 'object') ? tree : {};
  FIELD_TUNING = {
    f2: mergeNode(DEFAULT_FIELD_TUNING.f2, t.f2 || {}),
    f3: mergeNode(DEFAULT_FIELD_TUNING.f3, t.f3 || {}),
    f4: mergeNode(DEFAULT_FIELD_TUNING.f4, t.f4 || {}),
    f5: mergeNode(DEFAULT_FIELD_TUNING.f5, t.f5 || {}),
    f6: mergeNode(DEFAULT_FIELD_TUNING.f6 || {}, t.f6 || {})
  };
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

// ---- Lifecycle / condition state mixes ------------------------------------
// Weights are RELATIVE (normalized at roll). The nearest defined `states`
// node wins whole-map: object > biome > field master > built-in defaults.
// f5.biomes.<biome>.objects.<obj>.states = { base: 60, cracked: 10, ... }
export function tuneStateWeights(field, biome, obj, defaults) {
  var f = FIELD_TUNING[field];
  var b = f && f.biomes && f.biomes[biome];
  var o = b && b.objects && b.objects[obj];
  if (o && o.states) return o.states;
  if (b && b.states) return b.states;
  if (f && f.states) return f.states;
  return defaults;
}

// Pick a state name from relative weights, walking `order` cumulatively so
// default weights reproduce the historical hardcoded thresholds exactly.
// r in [0,1). Missing keys = 0. Degenerate (all zero) -> order[0].
export function rollWeighted(weights, order, r) {
  var total = 0, i;
  for (i = 0; i < order.length; i++) total += weights[order[i]] || 0;
  if (!(total > 0)) return order[0];
  var x = r * total, acc = 0;
  for (i = 0; i < order.length; i++) {
    acc += weights[order[i]] || 0;
    if (x < acc && (weights[order[i]] || 0) > 0) return order[i];
  }
  return order[order.length - 1];
}

// Worst-case node size: range nodes use sizeMax, plain nodes use size.
function nodeMax(node) {
  if (!node) return 1;
  if (node.sizeMax != null) return node.sizeMax;
  return node.size != null ? node.size : 1;
}

// Worst-case combined size multiplier for a field across the whole tree —
// master x max(biome) x max(object) x max(variant). Used to derive the
// claim-mask scan radius so extreme tuner scales can't out-reach the scan.
export function maxSizeMul(field) {
  var f = FIELD_TUNING[field];
  if (!f) return 1;
  var m = f.size != null ? f.size : 1;
  var worst = 1;
  var biomes = f.biomes || {};
  for (var bk in biomes) {
    var b = biomes[bk];
    var bm = nodeMax(b);
    var ow = 1;
    var objs = b.objects || {};
    for (var ok in objs) {
      var o = objs[ok];
      var om = nodeMax(o);
      var vw = 1;
      var vars = o.variants || {};
      for (var vk in vars) vw = Math.max(vw, nodeMax(vars[vk]));
      ow = Math.max(ow, om * vw);
    }
    worst = Math.max(worst, bm * ow);
  }
  return m * worst;
}

// Per-field state rosters + defaults (= the old hardcoded splits).
// 'base'/'normal' mean "no state sprite" (render the base variant).
export var F2_STATE_ORDER = ['seedling', 'normal', 'wilting', 'dead'];
export var F2_STATE_DEFAULTS = { seedling: 15, normal: 55, wilting: 20, dead: 10 };
export var F4_STATE_ORDER = ['seedling', 'base', 'wilting', 'dead', 'enchanted'];
export var F4_STATE_DEFAULTS = { seedling: 15, base: 55, wilting: 20, dead: 8, enchanted: 2 };
export var F5_STATE_ORDER = ['base', 'cracked', 'mossy_overgrown', 'burned', 'frozen', 'destroyed', 'enchanted'];

// F5 defaults: base 60% / weathered 32% (biome-appropriate subset, split
// evenly) / destroyed 6% / enchanted 2%. (Spec §2.)
var F5_WEATHERED = {
  arctic: ['cracked', 'frozen'], tundra: ['cracked', 'frozen'],
  taiga: ['cracked', 'frozen', 'mossy_overgrown'],
  desert: ['cracked', 'burned'], savanna: ['cracked', 'burned'], volcanic: ['cracked', 'burned'],
  swamp: ['mossy_overgrown', 'cracked'], forest: ['mossy_overgrown', 'cracked'],
  dense_forest: ['mossy_overgrown', 'cracked'], tropical_forest: ['mossy_overgrown', 'cracked'],
  mystic: ['mossy_overgrown', 'cracked'],
};
var F5_WEATHERED_DEFAULT = ['cracked', 'mossy_overgrown'];
var _f5Defaults = {};
export function f5StateDefaults(biome) {
  var hit = _f5Defaults[biome];
  if (hit) return hit;
  var w = F5_WEATHERED[biome] || F5_WEATHERED_DEFAULT;
  var d = { base: 60, destroyed: 6, enchanted: 2 };
  for (var i = 0; i < w.length; i++) d[w[i]] = 32 / w.length;
  return _f5Defaults[biome] = d;
}

// F6 large flora (trees). Taxonomy: seedling/growing/normal/wilting/dead/
// stump/snag/burned/budding/fruiting/harvested. 'base' = normal.
export var F6_STATE_ORDER = ['seedling', 'growing', 'base', 'wilting', 'dead',
  'stump', 'snag', 'burned', 'budding', 'fruiting', 'harvested'];
export var F6_STATE_DEFAULTS = { seedling: 8, growing: 10, base: 55, wilting: 10,
  dead: 5, stump: 4, snag: 3, burned: 1, budding: 2, fruiting: 1, harvested: 1 };
