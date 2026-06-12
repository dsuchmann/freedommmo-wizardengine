# Pass 1 Plan E — World Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The existing landscape decoration objects become simulation-kernel entities — baseline-from-seed reuses the live placement pipeline; interaction verbs (pick/chop/harvest/take/eat) are ledger events; harvested matter lives in inventories as embodied time; destruction writes deltas; the browser renderer becomes a client of the sim process and binds lifecycle state to the already-generated sprites via Plan D's taxonomy. This completes Pass 1.

**Architecture:** A Node-importable baseline adapter (`sim/world/baseline.js`) enumerates the SAME deterministic placements the renderer draws (`src/world/decoration-claims.js` + `src/world/biomes.js` — verified pure, no browser APIs). `sim/world/wire.js` materializes them as kernel entities at boot, each carrying a deterministic `placement` key that deltas and the renderer share. The protocol serializes enough kernel truth (`bufferDays`, placement attrs) for the client to derive visual state through `src/world/asset-state-taxonomy.js` (importable by BOTH sides — it has no imports). The browser gains a `SimClient` (WebSocket) and a `SimWorldState` overlay that overrides/suppresses baseline sprites for kernel-tracked objects and turns player interaction into intents.

**Tech Stack:** plain ESM JS, node:test, `ws` (already a sim dependency from Plan B), existing canvas renderer.

**Spec authority:** `docs/superpowers/specs/2026-06-11-pass1-time-metabolism-simulation-kernel-design.md` §2.7, §5.1–5.4, §6.1, §6.3; roadmap row E; `docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md`.

## Scope reconciliation (roadmap "F2–F7" vs on-disk reality — read first)

The roadmap row says "the existing F2–F7 landscape objects become kernel entities". Verified reality (2026-06-11):

- **F3 + F4 have enumerable deterministic placements** (`f3Placements`/`f4Placements` in `src/world/decoration-claims.js`, cache key `wx,wy,biome`, salts 9500–9720). These are wired CONCRETELY in this plan: F4 → living entities (metabolic class `berry_bush`), F3 → matter nodes (take-able, no spine — taxonomy `kind: 'matter'`).
- **F2 is procedural per-pixel grass/small-flora**, not discrete placements — per-blade entities are impossible and dishonest at ~1M scale. The kernel's `grass` species (individuals at full tier, aggregates elsewhere) IS the simulation of F2 biomass; the painted F2 field is its statistical rendering. Declared honest absence: no per-F2-plant entity binding in Pass 1.
- **F5–F7 have no placement pipelines yet** (assets in progress / not started). The adapter in Task 1 is generic over `FIELD_SHEETS` so they ride in when their placement code exists. Declared honest absence.
- **Kernel `tree` species** keeps its kernel-spawned baseline (no F6 placements to bind); `chop`/stump-delta from Plan B continues to work headlessly and via the probe client.

Every "absent" above follows CLAUDE.md's no-mock rule: absent, never fake. The wiring PATTERN (placement key ↔ entity ↔ delta ↔ sprite) is delivered end-to-end and experienceable through F3/F4.

## GIT SAFETY (include in every subagent prompt)

The repo has many unrelated dirty/untracked asset files. NEVER use `git add -A`, `git add .`, `git reset --hard`, `git checkout --`, `git stash`, or `--amend`. Stage ONLY the exact files you change. NEVER push. NEVER modify files under assets/.

## File structure

- `sim/world/baseline.js` — Task 1: Node-side enumeration of renderer placements (+ placement keys)
- `sim/world/wire.js` — Task 2: placement → kernel entity materialization at boot
- `sim/world/actions.js` — Task 3: add `harvest`, `take`, `eat` (modify; `pick`/`chop` stay)
- `sim/server/protocol.js`, `sim/server/server.js` — Task 4: serialize placement attrs + bufferDays; new intents
- `src/sim/sim-client.js` — Task 5: browser WebSocket client (new)
- `src/sim/sim-world-state.js` — Task 6: placementKey → visual override map + renderer/interaction binding (new; small edits to renderer call sites)
- `sim/test/baseline.test.js`, `sim/test/wire.test.js`, `sim/test/actions-wire.test.js`, `sim/test/protocol-wire.test.js`, `sim/test/probe-wiring.test.js` — tests per task
- Plan-doc close-out — Task 8

Kernel internals referenced throughout (already built): `kernel.graph` (nodes Map, `createNode`, `boot(fn)`, `nodesNear`), `kernel.ledger` (`emit`, `count`), `kernel.deltas` (`push/remove/list` — shape `{id, tick, x, y, target, kind, attrs}`), `kernel.flux` (`enter/leave`), `addLiving` in `sim/world/spawn.js`, `transfer(amount, channel, ledger)` + `SPECIES`/`stageAt`/`DAY` in `sim/time/metabolism.js`, `rand(seed, ...ids)` in `sim/kernel/rng.js`.

---

### Task 1: Node-side baseline placements (`sim/world/baseline.js`)

**Files:**
- Create: `sim/world/baseline.js`
- Test: `sim/test/baseline.test.js`

The sim must enumerate the SAME objects the renderer draws. `classifyBiome(wx, wy)` (src/world/biomes.js:27, returns `{ id, definition, climate }`) and `f3Placements`/`f4Placements` (src/world/decoration-claims.js:359/479) are pure ESM with no browser deps (verified). Verified contract: the third argument is a CALLBACK `tileInfo(wx, wy) → { biome, transition } | null` (decoration-claims.js:358); cache key is `wx,wy,biome`; placements carry `{ name, biome, variant, ux, uy, ... }` with `ux`/`uy` in TILE UNITS (0..1, decoration-claims.js:382).

**Transition flag decision (declared, not a deviation):** the renderer sets `transition` from `tile.transitionPair`, computed in `worker-chunk-renderer.js:1015–1083` from wang-cell neighbors + terrain levels — renderer-internal and not worth extracting in Pass 1. The sim adapter passes `transition: false` everywhere. Consequence: on biome-transition tiles (where the renderer draws no decorations) the sim may materialize entities the main client never draws — they simulate honestly, are just not visually bound. Non-transition tiles (the overwhelming majority) have exact 1:1 parity because each tile's placements depend only on `(wx, wy, biome)`. Record this in the Canonical deviations section's pre-declared list when committing.

- [ ] **Step 1: Write the failing test**

```js
// sim/test/baseline.test.js — the sim enumerates the renderer's own deterministic placements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilePlacements, placementKey } from '../world/baseline.js';

test('placements are deterministic and carry stable keys', () => {
  const a = tilePlacements(120, 80);
  const b = tilePlacements(120, 80);
  assert.deepEqual(a, b);                                  // pure function of (wx, wy)
  for (const p of a) {
    assert.match(p.key, /^f[34]:120,80:\d+$/);
    assert.ok(p.field === 'f3' || p.field === 'f4');
    assert.ok(typeof p.archetype === 'string' && p.archetype.length > 0);
    assert.ok(typeof p.biome === 'string');
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y)); // world-tile coords (fractional)
  }
});

test('keys are unique within a region and stable across tiles', () => {
  const keys = new Set();
  let n = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    for (const p of tilePlacements(x, y)) { keys.add(p.key); n++; }
  }
  assert.equal(keys.size, n);
});

test('placementKey is the shared contract', () => {
  assert.equal(placementKey('f4', 3, 7, 2), 'f4:3,7:2');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/baseline.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// sim/world/baseline.js — Node-side view of the renderer's deterministic placement pipeline.
// Reuses the LIVE placement code (spec §5.1 world equation: baseline from seed) — never a copy.
import { classifyBiome } from '../../src/world/biomes.js';
import { f3Placements, f4Placements } from '../../src/world/decoration-claims.js';

export const placementKey = (field, wx, wy, i) => `${field}:${wx},${wy}:${i}`;

// tileInfo CALLBACK per decoration-claims.js:358 contract: (wx, wy) → { biome, transition } | null.
// transition: false everywhere — declared decision, see Task 1 preamble.
const tileInfo = (wx, wy) => ({ biome: classifyBiome(wx, wy).id, transition: false });

/** All wired placements on one tile, normalized: {key, field, archetype, biome, variant, x, y, raw}.
 *  x/y are world-tile coordinates: tile + ux/uy, which are TILE UNITS in [0,1] (decoration-claims.js:382). */
export function tilePlacements(wx, wy) {
  const out = [];
  f3Placements(wx, wy, tileInfo).forEach((p, i) => out.push(norm('f3', wx, wy, i, p)));
  f4Placements(wx, wy, tileInfo).forEach((p, i) => out.push(norm('f4', wx, wy, i, p)));
  return out;
}

function norm(field, wx, wy, i, p) {
  return {
    key: placementKey(field, wx, wy, i),
    field, archetype: p.name, biome: p.biome, variant: p.variant ?? 0,
    x: wx + (p.ux ?? 0.5), y: wy + (p.uy ?? 0.5),
    raw: p,
  };
}
```

Shapes verified against `src/world/decoration-claims.js` (f3: lines 359–392, f4: lines 475–509): placements carry `{ name, biome, variant, ux, uy, ... }`, both functions return `EMPTY` (a shared array) for null/transition/empty tiles, and both are deterministic in `(wx, wy, biome)` (the `tuneBiomeDensity`/`tuneObjDensity` gates are deterministic functions of those + tuner config). One caution for the implementer: the f4 placement carries a renderer-side static lifecycle `state` roll (decoration-claims.js:495–508) — IGNORE it on the sim side; the kernel's own metabolism is the only lifecycle truth (no-mock rule).

- [ ] **Step 4: Run tests** → `node --test sim/test/baseline.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add sim/world/baseline.js sim/test/baseline.test.js
git commit -m "feat(wire): node-side baseline placements — sim enumerates the renderer's own objects (spec 5.1)"
```

---

### Task 2: Materialize placements as kernel entities (`sim/world/wire.js`)

**Files:**
- Create: `sim/world/wire.js`
- Modify: `sim/server/main.js` (bootWorld uses wired spawning inside the start rect)
- Test: `sim/test/wire.test.js`

Design: at boot (inside `kernel.graph.boot(...)` — baseline provenance, spec §5.4 case 1), every F4 placement in the start rect becomes a LIVING entity of metabolic class `berry_bush` (the F4 class per `FIELD_SHEETS._meta.SPECIES_CLASS` reversed), carrying `attrs: { placement, field, archetype, biome, variant }`. Every F3 placement becomes a MATTER node: `{ type: 'matter', attrs: { E, placement, field, archetype, biome, variant, noFlux: true } }` — no metabolism, no spine (taxonomy §4). Initial R/body/age are deterministic via `rand(kernel.seed, ...)` salted by a numeric hash of the placement key. Placements that already have a delta (`target === 'placement:'+key`) are NOT materialized — that is baseline suppression (spec §5.2). Grass/grazer/tree baseline spawning (`spawnMeadow`) continues unchanged alongside.

- [ ] **Step 1: Write the failing test**

```js
// sim/test/wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { materializeRect, keyHash } from '../world/wire.js';
import { tilePlacements } from '../world/baseline.js';

// Verified: no shared helpers.js exists — sim tests construct kernels inline (see kernel.test.js:5).
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });

const RECT = { x0: 0, y0: 0, w: 8, h: 8 };

test('every placement in the rect becomes exactly one entity with its key', () => {
  const k = makeKernel();
  k.graph.boot(() => materializeRect(k, RECT, 0));
  const expected = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expected.push(...tilePlacements(x, y));
  const byKey = new Map([...k.graph.nodes.values()]
    .filter(n => n.attrs?.placement).map(n => [n.attrs.placement, n]));
  assert.equal(byKey.size, expected.length);
  for (const p of expected) {
    const n = byKey.get(p.key);
    assert.ok(n, p.key);
    if (p.field === 'f4') { assert.equal(n.attrs.species, 'berry_bush'); assert.ok(n.R > 0); }
    if (p.field === 'f3') { assert.equal(n.type, 'matter'); assert.ok(n.attrs.E > 0); assert.ok(n.attrs.noFlux); }
    assert.equal(n.attrs.archetype, p.archetype);
  }
});

test('materialization is deterministic (same seed → identical R/body)', () => {
  const a = makeKernel(), b = makeKernel();
  a.graph.boot(() => materializeRect(a, RECT, 0));
  b.graph.boot(() => materializeRect(b, RECT, 0));
  const dump = k => [...k.graph.nodes.values()].filter(n => n.attrs?.placement)
    .map(n => [n.attrs.placement, n.R ?? n.attrs.E, n.attrs.body ?? 0]).sort();
  assert.deepEqual(dump(a), dump(b));
});

test('a delta-suppressed placement is not materialized', () => {
  const k = makeKernel();
  const victim = tilePlacements(0, 0).concat(tilePlacements(1, 0), tilePlacements(2, 0))[0];
  if (victim) {
    k.deltas.push({ tick: 0, x: 0, y: 0, target: 'placement:' + victim.key, kind: 'taken', attrs: {} });
    k.graph.boot(() => materializeRect(k, RECT, 0));
    const present = [...k.graph.nodes.values()].some(n => n.attrs?.placement === victim.key);
    assert.equal(present, false);
  } else {
    assert.ok(true, 'no placements on probed tiles — biome empty, acceptable');
  }
});
```

(Kernel construction verified against `sim/test/kernel.test.js:5–9` — bounded world keeps tests finite. Do NOT invent a new kernel configuration.)

- [ ] **Step 2: Run to verify failure** → module not found.

- [ ] **Step 3: Implement**

```js
// sim/world/wire.js — the world's decoration objects become kernel entities (Plan E, spec §6.1/§5.x).
import { tilePlacements } from './baseline.js';
import { rand } from '../kernel/rng.js';
import { DAY } from '../time/metabolism.js';

/** FNV-1a over the key string → 31-bit int for rand() salting (deterministic, order-free). */
export function keyHash(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 1;
}

/** Embodied time for F3 matter by archetype category (tu). Coarse, declared, conserved. */
const F3_E = { default: 120 };

const F4_CLASS = 'berry_bush';   // FIELD_SHEETS._meta.SPECIES_CLASS reversed: F4 → berry_bush metabolic class

/** Materialize all placements in rect as kernel entities. MUST run inside kernel.graph.boot()
 *  (baseline provenance) or with a causal event (promotion — later pass). Skips delta-suppressed
 *  and already-materialized keys. Returns count created. */
export function materializeRect(kernel, { x0, y0, w, h }, tick) {
  const suppressed = new Set(
    kernel.deltas.list.filter(d => d.target?.startsWith('placement:'))
      .map(d => d.target.slice('placement:'.length)));
  const existing = new Set(
    [...kernel.graph.nodes.values()].map(n => n.attrs?.placement).filter(Boolean));
  let made = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    for (const p of tilePlacements(x, y)) {
      if (suppressed.has(p.key) || existing.has(p.key)) continue;
      const hh = keyHash(p.key);
      const meta = { placement: p.key, field: p.field, archetype: p.archetype, biome: p.biome, variant: p.variant };
      if (p.field === 'f4') {
        // kernel.addLiving (sim/kernel/kernel.js:28) — verified signature {species,x,y,R,body,tick,age};
        // it flux-enters + re-rates + schedules lifecycle, so wired F4 metabolizes identically to spawned (no-mock).
        const node = kernel.addLiving({
          species: F4_CLASS, x: p.x, y: p.y, tick,
          R: 600 + Math.floor(rand(kernel.seed, hh, 1) * 900),
          body: 200 + Math.floor(rand(kernel.seed, hh, 2) * 400),
          age: Math.floor(rand(kernel.seed, hh, 3) * 40) * DAY,
        });
        Object.assign(node.attrs, meta);
      } else {
        kernel.graph.createNode({
          type: 'matter', tick, x: p.x, y: p.y,
          attrs: { ...meta, E: F3_E[p.archetype] ?? F3_E.default, noFlux: true },
        });
      }
      made++;
    }
  }
  return made;
}
```

Verified facts (no further verification needed): `kernel.addLiving` enters flux, re-rates, and schedules lifecycle (kernel.js:28–37); `graph.createNode({type, tick, x, y, R, attrs, causeEventId})` is provenance-checked and allowed inside `boot()` (graph.js:22–25). Matter nodes must NOT enter flux and must NOT get lifecycle schedules — they are inert embodied time; `createNode` alone gives exactly that.

- [ ] **Step 4: Wire into boot.** In `sim/server/main.js` `bootWorld`, after `spawnWorld(kernel, bounds, start)` and inside the same boot scope if possible (else its own `kernel.graph.boot`), call `materializeRect(kernel, start, 0)`. VERIFY how spawnWorld's boot scoping works and match it.

- [ ] **Step 5: Run tests** → `node --test sim/test/wire.test.js` PASS; also `node --test sim/test/probe-intent-replay.test.js sim/test/main.test.js` still green — boot changes must stay deterministic.

- [ ] **Step 6: Commit**

```bash
git add sim/world/wire.js sim/test/wire.test.js sim/server/main.js
git commit -m "feat(wire): placements materialize as kernel entities at boot — baseline from the live pipeline (spec 5.1/5.4)"
```

---

### Task 3: Inventory + harvest/take/eat verbs

**Files:**
- Modify: `sim/world/actions.js`
- Test: `sim/test/actions-wire.test.js`

Design: player keeps `R` (the wallet). NEW: `attrs.inventory = []` of items `{ id, kind, archetype?, species?, E, tick }` — harvested matter as embodied time (roadmap row E). `harvest` = pick-shaped bite that lands in inventory instead of R. `take` = whole F3 matter node into inventory + removal delta keyed by placement. `eat` = inventory item → R via `transfer` (typed channel, loss to dissipation, conserved). All three are ledger events. `pick`/`chop` unchanged (Plan B probes keep passing).

- [ ] **Step 1: Write the failing test**

```js
// sim/test/actions-wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { createPlayer, harvest, take, eat } from '../world/actions.js';
import { materializeRect } from '../world/wire.js';

const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });

function bootWired(k) {
  k.graph.boot(() => materializeRect(k, { x0: 0, y0: 0, w: 12, h: 12 }, 0));
}
const findWired = (k, pred) => [...k.graph.nodes.values()].find(n => n.attrs?.placement && pred(n));

test('harvest moves embodied time into inventory, conserving through the transfer channel', () => {
  const k = makeKernel(); bootWired(k);
  const player = createPlayer(k, 0);          // createPlayer emits its own causal event — no boot scope needed (actions.js:8)
  const bush = findWired(k, n => n.attrs.field === 'f4');
  if (!bush) return assert.ok(true, 'no f4 in rect — acceptable for sparse biomes');
  const before = bush.R + bush.attrs.body;
  const item = harvest(k, player.id, bush.id, 0);
  assert.ok(item && item.E > 0);
  assert.equal(player.attrs.inventory.length, 1);
  assert.ok(bush.R + bush.attrs.body < before);
  assert.equal(k.ledger.events.at(-1).type, 'harvest');   // ledger.events is a plain array (sim/store/ledger.js:7)
});

test('take removes the matter node, writes a placement delta, item holds its E', () => {
  const k = makeKernel(); bootWired(k);
  const player = createPlayer(k, 0);
  const pebble = findWired(k, n => n.type === 'matter');
  if (!pebble) return assert.ok(true, 'no f3 in rect — acceptable');
  const E = pebble.attrs.E, key = pebble.attrs.placement;
  const item = take(k, player.id, pebble.id, 0);
  assert.ok(item);
  assert.equal(k.graph.nodes.has(pebble.id), false);
  assert.ok(k.deltas.list.some(d => d.target === 'placement:' + key && d.kind === 'taken'));
  assert.ok(Math.abs(player.attrs.inventory[0].E - E) < 1e-9);       // take is lossless (no transfer channel: nothing metabolizes)
});

test('eat converts item E to player R through a lossy typed transfer', () => {
  const k = makeKernel();
  const player = createPlayer(k, 0);
  player.attrs.inventory.push({ id: 1, kind: 'harvest', E: 100, tick: 0 });
  const r0 = player.R;
  const gained = eat(k, player.id, 1, 0);
  assert.ok(gained > 0 && gained <= 100);
  assert.equal(player.R - r0, gained);
  assert.equal(player.attrs.inventory.length, 0);
});
```

- [ ] **Step 2: Run to verify failure** → named exports missing.

- [ ] **Step 3: Implement** in `sim/world/actions.js` (match the file's existing style — read `pick`/`chop` first; reuse their target-validation and `transfer` usage):

```js
let nextItemId = 1;   // VERIFY: persist across checkpoint like other counters (see how nextDeltaId is checkpointed) — follow the same pattern, else derive max+1 on load.

export function harvest(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId), prey = kernel.graph.nodes.get(targetId);
  if (!player || !prey || prey.R == null) return null;
  const sp = SPECIES[prey.attrs.species];
  const bite = Math.min(sp?.pick?.bite ?? 200, prey.R + (prey.attrs.body ?? 0));
  if (bite <= 0) return null;
  // drain R first, then body (same overdraft order as pick — VERIFY against pick's actual code)
  const fromR = Math.min(prey.R, bite); prey.R -= fromR;
  const fromBody = bite - fromR; prey.attrs.body = (prey.attrs.body ?? 0) - fromBody;
  const delivered = transfer(bite, 'harvest', kernel.ledger);
  const item = { id: nextItemId++, kind: 'harvest', species: prey.attrs.species,
                 archetype: prey.attrs.archetype ?? null, E: delivered, tick };
  (player.attrs.inventory ??= []).push(item);
  kernel.ledger.emit({ tick, type: 'harvest', actor: playerId, targets: [targetId], magnitude: bite });
  return item;
}

export function take(kernel, playerId, targetId, tick) {
  const player = kernel.graph.nodes.get(playerId), node = kernel.graph.nodes.get(targetId);
  if (!player || !node || node.type !== 'matter') return null;
  const ev = kernel.ledger.emit({ tick, type: 'take', actor: playerId, targets: [targetId], magnitude: node.attrs.E });
  if (node.attrs.placement) {
    kernel.deltas.push({ tick, x: node.x, y: node.y, target: 'placement:' + node.attrs.placement,
                         kind: 'taken', attrs: { archetype: node.attrs.archetype } });
  }
  const item = { id: nextItemId++, kind: 'matter', archetype: node.attrs.archetype ?? null,
                 E: node.attrs.E, tick };
  (player.attrs.inventory ??= []).push(item);
  kernel.graph.removeNode(targetId);
  return item;
}

export function eat(kernel, playerId, itemId, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const inv = player?.attrs.inventory ?? [];
  const i = inv.findIndex(it => it.id === itemId);
  if (i < 0) return 0;
  const [item] = inv.splice(i, 1);
  const gained = transfer(item.E, 'harvest', kernel.ledger);   // typed lossy channel; VERIFY channel names in metabolism.js transfer() and reuse the harvest channel
  player.R += gained;
  kernel.ledger.emit({ tick, type: 'eat', actor: playerId, targets: [], magnitude: item.E });
  return gained;
}
```

Imports (`SPECIES`, `transfer`) already exist in actions.js — reuse them. The `'harvest'` channel is real (`CHANNEL_EFF.harvest = 0.50`, metabolism.js:8).

CONSERVATION (critical, concrete): the conservation stock sum is `Kernel.stocks(tick)` at `sim/kernel/kernel.js:102` (used by `sim/test/probe-conservation.test.js`). Inventory E and matter E are STOCKS — extend `stocks()` in this task:

```js
// inside the for-loop of stocks(), after the existing corpse/aggregate/R-bearing branches:
else if (n.type === 'matter') { s += n.attrs.E; }
// and for EVERY node (outside the else-chain — players carry R AND inventory):
if (n.attrs?.inventory) for (const it of n.attrs.inventory) s += it.E;
```

Matter nodes are created at boot, so they appear in both `start` and `end` stocks; `take` is then stock-neutral, and `harvest`/`eat` losses land in `totals.transferLoss` — the existing identity `Δstocks = captured − burned − decayed − transferLoss` holds unchanged. Stage `sim/kernel/kernel.js` in this task's commit. Existing probes have no matter/inventory nodes, so they are unaffected.

- [ ] **Step 4: Run** → `node --test sim/test/actions-wire.test.js` PASS, plus the existing actions/probe-6 test file still green.

- [ ] **Step 5: Commit**

```bash
git add sim/world/actions.js sim/kernel/kernel.js sim/test/actions-wire.test.js
git commit -m "feat(wire): harvest/take/eat — inventory holds harvested matter as embodied time (roadmap E)"
```

---

### Task 4: Protocol — placement attrs, bufferDays, new intents

**Files:**
- Modify: `sim/server/protocol.js` (serializeEntity), `sim/server/server.js` (intent switch)
- Test: `sim/test/protocol-wire.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/protocol-wire.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeEntity } from '../server/protocol.js';
import { SPECIES, stageAt, DAY } from '../time/metabolism.js';

test('serializeEntity carries placement attrs, bufferDays, ageTicks, senescenceStartTicks', () => {
  const node = { id: 7, type: 'berry_bush', R: 900, x: 3.5, y: 4.25,
    attrs: { species: 'berry_bush', body: 300, birthTick: 0,
             placement: 'f4:3,4:0', field: 'f4', archetype: 'cornflower', biome: 'grassland', variant: 2 } };
  const e = serializeEntity(node, 0);
  assert.equal(e.placement, 'f4:3,4:0');
  assert.equal(e.archetype, 'cornflower');
  assert.equal(e.biome, 'grassland');
  assert.equal(e.variant, 2);
  assert.equal(e.field, 'f4');
  const sp = SPECIES.berry_bush;
  const dailyBurn = sp.burn * stageAt('berry_bush', 0)[3] * DAY;
  assert.ok(Math.abs(e.bufferDays - 900 / dailyBurn) < 1e-9);
  assert.equal(e.ageTicks, 0);                                       // tick - attrs.birthTick
  assert.equal(e.senescenceStartTicks, sp.senescence?.start);        // omitted (undefined) if species has none — JSON cannot carry Infinity
});

test('serializeEntity stays lean for unwired entities (no placement keys)', () => {
  const node = { id: 8, type: 'grass', R: 10, x: 0, y: 0, attrs: { species: 'grass', body: 5, birthTick: 0 } };
  const e = serializeEntity(node, 0);
  assert.equal('placement' in e, false);
  assert.ok(typeof e.bufferDays === 'number');   // bufferDays for ALL living entities (taxonomy needs it)
});
```

(Verified: `serializeEntity(node, tick)` at `sim/server/protocol.js:35` already derives `stage` from `stageAt(species, tick - node.attrs.birthTick)[0]` — reuse `tick - attrs.birthTick` as `ageTicks`. The assertions above define the OUTPUT contract.)

- [ ] **Step 2: Run** → FAIL (fields missing).

- [ ] **Step 3: Implement.** In `serializeEntity`: for living entities compute `bufferDays = R / (sp.burn * stageAt(species, ageTicks)[3] * DAY)` (guard burn=0 → `null`), `ageTicks = tick - attrs.birthTick`, and `senescenceStartTicks = SPECIES[species].senescence?.start` (leave `undefined` — i.e. omitted from JSON — when the species has none; the client defaults missing → Infinity, Task 6); spread `placement, field, archetype, biome, variant` from attrs ONLY when `attrs.placement` exists. Matter nodes serialize as `{ id, type: 'matter', archetype, x, y, E, placement, field, biome, variant }`. Extend the `VERBS` set (protocol.js:6) with `'harvest' | 'take' | 'eat'`. In `server.js`'s intent handler add cases `'harvest' | 'take'` (target = node id) and `'eat'` (target = item id), calling the Task 3 verbs with the session's playerId — mirror exactly how `pick`/`chop` intents are dispatched today. Matter nodes must be included in `_bubbleEntities` (VERIFY its filter — it currently excludes aggregates; matter nodes have x/y and should be served).

- [ ] **Step 4: Run** → new test PASS + existing protocol/server tests green: `node --test sim/test/protocol-wire.test.js sim/test/protocol.test.js sim/test/server.test.js`.

- [ ] **Step 5: Commit**

```bash
git add sim/server/protocol.js sim/server/server.js sim/test/protocol-wire.test.js
git commit -m "feat(wire): protocol serves placement identity + bufferDays; harvest/take/eat intents (spec 3.2/6.3)"
```

---

### Task 5: Browser sim client (`src/sim/sim-client.js`)

**Files:**
- Create: `src/sim/sim-client.js`
- Test: `sim/test/sim-client.test.js` (run the CLIENT class under Node against a real SimServer — the class must not touch `window`; pass a WebSocket factory)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/sim-client.test.js — the browser client class, exercised against a REAL sim server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { SimClient } from '../../src/sim/sim-client.js';
import { SimServer } from '../server/server.js';
import { Kernel } from '../kernel/kernel.js';
import { materializeRect } from '../world/wire.js';

// Verified pattern from sim/test/server.test.js:11–16: port 0 = OS-assigned, server.port after listen().
async function startTestServer() {
  const bounds = { x0: 0, y0: 0, w: 16, h: 16 };
  const kernel = new Kernel({ seed: 11, bounds });
  kernel.graph.boot(() => materializeRect(kernel, { x0: 0, y0: 0, w: 8, h: 8 }, 0));
  const server = new SimServer({ kernel, port: 0, timeScale: 48 });
  await server.listen();
  return { server, port: server.port, kernel };
}

test('client attaches, receives snapshot, tracks tick-deltas, sends intents', async () => {
  const { server, port } = await startTestServer();
  const states = [];
  const client = new SimClient({
    url: `ws://127.0.0.1:${port}`,
    wsFactory: u => new WebSocket(u),
    viewport: { x: 0, y: 0, w: 16, h: 16 },
    onState: s => states.push(s),
  });
  await client.ready;                                          // resolves after snapshot
  assert.ok(client.tick >= 0);
  assert.ok(client.entities instanceof Map);
  const wired = [...client.entities.values()].find(e => e.placement);
  if (wired) {
    client.intend({ verb: wired.type === 'matter' ? 'take' : 'harvest', target: wired.id });
    await new Promise(r => setTimeout(r, 300));                // one pump
    assert.ok(client.deltas.length >= 0);                      // deltas list mirrored
  }
  client.close();
  await server.close();
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// src/sim/sim-client.js — the renderer is a client of the sim process (CLAUDE.md locked decision 2).
// Environment-free: WebSocket comes in via factory so node:test can drive it with 'ws'.
export class SimClient {
  constructor({ url, wsFactory = u => new WebSocket(u), viewport, onState = () => {} }) {
    this.entities = new Map();      // id → serialized entity
    this.deltas = [];               // current delta list (placement:* targets included)
    this.tick = -1;
    this.playerId = null;
    this.onState = onState;
    this.ready = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
    this.ws = wsFactory(url);
    this.ws.onopen = () => this._send({ type: 'hello', viewport });
    this.ws.onmessage = m => this._onMsg(JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString()));
    this.ws.onerror = e => this._readyRej?.(e);
  }
  _send(msg) { this.ws.send(JSON.stringify(msg)); }
  intend({ verb, target }) { this._send({ type: 'intent', verb, target }); }
  close() { this.ws.close(); }
  _onMsg(msg) {
    if (msg.type === 'snapshot') {
      this.tick = msg.tick; this.playerId = msg.playerId;
      this.entities = new Map(msg.entities.map(e => [e.id, e]));
      this.deltas = msg.deltas ?? [];
      this._readyRes?.(); this._readyRes = null;
    } else if (msg.type === 'tick-delta') {
      this.tick = msg.tick;
      for (const e of msg.upserts ?? []) this.entities.set(e.id, e);
      for (const id of msg.removed ?? []) this.entities.delete(id);
      this.deltas = msg.deltas ?? this.deltas;
      this.playerR = msg.player?.R ?? this.playerR;
    } else if (msg.type === 'time') { this.day = msg.day; }
    this.onState(this);
  }
}
```

(Match the REAL message field names from `sim/server/protocol.js` — verify `upserts`/`removed`/`deltas`/`player` exactly; adapt.)

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add src/sim/sim-client.js sim/test/sim-client.test.js
git commit -m "feat(wire): SimClient — the renderer attaches to the sim process (spec 3.1/3.3)"
```

---

### Task 6: Renderer binding — taxonomy-driven sprites + interaction intents

**Files:**
- Create: `src/sim/sim-world-state.js`
- Modify: `src/main.js` (instantiate SimClient + SimWorldState; route the existing interaction key/click to intents), plus the ONE call site where F4 sprite/state selection happens at draw time (find it: `f4SpriteUrl` consumers in `src/render/field2-animator.js` / `src/main.js`) and the F3 chunk-bake path (`applySmallScatterToChunk` in `src/render/worker-chunk-renderer.js`) for taken-suppression.
- Test: `sim/test/sim-world-state.test.js` (pure logic under Node)

- [ ] **Step 1: Write the failing test**

```js
// sim/test/sim-world-state.test.js — kernel truth → per-placement render instruction, via Plan D taxonomy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimWorldState } from '../../src/sim/sim-world-state.js';

test('living wired entity maps through spineStateOf/visualStateOf', () => {
  const s = new SimWorldState();
  s.update({
    entities: new Map([[7, { id: 7, placement: 'f4:3,4:0', field: 'f4', stage: 'mature', bufferDays: 1, ageTicks: 0, senescenceStartTicks: 1e12 }]]),
    deltas: [],
  });
  assert.deepEqual(s.overrideFor('f4:3,4:0'), { visual: 'wilting', removed: false, entityId: 7 });
});

test('taken placement is suppressed even with no entity present', () => {
  const s = new SimWorldState();
  s.update({ entities: new Map(), deltas: [{ target: 'placement:f3:1,1:0', kind: 'taken' }] });
  assert.deepEqual(s.overrideFor('f3:1,1:0'), { visual: null, removed: true, entityId: null });
});

test('unknown placement → no override (baseline renders untouched)', () => {
  const s = new SimWorldState();
  s.update({ entities: new Map(), deltas: [] });
  assert.equal(s.overrideFor('f4:9,9:9'), null);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**

```js
// src/sim/sim-world-state.js — placementKey → render override, derived from sim truth alone.
import { spineStateOf, visualStateOf } from '../world/asset-state-taxonomy.js';

export class SimWorldState {
  constructor() { this._map = new Map(); this.version = 0; }
  /** Rebuild from a SimClient-shaped {entities, deltas}. Cheap: bubble-sized. */
  update({ entities, deltas }) {
    const next = new Map();
    for (const d of deltas) {
      if (d.target?.startsWith('placement:'))
        next.set(d.target.slice('placement:'.length), { visual: null, removed: true, entityId: null });
    }
    for (const e of entities.values()) {
      if (!e.placement) continue;
      if (e.type === 'matter') { next.set(e.placement, { visual: 'base', removed: false, entityId: e.id }); continue; }
      const spine = spineStateOf({ stage: e.stage, ageTicks: e.ageTicks ?? 0,
        senescenceStartTicks: e.senescenceStartTicks ?? Infinity, bufferDays: e.bufferDays ?? null });
      next.set(e.placement, { visual: visualStateOf(spine), removed: false, entityId: e.id });
    }
    this._map = next; this.version++;
  }
  overrideFor(key) { return this._map.get(key) ?? null; }
}
```

(`ageTicks`/`senescenceStartTicks` on serialized entities are delivered by Task 4 — already in its output contract. `senescenceStartTicks` may be absent on the wire (JSON cannot carry Infinity); the `?? Infinity` default above handles that.)

- [ ] **Step 4: Renderer integration (browser-verified by hand, logic already unit-tested).** In `src/main.js`: instantiate `SimClient` (url `ws://127.0.0.1:8787`, viewport = camera tile rect) + `SimWorldState`; on `onState` call `simWorldState.update(client)` and mark affected chunks dirty if your hook point is bake-time. Connection failure → `console.warn('[sim] no sim process — baseline-only world')` and NOTHING else changes (honest absence; never fake a sim). At the F4 draw/state-selection call site: compute the placement key with `placementKey(field, wx, wy, i)` semantics IDENTICAL to `sim/world/baseline.js` (the index `i` must come from the same placement-array order — this is the contract; verify by logging a few keys from both sides in dev), then `const ov = simWorldState.overrideFor(key); if (ov?.removed) skip; if (ov?.visual && ov.visual !== 'normal') use the state sprite for ov.visual (existing _states/ URLs); seedling with no sprite → existing scale-transform path (taxonomy honest-absence rule)`. Same suppression check in `applySmallScatterToChunk` for F3 (pass the override map — or the relevant removed-key set — into the worker with the chunk job; VERIFY how chunk jobs receive parameters and follow that channel). Route the existing interaction input (`src/world/interactions.js` flow) so that when a sim entity override exists near the player, the verb goes to `client.intend({ verb, target: ov.entityId })` — `harvest` for living F4, `take` for matter — instead of the local-only reaction.
- Add npm script if missing: `"sim": "node sim/server/main.js"` (VERIFY against package.json; Plan B may have added it).

- [ ] **Step 5: Manual smoke (document results in the commit message):** `npm run sim` + dev server; walk to a wired F4 plant; observe its state come from the sim (wilting plants are plants the SIM says are starving); harvest it → tick-delta arrives → sprite updates/suppresses; stop the sim process → world still renders baseline with the warn line.

- [ ] **Step 6: Run unit tests** → `node --test sim/test/sim-world-state.test.js` PASS. **Step 7: Commit**

```bash
git add src/sim/sim-world-state.js sim/test/sim-world-state.test.js src/main.js src/render/field2-animator.js src/render/worker-chunk-renderer.js package.json
git commit -m "feat(wire): renderer binds lifecycle to sprites via taxonomy; interactions become intents (spec 3.3/6.3)"
```

(Stage only files actually touched.)

---

### Task 7: Wiring probe — the world equation end to end

**Files:**
- Test: `sim/test/probe-wiring.test.js`

The Pass 1 closing probe (CLAUDE.md continuous testability + spec §6.2): real placements, real verbs, real deltas, conservation including inventories, determinism.

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-wiring.test.js — Plan E probe: placements are entities; verbs are ledger events;
// deltas suppress baseline; inventory is embodied time; f(seed, deltas, ledger) is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { DAY } from '../time/metabolism.js';
import { materializeRect } from '../world/wire.js';
import { createPlayer, harvest, take, eat } from '../world/actions.js';

const RECT = { x0: 0, y0: 0, w: 16, h: 16 };
const makeKernel = () => new Kernel({ seed: 42, phi: 4, bounds: RECT });

function boot(k) {
  k.graph.boot(() => materializeRect(k, RECT, 0));
  return createPlayer(k, 0);    // emits its own causal event — no boot scope (actions.js:8)
}
const wired = (k, pred) => [...k.graph.nodes.values()].filter(n => n.attrs?.placement && pred(n));

test('probe: harvest→eat conserves; take writes a suppressing delta; ledger explains everything', () => {
  const k = makeKernel();
  const player = boot(k);
  // Task 3 extended Kernel.stocks() with matter E + inventory E, so the Plan A identity covers wiring:
  const start = k.stocks(0);
  const bush = wired(k, n => n.attrs.field === 'f4')[0];
  const pebble = wired(k, n => n.type === 'matter')[0];
  assert.ok(bush && pebble, 'a 16×16 rect at origin must contain f3+f4 placements — if not, move RECT to a denser area and note it');
  const item = harvest(k, player.id, bush.id, 0);
  eat(k, player.id, item.id, 0);
  const taken = take(k, player.id, pebble.id, 0);
  assert.ok(taken);
  assert.ok(k.deltas.list.some(d => d.target === 'placement:' + pebble.attrs.placement));
  k.runTo(3 * DAY);
  const end = k.stocks(3 * DAY);
  const t = k.ledger.totals;
  const lhs = end - start;
  const rhs = t.captured - t.burned - t.decayed - t.transferLoss;
  const scale = Math.max(Math.abs(t.captured), 1);
  assert.ok(Math.abs(lhs - rhs) / scale < 1e-9,
    `conservation violated: Δstocks=${lhs} flows=${rhs}`);   // mirrors probe-conservation.test.js:13–18
});

test('probe: re-boot from same seed+deltas reproduces the world minus the taken placement', () => {
  const k1 = makeKernel();
  const p1 = boot(k1);
  const pebble = wired(k1, n => n.type === 'matter')[0];
  take(k1, p1.id, pebble.id, 0);
  const key = pebble.attrs.placement;
  // fresh kernel, replay the delta, boot again:
  const k2 = makeKernel();
  k2.deltas.push({ tick: 0, x: pebble.x, y: pebble.y, target: 'placement:' + key, kind: 'taken', attrs: {} });
  boot(k2);
  assert.equal(wired(k2, n => n.attrs.placement === key).length, 0);          // suppressed
  const keys = kk => new Set(wired(kk, () => true).map(n => n.attrs.placement));
  const k1keys = keys(k1); k1keys.delete(key);   // k1 already lost it to take()
  assert.deepEqual(keys(k2), k1keys);            // identical baseline otherwise
});
```

- [ ] **Step 2:** Run `node --test sim/test/probe-wiring.test.js` → green.
- [ ] **Step 3:** Full suite `npm test` → all green.
- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-wiring.test.js
git commit -m "test(wire): Pass 1 closing probe — placements⇄entities⇄deltas, conservation incl. inventory (spec 6.2)"
```

---

### Task 8: Close-out — Pass 1 100% DONE

- [ ] **Step 1:** `npm test` final run → all green; note final count.
- [ ] **Step 2:** Check every box in this plan doc; record all deviations in "Canonical deviations".
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-06-11-pass1-roadmap.md`: Plan E row → `**DONE**` (cite deviations + scope-reconciliation section), and add a line under the table: `**Pass 1 status: 100% DONE (A–E merged, <N>/<N> tests).**`
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-11-pass1e-world-wiring.md docs/superpowers/plans/2026-06-11-pass1-roadmap.md
git commit -m "docs: roadmap — Plan E DONE; Pass 1 100% DONE"
```

---

## Canonical deviations (authoritative over task text above)

*Append entries here when execution legitimately diverges from the plan. Each entry: what changed, why, and which task it affects.*

**Pre-declared limitations (not deviations — designed in):**
- Placement-bound materialization happens at boot for the start rect. Post-boot tier promotion (Plan C) still samples positions from aggregate stats rather than re-binding to placement keys; placement-pinned promotion is a later pass refinement (spec §5.3's "materializes into the claim map" is satisfied at baseline; the promote path keeps Plan C's accepted deviation).
- F2 per-plant binding, F5–F7 wiring, and fauna rendering in the main client: declared honest absence (see Scope reconciliation).
- The sim's tileInfo passes `transition: false` everywhere (the renderer's transitionPair derivation is wang-cell/terrain-level internal, worker-chunk-renderer.js:1015–1083). Sim may materialize entities on biome-transition tiles the renderer leaves bare — they simulate honestly, just have no sprite binding. Non-transition tiles have exact parity (placements depend only on wx, wy, biome).
- Placement parity assumes the BAKED default field-tuning tree (`FIELD_TUNING` empty = defaults). The dev field-tuner's localStorage override (src/dev/field-tuner.js) changes browser-side placements without the sim knowing; that tool's own workflow ("copy JSON → bake into source → clear localStorage") is the reconciliation path. Dev-mode divergence is declared, not defended against.
