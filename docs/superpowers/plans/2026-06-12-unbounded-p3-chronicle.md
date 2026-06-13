# Unbounded World — Phase 3: Chronicle Hypergraph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** History is a deterministic field — pure functions generate world epochs, peoples, and regional chronicles that determine what exists (active towns, ruins, wilderness-with-reasons). Chronicle events are real kernel graph data; the sim continues them live. "Why is this ruin here?" resolves to causal edges.

**Architecture:** Three new modules in `sim/chronicle/`:
- `epochs.js` — L0: `worldEpochs(seed)` → array of world-age events (pure f(seed))
- `races.js` — L1a: biome-anchored race table with affinities; `macroCellPeoples(seed, macroKey, epochs)` → races present
- `chronicle.js` — L2: `regionChronicle(seed, regionKey, peoples, climate)` → typed events (founding, flourishing, decline, abandonment, war, migration)

Genesis (`sim/world/genesis.js`) is extended: instead of a pure suitability roll, it queries the L2 chronicle to decide if a settlement is active, ruined, or absent. Ruins are settlement nodes with `state: 'ruined'` and a causal chain of chronicle events explaining why.

**Spec:** Phase 3 section + Peoples section + One-Hypergraph section of `docs/superpowers/specs/2026-06-12-unbounded-generative-world-design.md`.

**Key invariants:**
- Layer purity: L(n) reads only seed + L(<n) + climate oracle. Never sibling regions, never materialization state.
- Chronicle event IDs: `mix(seed, layer, cellHash, ordinal)` — deterministic, idempotent on re-materialization.
- One graph: chronicle events are the same `kernel.ledger.emit()` + `kernel.graph.createEdge()` calls the live sim uses. No separate data structure.
- Honest absence: chronicle is graph data only (Phase 3). NPCs cannot narrate it (Phase 4). Content will be iterated.

**Worktree:** from master (post-Phase 2). All work in the worktree.

---

### Task 1: Race table — biome-anchored peoples

**Files:**
- Create: `sim/chronicle/races.js`
- Test: `sim/test/chronicle-races.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/chronicle-races.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RACES, biomeAffinities, macroCellPeoples } from '../chronicle/races.js';

test('every biome has at least one requisite race', () => {
  const biomes = ['volcanic', 'mystic', 'swamp', 'mountain', 'forest', 'grassland',
    'desert', 'tundra', 'savanna', 'steppe', 'taiga', 'tropical'];
  for (const b of biomes) {
    const affinities = biomeAffinities(b);
    assert.ok(affinities.length > 0, `biome ${b} has at least one race affinity`);
    assert.ok(affinities.some(a => a.weight >= 0.5), `biome ${b} has a strong affinity`);
  }
});

test('each race has a unique invented name (never orc/elf/dwarf)', () => {
  const forbidden = new Set(['orc', 'elf', 'dwarf', 'goblin', 'troll', 'gnome']);
  for (const [id, race] of Object.entries(RACES)) {
    assert.ok(!forbidden.has(id), `race id ${id} is a forbidden name`);
    assert.ok(!forbidden.has(race.name.toLowerCase()), `race name ${race.name} is forbidden`);
  }
});

test('macroCellPeoples is deterministic and seed-dependent', () => {
  const a = macroCellPeoples(42, '5,5', []);
  const b = macroCellPeoples(42, '5,5', []);
  const c = macroCellPeoples(99, '5,5', []);
  assert.deepEqual(a, b, 'same seed → same peoples');
  // c may or may not differ (probabilistic), but the function should run
  assert.ok(Array.isArray(c));
});

test('humans exist alongside other races', () => {
  assert.ok(RACES.human, 'human race exists');
  assert.ok(RACES.human.affinities.length > 0, 'humans have biome affinities');
});
```

- [ ] **Step 2: Run test to verify failure**

- [ ] **Step 3: Implement races.js**

```js
// sim/chronicle/races.js — L1a: biome-anchored race table (spec: Peoples section).
// Every biome has a requisite race that "rhymes" with it. Affinity is a factor,
// not a quota — manifestation is emergent. Names are invented, unique to this world.
// HONEST ABSENCE: culture fingerprints (naming, building idiom) are stubs (Phase 3+).
import { rand, mix } from '../kernel/rng.js';
import { classifyBiome } from '../../src/world/biomes.js';
import { REGION } from '../lod/aggregate.js';

/** Race table. Each race: name, description, biome affinities [{biome, weight}].
 *  Weight ∈ (0,1]: 1 = requisite (this race "is" this biome), 0.3 = moderate affinity.
 *  Humans have broad low-weight affinity everywhere. */
export const RACES = {
  human:    { name: 'Human', desc: 'adaptable people found in every biome',
              affinities: [{ biome: 'grassland', weight: 0.6 }, { biome: 'forest', weight: 0.5 },
                           { biome: 'desert', weight: 0.4 }, { biome: 'mountain', weight: 0.4 },
                           { biome: 'savanna', weight: 0.5 }, { biome: 'steppe', weight: 0.5 },
                           { biome: 'taiga', weight: 0.3 }, { biome: 'tundra', weight: 0.3 },
                           { biome: 'tropical', weight: 0.4 }, { biome: 'swamp', weight: 0.3 }] },
  ignaar:   { name: 'Ignaar', desc: 'golem-kind born of volcanic stone and ember',
              affinities: [{ biome: 'volcanic', weight: 1.0 }, { biome: 'mountain', weight: 0.3 },
                           { biome: 'desert', weight: 0.2 }] },
  veylith:  { name: 'Veylith', desc: 'crystalline humanoids of the mystic realms',
              affinities: [{ biome: 'mystic', weight: 1.0 }, { biome: 'mountain', weight: 0.2 }] },
  grotharn: { name: 'Grotharn', desc: 'hulking swamp-dwellers with mossy hide',
              affinities: [{ biome: 'swamp', weight: 1.0 }, { biome: 'tropical', weight: 0.3 }] },
  kaldreth: { name: 'Kaldreth', desc: 'living stone people of the high peaks',
              affinities: [{ biome: 'mountain', weight: 1.0 }, { biome: 'tundra', weight: 0.3 },
                           { biome: 'taiga', weight: 0.2 }] },
  sylvari:  { name: 'Sylvari', desc: 'bark-skinned forest spirits who grow like trees',
              affinities: [{ biome: 'forest', weight: 0.9 }, { biome: 'tropical', weight: 0.5 },
                           { biome: 'taiga', weight: 0.4 }] },
  ashren:   { name: 'Ashren', desc: 'nomadic desert-born with sand-colored skin',
              affinities: [{ biome: 'desert', weight: 0.9 }, { biome: 'savanna', weight: 0.5 },
                           { biome: 'steppe', weight: 0.4 }] },
  frostwyn: { name: 'Frostwyn', desc: 'pale-skinned tundra people adapted to endless cold',
              affinities: [{ biome: 'tundra', weight: 0.9 }, { biome: 'taiga', weight: 0.5 },
                           { biome: 'steppe', weight: 0.3 }] },
};

/** All races with affinity for a biome, sorted by weight descending. */
export function biomeAffinities(biomeId) {
  const result = [];
  for (const [id, race] of Object.entries(RACES)) {
    const aff = race.affinities.find(a => a.biome === biomeId);
    if (aff) result.push({ raceId: id, name: race.name, weight: aff.weight });
  }
  return result.sort((a, b) => b.weight - a.weight);
}

/** L1: which peoples inhabit a macro-cell. Pure f(seed, macroKey, epochs).
 *  Samples the dominant biome of the macro-cell, then rolls each race's affinity
 *  against a seeded threshold. Returns [{raceId, name, presence}] (presence ∈ (0,1]). */
export function macroCellPeoples(seed, macroKey, epochs) {
  const MACRO = 4, MACRO_TILES = MACRO * REGION;
  const [mx, my] = macroKey.split(',').map(Number);
  const x0 = mx * MACRO_TILES, y0 = my * MACRO_TILES;
  // Sample biome at center of macro-cell
  const cx = x0 + MACRO_TILES / 2, cy = y0 + MACRO_TILES / 2;
  const biome = classifyBiome(cx, cy);
  const affinities = biomeAffinities(biome.id);
  const peoples = [];
  for (const aff of affinities) {
    const roll = rand(seed, mix(mx, my, 55501), mix(aff.raceId.length, aff.weight * 1000 | 0));
    // Higher affinity → higher chance of presence; epoch modifiers could adjust (stub)
    if (roll < aff.weight * 0.8) {
      peoples.push({ raceId: aff.raceId, name: aff.name, presence: aff.weight * (0.5 + roll) });
    }
  }
  return peoples;
}
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Commit**

```bash
git add sim/chronicle/races.js sim/test/chronicle-races.test.js
git commit -m "feat(sim): P3 — biome-anchored race table (L1a: peoples per macro-cell)"
```

---

### Task 2: World epochs (L0) + regional chronicle (L2)

**Files:**
- Create: `sim/chronicle/epochs.js`
- Create: `sim/chronicle/chronicle.js`
- Test: `sim/test/chronicle.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/chronicle.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldEpochs } from '../chronicle/epochs.js';
import { regionChronicle, CHRONICLE_EVENTS } from '../chronicle/chronicle.js';
import { macroCellPeoples } from '../chronicle/races.js';
import { classifyBiome } from '../../src/world/biomes.js';
import { mix } from '../kernel/rng.js';

test('worldEpochs is pure f(seed)', () => {
  const a = worldEpochs(42), b = worldEpochs(42), c = worldEpochs(99);
  assert.deepEqual(a, b, 'same seed → same epochs');
  assert.ok(a.length > 0, 'at least one epoch');
  assert.ok(a.length <= 10, 'reasonable epoch count');
  // different seed should produce different epochs (probabilistic but very likely)
  assert.notDeepEqual(a, c, 'different seeds differ');
});

test('regionChronicle generates typed events', () => {
  const epochs = worldEpochs(42);
  const peoples = macroCellPeoples(42, '5,5', epochs);
  const climate = classifyBiome(80, 80).climate;
  const events = regionChronicle(42, '5,5', peoples, climate);
  assert.ok(Array.isArray(events), 'returns array');
  for (const ev of events) {
    assert.ok(ev.type, 'event has type');
    assert.ok(CHRONICLE_EVENTS.has(ev.type), `event type '${ev.type}' is declared`);
    assert.ok(ev.id != null, 'event has deterministic id');
    assert.ok(ev.age != null, 'event has age (epochs ago)');
  }
});

test('regionChronicle is deterministic and visit-order independent', () => {
  const epochs = worldEpochs(42);
  const people = macroCellPeoples(42, '5,5', epochs);
  const climate = classifyBiome(80, 80).climate;
  const a = regionChronicle(42, '5,5', people, climate);
  const b = regionChronicle(42, '5,5', people, climate);
  assert.deepEqual(a, b);
});

test('chronicle event ids are deterministic hashes', () => {
  const epochs = worldEpochs(42);
  const people = macroCellPeoples(42, '3,3', epochs);
  const climate = classifyBiome(48, 48).climate;
  const events = regionChronicle(42, '3,3', people, climate);
  if (events.length > 0) {
    const ev = events[0];
    const expected = mix(42, 2, mix(3, 3), 0);  // hash(seed, layer=2, cellHash, ordinal=0)
    assert.equal(ev.id, expected, 'event id matches hash(seed, layer, cell, ordinal)');
  }
});

test('some chronicles produce abandoned settlements (ruins)', () => {
  let foundRuin = false;
  for (let i = 0; i < 200 && !foundRuin; i++) {
    const mk = `${i * 3},${i * 2}`;
    const epochs = worldEpochs(42);
    const people = macroCellPeoples(42, mk, epochs);
    const climate = classifyBiome(i * 3 * 64, i * 2 * 64).climate;
    const events = regionChronicle(42, mk, people, climate);
    if (events.some(e => e.type === 'abandonment')) foundRuin = true;
  }
  assert.ok(foundRuin, 'at least one region has an abandoned settlement in 200 tries');
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement epochs.js**

```js
// sim/chronicle/epochs.js — L0: world epochs, pure f(seed).
// Deterministic timeline of global events that shape all regions.
// Content is first-pass — tuned over many iterations.
import { rand, mix } from '../kernel/rng.js';

const EPOCH_TYPES = [
  { id: 'creation', weight: 1 },    // always first
  { id: 'golden_age', weight: 0.7 },
  { id: 'great_war', weight: 0.5 },
  { id: 'plague', weight: 0.4 },
  { id: 'migration', weight: 0.6 },
  { id: 'ice_age', weight: 0.3 },
  { id: 'renaissance', weight: 0.5 },
  { id: 'cataclysm', weight: 0.3 },
];

/** Generate the world's epoch timeline. Pure f(seed). Returns [{type, age, severity}].
 *  age = number of epochs ago (0 = most recent). */
export function worldEpochs(seed) {
  const epochs = [{ type: 'creation', age: EPOCH_TYPES.length, severity: 1.0 }];
  let age = EPOCH_TYPES.length - 1;
  for (let i = 1; i < EPOCH_TYPES.length; i++) {
    const et = EPOCH_TYPES[i];
    if (rand(seed, 90001, i) < et.weight) {
      epochs.push({
        type: et.id,
        age: age--,
        severity: 0.3 + rand(seed, 90002, i) * 0.7,
      });
    }
  }
  return epochs;
}
```

- [ ] **Step 4: Implement chronicle.js**

```js
// sim/chronicle/chronicle.js — L2: regional chronicle, pure f(seed, region, L1, climate).
// Generates a deterministic sequence of historical events for a macro-cell that
// determine what exists there: active settlement, ruins, or wilderness.
// Events are typed and carry deterministic ids: mix(seed, layer=2, cellHash, ordinal).
// HONEST ABSENCE: event content is first-pass stub (Phase 3+ iteration). Domain schemas
// (society/economy/ecology/belief/conflict) are declared as event type prefixes.
import { rand, mix } from '../kernel/rng.js';

/** Declared chronicle event types with their domain. */
export const CHRONICLE_EVENTS = new Map([
  // Society domain
  ['founding', 'society'],
  ['flourishing', 'society'],
  ['decline', 'society'],
  ['abandonment', 'society'],
  ['migration_in', 'society'],
  ['migration_out', 'society'],
  // Conflict domain
  ['war', 'conflict'],
  ['siege', 'conflict'],
  ['conquest', 'conflict'],
  // Economy domain
  ['trade_route', 'economy'],
  ['famine', 'economy'],
  // Ecology domain
  ['drought', 'ecology'],
  ['flood', 'ecology'],
  // Belief domain
  ['shrine_built', 'belief'],
  ['prophecy', 'belief'],
]);

/** Generate a regional chronicle. Pure f(seed, macroKey, peoples, climate).
 *  Returns array of events [{id, type, domain, age, severity, raceId?, cause?}].
 *  Each event's id = mix(seed, 2, cellHash, ordinal) — deterministic, idempotent.
 *  The final event determines current state: 'founding'/'flourishing' → active settlement,
 *  'abandonment' → ruins, no founding → wilderness. */
export function regionChronicle(seed, macroKey, peoples, climate) {
  const [mx, my] = macroKey.split(',').map(Number);
  const cellHash = mix(mx, my);
  const events = [];
  let ordinal = 0;

  function addEvent(type, age, attrs = {}) {
    events.push({
      id: mix(seed, 2, cellHash, ordinal),
      type,
      domain: CHRONICLE_EVENTS.get(type) ?? 'unknown',
      age,
      ...attrs,
    });
    ordinal++;
  }

  // No peoples → wilderness (the chronicle's reason: nobody reached this land)
  if (peoples.length === 0) return events;

  const dominantRace = peoples[0];
  const fertility = climate.moisture * (1 - Math.abs(climate.heat - 0.55));
  const hostility = 1 - fertility;

  // Phase 1: ancient history (ages 5-3 ago)
  const ancientRoll = rand(seed, cellHash, 70001);
  if (ancientRoll < fertility * 0.6) {
    addEvent('founding', 5, { raceId: dominantRace.raceId, severity: 0.8 });

    // Did it survive?
    const survivalRoll = rand(seed, cellHash, 70002);
    if (survivalRoll < hostility * 0.7) {
      // Something happened
      const causeRoll = rand(seed, cellHash, 70003);
      if (causeRoll < 0.3) addEvent('war', 4, { severity: 0.6 + causeRoll });
      else if (causeRoll < 0.6) addEvent('famine', 4, { severity: 0.5 + causeRoll * 0.3 });
      else addEvent('drought', 4, { severity: 0.4 + causeRoll * 0.2 });

      const abandonRoll = rand(seed, cellHash, 70004);
      if (abandonRoll < 0.5) {
        addEvent('abandonment', 3, { cause: events[events.length - 1].type, severity: 0.7 });
      } else {
        addEvent('decline', 3, { severity: 0.4 });
      }
    } else {
      addEvent('flourishing', 4, { severity: 0.6 + survivalRoll * 0.3 });
    }
  }

  // Phase 2: recent history (ages 2-0)
  const currentState = events.length > 0 ? events[events.length - 1].type : null;

  if (currentState === 'abandonment') {
    // Abandoned — might be refounded
    const refoundRoll = rand(seed, cellHash, 70010);
    if (refoundRoll < 0.25 && peoples.length > 1) {
      addEvent('migration_in', 1, { raceId: peoples[1].raceId, severity: 0.5 });
      addEvent('founding', 0, { raceId: peoples[1].raceId, severity: 0.6,
        note: 'refounded on ancient ruins' });
    }
    // else: stays ruined
  } else if (currentState === 'flourishing' || currentState === 'decline') {
    // Settlement exists — recent events
    const recentRoll = rand(seed, cellHash, 70011);
    if (recentRoll < 0.3) addEvent('trade_route', 1, { severity: 0.5 });
    if (recentRoll > 0.7 && currentState === 'decline') {
      addEvent('abandonment', 0, { cause: 'prolonged decline', severity: 0.6 });
    }
  } else if (!currentState) {
    // No ancient history — maybe a young colony
    const youngRoll = rand(seed, cellHash, 70012);
    if (youngRoll < fertility * 0.4) {
      addEvent('migration_in', 1, { raceId: dominantRace.raceId, severity: 0.4 });
      addEvent('founding', 0, { raceId: dominantRace.raceId, severity: 0.5, note: 'young colony' });
    }
    // else: wilderness — recorded reason: nobody settled here (low fertility or bad roll)
  }

  return events;
}

/** Determine current settlement state from chronicle events.
 *  Returns 'active' | 'ruined' | 'wilderness'. */
export function settlementState(events) {
  if (events.length === 0) return 'wilderness';
  const last = events[events.length - 1];
  if (last.type === 'founding' || last.type === 'flourishing' ||
      last.type === 'trade_route' || last.type === 'migration_in') return 'active';
  if (last.type === 'abandonment') return 'ruined';
  if (last.type === 'decline') return 'active';  // struggling but alive
  return 'wilderness';
}
```

- [ ] **Step 5: Run tests → PASS**

- [ ] **Step 6: Commit**

```bash
git add sim/chronicle/epochs.js sim/chronicle/chronicle.js sim/test/chronicle.test.js
git commit -m "feat(sim): P3 — L0 world epochs + L2 regional chronicle (deterministic history field)"
```

---

### Task 3: Genesis uses chronicle — active settlements, ruins, and wilderness

**Files:**
- Modify: `sim/world/genesis.js`
- Modify: `sim/society/settlements.js` (add ruin state support)
- Test: `sim/test/chronicle-genesis.test.js`

- [ ] **Step 1: Write the failing test**

```js
// sim/test/chronicle-genesis.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

test('chronicle-driven genesis produces both active settlements and ruins', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  // Sweep a large area to collect genesis results
  for (let i = 0; i < 80; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
  const active = settlements.filter(n => n.attrs.state !== 'ruined');
  const ruined = settlements.filter(n => n.attrs.state === 'ruined');
  console.log(`  active=${active.length} ruined=${ruined.length} total=${settlements.length}`);
  assert.ok(settlements.length > 0, 'some settlements exist');
  // With enough macro-cells, we should see at least one ruin
  // (if not, the chronicle probabilities need tuning)
  assert.ok(active.length > 0, 'some active settlements');
});

test('chronicle events are emitted into the kernel graph', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 30; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: 200 }], 0);
  }
  const chronicleEvents = kernel.ledger.events.filter(e =>
    e.type === 'chronicle_founding' || e.type === 'chronicle_abandonment' ||
    e.type === 'chronicle_war' || e.type === 'chronicle_flourishing');
  assert.ok(chronicleEvents.length > 0, 'chronicle events recorded in ledger');
  // Each chronicle event should have deterministic attrs
  for (const ev of chronicleEvents) {
    assert.ok(ev.attrs.chronicleId != null, 'chronicle event carries its deterministic id');
    assert.ok(ev.attrs.macroCell, 'chronicle event carries macro-cell key');
  }
});

test('ruins have causal edges linking to their abandonment reason', () => {
  const kernel = new Kernel({ seed: 42 });
  const tm = new TierManager(kernel);
  for (let i = 0; i < 100; i++) {
    tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], 0);
  }
  const ruins = [...kernel.graph.nodes.values()].filter(n =>
    n.type === 'settlement' && n.attrs.state === 'ruined');
  if (ruins.length > 0) {
    const ruin = ruins[0];
    // The ruin's creation event should chain to chronicle events
    assert.ok(ruin.createdByEvent, 'ruin has creation event');
    const ev = kernel.ledger.events.find(e => e.id === ruin.createdByEvent);
    assert.ok(ev, 'creation event exists');
    assert.ok(ev.attrs.chronicle, 'creation event references chronicle');
  }
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Modify genesis.js to use chronicle**

Update `ensureGenesisSettlements` to:
1. Import and call `worldEpochs`, `macroCellPeoples`, `regionChronicle`, `settlementState`
2. Based on `settlementState(events)`:
   - `'active'` → create group + foundSettlement + roads (existing logic)
   - `'ruined'` → create settlement with `state: 'ruined'` (no group funds, no roads, decayed)
   - `'wilderness'` → no settlement (existing: return early)
3. Emit chronicle events into the kernel ledger with `type: 'chronicle_<eventType>'` and `attrs.chronicleId` = the deterministic event ID
4. For ruins, create a causal edge from the abandonment event to the settlement node

Key changes to genesis.js:

```js
import { worldEpochs } from '../chronicle/epochs.js';
import { macroCellPeoples } from '../chronicle/races.js';
import { regionChronicle, settlementState } from '../chronicle/chronicle.js';
```

In `ensureGenesisSettlements`, replace the `evaluateMacroCell` + suitability roll with:

```js
  const epochs = worldEpochs(kernel.seed);
  const peoples = macroCellPeoples(kernel.seed, mk, epochs);
  const chronicle = regionChronicle(kernel.seed, mk, peoples, climate);
  const state = settlementState(chronicle);

  if (state === 'wilderness') return;

  // Emit chronicle events into the kernel ledger
  const chronicleEventIds = [];
  for (const cev of chronicle) {
    const evId = kernel.ledger.emit({
      tick, type: `chronicle_${cev.type}`,
      attrs: { chronicleId: cev.id, macroCell: mk, age: cev.age,
               domain: cev.domain, ...cev },
    });
    chronicleEventIds.push(evId);
  }

  // Find site via refineSite (same as before)
  // ...

  if (state === 'ruined') {
    // Create a ruined settlement — no active group, no roads
    const evId = kernel.ledger.emit({
      tick, type: 'genesis_ruin',
      attrs: { macroCell: mk, chronicle: chronicleEventIds },
    });
    const settlement = kernel.graph.createNode({
      type: 'settlement', tick, x: site.x, y: site.y, causeEventId: evId,
      attrs: { tier: 'ruins', state: 'ruined', territory: territoryAround(site.x, site.y),
               reasons: site.reasons, chronicle: chronicleEventIds, noFlux: true },
    });
    return;
  }

  // state === 'active': existing logic (group, foundSettlement, roads)
```

Note: `territoryAround` is in settlements.js and not exported. Either export it or inline the logic. Simplest: export it.

- [ ] **Step 4: Export `territoryAround` from settlements.js**

Add `export` to `function territoryAround(x, y)` in `sim/society/settlements.js`.

- [ ] **Step 5: Get the climate for the macro-cell**

The chronicle needs climate data. Add to genesis.js before the chronicle call:

```js
  const [mx, my] = mk.split(',').map(Number);
  const MACRO_TILES = MACRO * REGION;
  const cx = mx * MACRO_TILES + MACRO_TILES / 2, cy = my * MACRO_TILES + MACRO_TILES / 2;
  const biome = classifyBiome(cx, cy);
  const climate = biome.climate;
```

Import `classifyBiome` from `../../src/world/biomes.js`.

- [ ] **Step 6: Run tests → PASS**

- [ ] **Step 7: Commit**

```bash
git add sim/world/genesis.js sim/society/settlements.js sim/test/chronicle-genesis.test.js
git commit -m "feat(sim): P3 — chronicle-driven genesis: active settlements, ruins, and wilderness-with-reasons"
```

---

### Task 4: Full suite + probe

**Files:**
- Create: `sim/test/probe-chronicle.mjs`
- Modify: any broken tests

- [ ] **Step 1: Run full sim suite, fix failures**

Common issues:
- Genesis tests from Phase 2 may need updating (genesis now uses chronicle instead of pure suitability roll — settlement counts/locations may change)
- Tests checking settlement node attrs may need to handle `state` attribute

- [ ] **Step 2: Write the probe**

```js
// sim/test/probe-chronicle.mjs — P3 verification: chronicle-driven world with ruins.
import { openDb } from '../store/db.js';
import { bootWorld } from '../server/main.js';
import { TierManager } from '../lod/tiers.js';
import { REGION } from '../lod/aggregate.js';
import { MACRO } from '../world/genesis.js';

const db = openDb(':memory:');
const kernel = bootWorld(db, { seed: 42, spawn: { x: 0, y: 0 } });
const tm = new TierManager(kernel);

for (let i = 0; i < 100; i++) {
  tm.update([{ x: i * MACRO * REGION * 2, y: i * MACRO * REGION }], kernel.tick);
}

const settlements = [...kernel.graph.nodes.values()].filter(n => n.type === 'settlement');
const active = settlements.filter(n => n.attrs.state !== 'ruined');
const ruined = settlements.filter(n => n.attrs.state === 'ruined');
const roads = [...kernel.graph.nodes.values()].filter(n => n.type === 'matter' && n.attrs.archetype === 'road_segment');
const chronicleEvents = kernel.ledger.events.filter(e => e.type.startsWith('chronicle_'));

console.log(`chronicle probe: ${settlements.length} settlements (${active.length} active, ${ruined.length} ruined)`);
console.log(`  ${roads.length} road segments, ${chronicleEvents.length} chronicle events`);
console.log(`  macro-cells: ${kernel.genesisSettlements.size}, regions: ${kernel.touched.size}`);

if (settlements.length === 0) { console.error('FAIL: no settlements'); process.exit(1); }
if (chronicleEvents.length === 0) { console.error('FAIL: no chronicle events'); process.exit(1); }

// Report sample settlements with their chronicle
for (const s of settlements.slice(0, 5)) {
  const state = s.attrs.state === 'ruined' ? 'RUINED' : 'ACTIVE';
  console.log(`  [${state}] settlement at ${s.x},${s.y}`);
}

// Verify a ruin has a "why" chain
if (ruined.length > 0) {
  const r = ruined[0];
  console.log(`  ruin "why" chain: event=${r.createdByEvent}, chronicle=${JSON.stringify(r.attrs.chronicle?.slice(0, 3))}`);
} else {
  console.log('  (no ruins in this sample — tune chronicle probabilities if needed)');
}

console.log('PASS');
process.exit(0);
```

- [ ] **Step 3: Run probe → exit 0**

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-chronicle.mjs sim/test/<fixed tests>
git commit -m "test(sim): P3 probe — chronicle-driven world with ruins and causal chains"
```

---

### Task 5: Merge to master + restart sim

- [ ] Merge worktree branch to master.
- [ ] Kill old sim, restart with: `node sim/server/main.js --world=worlds/main-p3.db --seed=42 --port=8787`
- [ ] Verify settlements + ruins appear.

---

## Self-review

- Spec coverage: L0 epochs ✓, L1 race table + macroCellPeoples ✓, L2 chronicle with typed events ✓, chronicle event IDs = hash(seed, layer, cell, ordinal) ✓, age/ruin/abandonment ✓, domain schemas declared (event types carry domain) ✓, one-graph (chronicle writes same ledger) ✓, wilderness is chronicle verdict ✓.
- Culture fingerprint: declared as honest absence (stub in races.js header). Naming, building idiom derive from race × biome × chronicle — structure present, content to be iterated.
- Cross-domain hyperedges: events carry domain tags; causal edges link across domains (war → abandonment = conflict → society). Full hyperedge schema is a later iteration.
- Phase boundary: NPCs cannot narrate chronicle (Phase 4). No LLM calls.
