# Pass 2 Plan M1 — Material System (Grains) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every physical thing in the world gets a grain composition (atomic matter with property bags on physical/magical/spiritual/technical axes), and matter transfers ride the ledger with a conservation identity — nothing destroyed, only transformed.

**Architecture:** Grains are NOT nodes (1M-entity rule — a tree is not 50,000 grain nodes). A grain *type registry* (`sim/matter/grains.js`) defines property bags; *composition* is lazily **derived** from what a node already is (species + body for living nodes, archetype + E for matter/corpse nodes) via pure deterministic functions (`sim/matter/composition.js`) — consistent with world = f(seed, deltas, ledger): no new stored state for baseline things. Stored composition appears only where matter leaves its source: inventory items snapshot `grains` at harvest/take time. Conservation is a **transfer identity**, not a total: every grain in an inventory or sink-counter traces to a ledger event; an audit function recomputes expected grains from the event log and matches actuals. Growth minting from substrate is counted implicitly by derivation (soil depletion is a declared absence — atlas S2 Substrate edge, later pass).

**Tech Stack:** Node ≥20 ESM, existing sim kernel (`sim/`), `node --test`. No new dependencies.

**Authority:** roadmap row M1 (`2026-06-12-pass2plus-roadmap.md`), atlas S3 Material System row, archaeology `SCI_FI_FANTASY_SYSTEMS.md` grain schema (property vocabulary mined: category, purity, resonance, stability, energy density — Python shapes dropped).

**Honest absence closed by this plan:** "what is this made of" was unanswerable. After M1: every matter/living/corpse node and every inventory item answers `compositionOf(...)`; emergent properties (`propertiesOf`) exist for M2/M3 to consume. NOT in scope (later plans): grain → break-products (M2), grain math recipes (M3), per-grain rendering, soil/substrate pools.

**Conventions (same as Pass 1):** TDD per task, frequent commits, GIT SAFETY (never push to origin, never touch master except final ff-merge), deviations recorded in "Canonical deviations" section of this doc. Branch: `pass2-m1-grains` off master.

---

## Design constants (used by every task — read first)

**Grain categories:** `physical`, `magical`, `spiritual`, `technical`. Pass 2 ships physical grains only; the other three categories exist in the registry shape from day one (empty is honest; a magical world without magic grains yet is absent, not fake).

**Grain property bag:** `{ category, purity (0..1), resonance (-1..1), stability (0..1), energyDensity (tu per grain unit) }`. `energyDensity` ties grains to the time metabolism: embodied time E of a thing ≈ Σ grains·energyDensity is NOT enforced as an equality (body/E and grains are independent measures: one is time, one is matter) — but harvest yields derive grain units from bite magnitude, so the two stay proportional at transfer points.

**Initial physical grain types (registry rows):** `cellulose` (wood/stem bulk), `fibre` (grass/leaf), `sugar` (fruit), `lignin` (hardwood), `keratin` (animal), `bone`, `stone`, `ore`. Property values in Task 1.

**Composition yields:** per species, grain units per tu of body (living) — e.g. grass `{ fibre: 0.008, cellulose: 0.002 }`; per F3/F4 matter archetype-class, grain units per tu of E — e.g. rocks `{ stone: 0.01 }`. Full tables in Task 2. Yields are tunables; the conservation identity must hold for ANY values.

**Ledger counters (namespaced, existing `ledger.count` mechanism):** `grain:metabolized:<type>` (eaten/picked — matter dispersed into a body, body composition is S4-later), `grain:decayed:<type>` (corpse decay tail). Sinks, never sources.

---

### Task 1: Grain type registry

**Files:**
- Create: `sim/matter/grains.js`
- Test: `sim/test/grains.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/grains.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS, CATEGORIES } from '../matter/grains.js';

test('grain registry: categories and property-bag shape', () => {
  assert.deepEqual(CATEGORIES, ['physical', 'magical', 'spiritual', 'technical']);
  assert.ok(Object.keys(GRAINS).length >= 8);
  for (const [name, g] of Object.entries(GRAINS)) {
    assert.ok(CATEGORIES.includes(g.category), `${name} category`);
    assert.ok(g.purity >= 0 && g.purity <= 1, `${name} purity`);
    assert.ok(g.resonance >= -1 && g.resonance <= 1, `${name} resonance`);
    assert.ok(g.stability >= 0 && g.stability <= 1, `${name} stability`);
    assert.ok(g.energyDensity > 0, `${name} energyDensity`);
  }
  // Pass 2 ships physical only; other categories may be empty but the vocabulary exists.
  assert.ok(Object.values(GRAINS).some(g => g.category === 'physical'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/grains.test.js`
Expected: FAIL — cannot find module `../matter/grains.js`

- [ ] **Step 3: Write the registry**

```js
// sim/matter/grains.js — Grain type registry (atlas S3 Material System).
// Grains are TYPES with property bags, never nodes (1M-entity rule).
// Property vocabulary mined from SCI_FI_FANTASY_SYSTEMS.md design archaeology.
export const CATEGORIES = ['physical', 'magical', 'spiritual', 'technical'];

// { category, purity 0..1, resonance -1..1, stability 0..1 (decay resistance),
//   energyDensity (tu per grain unit at transfer points) }
export const GRAINS = {
  cellulose: { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.5, energyDensity: 80 },
  fibre:     { category: 'physical', purity: 0.5, resonance: 0.2,  stability: 0.3, energyDensity: 60 },
  sugar:     { category: 'physical', purity: 0.8, resonance: 0.4,  stability: 0.2, energyDensity: 160 },
  lignin:    { category: 'physical', purity: 0.7, resonance: 0.0,  stability: 0.8, energyDensity: 100 },
  keratin:   { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.6, energyDensity: 90 },
  bone:      { category: 'physical', purity: 0.7, resonance: -0.1, stability: 0.9, energyDensity: 70 },
  stone:     { category: 'physical', purity: 0.5, resonance: -0.3, stability: 0.97, energyDensity: 10 },
  ore:       { category: 'physical', purity: 0.4, resonance: -0.2, stability: 0.95, energyDensity: 20 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sim/test/grains.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sim/matter/grains.js sim/test/grains.test.js
git commit -m "feat(m1): grain type registry with property bags"
```

---

### Task 2: Derived composition (living, matter, corpse nodes)

**Files:**
- Create: `sim/matter/composition.js`
- Test: `sim/test/composition.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/composition.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES_YIELD, ARCHETYPE_YIELD, compositionOf, grainsForBite } from '../matter/composition.js';
import { SPECIES } from '../time/metabolism.js';
import { GRAINS } from '../matter/grains.js';

test('every kernel species and yield table entry is well-formed', () => {
  for (const sp of Object.keys(SPECIES)) {
    assert.ok(SPECIES_YIELD[sp], `species ${sp} has a yield table`);
  }
  for (const tbl of [...Object.values(SPECIES_YIELD), ...Object.values(ARCHETYPE_YIELD)]) {
    for (const [g, perTu] of Object.entries(tbl)) {
      assert.ok(GRAINS[g], `grain type ${g} exists in registry`);
      assert.ok(perTu > 0);
    }
  }
});

test('compositionOf derives lazily from node state — no storage, deterministic', () => {
  const bush = { type: 'living', R: 500, attrs: { species: 'berry_bush', body: 4000 } };
  const c1 = compositionOf(bush);
  const c2 = compositionOf(bush);
  assert.deepEqual(c1, c2);
  // grass yield: grains scale linearly with body
  const small = compositionOf({ type: 'living', attrs: { species: 'grass', body: 100 } });
  const big   = compositionOf({ type: 'living', attrs: { species: 'grass', body: 200 } });
  for (const g of Object.keys(small)) assert.ok(Math.abs(big[g] - 2 * small[g]) < 1e-9);
});

test('matter and corpse nodes derive from archetype/species + E', () => {
  const rock = { type: 'matter', attrs: { archetype: 'boulder_small', E: 1000 } };
  const c = compositionOf(rock);
  assert.ok(c.stone > 0);
  const corpse = { type: 'corpse', attrs: { species: 'tree', E: 2000 } };
  assert.ok(compositionOf(corpse).lignin > 0);
});

test('grainsForBite: transfer-point grains proportional to bite magnitude', () => {
  const g300 = grainsForBite('berry_bush', 300);
  const g600 = grainsForBite('berry_bush', 600);
  for (const k of Object.keys(g300)) assert.ok(Math.abs(g600[k] - 2 * g300[k]) < 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/composition.test.js` — Expected: FAIL (module missing)

- [ ] **Step 3: Write composition module**

```js
// sim/matter/composition.js — Lazily DERIVED grain composition (no stored state
// for baseline things — world = f(seed, deltas, ledger), spec §5.1).
// Living nodes: grains = yield[species] * body. Matter/corpse: yield * E.
// Stored composition exists only on inventory items (snapshot at transfer).

// grain units per tu of body (living nodes)
export const SPECIES_YIELD = {
  grass:      { fibre: 0.008, cellulose: 0.002 },
  berry_bush: { cellulose: 0.005, sugar: 0.003, fibre: 0.002 },
  tree:       { cellulose: 0.006, lignin: 0.004 },
  grazer:     { keratin: 0.005, bone: 0.003 },
};

// grain units per tu of E (matter nodes by archetype CLASS — prefix match,
// so 'boulder_small'/'boulder_mossy' → 'boulder'). Default: stone.
export const ARCHETYPE_YIELD = {
  boulder: { stone: 0.01 },
  rock:    { stone: 0.01 },
  stone:   { stone: 0.01 },
  log:     { cellulose: 0.006, lignin: 0.004 },
  branch:  { cellulose: 0.008, lignin: 0.002 },
  stump:   { cellulose: 0.005, lignin: 0.005 },
  ore:     { ore: 0.008, stone: 0.004 },
  default: { stone: 0.01 },
};

function archetypeYield(archetype) {
  const key = Object.keys(ARCHETYPE_YIELD).find(k => k !== 'default' && String(archetype ?? '').startsWith(k));
  return ARCHETYPE_YIELD[key ?? 'default'];
}

function scale(tbl, magnitude) {
  const out = {};
  for (const [g, perTu] of Object.entries(tbl)) out[g] = perTu * magnitude;
  return out;
}

/** Derived grain composition of any node. Pure; never mutates. */
export function compositionOf(node) {
  const a = node.attrs ?? {};
  if (node.type === 'matter') return scale(archetypeYield(a.archetype), a.E ?? 0);
  if (node.type === 'corpse') {
    const tbl = a.species ? SPECIES_YIELD[a.species] : archetypeYield(a.archetype);
    return scale(tbl ?? ARCHETYPE_YIELD.default, a.E ?? 0);
  }
  if (a.species && SPECIES_YIELD[a.species]) return scale(SPECIES_YIELD[a.species], a.body ?? 0);
  return {};
}

/** Grains leaving a living node when `bite` tu of body+R is taken (transfer point). */
export function grainsForBite(species, bite) {
  return scale(SPECIES_YIELD[species] ?? {}, bite);
}
```

- [ ] **Step 4: Run test** — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sim/matter/composition.js sim/test/composition.test.js
git commit -m "feat(m1): derived grain composition for living/matter/corpse nodes"
```

---

### Task 3: Emergent properties (M2/M3's consumption surface)

**Files:**
- Modify: `sim/matter/composition.js` (append)
- Test: `sim/test/composition.test.js` (append)

- [ ] **Step 1: Write the failing test (append to composition.test.js)**

```js
test('propertiesOf: composition-weighted emergent properties', () => {
  const { propertiesOf } = await import('../matter/composition.js'); // or add to top-level imports
  const p = propertiesOf({ stone: 10 });
  assert.ok(Math.abs(p.stability - 0.97) < 1e-9);     // pure stone = stone's stability
  assert.ok(Math.abs(p.purity - 0.5) < 1e-9);
  assert.ok(p.totalUnits === 10 && p.energy === 100); // 10 units * 10 tu/unit
  const mix = propertiesOf({ cellulose: 5, lignin: 5 });
  assert.ok(mix.stability > 0.5 && mix.stability < 0.8); // weighted between components
  assert.deepEqual(propertiesOf({}), { totalUnits: 0, energy: 0, purity: 0, resonance: 0, stability: 0 });
});
```

(Implementer: hoist the import to the top-level import list rather than dynamic import.)

- [ ] **Step 2: Run, verify fails** (`propertiesOf` not exported)

- [ ] **Step 3: Implement (append to composition.js)**

```js
/** Composition-weighted emergent properties (M2 durability + M3 recipe math consume this). */
export function propertiesOf(composition) {
  let totalUnits = 0, energy = 0, purity = 0, resonance = 0, stability = 0;
  for (const [g, units] of Object.entries(composition)) {
    const def = GRAINS[g];
    if (!def || units <= 0) continue;
    totalUnits += units;
    energy += units * def.energyDensity;
    purity += units * def.purity;
    resonance += units * def.resonance;
    stability += units * def.stability;
  }
  if (totalUnits === 0) return { totalUnits: 0, energy: 0, purity: 0, resonance: 0, stability: 0 };
  return { totalUnits, energy, purity: purity / totalUnits, resonance: resonance / totalUnits, stability: stability / totalUnits };
}
```

Add `import { GRAINS } from './grains.js';` at the top of composition.js.

- [ ] **Step 4: Run full file** — `node --test sim/test/composition.test.js` — PASS

- [ ] **Step 5: Commit**

```bash
git add sim/matter/composition.js sim/test/composition.test.js
git commit -m "feat(m1): emergent properties from grain composition"
```

---

### Task 4: Wire transfer points — items carry grains, sinks are counted

**Files:**
- Modify: `sim/world/actions.js` (harvest, take, pick, eat)
- Modify: `sim/time/lifecycle.js` (corpse decay grain counting — find the corpse-materialize path; decay counting lives in `sim/time/metabolism.js` `materialize()` corpse branch)
- Test: `sim/test/actions.test.js` (append cases) — read the existing file first and follow its kernel-fixture pattern

**Wiring spec (exact):**

1. **`harvest()`** (actions.js:83): after computing `bite`, snapshot `const grains = grainsForBite(prey.attrs.species, bite);` and put `grains` on the item object (alongside `E`). Import from `../matter/composition.js`.
2. **`take()`** (actions.js:116): item gets `grains: compositionOf(node)` (whole matter node, lossless).
3. **`pick()`** (actions.js:34): bite is eaten immediately — no item. Count each grain type into the metabolized sink: `for (const [g, u] of Object.entries(grainsForBite(prey.attrs.species, bite))) kernel.ledger.count('grain:metabolized:' + g, u);`
4. **`eat()`** (actions.js:136): the item's `grains` (if present) go to the same metabolized sink, same loop. Items without `grains` (pre-M1 saves) count nothing — declared migration behavior.
5. **Corpse decay** (`metabolism.js` `materialize()` corpse branch, line ~67): when E decays by `(before - node.attrs.E)`, the same *fraction* of grains decays. Since corpse composition is derived from E, derivation already shrinks automatically — but the decayed grains must be counted into the sink so the audit balances: `const lost = before - node.attrs.E;` then for each grain type in the corpse's per-tu yield table, `ledger.count('grain:decayed:' + g, perTu * lost)`. Implementer: move the yield-table lookup (`SPECIES_YIELD[species] ?? archetypeYield(archetype)`) into a small exported helper `yieldOf(node)` in composition.js to avoid duplicating prefix-match logic. **Import direction:** metabolism.js may import from matter/ (matter sits beside time, no cycle — composition.js must NOT import metabolism.js; the Task 2 test imports both, which is fine).

- [ ] **Step 1: Write failing tests** (append to `sim/test/actions.test.js` following its existing fixture pattern — read it first): (a) harvest item has `grains` with `cellulose`/`sugar` keys proportional to bite; (b) take item grains equal `compositionOf` of the node pre-removal; (c) pick increments `grain:metabolized:*` counters by `grainsForBite` amounts; (d) eat moves item grains into `grain:metabolized:*`; (e) corpse decay over N days increments `grain:decayed:*` proportional to E lost.
- [ ] **Step 2: Run, verify failures**
- [ ] **Step 3: Implement per wiring spec above** (smallest diffs; do not restructure actions.js)
- [ ] **Step 4: Run `node --test sim/test/actions.test.js sim/test/composition.test.js sim/test/metabolism.test.js`** — PASS (metabolism tests guard against regression in the corpse branch)
- [ ] **Step 5: Commit**

```bash
git add sim/world/actions.js sim/time/metabolism.js sim/matter/composition.js sim/test/actions.test.js
git commit -m "feat(m1): grain transfers at harvest/take/pick/eat + decay sink counting"
```

---

### Task 5: Conservation audit + probe test (the M1 probe)

**Files:**
- Create: `sim/matter/audit.js`
- Test: `sim/test/probe-grains.test.js`

**Audit identity (transfer conservation):** for every grain type g:
`Σ grains[g] across all inventory items (all nodes) + counter('grain:metabolized:' + g) + counter('grain:decayed:' + g) === Σ expected[g] from replaying ledger events`
where expected is recomputed from events: `pick`/`harvest` events contribute `grainsForBite(attrs.species, magnitude)`; `take` events contribute `magnitude * yield(archetype)` (take events must carry `attrs.archetype` — add it in `take()` if missing, it currently doesn't record archetype on the event: it does on the delta, add `attrs: { archetype }` to the take event emit) ... **plus** decayed-counter equality is verified directly (decay is counted at the only place it happens, so the audit checks metabolized+held against events, and accepts `grain:decayed:*` as its own ledger-counted term on both sides — concretely: expected_from_events == held_in_inventories + metabolized; decayed applies only to corpse-derived grains which never enter events, so assert decayed counters are ≥ 0 and monotonic instead).

**Simplification the implementer must honor:** the audit function `auditGrains(kernel)` returns `{ ok, perGrain: { [g]: { expected, held, metabolized } } }` with `ok = |expected - held - metabolized| < 1e-6 * max(1, expected)` per grain.

- [ ] **Step 1: Write the probe test** — fixture: boot a fresh kernel on the land smoke rect (reuse the boot pattern from `sim/test/probe-interaction.test.js` — read it first), create player, run several sim-days, then: pick a berry_bush 3×, harvest 2×, take an F3 matter node, eat one item, chop a tree; advance more days (corpse decay); call `auditGrains(kernel)`; assert `ok === true` for every grain type and at least 3 grain types have nonzero expected. Also assert determinism: a second identically-seeded run produces an identical audit object (`assert.deepEqual`).
- [ ] **Step 2: Run, verify fails** (audit module missing)
- [ ] **Step 3: Implement `sim/matter/audit.js`** — walk `kernel.ledger.events` for pick/harvest/take, accumulate expected via composition helpers; walk all graph nodes' `attrs.inventory` for held; read counters via the ledger counter API (read `sim/store/ledger.js` for the exact counter accessor).
- [ ] **Step 4: Run probe + whole suite for the touched areas:** `node --test sim/test/probe-grains.test.js sim/test/probe-conservation.test.js sim/test/probe-intent-replay.test.js` — PASS (time-conservation and replay probes must remain green: grain counting must not perturb time accounting or determinism)
- [ ] **Step 5: Commit**

```bash
git add sim/matter/audit.js sim/test/probe-grains.test.js sim/world/actions.js
git commit -m "test(m1): grain conservation probe — transfer identity audits clean"
```

---

### Task 6: Full suite + roadmap close-out

- [ ] **Step 1:** `npm test` — full suite green (was 118; expect ≥ 121). Fix any regression (likely suspects: checkpoint round-trip serializing item `grains` — items live in attrs JSON so it should be free; replay probe if event attrs changed).
- [ ] **Step 2:** Update `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` M1 row status → `DONE (deviations cited)`; add a "Canonical deviations" section to THIS doc listing every accepted deviation from task text.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass2-m1-material-grains.md
git commit -m "docs(m1): close out M1 — grains live, conservation probe green"
```

---

## Canonical deviations

- **Tasks 2+3 merged into single commit** (`dd828c5dc`): `propertiesOf` requires `import { GRAINS }` which was also needed for Task 2's `ARCHETYPE_YIELD` validation in tests. Writing both in the same module pass was strictly cleaner than splitting. Test file was also written with all 5 tests (Tasks 2+3) together because `propertiesOf` was hoisted to the top-level import as the plan instructed. Both commits still land on the correct branch; no logic was skipped.
- **Ledger extended for `grain:*` counters** (`c61bfbd67`, file not in Task 4's `git add` list): `sim/store/ledger.js` auto-registers `grain:*` counters on first use; non-grain counter names still validate/throw. Grain counters live in the same `totals` dict, so they persist through checkpoints for free, and the time-conservation identity (which sums only its four named counters) is untouched.
- **Longest-prefix archetype matching** (`c61bfbd67`): quality-review advisory folded in — `archetypeYield` sorts candidate prefixes longest-first so key insertion order can never change which yield table wins.
- **Probe fixture fabricates one matter node via `graph.boot()`** (`df2ce6c31`): the seeded meadow spawn doesn't guarantee an F3 matter node in the rect, so the probe creates one inside a `graph.boot()` block (the same provenance-exempt API spawn itself uses) and then exercises the REAL `take()` path. Honest fixture, not a mock.
- **Audit treats `grain:decayed:*` as a reported sink, not an identity term** (per plan text): decay applies only to corpse-derived grains that never enter pick/harvest/take events; the audit asserts decayed counters are finite and ≥ 0 and folds that into overall `ok`.

**(Final whole-branch review fixes)**
- **Corpses now carry `species` (+`archetype`)** (`30b039022`, `06af12f64`): both corpse-creation paths — `die()` in lifecycle.js and statistical-tier detritus promotion in tiers.js — omitted `species` from corpse attrs, so `yieldOf(corpse)` fell through to the default stone yield and ALL real corpse decay counted the wrong grain types. The Task 4 test had masked this by fabricating a corpse with species set; it now creates the corpse via the real `chop()` path and asserts cellulose/lignin (and no stone) decay.
- **Aggregate-tier instant decay (`detritusE ≤ 0.5` and aggregate-node internal decay) counts time `decayed` but not `grain:decayed:*`** — accepted LOD semantic divergence: grain decay counters are a reported sink (not an identity term), and statistical-tier matter never entered any grain transfer event. Documented here per final review; revisit if a future plan makes grain:decayed load-bearing.
