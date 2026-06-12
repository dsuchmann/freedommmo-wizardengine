# Pass 2 — M5: Items & Equipment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Items become full citizens — durability derived from grain composition, 25+ equipment slots with layering priority, and tools that physically change what verbs do (chopping with a crafted tool recovers different break products than bare hands) — all derived from material properties, never from item-name lookups.

**Architecture:** One new authored grain property (`hardness`, the M3 `adhesion` pattern). A pure module `sim/items/items.js` derives tool power and durability from any item's grain composition. `sim/items/equipment.js` holds the authored SLOTS registry (27 slots, layering priority) and the equip/unequip verbs that move items between `player.attrs.inventory` and `player.attrs.equipment`. `kernel.stocks()` learns to count equipped items (conservation). `chop()` reads the wielded item (slot `hand_main`) and scales onChop recovery by `1 + toolPower` — bare hands = factor 1.0, unchanged behavior. Tools wear (hp, reusing M2's `stageFor`); a shattered tool stops helping but keeps its E and grains (conservation untouched — hp is not E, exactly as in M2). Protocol gains `equip`/`unequip` intents and owner-scoped inventory/equipment serialization in the tick-delta player field.

**Tech Stack:** Plain ES modules, node:test. No new dependencies.

---

## Context for the implementer (read this first)

1. **Physics, not permission (locked decision 5 ethos):** tool effectiveness is DERIVED from the wielded item's grain composition. There is no "axe" check, no item-type table, no predefined tool list. The only authored inputs are the per-grain `hardness` values and two scalar constants (wear rate, hp scale).
2. **Inventory items** (sim/world/actions.js): `{ id, kind: 'harvest'|'matter'|'composite'|'ruined', archetype, E, grains, tick }` (+ `species` on harvest). `nextItemId` is module-level; `initItemIdFromKernel` rebuilds it. M5 adds optional `hp`/`maxHp` fields (lazy, only on items that get used as tools).
3. **Grain property math:** `propertiesOf(composition)` (sim/matter/composition.js:78) returns unit-weighted means. `adhesionOf` (sim/matter/interaction.js:24) is the pattern to copy for hardness.
4. **Exact derived values used in tests** (ratio math — independent of E): a `log` item's grains have cellulose:lignin = 0.6:0.4 by units (ARCHETYPE_YIELD log = {cellulose 0.006, lignin 0.004} per tu). Therefore for any log or log+log composite: adhesion = 0.6×0.3 + 0.4×0.5 = **0.38** (≥0.35 → combine succeeds, form `composite:cellulose+lignin`, M3-verified); stability = 0.6×0.5 + 0.4×0.8 = **0.62**; with the new hardness values (cellulose 0.3, lignin 0.6): toolPower = 0.6×0.3 + 0.4×0.6 = **0.42**. Chop factor = 1.42. Tree onChop max recovery = (2×0.18 + 4×0.04)×1.42 = 0.7384 < 0.9 cap. Use epsilon 1e-12 for float compares of these derived values.
5. **Conservation:** `kernel.stocks(tick)` (sim/kernel/kernel.js:102) currently sums `n.attrs.inventory` item E. Equipped items move OUT of inventory into `attrs.equipment` — stocks MUST also sum equipment, or the conservation identity breaks the moment anything is equipped. This is a kernel change with its own test.
6. **hp is not E** (M2 precedent): wear decrements hp with zero ledger terms. A shattered tool keeps its full E and grains.
7. **Honest absences in M5 (declared, never faked):** no synergies, no sentimental value/memories (need Mind, Pass 4+), no armor/温度/defense effects of worn items (worn items are positional state only), no `drop`/`place` verb (so the documented seam — composite/ruined/feature archetypes lack ARCHETYPE_YIELD — still does not bite; re-document, don't fix speculatively), no client rendering of equipment.
8. **Roadmap probe note:** the Pass-2 probe sketch says "stone + branch → axe". Verified numerically: stone's adhesion 0.0 makes stone-headed composites fail M3's bind threshold unless lashed with a LOT of fibre (≥1.3 units ≈ 162 tu of grass bites) — that's emergent realism (an axe head needs cordage), not a bug. The M5 probe therefore crafts the physics-blessed tool (log+log wooden maul, composite:cellulose+lignin) and proves tool-vs-bare-hands product divergence with it. Do NOT touch M3 thresholds or grain adhesion values to force the stone-axe storyline.
9. **Suite:** single files via `node --test sim/test/<file>`; full suite `npm test` (~9 min, 198 tests pre-M5) only at close-out, in background. Commits: conventional message + trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`. NEVER push to origin.

---

### Task 1: `hardness` grain property + pure item math — `sim/items/items.js`

**Files:**
- Modify: `sim/matter/grains.js` (add `hardness` to each grain + header comment)
- Create: `sim/items/items.js`
- Test: `sim/test/items.test.js`

- [ ] **Step 1: Write the failing tests** — create `sim/test/items.test.js`:

```js
// sim/test/items.test.js — M5: pure item math (tool power + durability from grains).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAINS } from '../matter/grains.js';
import { toolPowerOf, maxHpOf, WEAR_PER_USE, HP_SCALE } from '../items/items.js';

const EPS = 1e-12;

test('every grain declares hardness in [0,1]', () => {
  for (const [g, def] of Object.entries(GRAINS)) {
    assert.ok(typeof def.hardness === 'number' && def.hardness >= 0 && def.hardness <= 1,
      `grain ${g} hardness`);
  }
  // anchor values the tool math depends on
  assert.equal(GRAINS.stone.hardness, 0.95);
  assert.equal(GRAINS.cellulose.hardness, 0.3);
  assert.equal(GRAINS.lignin.hardness, 0.6);
});

test('toolPowerOf: unit-weighted hardness; 0 for null/empty/zero-unit items', () => {
  assert.equal(toolPowerOf(null), 0);
  assert.equal(toolPowerOf({ grains: {} }), 0);
  assert.equal(toolPowerOf({ grains: { cellulose: 0 } }), 0);
  // wooden composite at log ratio 0.6:0.4 → 0.6*0.3 + 0.4*0.6 = 0.42
  const wood = { grains: { cellulose: 108, lignin: 72 } };
  assert.ok(Math.abs(toolPowerOf(wood) - 0.42) < EPS);
  // pure stone item → 0.95
  assert.ok(Math.abs(toolPowerOf({ grains: { stone: 2 } }) - 0.95) < EPS);
});

test('maxHpOf: HP_SCALE × unit-weighted stability; 0 for empty', () => {
  assert.equal(maxHpOf({ grains: {} }), 0);
  // wooden composite: stability 0.6*0.5 + 0.4*0.8 = 0.62 → 62
  const wood = { grains: { cellulose: 108, lignin: 72 } };
  assert.ok(Math.abs(maxHpOf(wood) - HP_SCALE * 0.62) < 1e-9);
});

test('constants are sane', () => {
  assert.equal(HP_SCALE, 100);
  assert.equal(WEAR_PER_USE, 10);
});

test('unknown grains are ignored (forward-compat with future grain types)', () => {
  const it = { grains: { cellulose: 1, mystery_goo: 5 } };
  assert.ok(Math.abs(toolPowerOf(it) - 0.3) < EPS, 'mystery grain contributes nothing');
});
```

- [ ] **Step 2:** Run `node --test sim/test/items.test.js` — FAIL (module not found).

- [ ] **Step 3: Implement.** In `sim/matter/grains.js`, extend the property comment (line 6-7) with `hardness 0..1 (resistance to deformation; tool-edge quality)` and add to each grain:

| grain | hardness |
|---|---|
| cellulose | 0.3 |
| fibre | 0.1 |
| sugar | 0.05 |
| lignin | 0.6 |
| keratin | 0.5 |
| bone | 0.8 |
| stone | 0.95 |
| ore | 0.9 |

Create `sim/items/items.js`:

```js
// sim/items/items.js — M5: pure item math. Tool power and durability are DERIVED
// from grain composition (physics-not-permission: no item-type tables, no "axe" checks).
// hp is not E: wear never touches the ledger (M2 precedent).
import { GRAINS } from '../matter/grains.js';

export const HP_SCALE = 100;      // maxHp = HP_SCALE × unit-weighted stability
export const WEAR_PER_USE = 10;   // hp lost per tool-assisted verb use

/** Unit-weighted mean of a grain property over a composition. 0 when empty. */
function weighted(composition, prop) {
  let units = 0, sum = 0;
  for (const [g, u] of Object.entries(composition ?? {})) {
    const def = GRAINS[g];
    if (!def || u <= 0) continue;
    units += u; sum += u * def[prop];
  }
  return units === 0 ? 0 : sum / units;
}

/** Tool power of an inventory item: unit-weighted hardness. 0 for no item / no grains. */
export function toolPowerOf(item) {
  return weighted(item?.grains, 'hardness');
}

/** Durability ceiling of an item: HP_SCALE × unit-weighted stability. */
export function maxHpOf(item) {
  return HP_SCALE * weighted(item?.grains, 'stability');
}
```

- [ ] **Step 4:** Run `node --test sim/test/items.test.js` — all PASS. Also run `node --test sim/test/grains.test.js sim/test/interaction.test.js sim/test/composition.test.js` (grains.js changed — its consumers must still pass; the grains test may assert exact property sets, adjust ONLY if it enumerates property keys, never weaken value assertions).

- [ ] **Step 5: Commit:**
```bash
git add sim/matter/grains.js sim/items/items.js sim/test/items.test.js
git commit -m "feat(sim): M5 hardness grain property + derived tool power / durability

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Equipment slots + equip/unequip — `sim/items/equipment.js`, stocks fix

**Files:**
- Create: `sim/items/equipment.js`
- Modify: `sim/kernel/kernel.js` (stocks: count equipment, lines 117-120 area)
- Test: `sim/test/equipment.test.js`

- [ ] **Step 1: Write the failing tests** — create `sim/test/equipment.test.js`:

```js
// sim/test/equipment.test.js — M5: slots registry + equip/unequip + stocks conservation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { SLOTS, equip, unequip, wieldedItem } from '../items/equipment.js';
import { createPlayer } from '../world/actions.js';

function playerWithItem(itemOverrides = {}) {
  const k = new Kernel({ seed: 5, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  const p = createPlayer(k, 0);
  const item = { id: 1, kind: 'matter', archetype: 'pebble', E: 200, grains: { stone: 2 }, tick: 0, ...itemOverrides };
  (p.attrs.inventory ??= []).push(item);
  return { k, p, item };
}

test('SLOTS: ≥25 slots, each with integer layer priority; hand_main and hand_off exist', () => {
  const names = Object.keys(SLOTS);
  assert.ok(names.length >= 25, `need ≥25 slots, got ${names.length}`);
  for (const [name, def] of Object.entries(SLOTS)) {
    assert.ok(Number.isInteger(def.layer), `slot ${name} has integer layer`);
  }
  assert.ok(SLOTS.hand_main && SLOTS.hand_off, 'wield slots exist');
});

test('equip moves item from inventory to equipment; emits equip event', () => {
  const { k, p, item } = playerWithItem();
  const ok = equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(ok, true);
  assert.equal(p.attrs.inventory.length, 0, 'item left inventory');
  assert.equal(p.attrs.equipment.hand_main.id, item.id, 'item in slot');
  const ev = k.ledger.events.at(-1);
  assert.equal(ev.type, 'equip');
  assert.equal(ev.actor, p.id);
  assert.deepEqual(ev.attrs, { itemId: item.id, slot: 'hand_main', archetype: 'pebble' });
});

test('equip fails honestly: unknown slot, occupied slot, missing item', () => {
  const { k, p, item } = playerWithItem();
  assert.equal(equip(k, p.id, item.id, 'third_arm', 0), false, 'unknown slot');
  assert.equal(equip(k, p.id, 999, 'hand_main', 0), false, 'missing item');
  assert.equal(equip(k, p.id, item.id, 'hand_main', 0), true);
  const item2 = { id: 2, kind: 'matter', archetype: 'pebble', E: 50, grains: { stone: 0.5 }, tick: 0 };
  p.attrs.inventory.push(item2);
  assert.equal(equip(k, p.id, item2.id, 'hand_main', 0), false, 'occupied slot');
  assert.equal(p.attrs.inventory.length, 1, 'failed equip leaves inventory intact');
});

test('unequip moves item back to inventory; emits unequip event; empty slot fails', () => {
  const { k, p, item } = playerWithItem();
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(unequip(k, p.id, 'hand_main', 1), true);
  assert.equal(p.attrs.inventory[0].id, item.id);
  assert.equal(p.attrs.equipment.hand_main, undefined);
  assert.equal(k.ledger.events.at(-1).type, 'unequip');
  assert.equal(unequip(k, p.id, 'hand_main', 2), false, 'empty slot');
});

test('wieldedItem returns hand_main item or null', () => {
  const { k, p, item } = playerWithItem();
  assert.equal(wieldedItem(p), null);
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(wieldedItem(p).id, item.id);
});

test('CONSERVATION: stocks unchanged across equip/unequip (equipped E still counted)', () => {
  const { k, p, item } = playerWithItem();
  const before = k.stocks(0);
  equip(k, p.id, item.id, 'hand_main', 0);
  assert.equal(k.stocks(0), before, 'equip must not change world stocks');
  unequip(k, p.id, 'hand_main', 1);
  assert.equal(k.stocks(0), before, 'unequip must not change world stocks');
});
```

- [ ] **Step 2:** Run `node --test sim/test/equipment.test.js` — FAIL.

- [ ] **Step 3: Implement.** Create `sim/items/equipment.js`:

```js
// sim/items/equipment.js — M5: equipment slots (atlas S3: 25+ slots, layering priority).
// SLOTS is authored data, like species — the no-mock rule forbids predefined RECIPES,
// not body topology. Worn items are positional state ONLY in M5 (no armor/warmth effects —
// honest absence until the systems that consume them exist). layer = draw/stack priority
// (low under high); future body rendering (Pass 4 L2) consumes it.
export const SLOTS = {
  head:           { layer: 30 },
  face:           { layer: 31 },
  ears:           { layer: 32 },
  eyes:           { layer: 33 },
  neck:           { layer: 25 },
  shoulders:      { layer: 24 },
  back:           { layer: 23 },
  chest:          { layer: 20 },
  torso_under:    { layer: 10 },
  arms:           { layer: 21 },
  wrist_left:     { layer: 26 },
  wrist_right:    { layer: 27 },
  hands:          { layer: 22 },
  finger_left_1:  { layer: 40 },
  finger_left_2:  { layer: 41 },
  finger_right_1: { layer: 42 },
  finger_right_2: { layer: 43 },
  waist:          { layer: 15 },
  legs:           { layer: 14 },
  legs_under:     { layer: 9 },
  ankle_left:     { layer: 12 },
  ankle_right:    { layer: 13 },
  feet:           { layer: 11 },
  hand_main:      { layer: 50 },   // wield slot: tools/weapons
  hand_off:       { layer: 51 },
  tattoo:         { layer: 1 },    // skin-layer adornments (SCI_FI archaeology)
  implant:        { layer: 0 },
};

/** Move an inventory item into an equipment slot. Fails honestly (false) on
 *  unknown slot, occupied slot, or missing item. Item E stays player-held
 *  (kernel.stocks counts equipment — conservation). */
export function equip(kernel, playerId, itemId, slot, tick) {
  const player = kernel.graph.nodes.get(playerId);
  if (!player || !SLOTS[slot]) return false;
  const eq = (player.attrs.equipment ??= {});
  if (eq[slot]) return false;
  const inv = player.attrs.inventory ?? [];
  const i = inv.findIndex(it => it.id === itemId);
  if (i < 0) return false;
  const [item] = inv.splice(i, 1);
  eq[slot] = item;
  kernel.ledger.emit({
    tick, type: 'equip', actor: playerId, targets: [],
    attrs: { itemId: item.id, slot, archetype: item.archetype ?? null },
  });
  return true;
}

/** Move an equipped item back to inventory. False if slot empty/unknown. */
export function unequip(kernel, playerId, slot, tick) {
  const player = kernel.graph.nodes.get(playerId);
  const eq = player?.attrs.equipment;
  if (!eq?.[slot]) return false;
  const item = eq[slot];
  delete eq[slot];
  (player.attrs.inventory ??= []).push(item);
  kernel.ledger.emit({
    tick, type: 'unequip', actor: playerId, targets: [],
    attrs: { itemId: item.id, slot, archetype: item.archetype ?? null },
  });
  return true;
}

/** The item in hand_main, or null. Verbs read this for tool modulation. */
export function wieldedItem(player) {
  return player?.attrs.equipment?.hand_main ?? null;
}
```

In `sim/kernel/kernel.js` `stocks()`, extend the inventory block (currently `if (n.attrs?.inventory) { for (const item of n.attrs.inventory) s += item.E; }`):

```js
      // Inventory items (any node type, incl. players): embodied time waiting to be eaten.
      if (n.attrs?.inventory) {
        for (const item of n.attrs.inventory) s += item.E;
      }
      // Equipped items are still player-held stock (M5): equip moves items between
      // containers, never out of the world.
      if (n.attrs?.equipment) {
        for (const item of Object.values(n.attrs.equipment)) s += item.E;
      }
```

Also update `initItemIdFromKernel` in sim/world/actions.js to scan equipment too (id-collision safety after load):

```js
export function initItemIdFromKernel(kernel) {
  let max = 0;
  for (const n of kernel.graph.nodes.values()) {
    for (const item of (n.attrs?.inventory ?? [])) {
      if (item.id > max) max = item.id;
    }
    for (const item of Object.values(n.attrs?.equipment ?? {})) {
      if (item.id > max) max = item.id;
    }
  }
  nextItemId = max + 1;
}
```

- [ ] **Step 4:** Run `node --test sim/test/equipment.test.js sim/test/kernel.test.js sim/test/actions.test.js` — all PASS.

- [ ] **Step 5: Commit:**
```bash
git add sim/items/equipment.js sim/kernel/kernel.js sim/world/actions.js sim/test/equipment.test.js
git commit -m "feat(sim): M5 equipment slots + equip/unequip; stocks count equipped items

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Tool-modulated chop + wear — `sim/world/actions.js`

**Files:**
- Modify: `sim/world/actions.js` (`chop`, lines 71-94; add imports)
- Test: `sim/test/actions.test.js` (append)

Design (derived, conserved): `factor = 1 + toolPowerOf(wieldedItem(player))`, clamped so the summed effective eFrac over the EXPANDED product list ≤ 0.9 (the corpse must keep a remainder). Each onChop row's eFrac is multiplied by the clamped factor; `spawnBreakProducts` is otherwise untouched. Bare hands: factor exactly 1.0 → bit-identical to current behavior (regression-critical). Wear: after a tool-assisted chop (factor > 1), lazy-init `item.maxHp = maxHpOf(item)`, `item.hp ??= item.maxHp`, then `item.hp = Math.max(0, item.hp - WEAR_PER_USE)`. A tool whose `stageFor(hp, maxHp) === 'shattered'` contributes power 0 (factor 1.0) — it still exists, still holds E + grains.

- [ ] **Step 1: Write the failing tests** — append to `sim/test/actions.test.js` (READ it first; reuse its kernel/player/tree helpers — it has M2/M3-era patterns for booting a tree and chopping):

```js
test('M5 chop: wielded wooden composite recovers more product E than bare hands (deterministic)', () => {
  // Two identical worlds; in one, the player wields a wooden composite (log-ratio grains).
  const woodTool = () => ({ id: 901, kind: 'composite', archetype: 'composite:cellulose+lignin',
                            E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 0 });
  const run = withTool => {
    const k = mkKernelWithTree();             // adapt to the file's existing helper
    const p = createPlayer(k, 0);
    if (withTool) {
      p.attrs.inventory = [woodTool()];
      equip(k, p.id, 901, 'hand_main', 0);
    }
    chop(k, p.id, TREE_ID(k), 0);             // adapt: however the file resolves the tree node id
    const products = [...k.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.noFlux);
    const corpse = [...k.graph.nodes.values()].find(n => n.type === 'corpse');
    return { productE: products.reduce((s, n) => s + n.attrs.E, 0), corpseE: corpse.attrs.E,
             total: products.reduce((s, n) => s + n.attrs.E, 0) + corpse.attrs.E };
  };
  const bare = run(false), tooled = run(true);
  assert.ok(tooled.productE > bare.productE, 'tool recovers more product E');
  assert.ok(Math.abs(tooled.total - bare.total) < 1e-6, 'corpse+products E identical: conservation');
  // exact factor: toolPower 0.42 → each product row eFrac × 1.42
  assert.ok(Math.abs(tooled.productE - bare.productE * 1.42) < 1e-6, 'factor is exactly 1 + toolPower');
});

test('M5 wear: tool hp decrements per assisted chop; shattered tool gives factor 1', () => {
  const k = mkKernelWithTree();               // adapt as above; needs several trees OR re-boot per chop
  const p = createPlayer(k, 0);
  const tool = { id: 902, kind: 'composite', archetype: 'composite:cellulose+lignin',
                 E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 0 };
  p.attrs.inventory = [tool];
  equip(k, p.id, 902, 'hand_main', 0);
  chop(k, p.id, TREE_ID(k), 0);
  const worn = p.attrs.equipment.hand_main;
  assert.ok(Math.abs(worn.maxHp - 62) < 1e-9, 'maxHp = 100 × stability(0.62)');
  assert.ok(Math.abs(worn.hp - 52) < 1e-9, 'one WEAR_PER_USE decrement');
  // force shatter, then verify no further wear and bare-handed products
  worn.hp = 0;
  // (chop a second tree in the same world, or boot a fresh world copying the shattered tool)
  // assert: toolPowerOf path yields factor 1 — products match a bare-hands chop exactly,
  // and worn.hp stays 0 (no wear when the tool no longer assists).
});

test('M5 chop bare-hands regression: identical to pre-M5 behavior (factor exactly 1)', () => {
  // No equipment → chop must produce bit-identical products to the existing M2 expectations.
  // Reuse/duplicate the file's existing chop-products assertions here unchanged.
});
```

These sketches MUST be adapted to actions.test.js's real helpers (tree species constants, kernel boot pattern, existing chop tests) — the assertions (more product E with tool, exact 1.42 factor, conservation, wear decrement of exactly WEAR_PER_USE, shattered → factor 1, bare-hands bit-identical) are the contract and may not be weakened. Where the sketch says "second tree", boot the world with two trees so one kernel serves both chops.

- [ ] **Step 2:** Run `node --test sim/test/actions.test.js` — new tests FAIL.

- [ ] **Step 3: Implement** in `sim/world/actions.js`. Add imports:

```js
import { toolPowerOf, maxHpOf, WEAR_PER_USE } from '../items/items.js';
import { wieldedItem } from '../items/equipment.js';
import { stageFor } from '../matter/objects.js';   // stageFor already imported — keep single import line
```

In `chop()` replace the onChop block:

```js
    const onChop = OBJECT_DEFS[species]?.onChop;
    if (onChop) {
      // Tool modulation (M5): recovery scales with the wielded item's derived hardness.
      // Bare hands → factor exactly 1 (pre-M5 behavior). Shattered tools assist nothing.
      const player = kernel.graph.nodes.get(playerId);
      const tool = wieldedItem(player);
      let factor = 1;
      if (tool) {
        if (tool.maxHp == null) { tool.maxHp = maxHpOf(tool); tool.hp = tool.maxHp; }
        const broken = tool.maxHp <= 0 || stageFor(tool.hp, tool.maxHp) === 'shattered';
        if (!broken) {
          factor = 1 + toolPowerOf(tool);
          // cap: expanded products must leave the corpse a remainder (Σ eFrac×factor ≤ 0.9)
          const maxSum = onChop.reduce((s, row) => s + row.count[1] * row.eFrac, 0);
          if (maxSum * factor > 0.9) factor = 0.9 / maxSum;
          tool.hp = Math.max(0, tool.hp - WEAR_PER_USE);   // wear: hp is not E, no ledger
        }
      }
      const table = factor === 1 ? onChop
        : onChop.map(row => ({ ...row, eFrac: row.eFrac * factor }));
      const products = spawnBreakProducts(kernel, corpse, table, evId, tick, corpse.attrs.E, false);
      const productSumE = products.reduce((s, n) => s + n.attrs.E, 0);
      corpse.attrs.E -= productSumE;
    }
```

Note the chop event is emitted BEFORE this block (evId already exists) — leave event emission untouched; deterministic RNG keying (causeEventId, pi) is unchanged because the table rows keep their order and count ranges.

- [ ] **Step 4:** Run `node --test sim/test/actions.test.js sim/test/probe-objects.test.js sim/test/probe-recipes.test.js` — all PASS (the probes chop bare-handed → must be bit-identical).

- [ ] **Step 5: Commit:**
```bash
git add sim/world/actions.js sim/test/actions.test.js
git commit -m "feat(sim): M5 tool-modulated chop + wear — recovery derived from wielded grain hardness

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Protocol intents + owner-scoped item wire + probe

**Files:**
- Modify: `sim/server/protocol.js` (VERBS + intent parsing), `sim/server/server.js` (dispatch + player field)
- Test: `sim/test/protocol.test.js`, `sim/test/server.test.js` (append), Create: `sim/test/probe-items.test.js`

- [ ] **Step 1: protocol tests** — append to `sim/test/protocol.test.js`:

```js
test('parseClientMsg: equip intent needs positive int item + known-shaped slot string', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3, slot: 'hand_main' })),
    { type: 'intent', verb: 'equip', item: 3, slot: 'hand_main' });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 0, slot: 'hand_main' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 1.5, slot: 'hand_main' })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3, slot: 42 })), null);
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'equip', item: 3 })), null);
});

test('parseClientMsg: unequip intent needs slot string', () => {
  assert.deepEqual(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'unequip', slot: 'hand_main' })),
    { type: 'intent', verb: 'unequip', slot: 'hand_main' });
  assert.equal(parseClientMsg(JSON.stringify({ type: 'intent', verb: 'unequip' })), null);
});

test('serializeItem: id/kind/archetype/E/stage only — grains stay sim-side', () => {
  const item = { id: 7, kind: 'composite', archetype: 'composite:cellulose+lignin',
                 E: 100, grains: { cellulose: 108, lignin: 72 }, tick: 3, hp: 52, maxHp: 62 };
  assert.deepEqual(serializeItem(item),
    { id: 7, kind: 'composite', archetype: 'composite:cellulose+lignin', E: 100, stage: 'cracked' });
  // undamaged item (no hp tracking yet): stage 'intact'
  const fresh = { id: 8, kind: 'matter', archetype: 'pebble', E: 200, grains: { stone: 2 }, tick: 0 };
  assert.equal(serializeItem(fresh).stage, 'intact');
});
```

Slot validation in protocol is SHAPE-only (string, length ≤ 32, `/^[a-z_0-9]+$/`) — slot EXISTENCE is sim authority (equip returns false). Don't import SLOTS into protocol.js: validation lives there for untrusted input shape, authority lives in the sim.

- [ ] **Step 2: implement protocol.** In `sim/server/protocol.js`: add `'equip', 'unequip'` to VERBS. In the intent case, before the generic target branch:

```js
      if (m.verb === 'equip') {
        if (!Number.isInteger(m.item) || m.item <= 0) return null;
        if (typeof m.slot !== 'string' || m.slot.length > 32 || !/^[a-z_0-9]+$/.test(m.slot)) return null;
        return { type: 'intent', verb: 'equip', item: m.item, slot: m.slot };
      }
      if (m.verb === 'unequip') {
        if (typeof m.slot !== 'string' || m.slot.length > 32 || !/^[a-z_0-9]+$/.test(m.slot)) return null;
        return { type: 'intent', verb: 'unequip', slot: m.slot };
      }
```

Add and export `serializeItem` (grains/tick/hp/maxHp are sim-internal; stage is render truth):

```js
/** Wire form of an inventory/equipment item. Grains and raw hp stay sim-side. */
export function serializeItem(item) {
  const stage = item.maxHp != null ? stageFor(item.hp, item.maxHp) : 'intact';
  return { id: item.id, kind: item.kind, archetype: item.archetype ?? null, E: item.E, stage };
}
```

(import `stageFor` from `../matter/objects.js` at the top of protocol.js.)

- [ ] **Step 3: server dispatch + player wire.** READ sim/server/server.js first. Add dispatch branches in the intent pump (mirroring the combine branch): `equip` → `equip(kernel, playerId, msg.item, msg.slot, tick)`, `unequip` → `unequip(kernel, playerId, msg.slot, tick)` (import from `../items/equipment.js`). Extend the tick-delta player field from `{ R: player?.R ?? 0 }` to:

```js
{
  R: player?.R ?? 0,
  inventory: (player?.attrs.inventory ?? []).map(serializeItem),
  equipment: Object.fromEntries(Object.entries(player?.attrs.equipment ?? {})
    .map(([slot, it]) => [slot, serializeItem(it)])),
}
```

This is owner-scoped by construction (each socket's tick-delta carries only that socket's player). Append a server.test.js test: connect a client, equip via intent, assert the next tick-delta's `player.equipment.hand_main.id` matches and that NO entity payload anywhere contains a `grains` field (knowledge/composition stays sim-side). Match the existing server.test.js harness patterns (READ it first).

- [ ] **Step 4: the probe** — create `sim/test/probe-items.test.js`. The headless experimenter, end-to-end:

```js
// sim/test/probe-items.test.js — M5 probe: craft → equip → tool-assisted chop, vs bare hands.
// The Pass-2 milestone: a crafted composite tool exists with provenance + grains, and chopping
// with it measurably diverges from bare hands — with conservation + grain audit intact.
```

Scenario (adapt M3's probe-recipes boot pattern — tree with R 20000 / body 30000 + player):
1. World A (seed 99): chop tree bare-handed at tick 0, take both logs, `combine` them → assert `ok === true`, `item.archetype === 'composite:cellulose+lignin'`, recipe node canonicalized with provenance (M3 machinery exercised end-to-end).
2. `equip` the composite into `hand_main` → assert wieldedItem set.
3. Boot World B (same seed) twice: chop bare vs chop tooled (pre-load the tool item + equip before the chop, as in Task 3's test) — assert tooled product E sum = bare × (1 + toolPower) within 1e-6, corpse+products total identical, tool hp = maxHp − WEAR_PER_USE.
4. Conservation: `auditGrains(k)` ok on World A after all steps; ledger identity `Δstocks == captured − burned − decayed − transferLoss` (copy the exact assertion from probe-conservation.test.js) on World B's tooled run after `runTo(1*DAY)`.
5. Determinism: run the World A scenario twice (same seed) → deepEqual of {final inventory+equipment shapes, recipe attrs, audit}.

- [ ] **Step 5:** Run `node --test sim/test/protocol.test.js sim/test/server.test.js sim/test/probe-items.test.js` — all PASS.

- [ ] **Step 6: Commit:**
```bash
git add sim/server/protocol.js sim/server/server.js sim/test/protocol.test.js sim/test/server.test.js sim/test/probe-items.test.js
git commit -m "feat(sim): M5 equip/unequip intents + owner-scoped item wire + items probe

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Close-out — full suite, roadmap, deviations

- [ ] **Step 1:** `npm test` in background (~9 min). Expected: all pass (198 pre-M5 + new).
- [ ] **Step 2:** Append `## Deviations (canonical)` section to this doc (every divergence + why; authoritative over task bodies).
- [ ] **Step 3:** Roadmap M5 row → DONE with final test count.
- [ ] **Step 4:** Commit both docs:
```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md docs/superpowers/plans/2026-06-12-pass2-m5-items-equipment.md
git commit -m "docs(sim): M5 items & equipment close-out — roadmap DONE, deviations recorded

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Out of scope (honest absences, declared)

- **Synergies, sentimental value, memories-attached**: need Mind/social systems (Pass 4+). Slots/layering carry the data shape; nothing consumes it yet.
- **Worn-item effects** (armor, warmth, social impact): worn items are positional state only.
- **drop/place verbs**: items cannot re-enter the world as nodes — so the ARCHETYPE_YIELD seam for composite/ruined/feature archetypes still does not bite (re-documented, not fixed).
- **Tool modulation of strike/pick/harvest**: chop only in M5; the `wieldedItem` + factor pattern is the seam.
- **Client rendering of equipment/inventory**: wire only.
- **Stone axe storyline**: emergent-feasibility documented above (needs cordage mass); deferred until shaping/grinding verbs exist.

## Deviations (canonical — authoritative over task bodies above)

1. **Prototype-chain slot injection fixed (Task 2 fix commit b9c14783f).** The plan's `!SLOTS[slot]` guard was bypassable: `SLOTS['constructor']` resolves truthy through the prototype chain, and `'constructor'` passes the protocol slot regex. Both `equip` and `unequip` now validate with `Object.hasOwn(SLOTS, slot)` and check occupancy with `Object.hasOwn(eq, slot)`. Two extra tests (re-equip round trip; 'constructor' rejected by both verbs). equipment.test.js is 8 tests, not the plan's 6.
2. **`sim/matter/audit.js` extended (Task 4, pre-authorized in-flight).** `auditGrains` only scanned `attrs.inventory`; equipped items' grains vanished from "held". One loop added scanning `Object.values(node.attrs.equipment ?? {})` — symmetric with the kernel.stocks() fix. Without it the probe's audit step fails with anything equipped.
3. **serializeItem 'cracked' test uses hp 30 / maxHp 62, not hp 52.** Real stageFor thresholds make 52/62 (0.84) 'intact' (intact > 0.75). Plan's sketch value corrected; assertion strength unchanged.
4. **Probe World B uses seed 3 (actions.test.js pattern), not seed 99.** Two reasons: seed-99 single tree yields only 1 log (combine needs 2 — World A therefore boots TWO trees at (4,4)/(8,8)); and bare-vs-tooled runs have different chop event IDs (equip emits an event first), and spawnBreakProducts keys product COUNTS on causeEventId — the exact-1.42 assertion requires equal counts. Seed 3 gives equal counts for both event IDs. This is by design, not a bug: the 1.42 factor applies to eFrac per product row; counts are RNG-determined by causal history.
5. **Wear test bit-identity trick (Task 3).** The shattered-tool-equals-bare-hands comparison world also calls `equip()` (same ledger event sequence → same causeEventId at the chop) but pre-sets hp=0, isolating the factor difference from RNG divergence.

**Accepted hardening backlog (revisit P4, none load-bearing now):**
- Weighted-mean helper now has 3 copies (items.js `weighted`, interaction.js `adhesionOf`, composition.js `propertiesOf`) with inconsistent null-handling — extract shared `weightedMean` into grains.js before a 4th copy appears.
- No test exercises the chop factor CLAMP path (needs toolPower high enough that maxSum×factor > 0.9, e.g. pure-stone tool); math verified in review only.
- `serializeItem`: `stageFor(undefined, maxHp)` → 'shattered' if an item ever has maxHp without hp; add `item.hp != null` guard when hardening.
- equip/unequip don't capture their ledger event id (other verbs do, for causal chaining) — add when equipment-triggered effects need causal links.
- Tool lazy-init hp/maxHp mutates items without ledger trace — fine (hp is not E) but check when save/load persistence is built.
- SLOTS layer numbering is intentionally sparse (gaps for future insertion); note when body rendering consumes it.

## Seams for later plans

- Tool factor pattern (wieldedItem → derived factor → table scaling) generalizes to strike damage and harvest yields.
- `SLOTS[*].layer` is the body-rendering stack order for Pass 4 L2 body assembly.
- `serializeItem` is the single wire shape for future container/trade systems.
- Item `hp/maxHp` + `stageFor` is the repair-verb seam (repair = future causal event, possibly consuming grains — would need ledger terms).
