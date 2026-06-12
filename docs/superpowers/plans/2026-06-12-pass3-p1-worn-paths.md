# Pass 3 — P1: Pathways (Worn Paths) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traffic wears paths — entity movement records per-tile wear; sufficient wear tramples flora (causal death, conserved) and writes suppression deltas so the ground shows through across reboots; when traffic stops, wear fades and the deltas heal — ghost paths regrow. Pure consumption of existing machinery: claims/delta suppression (M4/wire.js), causal death + corpse decay (Pass 1 lifecycle), scheduler handlers.

**Architecture:** A `move` verb gives positioned actors one-tile steps (players gain optional positions — position is spatial state, not embodiment; the S4 body stays honestly absent). Each step calls `recordTraffic`, which lazily creates one `path` node per tile (noFlux, provenance = the move event) and adds wear. Wear crossing WORN_THRESHOLD tramples tramplable living flora on the tile (`die()` → corpse → existing decay machinery, E conserved) and pushes one `'worn'` delta per baseline placement key (suppresses re-materialization). A scheduled `path_fade` handler decays wear daily; when wear drops below threshold the path's deltas are removed (`delta_healed` ledger events) and baseline flora re-materializes on the next boot/materializeRect. `'worn'` joins REMOVAL_KINDS in BOTH sim/world/wire.js and the client mirror src/sim/sim-world-state.js (the M2 lesson). Protocol gains a `move` intent; `path` nodes serialize with derived wear stage.

**Tech Stack:** Plain ES modules, node:test. No new dependencies.

---

## Context for the implementer (read this first)

1. **No movement exists pre-P1.** `createPlayer` (sim/world/actions.js:33) makes players with `x: null, y: null`. The player is a time WALLET (no metabolism) — that stays. P1 adds *position* only.
2. **Conservation is the constitution.** Nothing may create or destroy time (E/R/body) outside ledger-tracked transfers. Trampling therefore NEVER deletes a living node directly — it calls `die(kernel, node, tick, evId)` (sim/time/lifecycle.js) which makes a corpse that decays through existing, conserved machinery. Wear itself is not time (like hp in M2/M5): zero new ledger terms.
3. **Suppression machinery (read sim/world/wire.js whole):** `materializeRect` skips placements whose key appears in a delta `target === 'placement:<key>'` with `kind ∈ REMOVAL_KINDS` (currently `taken|felled|destroyed`, wire.js:37). The CLIENT mirrors this set in `src/sim/sim-world-state.js` (~line 4-15). P1 adds `'worn'` to BOTH (grep for REMOVAL_KINDS to find every copy — M2 added these in two places).
4. **Deltas heal by removal:** `kernel.deltas.push({tick,x,y,target,kind,attrs})` returns an id; `kernel.deltas.remove(id)` deletes it (sim/store/deltas.js). The felled/healDeltaId pattern (actions.js chop, lifecycle decay_gone) is the precedent — P1's heal trigger is wear fade, not corpse decay, so the path node owns its delta ids in `attrs.suppressDeltaIds`.
5. **Scheduler:** `kernel.scheduler.schedule(tick, nodeId, kind, ver)` (`ver: -1` = always-fresh, survives node.ver bumps); handlers via `kernel.on(kind, (kernel, node, ev) => {})` registered in a `registerX(kernel)` function called from the Kernel constructor (pattern: registerLifecycle, registerAggregates — kernel.js:21-22).
6. **Provenance rule:** `graph.createNode` throws unless inside `graph.boot(()=>{})` or given `causeEventId`. Path nodes are runtime consequences → always created with the move event's id.
7. **Tramplable is authored species data** (like demand/burn): add `tramplable: true` to `grass` and `berry_bush` in SPECIES (sim/time/metabolism.js); trees/grazers are not tramplable. This is body topology authoring (M5 SLOTS precedent), not a forbidden recipe/mock.
8. **Tile occupants:** `kernel.flux.occupantsOf(x, y)` yields living node ids on a tile (used by reRateTileOf, kernel.js:59). Players are noFlux → never in flux occupancy; path nodes are plain graph nodes, also noFlux.
9. **Authored constants (sim/world/paths.js):** `WEAR_PER_STEP = 1`, `WORN_THRESHOLD = 20` (≈20 passes wear a path), `FADE_PER_DAY = 2` (an untrafficked worn path heals in ≤ 10 days), `FADE_INTERVAL = DAY`. Wear is clamped at `WEAR_MAX = 100` (bounded state).
10. **GEOGRAPHY:** world near (0,0) is OCEAN — placement-bearing grassland ≈ x930 (M4 lesson). Tests that need baseline placements use rects near x930; tests that only need living nodes boot their own (probe-recipes pattern).
11. **Suite:** single files via `node --test sim/test/<file>`; full suite `npm test` (~8 min, 224 tests pre-P1) only at close-out, in background. Commits: conventional + trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. NEVER push to origin.

---

### Task 1: `move` verb + player position

**Files:**
- Modify: `sim/world/actions.js` (createPlayer optional position; new `move` export)
- Test: `sim/test/actions.test.js` (append)

- [ ] **Step 1: failing tests** — append to `sim/test/actions.test.js` (reuse its kernel-boot helpers; READ the file first):

```js
test('P1 createPlayer: optional spawn position; default stays null (back-compat)', () => {
  const k = /* file's kernel helper */;
  const p0 = createPlayer(k, 0);
  assert.equal(p0.x, null);
  const p1 = createPlayer(k, 0, { x: 5, y: 6 });
  assert.equal(p1.x, 5);
  assert.equal(p1.y, 6);
});

test('P1 move: one-tile steps update position and emit move events; invalid moves refused', () => {
  const k = /* kernel helper */;
  const p = createPlayer(k, 0, { x: 5, y: 6 });
  assert.equal(move(k, p.id, 1, 0, 0), true);
  assert.equal(p.x, 6); assert.equal(p.y, 6);
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'move');
  assert.equal(ev.actor, p.id);
  assert.deepEqual(ev.attrs, { fromX: 5, fromY: 6, toX: 6, toY: 6 });
  // refusals: no diagonal-zero, >1 step, unpositioned actor
  assert.equal(move(k, p.id, 0, 0, 1), false, 'zero step');
  assert.equal(move(k, p.id, 2, 0, 1), false, 'step >1');
  const limbo = createPlayer(k, 1);
  assert.equal(move(k, limbo.id, 1, 0, 1), false, 'unpositioned actor cannot move');
  // bounds: moving outside kernel.bounds refused
  // (compute a step that exits the helper's bounds and assert false)
});
```

Adapt helper names to the file's real ones; assertion strength (event shape, refusal cases, bounds) may not be weakened.

- [ ] **Step 2:** Run `node --test sim/test/actions.test.js` — new tests FAIL.

- [ ] **Step 3: implement** in `sim/world/actions.js`:

Change `createPlayer` signature to `createPlayer(kernel, tick, pos = null)`:

```js
export function createPlayer(kernel, tick, pos = null) {
  const evId = kernel.ledger.emit({ tick, type: 'player_join' });
  const player = kernel.graph.createNode({
    type: 'player', tick, x: pos?.x ?? null, y: pos?.y ?? null, R: 0, causeEventId: evId,
    attrs: { body: 0, cap: 0, burn: 0, noFlux: true },
  });
  kernel.ledger.events[evId - 1].targets.push(player.id);
  return player;
}
```

Add `move` (import `recordTraffic` from `./paths.js` is added in Task 2 — in THIS task, leave a one-line seam comment where the call will go; do NOT stub a fake recordTraffic):

```js
/** One-tile step for a positioned actor. Refuses (false) when the actor is missing,
 *  unpositioned, the step is not exactly one tile (Chebyshev 1), or it exits bounds.
 *  Position is spatial state, not embodiment (S4 honestly absent): zero time cost in P1 —
 *  movement metabolism is the Time Metabolism's job in a later pass, declared, not faked. */
export function move(kernel, actorId, dx, dy, tick) {
  const actor = kernel.graph.nodes.get(actorId);
  if (!actor || actor.x == null || actor.y == null) return false;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  const toX = actor.x + dx, toY = actor.y + dy;
  const b = kernel.bounds;
  if (b && (toX < b.x0 || toX >= b.x0 + b.w || toY < b.y0 || toY >= b.y0 + b.h)) return false;
  const evId = kernel.ledger.emit({
    tick, type: 'move', actor: actorId, targets: [],
    attrs: { fromX: actor.x, fromY: actor.y, toX, toY },
  });
  actor.x = toX; actor.y = toY;
  // P1 Task 2 seam: recordTraffic(kernel, toX, toY, evId, tick) wears a path on the destination tile.
  return true;
}
```

- [ ] **Step 4:** `node --test sim/test/actions.test.js` — all PASS (plus no regressions in the file).

- [ ] **Step 5: Commit:**
```bash
git add sim/world/actions.js sim/test/actions.test.js
git commit -m "feat(sim): P1 move verb — one-tile steps with move events; players gain optional positions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `sim/world/paths.js` — wear, trample, fade, heal

**Files:**
- Create: `sim/world/paths.js`
- Modify: `sim/time/metabolism.js` (add `tramplable: true` to grass + berry_bush SPECIES entries — nothing else)
- Modify: `sim/world/actions.js` (wire `recordTraffic` into `move` at the Task 1 seam)
- Modify: `sim/kernel/kernel.js` (constructor calls `registerPaths(this)` alongside registerLifecycle/registerAggregates)
- Test: `sim/test/paths.test.js`

- [ ] **Step 1: failing tests** — create `sim/test/paths.test.js`:

```js
// sim/test/paths.test.js — P1: wear accumulation, trample (conserved), fade, heal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, move } from '../world/actions.js';
import { recordTraffic, pathAt, WEAR_PER_STEP, WORN_THRESHOLD, FADE_PER_DAY } from '../world/paths.js';
import { DAY } from '../time/metabolism.js';

function makeKernel(seed = 7) {
  return new Kernel({ seed, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
}

test('P1 wear: each move step wears the destination tile; path node has provenance', () => {
  const k = makeKernel();
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  move(k, p.id, 1, 0, 0);          // → (5,4)
  const path = pathAt(k, 5, 4);
  assert.ok(path, 'path node exists on destination tile');
  assert.equal(path.type, 'path');
  assert.equal(path.attrs.wear, WEAR_PER_STEP);
  assert.ok(path.createdByEvent != null || path.causeEventId != null, 'provenance from move event');
  move(k, p.id, -1, 0, 1);         // back to (4,4)
  move(k, p.id, 1, 0, 2);          // → (5,4) again
  assert.equal(pathAt(k, 5, 4).attrs.wear, 2 * WEAR_PER_STEP);
});

test('P1 trample: wear crossing threshold kills tramplable flora via die() — conserved', () => {
  const k = makeKernel();
  let bush, tree;
  k.graph.boot(() => {
    bush = k.addLiving({ species: 'berry_bush', x: 5, y: 4, R: 500, body: 800, tick: 0 });
    tree = k.addLiving({ species: 'tree', x: 5, y: 4, R: 20000, body: 30000, tick: 0, age: 400 * DAY });
  });
  const before = k.stocks(0);
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  for (let i = 0; i < WORN_THRESHOLD; i++) {   // pace until threshold
    move(k, p.id, 1, 0, i * 2);
    move(k, p.id, -1, 0, i * 2 + 1);
  }
  // bush died to a trample event → corpse exists; tree (not tramplable) untouched
  assert.equal(k.graph.nodes.has(bush.id), false, 'bush trampled');
  assert.equal(k.graph.nodes.has(tree.id), true, 'tree survives');
  const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
  assert.ok(corpse, 'trampled bush left a corpse');
  const trampleEv = k.ledger.events.findLast(e => e.type === 'trample');
  assert.ok(trampleEv, 'trample event emitted');
  // conservation: stocks unchanged at the same tick (die conserves into corpse)
  const after = k.stocks(k.tick);
  assert.ok(Math.abs(after - before) < 1e-6, `trample conserves: before=${before} after=${after}`);
});

test('P1 fade + heal: wear decays daily; suppression deltas heal when wear drops below threshold', () => {
  const k = makeKernel();
  const p = createPlayer(k, 0, { x: 4, y: 4 });
  let t = 0;
  for (let i = 0; i < WORN_THRESHOLD + 4; i++) {  // overshoot threshold a little
    move(k, p.id, 1, 0, t++); move(k, p.id, -1, 0, t++);
  }
  const path = pathAt(k, 5, 4);
  assert.ok(path.attrs.wear >= WORN_THRESHOLD, 'tile is worn');
  const wornBefore = k.deltas.list.filter(d => d.kind === 'worn').length;
  // (this rect has no baseline placements at (5,4) — worn deltas may be 0 here; the
  //  delta-content assertions live in Task 3's wire test on real grassland. Here we
  //  assert the FADE mechanics.)
  const wearBefore = path.attrs.wear;
  k.runTo(3 * DAY);
  assert.ok(pathAt(k, 5, 4).attrs.wear <= Math.max(0, wearBefore - 2 * FADE_PER_DAY),
    'wear fades daily while untrafficked');
  k.runTo(60 * DAY);
  assert.equal(pathAt(k, 5, 4).attrs.wear, 0, 'wear fully fades');
  assert.equal(k.deltas.list.filter(d => d.kind === 'worn').length, 0,
    `all worn deltas healed (was ${wornBefore})`);
  const healed = k.ledger.events.filter(e => e.type === 'path_healed');
  assert.ok(wornBefore === 0 || healed.length >= 1, 'path_healed emitted when deltas existed');
});

test('P1 determinism: same seed + same walk → bit-identical path state and deltas', () => {
  const run = () => {
    const k = makeKernel(7);
    const p = createPlayer(k, 0, { x: 4, y: 4 });
    let t = 0;
    for (let i = 0; i < 25; i++) { move(k, p.id, 1, 0, t++); move(k, p.id, -1, 0, t++); }
    k.runTo(5 * DAY);
    return {
      paths: [...k.graph.nodes.values()].filter(n => n.type === 'path')
        .map(n => ({ x: n.x, y: n.y, wear: n.attrs.wear })).sort((a, b) => a.x - b.x || a.y - b.y),
      deltas: k.deltas.list.map(d => ({ target: d.target, kind: d.kind })),
    };
  };
  assert.deepEqual(run(), run());
});
```

- [ ] **Step 2:** `node --test sim/test/paths.test.js` — FAIL (module not found).

- [ ] **Step 3: implement.** Create `sim/world/paths.js`:

```js
// sim/world/paths.js — P1: worn paths. Traffic wears tiles; wear tramples flora
// (causal death through the conserved corpse pipeline — NEVER raw node deletion)
// and suppresses baseline placements via 'worn' deltas; wear fades daily and
// healed deltas let the baseline regrow (ghost paths). Wear is not time (M2/M5
// hp precedent): zero ledger terms. Pure consumption of claims/deltas/scheduler.
import { tilePlacements } from './baseline.js';
import { SPECIES, DAY } from '../time/metabolism.js';
import { die } from '../time/lifecycle.js';

export const WEAR_PER_STEP = 1;
export const WORN_THRESHOLD = 20;   // steps needed to wear a path bare
export const FADE_PER_DAY = 2;      // untrafficked wear lost per day
export const WEAR_MAX = 100;        // bounded state
export const FADE_INTERVAL = DAY;

/** The path node on tile (x,y), or undefined. O(nodes) — fine at probe scale; index at P4. */
export function pathAt(kernel, x, y) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'path' && n.x === x && n.y === y) return n;
  }
  return undefined;
}

/** Record one traffic step on (x,y), caused by ledger event `evId` (a 'move').
 *  Lazily creates the tile's path node; adds wear; tramples + suppresses when
 *  the threshold is crossed (idempotent: only on the crossing). */
export function recordTraffic(kernel, x, y, evId, tick) {
  let path = pathAt(kernel, x, y);
  if (!path) {
    path = kernel.graph.createNode({
      type: 'path', tick, x, y, R: null, causeEventId: evId,
      attrs: { wear: 0, suppressDeltaIds: [], noFlux: true },
    });
    kernel.scheduler.schedule(tick + FADE_INTERVAL, path.id, 'path_fade', -1);
  }
  const before = path.attrs.wear;
  path.attrs.wear = Math.min(WEAR_MAX, before + WEAR_PER_STEP);
  if (before < WORN_THRESHOLD && path.attrs.wear >= WORN_THRESHOLD) {
    wearBare(kernel, path, evId, tick);
  }
  return path;
}

/** Threshold crossing: trample tramplable living flora (conserved causal death)
 *  and suppress this tile's baseline placements until the path heals. */
function wearBare(kernel, path, evId, tick) {
  const { x, y } = path;
  // 1. trample living flora on the tile (flux occupants are living non-players)
  for (const occId of [...kernel.flux.occupantsOf(x, y)]) {
    const occ = kernel.graph.nodes.get(occId);
    if (!occ || !SPECIES[occ.attrs?.species]?.tramplable) continue;
    const tEv = kernel.ledger.emit({
      tick, type: 'trample', actor: null, targets: [occId],
      attrs: { species: occ.attrs.species, x, y, causeEventId: evId },
    });
    die(kernel, occ, tick, tEv);   // corpse decays through existing machinery — conserved
  }
  // 2. suppress baseline placements (re-materialization stops until healed)
  for (const p of tilePlacements(x, y)) {
    const id = kernel.deltas.push({
      tick, x, y, target: `placement:${p.key}`, kind: 'worn', attrs: { pathNode: path.id },
    });
    path.attrs.suppressDeltaIds.push(id);
  }
}

/** Daily fade. When wear drops below threshold, heal all suppression deltas. */
function onPathFade(kernel, node, ev) {
  if (!node) return;
  node.attrs.wear = Math.max(0, node.attrs.wear - FADE_PER_DAY);
  if (node.attrs.wear < WORN_THRESHOLD && node.attrs.suppressDeltaIds.length > 0) {
    for (const id of node.attrs.suppressDeltaIds) {
      kernel.deltas.remove(id);
      kernel.ledger.emit({
        tick: ev.tick, type: 'path_healed', actor: null, targets: [node.id],
        attrs: { deltaId: id, x: node.x, y: node.y },
      });
    }
    node.attrs.suppressDeltaIds = [];
  }
  if (node.attrs.wear > 0) {
    kernel.scheduler.schedule(ev.tick + FADE_INTERVAL, node.id, 'path_fade', -1);
  }
  // wear 0: stop rescheduling — recordTraffic re-arms on next traffic.
}

export function registerPaths(kernel) {
  kernel.on('path_fade', onPathFade);
}
```

CAREFUL adaptation points (verify against real code, do not guess): `die()` signature and whether it handles corpse creation + flux exit for living nodes (read sim/time/lifecycle.js); whether `createNode` accepts `R: null` (players use `R: 0` — path uses R:null like matter nodes; read graph.js); `tilePlacements(x, y)` yield shape (`p.key` — read baseline.js); whether `recordTraffic` re-arming needs a fresh schedule when wear hits 0 then traffic resumes — the code above re-arms only on CREATE; FIX: in `recordTraffic`, when `!path` we schedule; when path exists but wear was 0 (fade stopped rescheduling), also re-schedule:

```js
  if (path && before === 0) {
    kernel.scheduler.schedule(tick + FADE_INTERVAL, path.id, 'path_fade', -1);
  }
```
(place after the wear increment, guarded so it doesn't double-schedule on create — restructure as: `const isNew = !path; ... if (!isNew && before === 0) schedule(...)`.)

In `sim/time/metabolism.js`: add `tramplable: true` to the `grass` and `berry_bush` SPECIES entries. Nothing else changes.

In `sim/world/actions.js` `move()`: replace the Task 1 seam comment with `recordTraffic(kernel, toX, toY, evId, tick);` and import `{ recordTraffic }` from `./paths.js`.

In `sim/kernel/kernel.js`: `import { registerPaths } from '../world/paths.js';` and call `registerPaths(this);` after `registerAggregates(this);`. CHECK for import cycles (kernel.js ← paths.js ← lifecycle.js/metabolism.js — lifecycle already imports nothing from kernel.js itself; if a cycle appears, register paths the way lifecycle does).

- [ ] **Step 4:** `node --test sim/test/paths.test.js sim/test/actions.test.js sim/test/kernel.test.js` — all PASS. Also `node --test sim/test/probe-conservation.test.js` (new handler must not disturb the identity).

- [ ] **Step 5: Commit:**
```bash
git add sim/world/paths.js sim/time/metabolism.js sim/world/actions.js sim/kernel/kernel.js sim/test/paths.test.js
git commit -m "feat(sim): P1 worn paths — traffic wear, conserved trample, daily fade, delta heal

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: `'worn'` suppression in wire.js + client mirror + reboot test

**Files:**
- Modify: `sim/world/wire.js` (REMOVAL_KINDS + doc comment)
- Modify: `src/sim/sim-world-state.js` (client REMOVAL_KINDS mirror)
- Test: `sim/test/wire.test.js` (append)

- [ ] **Step 1: failing test** — append to `sim/test/wire.test.js` (READ it; reuse its grassland-rect pattern — placements exist ≈ x930):

```js
test('P1 worn deltas suppress placements on reboot; healed deltas restore them', () => {
  // Use the file's established grassland rect (placements ≈ x930).
  // 1. boot kernel A, materializeRect → find a tile WITH ≥1 placement.
  // 2. push a delta { target: 'placement:<key>', kind: 'worn' } for one placement key.
  // 3. boot kernel B from same seed + copy of A's deltas, materializeRect same rect:
  //    assert the worn placement is NOT materialized; siblings are.
  // 4. remove the delta (heal); boot kernel C same way:
  //    assert the placement IS materialized again.
});
```
Follow the file's existing suppression tests (taken/felled) — this is the same shape with kind 'worn'. Assertions: suppressed-when-present, restored-when-removed, sibling placements unaffected. May not be weakened. If the existing tests have a vacuity guard (assert the rect actually yields placements), copy it.

- [ ] **Step 2:** test FAILS (worn not a removal kind yet).

- [ ] **Step 3: implement.** sim/world/wire.js line 37: `const REMOVAL_KINDS = new Set(['taken', 'felled', 'destroyed', 'worn']);` and extend the header comment (line 6) to mention worn-path suppression healing on fade. src/sim/sim-world-state.js: add `'worn'` to its REMOVAL_KINDS set (grep `REMOVAL_KINDS` across src/ for every copy).

- [ ] **Step 4:** `node --test sim/test/wire.test.js sim/test/actions-wire.test.js sim/test/probe-wiring.test.js` — all PASS.

- [ ] **Step 5: Commit:**
```bash
git add sim/world/wire.js src/sim/sim-world-state.js sim/test/wire.test.js
git commit -m "feat(sim): P1 'worn' joins REMOVAL_KINDS (sim + client mirror) — worn tiles stay bare across reboots

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: protocol `move` intent + path wire + probe

**Files:**
- Modify: `sim/server/protocol.js` (VERBS + move parsing + serializeEntity 'path' branch)
- Modify: `sim/server/server.js` (dispatch)
- Test: `sim/test/protocol.test.js`, `sim/test/server.test.js` (append), Create: `sim/test/probe-paths.test.js`

- [ ] **Step 1: protocol tests** — append to `sim/test/protocol.test.js`:

```js
test('parseClientMsg: move intent needs integer dx,dy in {-1,0,1}, not both 0', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 1, dy: 0 })),
    { type: 'intent', verb: 'move', dx: 1, dy: 0 });
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: -1, dy: 1 })),
    { type: 'intent', verb: 'move', dx: -1, dy: 1 });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 0, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 2, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 0.5, dy: 0 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'move', dx: 1 })), null);
});

test('serializeEntity: path nodes expose id/type/x/y/wear only (no suppressDeltaIds)', () => {
  const node = { id: 9, type: 'path', x: 5, y: 4,
    attrs: { wear: 23, suppressDeltaIds: [3, 4], noFlux: true } };
  assert.deepEqual(serializeEntity(node), { id: 9, type: 'path', x: 5, y: 4, wear: 23 });
});
```
(ADAPT serializeEntity call shape to the file's real tests — it may take (node) or (node, tick); internals like suppressDeltaIds stay sim-side.)

- [ ] **Step 2: implement.** protocol.js: add `'move'` to VERBS; intent branch:

```js
      if (m.verb === 'move') {
        const okStep = v => Number.isInteger(v) && v >= -1 && v <= 1;
        if (!okStep(m.dx) || !okStep(m.dy) || (m.dx === 0 && m.dy === 0)) return null;
        return { type: 'intent', verb: 'move', dx: m.dx, dy: m.dy };
      }
```

serializeEntity: add a `'path'` branch returning `{ id, type, x, y, wear: node.attrs.wear }` (match the existing branch style — building/recipe branches are the pattern). server.js: dispatch branch `move` → `move(kernel, playerId, msg.dx, msg.dy, tick)` (import from ../world/actions.js, mirror the equip branch). Also: player tick-delta field gains `x: player?.x ?? null, y: player?.y ?? null` alongside R/inventory/equipment (the client must see its own position move).

Append a server.test.js test: connect, send move intent, assert next tick-delta player.x/y changed by the step; send an invalid (dx 2) raw message, assert it is ignored (no crash, no position change).

- [ ] **Step 3: the probe** — create `sim/test/probe-paths.test.js`:

```js
// sim/test/probe-paths.test.js — P1 probe: a walker wears a path through grassland;
// flora is trampled (conserved), the ground stays bare across reboot, and when the
// walking stops the path heals — flora re-materializes. Ghost paths regrow.
```

Scenario (use the GRASSLAND rect pattern from wire.test.js/M4 — placements ≈ x930; vacuity-guard that the walked tiles have ≥1 baseline placement, else widen the route):
1. Kernel A: `materializeRect` a grassland rect inside bounds; create player positioned on a tile in it; walk a fixed route back and forth (≥ WORN_THRESHOLD passes over the same tiles, ticks strictly increasing).
2. Assert: path nodes exist along the route with wear ≥ WORN_THRESHOLD; ≥1 'worn' delta exists; any tramplable flora that was materialized on those tiles is now corpses (count trample events ≥ 1 — vacuity-guard the route to include ≥1 materialized tramplable node, else reroute).
3. Conservation: `k.stocks(k.tick)` before-vs-after walk identical within 1e-6 (trample conserves; movement is free in P1); and the full ledger identity from probe-conservation.test.js after `runTo(1 * DAY)` (copy its exact assertion).
4. Reboot: build kernel B from same seed + A's deltas (copy list), materializeRect same rect — worn placements absent, others present.
5. Heal: on kernel A, `runTo` far enough for full fade (`(WEAR_MAX/FADE_PER_DAY + 2) * DAY` is safely past); assert worn deltas all gone + path_healed events; kernel C from seed + healed deltas re-materializes the flora (count matches an untouched boot).
6. Determinism: the whole scenario twice (same seed) → deepEqual of {path states, delta kinds/targets, trample/heal event counts}.

- [ ] **Step 4:** `node --test sim/test/protocol.test.js sim/test/server.test.js sim/test/probe-paths.test.js` — ALL PASS. Regression: `node --test sim/test/actions.test.js sim/test/wire.test.js`.

- [ ] **Step 5: Commit:**
```bash
git add sim/server/protocol.js sim/server/server.js sim/test/protocol.test.js sim/test/server.test.js sim/test/probe-paths.test.js
git commit -m "feat(sim): P1 move intent + path wire + worn-paths probe — walk, wear, reboot-bare, heal, regrow

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Close-out — full suite, deviations, roadmap

- [ ] **Step 1:** `npm test` in background (~8 min). Expected: all pass (224 pre-P1 + new).
- [ ] **Step 2:** Append `## Deviations (canonical)` section to this doc (every divergence + why; authoritative over task bodies).
- [ ] **Step 3:** Roadmap P1 row → DONE with final test count.
- [ ] **Step 4:** Commit both docs:
```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass3-p1-worn-paths.md
git commit -m "docs(sim): P1 worn paths close-out — roadmap DONE, deviations recorded

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Out of scope (honest absences, declared)

- **Movement time-cost**: walking is free in P1 — the Time Metabolism charging motion is a later metabolism pass (declared, not faked with arbitrary costs).
- **Pathfinding/routing**: P2 (least-cost roads). P1 walkers are probe-driven (roadmap: Agency arrives Pass 4).
- **NPC traffic**: no NPCs yet; only players/probe walkers generate wear.
- **Client path rendering**: wear crosses the wire ({id,type,x,y,wear}); drawing trodden ground is renderer work (asset manifest X-plans).
- **Path claims**: worn paths suppress placements via deltas, not building-style claims — claims stay building-only until P3 territories need them.
- **pathAt O(n) scan**: index by tile key when P4-scale traffic exists (backlog).

## Seams for later plans

- `recordTraffic(kernel, x, y, evId, tick)` is the single entry point — P2 roads and Pass-4 NPC movement call the same function.
- `path.attrs.wear` + WORN_THRESHOLD generalize to road-grade tiers in P2 (worn → paved upgrade consumes the same tile state).
- `tramplable` species flag is the seam for crop trampling (P5 farms).
- The move event {fromX,fromY,toX,toY} is the traffic record History Generation (Pass 6) will mine for settlement connectivity.

---

## Deviations (canonical — authoritative over task bodies above)

1. **Trample/conservation tests run all moves at tick=0** (paths.test.js, probe-paths.test.js). The plan's pacing (`i*2, i*2+1` ticks) made `stocks()` before/after comparisons inconsistent: `die()`/`reRateTileOf` close segments and advance node `lastTick` past the comparison tick (stocks' own docstring warns against this). At tick=0 all segment closures are dt=0 no-ops, so the comparison isolates exactly the trample → corpse transfer. Threshold crossing and die() are still genuinely exercised.
2. **Reboot-orphan worn deltas documented as a save/load contract** (paths.js header TODO, commit a06ac041f): path nodes are runtime state; worn deltas persist. On a future kernel *load*, path nodes must be rehydrated from worn deltas or they can never heal. Real defect at save/load scope, not reachable in P1 (no persistence of the graph yet). Backlog.
3. **Reciprocal mirror comment added to wire.js REMOVAL_KINDS** (a60449997) — the client copy (src/sim/sim-world-state.js) already pointed at wire.js; now both directions are marked (drift guard, quality-review recommendation).
4. **Probe route-tile search extracted to a shared `findRouteTile(k)` helper** (be078cdd7) after review found a harmless-but-confusing dead condition in the vacuity guard and a duplicated search in the determinism sub-test. Guards assert (fail when unmet), never skip.
5. **Wire wear defaults to 0** (`wear: node.attrs.wear ?? 0`, be078cdd7) — defensive only; recordTraffic always sets wear today.
6. **ev.attrs deepEqual relaxed to four targeted equals** in the Task 1 move-event test (ledger may attach extra attrs keys); all four of fromX/fromY/toX/toY are still asserted.
7. **server.test.js positions the player by direct kernel access** as test arrangement (no spawn-position wire feature — out of scope as planned); the move itself travels the full wire path (intent → dispatch → move() → tick delta).

**Hardening backlog (accepted, P2+/save-load):** rehydrate path nodes from worn deltas on load (deviation 2); pathAt O(n) → tile-key index when traffic scales (P4); negative-origin bounds test for move(); unbounded-world (`bounds: null`) contract test; spawn-position validation in createPlayer (trusted today).
