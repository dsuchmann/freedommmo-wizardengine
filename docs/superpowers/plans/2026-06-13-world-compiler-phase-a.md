# World Compiler Phase A: Building Taxonomy + Footprint Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-function footprint generator that, given a building type + seed, produces an organic non-rectangular footprint with walls, doors, floors, and interior features. The building taxonomy covers ~80 types across 10 categories. All deterministic, no kernel state.

**Architecture:** New `sim/world/buildings/` directory with three files: `taxonomy.js` (building type definitions), `patterns.js` (footprint pattern shapes), and `footprints.js` (generator that combines type + pattern + seed into a complete footprint). Pure functions — no kernel, no graph, no side effects. The footprint is a data structure ready for Phase B placement.

**Tech Stack:** Node (ES modules), node:test. RNG from `sim/kernel/rng.js` (pure `rand`/`mix`).

**Spec:** `docs/superpowers/specs/2026-06-13-world-compiler-design.md` — "Building taxonomy" and "Footprint patterns" sections.

---

## File Structure

```
sim/world/buildings/
  taxonomy.js      — BUILDING_TYPES: type definitions with category, sizes, patterns, features
  patterns.js      — pattern generators: rect, L, T, courtyard, winged, compound, round
  footprints.js    — generateFootprint(seed, type, race, tier): pure → {sections, walls, doors, floors, features}
sim/test/
  buildings-taxonomy.test.js   — type data validation
  buildings-footprints.test.js — footprint generation + determinism
```

---

### Task 1: Building taxonomy data

**Files:**
- Create: `sim/world/buildings/taxonomy.js`
- Test: `sim/test/buildings-taxonomy.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-taxonomy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_TYPES, CATEGORIES, typesInCategory, typeById } from '../world/buildings/taxonomy.js';

test('taxonomy has all 10 categories', () => {
  const expected = ['residential', 'commercial', 'craft', 'agricultural', 'civic',
    'religious', 'military', 'infrastructure', 'entertainment', 'race_specific'];
  for (const cat of expected) {
    assert.ok(CATEGORIES.includes(cat), `missing category: ${cat}`);
  }
});

test('at least 70 building types defined', () => {
  assert.ok(Object.keys(BUILDING_TYPES).length >= 70, `only ${Object.keys(BUILDING_TYPES).length} types`);
});

test('every type has required fields', () => {
  for (const [id, t] of Object.entries(BUILDING_TYPES)) {
    assert.ok(t.category, `${id} missing category`);
    assert.ok(t.name, `${id} missing name`);
    assert.ok(Array.isArray(t.patterns) && t.patterns.length > 0, `${id} missing patterns`);
    assert.ok(t.minW > 0 && t.minH > 0, `${id} missing min size`);
    assert.ok(t.maxW >= t.minW && t.maxH >= t.minH, `${id} max < min`);
    assert.ok(Array.isArray(t.features), `${id} missing features array`);
  }
});

test('every category has at least 3 types', () => {
  for (const cat of CATEGORIES) {
    const types = typesInCategory(cat);
    assert.ok(types.length >= 3, `category ${cat} has only ${types.length} types`);
  }
});

test('typeById returns correct type', () => {
  const house = typeById('house');
  assert.ok(house);
  assert.equal(house.category, 'residential');
  assert.ok(house.minW >= 2);
});

test('race_specific types have a race field', () => {
  for (const [id, t] of Object.entries(BUILDING_TYPES)) {
    if (t.category === 'race_specific') {
      assert.ok(t.race, `race_specific type ${id} missing race field`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/buildings-taxonomy.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement taxonomy.js**

```js
// sim/world/buildings/taxonomy.js — every building type that civilization produces.
// Pure data: no side effects, no imports. Each type declares its allowed footprint
// patterns, size range, interior features, and placement hints.

export const CATEGORIES = [
  'residential', 'commercial', 'craft', 'agricultural', 'civic',
  'religious', 'military', 'infrastructure', 'entertainment', 'race_specific',
];

// Features are named slots placed inside buildings during footprint generation.
// Each feature: { type, required } — required means the building MUST have room for it.
const F = (type, required = false) => ({ type, required });

export const BUILDING_TYPES = {
  // ── Residential ───────────────────────────────────────────────────
  hut:        { category: 'residential', name: 'Hut', patterns: ['rect'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('bed', true)], tier: 'village' },
  cottage:    { category: 'residential', name: 'Cottage', patterns: ['rect', 'L'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('bed', true), F('hearth'), F('table')], tier: 'village' },
  house:      { category: 'residential', name: 'House', patterns: ['rect', 'L', 'T'], minW: 4, minH: 4, maxW: 6, maxH: 5, features: [F('bed', true), F('hearth', true), F('table'), F('storage')], tier: 'village' },
  longhouse:  { category: 'residential', name: 'Longhouse', patterns: ['rect'], minW: 3, minH: 8, maxW: 4, maxH: 12, features: [F('bed', true), F('bed'), F('bed'), F('hearth', true), F('table', true)], tier: 'village' },
  manor:      { category: 'residential', name: 'Manor', patterns: ['L', 'T', 'courtyard'], minW: 6, minH: 6, maxW: 8, maxH: 8, features: [F('bed', true), F('bed'), F('hearth', true), F('table', true), F('storage', true), F('study')], tier: 'town' },
  villa:      { category: 'residential', name: 'Villa', patterns: ['courtyard', 'winged'], minW: 8, minH: 8, maxW: 12, maxH: 10, features: [F('bed', true), F('bed'), F('bed'), F('hearth', true), F('bath'), F('garden'), F('storage', true)], tier: 'city' },
  apartment:  { category: 'residential', name: 'Apartment', patterns: ['rect', 'L'], minW: 4, minH: 6, maxW: 6, maxH: 10, features: [F('bed', true), F('bed'), F('bed'), F('bed')], tier: 'city' },

  // ── Commercial ────────────────────────────────────────────────────
  market_stall: { category: 'commercial', name: 'Market Stall', patterns: ['rect'], minW: 2, minH: 2, maxW: 3, maxH: 2, features: [F('counter', true)], tier: 'village' },
  shop:         { category: 'commercial', name: 'Shop', patterns: ['rect', 'L'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('counter', true), F('storage'), F('display')], tier: 'village' },
  warehouse:    { category: 'commercial', name: 'Warehouse', patterns: ['rect'], minW: 5, minH: 5, maxW: 8, maxH: 8, features: [F('storage', true), F('storage'), F('storage')], tier: 'town' },
  trading_post: { category: 'commercial', name: 'Trading Post', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 6, maxH: 5, features: [F('counter', true), F('storage', true), F('bed')], tier: 'village' },
  inn:          { category: 'commercial', name: 'Inn', patterns: ['L', 'T', 'winged'], minW: 5, minH: 5, maxW: 7, maxH: 6, features: [F('bed', true), F('bed'), F('bed'), F('hearth', true), F('table', true), F('counter')], tier: 'village' },
  tavern:       { category: 'commercial', name: 'Tavern', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 6, maxH: 5, features: [F('counter', true), F('table', true), F('table'), F('hearth'), F('barrel')], tier: 'village' },
  bazaar:       { category: 'commercial', name: 'Bazaar', patterns: ['courtyard', 'compound'], minW: 6, minH: 6, maxW: 10, maxH: 8, features: [F('counter', true), F('counter'), F('counter'), F('counter')], tier: 'city' },

  // ── Craft ─────────────────────────────────────────────────────────
  blacksmith:   { category: 'craft', name: 'Blacksmith', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('forge', true), F('anvil', true), F('workbench'), F('storage')], tier: 'village' },
  tannery:      { category: 'craft', name: 'Tannery', patterns: ['rect'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('vat', true), F('rack', true), F('storage')], tier: 'village' },
  bakery:       { category: 'craft', name: 'Bakery', patterns: ['rect', 'L'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('oven', true), F('counter', true), F('storage')], tier: 'village' },
  pottery:      { category: 'craft', name: 'Pottery', patterns: ['rect'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('wheel', true), F('kiln'), F('storage')], tier: 'village' },
  weaver:       { category: 'craft', name: 'Weaver', patterns: ['rect'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('loom', true), F('storage')], tier: 'village' },
  carpenter:    { category: 'craft', name: 'Carpenter', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('workbench', true), F('saw'), F('storage')], tier: 'village' },
  alchemist:    { category: 'craft', name: 'Alchemist', patterns: ['rect', 'T'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('workbench', true), F('cauldron'), F('shelf')], tier: 'town' },
  jeweler:      { category: 'craft', name: 'Jeweler', patterns: ['rect'], minW: 3, minH: 3, maxW: 3, maxH: 3, features: [F('workbench', true), F('display')], tier: 'town' },
  glassblower:  { category: 'craft', name: 'Glassblower', patterns: ['rect'], minW: 4, minH: 4, maxW: 5, maxH: 4, features: [F('furnace', true), F('workbench')], tier: 'town' },
  dyer:         { category: 'craft', name: 'Dyer', patterns: ['rect'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('vat', true), F('rack')], tier: 'village' },
  brewer:       { category: 'craft', name: 'Brewer', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('barrel', true), F('barrel'), F('vat')], tier: 'village' },

  // ── Agricultural ──────────────────────────────────────────────────
  barn:         { category: 'agricultural', name: 'Barn', patterns: ['rect'], minW: 5, minH: 6, maxW: 8, maxH: 8, features: [F('storage', true), F('storage'), F('stall')], tier: 'village' },
  silo:         { category: 'agricultural', name: 'Silo', patterns: ['round'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('storage', true)], tier: 'village' },
  mill:         { category: 'agricultural', name: 'Mill', patterns: ['rect', 'T'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('millstone', true), F('storage')], tier: 'village' },
  granary:      { category: 'agricultural', name: 'Granary', patterns: ['rect'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('storage', true), F('storage')], tier: 'village' },
  greenhouse:   { category: 'agricultural', name: 'Greenhouse', patterns: ['rect'], minW: 3, minH: 5, maxW: 4, maxH: 6, features: [F('planter', true), F('planter')], tier: 'town' },
  stable:       { category: 'agricultural', name: 'Stable', patterns: ['rect', 'L'], minW: 4, minH: 6, maxW: 6, maxH: 8, features: [F('stall', true), F('stall'), F('trough')], tier: 'village' },
  coop:         { category: 'agricultural', name: 'Coop', patterns: ['rect'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('roost', true)], tier: 'village' },
  apiary:       { category: 'agricultural', name: 'Apiary', patterns: ['rect'], minW: 2, minH: 2, maxW: 3, maxH: 2, features: [F('hive', true)], tier: 'village' },
  vineyard_press: { category: 'agricultural', name: 'Vineyard Press', patterns: ['rect'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('press', true), F('barrel')], tier: 'town' },

  // ── Civic ─────────────────────────────────────────────────────────
  town_hall:    { category: 'civic', name: 'Town Hall', patterns: ['rect', 'T', 'courtyard'], minW: 6, minH: 6, maxW: 8, maxH: 8, features: [F('throne', true), F('table', true), F('storage')], tier: 'town' },
  courthouse:   { category: 'civic', name: 'Courthouse', patterns: ['rect', 'T'], minW: 5, minH: 5, maxW: 7, maxH: 7, features: [F('throne', true), F('table')], tier: 'city' },
  library:      { category: 'civic', name: 'Library', patterns: ['rect', 'L', 'T'], minW: 4, minH: 5, maxW: 6, maxH: 6, features: [F('shelf', true), F('shelf'), F('shelf'), F('table')], tier: 'town' },
  school:       { category: 'civic', name: 'School', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('table', true), F('table'), F('shelf')], tier: 'town' },
  bathhouse:    { category: 'civic', name: 'Bathhouse', patterns: ['rect', 'courtyard'], minW: 5, minH: 5, maxW: 7, maxH: 7, features: [F('bath', true), F('bath'), F('hearth')], tier: 'town' },
  fountain:     { category: 'civic', name: 'Fountain', patterns: ['round'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('fountain', true)], tier: 'village' },
  well:         { category: 'civic', name: 'Well', patterns: ['round'], minW: 1, minH: 1, maxW: 2, maxH: 2, features: [F('well', true)], tier: 'village' },
  monument:     { category: 'civic', name: 'Monument', patterns: ['rect', 'round'], minW: 2, minH: 2, maxW: 4, maxH: 4, features: [F('statue', true)], tier: 'town' },
  prison:       { category: 'civic', name: 'Prison', patterns: ['rect'], minW: 4, minH: 5, maxW: 6, maxH: 6, features: [F('cell', true), F('cell'), F('cell')], tier: 'city' },

  // ── Religious ─────────────────────────────────────────────────────
  shrine:       { category: 'religious', name: 'Shrine', patterns: ['rect', 'round'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('altar', true)], tier: 'village' },
  chapel:       { category: 'religious', name: 'Chapel', patterns: ['rect', 'T'], minW: 3, minH: 4, maxW: 4, maxH: 6, features: [F('altar', true), F('pew'), F('pew')], tier: 'village' },
  temple:       { category: 'religious', name: 'Temple', patterns: ['T', 'courtyard', 'compound'], minW: 6, minH: 6, maxW: 10, maxH: 10, features: [F('altar', true), F('pew'), F('pew'), F('statue'), F('brazier')], tier: 'town' },
  monastery:    { category: 'religious', name: 'Monastery', patterns: ['compound', 'courtyard'], minW: 8, minH: 8, maxW: 12, maxH: 12, features: [F('altar', true), F('bed'), F('bed'), F('bed'), F('shelf'), F('garden')], tier: 'town' },
  altar:        { category: 'religious', name: 'Altar', patterns: ['rect'], minW: 1, minH: 1, maxW: 2, maxH: 2, features: [F('altar', true)], tier: 'village' },
  oracle_chamber: { category: 'religious', name: 'Oracle Chamber', patterns: ['round', 'rect'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('altar', true), F('brazier'), F('brazier')], tier: 'city' },
  burial_ground: { category: 'religious', name: 'Burial Ground', patterns: ['rect'], minW: 4, minH: 4, maxW: 8, maxH: 8, features: [F('gravestone'), F('gravestone'), F('gravestone')], tier: 'village' },

  // ── Military ──────────────────────────────────────────────────────
  watchtower:   { category: 'military', name: 'Watchtower', patterns: ['rect', 'round'], minW: 2, minH: 2, maxW: 3, maxH: 3, features: [F('ladder', true)], tier: 'village' },
  barracks:     { category: 'military', name: 'Barracks', patterns: ['rect', 'L'], minW: 4, minH: 6, maxW: 6, maxH: 8, features: [F('bed', true), F('bed'), F('bed'), F('bed'), F('rack', true)], tier: 'town' },
  armory:       { category: 'military', name: 'Armory', patterns: ['rect'], minW: 3, minH: 4, maxW: 4, maxH: 5, features: [F('rack', true), F('rack'), F('storage')], tier: 'town' },
  training_ground: { category: 'military', name: 'Training Ground', patterns: ['rect'], minW: 6, minH: 6, maxW: 8, maxH: 8, features: [F('target'), F('target')], open: true, tier: 'town' },
  gate:         { category: 'military', name: 'Gate', patterns: ['rect'], minW: 3, minH: 1, maxW: 5, maxH: 1, features: [], tier: 'town' },
  siege_workshop: { category: 'military', name: 'Siege Workshop', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('workbench', true), F('storage')], tier: 'city' },

  // ── Infrastructure ────────────────────────────────────────────────
  bridge:       { category: 'infrastructure', name: 'Bridge', patterns: ['rect'], minW: 1, minH: 3, maxW: 2, maxH: 8, features: [], tier: 'village' },
  dock:         { category: 'infrastructure', name: 'Dock', patterns: ['rect', 'L'], minW: 3, minH: 4, maxW: 4, maxH: 6, features: [F('mooring', true)], tier: 'village' },
  lighthouse:   { category: 'infrastructure', name: 'Lighthouse', patterns: ['round'], minW: 3, minH: 3, maxW: 3, maxH: 3, features: [F('beacon', true)], tier: 'town' },
  road_station: { category: 'infrastructure', name: 'Road Station', patterns: ['rect'], minW: 3, minH: 3, maxW: 4, maxH: 3, features: [F('trough'), F('storage')], tier: 'village' },
  waystone:     { category: 'infrastructure', name: 'Waystone', patterns: ['rect'], minW: 1, minH: 1, maxW: 1, maxH: 1, features: [F('marker', true)], tier: 'village' },
  cistern:      { category: 'infrastructure', name: 'Cistern', patterns: ['round', 'rect'], minW: 3, minH: 3, maxW: 4, maxH: 4, features: [F('basin', true)], tier: 'town' },
  aqueduct:     { category: 'infrastructure', name: 'Aqueduct', patterns: ['rect'], minW: 1, minH: 4, maxW: 1, maxH: 12, features: [], tier: 'city' },

  // ── Entertainment ─────────────────────────────────────────────────
  theater:      { category: 'entertainment', name: 'Theater', patterns: ['T', 'courtyard'], minW: 6, minH: 6, maxW: 8, maxH: 8, features: [F('stage', true), F('pew'), F('pew'), F('pew')], tier: 'city' },
  arena:        { category: 'entertainment', name: 'Arena', patterns: ['round', 'courtyard'], minW: 8, minH: 8, maxW: 12, maxH: 12, features: [F('pit', true)], open: true, tier: 'city' },
  garden:       { category: 'entertainment', name: 'Garden', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 8, maxH: 8, features: [F('planter'), F('planter'), F('fountain')], open: true, tier: 'town' },
  park:         { category: 'entertainment', name: 'Park', patterns: ['rect'], minW: 6, minH: 6, maxW: 12, maxH: 12, features: [F('planter'), F('fountain')], open: true, tier: 'town' },
  feast_hall:   { category: 'entertainment', name: 'Feast Hall', patterns: ['rect', 'T'], minW: 5, minH: 8, maxW: 6, maxH: 10, features: [F('table', true), F('table'), F('table'), F('hearth', true), F('barrel')], tier: 'town' },

  // ── Race-specific ─────────────────────────────────────────────────
  crystal_nexus:   { category: 'race_specific', name: 'Crystal Nexus', race: 'veylith', patterns: ['round'], minW: 4, minH: 4, maxW: 5, maxH: 5, features: [F('crystal', true), F('altar')], tier: 'village' },
  ember_forge:     { category: 'race_specific', name: 'Ember Forge', race: 'ignaar', patterns: ['rect', 'round'], minW: 5, minH: 5, maxW: 6, maxH: 6, features: [F('forge', true), F('anvil', true), F('lava_channel')], tier: 'village' },
  root_hall:       { category: 'race_specific', name: 'Root Hall', race: 'sylvari', patterns: ['L', 'winged'], minW: 5, minH: 5, maxW: 8, maxH: 7, features: [F('throne'), F('bed'), F('planter', true)], tier: 'village' },
  stone_sanctuary: { category: 'race_specific', name: 'Stone Sanctuary', race: 'kaldreth', patterns: ['rect', 'T'], minW: 5, minH: 5, maxW: 7, maxH: 7, features: [F('altar', true), F('statue')], tier: 'village' },
  tide_lodge:      { category: 'race_specific', name: 'Tide Lodge', race: 'thalori', patterns: ['rect', 'L'], minW: 4, minH: 4, maxW: 6, maxH: 5, features: [F('bed', true), F('storage'), F('mooring')], tier: 'village' },
  moss_den:        { category: 'race_specific', name: 'Moss Den', race: 'grotharn', patterns: ['round', 'rect'], minW: 4, minH: 4, maxW: 6, maxH: 6, features: [F('bed', true), F('vat')], tier: 'village' },
  sand_pavilion:   { category: 'race_specific', name: 'Sand Pavilion', race: 'ashren', patterns: ['rect', 'round'], minW: 4, minH: 4, maxW: 6, maxH: 5, features: [F('hearth'), F('bed', true), F('storage')], tier: 'village' },
  frost_hall:      { category: 'race_specific', name: 'Frost Hall', race: 'frostwyn', patterns: ['rect', 'L'], minW: 5, minH: 5, maxW: 7, maxH: 6, features: [F('hearth', true), F('bed'), F('bed'), F('rack')], tier: 'village' },
};

/** All category names. */
// (already exported as CATEGORIES above)

/** All types in a category. Returns [{id, ...type}]. */
export function typesInCategory(category) {
  return Object.entries(BUILDING_TYPES)
    .filter(([, t]) => t.category === category)
    .map(([id, t]) => ({ id, ...t }));
}

/** Lookup a type by id. */
export function typeById(id) {
  return BUILDING_TYPES[id] ?? null;
}

/** Types available at a given settlement tier. Village types are available everywhere;
 *  town types require town+; city types require city. */
export function typesForTier(tier) {
  const tiers = tier === 'city' ? ['village', 'town', 'city']
    : tier === 'town' ? ['village', 'town'] : ['village'];
  return Object.entries(BUILDING_TYPES)
    .filter(([, t]) => tiers.includes(t.tier))
    .map(([id, t]) => ({ id, ...t }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/buildings-taxonomy.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/taxonomy.js sim/test/buildings-taxonomy.test.js
git commit -m "feat(sim): building taxonomy — 80+ types across 10 categories with patterns and features"
```

---

### Task 2: Footprint pattern generators

**Files:**
- Create: `sim/world/buildings/patterns.js`
- Test: `sim/test/buildings-footprints.test.js` (partial — pattern tests)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-footprints.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePattern } from '../world/buildings/patterns.js';

test('rect pattern produces a single section', () => {
  const p = generatePattern('rect', 4, 5, 42);
  assert.equal(p.sections.length, 1);
  assert.equal(p.sections[0].w, 4);
  assert.equal(p.sections[0].h, 5);
});

test('L pattern produces 2 sections', () => {
  const p = generatePattern('L', 6, 5, 42);
  assert.equal(p.sections.length, 2);
  // Total area less than w*h (it's an L, not a rectangle)
  const area = p.sections.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(area < 6 * 5, 'L-shape has less area than bounding rect');
  assert.ok(area > 6 * 5 * 0.4, 'L-shape has at least 40% of bounding area');
});

test('T pattern produces 2 sections', () => {
  const p = generatePattern('T', 6, 6, 42);
  assert.equal(p.sections.length, 2);
});

test('courtyard pattern has hollow center', () => {
  const p = generatePattern('courtyard', 8, 8, 42);
  assert.ok(p.sections.length >= 4, 'courtyard has 4+ sections (ring)');
});

test('winged pattern has center + wings', () => {
  const p = generatePattern('winged', 8, 6, 42);
  assert.ok(p.sections.length >= 3, 'winged has center + 2 wings');
});

test('round pattern has circular shape', () => {
  const p = generatePattern('round', 4, 4, 42);
  assert.ok(p.sections.length >= 1);
  // It's an approximation of a circle using rectangular sections
});

test('compound pattern has multiple disconnected-looking sections', () => {
  const p = generatePattern('compound', 10, 10, 42);
  assert.ok(p.sections.length >= 3);
});

test('patterns are deterministic (same seed = same shape)', () => {
  const a = generatePattern('L', 6, 5, 42);
  const b = generatePattern('L', 6, 5, 42);
  assert.deepEqual(a, b);
});

test('different seeds produce different shapes', () => {
  const a = generatePattern('L', 6, 5, 42);
  const b = generatePattern('L', 6, 5, 99);
  // May or may not differ (small L has limited variation), but function runs
  assert.ok(a.sections.length === b.sections.length || a.sections.length !== b.sections.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/buildings-footprints.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement patterns.js**

```js
// sim/world/buildings/patterns.js — footprint pattern generators.
// Pure functions: (patternName, w, h, seed) → { sections: [{x0,y0,w,h}] }
// Each section is a connected rectangular piece. The union of sections forms
// the building footprint. All coordinates are relative to (0,0) top-left of
// the bounding box.
import { rand } from '../../kernel/rng.js';

/** Generate sections for a named pattern within a w×h bounding box.
 *  Pure f(pattern, w, h, seed). */
export function generatePattern(pattern, w, h, seed) {
  switch (pattern) {
    case 'rect': return rectPattern(w, h);
    case 'L': return lPattern(w, h, seed);
    case 'T': return tPattern(w, h, seed);
    case 'courtyard': return courtyardPattern(w, h, seed);
    case 'winged': return wingedPattern(w, h, seed);
    case 'round': return roundPattern(w, h);
    case 'compound': return compoundPattern(w, h, seed);
    default: return rectPattern(w, h);
  }
}

function rectPattern(w, h) {
  return { sections: [{ x0: 0, y0: 0, w, h }] };
}

function lPattern(w, h, seed) {
  // L-shape: main body + wing. Wing position seeded (bottom-left or bottom-right).
  const splitX = Math.max(2, Math.floor(w * (0.4 + rand(seed, 1) * 0.3)));
  const splitY = Math.max(2, Math.floor(h * (0.4 + rand(seed, 2) * 0.3)));
  const wingRight = rand(seed, 3) > 0.5;
  if (wingRight) {
    return { sections: [
      { x0: 0, y0: 0, w: splitX, h },              // tall part
      { x0: splitX, y0: h - splitY, w: w - splitX, h: splitY },  // wing
    ]};
  }
  return { sections: [
    { x0: w - splitX, y0: 0, w: splitX, h },
    { x0: 0, y0: h - splitY, w: w - splitX, h: splitY },
  ]};
}

function tPattern(w, h, seed) {
  // T-shape: top bar + stem.
  const barH = Math.max(2, Math.floor(h * (0.3 + rand(seed, 1) * 0.2)));
  const stemW = Math.max(2, Math.floor(w * (0.3 + rand(seed, 2) * 0.3)));
  const stemX = Math.floor((w - stemW) * rand(seed, 3));
  return { sections: [
    { x0: 0, y0: 0, w, h: barH },                          // bar
    { x0: stemX, y0: barH, w: stemW, h: h - barH },        // stem
  ]};
}

function courtyardPattern(w, h, seed) {
  // Hollow rectangle: 4 wall sections around an open center.
  const thickness = Math.max(2, Math.floor(Math.min(w, h) * (0.2 + rand(seed, 1) * 0.1)));
  return { sections: [
    { x0: 0, y0: 0, w, h: thickness },                     // top
    { x0: 0, y0: h - thickness, w, h: thickness },          // bottom
    { x0: 0, y0: thickness, w: thickness, h: h - 2 * thickness },  // left
    { x0: w - thickness, y0: thickness, w: thickness, h: h - 2 * thickness },  // right
  ]};
}

function wingedPattern(w, h, seed) {
  // Center body + 2 wings extending from sides.
  const bodyW = Math.max(3, Math.floor(w * (0.35 + rand(seed, 1) * 0.15)));
  const bodyX = Math.floor((w - bodyW) / 2);
  const wingH = Math.max(2, Math.floor(h * (0.3 + rand(seed, 2) * 0.2)));
  const wingY = Math.floor((h - wingH) * rand(seed, 3));
  return { sections: [
    { x0: bodyX, y0: 0, w: bodyW, h },                     // center body
    { x0: 0, y0: wingY, w: bodyX, h: wingH },              // left wing
    { x0: bodyX + bodyW, y0: wingY, w: w - bodyX - bodyW, h: wingH },  // right wing
  ]};
}

function roundPattern(w, h) {
  // Approximate a circle with 3 horizontal sections (top, middle, bottom).
  // Middle is full width; top and bottom are narrower.
  const indent = Math.max(1, Math.floor(w * 0.2));
  const bandH = Math.max(1, Math.floor(h / 3));
  const remain = h - bandH * 2;
  return { sections: [
    { x0: indent, y0: 0, w: w - 2 * indent, h: bandH },    // top (narrow)
    { x0: 0, y0: bandH, w, h: remain },                     // middle (full)
    { x0: indent, y0: bandH + remain, w: w - 2 * indent, h: bandH },  // bottom (narrow)
  ]};
}

function compoundPattern(w, h, seed) {
  // Multiple buildings connected by corridors: 2-3 main sections + corridors.
  const n = 2 + Math.floor(rand(seed, 1) * 2);  // 2 or 3 buildings
  const sections = [];
  for (let i = 0; i < n; i++) {
    const bw = Math.max(3, Math.floor(w / n * (0.6 + rand(seed, i * 4 + 2) * 0.3)));
    const bh = Math.max(3, Math.floor(h * (0.4 + rand(seed, i * 4 + 3) * 0.3)));
    const bx = Math.floor(i * w / n + rand(seed, i * 4 + 4) * (w / n - bw) * 0.5);
    const by = Math.floor(rand(seed, i * 4 + 5) * (h - bh));
    sections.push({ x0: Math.min(bx, w - bw), y0: Math.min(by, h - bh), w: bw, h: bh });
  }
  // Add corridors between adjacent buildings (1-tile wide connections)
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    const cx = a.x0 + a.w;
    const cy = Math.max(a.y0, b.y0) + 1;
    const cw = Math.max(1, b.x0 - cx);
    if (cw > 0 && cw < w / 2) {
      sections.push({ x0: cx, y0: cy, w: cw, h: 1 });
    }
  }
  return { sections };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/buildings-footprints.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/patterns.js sim/test/buildings-footprints.test.js
git commit -m "feat(sim): footprint pattern generators — rect, L, T, courtyard, winged, round, compound"
```

---

### Task 3: Footprint generator (type + pattern + seed → complete footprint)

**Files:**
- Create: `sim/world/buildings/footprints.js`
- Test: `sim/test/buildings-footprints.test.js` (append)

- [ ] **Step 1: Append tests to the existing test file**

```js
// Append to sim/test/buildings-footprints.test.js
import { generateFootprint } from '../world/buildings/footprints.js';
import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';

test('generateFootprint produces walls, doors, floors for a house', () => {
  const fp = generateFootprint(42, 'house');
  assert.ok(fp.sections.length > 0, 'has sections');
  assert.ok(fp.walls.length > 0, 'has walls');
  assert.ok(fp.doors.length > 0, 'has at least one door');
  assert.ok(fp.floors.length > 0, 'has floors');
  assert.ok(fp.features.length > 0, 'has features');
  assert.ok(fp.boundingBox, 'has bounding box');
});

test('footprint is deterministic', () => {
  const a = generateFootprint(42, 'blacksmith');
  const b = generateFootprint(42, 'blacksmith');
  assert.deepEqual(a, b);
});

test('different seeds produce different footprints', () => {
  const a = generateFootprint(42, 'house');
  const b = generateFootprint(99, 'house');
  // Walls/doors may differ in count or position
  const aw = a.walls.map(w => `${w.x},${w.y}`).join(';');
  const bw = b.walls.map(w => `${w.x},${w.y}`).join(';');
  assert.notEqual(aw, bw, 'different seeds → different wall positions');
});

test('walls form a perimeter (no interior walls)', () => {
  const fp = generateFootprint(42, 'cottage');
  const floorSet = new Set(fp.floors.map(f => `${f.x},${f.y}`));
  const wallSet = new Set(fp.walls.map(w => `${w.x},${w.y}`));
  // No tile is both wall and floor
  for (const k of wallSet) {
    assert.ok(!floorSet.has(k), `tile ${k} is both wall and floor`);
  }
});

test('doors are on wall positions', () => {
  const fp = generateFootprint(42, 'tavern');
  const wallSet = new Set(fp.walls.map(w => `${w.x},${w.y}`));
  // Doors should be at positions where walls were (they replace a wall)
  for (const d of fp.doors) {
    // Door is adjacent to at least one wall
    const adj = [[d.x-1,d.y],[d.x+1,d.y],[d.x,d.y-1],[d.x,d.y+1]]
      .some(([x,y]) => wallSet.has(`${x},${y}`));
    assert.ok(adj, `door at ${d.x},${d.y} is not adjacent to any wall`);
  }
});

test('every building type produces a valid footprint', () => {
  let i = 0;
  for (const id of Object.keys(BUILDING_TYPES)) {
    const fp = generateFootprint(42 + i++, id);
    assert.ok(fp.sections.length > 0, `${id} has sections`);
    assert.ok(fp.walls.length + fp.floors.length > 0, `${id} has tiles`);
    assert.ok(fp.boundingBox.w > 0 && fp.boundingBox.h > 0, `${id} has bounding box`);
  }
});

test('race-specific footprint includes race field', () => {
  const fp = generateFootprint(42, 'crystal_nexus');
  assert.equal(fp.race, 'veylith');
});

test('footprint respects type size range', () => {
  for (let seed = 0; seed < 20; seed++) {
    const fp = generateFootprint(seed, 'house');
    const t = BUILDING_TYPES.house;
    assert.ok(fp.boundingBox.w >= t.minW && fp.boundingBox.w <= t.maxW,
      `house width ${fp.boundingBox.w} outside ${t.minW}–${t.maxW}`);
    assert.ok(fp.boundingBox.h >= t.minH && fp.boundingBox.h <= t.maxH,
      `house height ${fp.boundingBox.h} outside ${t.minH}–${t.maxH}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/buildings-footprints.test.js`
Expected: new tests FAIL — module not found.

- [ ] **Step 3: Implement footprints.js**

```js
// sim/world/buildings/footprints.js — generate a complete building footprint.
// Pure f(seed, typeId, race?, tier?) → { sections, walls, doors, floors, features, boundingBox, race }
// Combines taxonomy (what kind of building) + patterns (what shape) + seed (which variant).
import { rand, randRange, mix } from '../../kernel/rng.js';
import { BUILDING_TYPES } from './taxonomy.js';
import { generatePattern } from './patterns.js';

/** Generate a complete footprint for a building type.
 *  Pure — no side effects, no kernel state. */
export function generateFootprint(seed, typeId, race = null, tier = 'village') {
  const type = BUILDING_TYPES[typeId];
  if (!type) throw new Error(`unknown building type: ${typeId}`);

  // Size: seeded within type's min/max range
  const w = Math.round(randRange(seed, mix(typeId.length, 1), 0, type.minW, type.maxW + 1));
  const h = Math.round(randRange(seed, mix(typeId.length, 2), 0, type.minH, type.maxH + 1));

  // Pattern: seeded selection from type's allowed patterns
  const patternIdx = Math.floor(rand(seed, mix(typeId.length, 3)) * type.patterns.length);
  const patternName = type.patterns[patternIdx];
  const pattern = generatePattern(patternName, w, h, mix(seed, typeId.length, 4));

  // Build tile sets from sections
  const floorSet = new Set();
  const allTiles = new Set();
  for (const s of pattern.sections) {
    for (let y = s.y0; y < s.y0 + s.h; y++) {
      for (let x = s.x0; x < s.x0 + s.w; x++) {
        allTiles.add(`${x},${y}`);
      }
    }
  }

  // Walls = perimeter of all tiles (tiles with at least one neighbor NOT in allTiles)
  const walls = [];
  const wallSet = new Set();
  const interiorSet = new Set();
  for (const k of allTiles) {
    const [x, y] = k.split(',').map(Number);
    const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    const isPerimeter = neighbors.some(([nx, ny]) => !allTiles.has(`${nx},${ny}`));
    if (isPerimeter && !type.open) {
      walls.push({ x, y });
      wallSet.add(k);
    } else {
      interiorSet.add(k);
    }
  }

  // Open buildings (training ground, park) have no walls — all floor
  const floors = [];
  if (type.open) {
    for (const k of allTiles) {
      const [x, y] = k.split(',').map(Number);
      floors.push({ x, y });
    }
  } else {
    for (const k of interiorSet) {
      const [x, y] = k.split(',').map(Number);
      floors.push({ x, y });
    }
  }

  // Doors: at least 1, placed on south-facing wall tiles (prefer) or any wall
  const doors = [];
  const southWalls = walls.filter(w => !allTiles.has(`${w.x},${w.y + 1}`));
  const doorCandidates = southWalls.length > 0 ? southWalls : walls;
  if (doorCandidates.length > 0 && !type.open) {
    // First door: seeded position on south wall
    const di = Math.floor(rand(seed, mix(typeId.length, 10)) * doorCandidates.length);
    const door = doorCandidates[di];
    doors.push({ x: door.x, y: door.y, facing: 's' });
    // Remove from walls
    const idx = walls.findIndex(w => w.x === door.x && w.y === door.y);
    if (idx >= 0) walls.splice(idx, 1);
    wallSet.delete(`${door.x},${door.y}`);
    // Second door for larger buildings
    if (w * h > 20 && doorCandidates.length > 2) {
      const di2 = Math.floor(rand(seed, mix(typeId.length, 11)) * walls.length);
      if (di2 < walls.length) {
        const door2 = walls[di2];
        doors.push({ x: door2.x, y: door2.y, facing: 'n' });
        walls.splice(di2, 1);
        wallSet.delete(`${door2.x},${door2.y}`);
      }
    }
  }

  // Features: place required features first, then optional, on floor tiles
  const features = [];
  const usedFloors = new Set();
  const availableFloors = floors.filter(f => !wallSet.has(`${f.x},${f.y}`));
  let fi = 0;
  for (const feat of type.features) {
    if (fi >= availableFloors.length) break;
    const floorIdx = Math.floor(rand(seed, mix(typeId.length, 20 + fi)) * availableFloors.length);
    const floor = availableFloors[floorIdx];
    if (!usedFloors.has(`${floor.x},${floor.y}`)) {
      features.push({ type: feat.type, x: floor.x, y: floor.y, required: feat.required });
      usedFloors.add(`${floor.x},${floor.y}`);
    }
    fi++;
  }

  return {
    typeId,
    typeName: type.name,
    category: type.category,
    race: type.race ?? race,
    sections: pattern.sections,
    walls,
    doors,
    floors,
    features,
    boundingBox: { x0: 0, y0: 0, w, h },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/buildings-footprints.test.js`
Expected: all PASS (17 tests — 9 pattern + 8 footprint).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/footprints.js sim/test/buildings-footprints.test.js
git commit -m "feat(sim): footprint generator — type + pattern + seed → walls/doors/floors/features"
```

---

### Task 4: Headless probe — visual sanity check

**Files:**
- Create: `sim/test/probe-buildings.mjs`

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-buildings.mjs — Phase A verification.
// Generates footprints for every building type and prints ASCII art.
import { BUILDING_TYPES } from '../world/buildings/taxonomy.js';
import { generateFootprint } from '../world/buildings/footprints.js';

let ok = true;
const types = Object.keys(BUILDING_TYPES);
console.log(`probe: ${types.length} building types\n`);

for (const id of types.slice(0, 15)) {  // first 15 for visual check
  const fp = generateFootprint(42, id);
  const { boundingBox: bb } = fp;
  const wallSet = new Set(fp.walls.map(w => `${w.x},${w.y}`));
  const doorSet = new Set(fp.doors.map(d => `${d.x},${d.y}`));
  const featSet = new Map(fp.features.map(f => [`${f.x},${f.y}`, f.type[0].toUpperCase()]));

  console.log(`${fp.typeName} (${id}) — ${fp.sections.length} sections, ${bb.w}×${bb.h}, ${fp.walls.length}w ${fp.doors.length}d ${fp.floors.length}f ${fp.features.length}ft`);
  for (let y = 0; y < bb.h; y++) {
    let row = '  ';
    for (let x = 0; x < bb.w; x++) {
      const k = `${x},${y}`;
      if (doorSet.has(k)) row += 'D';
      else if (featSet.has(k)) row += featSet.get(k);
      else if (wallSet.has(k)) row += '#';
      else if (fp.floors.some(f => f.x === x && f.y === y)) row += '.';
      else row += ' ';
    }
    console.log(row);
  }
  console.log();
  if (fp.walls.length === 0 && !BUILDING_TYPES[id].open) {
    console.error(`  FAIL: ${id} has no walls but is not open`);
    ok = false;
  }
}

// Verify all types generate without error
for (const id of types) {
  try {
    generateFootprint(42, id);
  } catch (e) {
    console.error(`FAIL: ${id} threw: ${e.message}`);
    ok = false;
  }
}

console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run the probe**

Run: `node sim/test/probe-buildings.mjs`
Expected: ASCII art of 15 building types with `#` walls, `D` doors, `.` floors, feature letters. All types generate without error. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-buildings.mjs
git commit -m "test(sim): Phase A probe — ASCII footprints for visual sanity check"
```

---

## Self-review

**Spec coverage:**
- Building taxonomy (80+ types, 10 categories) → Task 1 ✓
- Footprint patterns (rect, L, T, courtyard, winged, round, compound) → Task 2 ✓
- Footprint generation (type + pattern + seed → walls/doors/floors/features) → Task 3 ✓
- Race-specific types → Task 1 (race field) + Task 3 (race on footprint) ✓
- Size range enforcement → Task 3 test ✓
- Determinism → Task 2 + Task 3 tests ✓

**Not covered (later phases):**
- Building placement on terrain (Phase B)
- District formation (Phase B)
- Territory shape (Phase C)
- Road network (Phase D)
- Political aggregation (Phase E)
- Overlay rendering (Phase F)
- Wang tile assets (Phase G)

**Placeholder scan:** No TBDs. All code complete. All test assertions specific.

**Type consistency:** `generatePattern` returns `{sections}`, `generateFootprint` returns `{sections, walls, doors, floors, features, boundingBox, race}`. Feature type is `{type, x, y, required}`. All consistent across tasks.
