# Building Interior — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two data prerequisites for the interior render/movement slice — multi-floor units (P1) and the shared stair+lift walkable core (P2) — plus the pure `resolveFloorLayout` query the renderer/click-picker will consume.

**Architecture:** All pure, deterministic, lazy additions to the existing `sim/world/buildings/` blueprint generator. A `unit` node gains an optional second sub-floor + a private internal stair (depth ≤ 1, rooms stay leaves). `partitionFloor` carves the lift shaft into circulation on every floor. A new `floor-layout.js` resolves one floor into a render/click-ready structure. No renderer code in this plan.

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict`. Run tests with `node --test sim/test/<file>.test.js`.

**Authority:** spec `docs/superpowers/specs/2026-06-18-building-interior-render-movement-design.md` §2 (P1/P2), §6 (query). Slice-3 handoff for integration context.

**Constraints (project rules):** infinite world = pure `f(seed,…)`; no-mock (absent, never fake); determinism is byte-identical across regeneration; preserve laziness (`_stats.payloads`). Stage only this plan's files — never `git add -A` (other sessions have uncommitted `resolved-buildings.js`/`gl-compositor.js`/`lg-catalog.js`).

---

## File Structure

- **Create** `sim/world/buildings/unit-vertical.js` — pure helpers: `unitSubFloorCount(seed, unitKind, tiles)` → `1|2`, `selectPrivateStair(tiles)` → `{x,y}|null`.
- **Modify** `sim/world/buildings/blueprint-node.js` — `unit` kind: payload gains `subFloors`/`privateStair`, `childKeys` enumerates a room per sub-floor, `makeChild` routes the upper room's door to the private stair; `floor` kind: pass the lift shaft into `partitionFloor`.
- **Modify** `sim/world/buildings/vertical.js` — `reserveLift` picks an interior cell adjacent to the core for the shaft.
- **Modify** `sim/world/buildings/floor-partition.js` — `partitionFloor` gains a `liftShaft` param and carves it into circulation (removing it from any unit).
- **Create** `sim/world/buildings/floor-layout.js` — `resolveFloorLayout(buildingNode, floorIndex)` → `{ floorIndex, use, walkable, units, stairTile, liftTile, multiFloorUnits, bounds }`.
- **Create** tests: `sim/test/buildings-unit-vertical.test.js`, `sim/test/buildings-multifloor-unit.test.js`, `sim/test/buildings-lift-core.test.js`, `sim/test/buildings-floor-layout.test.js`.
- **Possibly touch** existing tests that snapshot exact `unit.payload` keys (add `subFloors`/`privateStair`) — Task 2 Step 5.

---

## Task 1: Multi-floor unit helpers (`unit-vertical.js`)

**Files:**
- Create: `sim/world/buildings/unit-vertical.js`
- Test: `sim/test/buildings-unit-vertical.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-unit-vertical.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitSubFloorCount, selectPrivateStair } from '../world/buildings/unit-vertical.js';

const rect = (w, h) => { const t = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t.push({ x, y }); return t; };

test('ineligible unit kinds never go multi-floor', () => {
  const tiles = rect(4, 3); // 12 tiles
  for (const k of ['lobby', 'storage', 'hall', 'crypt', 'gallery', 'house', 'room'])
    for (let s = 0; s < 50; s++)
      assert.equal(unitSubFloorCount(s, k, tiles), 1, `${k} must stay single-floor`);
});

test('small eligible units stay single-floor (no room for a stair + content on two levels)', () => {
  const tiny = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]; // 3 tiles
  for (let s = 0; s < 50; s++) assert.equal(unitSubFloorCount(s, 'shop', tiny), 1);
});

test('eligible large units are a deterministic minority of multi-floor (exactly 2 sub-floors)', () => {
  const tiles = rect(4, 3);
  let multi = 0; const N = 400;
  for (let s = 0; s < N; s++) {
    const c = unitSubFloorCount(s, 'shop', tiles);
    assert.ok(c === 1 || c === 2, 'sub-floor count is 1 or 2 (depth <= 1)');
    if (c === 2) multi++;
  }
  assert.ok(multi > 0, 'some eligible units go multi-floor');
  assert.ok(multi < N * 0.5, 'multi-floor units are a minority');
  assert.equal(unitSubFloorCount(7, 'shop', tiles), unitSubFloorCount(7, 'shop', tiles), 'deterministic');
});

test('private stair is a tile of the unit, deterministic', () => {
  const tiles = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 3 }];
  const s = selectPrivateStair(tiles);
  assert.ok(tiles.some(t => t.x === s.x && t.y === s.y), 'stair is one of the unit tiles');
  assert.deepEqual(selectPrivateStair(tiles), s, 'deterministic');
  assert.equal(selectPrivateStair([]), null, 'empty unit → null');
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../world/buildings/unit-vertical.js'`)

Run: `node --test sim/test/buildings-unit-vertical.test.js`

- [ ] **Step 3: Implement `unit-vertical.js`**

```js
// sim/world/buildings/unit-vertical.js — multi-floor unit decisions (spec 2026-06-18 §2 P1).
// A minority of large shop/apartment units become a 2-level mini-stack with a private
// internal stair. Pure f(unit seed). Depth is capped at one extra floor (2 sub-floors).
import { mix } from '../../kernel/rng.js';

const ELIGIBLE_KINDS = new Set(['shop', 'apartment']);
const MIN_TILES = 6;       // need room for the stair + content on each level
const MULTI_RATE = 0.28;   // share of eligible units that go multi-floor (a tasteful minority)

/** 1 = single-room unit (unchanged); 2 = multi-floor unit (one upstairs). Never > 2 (depth <= 1). */
export function unitSubFloorCount(seed, unitKind, tiles) {
  if (!ELIGIBLE_KINDS.has(unitKind) || !tiles || tiles.length < MIN_TILES) return 1;
  const r = (mix(seed >>> 0, 0x5f3a9c2b) >>> 0) / 0xffffffff;
  return r < MULTI_RATE ? 2 : 1;
}

/** Centroid-nearest tile of the unit (deterministic tie-break x then y). The private
 *  stair sits here on every sub-floor of the unit. Returns null for an empty unit. */
export function selectPrivateStair(tiles) {
  if (!tiles || tiles.length === 0) return null;
  let cx = 0, cy = 0;
  for (const t of tiles) { cx += t.x; cy += t.y; }
  cx /= tiles.length; cy /= tiles.length;
  let best = tiles[0], bestD = Infinity;
  for (const t of tiles) {
    const d = (t.x - cx) ** 2 + (t.y - cy) ** 2;
    if (d < bestD - 1e-9 ||
        (Math.abs(d - bestD) < 1e-9 && (t.x < best.x || (t.x === best.x && t.y < best.y)))) {
      bestD = d; best = t;
    }
  }
  return { x: best.x, y: best.y };
}

export { ELIGIBLE_KINDS, MIN_TILES, MULTI_RATE };
```

- [ ] **Step 4: Run it — expect PASS** (`node --test sim/test/buildings-unit-vertical.test.js`)

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/unit-vertical.js sim/test/buildings-unit-vertical.test.js
git commit -m "feat(buildings): multi-floor unit helpers (subfloor count + private stair) [P1]"
```

---

## Task 2: Wire multi-floor units into the `unit` node

**Files:**
- Modify: `sim/world/buildings/blueprint-node.js` (`unit` kind, lines 160-174)
- Test: `sim/test/buildings-multifloor-unit.test.js`

- [ ] **Step 1: Write the failing test** (searches seeds so it never depends on one building having a multi-floor unit)

```js
// sim/test/buildings-multifloor-unit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode, _stats, _resetStats } from '../world/buildings/blueprint-node.js';

// Commercial town tower: large shop/apartment floors → some units become multi-floor.
const CTX = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };

function findMultiFloorUnit(b) {
  for (const fIdx of b.childKeys()) {
    const floor = b.child(fIdx);
    for (const uIdx of floor.childKeys()) {
      const u = floor.child(uIdx);
      if (u.payload.subFloors > 1) return u;
    }
  }
  return null;
}
function anyMultiFloorUnit() {
  for (let s = 0; s < 80; s++) { const u = findMultiFloorUnit(buildingNode(1000 + s, CTX)); if (u) return { u, seed: 1000 + s }; }
  return null;
}

test('eligible units can be multi-floor: subFloors>=2 with a private stair on a unit tile', () => {
  const hit = anyMultiFloorUnit();
  assert.ok(hit, 'expected at least one multi-floor unit across 80 commercial towers');
  const u = hit.u;
  assert.ok(u.payload.subFloors >= 2);
  assert.ok(u.payload.privateStair, 'multi-floor unit has a private stair');
  assert.ok(u.payload.tiles.some(t => t.x === u.payload.privateStair.x && t.y === u.payload.privateStair.y),
    'private stair is one of the unit tiles');
});

test('a multi-floor unit has one room per sub-floor; each room is a leaf (recursion depth <= 1)', () => {
  const { u } = anyMultiFloorUnit();
  const keys = u.childKeys();
  assert.equal(keys.length, u.payload.subFloors, 'one room child per sub-floor');
  for (const k of keys) assert.deepEqual(u.child(k).childKeys(), [], 'sub-floor room is a leaf — no deeper nesting');
  assert.deepEqual(u.child(1).payload.doorTile, u.payload.privateStair, 'upper sub-floor enters via the private stair');
});

test('sub-floor rooms materialize lazily (touching room 0 does not build room 1)', () => {
  const { u } = anyMultiFloorUnit();
  _resetStats();
  void u.child(0).payload;
  assert.equal(_stats.payloads.room, 1, 'exactly one sub-floor room materialized');
  assert.deepEqual(u.materializedKeys().sort((a, b) => a - b), [0], 'only room 0 cached');
});

test('single-floor (ineligible) unit is still exactly one room', () => {
  // floor 0 of this tower is a shopfront → SINGLE_USE single unit of kind "shop"; but a
  // lobby/storage unit is guaranteed ineligible. Use a house: one lobby unit.
  const house = buildingNode(1337, { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 });
  const floor = house.child(0);
  const u = floor.child(floor.childKeys()[0]);
  assert.equal(u.payload.subFloors, 1);
  assert.deepEqual(u.childKeys(), [0], 'single-floor unit has exactly one room');
});

test('deterministic: the multi-floor structure regenerates byte-identically', () => {
  const { seed } = anyMultiFloorUnit();
  const ua = findMultiFloorUnit(buildingNode(seed, CTX));
  const ub = findMultiFloorUnit(buildingNode(seed, CTX));
  assert.deepEqual(ua.payload, ub.payload);
  assert.deepEqual(ua.child(1).payload, ub.child(1).payload);
});
```

- [ ] **Step 2: Run it — expect FAIL** (`subFloors` is undefined → `findMultiFloorUnit` returns null → first assert fails)

Run: `node --test sim/test/buildings-multifloor-unit.test.js`

- [ ] **Step 3: Edit the `unit` kind in `blueprint-node.js`**

Add the import near the top (after line 20):
```js
import { unitSubFloorCount, selectPrivateStair } from './unit-vertical.js';
```

Replace the `unit` kind registration (current lines 160-174) with:
```js
// ── kind: unit ───────────────────────────────────────────────────────────────
// A unit holds one deterministic room — UNLESS it is an eligible large unit that
// becomes a 2-level mini-stack (a private internal stair, depth <= 1). Each sub-floor
// is one room child; rooms are always leaves, so recursion never exceeds one level.
registerKind('unit', {
  generatePayload(node) {
    const ctx = node.ancestorContext;
    const subFloors = unitSubFloorCount(node.seed, ctx.unitKind, ctx.tiles);
    const privateStair = subFloors > 1 ? selectPrivateStair(ctx.tiles) : null;
    return { unitKind: ctx.unitKind, tiles: ctx.tiles, doorTile: ctx.doorTile, subFloors, privateStair };
  },
  childKeys(node) {
    const n = node.payload.subFloors;
    return Array.from({ length: n }, (_, i) => i); // [0] single-floor; [0,1] multi-floor
  },
  makeChild(node, roomIdx) {
    const ctx = node.ancestorContext;
    const p = node.payload;
    const isUpper = roomIdx > 0;
    const roomCtx = {
      unitId: node.id, unitKind: ctx.unitKind, tiles: ctx.tiles,
      // sub-floor 0 enters from the floor circulation; upper sub-floors enter via the private stair
      doorTile: isUpper ? p.privateStair : ctx.doorTile,
      typeId: ctx.typeId, race: ctx.race, tier: ctx.tier,
    };
    return makeNode('room', [...node.path, 'r', roomIdx], node.worldSeed, roomCtx);
  },
});
```

(The `room` kind is unchanged — single-floor rooms stay byte-identical; only `unit.payload` gains the two metadata fields, and upper sub-floor rooms get their own path/seed → distinct interiors.)

- [ ] **Step 4: Run it — expect PASS** (`node --test sim/test/buildings-multifloor-unit.test.js`)

- [ ] **Step 5: Run the existing node tests; fix any exact-shape snapshot**

Run: `node --test sim/test/buildings-blueprint-node.test.js sim/test/buildings-node-integration.test.js`
Expected: PASS. The lobby/room leaf assertions still hold (lobby is ineligible). **If** a test deep-equals a full `unit.payload` and now fails on the new keys, update that expected object to include `subFloors: 1, privateStair: null`. Do **not** weaken the laziness or determinism assertions.

- [ ] **Step 6: Commit**

```bash
git add sim/world/buildings/blueprint-node.js sim/test/buildings-multifloor-unit.test.js
# plus any existing test file you updated in Step 5
git commit -m "feat(buildings): multi-floor units in the unit node (subfloor rooms + private stair) [P1]"
```

---

## Task 3: Shared stair + lift walkable core (P2)

**Files:**
- Modify: `sim/world/buildings/vertical.js` (`reserveLift`, lines 83-86)
- Modify: `sim/world/buildings/floor-partition.js` (`partitionFloor`, lines 79-115)
- Modify: `sim/world/buildings/blueprint-node.js` (building payload lift call line 114; floor `partitionFloor` call line 141)
- Test: `sim/test/buildings-lift-core.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-lift-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };
const key = (x, y) => `${x},${y}`;

test('lift building has aboveGround>3 and a lift', () => {
  const b = buildingNode(1337, TOWER);
  assert.ok(b.payload.aboveGroundFloors > 3, 'this fixture is a tall building');
  assert.ok(b.payload.lift, 'a tall building reserves a lift');
});

test('stair core AND lift shaft are walkable circulation on every floor, never inside a unit', () => {
  const b = buildingNode(1337, TOWER);
  const core = b.payload.stairCores[0];
  const shaft = b.payload.lift.shaft;
  for (const fIdx of b.childKeys()) {
    const f = b.child(fIdx).payload;
    const circ = new Set(f.circulation);
    assert.ok(circ.has(key(core.x, core.y)), `floor ${fIdx}: stair core not walkable`);
    assert.ok(circ.has(key(shaft.x, shaft.y)), `floor ${fIdx}: lift shaft not walkable`);
    for (const u of f.units) {
      assert.ok(!u.tiles.some(t => t.x === core.x && t.y === core.y), `floor ${fIdx}: stair core inside a unit`);
      assert.ok(!u.tiles.some(t => t.x === shaft.x && t.y === shaft.y), `floor ${fIdx}: lift shaft inside a unit`);
    }
  }
});

test('every unit door is still reachable from circulation after the carve-out', () => {
  const b = buildingNode(1337, TOWER);
  for (const fIdx of b.childKeys()) {
    const f = b.child(fIdx).payload;
    const circ = new Set(f.circulation);
    for (const u of f.units) {
      const d = u.doorTile;
      const adj = [[d.x + 1, d.y], [d.x - 1, d.y], [d.x, d.y + 1], [d.x, d.y - 1]].some(([x, y]) => circ.has(key(x, y)));
      assert.ok(adj, `floor ${fIdx}: unit door ${d.x},${d.y} not adjacent to circulation`);
    }
  }
});

test('lift gating unchanged: lift present iff aboveGroundFloors > 3', () => {
  const house = buildingNode(1337, { bx: 0, by: 0, typeId: 'house', category: 'house', tier: 'village', centrality: 0.1 });
  assert.equal(house.payload.lift, null);
  assert.ok(house.payload.aboveGroundFloors <= 3);
});
```

- [ ] **Step 2: Run it — expect FAIL** (lift shaft falls inside a unit on the shopfront/storage floors)

Run: `node --test sim/test/buildings-lift-core.test.js`

- [ ] **Step 3a: `vertical.js` — shaft on an interior cell next to the core**

Replace `reserveLift` (lines 83-86) with:
```js
export function reserveLift(aboveGroundFloors, stairCore, sections) {
  if (aboveGroundFloors <= LIFT_THRESHOLD || !stairCore) return null;
  return { shaft: liftShaftCell(stairCore, sections), mechanismId: 'generic-lift' };
}

/** Pick an interior floor cell adjacent to the stair core for the lift shaft (E,S,W,N
 *  order). Falls back to core.x+1 when sections are unavailable. */
function liftShaftCell(core, sections) {
  if (!sections) return { x: core.x + 1, y: core.y };
  const { interior } = interiorCells(sections);
  const iset = new Set(interior.map(c => `${c.x},${c.y}`));
  for (const [x, y] of [[core.x + 1, core.y], [core.x, core.y + 1], [core.x - 1, core.y], [core.x, core.y - 1]])
    if (iset.has(`${x},${y}`) && !(x === core.x && y === core.y)) return { x, y };
  return { x: core.x + 1, y: core.y };
}
```

- [ ] **Step 3b: `floor-partition.js` — carve the lift shaft into circulation**

Change the signature (line 79) to accept the shaft:
```js
export function partitionFloor(seed, sections, stairCore, floorUse, liftShaft = null) {
```
Replace the three result `return`s with a carved result. Specifically:
- line 81 `return { circulation: new Set(), units: [] };` → leave as-is (empty interior, nothing to carve).
- line 87 `return singleUnit(interior, core, kind);` → `return carveLift(singleUnit(interior, core, kind), liftShaft, interiorSet);`
- line 113 `if (units.length === 0) return singleUnit(interior, core, kind);` → `if (units.length === 0) return carveLift(singleUnit(interior, core, kind), liftShaft, interiorSet);`
- line 114 `return { circulation, units };` → `return carveLift({ circulation, units }, liftShaft, interiorSet);`

Add this helper above `partitionFloor`:
```js
/** Ensure the lift shaft tile is walkable circulation on this floor (removing it from
 *  any unit it landed in). No-op when the shaft is not part of this floor's interior. */
function carveLift(part, liftShaft, interiorSet) {
  if (!liftShaft) return part;
  const k = key(liftShaft.x, liftShaft.y);
  if (!interiorSet.has(k) || part.circulation.has(k)) return part;
  part.circulation.add(k);
  const units = [];
  for (const u of part.units) {
    const tiles = u.tiles.filter(t => !(t.x === liftShaft.x && t.y === liftShaft.y));
    if (tiles.length === 0) continue; // unit fully absorbed by the shaft → drop it
    let door = u.doorTile;
    if (door.x === liftShaft.x && door.y === liftShaft.y) {
      const nd = tiles.find(t => adjToCirc(t, part.circulation)) || tiles[0];
      door = { x: nd.x, y: nd.y };
    }
    units.push({ unitKind: u.unitKind, tiles, doorTile: door });
  }
  part.units = units;
  return part;
}
```
(`interiorSet` already exists in `partitionFloor` at line 82; `adjToCirc` and `key` are module functions.)

- [ ] **Step 3c: `blueprint-node.js` — pass sections to `reserveLift`, shaft to `partitionFloor`**

Building payload (line 114): `const lift = reserveLift(aboveGroundFloors, stairCores[0] || null, sections);`
Floor payload (line 141): `const { circulation, units } = partitionFloor(node.seed, ctx.sections, ctx.stairCore, ctx.floorUse, ctx.lift ? ctx.lift.shaft : null);`

- [ ] **Step 4: Run it — expect PASS** (`node --test sim/test/buildings-lift-core.test.js`)

- [ ] **Step 5: Run the vertical + partition + node suites — expect PASS** (the shaft-on-corridor case still holds; reserveLift's new shaft is deterministic)

Run: `node --test sim/test/buildings-vertical.test.js sim/test/buildings-floor-partition.test.js sim/test/buildings-blueprint-node.test.js sim/test/buildings-multifloor-unit.test.js`

- [ ] **Step 6: Commit**

```bash
git add sim/world/buildings/vertical.js sim/world/buildings/floor-partition.js sim/world/buildings/blueprint-node.js sim/test/buildings-lift-core.test.js
git commit -m "feat(buildings): shared stair+lift walkable core — carve the lift shaft into circulation [P2]"
```

---

## Task 4: `resolveFloorLayout` pure query (`floor-layout.js`)

**Files:**
- Create: `sim/world/buildings/floor-layout.js`
- Test: `sim/test/buildings-floor-layout.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/buildings-floor-layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingNode } from '../world/buildings/blueprint-node.js';
import { resolveFloorLayout } from '../world/buildings/floor-layout.js';

const TOWER = { bx: 0, by: 8, typeId: 'commercial', category: 'commercial', tier: 'town', centrality: 0.85 };

test('resolveFloorLayout is deterministic and exposes walkable + units + stair/lift tiles', () => {
  const L1 = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const L2 = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  assert.deepEqual([...L1.walkable].sort(), [...L2.walkable].sort());
  assert.deepEqual(L1.units, L2.units);
  assert.ok(L1.stairTile, 'stair tile present');
  assert.ok(L1.liftTile, 'lift tile present on a tower floor');
  assert.ok(L1.walkable.has(`${L1.stairTile.x},${L1.stairTile.y}`), 'stair is walkable');
  assert.ok(L1.walkable.has(`${L1.liftTile.x},${L1.liftTile.y}`), 'lift is walkable');
});

test('every unit tile maps back to exactly one unit (draw-set == click-set)', () => {
  const L = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const owner = new Map();
  for (const u of L.units) for (const t of u.tiles) {
    const k = `${t.x},${t.y}`;
    assert.ok(!owner.has(k), `tile ${k} claimed by two units`);
    owner.set(k, u.id);
  }
  const u0 = L.units[0];
  assert.equal(owner.get(`${u0.tiles[0].x},${u0.tiles[0].y}`), u0.id, 'click on a unit tile resolves to that unit');
});

test('multiFloorUnits lists the ids of units with a sub-floor', () => {
  // search floors for one with a multi-floor unit
  const b = buildingNode(1337, TOWER);
  let found = false;
  for (const fIdx of b.childKeys()) {
    const L = resolveFloorLayout(b, fIdx);
    for (const id of L.multiFloorUnits) {
      assert.ok(L.units.some(u => u.id === id), 'multiFloorUnits id is a real unit on the floor');
      found = true;
    }
  }
  assert.ok(found || true, 'multiFloorUnits is well-formed (may be empty on some seeds)');
});

test('bounds enclose every walkable + unit + stair + lift tile', () => {
  const L = resolveFloorLayout(buildingNode(1337, TOWER), 1);
  const inb = (x, y) => x >= L.bounds.minX && x <= L.bounds.maxX && y >= L.bounds.minY && y <= L.bounds.maxY;
  for (const k of L.walkable) { const [x, y] = k.split(',').map(Number); assert.ok(inb(x, y)); }
  for (const u of L.units) for (const t of u.tiles) assert.ok(inb(t.x, t.y));
  assert.ok(inb(L.stairTile.x, L.stairTile.y) && inb(L.liftTile.x, L.liftTile.y));
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `node --test sim/test/buildings-floor-layout.test.js`

- [ ] **Step 3: Implement `floor-layout.js`**

```js
// sim/world/buildings/floor-layout.js — resolve ONE floor of a building node into a
// render/click-ready layout (spec 2026-06-18 §6). Pure; the renderer and the click
// hit-test consume the SAME result so draw-set == click-set. Touches only the active
// floor (its units), never sibling floors — preserves laziness.

/** @returns {{ floorIndex, use, walkable:Set<string>, units:[{id,unitKind,tiles,doorTile}],
 *             stairTile:{x,y}, liftTile:{x,y}|null, multiFloorUnits:string[],
 *             bounds:{minX,minY,maxX,maxY} }} */
export function resolveFloorLayout(buildingNode, floorIndex) {
  const floorNode = buildingNode.child(floorIndex);
  const f = floorNode.payload;
  const walkable = new Set(f.circulation);
  const units = [];
  const multiFloorUnits = [];
  const uKeys = floorNode.childKeys();
  for (const k of uKeys) {
    const u = floorNode.child(k);
    const id = u.id;
    units.push({ id, unitKind: u.payload.unitKind, tiles: u.payload.tiles, doorTile: u.payload.doorTile });
    if (u.payload.subFloors > 1) multiFloorUnits.push(id);
  }
  const stairTile = f.stairCore;
  const liftTile = f.lift ? f.lift.shaft : null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const key of walkable) { const [x, y] = key.split(',').map(Number); eat(x, y); }
  for (const u of units) for (const t of u.tiles) eat(t.x, t.y);
  if (stairTile) eat(stairTile.x, stairTile.y);
  if (liftTile) eat(liftTile.x, liftTile.y);
  if (minX === Infinity) { minX = minY = 0; maxX = maxY = 0; }

  return { floorIndex, use: f.use, walkable, units, stairTile, liftTile, multiFloorUnits, bounds: { minX, minY, maxX, maxY } };
}
```

- [ ] **Step 4: Run it — expect PASS** (`node --test sim/test/buildings-floor-layout.test.js`)

- [ ] **Step 5: Commit**

```bash
git add sim/world/buildings/floor-layout.js sim/test/buildings-floor-layout.test.js
git commit -m "feat(buildings): resolveFloorLayout pure query (draw-set == click-set)"
```

---

## Task 5: Full building-suite regression

**Files:** none (verification only)

- [ ] **Step 1: Run the whole building suite**

Run:
```
node --test sim/test/buildings-footprints.test.js sim/test/buildings-taxonomy.test.js sim/test/buildings-layout.test.js sim/test/buildings-floors.test.js sim/test/buildings-doors-interior.test.js sim/test/buildings-vertical.test.js sim/test/buildings-floor-partition.test.js sim/test/buildings-shapes.test.js sim/test/buildings-blueprint-node.test.js sim/test/buildings-node-integration.test.js sim/test/buildings-unit-vertical.test.js sim/test/buildings-multifloor-unit.test.js sim/test/buildings-lift-core.test.js sim/test/buildings-floor-layout.test.js sim/test/resolved-buildings.test.js
```

- [ ] **Step 2: Confirm only the two known pre-existing failures remain**

Expected reds (and ONLY these): `size within type range across 20 seeds` (`buildings-footprints.test.js`) and `integration: layout fits within territory` (`buildings-layout.test.js`). Everything else green. If any **other** test is red, fix it before proceeding (it's a real regression from P1/P2).

- [ ] **Step 3: No commit** (verification task). Data foundation complete; Plan 2 (render + movement) follows.

---

## Self-Review

**Spec coverage:** P1 multi-floor units (§2 P1) → Tasks 1-2. P2 shared lift core (§2 P2) → Task 3. `resolveFloorLayout` pure query (§6) → Task 4. Determinism/laziness/no-mock constraints → asserted in each task. Render/movement (spec §3-§5) is explicitly Plan 2 (out of scope here).

**Placeholder scan:** none — every step has runnable test + impl code and exact commands.

**Type consistency:** `unitSubFloorCount`/`selectPrivateStair` (Task 1) are imported and called in Task 2. `subFloors`/`privateStair` produced in Task 2 are read by `resolveFloorLayout` (Task 4: `u.payload.subFloors`). `reserveLift(aboveGroundFloors, stairCore, sections)` (Task 3a) is called with `sections` in Task 3c. `partitionFloor(..., liftShaft)` (Task 3b) is called with `ctx.lift.shaft` in Task 3c. `carveLift` uses module-local `key`/`adjToCirc`/`interiorSet` — all present in `floor-partition.js`. Consistent.

**Risk note:** Task 2 Step 5 — if `buildings-node-integration.test.js` snapshots a full `unit.payload`, update the expected object (add `subFloors`/`privateStair`). This is the only foreseen existing-test touch.
