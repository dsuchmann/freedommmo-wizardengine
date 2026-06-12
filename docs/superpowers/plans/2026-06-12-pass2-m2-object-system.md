# Pass 2 Plan M2 — Object System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matter objects get durability stages (intact→cracked→fractured→shattered), typed resistances, and break products forming a CLOSED transformation graph — breaking something never deletes matter, it partitions it into catalog products with provenance.

**Architecture:** Object definitions live in a registry keyed by archetype class (`sim/matter/objects.js`), reusing M1's longest-prefix matching. Damage state is lazily attached to matter nodes (`attrs.hp`, initialized from the def on first strike); durability stage is DERIVED from hp (no stored stage). A new `strike` verb applies `damage × resistance`, emits a ledger event, writes a `damaged` delta on stage change (renderer seam — damage-state sprites bind later per taxonomy/W1, honest absence until then), and on shatter spawns break products as real matter nodes that **partition the parent's E exactly** (Σ child E = parent E; grain composition stays derived, so grain conservation follows when product yield tables match the parent's material class). Living trees: `chop` now also yields products (logs/branches as matter nodes) with the stump corpse keeping the remainder — total E across stump + products equals the pre-chop body+R-derived E, so Pass 1's conservation identity is untouched.

**Tech Stack:** Node ≥20 ESM, existing sim kernel, `node --test`. No new dependencies.

**Authority:** roadmap row M2 (`2026-06-12-pass2plus-roadmap.md`), atlas S3 Object System row ("instances with lifecycle, durability, break products; F2–F7 decorations become citizens"), archaeology terrain-object 3-axis model (`2026-05-28-terrain-object-system-design.md`: hp ranges intact 75–100 / cracked 40–75 / fractured 10–40 / shattered 0–10 per 100 hp; resistances blunt/sharp/fire/frost as taken-fraction multipliers; break_products with count ranges; closure principle "nothing disappears; every destruction yields catalog members"). M1 modules consumed: `compositionOf`, `propertiesOf`, `yieldOf` (`sim/matter/composition.js`).

**Honest absence closed:** breaking something previously just removed it (take/chop delete + matter E). After M2: damage is stateful, staged, resisted, and productive. NOT in scope: damage-stage *rendering* (sprites bind when taxonomy damage states generate — W1/F5), product *scatter physics* (products place adjacent deterministically), burning/freezing interactions (fire/frost resistances exist as data; no ignition system yet — absent, not fake), grain-type transmutation on break (products keep the parent's material class).

**Conventions:** TDD, frequent commits, GIT SAFETY (never push origin, never touch master except final ff), deviations → "Canonical deviations". Branch: `pass2-m2-objects` off master.

---

## Design constants (read first)

**Damage types:** `blunt`, `sharp`, `fire`, `frost`. Resistance = fraction of damage TAKEN (archaeology convention: 0.5 ⇒ takes 50%).

**Stage derivation (per 1.0 of maxHp, scaled):** `intact` hp>0.75·max, `cracked` >0.40·max, `fractured` >0.10·max, `shattered` ≤0.10·max. Shatter triggers product spawn + parent removal.

**Determinism:** product counts use count RANGES from archaeology, resolved via the kernel's seeded RNG stream (`sim/kernel/rng.js` — read it; use a dedicated stream keyed by (seed, 'break', eventId)) so replay is bit-identical. NO Math.random.

**E partition:** products receive fixed FRACTIONS of parent E (per def), remainder goes to the last product (dust/smallest) so the sum is exact (no float drift): compute all but last as `Math.floor(frac*E*1e6)/1e6`-style truncation is NOT needed — just assign last = parent E − Σ others.

**Catalog (initial defs, archetype-class keyed — same longest-prefix matching as M1 ARCHETYPE_YIELD):**

| class | maxHp | resistances (blunt/sharp/fire/frost) | break products (class, countRange, eFracEach) |
|---|---|---|---|
| `boulder` | 100 | 0.5/0.2/0.05/0.3 | rock_chunk ×[2,4] (0.18 each of E, capped), pebble ×[5,12] (0.015 each), stone_dust ×1 (remainder) |
| `rock` | 40 | 0.6/0.25/0.05/0.3 | pebble ×[3,6] (0.12 each), stone_dust ×1 (remainder) |
| `rock_chunk` | 40 | 0.6/0.25/0.05/0.3 | pebble ×[3,6] (0.12 each), stone_dust ×1 (remainder) |
| `stone` | 25 | 0.6/0.3/0.05/0.3 | pebble ×[2,4] (0.15 each), stone_dust ×1 (remainder) |
| `pebble` | 10 | 0.7/0.4/0.05/0.4 | stone_dust ×1 (remainder) |
| `stone_dust` | — terminal (no durability; strike returns false) | — | — |
| `log` | 60 | 0.4/0.8/0.9/0.2 | branch ×[2,4] (0.15 each), wood_scrap ×1 (remainder) |
| `branch` | 20 | 0.5/0.9/0.95/0.2 | wood_scrap ×1 (remainder) |
| `wood_scrap` | — terminal | — | — |
| `stump` | 80 | 0.4/0.7/0.9/0.2 | wood_scrap ×[2,5] (0.12 each), wood_scrap ×1 (remainder) → implementer: just wood_scrap ×[3,6] with remainder-to-last |

If E·frac for a product would be ≤ 0, skip that product (tiny parents break straight to dust). **Closure check (test-enforced):** every product class must itself have a def or be terminal, and have an ARCHETYPE_YIELD entry in M1's table (add `pebble`, `rock_chunk`, `stone_dust` → stone-class yields; `wood_scrap` → `{ cellulose: 0.006, lignin: 0.004 }`; `dust`-prefix caution: name is `stone_dust` so the longest-prefix match hits `stone` — ADD an explicit `stone_dust` yield entry equal to stone's so there's no ambiguity).

**Living on_chop products (tree):** on `chop`, before the corpse is created, compute `E_total = body + R` of the tree; products: `log` ×[1,2] (0.18·E each), `branch` ×[2,4] (0.04·E each); stump corpse keeps `E_total − Σ products`. Grass/berry_bush/grazer chop behavior unchanged (no products — their defs omit `onChop`).

**Tree species yield note:** product nodes are matter; their composition derives from ARCHETYPE_YIELD (`log`/`branch` already exist in M1's table with cellulose+lignin — same material class as tree's SPECIES_YIELD; closed).

---

### Task 1: Object definition registry + stage/damage math

**Files:**
- Create: `sim/matter/objects.js`
- Test: `sim/test/objects.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/objects.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_DEFS, defOf, stageFor, damageTaken, TERMINAL } from '../matter/objects.js';
import { ARCHETYPE_YIELD } from '../matter/composition.js';

test('catalog closure: every break product has a def-or-terminal and a grain yield', () => {
  for (const [cls, def] of Object.entries(OBJECT_DEFS)) {
    for (const p of def.breakProducts ?? []) {
      assert.ok(OBJECT_DEFS[p.class] || TERMINAL.has(p.class), `${cls} product ${p.class} in catalog`);
      const hasYield = Object.keys(ARCHETYPE_YIELD).some(k => p.class.startsWith(k)) || ARCHETYPE_YIELD[p.class];
      assert.ok(hasYield, `${cls} product ${p.class} has grain yield`);
    }
  }
  // explicit entries added to M1's table
  for (const cls of ['pebble', 'rock_chunk', 'stone_dust', 'wood_scrap']) {
    assert.ok(ARCHETYPE_YIELD[cls], `${cls} explicit yield`);
  }
});

test('defOf: longest-prefix archetype-class matching', () => {
  assert.equal(defOf('boulder_small'), OBJECT_DEFS.boulder);
  assert.equal(defOf('rock_chunk'), OBJECT_DEFS.rock_chunk);   // longest prefix beats 'rock'
  assert.equal(defOf('stone_dust'), null);                      // terminal: no def
  assert.equal(defOf('totally_unknown'), null);
});

test('stageFor derives stage from hp fraction', () => {
  assert.equal(stageFor(100, 100), 'intact');
  assert.equal(stageFor(75, 100), 'cracked');     // boundary: >0.75 is intact
  assert.equal(stageFor(41, 100), 'cracked');
  assert.equal(stageFor(40, 100), 'fractured');
  assert.equal(stageFor(10, 100), 'shattered');
  assert.equal(stageFor(0, 100), 'shattered');
});

test('damageTaken applies typed resistance', () => {
  const def = OBJECT_DEFS.boulder;
  assert.equal(damageTaken(def, 'blunt', 20), 10);   // 0.5 taken
  assert.equal(damageTaken(def, 'sharp', 20), 4);    // 0.2 taken
  assert.equal(damageTaken(def, 'unknown', 20), 0);  // unknown type: no effect (honest)
});
```

- [ ] **Step 2: Run, verify fails** — `node --test sim/test/objects.test.js`

- [ ] **Step 3: Implement `sim/matter/objects.js`** — `OBJECT_DEFS` exactly per the Design-constants table (shape: `{ maxHp, resist: { blunt, sharp, fire, frost }, breakProducts: [{ class, count: [lo,hi], eFrac }], onChop?: [...] } `; tree's onChop lives here too: `OBJECT_DEFS.tree = { onChop: [{ class:'log', count:[1,2], eFrac:0.18 }, { class:'branch', count:[2,4], eFrac:0.04 }] }` with no maxHp — living things don't take durability damage in M2); `TERMINAL = new Set(['stone_dust','wood_scrap'])`; `defOf(archetype)` longest-prefix over def keys, returns null for terminal/unknown; `stageFor(hp, maxHp)` per thresholds (>0.75 intact, >0.40 cracked, >0.10 fractured, else shattered); `damageTaken(def, type, amount)` = `amount * (def.resist[type] ?? 0)`.
  Also: append to M1's `ARCHETYPE_YIELD` in `sim/matter/composition.js`: `rock_chunk`, `pebble`, `stone_dust` (each `{ stone: 0.01 }`), `wood_scrap` (`{ cellulose: 0.006, lignin: 0.004 }`).

- [ ] **Step 4: Run** — objects + composition + grains tests green.

- [ ] **Step 5: Commit** — `feat(m2): object definition catalog — durability, resistances, closed break-product graph`

---

### Task 2: `strike` verb — staged damage, deltas, shatter → products

**Files:**
- Modify: `sim/world/actions.js` (new export `strike`)
- Test: `sim/test/actions.test.js` (append)

**Wiring spec (exact):**

```js
/** Strike a matter node with typed damage. Stage changes write a 'damaged' delta;
 *  shatter partitions E into break products (closed graph) and removes the parent. */
export function strike(kernel, playerId, targetId, damageType, amount, tick) {
  const node = kernel.graph.nodes.get(targetId);
  if (!node || node.type !== 'matter') return null;
  const def = defOf(node.attrs.archetype);
  if (!def?.maxHp) return null;                       // terminal or undamageable: honest no-op
  if (node.attrs.hp == null) node.attrs.hp = def.maxHp;   // lazy init
  const before = stageFor(node.attrs.hp, def.maxHp);
  const taken = damageTaken(def, damageType, amount);
  if (taken <= 0) return { stage: before, destroyed: false, products: [] };
  node.attrs.hp = Math.max(0, node.attrs.hp - taken);
  const after = stageFor(node.attrs.hp, def.maxHp);
  const evId = kernel.ledger.emit({
    tick, type: 'strike', actor: playerId, targets: [targetId], magnitude: taken,
    attrs: { archetype: node.attrs.archetype ?? null, damageType, stage: after },
  });
  if (after === before && after !== 'shattered') return { stage: after, destroyed: false, products: [] };
  if (after !== 'shattered') {
    // stage changed: persistent visual delta (renderer binds when damage sprites exist — W1)
    kernel.deltas.push({ tick, x: node.x, y: node.y,
      target: node.attrs.placement ? 'placement:' + node.attrs.placement : `node:${targetId}`,
      kind: 'damaged', attrs: { stage: after, archetype: node.attrs.archetype ?? null } });
    return { stage: after, destroyed: false, products: [] };
  }
  // SHATTER: spawn products partitioning E exactly, then remove parent.
  const products = spawnBreakProducts(kernel, node, def.breakProducts, evId, tick);
  if (node.attrs.placement) {
    kernel.deltas.push({ tick, x: node.x, y: node.y, target: 'placement:' + node.attrs.placement,
      kind: 'destroyed', attrs: { archetype: node.attrs.archetype ?? null } });
  }
  kernel.graph.removeNode(targetId);
  return { stage: 'shattered', destroyed: true, products };
}
```

`spawnBreakProducts(kernel, parent, table, causeEventId, tick)` (module-private in actions.js or a small export in objects.js — implementer's choice, record it): resolve each count range with the kernel RNG stream keyed `('break', causeEventId, i)` (read `sim/kernel/rng.js` for the stream API — follow how reproduction/spawn already draws), compute per-product E = `eFrac * parentE` (parentE = `parent.attrs.E`), skip products with E ≤ 1e-9, LAST product gets `parentE − Σ assigned` (exact partition; if that remainder ≤ 0, fold it into the previous product). Each product: `kernel.graph.createNode({ type:'matter', tick, x: parent.x, y: parent.y, causeEventId, attrs: { archetype: p.class, E, noFlux: true } })` — positions co-located with parent (scatter physics = declared absence). Returns array of created nodes.

**Tests (append to actions.test.js, existing fixture pattern):** (a) strike below stage boundary → stage 'cracked', a `damaged` delta written, hp persisted; (b) repeated strikes to shatter → parent removed, products exist with Σ E == parent E exactly (assert with 1e-9), every product archetype in catalog-or-terminal, all products carry `createdByEvent`; (c) strike on terminal (`stone_dust` node) and on unknown-def archetype returns null; (d) unknown damage type → zero damage, no stage change, no delta; (e) determinism: same scenario twice in fresh kernels → identical product counts and E values.

- [ ] **Step 1: failing tests** → **Step 2: verify fail** → **Step 3: implement** → **Step 4:** `node --test sim/test/actions.test.js sim/test/objects.test.js sim/test/probe-grains.test.js` green (grain audit must stay ok — strike events are outside the transfer identity; products are world nodes whose composition is derived; taking a product later enters the identity via its own archetype yield) → **Step 5: Commit** — `feat(m2): strike verb — staged damage, damaged/destroyed deltas, shatter partitions E into products`

---

### Task 3: Chop yields products (trees)

**Files:**
- Modify: `sim/world/actions.js` (`chop`)
- Test: `sim/test/actions.test.js` (append)

**Wiring spec:** in `chop()`, after the existing `die()` call returns the corpse: if `OBJECT_DEFS[target.attrs.species]?.onChop` exists (only `tree` in M2), compute products from the corpse's E (`corpse.attrs.E`): spawn via the same `spawnBreakProducts` mechanism (count ranges via RNG keyed to the chop event id; per-product E = eFrac × corpseE), then SUBTRACT Σ product E from `corpse.attrs.E` (stump keeps the remainder; assert remainder > 0 by construction — fracs sum ≤ 0.18·2+0.04·4 = 0.52). Products are matter nodes co-located at the stump, `causeEventId` = the chop event. Conservation: total E unchanged (moved, not minted) — `decayed`/`burned` counters untouched at chop time. NOTE: products do NOT decay (matter nodes are inert, noFlux) while the stump corpse continues its halflife decay — same semantics as F3 matter vs corpses today.

**Tests:** (f) chop a mature tree → corpse exists AND ≥1 log + ≥2 branches exist; corpse.E + Σ product E == pre-chop (body + R) within 1e-6 (read how die() computes corpse E first — verify against that, not a re-derivation); felled delta + healDeltaId behavior unchanged (existing probe-6 assertions must stay green); (g) chop grass → no products (def absent), exact old behavior.

- [ ] Steps: failing tests → fail → implement → `node --test sim/test/actions.test.js sim/test/probe-interaction.test.js sim/test/probe-conservation.test.js` green → Commit: `feat(m2): chop yields log/branch products; stump keeps the E remainder`

---

### Task 4: Protocol intent + probe (the M2 probe)

**Files:**
- Modify: `sim/server/protocol.js`, `sim/server/server.js` (add `strike` intent — read how existing intents pick/chop/harvest/take/eat parse and dispatch first; mirror exactly: intent `{ type:'intent', verb:'strike', target, damageType, amount }` with validation: target finite id, damageType one of the four, amount finite > 0, clamp amount ≤ 50)
- Test: `sim/test/probe-objects.test.js` (new — the M2 probe), plus one wire case in the existing protocol/server test file (follow its pattern)

**Probe scenario (headless, deterministic, seeded):** boot kernel (same fixture style as probe-grains); create a boulder matter node (graph.boot, E=5000, archetype 'boulder_small') and a tree; then:
1. Strike the boulder with sharp ×N until cracked — assert `damaged` delta exists with stage 'cracked'.
2. Continue with blunt until shattered — assert: parent gone, products spawned, Σ product E == 5000 exactly, every product in catalog-or-terminal.
3. **Closure walk:** repeatedly strike the largest remaining product until only terminal-class nodes remain (bounded loop, assert it terminates < 200 strikes); assert final Σ E across terminal nodes == 5000 (closed graph, nothing leaked).
4. Chop the tree → products + stump; `take` a log into inventory; `auditGrains(kernel)` still `ok === true` (M1 identity holds with product-archetype yields).
5. Determinism: full scenario twice, deepEqual the audits and the sorted list of (archetype, E) pairs.

- [ ] Steps: failing probe → fail → implement protocol+server wiring → run `node --test sim/test/probe-objects.test.js sim/test/protocol.test.js sim/test/server.test.js sim/test/probe-grains.test.js` green → Commit: `feat(m2): strike intent over protocol + probe — closed transformation graph audits clean`

---

### Task 5: Full suite + close-out

- [ ] **Step 1:** `npm test` — full green (was 131; expect ≥ 138).
- [ ] **Step 2:** roadmap M2 row → DONE with deviation citation; populate "Canonical deviations" below.
- [ ] **Step 3:** Commit docs: `docs(m2): close out M2 — objects break honestly`

---

## Canonical deviations

(populated during execution; authoritative over task text)

1. **`spawnBreakProducts` is module-private in `sim/world/actions.js`** (not a separate module): it serves both strike-shatter and chop, with a `remainderToLast` flag — see deviation 2.
2. **Two remainder modes, not one.** Plan treated product spawning as a single mode. Implementation bifurcates: *breakProducts mode* (shatter) gives the LAST product the remainder so Σ product E == parent E exactly; *onChop mode* gives every product exactly `eFrac × corpseE` and the corpse/stump KEEPS the remainder (otherwise stump E would hit 0 and the tree's mass would teleport into products).
3. **RNG keying is `(kernel.seed, causeEventId, pi)`** where `pi` is the product-table row index — the kernel `rand`/`randRange` API takes exactly two integer ids after seed (plan's three-part `('break', causeEventId, i)` key was not representable). Safe: each strike emits its own event, so causeEventId never collides across nodes.
4. **REMOVAL_KINDS filter added on BOTH sides of the wire** (review finding, not in plan): `sim/world/wire.js` and `src/sim/sim-world-state.js` suppress placements only for kinds {taken, felled, destroyed}; `damaged` deltas are stage scars — a cracked rock still exists after reboot. Regression tests in `wire.test.js` and `sim-world-state.test.js`.
5. **Accepted divergence — `take()` discards hp.** Inventory items snapshot only E/archetype/grains; durability state is honestly absent from inventory in M2 (no drop/place verb exists yet to observe it). Revisit when items can be placed back into the world (M5).
6. **Accepted divergence — reboot resets hp to full.** The `damaged` delta records stage (visual scar) but not hp; after seed-reconstruction the next strike lazy-inits hp to maxHp. Bounded: objects never gain E, they only heal damage stage. Persisting hp in delta attrs + wire replay is the known fix if this ever matters; checkpoint/save is a separate system.
7. **Protocol clamps strike amount to ≤ 50 and accepts fractional amounts** — hp is continuous float math throughout (resistances are fractions of damage taken), so non-integer damage is legitimate; reviewer objection adjudicated invalid.
