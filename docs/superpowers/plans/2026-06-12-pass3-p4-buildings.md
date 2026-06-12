# Pass 3 P4 — Buildings as Structures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runtime building construction — a group pays pooled time to stamp a blueprint onto a deeded plot (or a district of its own settlement): walls become impassable claims, interior features become provenanced matter nodes, NPC slots resolve to tiles, baseline flora is suppressed under the footprint across reboots, and unmaintained buildings decay back to wilderness (features remain as ruins).

**Architecture:** New `sim/world/buildings.js` on the roads/crossings pattern (group R → nurture transfer → embodied E, condition + daily decay + maintain, suppression deltas). Reuses M4's `expandBlueprint` for geometry but does its own node creation because runtime construction must PAY for every tu of E (boot-path `compileBlueprint` mints E inside `graph.boot()` — reusing it at runtime would conjure time). Movement blocking lands in `move()` (actions.js); routing avoidance lands as `opts.blocked` in `planRoute` (routing stays pure — caller derives the wall set from the kernel).

**Tech Stack:** Node ESM, `node:test` + `node:assert/strict` (existing suite conventions).

**Branch:** `pass3-p4-buildings` (implementation in an isolated worktree — three sessions share the main checkout).

---

## Context for implementers (read once)

- **Conservation identity:** every tu in the world is Σ stocks; `transfer(amount, channel, ledger)` debits nothing — the CALLER debits the source (e.g. `group.R -= cost`) and `transfer` returns the delivered amount (lossy channel; loss counted in `ledger.totals.transferLoss`). Nurture channel efficiency is 0.95. See `sim/world/roads.js:45-54` for the exact pattern.
- **Provenance rule:** `kernel.graph.createNode` outside `graph.boot()` REQUIRES `causeEventId`. Emit the ledger event first, backpatch targets via `kernel.ledger.events[evId - 1].targets.push(id)`.
- **`kernel.stocks(tick)` is destructive** — call only at the current sim tick. It currently counts living R+body, corpse E, matter E, aggregates, inventory/equipment. It does NOT count `building` nodes — Task 2 fixes that (without it, construction destroys time and the identity fails).
- **Suppression deltas:** `wire.js materializeRect` skips placements with a delta of a REMOVAL kind (`taken/felled/destroyed/worn/paved`). Roads push `paved` deltas per tile placement and remove them on decay so flora regrows. Buildings do the same with a new `claimed` kind. The kinds set is MIRRORED in `src/sim/sim-world-state.js` — update both.
- **Boot buildings vs runtime buildings:** `sim/world/construct.js compileBlueprint` (M4) is the BOOT path — baseline buildings, no condition, claims derived by wire.js from the graph. This plan's `constructBuilding` is the RUNTIME path — paid, evented, decaying, delta-suppressed. Do not modify construct.js.
- **Honest absences (declared, do not "fix"):** labor-only construction (no materials consumed — empty grain yields, roads precedent); no NPCs occupy slots (Pass 4 Life); no sprite binding / roof-canopy alpha-fade (X1 asset lane — kernel-side headless-first per roadmap); runtime building nodes are not rehydrated on save/load (same backlog as roads/paths/settlements/crossings — leave the TODO comment).
- **O(n) scans are accepted** for `buildingStampAt`/`wallTiles` (roadAt/crossingAt backlog twins — note in comments, don't build an index).
- Run targeted tests with `node --test sim/test/<file>` from the repo root.

**GIT SAFETY (every subagent):** Work ONLY on branch `pass3-p4-buildings` in the assigned worktree. NEVER push to origin. NEVER rebase, reset --hard, force-push, or amend existing commits. NEVER stage `assets/`, `.claude/`, `.playwright-mcp/`, `scripts/bulk_generate*.py`, or `*_f4_state.json`. Commit only the files named in your task.

---

### Task 1: Explicit grain yields for interior-feature archetypes

`hearth/bedroll/furnace/anvil` currently fall through `ARCHETYPE_YIELD` longest-prefix matching to `default: { stone: 0.01 }` — taking or shattering a hearth would conjure stone grains from labor-only embodied time. Same fix as `ford`/`bridge`.

**Files:**
- Modify: `sim/matter/composition.js:17-33` (ARCHETYPE_YIELD)
- Test: `sim/test/composition.test.js` (append)

- [ ] **Step 1: Write the failing test** — append to `sim/test/composition.test.js`:

```js
test('interior-feature archetypes have explicit EMPTY yields (labor-only, no conjured stone)', () => {
  for (const arch of ['hearth', 'bedroll', 'furnace', 'anvil']) {
    const node = { type: 'matter', attrs: { archetype: arch, E: 100 } };
    assert.deepEqual(compositionOf(node), {},
      `${arch} must yield no grains — longest-prefix fallthrough to default would conjure stone`);
  }
});
```

(Match the file's existing import style; `compositionOf` is already imported there.)

- [ ] **Step 2: Run it to verify failure** — `node --test sim/test/composition.test.js` → the new test FAILS (yields `{ stone: 1 }`).

- [ ] **Step 3: Implement** — in `sim/matter/composition.js`, after the `bridge: {}` line add:

```js
  hearth:  {},       // P4 interior features: labor-only construction (roads/crossings precedent)
  bedroll: {},
  furnace: {},
  anvil:   {},
```

- [ ] **Step 4: Verify** — `node --test sim/test/composition.test.js sim/test/grains.test.js sim/test/probe-conservation.test.js` → all PASS.

- [ ] **Step 5: Commit** — `git add sim/matter/composition.js sim/test/composition.test.js && git commit -m "fix(matter): explicit empty grain yields for interior-feature archetypes"`

---

### Task 2: `stocks()` counts building embodied time

**Files:**
- Modify: `sim/kernel/kernel.js:108-134` (stocks)
- Test: `sim/test/kernel.test.js` (append)

- [ ] **Step 1: Write the failing test** — append to `sim/test/kernel.test.js`:

```js
test('stocks() counts building-node embodied time E', () => {
  const k = new Kernel({ seed: 1 });
  k.graph.boot(() => {
    k.graph.createNode({ type: 'building', tick: 0, x: 0, y: 0,
      attrs: { E: 400, footprint: { x0: 0, y0: 0, w: 5, h: 4 }, stamps: [], noFlux: true } });
  });
  assert.equal(k.stocks(0), 400, 'building E must be world stock or construction destroys time');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/kernel.test.js` → new test FAILS (stocks 0).

- [ ] **Step 3: Implement** — in `kernel.js stocks()`, after the `n.type === 'matter'` branch add:

```js
      } else if (n.type === 'building') {
        // P4 runtime buildings hold paid embodied time (boot buildings have no E → ?? 0).
        s += n.attrs.E ?? 0;
```

- [ ] **Step 4: Verify** — `node --test sim/test/kernel.test.js sim/test/probe-conservation.test.js sim/test/construct.test.js` → PASS (boot buildings have no `E` attr, so M4 tests are unaffected).

- [ ] **Step 5: Commit** — `git add sim/kernel/kernel.js sim/test/kernel.test.js && git commit -m "feat(kernel): stocks() counts building embodied time"`

---

### Task 3: `constructBuilding` — paid, evented, claim-suppressing runtime construction

**Files:**
- Create: `sim/world/buildings.js`
- Modify: `sim/world/wire.js:41` (REMOVAL_KINDS — add `'claimed'`)
- Modify: `src/sim/sim-world-state.js:5` (mirror — add `'claimed'`)
- Test: `sim/test/buildings.test.js` (create)

- [ ] **Step 1: Write the failing tests** — create `sim/test/buildings.test.js`:

```js
// sim/test/buildings.test.js — P4: runtime building construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, move } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { constructBuilding, maintainBuilding, buildingStampAt, wallTiles,
         BUILD_E_PER_STAMP, BUILDING_CONDITION_MAX, BUILDING_DECAY_PER_DAY,
         MAINTAIN_COST } from '../world/buildings.js';
import { FEATURE_E } from '../world/construct.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };

/** Boot a funded scenario: settlement founded, group g holds `fund` tu. Returns helpers. */
function scenario(fund = 2000) {
  const k = new Kernel({ seed: 7, bounds: RECT });
  let bush;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                         R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    materializeRect(k, RECT, 0);
  });
  const p = createPlayer(k, 0, { x: 941, y: 1 });
  const g = createGroup(k, 0, { x: 941, y: 0 });
  const player = k.graph.nodes.get(p.id);
  while (player.R < fund / 0.9 + 300) {
    if (pick(k, p.id, bush.id, 0) <= 0) break;
  }
  assert.equal(contribute(k, p.id, g.id, Math.ceil(fund / 0.9), 0), true, 'funding contribute');
  const group = k.graph.nodes.get(g.id);
  assert.ok(group.R >= fund, `group must hold ≥${fund}, has ${group.R}`);
  const site = findSettlementSite(k, RECT);
  const s = foundSettlement(k, g.id, site, 0);
  assert.ok(s, 'settlement founded');
  return { k, p, g, s };
}

/** First plot of settlement `s` whose rect contains NO materialized placement nodes. */
function clearPlot(k, s) {
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === s.id);
  assert.ok(plots.length >= 1, 'settlement has plots');
  outer: for (const plot of plots) {
    const r = plot.attrs.rect;
    for (const n of k.graph.nodes.values()) {
      if (n.attrs?.placement &&
          n.x >= r.x0 && n.x < r.x0 + r.w && n.y >= r.y0 && n.y < r.y0 + r.h) continue outer;
    }
    return plot;
  }
  return null;
}

test('constructBuilding: hut on an owned clear plot — paid, evented, conserved', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  assert.ok(plot, 'a clear plot exists in this geography (seed 7)');
  const group = k.graph.nodes.get(g.id);
  const rBefore = group.R;
  const stocksBefore = k.stocks(0);
  const tlBefore = k.ledger.totals.transferLoss;

  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b, 'construction succeeded');
  assert.equal(b.type, 'building');

  // Cost: 20 stamps × BUILD_E_PER_STAMP + hearth + bedroll.
  const cost = 20 * BUILD_E_PER_STAMP + FEATURE_E.hearth + FEATURE_E.bedroll;
  assert.equal(group.R, rBefore - cost, 'group paid exactly the declared cost');

  // Stamps: 5×4 footprint, perimeter walls, one south door, 6 interior floors.
  assert.equal(b.attrs.stamps.length, 20);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'door').length, 1);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'floor').length, 6);
  assert.equal(b.attrs.stamps.filter(st => st.piece === 'wall').length, 13);

  // Features: matter nodes with provenance, E paid through nurture.
  const feats = [...k.graph.nodes.values()].filter(n => n.attrs?.building === b.id);
  assert.equal(feats.length, 2);
  for (const f of feats) {
    assert.equal(f.type, 'matter');
    assert.ok(f.createdByEvent != null, 'feature has causal provenance');
  }

  // NPC slots resolved to tiles (Agency landing pad).
  assert.equal(b.attrs.npcSlots.length, 1);
  assert.equal(b.attrs.npcSlots[0].role, 'resident');
  assert.equal(b.attrs.npcSlots[0].workTile, null);
  const bedroll = feats.find(f => f.attrs.archetype === 'bedroll');
  assert.deepEqual(b.attrs.npcSlots[0].sleepTile, { x: bedroll.x, y: bedroll.y });

  // Ledger event with backpatched targets (building + 2 features).
  const ev = k.ledger.events.find(e => e.type === 'building_constructed');
  assert.ok(ev, 'building_constructed event emitted');
  assert.equal(ev.targets.length, 3);

  // Conservation: Δstocks == −ΔtransferLoss (nurture 0.95 losses only).
  const tlDelta = k.ledger.totals.transferLoss - tlBefore;
  assert.ok(Math.abs((k.stocks(0) - stocksBefore) + tlDelta) < 1e-6,
    'construction conserves time up to channel loss');
});

test('constructBuilding refusals are side-effect-free', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  const group = k.graph.nodes.get(g.id);
  const before = { R: group.R, nodes: k.graph.nodes.size, events: k.ledger.events.length,
                   deltas: k.deltas.list.length };
  // unknown template / compound (non-leaf) / missing group / unowned plot / underfunded
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'nope', 0), null);
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'compound', 0), null);
  assert.equal(constructBuilding(k, 999999, { plotId: plot.id }, 'hut', 0), null);
  const stolen = { ...plot.attrs }; plot.attrs.owner = 424242;
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null);
  plot.attrs.owner = stolen.owner;
  const saved = group.R; group.R = 1;
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null);
  group.R = saved;
  assert.deepEqual(
    { R: group.R, nodes: k.graph.nodes.size, events: k.ledger.events.length,
      deltas: k.deltas.list.length }, before, 'no refusal left a trace');
});

test('constructBuilding refuses an uncleared site and double-build', () => {
  const { k, g, s } = scenario();
  // Uncleared: a plot that has a materialized placement node inside it.
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === s.id);
  const dirty = plots.find(plot => {
    const r = plot.attrs.rect;
    return [...k.graph.nodes.values()].some(n => n.attrs?.placement &&
      n.x >= r.x0 && n.x < r.x0 + r.w && n.y >= r.y0 && n.y < r.y0 + r.h);
  });
  if (dirty) {
    assert.equal(constructBuilding(k, g.id, { plotId: dirty.id }, 'hut', 0), null,
      'occupied site must be cleared first (take/chop are the clearing verbs)');
  }
  // Double-build: same plot twice.
  const plot = clearPlot(k, s);
  assert.ok(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0));
  assert.equal(constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0), null,
    'footprint overlap refused');
});

test('claimed suppression deltas keep the footprint bare across reboot', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  // Reboot: world = f(seed, deltas). Claimed placements must not re-materialize.
  const k2 = new Kernel({ seed: 7, bounds: RECT });
  for (const d of k.deltas.list) k2.deltas.push({ ...d });
  k2.graph.boot(() => { materializeRect(k2, RECT, 0); });
  const fp = b.attrs.footprint;
  for (const n of k2.graph.nodes.values()) {
    if (!n.attrs?.placement) continue;
    assert.ok(!(n.x >= fp.x0 && n.x < fp.x0 + fp.w && n.y >= fp.y0 && n.y < fp.y0 + fp.h),
      `placement ${n.attrs.placement} re-materialized under the building`);
  }
});
```

Note: if the seed-7 geography leaves `clearPlot` null or no dirty plot, the implementer may instead clear a plot with the real `take`/`chop` verbs (see probe task) — do NOT hardcode coordinates.

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/buildings.test.js` → FAILS (module not found).

- [ ] **Step 3: Add `'claimed'` to both removal-kind sets.**

In `sim/world/wire.js` line 41:
```js
  const REMOVAL_KINDS = new Set(['taken', 'felled', 'destroyed', 'worn', 'paved', 'claimed']);
```
In `src/sim/sim-world-state.js` line 5:
```js
const REMOVAL_KINDS = new Set(['taken', 'felled', 'destroyed', 'worn', 'paved', 'claimed']);
```
(Keep the MIRRORED comments on both.)

- [ ] **Step 4: Create `sim/world/buildings.js`:**

```js
// sim/world/buildings.js — P4: runtime building construction (locked decision 6).
// A group pays pooled time (R) through the nurture channel to stamp a blueprint
// onto a deeded plot, or into a district of its own settlement: one 'building'
// node holding the stamp grid (walls/doors/floors + walkable flags), interior
// features as provenanced matter nodes (M2 pattern), NPC slots resolved to tiles
// (Agency's landing pad — data only, no NPCs until Pass 4 Life).
// Walls are impassable claims: move() refuses non-walkable stamps; planRoute
// avoids them via opts.blocked (routing stays pure — callers derive the wall set
// with wallTiles()). Footprint tiles get 'claimed' suppression deltas (roads
// 'paved' precedent) so baseline flora never materializes under a building,
// across reboots. Condition decays daily; an unmaintained building falls — its
// E returns to ambient ('decayed'), suppression heals (flora regrows), and the
// interior features REMAIN in place as loose ruins (takeable matter).
// This is the RUNTIME path; sim/world/construct.js compileBlueprint stays the
// BOOT path (mints E inside graph.boot — reusing it here would conjure time).
// HONEST ABSENCES: labor-only construction (empty grain yields — material-
// consuming construction is declared backlog, roads precedent); no sprite
// binding / roof-canopy fade (X1 asset lane).
// TODO(save/load): runtime building nodes are not rehydrated on load — claimed
// deltas persist but can then never heal (same backlog as roads/paths/
// settlements/crossings).
import { expandBlueprint, BLUEPRINT_TEMPLATES } from './blueprints.js';
import { FEATURE_E } from './construct.js';
import { tilePlacements } from './baseline.js';
import { tileCost } from './routing.js';
import { transfer, DAY } from '../time/metabolism.js';

export const BUILD_E_PER_STAMP = 20;        // tu of group R per wall/door/floor stamp
export const BUILDING_CONDITION_MAX = 100;  // bounded state (hp precedent)
export const BUILDING_DECAY_PER_DAY = 1;    // unmaintained building lasts 100 days
export const MAINTAIN_COST = 10;            // tu to restore full condition
const DECAY_INTERVAL = DAY;

function inRect(x, y, r) { return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h; }
function rectsOverlap(a, b) {
  return a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w && a.y0 < b.y0 + b.h && b.y0 < a.y0 + a.h;
}

/** The building stamp covering tile (x,y), or undefined.
 *  O(buildings × stamps) — index when settlements scale (roadAt backlog twin). */
export function buildingStampAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building' || !inRect(x, y, n.attrs.footprint)) continue;
    const st = n.attrs.stamps.find(s => s.x === x && s.y === y);
    if (st) return st;
  }
  return undefined;
}

/** Set of 'x,y' keys for every non-walkable stamp (walls). For planRoute opts.blocked. */
export function wallTiles(kernel) {
  const out = new Set();
  for (const n of kernel.graph.nodes.values()) {
    if (n.type !== 'building') continue;
    for (const st of n.attrs.stamps) if (!st.walkable) out.add(`${st.x},${st.y}`);
  }
  return out;
}

/** Group `groupId` constructs leaf template `templateId` at `placement`:
 *  { plotId } — on a plot the group owns (footprint must fit the plot rect), or
 *  { settlementId, x, y } — at an explicit origin fully inside one district of a
 *  settlement the group founded (workshops land in the craft district).
 *  Refuses (null, side-effect-free) on: missing/non-group actor; unknown or
 *  compound template; unowned plot / footprint larger than plot; origin outside
 *  every district; footprint overlapping an existing building; any water tile;
 *  any materialized placement node in the footprint (site must be CLEARED first —
 *  take/chop are the clearing verbs); group.R < cost.
 *  Cost = stamps × BUILD_E_PER_STAMP + Σ FEATURE_E. Paid via nurture (0.95). */
export function constructBuilding(kernel, groupId, placement, templateId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  if (!group || group.type !== 'group') return null;
  const template = BLUEPRINT_TEMPLATES[templateId];
  if (!template || template.children) return null;     // leaf templates only
  const { width: w, height: h } = template.footprint;
  let ox, oy;
  if (placement.plotId != null) {
    const plot = kernel.graph.nodes.get(placement.plotId);
    if (!plot || plot.type !== 'plot' || plot.attrs.owner !== groupId) return null;
    const r = plot.attrs.rect;
    if (w > r.w || h > r.h) return null;
    ox = r.x0; oy = r.y0;
  } else if (placement.settlementId != null) {
    const s = kernel.graph.nodes.get(placement.settlementId);
    if (!s || s.type !== 'settlement' || s.attrs.founderGroup !== groupId) return null;
    ox = placement.x; oy = placement.y;
    const fits = s.attrs.districts.some(d =>
      ox >= d.rect.x0 && oy >= d.rect.y0 &&
      ox + w <= d.rect.x0 + d.rect.w && oy + h <= d.rect.y0 + d.rect.h);
    if (!fits) return null;
  } else return null;
  const fp = { x0: ox, y0: oy, w, h };
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'building' && rectsOverlap(fp, n.attrs.footprint)) return null;
  }
  for (let yy = oy; yy < oy + h; yy++)
    for (let xx = ox; xx < ox + w; xx++)
      if (tileCost(xx, yy) === Infinity) return null;
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.placement && inRect(n.x, n.y, fp)) return null;  // site not cleared
  }
  const { leaves } = expandBlueprint(templateId, ox, oy);
  const leaf = leaves[0];
  const stampCost = leaf.stamps.length * BUILD_E_PER_STAMP;
  const featureCost = leaf.features.reduce(
    (s, f) => s + (FEATURE_E[f.type] ?? FEATURE_E.default), 0);
  const cost = stampCost + featureCost;
  if (group.R < cost) return null;
  const evId = kernel.ledger.emit({
    tick, type: 'building_constructed', actor: groupId, targets: [],
    attrs: { template: templateId, x0: ox, y0: oy, cost,
             plot: placement.plotId ?? null, settlement: placement.settlementId ?? null },
  });
  group.R -= cost;
  // NPC slots resolved to tiles (Agency's landing pad — data only until Pass 4 Life).
  const featXY = new Map(leaf.features.map(f => [f.type, { x: f.x, y: f.y }]));
  const npcSlots = leaf.npcSlots.map(sl => ({
    role: sl.role,
    workTile: sl.workplace ? (featXY.get(sl.workplace) ?? null) : null,
    sleepTile: sl.sleep ? (featXY.get(sl.sleep) ?? null) : null,
  }));
  const building = kernel.graph.createNode({
    type: 'building', tick, x: ox, y: oy, causeEventId: evId,
    attrs: { template: leaf.template, footprint: fp, stamps: leaf.stamps, npcSlots,
             E: transfer(stampCost, 'nurture', kernel.ledger),
             condition: BUILDING_CONDITION_MAX, suppressDeltaIds: [], noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(building.id);
  for (const f of leaf.features) {
    const e = FEATURE_E[f.type] ?? FEATURE_E.default;
    const feat = kernel.graph.createNode({
      type: 'matter', tick, x: f.x, y: f.y, causeEventId: evId,
      attrs: { archetype: f.type, E: transfer(e, 'nurture', kernel.ledger),
               provides: f.provides, building: building.id, noFlux: true },
    });
    kernel.ledger.events[evId - 1].targets.push(feat.id);
  }
  for (let yy = oy; yy < oy + h; yy++) for (let xx = ox; xx < ox + w; xx++) {
    for (const p of tilePlacements(xx, yy)) {
      const id = kernel.deltas.push({
        tick, x: xx, y: yy, target: `placement:${p.key}`, kind: 'claimed',
        attrs: { building: building.id },
      });
      building.attrs.suppressDeltaIds.push(id);
    }
  }
  kernel.scheduler.schedule(tick + DECAY_INTERVAL, building.id, 'building_decay', -1);
  return building;
}

/** Group pays MAINTAIN_COST to restore a building to full condition. */
export function maintainBuilding(kernel, groupId, buildingId, tick) {
  const group = kernel.graph.nodes.get(groupId);
  const b = kernel.graph.nodes.get(buildingId);
  if (!group || group.type !== 'group' || !b || b.type !== 'building') return false;
  if (b.attrs.condition == null) return false;          // boot buildings don't decay
  if (group.R < MAINTAIN_COST) return false;
  kernel.ledger.emit({
    tick, type: 'building_maintained', actor: groupId, targets: [buildingId],
    attrs: { cost: MAINTAIN_COST },
  });
  group.R -= MAINTAIN_COST;
  b.attrs.E += transfer(MAINTAIN_COST, 'nurture', kernel.ledger);
  b.attrs.condition = BUILDING_CONDITION_MAX;
  return true;
}

/** Daily decay. Condition 0 → E returns to ambient, suppression heals, features
 *  become orphaned ruins (building: null), node removed. */
function onBuildingDecay(kernel, node, ev) {
  if (!node) return;
  node.attrs.condition = Math.max(0, node.attrs.condition - BUILDING_DECAY_PER_DAY);
  if (node.attrs.condition > 0) {
    kernel.scheduler.schedule(ev.tick + DECAY_INTERVAL, node.id, 'building_decay', -1);
    return;
  }
  kernel.ledger.count('decayed', node.attrs.E);          // decay_gone precedent
  node.attrs.E = 0;
  for (const id of node.attrs.suppressDeltaIds) kernel.deltas.remove(id);
  node.attrs.suppressDeltaIds = [];
  for (const n of kernel.graph.nodes.values()) {
    if (n.attrs?.building === node.id) n.attrs.building = null;   // ruins remain
  }
  kernel.ledger.emit({
    tick: ev.tick, type: 'building_gone', targets: [node.id],
    attrs: { x: node.x, y: node.y, template: node.attrs.template },
  });
  kernel.graph.removeNode(node.id);
}

export function registerBuildings(kernel) {
  kernel.on('building_decay', onBuildingDecay);
}
```

- [ ] **Step 5: Wire registration** — in `sim/kernel/kernel.js`, after the `registerCrossings` import add `import { registerBuildings } from '../world/buildings.js';` and after `registerCrossings(this);` add `registerBuildings(this);`.

- [ ] **Step 6: Run tests** — `node --test sim/test/buildings.test.js` → all 4 PASS. Then guard against regressions: `node --test sim/test/construct.test.js sim/test/blueprints.test.js sim/test/baseline.test.js sim/test/probe-settlements.test.js` → PASS.

- [ ] **Step 7: Commit** — `git add sim/world/buildings.js sim/world/wire.js src/sim/sim-world-state.js sim/kernel/kernel.js sim/test/buildings.test.js && git commit -m "feat(p4): constructBuilding — paid runtime construction with claimed suppression"`

---

### Task 4: Building decay & maintenance behavior tests

The handler shipped in Task 3; this task pins its behavior.

**Files:**
- Test: `sim/test/buildings.test.js` (append)

- [ ] **Step 1: Write the tests** — append:

```js
test('unmaintained building decays to ruins: E → ambient, suppression heals, features remain', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  const bId = b.id;
  const eBefore = b.attrs.E;
  const deltasHeld = b.attrs.suppressDeltaIds.length;
  const decBefore = k.ledger.totals.decayed;
  const days = Math.ceil(BUILDING_CONDITION_MAX / BUILDING_DECAY_PER_DAY);
  k.runTo((days + 1) * DAY);
  assert.equal(k.graph.nodes.get(bId), undefined, 'building node removed');
  assert.ok(k.ledger.events.some(e => e.type === 'building_gone'), 'building_gone emitted');
  assert.ok(k.ledger.totals.decayed >= decBefore + eBefore - 1e-9,
    'building E returned to ambient');
  // Suppression healed: the claimed deltas were removed.
  const claimedLeft = k.deltas.list.filter(d => d.kind === 'claimed').length;
  assert.equal(claimedLeft, 0, `all ${deltasHeld} claimed deltas removed`);
  // Interior features remain as orphaned ruins.
  const ruins = [...k.graph.nodes.values()].filter(
    n => n.type === 'matter' && ['hearth', 'bedroll'].includes(n.attrs.archetype));
  assert.equal(ruins.length, 2, 'features survive the building as loose ruins');
  for (const r of ruins) assert.equal(r.attrs.building, null);
});

test('maintainBuilding restores condition and extends life', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  k.runTo(10 * DAY);
  assert.equal(b.attrs.condition, BUILDING_CONDITION_MAX - 10 * BUILDING_DECAY_PER_DAY);
  const group = k.graph.nodes.get(g.id);
  const rBefore = group.R;
  assert.equal(maintainBuilding(k, g.id, b.id, 10 * DAY), true);
  assert.equal(group.R, rBefore - MAINTAIN_COST);
  assert.equal(b.attrs.condition, BUILDING_CONDITION_MAX);
  // Underfunded refusal is side-effect-free.
  group.R = 0;
  assert.equal(maintainBuilding(k, g.id, b.id, 10 * DAY), false);
  assert.equal(b.attrs.condition, BUILDING_CONDITION_MAX);
});
```

- [ ] **Step 2: Run** — `node --test sim/test/buildings.test.js` → PASS (behavior already implemented; if anything fails, fix `buildings.js`, not the test).

- [ ] **Step 3: Commit** — `git add sim/test/buildings.test.js && git commit -m "test(p4): building decay-to-ruins and maintenance"`

---

### Task 5: Walls block movement

**Files:**
- Modify: `sim/world/actions.js:317-332` (move)
- Test: `sim/test/buildings.test.js` (append)

- [ ] **Step 1: Write the failing test** — append:

```js
test('walls block move(); doors and floors admit it', () => {
  const { k, p, g, s } = scenario();
  const plot = clearPlot(k, s);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  const fp = b.attrs.footprint;
  const player = k.graph.nodes.get(p.id);
  // Approach the NW corner wall from outside (one tile west of it).
  player.x = fp.x0 - 1; player.y = fp.y0;
  assert.equal(move(k, p.id, 1, 0, 0), false, 'stepping onto a wall is refused');
  assert.equal(player.x, fp.x0 - 1, 'player did not move');
  // Enter through the south door (hut: door at x0+2, y0+3).
  player.x = fp.x0 + 2; player.y = fp.y0 + fp.h;       // outside, below the door
  assert.equal(move(k, p.id, 0, -1, 0), true, 'door admits movement');
  assert.equal(move(k, p.id, 0, -1, 0), true, 'interior floor admits movement');
  assert.equal(move(k, p.id, -1, 0, 0), true, 'floor to floor');
  assert.equal(move(k, p.id, -1, 0, 0), false, 'interior wall blocks from inside too');
});
```

(Requires the south-door tile's outside neighbor to be inside RECT — hut plots sit at y0 ≤ 8 in a height-14 bounds, so `y0+4 ≤ 12` holds; the test will fail loudly if not.)

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/buildings.test.js` → new test FAILS (move onto wall returns true).

- [ ] **Step 3: Implement** — in `sim/world/actions.js`:

Add import (with the other `./` imports at the top):
```js
import { buildingStampAt } from './buildings.js';
```

In `move()`, after the bounds check and BEFORE the ledger emit:
```js
  // Walls are impassable claims (P4): a non-walkable building stamp refuses the step.
  const stamp = buildingStampAt(kernel, toX, toY);
  if (stamp && !stamp.walkable) return false;
```

- [ ] **Step 4: Run** — `node --test sim/test/buildings.test.js sim/test/actions.test.js sim/test/paths.test.js sim/test/probe-paths.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add sim/world/actions.js sim/test/buildings.test.js && git commit -m "feat(p4): walls refuse move() — impassable claims"`

---

### Task 6: Routing avoids walls — `planRoute` opts.blocked, `buildRoad` opts pass-through

**Files:**
- Modify: `sim/world/routing.js:22-74` (planRoute)
- Modify: `sim/world/roads.js:32-35` (buildRoad signature)
- Test: `sim/test/buildings.test.js` (append)

- [ ] **Step 1: Write the failing test** — append:

```js
test('planRoute with opts.blocked routes around building walls', () => {
  const { k, g, s } = scenario();
  const plot = clearPlot(k, s);
  const b = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(b);
  const fp = b.attrs.footprint;
  const blocked = wallTiles(k);
  assert.ok(blocked.size >= 13, 'hut contributes its 13 wall tiles');
  // Route across the building's row band, wide enough to detour around it.
  const from = { x: Math.max(RECT.x0, fp.x0 - 3), y: fp.y0 + 1 };
  const to   = { x: Math.min(RECT.x0 + RECT.w - 1, fp.x0 + fp.w + 2), y: fp.y0 + 1 };
  const route = planRoute(from, to, RECT, { blocked });
  assert.ok(route, 'a detour route exists');
  for (const t of route) {
    assert.ok(!blocked.has(`${t.x},${t.y}`), `route passes through wall ${t.x},${t.y}`);
  }
  // Endpoints inside a wall are refused outright.
  const wallTile = b.attrs.stamps.find(st => !st.walkable);
  assert.equal(planRoute({ x: wallTile.x, y: wallTile.y }, to, RECT, { blocked }), null);
});
```

Add `planRoute` to the imports from `'../world/routing.js'` at the top of the test file:
```js
import { planRoute } from '../world/routing.js';
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/buildings.test.js` → new test FAILS (route goes straight through).

- [ ] **Step 3: Implement** — in `sim/world/routing.js`:

Update the JSDoc:
```js
/** Least-cost 4-connected route from `from` to `to` inside `bounds` ({x0,y0,w,h}).
 *  opts.crossings: Set of 'x,y' strings — water tiles that may be traversed at cost 2.
 *  opts.blocked:   Set of 'x,y' strings — land tiles that may NEVER be traversed
 *                  (building walls — P4 impassable claims).
 *  Returns [{x,y}, ...] including both endpoints, or null when unreachable.
 *  With no opts the behavior is bit-identical to the previous implementation. */
```

After the existing endpoint water check (line 23) add:
```js
  if (opts.blocked?.has(`${from.x},${from.y}`) || opts.blocked?.has(`${to.x},${to.y}`)) return null;
```

In the neighbor loop, immediately after computing `nx, ny` and the `inB`/closed check:
```js
      if (opts.blocked?.has(`${nx},${ny}`)) continue;   // impassable claim (P4 walls)
```

- [ ] **Step 4: `buildRoad` opts pass-through** — in `sim/world/roads.js` change the signature and route call:

```js
export function buildRoad(kernel, groupId, from, to, tick, opts = {}) {
```
```js
  const route = planRoute(from, to, kernel.bounds, opts);
```
(Default `{}` keeps every existing call site bit-identical. Callers that care pass `{ blocked: wallTiles(kernel) }` — and this also closes the P2.5 backlog gap where buildRoad couldn't use crossings.)

- [ ] **Step 5: Run** — `node --test sim/test/buildings.test.js sim/test/paths.test.js sim/test/crossings.test.js sim/test/probe-roads.test.js sim/test/probe-hydrology.test.js` → PASS.

- [ ] **Step 6: Commit** — `git add sim/world/routing.js sim/world/roads.js sim/test/buildings.test.js && git commit -m "feat(p4): planRoute opts.blocked — routing respects impassable claims"`

---

### Task 7: Probe — clear, fund, build, inhabit-shaped, decay (the experienceable loop)

**Files:**
- Test: `sim/test/probe-buildings.test.js` (create)

- [ ] **Step 1: Write the probe** — create `sim/test/probe-buildings.test.js`:

```js
// sim/test/probe-buildings.test.js — P4 probe: a founder group clears a deeded plot
// with REAL verbs (take/chop), pays pooled time to raise a hut, the hut's walls
// genuinely block walking while its door admits it, a forge rises in the craft
// district, routing detours around both, the whole history conserves time, decay
// returns an abandoned hut to wilderness (flora regrows on reboot; the hearth
// remains as a ruin), and the entire run is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, pick, move, take, chop } from '../world/actions.js';
import { createGroup, contribute } from '../society/groups.js';
import { foundSettlement } from '../society/settlements.js';
import { findSettlementSite } from '../society/suitability.js';
import { materializeRect } from '../world/wire.js';
import { constructBuilding, wallTiles, BUILD_E_PER_STAMP } from '../world/buildings.js';
import { FEATURE_E } from '../world/construct.js';
import { planRoute } from '../world/routing.js';
import { DAY } from '../time/metabolism.js';

const RECT = { x0: 926, y0: 0, w: 28, h: 14 };
const SEED = 7;

/** Clear every materialized placement node in rect with real verbs: take matter, chop living. */
function clearSite(k, playerId, rect) {
  let cleared = 0;
  for (const n of [...k.graph.nodes.values()]) {
    if (!n.attrs?.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    if (n.type === 'matter') { assert.ok(take(k, playerId, n.id, 0)); cleared++; }
    else { assert.equal(chop(k, playerId, n.id, 0), true); cleared++; }
  }
  // chop leaves corpses/products on the tiles — they are NOT placements; constructBuilding
  // only refuses materialized placements, so move chopped debris out with take.
  for (const n of [...k.graph.nodes.values()]) {
    if (n.type !== 'matter' || n.attrs.placement) continue;
    if (n.x < rect.x0 || n.x >= rect.x0 + rect.w || n.y < rect.y0 || n.y >= rect.y0 + rect.h) continue;
    take(k, playerId, n.id, 0);
  }
  return cleared;
}

function runScenario() {
  const k = new Kernel({ seed: SEED, bounds: RECT });
  let bush1, bush2;
  k.graph.boot(() => {
    bush1 = k.addLiving({ species: 'berry_bush', x: 941, y: 1,
                          R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    bush2 = k.addLiving({ species: 'berry_bush', x: 942, y: 1,
                          R: 40000, body: 60000, tick: 0, age: 400 * DAY });
    const made = materializeRect(k, RECT, 0);
    assert.ok(made >= 1, 'vacuity: baseline materialized something');
  });
  const p1 = createPlayer(k, 0, { x: 941, y: 1 });
  const p2 = createPlayer(k, 0, { x: 942, y: 1 });
  const g = createGroup(k, 0, { x: 941, y: 0 });

  // ── Fund the group with real harvests (hut 610 + forge 1150 + margin; 2×1100×0.9 = 1980) ──
  const NEED = 1100;
  for (const [pid, bush] of [[p1.id, bush1], [p2.id, bush2]]) {
    const pl = k.graph.nodes.get(pid);
    while (pl.R < NEED) { if (pick(k, pid, bush.id, 0) <= 0) break; }
    assert.ok(pl.R >= NEED, `player holds ≥${NEED}`);
    assert.equal(contribute(k, pid, g.id, NEED, 0), true);
  }

  // ── Conservation baseline AFTER funding (all tick-0; stocks() destructive) ──
  const stocks0 = k.stocks(0);
  const tl0 = k.ledger.totals.transferLoss;

  // ── Found the settlement at the scored site ──
  const site = findSettlementSite(k, RECT);
  const settlement = foundSettlement(k, g.id, site, 0);
  assert.ok(settlement, 'settlement founded');
  const plots = [...k.graph.nodes.values()].filter(
    n => n.type === 'plot' && n.attrs.settlement === settlement.id);
  assert.ok(plots.length >= 1, 'plots deeded');

  // ── Clear the first plot with real verbs, then raise a hut on it ──
  const plot = plots[0];
  clearSite(k, p1.id, plot.attrs.rect);
  const hut = constructBuilding(k, g.id, { plotId: plot.id }, 'hut', 0);
  assert.ok(hut, 'hut constructed on the cleared plot');
  const hutCost = 20 * BUILD_E_PER_STAMP + FEATURE_E.hearth + FEATURE_E.bedroll;

  // ── Walls block walking; the door admits it (the experienceable claim) ──
  const fp = hut.attrs.footprint;
  const walker = k.graph.nodes.get(p2.id);
  walker.x = fp.x0 - 1; walker.y = fp.y0;
  assert.equal(move(k, p2.id, 1, 0, 0), false, 'wall blocks entry');
  walker.x = fp.x0 + 2; walker.y = fp.y0 + fp.h;
  assert.equal(move(k, p2.id, 0, -1, 0), true, 'door admits entry');
  assert.equal(move(k, p2.id, 0, -1, 0), true, 'standing on the hut floor');

  // ── A forge rises in the craft district (settlement placement path) ──
  const craft = settlement.attrs.districts.find(d => d.kind === 'craft');
  assert.ok(craft, 'craft district zoned');
  // Find a forge-sized clear land origin inside the craft district (programmatic).
  let forge = null;
  for (let oy = craft.rect.y0; oy + 5 <= craft.rect.y0 + craft.rect.h && !forge; oy++) {
    for (let ox = craft.rect.x0; ox + 6 <= craft.rect.x0 + craft.rect.w && !forge; ox++) {
      clearSite(k, p1.id, { x0: ox, y0: oy, w: 6, h: 5 });
      forge = constructBuilding(k, g.id, { settlementId: settlement.id, x: ox, y: oy }, 'forge', 0);
    }
  }
  assert.ok(forge, 'forge constructed in the craft district');
  const smith = forge.attrs.npcSlots.find(s => s.role === 'smith');
  assert.ok(smith?.workTile, 'smith slot resolved to the anvil tile (Agency landing pad)');

  // ── Routing detours around both buildings ──
  const blocked = wallTiles(k);
  const route = planRoute({ x: RECT.x0 + 1, y: fp.y0 + 1 },
                          { x: RECT.x0 + RECT.w - 2, y: fp.y0 + 1 }, RECT, { blocked });
  if (route) for (const t of route)
    assert.ok(!blocked.has(`${t.x},${t.y}`), 'route never crosses a wall');

  // ── Conservation checkpoint: Δstocks == −ΔtransferLoss (all tick-0 activity) ──
  const tlDelta = k.ledger.totals.transferLoss - tl0;
  const drift = (k.stocks(0) - stocks0) + tlDelta;
  assert.ok(Math.abs(drift) < 1e-6, `conservation drift ${drift}`);

  // ── Abandonment: 101 unmaintained days → the hut falls; ruins + regrowth ──
  const hutId = hut.id, forgeId = forge.id;
  k.runTo(101 * DAY);
  assert.equal(k.graph.nodes.get(hutId), undefined, 'abandoned hut is gone');
  assert.equal(k.graph.nodes.get(forgeId), undefined, 'abandoned forge is gone');
  const hearthRuin = [...k.graph.nodes.values()].find(
    n => n.attrs?.archetype === 'hearth' && n.attrs.building === null);
  assert.ok(hearthRuin, 'the hearth remains as a ruin');
  assert.equal(k.deltas.list.filter(d => d.kind === 'claimed').length, 0,
    'all claims healed — flora regrows on the next reboot');

  return {
    site: { x: site.x, y: site.y },
    hut: { x0: fp.x0, y0: fp.y0, cost: hutCost },
    forge: { x0: forge.attrs.footprint.x0, y0: forge.attrs.footprint.y0 },
    events: k.ledger.events.map(e => e.type),
    deltaCount: k.deltas.list.length,
    finalGroupR: k.graph.nodes.get(g.id)?.R ?? null,
  };
}

test('PROBE: clear → fund → build → inhabit-shaped → abandon → wilderness', () => {
  runScenario();
});

test('PROBE determinism: identical history on identical seed', () => {
  const a = runScenario();
  const b = runScenario();
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run** — `node --test sim/test/probe-buildings.test.js` → PASS. If geography makes an assertion impossible (e.g. craft district has no forge-sized land), adapt the probe PROGRAMMATICALLY (scan for a viable origin, as shown) — never hardcode coordinates, never weaken an assertion silently; record any adaptation for the Deviations section.

- [ ] **Step 3: Run the stream-coupled neighbors** — `node --test sim/test/probe-settlements.test.js sim/test/probe-paths.test.js sim/test/probe-conservation.test.js` → PASS.

- [ ] **Step 4: Commit** — `git add sim/test/probe-buildings.test.js && git commit -m "test(sim): probe — buildings rise on plots, block movement, decay to ruins"`

---

### Task 8: Roadmap close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` (P4 row status)
- Modify: `docs/superpowers/plans/2026-06-12-pass3-p4-buildings.md` (Deviations section)

- [ ] **Step 1:** Set the P4 row status to `**DONE** 2026-06-12 (plan 2026-06-12-pass3-p4-buildings.md, Deviations canonical; …)` summarizing what shipped and the honest absences (no NPCs, no sprites/roof fade — X1 lane, save/load rehydration backlog).
- [ ] **Step 2:** Append a `## Deviations (canonical)` section to THIS plan recording every deviation the implementers logged.
- [ ] **Step 3:** Commit — `git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass3-p4-buildings.md && git commit -m "docs(p4): roadmap close-out + deviations"`

---

## Honest absences (declared)

- **No NPCs**: npcSlots are resolved tile data only — Agency (Pass 4 Life) lands on them later.
- **No sprite binding / roof canopy fade**: kernel-side headless-first; wall/floor/roof piece art is the X1 asset-manifest lane. The client already receives building stamps via serialization; binding is renderer backlog.
- **Labor-only construction**: no materials consumed (empty grain yields). Material-consuming construction is declared backlog (roads precedent).
- **No save/load rehydration** for runtime building nodes (claimed deltas persist; nodes do not) — same backlog as roads/paths/settlements/crossings.
- **No group decision-making**: constructBuilding is a verb a caller invokes; groups deciding WHEN to build is P5 growth.

## Quality backlog (accepted up front)

- `buildingStampAt`/`wallTiles` O(n) scans — index alongside roadAt/crossingAt before Pass-4 scale.
- `move()` now scans buildings per step — same index fixes it.
- REMOVAL_KINDS now duplicated in three places (wire.js, sim-world-state.js, and implicitly this plan) — extraction candidate.
