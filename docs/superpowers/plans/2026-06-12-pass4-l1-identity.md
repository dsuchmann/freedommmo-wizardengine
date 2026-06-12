# Pass 4 L1 — Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Humanoid races (human/elf/dwarf/orc) as real species params rows in the metabolism, plus pure-derivation identity (name, personality-trait bag, attribute bag) for every humanoid — data + derivation ONLY, no behavior.

**Architecture:** Races are ordinary `SPECIES` rows (the kernel already does stages/senescence/death — humanoids ride it unchanged) with a 9-stage life-stage table carrying the TIME_SYSTEM burn multipliers (0.2×→2.0×) and TIME_SYSTEM death-scaling senescence (1.15×/year from age 70). Identity is **derived, never stored** (M1 derived-composition precedent): `f(worldSeed, nodeId)` via the existing order-independent `rand()` — zero save/load surface, bit-determinism for free. Traits/attributes are sim-side private (locked decision 3: minds are private); only the NAME crosses the wire.

**Tech Stack:** plain ES modules, node:test, existing kernel (sim/kernel, sim/time, sim/store).

**Roadmap row:** Pass 4 L1, `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` — update status when done.

---

## Context for implementers (read once)

- **Kernel facts:** 1 tick = 1 sim-second; `DAY = 86_400`, `YEAR = 360 * DAY` (sim/time/metabolism.js:5-6). Species rows live in `SPECIES` (metabolism.js:15-64); fields: `demand, burn, growFrac, maxBody, stages[[name,startAgeTicks,demandFactor,burnFactor]], senescence{start,stepEvery,burnGrowth,demandDecay}, seed{every,cost,minR,jitter} (optional after Task 1), graze{every,bite,radius} (optional), embodiedDecayDays`.
- **Living nodes:** created via `kernel.addLiving({species,x,y,R,body,tick,age,causeEventId})` (kernel.js:38-46); age = `tick - node.attrs.birthTick`; stage via `stageAt(species, age)` (metabolism.js:97-102). Lifecycle scheduling in sim/time/lifecycle.js (`_scheduleLifecycle`): stage appointments per `sp.stages`, senescence onset with ±20% jitter, seed + graze schedules.
- **Deterministic rng:** `rand(seed, ...ids)` → [0,1), order-independent hash (sim/kernel/rng.js). Convention: `rand(kernel.seed, node.id, SALT)` with a unique integer salt per derived quantity (lifecycle.js uses 101/102/200/303 — stay clear of those).
- **Grain yields:** `SPECIES_YIELD` in sim/matter/composition.js (grazer = `{ keratin: 0.005, bone: 0.003 }` per-tu-of-body). Every species needs a row or corpse grain audits see zero yield.
- **Graze machinery** (lifecycle.js:84-118): prey filter excludes species that themselves have `graze` — so humanoids with a graze row forage flora only, never each other. This is **rule-based instinct, not Agency** — same machinery the grazer uses; declared as such.
- **Honest absences this plan declares (do NOT build):** no reproduction for humanoids (`seed` omitted — L5 owns birth-as-parental-investment + family edges); no fetus stage (gestation needs L5; stages start at `infant`); no behavior from traits (L6 Agency consumes them later); no trait drift (L8 layers stored deltas over the derived baseline); no bodies/sprites (L2); the TIME_SYSTEM 30+ attribute roster is trimmed to 6 classic attributes (consumers: L2 body, L6 agency) — the rest land when something consumes them.
- **Privacy rule:** traits and attributes must NEVER be serialized in protocol.js (minds are private; information moves only by observation/conversation). Name is observable → wire-safe.
- **GIT SAFETY:** work ONLY on branch `pass4-l1-identity`. NEVER push to origin. NEVER run destructive git commands. Never stage `assets/`, `.claude/`, `.playwright-mcp/`, `scripts/bulk_generate*.py`, `*_f4_state.json`, `.superpowers/`. Stage only the specific files you changed.
- Run targeted tests with `node --test <file>` from repo root.

---

### Task 1: optional `seed` in lifecycle scheduling

**Files:**
- Modify: `sim/time/lifecycle.js` (the `_scheduleLifecycle` body, currently ~lines 10-23)
- Test: `sim/test/lifecycle.test.js` (append)

`_scheduleLifecycle` unconditionally reads `sp.seed.jitter` (lifecycle.js:19-20), so a species without `seed` crashes on spawn. Humanoids must not reproduce until L5 — guard the schedule exactly like `graze` already is (line 21).

- [ ] **Step 1: Write the failing test** (append to `sim/test/lifecycle.test.js`)

```js
test('L1: species without seed param spawns without crashing and never seeds', () => {
  const k = makeKernel();
  // simulate a seedless species by spawning grass then deleting the param copy:
  // instead, use the real seam — a temp species row.
  SPECIES.__seedless_test = {
    demand: 0.4, burn: 0.2, growFrac: 0.5, maxBody: 100,
    stages: [['mature', 0, 1.0, 1.0]],
    senescence: { start: 400 * DAY, stepEvery: 5 * DAY, burnGrowth: 1.1, demandDecay: 0.95 },
    embodiedDecayDays: 5,
  };
  try {
    let n;
    k.graph.boot(() => { n = k.addLiving({ species: '__seedless_test', x: 2, y: 2, R: 500, body: 10, tick: 0 }); });
    k.runTo(30 * DAY);
    assert.ok(k.graph.nodes.has(n.id));
    assert.ok(!k.ledger.events.some(e => e.type === 'seed' && e.actor === n.id));
  } finally {
    delete SPECIES.__seedless_test;
  }
});
```

(Import `SPECIES` and `DAY` from `../time/metabolism.js` at the top of the test file if not already imported; `makeKernel` already exists in this file — reuse its actual name/shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sim/test/lifecycle.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'jitter')`

- [ ] **Step 3: Guard the seed schedule** in `sim/time/lifecycle.js`

Wrap the two seed-scheduling lines (currently 19-20) exactly like the graze guard:

```js
    if (sp.seed) {
      const jit = 1 + (rand(kernel.seed, node.id, 101) - 0.5) * 2 * sp.seed.jitter;
      kernel.scheduler.schedule(tick + sp.seed.every * jit, node.id, 'seed', -1);
    }
```

Also confirm the `'seed'` event handler (lifecycle.js:54+) early-returns if `sp.seed` is missing — if it can never fire for a seedless species (it can't: nothing schedules it), no change needed there; add `if (!sp.seed) return;` only if the handler could be reached otherwise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/lifecycle.test.js`
Expected: ALL PASS (existing tests prove flora seeding is untouched).

- [ ] **Step 5: Commit**

```bash
git add sim/time/lifecycle.js sim/test/lifecycle.test.js
git commit -m "feat(life): species without a seed param are valid — reproduction becomes opt-in (L5 landing pad)"
```

---

### Task 2: humanoid species rows + grain yields

**Files:**
- Modify: `sim/time/metabolism.js` (add helper + 4 rows inside `SPECIES`)
- Modify: `sim/matter/composition.js` (4 rows in `SPECIES_YIELD`)
- Test: `sim/test/identity-species.test.js` (create)

- [ ] **Step 1: Write the failing tests** (create `sim/test/identity-species.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPECIES, stageAt, YEAR } from '../time/metabolism.js';
import { Kernel } from '../kernel/kernel.js';

const RACES = ['human', 'elf', 'dwarf', 'orc'];

test('L1: four humanoid races exist as full species rows', () => {
  for (const r of RACES) {
    const sp = SPECIES[r];
    assert.ok(sp, r);
    assert.equal(sp.stages.length, 9, `${r} has 9 life stages (fetus = L5 gestation, honest absence)`);
    assert.equal(sp.stages[0][0], 'infant');
    assert.equal(sp.stages[8][0], 'elderly');
    assert.ok(sp.senescence && sp.senescence.burnGrowth === 1.15, 'TIME_SYSTEM death scaling 1.15x/step');
    assert.ok(!sp.seed, 'no reproduction until L5');
    assert.ok(sp.graze, 'foraging instinct (graze machinery)');
  }
});

test('L1: human stage boundaries and burn multipliers match TIME_SYSTEM', () => {
  // [name, startAge(years), burnFactor]
  const expected = [
    ['infant', 0, 0.2], ['toddler', 2, 0.3], ['child', 4, 0.4],
    ['adolescent', 12, 0.6], ['young_adult', 18, 0.8], ['adult', 30, 1.0],
    ['middle_aged', 50, 1.2], ['senior', 65, 1.5], ['elderly', 80, 2.0],
  ];
  for (const [name, years, burnF] of expected) {
    const st = stageAt('human', years * YEAR);
    assert.equal(st[0], name);
    assert.equal(st[3], burnF);
  }
});

test('L1: race lifespans scale the same stage curve (elf 5x, dwarf 2.5x, orc 0.7x)', () => {
  assert.equal(stageAt('elf', 40 * YEAR)[0], 'child');        // 40y elf ~ 8y human
  assert.equal(stageAt('dwarf', 40 * YEAR)[0], 'adolescent'); // 40y dwarf ~ 16y human (young_adult starts 45y)
  assert.equal(stageAt('orc', 40 * YEAR)[0], 'middle_aged');  // 40y orc ~ 57y human
  assert.equal(stageAt('elf', 410 * YEAR)[0], 'elderly');
  // exact boundary identity: stage starts are startAge(years) * lifespan * YEAR
  assert.equal(SPECIES.elf.stages[5][1], 30 * 5 * YEAR);
  assert.equal(SPECIES.dwarf.stages[5][1], 30 * 2.5 * YEAR);
  assert.equal(SPECIES.orc.stages[5][1], Math.round(30 * 0.7 * YEAR));
});

test('L1: a spawned human lives on ambient + foraging and dies of senescence eventually', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 12, h: 12 } });
  let h;
  k.graph.boot(() => {
    for (let x = 1; x < 11; x += 2) for (let y = 1; y < 11; y += 2)
      k.addLiving({ species: 'grass', x, y, R: 2000, body: 100, tick: 0 });
    h = k.addLiving({ species: 'human', x: 5, y: 5, R: 200000, body: 15000, tick: 0, age: 78 * YEAR });
  });
  k.runTo(30 * YEAR);   // senescence 1.15x/year from ~70y must kill well before 108y
  assert.ok(!k.graph.nodes.has(h.id), 'elderly human died of compounding burn');
  assert.ok(k.ledger.events.some(e => e.type === 'death' && e.actor === h.id));
});
```

Verify each expected stage by hand against the boundary math (startAge-years × lifespan) before running — boundary arithmetic, not vibes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/identity-species.test.js`
Expected: FAIL — `SPECIES.human` undefined.

- [ ] **Step 3: Add the humanoid builder + rows** in `sim/time/metabolism.js`, after the existing `SPECIES` rows (inside the object, after `grazer`):

```js
  // — Pass 4 L1: humanoid races. Same kernel machinery as all life; stages carry
  // the TIME_SYSTEM 10-stage burn multipliers (fetus omitted: gestation is L5's
  // birth-as-parental-investment — honest absence), senescence carries the
  // TIME_SYSTEM death-scaling (1.15x/year from age 70). No `seed`: people-
  // reproduction (family edges, childhood gating) is L5. `graze` here is the
  // rule-based foraging instinct (grazer precedent) — NOT Agency (L6).
  human: humanoid({ lifespan: 1,   demand: 0.12, burn: 0.45, maxBody: 25000, forageBite: 500 }),
  elf:   humanoid({ lifespan: 5,   demand: 0.10, burn: 0.30, maxBody: 22000, forageBite: 350 }),
  dwarf: humanoid({ lifespan: 2.5, demand: 0.12, burn: 0.40, maxBody: 24000, forageBite: 450 }),
  orc:   humanoid({ lifespan: 0.7, demand: 0.14, burn: 0.55, maxBody: 30000, forageBite: 650 }),
```

And ABOVE the `SPECIES` declaration (it's referenced inside the object literal, so it must be hoisted or defined first — define it as a plain function before `export const SPECIES`):

```js
// 9-stage humanoid life-stage curve (TIME_SYSTEM burn multipliers 0.2x→2.0x),
// scaled by per-race lifespan. demandFactor = capture curve (children capture
// less, the old capture little).
function humanoid({ lifespan, demand, burn, maxBody, forageBite }) {
  const Y = YEAR * lifespan;
  const r = t => Math.round(t);
  return {
    demand, burn, growFrac: 0.3, maxBody,
    stages: [
      ['infant',      0,         0.30, 0.2],
      ['toddler',     r(2 * Y),  0.45, 0.3],
      ['child',       r(4 * Y),  0.60, 0.4],
      ['adolescent',  r(12 * Y), 0.80, 0.6],
      ['young_adult', r(18 * Y), 1.00, 0.8],
      ['adult',       r(30 * Y), 1.00, 1.0],
      ['middle_aged', r(50 * Y), 0.95, 1.2],
      ['senior',      r(65 * Y), 0.85, 1.5],
      ['elderly',     r(80 * Y), 0.70, 2.0],
    ],
    senescence: { start: r(70 * Y), stepEvery: r(1 * Y), burnGrowth: 1.15, demandDecay: 0.97 },
    graze: { every: 12 * 3600, bite: forageBite, radius: 4 },
    embodiedDecayDays: 25,
  };
}
```

- [ ] **Step 4: Add grain yields** in `sim/matter/composition.js` `SPECIES_YIELD` (grazer-pattern, per-tu-of-body):

```js
  human:      { bone: 0.004, keratin: 0.002 },
  elf:        { bone: 0.003, keratin: 0.002 },
  dwarf:      { bone: 0.005, keratin: 0.002 },
  orc:        { bone: 0.005, keratin: 0.003 },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test sim/test/identity-species.test.js sim/test/lifecycle.test.js sim/test/kernel.test.js`
Expected: ALL PASS. The senescence-death test runs 30 sim-years over a 12×12 world — if it exceeds ~30s, reduce the grass count or raise spawn age to `82 * YEAR`; do NOT weaken the death assertion.

- [ ] **Step 6: Commit**

```bash
git add sim/time/metabolism.js sim/matter/composition.js sim/test/identity-species.test.js
git commit -m "feat(l1): humanoid races as species rows — TIME_SYSTEM stage curve + death scaling, foraging instinct, no L5 reproduction"
```

---

### Task 3: identity derivation module

**Files:**
- Create: `sim/life/identity.js`
- Test: `sim/test/identity.test.js` (create)

- [ ] **Step 1: Write the failing tests** (create `sim/test/identity.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR } from '../time/metabolism.js';
import {
  RACES, TRAITS, ATTRIBUTES, RACE_ATTR_MODIFIERS,
  traitsOf, attributesOf, nameOf, identityOf,
} from '../life/identity.js';

test('L1: traitsOf is deterministic, full-vocabulary, signed [-1,1]', () => {
  const a = traitsOf(7, 42);
  const b = traitsOf(7, 42);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), TRAITS);
  assert.equal(TRAITS.length, 10);
  for (const t of TRAITS) assert.ok(a[t] >= -1 && a[t] <= 1, t);
  assert.notDeepEqual(traitsOf(7, 43), a, 'different entity, different personality');
  assert.notDeepEqual(traitsOf(8, 42), a, 'different world, different personality');
});

test('L1: attributesOf respects race modifiers and clamps to [0,1]', () => {
  const a = attributesOf(7, 42, 'human');
  assert.deepEqual(Object.keys(a), ATTRIBUTES);
  for (const k of ATTRIBUTES) assert.ok(a[k] >= 0 && a[k] <= 1, k);
  // same rng base, so the orc differs from the human by exactly the modifier (pre-clamp):
  const o = attributesOf(7, 42, 'orc');
  const delta = o.strength - a.strength;
  if (o.strength < 1 && a.strength > 0) {
    assert.ok(Math.abs(delta - RACE_ATTR_MODIFIERS.orc.strength) < 1e-12);
  }
});

test('L1: nameOf is deterministic, per-race flavored, and varies by entity', () => {
  assert.equal(nameOf(7, 42, 'dwarf'), nameOf(7, 42, 'dwarf'));
  assert.notEqual(nameOf(7, 42, 'dwarf'), nameOf(7, 99, 'dwarf'));
  for (const r of RACES) {
    const n = nameOf(7, 42, r);
    assert.ok(typeof n === 'string' && n.length >= 3, r);
    assert.ok(/^[A-Z]/.test(n), 'capitalized');
  }
});

test('L1: identityOf — full identity for humanoids, null for flora/fauna', () => {
  const k = new Kernel({ seed: 7, phi: 4, bounds: { x0: 0, y0: 0, w: 8, h: 8 } });
  let h, g;
  k.graph.boot(() => {
    h = k.addLiving({ species: 'human', x: 2, y: 2, R: 50000, body: 15000, tick: 0, age: 35 * YEAR });
    g = k.addLiving({ species: 'grass', x: 4, y: 4, R: 800, body: 10, tick: 0 });
  });
  const id = identityOf(k, h);
  assert.equal(id.race, 'human');
  assert.equal(id.stage, 'adult');
  assert.equal(id.name, nameOf(7, h.id, 'human'));
  assert.deepEqual(id.traits, traitsOf(7, h.id));
  assert.deepEqual(id.attributes, attributesOf(7, h.id, 'human'));
  assert.equal(identityOf(k, g), null, 'grass has no personhood');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/identity.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `sim/life/identity.js`**

```js
// sim/life/identity.js — Pass 4 L1: Identity. PURE DERIVATION, nothing stored
// (M1 derived-composition precedent): name, personality traits, and attributes
// are f(worldSeed, nodeId) via the order-independent rng — bit-deterministic,
// zero save/load surface. Future trait drift (L8 Mind) layers stored deltas
// over this derived baseline; until then identity is fixed at birth.
// PRIVACY (locked decision 3): traits/attributes are sim-side ONLY and must
// never cross the wire — minds are private. The NAME is observable (wire-safe).
// HONEST ABSENCES: no behavior from traits (L6 Agency), no bodies (L2), no
// fetus stage (L5 gestation), attribute roster trimmed to 6 (rest land when
// something consumes them).
import { rand } from '../kernel/rng.js';
import { stageAt } from '../time/metabolism.js';

export const RACES = ['human', 'elf', 'dwarf', 'orc'];

// TIME_SYSTEM personality vocabulary (10 traits, signed [-1,1]).
export const TRAITS = [
  'empathy', 'sociopathy', 'leadership', 'aggression', 'curiosity',
  'loyalty', 'greed', 'fear', 'courage', 'patience',
];

// Classic six (consumers: L2 body, L6 agency). [0,1] after race modifier + clamp.
export const ATTRIBUTES = [
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
];

export const RACE_ATTR_MODIFIERS = {
  human: {},
  elf:   { dexterity: 0.15, wisdom: 0.10, constitution: -0.10 },
  dwarf: { constitution: 0.15, strength: 0.10, dexterity: -0.10 },
  orc:   { strength: 0.20, constitution: 0.10, intelligence: -0.15 },
};

// rng salts — unique per derived quantity (lifecycle.js owns 101/102/200/303).
const TRAIT_SALT = 4100;
const ATTR_SALT = 4200;
const NAME_SALT = 4300;

export function traitsOf(seed, nodeId) {
  const out = {};
  TRAITS.forEach((t, i) => { out[t] = rand(seed, nodeId, TRAIT_SALT + i) * 2 - 1; });
  return out;
}

export function attributesOf(seed, nodeId, race) {
  const mods = RACE_ATTR_MODIFIERS[race] ?? {};
  const out = {};
  ATTRIBUTES.forEach((a, i) => {
    const base = 0.2 + rand(seed, nodeId, ATTR_SALT + i) * 0.6;   // [0.2, 0.8)
    out[a] = Math.min(1, Math.max(0, base + (mods[a] ?? 0)));
  });
  return out;
}

const NAME_PARTS = {
  human: {
    first: ['Al', 'Ber', 'Cor', 'Dun', 'Ed', 'Fay', 'Gil', 'Hal', 'Isa', 'Jon',
            'Kat', 'Lor', 'Mar', 'Nor', 'Os', 'Per', 'Quin', 'Ros', 'Tam', 'Wil'],
    second: ['da', 'den', 'fred', 'la', 'lin', 'mund', 'na', 'ric', 'son', 'ton', 'win', 'wyn'],
  },
  elf: {
    first: ['Ae', 'Cael', 'Elo', 'Fae', 'Gala', 'Ila', 'Lua', 'Nim', 'Sylv', 'Thal'],
    second: ['driel', 'lien', 'lor', 'mir', 'nor', 'rian', 'thiel', 'wen'],
  },
  dwarf: {
    first: ['Bal', 'Dur', 'Gim', 'Gro', 'Khar', 'Mor', 'Thra', 'Thor', 'Ulf', 'Vor'],
    second: ['din', 'grim', 'li', 'nar', 'rik', 'run', 'und', 'zad'],
  },
  orc: {
    first: ['Az', 'Bol', 'Dru', 'Gar', 'Ghor', 'Krag', 'Mok', 'Rok', 'Thok', 'Urz'],
    second: ['ash', 'dak', 'gar', 'gha', 'mok', 'nak', 'rok', 'zug'],
  },
};

export function nameOf(seed, nodeId, race) {
  const parts = NAME_PARTS[race];
  if (!parts) return null;
  const f = parts.first[Math.floor(rand(seed, nodeId, NAME_SALT) * parts.first.length)];
  const s = parts.second[Math.floor(rand(seed, nodeId, NAME_SALT + 1) * parts.second.length)];
  return f + s;
}

/** Full derived identity for a humanoid node, or null (flora/fauna have no personhood). */
export function identityOf(kernel, node) {
  const race = node.attrs?.species;
  if (!RACES.includes(race)) return null;
  const age = kernel.tick - node.attrs.birthTick;
  return {
    name: nameOf(kernel.seed, node.id, race),
    race,
    stage: stageAt(race, age)[0],
    traits: traitsOf(kernel.seed, node.id),
    attributes: attributesOf(kernel.seed, node.id, race),
  };
}
```

Check `kernel.tick` and `kernel.seed` are the real property names (probes use `k.tick`, lifecycle.js uses `kernel.seed`) — adjust if the kernel exposes them differently.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/identity.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add sim/life/identity.js sim/test/identity.test.js
git commit -m "feat(l1): derived identity — name, 10-trait personality, 6-attribute bag, race modifiers; nothing stored"
```

---

### Task 4: name over the wire (and ONLY the name)

**Files:**
- Modify: `sim/server/protocol.js` (`serializeEntity`, living branch ~lines 100-129) — signature gains optional `seed`
- Modify: `sim/server/server.js` (2 call sites, lines ~67 and ~83: pass `this.kernel.seed`)
- Test: `sim/test/protocol.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append to `sim/test/protocol.test.js`)

```js
test('L1 wire: humanoid living entities carry name; traits/attributes NEVER cross', () => {
  const node = {
    id: 31, type: 'human', x: 3, y: 4, R: 50000, lastTick: 0,
    attrs: { species: 'human', body: 15000, birthTick: 0 },
  };
  const e = serializeEntity(node, 0, 7);
  assert.equal(e.name, nameOf(7, 31, 'human'));
  assert.equal(e.traits, undefined, 'minds are private');
  assert.equal(e.attributes, undefined, 'minds are private');
});

test('L1 wire: non-humanoid living entities and seedless calls carry no name', () => {
  const grass = {
    id: 32, type: 'grass', x: 1, y: 1, R: 500, lastTick: 0,
    attrs: { species: 'grass', body: 10, birthTick: 0 },
  };
  assert.equal(serializeEntity(grass, 0, 7).name, undefined);
  const human = {
    id: 33, type: 'human', x: 1, y: 1, R: 500, lastTick: 0,
    attrs: { species: 'human', body: 100, birthTick: 0 },
  };
  assert.equal(serializeEntity(human, 0).name, undefined, 'no seed, no name (back-compat)');
});
```

Add the import at the top of the test file: `import { nameOf } from '../life/identity.js';`. Match the node shape used by the existing living-entity tests in this file (copy their fixture style — they may carry extra fields like `bornTick`; mirror exactly).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sim/test/protocol.test.js`
Expected: FAIL — `e.name` undefined in the first test.

- [ ] **Step 3: Implement.** In `sim/server/protocol.js`:

- change the signature to `export function serializeEntity(node, tick, seed)` (third param optional);
- import: `import { RACES, nameOf } from '../life/identity.js';`
- in the living-entity branch, after `base` is built and before `return`:

```js
  if (seed != null && RACES.includes(species)) base.name = nameOf(seed, node.id, species);
```

In `sim/server/server.js`, pass `this.kernel.seed` as the third argument at both call sites (`serializeEntity(node, this.kernel.tick, this.kernel.seed)` and the `.map(...)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test sim/test/protocol.test.js`
Expected: ALL PASS (existing wire tests unchanged — they call without seed and must stay green untouched; if any existing deepEqual breaks, the cause is a leak — fix the implementation, never the old test).

- [ ] **Step 5: Commit**

```bash
git add sim/server/protocol.js sim/server/server.js sim/test/protocol.test.js
git commit -m "feat(l1): humanoid names on the wire — and nothing else; traits/attributes stay sim-private"
```

---

### Task 5: probe — identity + life-stage arc + conservation

**Files:**
- Create: `sim/test/probe-identity.test.js`

The probe proves the headline: four races live real metabolic lives on the same kernel — stages progress by age, the elderly burn harder and die of senescence, identities are deterministic and private, and the books still balance.

- [ ] **Step 1: Write the probe** (create `sim/test/probe-identity.test.js`)

```js
// PROBE L1: identity — four humanoid races live (and die) on the unmodified
// kernel. Verifies: stage progression from real age, TIME_SYSTEM burn ordering,
// senescence death with corpse + inheritance-ready E, deterministic identity,
// and the conservation identity over a multi-year run.
// Honest absences exercised: no reproduction (no 'seed' events from humanoids),
// no behavior from traits (nothing reads them but identityOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../kernel/kernel.js';
import { YEAR, DAY, SPECIES, stageAt } from '../time/metabolism.js';
import { identityOf, RACES } from '../life/identity.js';

function world(seed) {
  const k = new Kernel({ seed, phi: 4, bounds: { x0: 0, y0: 0, w: 16, h: 16 } });
  const out = { k, folk: {} };
  k.graph.boot(() => {
    for (let x = 1; x < 15; x += 2) for (let y = 1; y < 15; y += 2)
      k.addLiving({ species: 'grass', x, y, R: 3000, body: 150, tick: 0 });
    out.folk.human = k.addLiving({ species: 'human', x: 4, y: 4, R: 120000, body: 15000, tick: 0, age: 1 * YEAR });
    out.folk.elf   = k.addLiving({ species: 'elf',   x: 8, y: 4, R: 120000, body: 14000, tick: 0, age: 100 * YEAR });
    out.folk.dwarf = k.addLiving({ species: 'dwarf', x: 4, y: 8, R: 120000, body: 14000, tick: 0, age: 80 * YEAR });
    out.folk.orc   = k.addLiving({ species: 'orc',   x: 8, y: 8, R: 200000, body: 16000, tick: 0, age: 58 * YEAR });
  });
  return out;
}

test('PROBE L1 step 1: stages progress from real age across races', () => {
  const { k, folk } = world(7);
  // at boot: human age 1y = infant; elf 100y (=20 human-y) = young_adult;
  // dwarf 80y (=32) = adult; orc 58y (~83) = elderly. Verify via identityOf.
  assert.equal(identityOf(k, folk.human).stage, 'infant');
  assert.equal(identityOf(k, folk.elf).stage, 'young_adult');
  assert.equal(identityOf(k, folk.dwarf).stage, 'adult');
  assert.equal(identityOf(k, folk.orc).stage, 'elderly');
  k.runTo(2 * YEAR);
  if (k.graph.nodes.has(folk.human.id)) {
    assert.equal(identityOf(k, folk.human).stage, 'toddler', 'human aged 1y->3y');
  }
  // burn ordering at equal stage basis: elderly orc burns harder than adult dwarf
  const orc = k.graph.nodes.get(folk.orc.id);
  const dwarf = k.graph.nodes.get(folk.dwarf.id);
  if (orc && dwarf) {
    const orcBurnF = stageAt('orc', k.tick - orc.attrs.birthTick)[3];
    const dwarfBurnF = stageAt('dwarf', k.tick - dwarf.attrs.birthTick)[3];
    assert.ok(orcBurnF > dwarfBurnF, 'elderly burn factor exceeds adult');
  }
});

test('PROBE L1 step 2: the old orc dies of senescence; corpse carries its E; no humanoid ever seeds', () => {
  const { k, folk } = world(7);
  k.runTo(12 * YEAR);   // orc senescence starts ~49y(=70*0.7); at 58y+ it compounds 1.15x/y
  assert.ok(!k.graph.nodes.has(folk.orc.id), 'orc died inside 12 years');
  const death = k.ledger.events.find(e => e.type === 'death' && e.actor === folk.orc.id);
  assert.ok(death, 'death event on the ledger');
  for (const r of RACES) {
    const id = folk[r].id;
    assert.ok(!k.ledger.events.some(e => e.type === 'seed' && e.actor === id),
      'no humanoid reproduction until L5');
  }
});

test('PROBE L1 step 3: conservation identity holds over the run', () => {
  const { k } = world(7);
  const t0 = k.stocks(0);
  const tl0 = k.ledger.totals.transferLoss ?? 0;
  k.runTo(12 * YEAR);
  const t1 = k.stocks(k.tick);
  const tot = k.ledger.totals;
  const lhs = t1 - t0;
  const rhs = (tot.captured ?? 0) - (tot.burned ?? 0) - (tot.decayed ?? 0) - ((tot.transferLoss ?? 0) - tl0);
  const rel = Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs));
  assert.ok(rel < 1e-9, `conservation: lhs=${lhs} rhs=${rhs} rel=${rel}`);
});

test('PROBE L1 step 4: two identical seeds produce bit-identical identities and world state', () => {
  const a = world(7), b = world(7);
  a.k.runTo(3 * YEAR); b.k.runTo(3 * YEAR);
  for (const r of RACES) {
    const na = a.k.graph.nodes.get(a.folk[r].id);
    const nb = b.k.graph.nodes.get(b.folk[r].id);
    assert.equal(na == null, nb == null, r);
    if (na) assert.deepEqual(identityOf(a.k, na), identityOf(b.k, nb));
  }
  const c = world(8);
  c.k.runTo(0);
  assert.notEqual(identityOf(c.k, c.folk.human).name, identityOf(a.k.graph.nodes.get(a.folk.human.id) ? a.k : a.k, { attrs: { species: 'human', birthTick: 0 }, id: a.folk.human.id }).name ?? Symbol(), 'different world seed, different name');
});
```

**Probe adaptation rules (binding):** the exact stocks/ledger API must match `sim/test/probe-growth.test.js` / `probe-conservation` precedents — READ one of those probes first and copy its conservation-identity form exactly (totals key names, stocks signature, tl baseline ordering: `stocks(0)` BEFORE reading `transferLoss` baseline). If `k.stocks` or `k.ledger.totals` differ from the sketch, adapt the probe to the real API — the IDENTITY itself (lhs == rhs within 1e-9) is non-negotiable. The step-4 last assertion is sketchy as written — simplify it to: build `world(8)`, compare `nameOf(8, id, 'human')` vs `nameOf(7, id, 'human')` for the same id, assert not equal. Tune ages/durations if a race dies earlier/later than sketched (e.g., orc senescence math) — deaths themselves are facts to assert, but WHICH tick they land on is tuning; keep assertions on outcomes, never on magic tick values.

- [ ] **Step 2: Run the probe**

Run: `node --test sim/test/probe-identity.test.js`
Expected: ALL PASS within ~60s. If slow, shrink the world to 12×12 or cut grass density — never the assertions.

- [ ] **Step 3: Run the neighboring suites**

Run: `node --test sim/test/identity.test.js sim/test/identity-species.test.js sim/test/lifecycle.test.js sim/test/kernel.test.js sim/test/protocol.test.js`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-identity.test.js
git commit -m "test(l1): probe — four races age through real stages, die of senescence, identities deterministic, books balance"
```

---

## Close-out (controller)

- [ ] Full suite in background (`npm test` → log, read only after EXIT line)
- [ ] Update this plan's **Deviations (canonical)** section with everything implementers changed
- [ ] Roadmap row L1 → DONE with summary + honest absences
- [ ] Final whole-branch opus READ-ONLY review
- [ ] Merge `git fetch . pass4-l1-identity:master` (or checkout+merge if master moved)
- [ ] Memory update

## Deviations (canonical)

- **Task 2** (42ff32e62): senescence-death test spawn age raised 78→82 `* YEAR` per the plan's own fallback (test ran ~113s otherwise); death assertion unweakened. Review note: the "10-stage burn multipliers" comment is intentional — TIME_SYSTEM has 10 stages, fetus omitted here (honest absence).
- **Task 3** (9b3c4f583): no deviations. `sim/life/` directory created. Salt audit confirmed 4100–4301 range collision-free (lifecycle 101/102/200/303; spawn/wire/lod use small positional salts).
- **Task 4** (f05735d44): no deviations. 4 test-file call sites (probe-blueprints, protocol-wire) intentionally omit the seed arg — back-compat path (no seed → no name), not missed updates.
- **Task 5** (ea3ca9d7a): run window 12y→6y (orc already 2 senescence steps past start at boot; 1.15× compounding kills well inside 6y — halved runtime 256s→149s); grass grid step 2→3 (49→25 nodes); `SPECIES` import dropped (unused), `nameOf` imported for the seed-difference assertion (simplified per the plan's binding adaptation rule). Conservation form copied exactly from probe-growth (stocks(0) + tlStart baseline before runTo, scale = max(|captured|,1)). Reviewer minors accepted as-is: the survival guards around the post-run human-stage and burn-ordering assertions come from the plan's own sketch; boot-stage, orc-death, no-seed, and conservation assertions are unconditional.
- Probe runtime ~149s (guideline ~120s) — accepted; bottleneck is multi-year humanoid metabolism, world already minimal.
- **Close-out fix** (f78ef78e9, controller-applied): full suite caught 2 taxonomy failures the plan missed — `sim/test/taxonomy.test.js` asserts every kernel species has spine-vocabulary stages and an archetype sheet class; humanoids are deliberately unrendered until L2 (honest absence, no placeholder capsules). Fix: `FIELD_SHEETS._meta.UNRENDERED = ['human','elf','dwarf','orc']` in `src/world/asset-state-taxonomy.js`; taxonomy tests skip unrendered species for stage vocabulary and assert unrendered species do NOT bind a sheet. L2 body assembly replaces these entries with real classes.
