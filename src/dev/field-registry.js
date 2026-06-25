// src/dev/field-registry.js
// Ordered descriptors for every tunable decoration field. The field tuner
// panel iterates this — adding F6/F7 later = one new entry, zero tuner edits.
// applyKind: 'live' fields rebuild placement caches only; 'repaint-bitmaps'
// fields (F3) are baked into chunk bitmaps and force a worker repaint.
import { SF_BIOME_OBJECTS_LIST, SF_VARIANT_COUNT, sfVariantsFor } from '../render/wang-image-list.js';
import { SS_BIOME_OBJECTS, ssAllowedVariants } from '../world/decoration-claims.js';
import { MF_CATALOG } from '../world/mf-catalog.js';
import { MO_CATALOG } from '../world/mo-catalog.js';
import { F2_STATE_ORDER, F2_STATE_DEFAULTS, F4_STATE_ORDER, F4_STATE_DEFAULTS,
  F5_STATE_ORDER, f5StateDefaults, F6_STATE_ORDER, F6_STATE_DEFAULTS } from '../world/field-tuning.js';
import { LG_CATALOG } from '../world/lg-catalog.js';

function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
function none() { return []; }
function noneMap() { return {}; }

export var FIELD_REGISTRY = [
  {
    id: 'f2', label: 'F2 small flora', path: 'micro/small_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind'], ['player_walk', 'walk']],
    objectsFor: function (biome) {
      return (SF_BIOME_OBJECTS_LIST[biome] || []).map(function (n) {
        return { name: n, variants: sfVariantsFor(biome, n) || range(SF_VARIANT_COUNT) };
      });
    },
    stateNames: function () { return F2_STATE_ORDER; },
    stateDefaults: function () { return F2_STATE_DEFAULTS; },
  },
  {
    id: 'f3', label: 'F3 small scatter', path: 'micro/small_scatter', applyKind: 'repaint-bitmaps',
    animCategories: [],
    objectsFor: function (biome) {
      return (SS_BIOME_OBJECTS[biome] || []).map(function (o) {
        var allowed = ssAllowedVariants(biome, o.name);
        return { name: o.name, variants: allowed || range(64), disabled: allowed && allowed.length === 0 };
      });
    },
    stateNames: none, stateDefaults: noneMap, // F3 lifecycle pool is worker-baked; not tunable yet
  },
  {
    id: 'f4', label: 'F4 medium flora', path: 'micro/medium_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind'], ['player_walk', 'walk']],
    objectsFor: function (biome) {
      return (MF_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: range(o.variants) };
      });
    },
    stateNames: function () { return F4_STATE_ORDER; },
    stateDefaults: function () { return F4_STATE_DEFAULTS; },
  },
  {
    id: 'f5', label: 'F5 medium objects', path: 'micro/medium_objects', applyKind: 'live',
    animCategories: [['wind_sway', 'wind']],
    objectsFor: function (biome) {
      return (MO_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: range(o.variants) };
      });
    },
    stateNames: function () { return F5_STATE_ORDER; },
    stateDefaults: function (biome) { return f5StateDefaults(biome); },
  },
  {
    id: 'f6', label: 'F6 large flora', path: 'micro/large_flora', applyKind: 'live',
    animCategories: [['wind_sway', 'wind']],
    objectsFor: function (biome) {
      return (LG_CATALOG[biome] || []).map(function (o) {
        return { name: o.name, variants: o.vmap || range(o.variants) };
      });
    },
    stateNames: function () { return F6_STATE_ORDER; },
    stateDefaults: function () { return F6_STATE_DEFAULTS; },
  },
];

export function regFor(id) {
  for (var i = 0; i < FIELD_REGISTRY.length; i++) if (FIELD_REGISTRY[i].id === id) return FIELD_REGISTRY[i];
  return null;
}
export function emptyTree() {
  var t = {};
  for (var i = 0; i < FIELD_REGISTRY.length; i++) t[FIELD_REGISTRY[i].id] = {};
  return t;
}
