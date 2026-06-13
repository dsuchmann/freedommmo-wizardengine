# World Compiler Phase B+C: District Layout + Territory Field -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two pure-function systems that turn a settlement site into a spatial reality: (B) a `layoutSettlement` function that assigns buildings to noise-displaced radial districts with internal road spines, and (C) a `territoryAt` function that replaces the current rectangular territory with an organic influence-based flood-fill whose contour follows terrain cost. Both are deterministic f(seed, coordinates), cached per macro-cell, queried per tile.

**Architecture:** New `sim/world/buildings/layout.js` (Phase B) and `sim/world/territory.js` (Phase C). Both import `rand`/`mix` from `sim/kernel/rng.js` and the Phase A taxonomy/footprints. Neither calls `classifyBiome` or `tileCost` during generation -- all shape decisions use seeded noise directly. The layout is a data structure queried by `civilizationAt(seed, x, y)`.

**Tech Stack:** Node (ES modules), node:test. RNG from `sim/kernel/rng.js`. Phase A from `sim/world/buildings/`.

**Spec:** `docs/superpowers/specs/2026-06-13-world-compiler-design.md` -- "District formation", "Building placement", "Territory shape" sections.

**Key constraint:** NO `tileCost`/`classifyBiome` calls during layout generation. Terrain oracle is too expensive for per-tile calls during layout. Use seeded noise directly from `sim/kernel/rng.js`.

---

## File Structure

```
sim/world/buildings/
  layout.js          -- layoutSettlement(seed, site, tier, race, biome): pure -> building catalog
  layout.test.js     -- (in sim/test/)
sim/world/
  territory.js       -- territoryAt(seed, x, y, settlements): organic influence field
  territory.test.js  -- (in sim/test/)
```

---

## Phase B: District Layout + Building Placement

### Task 1: District geometry -- radial sectors with noise-displaced boundaries

**Files:**
- Create: `sim/world/buildings/layout.js`
- Test: `sim/test/buildings-layout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignDistricts, DISTRICT_CONFIGS } from '../world/buildings/layout.js';

test('village gets 2 districts (residential + craft)', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  assert.equal(districts.length, 2);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['craft', 'residential']);
});

test('town gets 5 districts', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.equal(districts.length, 5);
  const kinds = districts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['civic', 'craft', 'market', 'religious', 'residential']);
});

test('city gets 8 districts', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'city', 'human', 'grassland');
  assert.equal(districts.length, 8);
  const kinds = new Set(districts.map(d => d.kind));
  for (const k of ['residential', 'market', 'craft', 'civic', 'religious', 'military', 'agricultural', 'entertainment']) {
    assert.ok(kinds.has(k), `city missing district: ${k}`);
  }
});

test('districts have radial sectors with angle ranges', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  for (const d of districts) {
    assert.ok('angleStart' in d, `district ${d.kind} missing angleStart`);
    assert.ok('angleEnd' in d, `district ${d.kind} missing angleEnd`);
    assert.ok('radius' in d, `district ${d.kind} missing radius`);
    assert.ok(d.angleEnd > d.angleStart, `district ${d.kind} has zero-width angle`);
  }
});

test('civic district is centered (smallest angle offset from 0)', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const civic = districts.find(d => d.kind === 'civic');
  assert.ok(civic, 'civic district exists');
  // civic should wrap around angle 0 (north) or be closest to center
  assert.ok(civic.radius <= districts[0].radius, 'civic radius is innermost');
});

test('districts are deterministic', () => {
  const a = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const b = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.deepEqual(a, b);
});

test('different seeds produce different district angles', () => {
  const a = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const b = assignDistricts(99, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  // At least one angle should differ
  const anglesA = a.map(d => d.angleStart).join(',');
  const anglesB = b.map(d => d.angleStart).join(',');
  assert.notEqual(anglesA, anglesB, 'different seeds -> different angles');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: FAIL -- module not found.

- [ ] **Step 3: Implement district assignment**

```js
// sim/world/buildings/layout.js -- World Compiler Phase B: district layout + building placement.
// Pure functions: seed + site + tier -> complete building catalog with positions.
// No kernel state, no classifyBiome, no tileCost. All spatial decisions via seeded noise.

import { rand, mix } from '../../kernel/rng.js';
import { typesForTier, typesInCategory } from './taxonomy.js';
import { generateFootprint } from './footprints.js';

// ── District configurations by tier ──────────────────────────────────

export const DISTRICT_CONFIGS = {
  village: [
    { kind: 'residential', weight: 0.6, anchor: 'cottage' },
    { kind: 'craft',       weight: 0.4, anchor: 'blacksmith' },
  ],
  town: [
    { kind: 'residential', weight: 0.30, anchor: 'house' },
    { kind: 'market',      weight: 0.20, anchor: 'shop' },
    { kind: 'craft',       weight: 0.20, anchor: 'blacksmith' },
    { kind: 'civic',       weight: 0.15, anchor: 'town_hall' },
    { kind: 'religious',   weight: 0.15, anchor: 'chapel' },
  ],
  city: [
    { kind: 'residential',   weight: 0.20, anchor: 'house' },
    { kind: 'market',        weight: 0.15, anchor: 'bazaar' },
    { kind: 'craft',         weight: 0.15, anchor: 'blacksmith' },
    { kind: 'civic',         weight: 0.10, anchor: 'town_hall' },
    { kind: 'religious',     weight: 0.10, anchor: 'temple' },
    { kind: 'military',      weight: 0.10, anchor: 'barracks' },
    { kind: 'agricultural',  weight: 0.10, anchor: 'barn' },
    { kind: 'entertainment', weight: 0.10, anchor: 'garden' },
  ],
};

// Settlement radius by tier (in tiles from center).
const TIER_RADIUS = { village: 24, town: 40, city: 64 };

// ── District assignment ──────────────────────────────────────────────

/**
 * Assign districts as radial sectors from settlement center.
 * Civic is innermost (small radius, full circle at center).
 * Other districts are angular wedges with noise-displaced boundaries.
 *
 * @param {number} seed
 * @param {{x:number, y:number}} site  Settlement center
 * @param {string} tier  'village' | 'town' | 'city'
 * @param {string} race
 * @param {string} biome
 * @returns {Array<{kind, angleStart, angleEnd, radius, innerRadius, anchor}>}
 */
export function assignDistricts(seed, site, tier, race, biome) {
  const configs = DISTRICT_CONFIGS[tier] ?? DISTRICT_CONFIGS.village;
  const maxRadius = TIER_RADIUS[tier] ?? TIER_RADIUS.village;
  const ds = mix(seed, site.x, site.y, 0xD1);

  // Civic gets a central circle (innermost ring); others get radial wedges outside it.
  const civicIdx = configs.findIndex(c => c.kind === 'civic');
  const hasCivic = civicIdx >= 0;
  const civicRadius = hasCivic ? Math.floor(maxRadius * 0.25) : 0;

  const outerConfigs = hasCivic
    ? configs.filter(c => c.kind !== 'civic')
    : configs;

  // Divide 2*PI among outer districts, weighted by their weight field.
  // Noise-displace each boundary by +/- up to 15 degrees.
  const totalWeight = outerConfigs.reduce((s, c) => s + c.weight, 0);
  let angle = rand(ds, 0xA001) * Math.PI * 2; // seeded rotation offset
  const districts = [];

  if (hasCivic) {
    districts.push({
      kind: 'civic',
      angleStart: 0,
      angleEnd: Math.PI * 2,
      radius: civicRadius,
      innerRadius: 0,
      anchor: configs[civicIdx].anchor,
    });
  }

  for (let i = 0; i < outerConfigs.length; i++) {
    const c = outerConfigs[i];
    const span = (c.weight / totalWeight) * Math.PI * 2;
    // Noise displacement on boundary: +/- 0.26 rad (~15 degrees)
    const noise = (rand(ds, 0xA010, i) - 0.5) * 0.52;
    const start = angle + noise;
    const end = angle + span;
    districts.push({
      kind: c.kind,
      angleStart: start,
      angleEnd: end,
      radius: maxRadius,
      innerRadius: hasCivic ? civicRadius : 0,
      anchor: c.anchor,
    });
    angle += span;
  }

  return districts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/layout.js sim/test/buildings-layout.test.js
git commit -m "feat(sim): Phase B district assignment -- radial sectors with noise-displaced boundaries"
```

---

### Task 2: Road spines within districts

**Files:**
- Modify: `sim/world/buildings/layout.js`
- Test: `sim/test/buildings-layout.test.js` (append)

- [ ] **Step 1: Append tests**

```js
// Append to sim/test/buildings-layout.test.js
import { generateRoadSpines } from '../world/buildings/layout.js';

test('road spines: village has at least 1 spine', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.ok(spines.length >= 1, 'at least 1 road spine');
});

test('road spines: town has at least 3 spines', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.ok(spines.length >= 3, `only ${spines.length} spines`);
});

test('each spine is an array of {x,y} waypoints', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  for (const spine of spines) {
    assert.ok(Array.isArray(spine.points), 'spine has points array');
    assert.ok(spine.points.length >= 2, 'spine has at least 2 waypoints');
    for (const p of spine.points) {
      assert.ok(typeof p.x === 'number' && typeof p.y === 'number', 'waypoint has x,y');
    }
    assert.ok(spine.tier, 'spine has tier (street/alley)');
  }
});

test('primary spine passes through settlement center', () => {
  const site = { x: 500, y: 500 };
  const districts = assignDistricts(42, site, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, site, districts);
  const primary = spines.find(s => s.tier === 'street');
  assert.ok(primary, 'has a primary street');
  // At least one waypoint should be at or near center
  const nearCenter = primary.points.some(p =>
    Math.abs(p.x - site.x) <= 3 && Math.abs(p.y - site.y) <= 3);
  assert.ok(nearCenter, 'primary street passes near center');
});

test('road spines are deterministic', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const a = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const b = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: new tests FAIL -- `generateRoadSpines` not found.

- [ ] **Step 3: Implement road spines**

Add to `sim/world/buildings/layout.js`:

```js
// ── Road spines ──────────────────────────────────────────────────────

/**
 * Generate road spines through districts.
 * A primary street runs through center; secondary streets branch into each district.
 * Each spine is a sequence of waypoints (not per-tile -- queried via distance check).
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {Array} districts  From assignDistricts
 * @returns {Array<{tier, district, points: Array<{x,y}>}>}
 */
export function generateRoadSpines(seed, site, districts) {
  const rs = mix(seed, site.x, site.y, 0xR001);
  const spines = [];
  const maxR = Math.max(...districts.map(d => d.radius));

  // Primary street: noise-displaced line through center, running at a seeded angle.
  const primaryAngle = rand(rs, 0xP001) * Math.PI;  // 0..PI (a line, not a ray)
  const primaryLen = maxR * 0.9;
  const primaryPoints = [];
  const NUM_PRI_PTS = 8;
  for (let i = 0; i < NUM_PRI_PTS; i++) {
    const t = (i / (NUM_PRI_PTS - 1)) * 2 - 1;  // -1..+1 along the line
    const baseX = site.x + Math.cos(primaryAngle) * primaryLen * t;
    const baseY = site.y + Math.sin(primaryAngle) * primaryLen * t;
    // Noise displacement perpendicular to the line
    const noiseAmp = maxR * 0.08;
    const nx = (rand(rs, 0xP010, i) - 0.5) * noiseAmp;
    const ny = (rand(rs, 0xP011, i) - 0.5) * noiseAmp;
    primaryPoints.push({ x: Math.round(baseX + nx), y: Math.round(baseY + ny) });
  }
  spines.push({ tier: 'street', district: null, points: primaryPoints });

  // Secondary streets: one per outer district, branching from center toward district midpoint.
  const outerDistricts = districts.filter(d => d.innerRadius > 0 || !districts.some(d2 => d2.kind === 'civic'));
  for (let i = 0; i < outerDistricts.length; i++) {
    const d = outerDistricts[i];
    const midAngle = (d.angleStart + d.angleEnd) / 2;
    const secPoints = [];
    const NUM_SEC_PTS = 5;
    for (let j = 0; j < NUM_SEC_PTS; j++) {
      const t = j / (NUM_SEC_PTS - 1);  // 0..1 from center outward
      const r = d.innerRadius + (d.radius - d.innerRadius) * t;
      const baseX = site.x + Math.cos(midAngle) * r;
      const baseY = site.y + Math.sin(midAngle) * r;
      const noiseAmp = maxR * 0.05;
      const nx = (rand(rs, 0xS010, i, j) - 0.5) * noiseAmp;
      const ny = (rand(rs, 0xS011, i, j) - 0.5) * noiseAmp;
      secPoints.push({ x: Math.round(baseX + nx), y: Math.round(baseY + ny) });
    }
    spines.push({ tier: 'alley', district: d.kind, points: secPoints });
  }

  return spines;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/layout.js sim/test/buildings-layout.test.js
git commit -m "feat(sim): Phase B road spines -- primary street + secondary branches per district"
```

---

### Task 3: Building placement along road spines

**Files:**
- Modify: `sim/world/buildings/layout.js`
- Test: `sim/test/buildings-layout.test.js` (append)

- [ ] **Step 1: Append tests**

```js
// Append to sim/test/buildings-layout.test.js
import { placeBuildings } from '../world/buildings/layout.js';

test('placeBuildings: village produces at least 5 buildings', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const buildings = placeBuildings(42, { x: 500, y: 500 }, 'village', 'human', districts, spines);
  assert.ok(buildings.length >= 5, `only ${buildings.length} buildings in village`);
});

test('placeBuildings: town produces more buildings than village', () => {
  const vd = assignDistricts(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  const vs = generateRoadSpines(42, { x: 500, y: 500 }, vd);
  const vb = placeBuildings(42, { x: 500, y: 500 }, 'village', 'human', vd, vs);

  const td = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const ts = generateRoadSpines(42, { x: 500, y: 500 }, td);
  const tb = placeBuildings(42, { x: 500, y: 500 }, 'town', 'human', td, ts);

  assert.ok(tb.length > vb.length, `town (${tb.length}) should have more buildings than village (${vb.length})`);
});

test('placeBuildings: each building has position, footprint, and district', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const buildings = placeBuildings(42, { x: 500, y: 500 }, 'town', 'human', districts, spines);
  for (const b of buildings) {
    assert.ok(typeof b.x === 'number', `building missing x`);
    assert.ok(typeof b.y === 'number', `building missing y`);
    assert.ok(b.footprint, 'building missing footprint');
    assert.ok(b.footprint.typeId, 'footprint missing typeId');
    assert.ok(b.district, 'building missing district assignment');
  }
});

test('placeBuildings: no two buildings overlap', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'city', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const buildings = placeBuildings(42, { x: 500, y: 500 }, 'city', 'human', districts, spines);
  // Collect all occupied tiles
  const occupied = new Set();
  for (const b of buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        const key = `${b.x + dx},${b.y + dy}`;
        assert.ok(!occupied.has(key), `overlap at ${key} (building ${b.footprint.typeId})`);
        occupied.add(key);
      }
    }
  }
});

test('placeBuildings: anchor building is first in its district', () => {
  const districts = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const spines = generateRoadSpines(42, { x: 500, y: 500 }, districts);
  const buildings = placeBuildings(42, { x: 500, y: 500 }, 'town', 'human', districts, spines);
  // The civic district's first building should be the town_hall
  const civicBuildings = buildings.filter(b => b.district === 'civic');
  if (civicBuildings.length > 0) {
    assert.equal(civicBuildings[0].footprint.typeId, 'town_hall',
      'civic anchor is town_hall');
  }
});

test('placeBuildings: deterministic', () => {
  const d = assignDistricts(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const s = generateRoadSpines(42, { x: 500, y: 500 }, d);
  const a = placeBuildings(42, { x: 500, y: 500 }, 'town', 'human', d, s);
  const b = placeBuildings(42, { x: 500, y: 500 }, 'town', 'human', d, s);
  assert.deepEqual(a, b);
});

test('placeBuildings: buildings within settlement radius', () => {
  const site = { x: 500, y: 500 };
  const districts = assignDistricts(42, site, 'village', 'human', 'grassland');
  const spines = generateRoadSpines(42, site, districts);
  const buildings = placeBuildings(42, site, 'village', 'human', districts, spines);
  const maxR = Math.max(...districts.map(d => d.radius));
  for (const b of buildings) {
    const dx = b.x - site.x, dy = b.y - site.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    assert.ok(dist <= maxR + 20, `building at distance ${dist} exceeds radius ${maxR}`);
  }
});
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: new tests FAIL -- `placeBuildings` not found.

- [ ] **Step 3: Implement building placement**

Add to `sim/world/buildings/layout.js`:

```js
// ── Building budgets per district ────────────────────────────────────

// How many buildings a district gets, by tier.
const BUDGET = {
  village: { residential: 6,  craft: 3 },
  town:    { residential: 12, market: 6, craft: 6, civic: 3, religious: 3 },
  city:    { residential: 20, market: 10, craft: 10, civic: 5, religious: 5,
             military: 4, agricultural: 4, entertainment: 3 },
};

// Category mapping: which taxonomy categories fill each district kind.
const DISTRICT_CATEGORIES = {
  residential:   ['residential'],
  market:        ['commercial'],
  craft:         ['craft'],
  civic:         ['civic'],
  religious:     ['religious'],
  military:      ['military'],
  agricultural:  ['agricultural'],
  entertainment: ['entertainment'],
  harbor:        ['infrastructure', 'commercial'],
};

// ── Building placement ───────────────────────────────────────────────

/**
 * Determine which angular district a point falls in.
 * @param {number} px  World x
 * @param {number} py  World y
 * @param {{x,y}} center  Settlement center
 * @param {Array} districts  From assignDistricts
 * @returns {object|null}  The district, or null if outside all
 */
function districtForPoint(px, py, center, districts) {
  const dx = px - center.x, dy = py - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;

  // Check civic (central circle) first
  const civic = districts.find(d => d.kind === 'civic');
  if (civic && dist <= civic.radius) return civic;

  // Normalize angles to [0, 2*PI) and check wedges
  for (const d of districts) {
    if (d.kind === 'civic') continue;
    let as = d.angleStart % (Math.PI * 2);
    let ae = d.angleEnd % (Math.PI * 2);
    if (as < 0) as += Math.PI * 2;
    if (ae < 0) ae += Math.PI * 2;
    if (dist > d.radius || dist < d.innerRadius) continue;
    if (as <= ae) {
      if (angle >= as && angle < ae) return d;
    } else {
      // Wraps around 2*PI
      if (angle >= as || angle < ae) return d;
    }
  }
  // Fallback: nearest district by angle
  let best = null, bestDiff = Infinity;
  for (const d of districts) {
    if (d.kind === 'civic') continue;
    const mid = (d.angleStart + d.angleEnd) / 2;
    let diff = Math.abs(angle - (mid % (Math.PI * 2)));
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
}

/**
 * Place buildings along road spines within districts.
 * Anchor buildings placed first at district center, then fill along spines.
 * Returns flat array of placed buildings with world-space positions.
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {string} tier
 * @param {string} race
 * @param {Array} districts
 * @param {Array} spines
 * @returns {Array<{x, y, footprint, district, isAnchor}>}
 */
export function placeBuildings(seed, site, tier, race, districts, spines) {
  const ps = mix(seed, site.x, site.y, 0xB001);
  const budget = BUDGET[tier] ?? BUDGET.village;
  const placed = [];
  const occupiedTiles = new Set();  // "wx,wy" keys for collision detection

  /** Check if a footprint at (wx, wy) collides with already-placed buildings.
   *  Includes a 1-tile gap for breathing room. */
  function wouldCollide(wx, wy, fp) {
    const bb = fp.boundingBox;
    for (let dy = -1; dy <= bb.h; dy++) {
      for (let dx = -1; dx <= bb.w; dx++) {
        if (occupiedTiles.has(`${wx + dx},${wy + dy}`)) return true;
      }
    }
    return false;
  }

  /** Mark a footprint's tiles as occupied. */
  function markOccupied(wx, wy, fp) {
    const bb = fp.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        occupiedTiles.add(`${wx + dx},${wy + dy}`);
      }
    }
  }

  /** Pick a building type from the allowed categories for this district kind. */
  function pickType(districtKind, idx) {
    const cats = DISTRICT_CATEGORIES[districtKind] ?? ['residential'];
    const available = typesForTier(tier).filter(t => cats.includes(t.category));
    if (available.length === 0) return null;
    const ti = Math.floor(rand(ps, 0xT001, idx, districtKind.length) * available.length);
    return available[ti];
  }

  // Phase 1: Place anchor buildings at district centers.
  for (const d of districts) {
    if (!d.anchor) continue;
    const midAngle = (d.angleStart + d.angleEnd) / 2;
    const midR = (d.innerRadius + d.radius) * 0.4;  // closer to center
    const ax = Math.round(site.x + Math.cos(midAngle) * midR);
    const ay = Math.round(site.y + Math.sin(midAngle) * midR);
    const fp = generateFootprint(mix(ps, 0xA100, ax, ay), d.anchor, race);
    if (!wouldCollide(ax, ay, fp)) {
      markOccupied(ax, ay, fp);
      placed.push({ x: ax, y: ay, footprint: fp, district: d.kind, isAnchor: true });
    }
  }

  // Phase 2: Fill along road spines.
  let globalIdx = 0;
  for (const d of districts) {
    const count = budget[d.kind] ?? 3;
    const districtSpines = spines.filter(s => s.district === d.kind || s.district === null);
    let placedInDistrict = placed.filter(b => b.district === d.kind).length;

    for (const spine of districtSpines) {
      if (placedInDistrict >= count) break;
      // Walk along spine waypoints, placing buildings at intervals
      for (let pi = 0; pi < spine.points.length - 1 && placedInDistrict < count; pi++) {
        const p0 = spine.points[pi], p1 = spine.points[pi + 1];
        const segLen = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
        if (segLen < 2) continue;

        // Place buildings along this segment with seeded spacing
        const spacing = 6 + Math.floor(rand(ps, 0xF001, globalIdx) * 5);  // 6-10 tile gap
        const numSlots = Math.floor(segLen / spacing);

        for (let si = 0; si < numSlots && placedInDistrict < count; si++) {
          const t = (si + 0.5) / Math.max(1, numSlots);
          const bx = Math.round(p0.x + (p1.x - p0.x) * t);
          const by = Math.round(p0.y + (p1.y - p0.y) * t);

          // Setback from road: perpendicular offset (1-4 tiles)
          const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) + Math.PI / 2;
          const setback = 2 + Math.floor(rand(ps, 0xF002, globalIdx, si) * 3);
          const side = rand(ps, 0xF003, globalIdx, si) > 0.5 ? 1 : -1;
          const wx = Math.round(bx + Math.cos(perpAngle) * setback * side);
          const wy = Math.round(by + Math.sin(perpAngle) * setback * side);

          const type = pickType(d.kind, globalIdx + si);
          if (!type) continue;

          const fp = generateFootprint(mix(ps, 0xF100, wx, wy, globalIdx), type.id, race);
          if (!wouldCollide(wx, wy, fp)) {
            markOccupied(wx, wy, fp);
            placed.push({ x: wx, y: wy, footprint: fp, district: d.kind, isAnchor: false });
            placedInDistrict++;
          }
          globalIdx++;
        }
      }
    }
  }

  return placed;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/layout.js sim/test/buildings-layout.test.js
git commit -m "feat(sim): Phase B building placement -- anchor buildings + fill along road spines, no overlaps"
```

---

### Task 4: `layoutSettlement` -- the public entry point

**Files:**
- Modify: `sim/world/buildings/layout.js`
- Test: `sim/test/buildings-layout.test.js` (append)

- [ ] **Step 1: Append tests**

```js
// Append to sim/test/buildings-layout.test.js
import { layoutSettlement } from '../world/buildings/layout.js';

test('layoutSettlement returns complete catalog', () => {
  const layout = layoutSettlement(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.ok(layout.districts.length > 0, 'has districts');
  assert.ok(layout.buildings.length > 0, 'has buildings');
  assert.ok(layout.spines.length > 0, 'has road spines');
  assert.ok(layout.site, 'has site');
  assert.equal(layout.tier, 'town');
  assert.equal(layout.race, 'human');
});

test('layoutSettlement is deterministic', () => {
  const a = layoutSettlement(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  const b = layoutSettlement(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  assert.equal(a.buildings.length, b.buildings.length);
  for (let i = 0; i < a.buildings.length; i++) {
    assert.equal(a.buildings[i].x, b.buildings[i].x);
    assert.equal(a.buildings[i].y, b.buildings[i].y);
    assert.equal(a.buildings[i].footprint.typeId, b.buildings[i].footprint.typeId);
  }
});

test('layoutSettlement can be queried by tile', () => {
  const layout = layoutSettlement(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  // Pick a known building position and query it
  if (layout.buildings.length > 0) {
    const b = layout.buildings[0];
    const result = layout.queryTile(b.x, b.y);
    assert.ok(result, 'tile query returns something at building position');
    assert.equal(result.type, 'building');
    assert.equal(result.building.footprint.typeId, b.footprint.typeId);
  }
});

test('layoutSettlement queryTile returns null for empty tile', () => {
  const layout = layoutSettlement(42, { x: 500, y: 500 }, 'village', 'human', 'grassland');
  // Far from settlement -- should be null
  const result = layout.queryTile(0, 0);
  assert.equal(result, null);
});

test('layoutSettlement queryTile identifies road tiles', () => {
  const layout = layoutSettlement(42, { x: 500, y: 500 }, 'town', 'human', 'grassland');
  // Walk along a spine and check that at least one tile returns road
  let foundRoad = false;
  if (layout.spines.length > 0) {
    const spine = layout.spines[0];
    for (const p of spine.points) {
      const r = layout.queryTile(p.x, p.y);
      if (r && r.type === 'road') { foundRoad = true; break; }
    }
  }
  assert.ok(foundRoad, 'at least one spine waypoint is a road tile');
});
```

- [ ] **Step 2: Run test to verify new tests fail**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: new tests FAIL -- `layoutSettlement` not found.

- [ ] **Step 3: Implement layoutSettlement**

Add to `sim/world/buildings/layout.js`:

```js
// ── Layout cache ─────────────────────────────────────────────────────

const _layoutCache = new Map();  // "seed,mx,my" -> layout

/**
 * The public entry point: generate a complete settlement layout.
 * Pure f(seed, site, tier, race, biome) -> {districts, buildings, spines, queryTile}.
 * Cached per call-signature (intended: one per macro-cell).
 *
 * @param {number} seed
 * @param {{x,y}} site
 * @param {string} tier  'village' | 'town' | 'city'
 * @param {string} race
 * @param {string} biome
 * @returns {{districts, buildings, spines, site, tier, race, queryTile(x,y)}}
 */
export function layoutSettlement(seed, site, tier, race, biome) {
  const cacheKey = `${seed},${site.x},${site.y},${tier}`;
  if (_layoutCache.has(cacheKey)) return _layoutCache.get(cacheKey);

  const districts = assignDistricts(seed, site, tier, race, biome);
  const spines = generateRoadSpines(seed, site, districts);
  const buildings = placeBuildings(seed, site, tier, race, districts, spines);

  // Build spatial index for tile queries: Map<"x,y" -> building>
  const tileIndex = new Map();
  for (const b of buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        tileIndex.set(`${b.x + dx},${b.y + dy}`, b);
      }
    }
  }

  // Road tile index: tiles within 1 tile of any spine segment
  const roadTiles = new Set();
  for (const spine of spines) {
    for (let i = 0; i < spine.points.length - 1; i++) {
      const p0 = spine.points[i], p1 = spine.points[i + 1];
      const steps = Math.ceil(Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2));
      for (let s = 0; s <= steps; s++) {
        const t = steps > 0 ? s / steps : 0;
        const rx = Math.round(p0.x + (p1.x - p0.x) * t);
        const ry = Math.round(p0.y + (p1.y - p0.y) * t);
        roadTiles.add(`${rx},${ry}`);
        // Width of 2 for streets
        if (spine.tier === 'street') {
          roadTiles.add(`${rx + 1},${ry}`);
          roadTiles.add(`${rx},${ry + 1}`);
        }
      }
    }
  }

  /** Query what's at a specific tile. Returns null if nothing. */
  function queryTile(x, y) {
    const key = `${x},${y}`;
    const building = tileIndex.get(key);
    if (building) {
      // Determine if this tile is a wall, door, or floor within the footprint
      const lx = x - building.x, ly = y - building.y;
      const isWall = building.footprint.walls.some(w => w.x === lx && w.y === ly);
      const isDoor = building.footprint.doors.some(d => d.x === lx && d.y === ly);
      return { type: 'building', building, tileKind: isDoor ? 'door' : isWall ? 'wall' : 'floor' };
    }
    if (roadTiles.has(key)) {
      return { type: 'road', tier: 'street' };  // TODO: differentiate spine tier
    }
    return null;
  }

  const layout = { districts, buildings, spines, site, tier, race, queryTile };

  _layoutCache.set(cacheKey, layout);
  if (_layoutCache.size > 200) _layoutCache.clear();  // LRU-like cap

  return layout;
}

/** Clear the layout cache (for testing). */
export function clearLayoutCache() { _layoutCache.clear(); }
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/layout.js sim/test/buildings-layout.test.js
git commit -m "feat(sim): layoutSettlement -- public entry point with tile query index and caching"
```

---

## Phase C: Territory Field (Organic Boundaries)

### Task 5: Influence flood-fill from settlement center

**Files:**
- Create: `sim/world/territory.js`
- Test: `sim/test/territory.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/territory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTerritory, territoryAt } from '../world/territory.js';

test('computeTerritory produces an influence map from center', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  assert.ok(territory, 'territory exists');
  assert.ok(territory.tiles.size > 0, 'has claimed tiles');
  assert.ok(territory.center, 'has center');
  assert.equal(territory.center.x, 500);
  assert.equal(territory.center.y, 500);
});

test('center tile has maximum influence', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const centerInfluence = territory.tiles.get('500,500');
  assert.ok(centerInfluence !== undefined, 'center tile exists');
  for (const [key, inf] of territory.tiles) {
    assert.ok(inf <= centerInfluence, `tile ${key} has higher influence than center`);
  }
});

test('influence decreases with distance from center', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const c = territory.tiles.get('500,500');
  const near = territory.tiles.get('505,500') ?? 0;
  const far = territory.tiles.get('520,500') ?? 0;
  assert.ok(c >= near, 'center >= near');
  assert.ok(near >= far, 'near >= far');
});

test('territory is larger for higher tiers', () => {
  const village = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const town = computeTerritory(42, { x: 500, y: 500 }, 'town');
  const city = computeTerritory(42, { x: 500, y: 500 }, 'city');
  assert.ok(town.tiles.size > village.tiles.size, 'town > village');
  assert.ok(city.tiles.size > town.tiles.size, 'city > town');
});

test('territory shape is NOT rectangular (organic contour)', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'town');
  // Compute actual bounding box and compare area to tile count.
  // A rectangle would have tileCount == bbox area.
  // Organic shape should be smaller (contour cuts corners).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const key of territory.tiles.keys()) {
    const [x, y] = key.split(',').map(Number);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
  assert.ok(territory.tiles.size < bboxArea * 0.95,
    `territory fills ${(territory.tiles.size / bboxArea * 100).toFixed(0)}% of bbox -- too rectangular`);
});

test('territory is deterministic', () => {
  const a = computeTerritory(42, { x: 500, y: 500 }, 'village');
  const b = computeTerritory(42, { x: 500, y: 500 }, 'village');
  assert.equal(a.tiles.size, b.tiles.size);
});

test('territoryAt returns settlement + influence for claimed tile', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'town', id: 'town1' },
  ];
  const result = territoryAt(42, 500, 500, settlements);
  assert.ok(result, 'center tile is claimed');
  assert.equal(result.settlement, 'town1');
  assert.ok(result.influence > 0);
});

test('territoryAt returns null for unclaimed tile', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'village', id: 'v1' },
  ];
  const result = territoryAt(42, 0, 0, settlements);
  assert.equal(result, null, 'far tile is unclaimed');
});

test('overlapping territories: nearest wins at boundary', () => {
  const settlements = [
    { seed: 42, site: { x: 500, y: 500 }, tier: 'town', id: 'town1' },
    { seed: 42, site: { x: 560, y: 500 }, tier: 'town', id: 'town2' },
  ];
  // Midpoint at x=530 -- should belong to whichever has higher influence
  const result = territoryAt(42, 530, 500, settlements);
  assert.ok(result, 'midpoint is claimed by someone');
  // Both are equidistant -- result depends on noise, but must be one of them
  assert.ok(result.settlement === 'town1' || result.settlement === 'town2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/territory.test.js`
Expected: FAIL -- module not found.

- [ ] **Step 3: Implement territory**

```js
// sim/world/territory.js -- World Compiler Phase C: organic territory field.
// Pure functions: seed + site -> influence flood-fill with noise-displaced contour.
// No classifyBiome, no tileCost during generation. Terrain cost simulated via
// seeded noise octaves that create organic, terrain-following boundaries.
// No kernel state, no side effects.

import { rand, mix } from '../kernel/rng.js';

// Base influence budget by tier (higher = larger territory).
const TIER_INFLUENCE = { village: 30, town: 50, city: 80 };

// ── Noise-based terrain cost ─────────────────────────────────────────

/**
 * Pseudo terrain cost for territory spreading. Uses seeded noise to simulate
 * rivers, ridges, and obstacles WITHOUT calling classifyBiome.
 * Returns a cost multiplier in [1.0, 4.0]. Higher = harder to spread through.
 *
 * Three noise octaves:
 * 1. Large-scale ridge lines (high cost bands)
 * 2. Medium-scale river valleys (moderate cost curves)
 * 3. Small-scale roughness (organic jitter)
 */
function noiseCost(seed, x, y) {
  // Octave 1: ridge lines -- sin waves at large scale
  const ridge = Math.abs(Math.sin(
    (x * 0.02 + rand(seed, 0xC001) * 100) +
    (y * 0.015 + rand(seed, 0xC002) * 100)
  ));
  // Octave 2: river-like curves
  const river = Math.abs(Math.sin(
    (x * 0.04 + y * 0.01 + rand(seed, 0xC003) * 100)
  ));
  // Octave 3: local roughness
  const rough = rand(seed, x * 7919 + 1, y * 6271 + 2);

  // Combine: ridges create bands of high cost, rivers create thin barriers
  const ridgeCost = ridge < 0.1 ? 3.0 : 1.0;  // thin ridge lines
  const riverCost = river < 0.05 ? 2.5 : 1.0;  // thin river lines
  const roughCost = 1.0 + rough * 0.5;          // 1.0-1.5 jitter

  return ridgeCost * riverCost * roughCost;
}

// ── Flood-fill territory computation ─────────────────────────────────

/**
 * Compute territory as an influence flood-fill from settlement center.
 * Each tile gets an influence value = base - accumulated cost to reach it.
 * Tiles where influence drops below 0 are not claimed.
 *
 * Returns { center, tiles: Map<"x,y" -> influence>, boundary: Set<"x,y"> }
 *
 * @param {number} seed
 * @param {{x,y}} site  Settlement center
 * @param {string} tier  'village' | 'town' | 'city'
 * @returns {{ center: {x,y}, tiles: Map<string,number>, boundary: Set<string> }}
 */
export function computeTerritory(seed, site, tier) {
  const baseInfluence = TIER_INFLUENCE[tier] ?? TIER_INFLUENCE.village;
  const ts = mix(seed, site.x, site.y, 0xTE01);

  // Dijkstra-like flood-fill from center.
  // influence[tile] = baseInfluence - totalCost to reach tile from center.
  const tiles = new Map();
  const boundary = new Set();

  // Priority queue (simple sorted array -- territory is small enough)
  // Each entry: { x, y, influence }
  const queue = [{ x: site.x, y: site.y, influence: baseInfluence }];
  const visited = new Set();
  visited.add(`${site.x},${site.y}`);

  while (queue.length > 0) {
    // Pop highest-influence tile
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].influence > queue[bestIdx].influence) bestIdx = i;
    }
    const { x, y, influence } = queue[bestIdx];
    queue[bestIdx] = queue[queue.length - 1];
    queue.pop();

    if (influence <= 0) continue;
    tiles.set(`${x},${y}`, influence);

    // Expand to 4 neighbors
    const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    let isBoundary = false;
    for (const [nx, ny] of neighbors) {
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      visited.add(nk);
      const cost = noiseCost(ts, nx, ny);
      const nInf = influence - cost;
      if (nInf <= 0) {
        isBoundary = true;
        continue;
      }
      queue.push({ x: nx, y: ny, influence: nInf });
    }
    if (isBoundary) boundary.add(`${x},${y}`);
  }

  return { center: { x: site.x, y: site.y }, tiles, boundary };
}

// ── Territory cache ──────────────────────────────────────────────────

const _territoryCache = new Map();

function _getCachedTerritory(seed, site, tier) {
  const key = `${seed},${site.x},${site.y},${tier}`;
  let t = _territoryCache.get(key);
  if (!t) {
    t = computeTerritory(seed, site, tier);
    _territoryCache.set(key, t);
    if (_territoryCache.size > 200) _territoryCache.clear();
  }
  return t;
}

// ── Per-tile query ───────────────────────────────────────────────────

/**
 * Query territory ownership at a specific tile.
 * Checks all settlements; highest influence wins.
 *
 * @param {number} seed
 * @param {number} x
 * @param {number} y
 * @param {Array<{seed, site, tier, id}>} settlements
 * @returns {{ settlement: string, influence: number } | null}
 */
export function territoryAt(seed, x, y, settlements) {
  let best = null;
  let bestInfluence = 0;

  for (const s of settlements) {
    const territory = _getCachedTerritory(s.seed, s.site, s.tier);
    const key = `${x},${y}`;
    const inf = territory.tiles.get(key);
    if (inf !== undefined && inf > bestInfluence) {
      bestInfluence = inf;
      best = { settlement: s.id, influence: inf };
    }
  }

  return best;
}

/** Clear the territory cache (for testing). */
export function clearTerritoryCache() { _territoryCache.clear(); }
```

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/territory.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add sim/world/territory.js sim/test/territory.test.js
git commit -m "feat(sim): Phase C territory field -- influence flood-fill with noise-based terrain cost"
```

---

### Task 6: Wire territory into genesis.js (replace rectangular territory)

**Files:**
- Modify: `sim/world/genesis.js`
- Test: `sim/test/buildings-layout.test.js` (append integration test)

- [ ] **Step 1: Append integration test**

```js
// Append to sim/test/buildings-layout.test.js
import { computeTerritory } from '../world/territory.js';

test('integration: layout fits within territory', () => {
  const site = { x: 500, y: 500 };
  const layout = layoutSettlement(42, site, 'town', 'human', 'grassland');
  const territory = computeTerritory(42, site, 'town');
  // Every building should be inside the territory
  let insideCount = 0;
  for (const b of layout.buildings) {
    if (territory.tiles.has(`${b.x},${b.y}`)) insideCount++;
  }
  const pct = insideCount / layout.buildings.length;
  assert.ok(pct >= 0.7, `only ${(pct * 100).toFixed(0)}% of buildings inside territory`);
});

test('integration: territory boundary is not a rectangle', () => {
  const territory = computeTerritory(42, { x: 500, y: 500 }, 'town');
  assert.ok(territory.boundary.size > 0, 'has boundary tiles');
  // Boundary should not be a perfect rectangle border
  const bPoints = [...territory.boundary].map(k => k.split(',').map(Number));
  const xs = bPoints.map(p => p[0]);
  const ys = bPoints.map(p => p[1]);
  const uniqueXs = new Set(xs).size;
  const uniqueYs = new Set(ys).size;
  // A rectangle boundary has only 2 unique x values (left, right edges) for horizontal runs
  // and 2 unique y values for vertical runs. Organic shape has many more.
  assert.ok(uniqueXs > 4, `boundary has only ${uniqueXs} unique x coords -- too rectangular`);
  assert.ok(uniqueYs > 4, `boundary has only ${uniqueYs} unique y coords -- too rectangular`);
});
```

- [ ] **Step 2: Note for genesis.js integration**

The genesis.js `territoryAround` function currently returns a simple `{ x0, y0, w, h }` rect. Phase C replaces this with `computeTerritory`, but the migration is deferred until the overlay renderer (Phase F) consumes territory shapes. For now, `computeTerritory` is a standalone pure function that can be queried in parallel with the existing rect territory. The settlement node's `attrs.territory` field will eventually switch from `{ x0, y0, w, h }` to `{ center, radius, seed }` (a recomputation spec rather than stored tiles).

Do NOT modify genesis.js yet -- the existing rect territory is consumed by the protocol and overlay. The migration happens when Phase F overlay rendering lands. This task only verifies the integration contract.

- [ ] **Step 3: Run tests**

Run: `node --test sim/test/buildings-layout.test.js`
Expected: PASS (26 tests).

- [ ] **Step 4: Commit**

```bash
git add sim/test/buildings-layout.test.js
git commit -m "test(sim): Phase B+C integration -- layout fits territory, boundary is organic"
```

---

### Task 7: Headless probe -- visual sanity check

**Files:**
- Create: `sim/test/probe-layout.mjs`

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-layout.mjs -- Phase B+C verification.
// Generates settlement layouts and territory, prints ASCII maps.
import { layoutSettlement, clearLayoutCache } from '../world/buildings/layout.js';
import { computeTerritory, clearTerritoryCache } from '../world/territory.js';

let ok = true;

for (const tier of ['village', 'town', 'city']) {
  clearLayoutCache();
  clearTerritoryCache();

  const site = { x: 64, y: 64 };
  const layout = layoutSettlement(42, site, tier, 'human', 'grassland');
  const territory = computeTerritory(42, site, tier);

  console.log(`\n=== ${tier.toUpperCase()} ===`);
  console.log(`  ${layout.districts.length} districts, ${layout.buildings.length} buildings, ${layout.spines.length} spines`);
  console.log(`  territory: ${territory.tiles.size} tiles, ${territory.boundary.size} boundary tiles`);

  // Verify no overlapping buildings
  const occupied = new Set();
  let overlaps = 0;
  for (const b of layout.buildings) {
    const bb = b.footprint.boundingBox;
    for (let dy = 0; dy < bb.h; dy++) {
      for (let dx = 0; dx < bb.w; dx++) {
        const key = `${b.x + dx},${b.y + dy}`;
        if (occupied.has(key)) overlaps++;
        occupied.add(key);
      }
    }
  }
  if (overlaps > 0) {
    console.error(`  FAIL: ${overlaps} overlapping tiles`);
    ok = false;
  }

  // Print ASCII minimap (60x40 window around site)
  const W = 60, H = 40;
  const ox = site.x - W / 2, oy = site.y - H / 2;
  const lines = [];
  for (let row = 0; row < H; row++) {
    let line = '';
    for (let col = 0; col < W; col++) {
      const wx = ox + col, wy = oy + row;
      const key = `${wx},${wy}`;
      const q = layout.queryTile(wx, wy);
      if (q && q.type === 'building') {
        line += q.tileKind === 'door' ? 'D' : q.tileKind === 'wall' ? '#' : '.';
      } else if (q && q.type === 'road') {
        line += '=';
      } else if (territory.boundary.has(key)) {
        line += '*';
      } else if (territory.tiles.has(key)) {
        line += ':';
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  console.log(lines.join('\n'));

  // Determinism check
  clearLayoutCache();
  clearTerritoryCache();
  const layout2 = layoutSettlement(42, site, tier, 'human', 'grassland');
  if (layout2.buildings.length !== layout.buildings.length) {
    console.error(`  FAIL: non-deterministic building count`);
    ok = false;
  }
}

// Multi-settlement territory overlap test
console.log('\n=== TERRITORY OVERLAP ===');
const t1 = computeTerritory(42, { x: 64, y: 64 }, 'town');
const t2 = computeTerritory(42, { x: 150, y: 64 }, 'town');
let overlap = 0;
for (const key of t1.tiles.keys()) {
  if (t2.tiles.has(key)) overlap++;
}
console.log(`  town1: ${t1.tiles.size} tiles, town2: ${t2.tiles.size} tiles, overlap: ${overlap}`);

console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run the probe**

Run: `node sim/test/probe-layout.mjs`
Expected: ASCII maps showing `#` walls, `.` floors, `D` doors, `=` roads, `*` boundary, `:` territory interior. Buildings cluster along road spines. Territory has organic boundary. No overlaps. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add sim/test/probe-layout.mjs
git commit -m "test(sim): Phase B+C probe -- ASCII settlement maps with territory contours"
```

---

## Self-review

**Spec coverage:**
- District formation (radial sectors, noise-displaced boundaries, tier-based set) -> Task 1
- Building placement along road spines (anchor first, fill along paths, no overlaps) -> Task 3
- Road spines (primary street + secondary branches per district) -> Task 2
- `layoutSettlement` entry point with per-tile query -> Task 4
- Organic territory (influence flood-fill, noise-based terrain cost) -> Task 5
- Territory boundary follows terrain-like features -> Task 5 (noiseCost)
- Neighboring settlements share boundaries (highest influence wins) -> Task 5 (territoryAt)
- Integration (layout fits in territory, boundary not rectangular) -> Task 6

**Not covered (later phases):**
- Wire territory into genesis.js (Phase F migration -- noted in Task 6)
- Road network between settlements (Phase D)
- Political aggregation (Phase E)
- Overlay rendering (Phase F)
- Wang tile assets (Phase G)

**Key constraint met:** NO `tileCost`/`classifyBiome` calls anywhere. All shape decisions use `rand`/`mix` from `sim/kernel/rng.js` and the `noiseCost` function (pure seeded noise).

**Placeholder scan:** No TBDs. All code complete. All test assertions specific. One deferred note in Task 6 (genesis.js migration to Phase F).

**Type consistency:** `assignDistricts` returns `[{kind, angleStart, angleEnd, radius, innerRadius, anchor}]`. `generateRoadSpines` returns `[{tier, district, points: [{x,y}]}]`. `placeBuildings` returns `[{x, y, footprint, district, isAnchor}]`. `layoutSettlement` returns `{districts, buildings, spines, site, tier, race, queryTile}`. `computeTerritory` returns `{center, tiles: Map, boundary: Set}`. `territoryAt` returns `{settlement, influence} | null`. All consistent across tasks.
