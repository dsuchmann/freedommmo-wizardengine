# M3 — Emergent Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combination attempts over grain-property math — NO predefined recipes; successful attempts canonicalize discovered recipe nodes that are teachable and repeatable.

**Architecture:** A pure interaction layer (`sim/matter/interaction.js`) classifies any grain mixture by material math alone (adhesion × stability — new `adhesion` grain property, the one vocabulary addition). A `combine` verb merges inventory items conservatively (Σ grains and Σ E exact — failure produces a `ruined` item carrying everything, so NO new conservation identity terms). First success per input-signature creates a canonical `recipe` node with event provenance; knowledge lives in `knownBy` (owner-scoped, moves only by explicit `teachRecipe` — Lore seam, no telepathy). Attempts are ledger events, recipe nodes are bounded by distinct signatures (1M-entity rule safe). Until Pass 4 Agency, a headless "experimenter" probe drives discovery.

**Tech Stack:** plain JS modules, node:test. Branch `pass2-m3-recipes`. NEVER push to origin.

**Locked-decision compliance (atlas S3, locked decision 5):** no recipe is ever hardcoded. The ONLY authored data is per-grain material properties (`adhesion` — material science, same epistemic class as `stability`) and two global thresholds. Which combinations work is *derived*; the recipe catalog at runtime is exactly the set of signatures someone has attempted successfully.

**Honest absence before M3:** combinations do nothing. After M3: combinations follow material math; nothing is craftable "by name", only by attempt or taught knowledge.

**Key facts for implementers (verified against source):**
- `GRAINS` in `sim/matter/grains.js:8` — property bag `{category, purity, resonance, stability, energyDensity}` for cellulose/fibre/sugar/lignin/keratin/bone/stone/ore.
- `propertiesOf(composition)` in `sim/matter/composition.js:75` → `{totalUnits, energy, purity, resonance, stability}` (unit-weighted means).
- Inventory items (actions.js): `{id, kind, species?, archetype?, E, grains, tick}` on `player.attrs.inventory` array; module-level `nextItemId`.
- Ledger: `kernel.ledger.emit({tick, type, actor, targets, magnitude, attrs})` returns evId; `grain:*` counters auto-register; any OTHER new counter name would throw — we add none.
- Node creation with provenance: `kernel.graph.createNode({type, tick, x, y, causeEventId, attrs})` (see corpse/break-product patterns). `x: null, y: null` is legal (createPlayer does it). Nodes with `R == null` are never demoted by tiers.js.
- `auditGrains(kernel)` (sim/matter/audit.js): expected-from-ledger == Σ held-in-inventories + grain:metabolized:*. Combine merges items (held sum unchanged) and emits no grain counters → identity untouched by construction.
- Protocol intent pattern: see `strike` in sim/server/protocol.js:23-28 (extra-field validation + clamp) and server.js dispatch branch.
- Tests: `node --test sim/test/<file>`; fixture = `new Kernel({seed, phi, bounds})` + `k.graph.boot(() => ...)`; probe style = probe-objects.test.js / probe-grains.test.js.

---

## File structure

- Create `sim/matter/interaction.js` — pure outcome math + signatures (no kernel imports).
- Create `sim/matter/recipes.js` — recipe node canonicalization + teach (kernel-facing).
- Modify `sim/matter/grains.js` — add `adhesion` per grain.
- Modify `sim/matter/composition.js` — export `archetypeClassOf` (rename of private prefix-match).
- Modify `sim/world/actions.js` — `combine()` verb.
- Modify `sim/server/protocol.js`, `sim/server/server.js` — `combine` intent.
- Create tests: `sim/test/interaction.test.js`, `sim/test/recipes.test.js`, extend `sim/test/actions.test.js`, create `sim/test/probe-recipes.test.js`, extend protocol/server tests.

---

### Task 1: Interaction layer — adhesion property + pure outcome math

**Files:**
- Modify: `sim/matter/grains.js`
- Modify: `sim/matter/composition.js` (export the class key)
- Create: `sim/matter/interaction.js`
- Test: `sim/test/interaction.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/interaction.test.js — pure material math; no kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS } from '../matter/grains.js';
import { mergeGrains, adhesionOf, combineOutcome, signatureOf, INTERACTION } from '../matter/interaction.js';

test('every grain has an adhesion in [0,1]', () => {
  for (const [g, def] of Object.entries(GRAINS)) {
    assert.ok(typeof def.adhesion === 'number' && def.adhesion >= 0 && def.adhesion <= 1, g);
  }
});

test('mergeGrains sums unit-for-unit (conservation by construction)', () => {
  const m = mergeGrains([{ cellulose: 2, lignin: 1 }, { cellulose: 1, stone: 4 }]);
  assert.deepEqual(m, { cellulose: 3, lignin: 1, stone: 4 });
});

test('wood + wood binds (lignin is a natural glue): ok, composite form from top-2 grains', () => {
  const wood = { cellulose: 6, lignin: 4 };           // log yield shape
  const out = combineOutcome([wood, wood]);
  assert.equal(out.ok, true);
  assert.equal(out.form, 'composite:cellulose+lignin'); // sorted alphabetically
  assert.deepEqual(out.merged, { cellulose: 12, lignin: 8 });
});

test('stone + stone fails (zero adhesion): ruined form, grains still merged', () => {
  const out = combineOutcome([{ stone: 10 }, { stone: 10 }]);
  assert.equal(out.ok, false);
  assert.equal(out.form, 'ruined_mash');
  assert.deepEqual(out.merged, { stone: 20 });
});

test('sugary mixtures fail on stability, not adhesion (berry-harvest shape)', () => {
  const berry = { cellulose: 5, sugar: 3, fibre: 2 };
  const out = combineOutcome([berry, berry]);
  assert.ok(adhesionOf(out.merged) >= INTERACTION.minBind, 'sticky enough');
  assert.equal(out.ok, false, 'but too unstable');     // stability 0.37 < 0.4
});

test('outcome is pure and deterministic (same inputs → identical result, no RNG)', () => {
  const a = combineOutcome([{ cellulose: 6, lignin: 4 }, { fibre: 8, cellulose: 2 }]);
  const b = combineOutcome([{ cellulose: 6, lignin: 4 }, { fibre: 8, cellulose: 2 }]);
  assert.deepEqual(a, b);
});

test('signatureOf is order-independent and class-based', () => {
  const log = { kind: 'matter', archetype: 'log' };
  const log2 = { kind: 'matter', archetype: 'log' };   // distinct items, same class
  const grass = { kind: 'harvest', species: 'grass', archetype: null };
  assert.equal(signatureOf([log, grass]), signatureOf([grass, log2]));
  assert.equal(signatureOf([log, log2]), 'log+log');
  // archetype CLASS, not instance: boulder_small and boulder_mossy are both 'boulder'
  assert.equal(signatureOf([{ archetype: 'boulder_small' }, { archetype: 'boulder_mossy' }]), 'boulder+boulder');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/interaction.test.js` — Expected: FAIL (module not found / adhesion undefined).

- [ ] **Step 3: Implement**

In `sim/matter/grains.js`, extend each entry with `adhesion` (material property: how well this grain bonds a mixture — same epistemic class as stability; NOT a recipe):

```js
// { category, purity 0..1, resonance -1..1, stability 0..1 (decay resistance),
//   adhesion 0..1 (bonding quality in mixtures), energyDensity (tu per grain unit) }
export const GRAINS = {
  cellulose: { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.5,  adhesion: 0.3,  energyDensity: 80 },
  fibre:     { category: 'physical', purity: 0.5, resonance: 0.2,  stability: 0.3,  adhesion: 0.9,  energyDensity: 60 },
  sugar:     { category: 'physical', purity: 0.8, resonance: 0.4,  stability: 0.2,  adhesion: 0.6,  energyDensity: 160 },
  lignin:    { category: 'physical', purity: 0.7, resonance: 0.0,  stability: 0.8,  adhesion: 0.5,  energyDensity: 100 },
  keratin:   { category: 'physical', purity: 0.6, resonance: 0.1,  stability: 0.6,  adhesion: 0.4,  energyDensity: 90 },
  bone:      { category: 'physical', purity: 0.7, resonance: -0.1, stability: 0.9,  adhesion: 0.1,  energyDensity: 70 },
  stone:     { category: 'physical', purity: 0.5, resonance: -0.3, stability: 0.97, adhesion: 0.0,  energyDensity: 10 },
  ore:       { category: 'physical', purity: 0.4, resonance: -0.2, stability: 0.95, adhesion: 0.05, energyDensity: 20 },
};
```

In `sim/matter/composition.js`, expose the existing private prefix-match as a class key (do NOT change its behavior — `archetypeYield` keeps working):

```js
/** Canonical archetype CLASS of an instance name ('boulder_small' → 'boulder').
 *  Same longest-prefix rule the yield tables use. Exported for recipe signatures. */
export function archetypeClassOf(archetype) {
  const candidates = Object.keys(ARCHETYPE_YIELD)
    .filter(k => k !== 'default')
    .sort((a, b) => b.length - a.length);
  return candidates.find(k => String(archetype ?? '').startsWith(k)) ?? String(archetype ?? 'unknown');
}
```

(Refactor `archetypeYield` to use it: `return ARCHETYPE_YIELD[archetypeClassOf(archetype)] ?? ARCHETYPE_YIELD.default;` — keeps one source of truth.)

Create `sim/matter/interaction.js`:

```js
// sim/matter/interaction.js — minimal assembly rules over grain properties (atlas S3 recipes row).
// PURE material math: no kernel, no RNG, no recipe data. Locked decision 5: which combinations
// work is DERIVED — the only authored inputs are grain properties and these two thresholds.
import { GRAINS } from './grains.js';
import { propertiesOf, archetypeClassOf } from './composition.js';

export const INTERACTION = {
  minBind: 0.35,        // unit-weighted adhesion below this → mixture won't hold
  minStability: 0.4,    // mixture stability below this → falls apart
};

/** Sum compositions unit-for-unit. Conservation by construction. */
export function mergeGrains(list) {
  const out = {};
  for (const comp of list) {
    for (const [g, u] of Object.entries(comp ?? {})) {
      if (u > 0) out[g] = (out[g] ?? 0) + u;
    }
  }
  return out;
}

/** Unit-weighted mean adhesion of a composition. 0 when empty. */
export function adhesionOf(composition) {
  let units = 0, sum = 0;
  for (const [g, u] of Object.entries(composition)) {
    const def = GRAINS[g];
    if (!def || u <= 0) continue;
    units += u; sum += u * def.adhesion;
  }
  return units === 0 ? 0 : sum / units;
}

/** Classify a combination attempt from grain math alone.
 *  Success → form 'composite:<g1>+<g2>' (top-2 grains by units, alphabetical — derived, not named).
 *  Failure → form 'ruined_mash' (output item still carries ALL grains and E: conservation). */
export function combineOutcome(grainsList) {
  const merged = mergeGrains(grainsList);
  const props = propertiesOf(merged);
  const bind = adhesionOf(merged);
  const ok = props.totalUnits > 0 && bind >= INTERACTION.minBind && props.stability >= INTERACTION.minStability;
  let form = 'ruined_mash';
  if (ok) {
    const top = Object.entries(merged).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 2).map(([g]) => g).sort();
    form = 'composite:' + top.join('+');
  }
  return { ok, form, merged, props, bind };
}

/** Canonical input signature of an attempt: sorted item classes joined with '+'.
 *  Class = species (harvest items) or archetype CLASS (matter items). Order-independent. */
export function signatureOf(items) {
  return items.map(it => it.species ?? archetypeClassOf(it.archetype)).sort().join('+');
}
```

- [ ] **Step 4: Run tests** — `node --test sim/test/interaction.test.js sim/test/composition.test.js sim/test/grains.test.js` (existing matter tests must stay green: `propertiesOf` ignores unknown fields, M2 consumes nothing that changes). Expected: PASS.

- [ ] **Step 5: Commit** — `git add sim/matter/grains.js sim/matter/composition.js sim/matter/interaction.js sim/test/interaction.test.js && git commit -m "feat(m3): interaction layer — adhesion property + pure combination outcome math"`

---

### Task 2: Recipe canonicalization — discovered knowledge as nodes

**Files:**
- Create: `sim/matter/recipes.js`
- Test: `sim/test/recipes.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/recipes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { canonicalizeRecipe, recipeNodeOf, knowsRecipe, teachRecipe } from '../matter/recipes.js';

const makeKernel = () => new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });

test('first success creates ONE canonical recipe node with event provenance', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  const id = canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  const node = k.graph.nodes.get(id);
  assert.equal(node.type, 'recipe');
  assert.equal(node.createdByEvent ?? node.causeEventId, evId);   // provenance §5.4 (use whichever field createNode sets)
  assert.deepEqual(node.attrs, { signature: 'log+log', form: 'composite:cellulose+lignin', knownBy: [1], noFlux: true });
  // Re-discovery by someone else: SAME node, knownBy grows, no duplicate
  const evId2 = k.ledger.emit({ tick: 5, type: 'combine', actor: 2, targets: [], magnitude: 0 });
  const id2 = canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 2, evId2, 5);
  assert.equal(id2, id);
  assert.deepEqual(k.graph.nodes.get(id).attrs.knownBy, [1, 2]);
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 1);
});

test('recipeNodeOf finds by signature; knowsRecipe is owner-scoped', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  assert.ok(recipeNodeOf(k, 'log+log'));
  assert.equal(recipeNodeOf(k, 'stone+stone'), null);
  assert.equal(knowsRecipe(k, 1, 'log+log'), true);
  assert.equal(knowsRecipe(k, 2, 'log+log'), false);   // no telepathy
});

test('teachRecipe moves knowledge through an explicit event; teacher must know it', () => {
  const k = makeKernel();
  const evId = k.ledger.emit({ tick: 0, type: 'combine', actor: 1, targets: [], magnitude: 0 });
  canonicalizeRecipe(k, 'log+log', 'composite:cellulose+lignin', 1, evId, 0);
  assert.equal(teachRecipe(k, 2, 3, 'log+log', 10), false, 'non-knower cannot teach');
  assert.equal(teachRecipe(k, 1, 2, 'log+log', 10), true);
  assert.equal(knowsRecipe(k, 2, 'log+log'), true);
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'teach');
  assert.deepEqual([ev.actor, ev.targets], [1, [2]]);
  assert.equal(teachRecipe(k, 1, 2, 'log+log', 11), true, 'idempotent re-teach ok');
  assert.deepEqual(recipeNodeOf(k, 'log+log').attrs.knownBy, [1, 2], 'no duplicates');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test sim/test/recipes.test.js` — FAIL (module not found).

- [ ] **Step 3: Implement** `sim/matter/recipes.js`:

```js
// sim/matter/recipes.js — discovered recipes become canonical nodes (locked decision 5).
// Recipe nodes are KNOWLEDGE: bounded by distinct signatures (1M-entity rule safe — attempts
// are ledger events, not nodes). knownBy is owner-scoped; knowledge moves only via teachRecipe
// (Lore seam: conversation/observation, never telepathy).

/** The canonical recipe node for a signature, or null. Recipes are few: linear scan is honest. */
export function recipeNodeOf(kernel, signature) {
  for (const n of kernel.graph.nodes.values()) {
    if (n.type === 'recipe' && n.attrs.signature === signature) return n;
  }
  return null;
}

/** Idempotent: create the canonical node on first discovery, else add discoverer to knownBy.
 *  Returns the recipe node id. causeEventId = the combine event that proved it. */
export function canonicalizeRecipe(kernel, signature, form, discovererId, causeEventId, tick) {
  const existing = recipeNodeOf(kernel, signature);
  if (existing) {
    if (!existing.attrs.knownBy.includes(discovererId)) existing.attrs.knownBy.push(discovererId);
    return existing.id;
  }
  const node = kernel.graph.createNode({
    type: 'recipe', tick, x: null, y: null, causeEventId,
    attrs: { signature, form, knownBy: [discovererId], noFlux: true },
  });
  return node.id;
}

export function knowsRecipe(kernel, entityId, signature) {
  return recipeNodeOf(kernel, signature)?.attrs.knownBy.includes(entityId) ?? false;
}

/** Teacher must know the recipe. Emits a 'teach' ledger event (knowledge has provenance too). */
export function teachRecipe(kernel, teacherId, learnerId, signature, tick) {
  const node = recipeNodeOf(kernel, signature);
  if (!node || !node.attrs.knownBy.includes(teacherId)) return false;
  if (!node.attrs.knownBy.includes(learnerId)) node.attrs.knownBy.push(learnerId);
  kernel.ledger.emit({ tick, type: 'teach', actor: teacherId, targets: [learnerId],
                       attrs: { signature, recipeId: node.id } });
  return true;
}
```

NOTE for implementer: check what provenance field `kernel.graph.createNode` actually sets (`createdByEvent` vs `causeEventId` — read `sim/kernel/graph.js` and mirror how corpse creation passes it in actions.js:216-220 / lifecycle.js). Fix the test's provenance assertion to the real field; do not change graph.js. Also check whether `ledger.emit` requires `targets`/`magnitude` — mirror existing emit call shapes.

- [ ] **Step 4: Run** — `node --test sim/test/recipes.test.js` — PASS.
- [ ] **Step 5: Commit** — `git add sim/matter/recipes.js sim/test/recipes.test.js && git commit -m "feat(m3): canonical recipe nodes — discovered, owner-scoped, teachable"`

---

### Task 3: The combine verb — conservative merge + discovery hook

**Files:**
- Modify: `sim/world/actions.js`
- Test: extend `sim/test/actions.test.js`

- [ ] **Step 1: Write the failing tests** (append to `sim/test/actions.test.js`, reusing its existing kernel/player fixture pattern — read the file first and follow its makeKernel/createPlayer conventions exactly):

```js
test('combine: wood+wood → composite item, Σ E and Σ grains exact, recipe canonicalized', () => {
  // fixture: kernel + player + two wood matter nodes taken into inventory (use take() on
  // two graph.boot-created matter nodes with archetype 'log', E 40 and 60)
  const before = auditGrains(k);
  assert.equal(before.ok, true);
  const r = combine(k, player.id, [item1.id, item2.id], 0);
  assert.equal(r.ok, true);
  assert.equal(r.item.kind, 'composite');
  assert.equal(r.item.archetype, 'composite:cellulose+lignin');
  assert.equal(r.item.E, 100);                                   // exact, === (40 + 60)
  // grains: 0.006×100 cellulose, 0.004×100 lignin — float addition across two items,
  // so compare with a tiny epsilon (NOT deepEqual: 0.24+0.36 may not be bitwise 0.6)
  assert.ok(Math.abs(r.item.grains.cellulose - 0.6) < 1e-12);
  assert.ok(Math.abs(r.item.grains.lignin - 0.4) < 1e-12);
  assert.equal(player.attrs.inventory.length, 1);                // inputs consumed
  assert.ok(r.recipeId && k.graph.nodes.get(r.recipeId).type === 'recipe');
  assert.equal(auditGrains(k).ok, true);                         // identity untouched
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'combine');
  assert.equal(ev.attrs.ok, true);
});

test('combine: stone+stone → ruined item, everything conserved, NO recipe node', () => {
  // two 'pebble' items taken into inventory
  const r = combine(k, player.id, [p1.id, p2.id], 0);
  assert.equal(r.ok, false);
  assert.equal(r.item.kind, 'ruined');
  assert.equal(r.item.archetype, 'ruined_mash');
  assert.equal(r.item.E, p1E + p2E);
  assert.equal(r.recipeId, null);
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 0);
  assert.equal(auditGrains(k).ok, true);
  // ruined items are still matter: eating one metabolizes its grains and audit still holds
  eat(k, player.id, r.item.id, 1);
  assert.equal(auditGrains(k).ok, true);
});

test('combine: validation — needs ≥2 distinct ids all present in THIS player inventory', () => {
  assert.equal(combine(k, player.id, [item1.id], 0), null);            // too few
  assert.equal(combine(k, player.id, [item1.id, item1.id], 0), null);  // duplicate id
  assert.equal(combine(k, player.id, [item1.id, 99999], 0), null);     // missing item
  assert.equal(player.attrs.inventory.length, invLenBefore, 'failed validation must not consume items');
});

test('combine: repeat success reuses the canonical recipe node (no duplicates)', () => {
  // fixture: four 'log' matter items (E 10 each) taken into inventory
  const r1 = combine(k, player.id, [w1.id, w2.id], 0);
  const r2 = combine(k, player.id, [w3.id, w4.id], 1);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.recipeId, r1.recipeId, 'same signature → same canonical node');
  assert.equal([...k.graph.nodes.values()].filter(n => n.type === 'recipe').length, 1);
  assert.deepEqual(k.graph.nodes.get(r1.recipeId).attrs.knownBy, [player.id], 'no duplicate knower');
  assert.equal(player.attrs.inventory.filter(it => it.kind === 'composite').length, 2);
});
```

- [ ] **Step 2: Run to verify failure** — combine is not exported.

- [ ] **Step 3: Implement** in `sim/world/actions.js` (add imports `combineOutcome, signatureOf` from `../matter/interaction.js` and `canonicalizeRecipe` from `../matter/recipes.js`):

```js
/** Combine ≥2 inventory items: outcome derived from grain math ALONE (no recipe lookup —
 *  physics always works; recipe nodes are knowledge, not permission). Conservation by
 *  construction: output item carries Σ E and merged grains whether it succeeds or ruins.
 *  First success per signature canonicalizes a recipe node (provenance = this event). */
export function combine(kernel, playerId, itemIds, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const inv = player?.attrs.inventory ?? [];
  if (!Array.isArray(itemIds) || itemIds.length < 2) return null;
  if (new Set(itemIds).size !== itemIds.length) return null;
  const picked = itemIds.map(id => inv.find(it => it.id === id));
  if (picked.some(it => !it)) return null;            // all-or-nothing: validate before consuming
  const signature = signatureOf(picked);
  const out = combineOutcome(picked.map(it => it.grains ?? {}));
  const E = picked.reduce((s, it) => s + it.E, 0);
  for (const id of itemIds) inv.splice(inv.findIndex(it => it.id === id), 1);
  const evId = kernel.ledger.emit({
    tick, type: 'combine', actor: playerId, targets: [], magnitude: E,
    attrs: { signature, form: out.form, ok: out.ok },
  });
  const recipeId = out.ok ? canonicalizeRecipe(kernel, signature, out.form, playerId, evId, tick) : null;
  const item = { id: nextItemId++, kind: out.ok ? 'composite' : 'ruined',
                 archetype: out.form, E, grains: out.merged, tick };
  inv.push(item);
  return { ok: out.ok, item, recipeId };
}
```

- [ ] **Step 4: Run** — `node --test sim/test/actions.test.js sim/test/composition.test.js sim/test/audit.test.js` — PASS (audit identity must hold).
- [ ] **Step 5: Commit** — `git commit -m "feat(m3): combine verb — conservative merge, derived outcome, recipe discovery hook"`

---

### Task 4: Protocol intent + the experimenter probe (the M3 probe)

**Files:**
- Modify: `sim/server/protocol.js`, `sim/server/server.js` (mirror the strike pattern exactly: intent `{ type:'intent', verb:'combine', items: [...] }` — validation: `items` is an array of 2..8 DISTINCT integers; note combine has no `target` field, so the shared `Number.isInteger(m.target)` guard at protocol.js:22 must not run for combine — restructure the intent case so combine validates `items` instead of `target`)
- Test: `sim/test/probe-recipes.test.js` (new), plus one parse case in `sim/test/protocol.test.js` and one wire dispatch case in `sim/test/server.test.js` (follow the strike wire-test pattern).

**Probe scenario (headless experimenter — the Agency stand-in until Pass 4):** boot kernel (probe-objects fixture style) with a tree and several matter nodes (logs/pebbles); create player; then:
1. **Experimenter loop:** chop the tree, `take` products and pebbles into inventory; systematically attempt all distinct unordered pairs of inventory item classes (`combine`); record per-attempt `{signature, ok, form}`.
2. Assert at least one success (wood pair → `composite:cellulose+lignin`) and at least one failure (pebble pair → `ruined_mash`).
3. Assert exactly ONE recipe node exists per successful signature (set-of-signatures count == recipe node count), each with event provenance and `knownBy == [player.id]`.
4. Conservation: after all attempts, `auditGrains(kernel).ok === true`; Σ inventory E === Σ E that entered inventory (exact ===, items only merge).
5. Teach: create a second player; `teachRecipe(k, player.id, p2.id, sig, tick)` → `knowsRecipe(k, p2.id, sig) === true`; a 'teach' event is in the ledger.
6. Determinism: run the full scenario twice with the same seed; `deepEqual` the attempt records, the sorted recipe node attrs, and the audits.

- [ ] Steps: failing probe → implement protocol+server wiring → `node --test sim/test/probe-recipes.test.js sim/test/protocol.test.js sim/test/server.test.js sim/test/actions.test.js` green → Commit: `feat(m3): combine intent over protocol + experimenter probe — recipes discovered, never defined`

---

### Task 5: Full suite + close-out

- [ ] **Step 1:** `npm test` — full green (was 151; expect ≥ 160). Run in background (~8 min).
- [ ] **Step 2:** roadmap M3 row → DONE with citation; populate "Canonical deviations" below.
- [ ] **Step 3:** Commit docs: `docs(m3): close out M3 — recipes discovered, never defined`

---

## Canonical deviations

(populated during execution; authoritative over task text)

1. **Provenance field is `createdByEvent`** — `graph.createNode` stores the `causeEventId` option as `node.createdByEvent` (sim/store/graph.js:29); the plan test's hedge was resolved to that single field.
2. **serializeEntity recipe branch added** (not in the original plan — Task 2 quality review found that a client `query` for a recipe-node id would crash serializeEntity). Recipe nodes serialize as `{id, type, signature, form}` ONLY: `knownBy` is never sent to clients (knowledge stays private).
3. **Protocol hardening beyond plan text**: combine item ids must be positive integers; the parsed `items` array is defensively copied. Probe asserts the experimenter exercised ≥3 pairs (anti-vacuity guard).
4. **Accepted divergence — recipe nodes are invisible to clients.** x:null keeps them out of viewport/nodesNear; only an explicit `query` reaches the serialize branch. A "what do I know?" client query path is a future plan's job (honest absence, not a gap).
5. **Accepted divergence — composite/ruined items have no ARCHETYPE_YIELD entries.** Their grains live ON the item (snapshot semantics, like all inventory items); `eat()` reads stored grains so conservation holds. If composites ever become world nodes (M5 drop/place), `archetypeClassOf('composite:…')` falls back to the raw string and yieldOf would hit `default` — that seam must be addressed in M5, not papered over here.
6. **`recipeNodeOf` is a linear scan over all nodes** — honest at current scale (recipe count ≪ node count, short-circuits); index by signature if it ever shows up in profiles.
7. **`combine` emits no new ledger counters by design** — it redistributes held grains, so the M1 transfer-conservation identity holds with zero new terms (verified by probe step 4).
