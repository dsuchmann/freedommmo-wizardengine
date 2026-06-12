# Pass 2 — M4: Blueprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nested blueprint grammar + building-level compilation: buildings become real wall/floor/door stamps on the world grid with footprint claims that suppress baseline flora — locked decisions 6 (buildings are spatial structures, never sprites) and 7 (claims + deterministic baseline + delta log).

**Architecture:** A pure grammar module (`sim/world/blueprints.js`) holds authored building templates (world-compiler schema, 2026-05-24) and deterministically expands a template at an origin into tile stamps, an absolute footprint, interior features, and npc-slot data. A compiler (`sim/world/construct.js`) turns an expansion into kernel nodes: one `building` node per leaf (carrying stamps/footprint), plus inert `matter` nodes for interior features — all under graph provenance rules (boot scope or causal event). `materializeRect` in `sim/world/wire.js` gains claim suppression: tiles inside any building footprint never materialize baseline placements. `serializeEntity` gains a `building` branch so clients receive the stamps. A probe test proves determinism, claim suppression, provenance enforcement, and reboot reproducibility.

**Tech Stack:** Plain ES modules, `node:test` + `node:assert/strict`. No new dependencies. No RNG needed anywhere in M4 (template + origin fully determine the expansion).

---

## Context for the implementer (read this first)

You are working in a deterministic simulation kernel (`sim/`). Key facts you must respect:

1. **Provenance is enforced.** `kernel.graph.createNode(...)` THROWS unless called inside `kernel.graph.boot(() => {...})` or given a `causeEventId` (sim/store/graph.js:22-25). The cause id is stored on the node as `node.createdByEvent`. Tests rely on this guard.
2. **`noFlux: true`** on `attrs` marks a node as metabolically inert — the kernel skips it for flux/rationing (sim/kernel/kernel.js:57). Buildings and interior features are inert.
3. **`kernel.stocks(tick)`** sums `attrs.E` for `type === 'matter'` nodes (sim/kernel/kernel.js:110-112). Interior features carry declared E (embodied time) like F3 pebbles — created at boot, they are part of the world's initial stocks, so the conservation identity is unaffected.
4. **`materializeRect(kernel, {x0,y0,w,h}, tick)`** in sim/world/wire.js materializes deterministic baseline placements (F3 matter / F4 living) per tile, skipping delta-suppressed and already-materialized keys. M4 adds a third skip: claimed tiles.
5. **The no-mock rule** governs *recipes* (discovered, never predefined — locked decision 5). Building *templates* are authored blueprint data — knowledge artifacts, like species definitions — and are explicitly allowed. Do NOT confuse the two.
6. **Honest absences in M4** (declared, not faked): no NPCs (npc_slots are carried as data only), no runtime construction verb (boot-time compilation only; runtime construction arrives with a later plan and will use a causal event — the provenance guard already supports it), no pathfinding/walkability consumer (the `walkable` flag is data for future movement), no settlement/district levels populated (the grammar supports nesting via `children`; only a small `compound` group exercises it).
7. **Determinism:** same template + origin → bit-identical expansion. There is no randomness in M4. Tests use `assert.deepEqual` on full structures.
8. **Run a single test file:** `node --test sim/test/blueprints.test.js`. Full suite: `npm test` (~8 min, 176 tests before M4) — only run the full suite at close-out, in the background.
9. Commit after each task with a conventional message and the trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. NEVER push to origin.

Coordinate conventions: tile coordinates are integers; a footprint at origin `(ox, oy)` with `width w, height h` covers tiles `ox..ox+w-1` × `oy..oy+h-1`. Sides: `north` = row `oy`, `south` = row `oy+h-1`, `west` = col `ox`, `east` = col `ox+w-1`. A door's `offset` counts tiles from the side's lowest coordinate (west→east for north/south walls, north→south for east/west walls).

---

### Task 1: Pure blueprint grammar — `sim/world/blueprints.js`

**Files:**
- Create: `sim/world/blueprints.js`
- Test: `sim/test/blueprints.test.js`

- [ ] **Step 1: Write the failing tests**

Create `sim/test/blueprints.test.js`:

```js
// sim/test/blueprints.test.js — M4: pure blueprint grammar (no kernel, no RNG).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUEPRINT_TEMPLATES, expandBlueprint } from '../world/blueprints.js';

test('templates: hut and forge are leaves with footprints; compound is a group with children', () => {
  assert.equal(BLUEPRINT_TEMPLATES.hut.footprint.width, 5);
  assert.equal(BLUEPRINT_TEMPLATES.hut.footprint.height, 4);
  assert.ok(Array.isArray(BLUEPRINT_TEMPLATES.compound.children));
  assert.equal(BLUEPRINT_TEMPLATES.compound.footprint, undefined, 'groups have no own footprint');
});

test('expand hut: perimeter walls, interior floor, door punched into south wall', () => {
  const ex = expandBlueprint('hut', 10, 20);
  // exactly one leaf
  assert.equal(ex.leaves.length, 1);
  const leaf = ex.leaves[0];
  assert.deepEqual(leaf.footprint, { x0: 10, y0: 20, w: 5, h: 4 });
  // stamp count: 5x4 footprint = 20 tiles, every tile stamped exactly once
  assert.equal(leaf.stamps.length, 20);
  const at = (x, y) => leaf.stamps.find(s => s.x === x && s.y === y);
  // corners are walls
  for (const [x, y] of [[10, 20], [14, 20], [10, 23], [14, 23]]) {
    assert.equal(at(x, y).piece, 'wall', `corner ${x},${y}`);
    assert.equal(at(x, y).walkable, false);
  }
  // door: south side (y = 20+4-1 = 23), offset 2 → x = 12
  assert.equal(at(12, 23).piece, 'door');
  assert.equal(at(12, 23).walkable, true);
  // interior tile is floor and walkable
  assert.equal(at(12, 21).piece, 'floor');
  assert.equal(at(12, 21).walkable, true);
  // material carried through from template
  assert.equal(at(10, 20).material, 'wattle');
  assert.equal(at(12, 21).material, 'dirt');
});

test('expand hut: interior features at absolute coordinates, inside the walls', () => {
  const ex = expandBlueprint('hut', 10, 20);
  const leaf = ex.leaves[0];
  const hearth = leaf.features.find(f => f.type === 'hearth');
  assert.deepEqual({ x: hearth.x, y: hearth.y }, { x: 11, y: 21 }, 'pos [1,1] relative to origin');
  assert.equal(hearth.provides, 'heat');
  // every feature sits on an interior (floor) tile
  for (const f of leaf.features) {
    const s = leaf.stamps.find(t => t.x === f.x && t.y === f.y);
    assert.equal(s.piece, 'floor', `feature ${f.type} on floor`);
  }
});

test('expand hut: npc slots carried as data', () => {
  const ex = expandBlueprint('hut', 0, 0);
  assert.deepEqual(ex.leaves[0].npcSlots, [{ role: 'resident', workplace: null, sleep: 'bedroll' }]);
});

test('expand forge: two doors on different sides are both walkable openings', () => {
  const ex = expandBlueprint('forge', 0, 0);
  const leaf = ex.leaves[0];
  const doors = leaf.stamps.filter(s => s.piece === 'door');
  assert.equal(doors.length, 2);
  // south door: y = 4, x = 2; east door: x = 5, y = 2
  assert.ok(doors.some(d => d.x === 2 && d.y === 4));
  assert.ok(doors.some(d => d.x === 5 && d.y === 2));
});

test('expand compound: nesting — children expand at relative offsets, leaves are separate buildings', () => {
  const ex = expandBlueprint('compound', 100, 50);
  assert.equal(ex.leaves.length, 2);
  const hut = ex.leaves.find(l => l.template === 'hut');
  const forge = ex.leaves.find(l => l.template === 'forge');
  assert.deepEqual(hut.footprint, { x0: 100, y0: 50, w: 5, h: 4 });
  assert.deepEqual(forge.footprint, { x0: 107, y0: 50, w: 6, h: 5 }, 'child offset dx=7 applied');
});

test('determinism: identical calls are bit-identical', () => {
  assert.deepEqual(expandBlueprint('compound', 3, 7), expandBlueprint('compound', 3, 7));
});

test('unknown template throws', () => {
  assert.throws(() => expandBlueprint('castle', 0, 0), /unknown blueprint/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/blueprints.test.js`
Expected: FAIL — `Cannot find module '../world/blueprints.js'`

- [ ] **Step 3: Implement `sim/world/blueprints.js`**

```js
// sim/world/blueprints.js — M4: nested blueprint grammar (locked decision 6).
// Buildings are walls/floors/doors stamped on the world grid — NEVER house-sprites.
// Templates are authored DATA in the world-compiler building-template schema
// (docs 2026-05-24-world-compiler-design.md). The no-mock rule forbids predefined
// RECIPES (locked decision 5); blueprint templates are knowledge artifacts like
// species definitions and are explicitly allowed.
// Grammar levels region→settlement→district are honest absences in M4: the
// `children` mechanism supports them structurally (see 'compound'), but only
// building→wall-section is populated. Settlements arrive with a later plan.

/** Building templates — world-compiler schema shape. */
export const BLUEPRINT_TEMPLATES = {
  hut: {
    template_id: 'hut', category: 'residence',
    footprint: { width: 5, height: 4 },
    walls: { material: 'wattle', doors: [{ side: 'south', offset: 2 }] },
    floor: { material: 'dirt' },
    interior_features: [
      { type: 'hearth', pos: [1, 1], provides: 'heat' },
      { type: 'bedroll', pos: [3, 1], provides: 'sleep' },
    ],
    npc_slots: [{ role: 'resident', workplace: null, sleep: 'bedroll' }],
  },
  forge: {
    template_id: 'forge', category: 'workshop',
    footprint: { width: 6, height: 5 },
    walls: { material: 'stone', doors: [{ side: 'south', offset: 2 }, { side: 'east', offset: 2 }] },
    floor: { material: 'stone' },
    interior_features: [
      { type: 'furnace', pos: [1, 1], provides: 'smelt' },
      { type: 'anvil', pos: [3, 2], provides: 'smith' },
    ],
    npc_slots: [{ role: 'smith', workplace: 'anvil', sleep: null }],
  },
  compound: {
    template_id: 'compound', category: 'group',
    children: [
      { template: 'hut', dx: 0, dy: 0 },
      { template: 'forge', dx: 7, dy: 0 },
    ],
  },
};

/** Absolute (x, y) of a door given footprint origin + size. */
function doorXY(side, offset, ox, oy, w, h) {
  switch (side) {
    case 'north': return [ox + offset, oy];
    case 'south': return [ox + offset, oy + h - 1];
    case 'west':  return [ox, oy + offset];
    case 'east':  return [ox + w - 1, oy + offset];
    default: throw new Error(`unknown door side '${side}'`);
  }
}

/** Expand one LEAF template into stamps/features at absolute coordinates. */
function expandLeaf(template, ox, oy) {
  const { width: w, height: h } = template.footprint;
  const doors = new Map(); // "x,y" -> true
  for (const d of template.walls.doors ?? []) {
    const [dx, dy] = doorXY(d.side, d.offset, ox, oy, w, h);
    doors.set(`${dx},${dy}`, true);
  }
  const stamps = [];
  for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) {
    const perimeter = x === ox || x === ox + w - 1 || y === oy || y === oy + h - 1;
    if (!perimeter) {
      stamps.push({ x, y, piece: 'floor', material: template.floor.material, walkable: true });
    } else if (doors.has(`${x},${y}`)) {
      stamps.push({ x, y, piece: 'door', material: template.walls.material, walkable: true });
    } else {
      stamps.push({ x, y, piece: 'wall', material: template.walls.material, walkable: false });
    }
  }
  const features = (template.interior_features ?? []).map(f => ({
    type: f.type, x: ox + f.pos[0], y: oy + f.pos[1], provides: f.provides,
  }));
  return {
    template: template.template_id,
    footprint: { x0: ox, y0: oy, w, h },
    stamps, features,
    npcSlots: structuredClone(template.npc_slots ?? []),
  };
}

/** Deterministically expand a blueprint at an origin.
 *  Returns { leaves: [...] } — one leaf per physical building (groups recurse). */
export function expandBlueprint(templateId, ox, oy) {
  const template = BLUEPRINT_TEMPLATES[templateId];
  if (!template) throw new Error(`unknown blueprint '${templateId}'`);
  if (template.children) {
    const leaves = [];
    for (const c of template.children) {
      leaves.push(...expandBlueprint(c.template, ox + c.dx, oy + c.dy).leaves);
    }
    return { leaves };
  }
  return { leaves: [expandLeaf(template, ox, oy)] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/blueprints.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add sim/world/blueprints.js sim/test/blueprints.test.js
git commit -m "feat(sim): M4 blueprint grammar — templates + deterministic nested expansion

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Blueprint compilation — `sim/world/construct.js`

**Files:**
- Create: `sim/world/construct.js`
- Test: `sim/test/construct.test.js`

- [ ] **Step 1: Write the failing tests**

Create `sim/test/construct.test.js`:

```js
// sim/test/construct.test.js — M4: compileBlueprint creates real kernel nodes under provenance rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { compileBlueprint } from '../world/construct.js';

function makeKernel(seed = 7) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 32, h: 32 } });
}

test('compile hut at boot: one building node with stamps + footprint, noFlux', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  assert.equal(buildings.length, 1);
  const b = buildings[0];
  assert.equal(b.type, 'building');
  assert.equal(b.attrs.noFlux, true);
  assert.deepEqual(b.attrs.footprint, { x0: 4, y0: 4, w: 5, h: 4 });
  assert.equal(b.attrs.stamps.length, 20);
  assert.equal(b.attrs.template, 'hut');
  assert.deepEqual(b.attrs.npcSlots, [{ role: 'resident', workplace: null, sleep: 'bedroll' }]);
});

test('compile hut: interior features become inert matter nodes with declared E, linked to building', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  const features = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.building === buildings[0].id);
  assert.equal(features.length, 2);
  const hearth = features.find(f => f.attrs.archetype === 'hearth');
  assert.ok(hearth, 'hearth materialized');
  assert.deepEqual({ x: hearth.x, y: hearth.y }, { x: 5, y: 5 });
  assert.equal(hearth.attrs.noFlux, true);
  assert.ok(hearth.attrs.E > 0, 'features carry declared embodied time');
  assert.equal(hearth.attrs.provides, 'heat');
});

test('compile compound: one building node PER LEAF (groups are not entities)', () => {
  const k = makeKernel();
  let buildings;
  k.graph.boot(() => { buildings = compileBlueprint(k, 'compound', { x: 2, y: 2 }, 0); });
  assert.equal(buildings.length, 2);
  const types = [...k.graph.nodes.values()].filter(n => n.type === 'building');
  assert.equal(types.length, 2, 'no third group node');
});

test('provenance enforced: compiling outside boot without causeEventId throws', () => {
  const k = makeKernel();
  assert.throws(() => compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0), /provenance/);
});

test('provenance: causal event id is recorded on building and feature nodes', () => {
  const k = makeKernel();
  // ledger.emit (sim/store/ledger.js:12) returns the new event ID (a number).
  const evId = k.ledger.emit({ tick: 0, type: 'construct', actor: null, targets: [], magnitude: 0, attrs: { template: 'hut' } });
  const buildings = compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0, evId);
  assert.equal(buildings[0].createdByEvent, evId);
  const features = [...k.graph.nodes.values()]
    .filter(n => n.type === 'matter' && n.attrs.building === buildings[0].id);
  for (const f of features) assert.equal(f.createdByEvent, evId);
});

test('stocks include feature E; building node itself holds no stock', () => {
  const k = makeKernel();
  k.graph.boot(() => { compileBlueprint(k, 'hut', { x: 4, y: 4 }, 0); });
  const s = k.stocks(0);
  // hut features: hearth 150 + bedroll 60 (FEATURE_E table)
  assert.equal(s, 210);
});

test('determinism: two kernels, same compile → deepEqual building attrs', () => {
  const mk = () => {
    const k = makeKernel();
    let b;
    k.graph.boot(() => { b = compileBlueprint(k, 'compound', { x: 2, y: 2 }, 0); });
    return b.map(n => ({ type: n.type, x: n.x, y: n.y, attrs: n.attrs }));
  };
  assert.deepEqual(mk(), mk());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/construct.test.js`
Expected: FAIL — `Cannot find module '../world/construct.js'`

- [ ] **Step 3: Implement `sim/world/construct.js`**

```js
// sim/world/construct.js — M4: blueprint compilation → kernel nodes (locked decisions 6+7).
// One 'building' node per LEAF building (groups recurse, leave no node).
// Interior features are inert matter nodes with declared embodied time E,
// exactly like F3 baseline matter — created at boot they are part of initial stocks,
// so the conservation identity is untouched.
// Provenance: must run inside kernel.graph.boot() (baseline) OR with a causeEventId
// (future runtime construction). graph.createNode enforces this (spec §5.4).
// Honest absence: npc_slots are data only (no NPCs yet); walkable flags are data only
// (no movement consumer yet); there is no runtime 'construct' verb in M4.
import { expandBlueprint } from './blueprints.js';

/** Declared embodied time (tu) per interior-feature archetype. Coarse, declared, conserved. */
export const FEATURE_E = { hearth: 150, bedroll: 60, furnace: 300, anvil: 250, default: 100 };

/** Compile a blueprint at an origin into kernel nodes. Returns the building nodes (one per leaf). */
export function compileBlueprint(kernel, templateId, { x, y }, tick, causeEventId = null) {
  const { leaves } = expandBlueprint(templateId, x, y);
  const buildings = [];
  for (const leaf of leaves) {
    const building = kernel.graph.createNode({
      type: 'building', tick, x: leaf.footprint.x0, y: leaf.footprint.y0, causeEventId,
      attrs: {
        template: leaf.template, footprint: leaf.footprint, stamps: leaf.stamps,
        npcSlots: leaf.npcSlots, noFlux: true,
      },
    });
    for (const f of leaf.features) {
      kernel.graph.createNode({
        type: 'matter', tick, x: f.x, y: f.y, causeEventId,
        attrs: {
          archetype: f.type, E: FEATURE_E[f.type] ?? FEATURE_E.default,
          provides: f.provides, building: building.id, noFlux: true,
        },
      });
    }
    buildings.push(building);
  }
  return buildings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/construct.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add sim/world/construct.js sim/test/construct.test.js
git commit -m "feat(sim): M4 compileBlueprint — building + feature nodes under provenance rules

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Footprint claims suppress baseline — `sim/world/wire.js`

**Files:**
- Modify: `sim/world/wire.js` (function `materializeRect`, currently lines 29-68)
- Test: `sim/test/wire.test.js` (append tests)

Locked decision 7: large objects claim first, smaller fields fill remaining space. Buildings compiled BEFORE `materializeRect` claim their footprint tiles; placements on claimed tiles are never materialized. Claims are derived from `building` nodes in the graph (deterministic on reboot: world = f(seed, deltas), and boot-time buildings are part of the deterministic baseline).

- [ ] **Step 1: Write the failing tests**

Append to `sim/test/wire.test.js` (read the file first to match its existing helpers/imports — reuse its kernel-construction pattern; add `import { compileBlueprint } from '../world/construct.js';`):

```js
test('M4 claims: placements inside a building footprint are not materialized', () => {
  // Build two identical kernels over the same rect; one has a hut compiled first.
  // Any placement materialized in the bare kernel but missing in the claimed kernel
  // must lie inside the footprint; nothing outside the footprint may differ.
  const rect = { x0: 0, y0: 0, w: 16, h: 16 };
  const mk = withHut => {
    const k = new Kernel({ seed: 42, bounds: rect });
    k.graph.boot(() => {
      if (withHut) compileBlueprint(k, 'hut', { x: 6, y: 6 }, 0);
      materializeRect(k, rect, 0);
    });
    return k;
  };
  const bare = mk(false), claimed = mk(true);
  const placed = k => new Set([...k.graph.nodes.values()]
    .map(n => n.attrs?.placement).filter(Boolean));
  const bareNodes = [...bare.graph.nodes.values()].filter(n => n.attrs?.placement);
  const claimedKeys = placed(claimed);
  const fp = { x0: 6, y0: 6, w: 5, h: 4 };
  const inside = n => n.x >= fp.x0 && n.x < fp.x0 + fp.w && n.y >= fp.y0 && n.y < fp.y0 + fp.h;
  for (const n of bareNodes) {
    if (inside(n)) {
      assert.ok(!claimedKeys.has(n.attrs.placement),
        `claimed tile ${n.x},${n.y} must not materialize placement ${n.attrs.placement}`);
    } else {
      assert.ok(claimedKeys.has(n.attrs.placement),
        `unclaimed tile ${n.x},${n.y} must be unaffected by the claim`);
    }
  }
  // sanity: the seed actually produces ≥1 placement inside the footprint, else the test is vacuous
  assert.ok(bareNodes.some(inside),
    'seed 42 must place ≥1 baseline object inside the hut footprint — pick another seed/origin if not');
});

test('M4 claims: reboot reproducibility — claimed world rebuilds bit-identical from seed', () => {
  const rect = { x0: 0, y0: 0, w: 16, h: 16 };
  const mk = () => {
    const k = new Kernel({ seed: 42, bounds: rect });
    k.graph.boot(() => {
      compileBlueprint(k, 'compound', { x: 3, y: 3 }, 0);
      materializeRect(k, rect, 0);
    });
    return [...k.graph.nodes.values()]
      .map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, attrs: n.attrs }));
  };
  assert.deepEqual(mk(), mk());
});
```

If seed 42 / origin (6,6) yields no placement inside the footprint, adjust seed or origin until the sanity assertion passes (the claim test must not be vacuous).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/wire.test.js`
Expected: new tests FAIL — claimed tiles still materialize placements.

- [ ] **Step 3: Implement claim suppression in `materializeRect`**

In `sim/world/wire.js`, after the `existing` Set is built (line 38-39), add:

```js
  // Claims (locked decision 7): tiles inside any building footprint never materialize
  // baseline placements. Buildings must be compiled BEFORE materializeRect at boot;
  // claims are re-derived from the graph on every call, so reboot is reproducible.
  const claimed = new Set();
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building') continue;
    const fp = n.attrs.footprint;
    for (let yy = fp.y0; yy < fp.y0 + fp.h; yy++)
      for (let xx = fp.x0; xx < fp.x0 + fp.w; xx++) claimed.add(`${xx},${yy}`);
  }
```

And in the placement loop, extend the skip condition (line 44):

```js
      if (suppressed.has(p.key) || existing.has(p.key) || claimed.has(`${p.x},${p.y}`)) continue;
```

Also update the module header comment (lines 1-7) to mention claim suppression.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/wire.test.js`
Expected: all PASS (existing wire tests must still pass — no building nodes exist in them, so `claimed` is empty and behavior is unchanged)

- [ ] **Step 5: Commit**

```bash
git add sim/world/wire.js sim/test/wire.test.js
git commit -m "feat(sim): M4 footprint claims — buildings suppress baseline placements (locked decision 7)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire protocol + probe — `serializeEntity` building branch, `probe-blueprints.test.js`

**Files:**
- Modify: `sim/server/protocol.js` (function `serializeEntity`, line 52)
- Test: `sim/test/protocol.test.js` (append), Create: `sim/test/probe-blueprints.test.js`

- [ ] **Step 1: Write the failing protocol test**

Append to `sim/test/protocol.test.js` (read the file first to match its existing patterns):

```js
test('serializeEntity: building → id/type/x/y/template/footprint/stamps; npcSlots stay private', () => {
  const node = {
    id: 9, type: 'building', x: 4, y: 4,
    attrs: {
      template: 'hut', footprint: { x0: 4, y0: 4, w: 5, h: 4 },
      stamps: [{ x: 4, y: 4, piece: 'wall', material: 'wattle', walkable: false }],
      npcSlots: [{ role: 'resident', workplace: null, sleep: 'bedroll' }],
      noFlux: true,
    },
  };
  const s = serializeEntity(node, 0);
  assert.deepEqual(s, {
    id: 9, type: 'building', x: 4, y: 4, template: 'hut',
    footprint: { x0: 4, y0: 4, w: 5, h: 4 },
    stamps: [{ x: 4, y: 4, piece: 'wall', material: 'wattle', walkable: false }],
  });
  assert.equal(s.npcSlots, undefined, 'npc slots are sim-internal, not render-relevant');
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test sim/test/protocol.test.js`
Expected: FAIL — building falls through to the living-entity branch (`stageAt(undefined, ...)` or wrong shape).

- [ ] **Step 3: Implement the building branch**

In `sim/server/protocol.js`, inside `serializeEntity`, after the `recipe` branch (line 56):

```js
  if (node.type === 'building') {
    // Stamps are the render truth: walls/floors/doors on the grid, never sprites (locked decision 6).
    const { template, footprint, stamps } = node.attrs;
    return { id: node.id, type: 'building', x: node.x, y: node.y, template, footprint, stamps };
  }
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test sim/test/protocol.test.js`
Expected: all PASS

- [ ] **Step 5: Write the probe**

Create `sim/test/probe-blueprints.test.js`:

```js
// sim/test/probe-blueprints.test.js — M4 probe: a compiled compound in a living world.
// Boot world with baseline flora + a compound (hut+forge); assert claims, serialization,
// conservation, and double-boot determinism end-to-end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { compileBlueprint } from '../world/construct.js';
import { materializeRect } from '../world/wire.js';
import { serializeEntity } from '../server/protocol.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 0, y0: 0, w: 24, h: 24 };

function bootWorld(seed = 42) {
  const k = new Kernel({ seed, bounds: RECT });
  let buildings;
  k.graph.boot(() => {
    buildings = compileBlueprint(k, 'compound', { x: 8, y: 8 }, 0);
    materializeRect(k, RECT, 0);
  });
  return { k, buildings };
}

test('probe M4: buildings exist as stamped structures; no placement node inside any footprint', () => {
  const { k, buildings } = bootWorld();
  assert.equal(buildings.length, 2);
  const fps = buildings.map(b => b.attrs.footprint);
  const inAnyFp = n => fps.some(fp =>
    n.x >= fp.x0 && n.x < fp.x0 + fp.w && n.y >= fp.y0 && n.y < fp.y0 + fp.h);
  for (const n of k.graph.nodes.values()) {
    if (n.attrs?.placement) assert.ok(!inAnyFp(n), `placement node at ${n.x},${n.y} violates a claim`);
  }
});

test('probe M4: serialized buildings carry full stamp lists; doors are walkable openings', () => {
  const { k, buildings } = bootWorld();
  for (const b of buildings) {
    const s = serializeEntity(k.graph.nodes.get(b.id), 0);
    assert.equal(s.type, 'building');
    assert.equal(s.stamps.length, s.footprint.w * s.footprint.h, 'every footprint tile stamped');
    assert.ok(s.stamps.some(t => t.piece === 'door' && t.walkable === true), 'door present');
    assert.equal(s.npcSlots, undefined);
  }
});

test('probe M4: conservation — world runs a day; total stocks change only by ledger identity', () => {
  const { k } = bootWorld();
  const s0 = k.stocks(0);
  k.runTo(1 * DAY);
  const s1 = k.stocks(k.tick);
  const led = k.ledger.totals;   // plain object property (sim/store/ledger.js:9), NOT a method
  // identity: stocks(t) = stocks(0) + influx - burned ... reuse the suite's standard identity.
  // Read sim/test/probe-conservation.test.js for the exact identity used in this suite and
  // assert the same identity here (buildings/features are noFlux and must not break it).
  assert.ok(Number.isFinite(s0) && Number.isFinite(s1));
});

test('probe M4: double boot determinism — full serialized world is bit-identical', () => {
  const snap = () => {
    const { k } = bootWorld();
    return [...k.graph.nodes.values()].map(n => serializeEntity(n, 0));
  };
  assert.deepEqual(snap(), snap());
});
```

NOTE for the implementer: the conservation test above is a SKETCH — open `sim/test/probe-conservation.test.js`, copy the exact conservation identity it asserts (ledger counter names and the equation), and assert that identity here after `runTo(1*DAY)`. The point of the test: adding noFlux buildings/features must not break the time-conservation identity. Do not leave the weak `Number.isFinite` assertion as the only check.

- [ ] **Step 6: Run, verify PASS**

Run: `node --test sim/test/probe-blueprints.test.js`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add sim/server/protocol.js sim/test/protocol.test.js sim/test/probe-blueprints.test.js
git commit -m "feat(sim): M4 building wire serialization + blueprint probe

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Close-out — full suite, roadmap, deviations

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` (M4 row)
- Modify: `docs/superpowers/plans/2026-06-12-pass2-m4-blueprints.md` (this file — deviations section)

- [ ] **Step 1: Run the FULL suite in the background**

Run: `npm test` (background, ~8-9 min). Expected: every test passes (176 pre-M4 + new M4 tests).

- [ ] **Step 2: Record deviations**

Append a `## Deviations (canonical)` section to this plan doc listing every place the implementation diverged from the plan text and why (the deviations section is authoritative over the task bodies above).

- [ ] **Step 3: Update roadmap**

Set the M4 row status to DONE with the final test count.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass2-m4-blueprints.md
git commit -m "docs(sim): M4 blueprints close-out — roadmap DONE, deviations recorded

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Out of scope (honest absences, declared)

- **Settlements/districts/regions**: grammar supports nesting; population of those levels is P4 (roadmap).
- **Runtime construction verb**: no `build` intent; provenance path (`causeEventId`) is tested and ready.
- **NPCs**: `npc_slots` carried as data only.
- **Walkability/pathfinding**: `walkable` is data; no movement consumer exists yet.
- **Client rendering of stamps**: serialization only; renderer work is a later plan.
- **Building damage/destruction**: buildings have no hp; M2's strike() does not target buildings yet.

## Seams for later plans

- M5 (Items & Equipment): interior features are matter nodes with archetypes (`hearth`, `furnace`...) that have no ARCHETYPE_YIELD entries — same documented seam as M3's composite/ruined items; must be addressed if they become takeable.
- Settlement plan (P4): expandBlueprint's `children` mechanism is the extension point; settlement templates add a layout solver between district and building levels.
- Runtime construction: `compileBlueprint(kernel, id, pos, tick, causeEventId)` already accepts the causal event; the future `build` verb supplies it and must also write claim deltas for newly-claimed tiles if construction happens after materialization (post-hoc claims cannot retro-suppress already-materialized nodes — that plan must decide whether construction clears or is blocked by occupants).
