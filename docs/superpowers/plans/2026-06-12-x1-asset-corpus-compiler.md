# Asset Corpus Compiler + Generic Batch Runner (X1 tooling, W2 burst) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A declarative asset registry + deterministic compiler that enumerates every PixelLab asset across all roadmap plans (counts + ready-to-fire prompt batches), plus one generic resumable runner that executes any batch — and fire the W2 F6/F7 tree burst as its first output.

**Architecture:** JSON registry files (one per X1 manifest row) → pure compiler (`compile.mjs`) → `counts.md` enumeration + `batches/*.json` job files → generic Python runner (`bulk_generate.py`, generalizing the proven `bulk_generate_f4.py`) with burst gates (`armed`/`dormant`/`pilot_required`) and a shared-concurrency ledger so it coexists with the live F4/F5 runs.

**Tech Stack:** Node ESM + `node:test` for compiler; Python 3 stdlib (urllib) for runner, same as F4; PixelLab REST v2 (`create-1-direction-object`, `objects/{id}/states`, `animate-with-text-v3`, `create-tileset`).

**Spec:** `docs/superpowers/specs/2026-06-12-asset-corpus-w2-overlay-design.md`. Out of this plan's scope (separate plans later): F6 renderer wiring + per-biome size tuner; settlements debug overlay.

**Hard constraints (do not violate):**
- NEVER edit anything under `sim/` — another agent is actively committing there.
- NEVER touch `scripts/bulk_generate_f4.py` / `bulk_generate_f5.py` — they are running RIGHT NOW.
- NEVER push to origin.
- Wang tilesets are always 32×32. Sizes: 192px F6/F7. Variants: 64 flat.

---

## File structure

```
scripts/asset-corpus/
  lib/enumerate.mjs        # pure: registry object -> {rows, totals} count math
  lib/emit.mjs             # pure: registry object -> job records (create/state/anim/wang)
  compile.mjs              # CLI: read registry/, validate, write out/counts.md + out/batches/*.json
  registry/
    f6_trees.json          # armed   — W2 burst
    f7_canopies.json       # armed   — W2 burst (derives archetypes from f6_trees)
    roads_wang.json        # pilot_required — road material × 21 biomes
    biome_base_tiles.json  # data: 21 biome descriptors + base tile IDs (from gen_all_wang.py)
    fauna.json             # dormant — counts only (W4/L4)
    body_parts.json        # pilot_required — counts + pilot batch only (L2)
    building_pieces.json   # pilot_required — counts + pilot batch only (P4)
    items.json             # dormant — counts only (M5/V4)
    elevation_wang.json    # dormant — counts only (needs own design)
  out/                     # counts.md committed; batches/ gitignored (regenerable)
scripts/bulk_generate.py   # generic runner (NEW file; f4/f5 scripts untouched)
scripts/.bursts/           # gitignored: per-burst state.json + run.log + pilot_pass.json
scripts/.pixellab_inflight.json  # gitignored: shared concurrency ledger
test/asset-corpus.test.mjs # node --test
```

Run tests with: `node --test test/asset-corpus.test.mjs` (package.json's `npm test` is sim-only; do not modify it — other agents own that surface).

---

### Task 1: Registry schema + enumeration core

**Files:**
- Create: `scripts/asset-corpus/lib/enumerate.mjs`
- Test: `test/asset-corpus.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// test/asset-corpus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateRegistry } from '../scripts/asset-corpus/lib/enumerate.mjs';

const FIXTURE = {
  id: 'fixture_flora',
  consuming_plan: 'TEST',
  status: 'armed',
  category: 'object',
  size: 64,
  variants: 64,
  output_root: 'assets/test/fixture',
  prompt_template: 'pixel art {desc}, test style',
  archetypes: [
    { name: 'rose', desc: 'red rose bush', biomes: ['forest'], fruit: false },
    { name: 'apple', desc: 'apple tree', biomes: ['forest', 'grassland'], fruit: true },
  ],
  states: { wilting: 'wilting version', dead: 'dead version' },
  fruit_states: { fruiting: 'laden with fruit' },
  anim: { states: ['base'], action: 'swaying', frames: 8 },
};

test('object enumeration: base + states + fruit states, per biome-instance', () => {
  const r = enumerateRegistry(FIXTURE);
  // rose: 1 biome -> 1 instance; apple: 2 biomes -> 2 instances = 3 instances
  // each instance: 1 base + 2 states; apple instances add 1 fruit state
  assert.equal(r.instances, 3);
  assert.equal(r.baseSprites, 3 * 64);
  assert.equal(r.stateSprites, (3 * 2 + 2 * 1) * 64); // 8 state-jobs x 64
  assert.equal(r.animJobs, 3); // anim on base, per instance
  assert.equal(r.totalSprites, r.baseSprites + r.stateSprites);
});

test('matrix enumeration: pure product of axes', () => {
  const m = enumerateRegistry({
    id: 'fixture_matrix', consuming_plan: 'TEST', status: 'dormant',
    category: 'matrix', size: 64, variants: 64,
    axes: { parts: 13, directions: 4, races: 6, body_types: 3, age_bands: 3 },
  });
  assert.equal(m.instances, 13 * 4 * 6 * 3 * 3);
  assert.equal(m.totalSprites, 13 * 4 * 6 * 3 * 3 * 64);
});

test('wang enumeration: materials x biomes tilesets', () => {
  const w = enumerateRegistry({
    id: 'fixture_wang', consuming_plan: 'TEST', status: 'armed',
    category: 'wang', tile_size: 32, variants: 1,
    materials: [{ name: 'dirt_road', desc: 'packed dirt road' }],
    biomes: ['forest', 'desert', 'taiga'],
  });
  assert.equal(w.tilesets, 3);
  assert.equal(w.totalSprites, 3 * 25); // wang_100 set = 25 tiles
});

test('enumeration is deterministic', () => {
  assert.deepEqual(enumerateRegistry(FIXTURE), enumerateRegistry(FIXTURE));
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/asset-corpus.test.mjs`
Expected: FAIL — `Cannot find module .../lib/enumerate.mjs`

- [ ] **Step 3: Implement `lib/enumerate.mjs`**

```js
// scripts/asset-corpus/lib/enumerate.mjs
// Pure count math over one registry object. No I/O.

export function enumerateRegistry(reg) {
  if (reg.category === 'object') return enumerateObject(reg);
  if (reg.category === 'matrix') return enumerateMatrix(reg);
  if (reg.category === 'wang') return enumerateWang(reg);
  throw new Error(`${reg.id}: unknown category ${reg.category}`);
}

function instancesOf(reg) {
  // one instance per (archetype, biome) pair — F4 disk convention <biome>/<archetype>/
  return reg.archetypes.flatMap((a) => a.biomes.map((b) => ({ ...a, biome: b })));
}

function enumerateObject(reg) {
  const inst = instancesOf(reg);
  const stateNames = Object.keys(reg.states ?? {});
  const fruitNames = Object.keys(reg.fruit_states ?? {});
  const stateJobs = inst.length * stateNames.length
    + inst.filter((i) => i.fruit).length * fruitNames.length;
  const animStates = reg.anim?.states?.length ?? 0;
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances: inst.length,
    baseSprites: inst.length * reg.variants,
    stateSprites: stateJobs * reg.variants,
    animJobs: inst.length * animStates,
    totalSprites: inst.length * reg.variants + stateJobs * reg.variants,
  };
}

function enumerateMatrix(reg) {
  const instances = Object.values(reg.axes).reduce((p, n) => p * n, 1);
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances, baseSprites: instances * reg.variants, stateSprites: 0,
    animJobs: 0, totalSprites: instances * reg.variants,
  };
}

function enumerateWang(reg) {
  const tilesets = reg.materials.length * reg.biomes.length;
  return {
    id: reg.id, status: reg.status, plan: reg.consuming_plan,
    instances: tilesets, tilesets,
    baseSprites: 0, stateSprites: 0, animJobs: 0,
    totalSprites: tilesets * 25 * (reg.variants ?? 1), // wang_100 = 25 tiles/set
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/asset-corpus.test.mjs`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add test/asset-corpus.test.mjs scripts/asset-corpus/lib/enumerate.mjs
git commit -m "feat(assets): corpus enumeration core — object/matrix/wang count math"
```

---

### Task 2: W2 registries — `f6_trees.json` + `f7_canopies.json` (derive rule)

**Files:**
- Create: `scripts/asset-corpus/registry/f6_trees.json`
- Create: `scripts/asset-corpus/registry/f7_canopies.json`
- Modify: `scripts/asset-corpus/lib/enumerate.mjs` (add `resolveDerived`)
- Test: `test/asset-corpus.test.mjs` (append)

- [ ] **Step 1: Write `registry/f6_trees.json`** — the full W2 roster. States come from the taxonomy F6 sheet (`docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md:125-137`); prompt house style from `bulk_generate_f4.py:59` adapted for trees.

```json
{
  "id": "f6_trees",
  "consuming_plan": "W2",
  "status": "armed",
  "category": "object",
  "size": 192,
  "variants": 64,
  "candidates_per_call": 4,
  "create_calls": 16,
  "output_root": "assets/pixelab/landscape_v2/micro/large_flora",
  "prompt_template": "top-down high fantasy pixel art {desc}, jaw-dropping beauty, hyper-detailed, rich saturated colors, Final Fantasy aesthetic, alpha-transparent background, detailed shading, large tree sprite seen from above with visible trunk and full canopy",
  "archetypes": [
    { "name": "oak",          "desc": "mighty oak tree with broad gnarled trunk and sprawling green canopy", "biomes": ["forest", "grassland"], "fruit": false },
    { "name": "birch",        "desc": "slender white-barked birch tree with light airy foliage",             "biomes": ["forest", "taiga"],     "fruit": false },
    { "name": "beech",        "desc": "smooth grey-barked beech tree with dense oval canopy",                "biomes": ["forest"],              "fruit": false },
    { "name": "apple",        "desc": "orchard apple tree with rounded canopy",                              "biomes": ["forest", "grassland"], "fruit": true },
    { "name": "ancient_oak",  "desc": "colossal ancient oak, moss-covered twisted trunk, vast dark canopy",  "biomes": ["dense_forest"],        "fruit": false },
    { "name": "yew",          "desc": "dark brooding yew tree with deep green needle canopy and red berries","biomes": ["dense_forest"],        "fruit": false },
    { "name": "hollow_elm",   "desc": "huge old elm tree with a hollow in its trunk and ragged crown",       "biomes": ["dense_forest"],        "fruit": false },
    { "name": "pine",         "desc": "tall straight pine tree with conical dark green needle canopy",       "biomes": ["taiga", "mountains"],  "fruit": false },
    { "name": "spruce",       "desc": "frost-dusted spruce tree with tight conical silhouette",              "biomes": ["taiga"],               "fruit": false },
    { "name": "larch",        "desc": "golden-green larch conifer with soft feathery needles",               "biomes": ["taiga"],               "fruit": false },
    { "name": "kapok",        "desc": "giant tropical kapok tree with buttress roots and umbrella crown",    "biomes": ["tropical_forest"],     "fruit": false },
    { "name": "banana_palm",  "desc": "lush banana palm with huge arching fronds",                           "biomes": ["tropical_forest"],     "fruit": true },
    { "name": "mangrove",     "desc": "tangled mangrove tree with stilt roots",                              "biomes": ["tropical_forest", "swamp"], "fruit": false },
    { "name": "acacia",       "desc": "flat-topped acacia tree with wide umbrella canopy on slender trunk",  "biomes": ["savanna"],             "fruit": false },
    { "name": "baobab",       "desc": "massive bulbous-trunked baobab tree with sparse branching crown",     "biomes": ["savanna"],             "fruit": false },
    { "name": "willow",       "desc": "weeping willow with cascading drooping branches",                     "biomes": ["grassland", "swamp"],  "fruit": false },
    { "name": "cherry",       "desc": "flowering cherry tree with pink-white blossom canopy",                "biomes": ["grassland"],           "fruit": true },
    { "name": "bald_cypress", "desc": "swamp bald cypress with flared trunk and wispy hanging moss",         "biomes": ["swamp"],               "fruit": false }
  ],
  "states": {
    "seedling": "tiny young tree sapling, thin stem, few small leaves, just established",
    "growing":  "young sapling tree, slender trunk, sparse adolescent foliage, half height",
    "wilting":  "wilting tree, thinned browned canopy, drooping branches, desaturated",
    "dead":     "dead bare leafless tree, grey brittle branches, no foliage",
    "stump":    "low cut tree stump with visible growth rings and chopped axe marks",
    "snag":     "storm-broken tree, trunk snapped partway up, jagged splintered break",
    "burned":   "burned charred tree, blackened trunk and branches, ash, faint embers"
  },
  "fruit_states": {
    "budding":   "covered in small buds and early blossoms among the leaves",
    "fruiting":  "laden with ripe colorful fruit visible across the canopy",
    "harvested": "fruit picked, bare stems and gaps in the foliage where fruit was"
  },
  "anim": {
    "states": ["base"],
    "action": "canopy swaying gently in wind, branches flexing naturally, trunk steady, rooted",
    "frames": 8
  }
}
```

- [ ] **Step 2: Write `registry/f7_canopies.json`** — derives archetypes from f6 (foliage-bearing only; stump/snag/dead emit no canopy, so F7 has only canopy-states):

```json
{
  "id": "f7_canopies",
  "consuming_plan": "W2",
  "status": "armed",
  "category": "object",
  "size": 192,
  "variants": 64,
  "candidates_per_call": 4,
  "create_calls": 16,
  "derive_from": "f6_trees",
  "derive_exclude": ["bald_cypress"],
  "output_root": "assets/pixelab/landscape_v2/micro/canopy_overlays",
  "prompt_template": "top-down high fantasy pixel art, only the leafy canopy crown of a {desc}, viewed directly from above, no trunk visible, alpha-transparent background, hyper-detailed foliage, rich saturated colors, Final Fantasy aesthetic",
  "states": {
    "wilting": "thinned browned wilting canopy with gaps, desaturated"
  },
  "anim": {
    "states": ["base"],
    "action": "leafy canopy rippling gently in wind, soft organic motion",
    "frames": 8
  }
}
```

- [ ] **Step 3: Write the failing test** (append to `test/asset-corpus.test.mjs`):

```js
import { readFileSync } from 'node:fs';
import { resolveDerived } from '../scripts/asset-corpus/lib/enumerate.mjs';

function loadReg(name) {
  return JSON.parse(readFileSync(new URL(`../scripts/asset-corpus/registry/${name}.json`, import.meta.url), 'utf8'));
}

test('f6_trees enumerates the W2 burst', () => {
  const r = enumerateRegistry(loadReg('f6_trees'));
  // 18 archetypes; biome instances: count pairs in the JSON (24)
  assert.equal(r.instances, 24);
  assert.equal(r.baseSprites, 24 * 64);
  // 7 universal states x 24 + 3 fruit states x fruit instances (apple:2, banana_palm:1, cherry:1 = 4)
  assert.equal(r.stateSprites, (24 * 7 + 4 * 3) * 64);
  assert.equal(r.animJobs, 24);
});

test('f7 derives archetypes from f6 minus exclusions', () => {
  const f6 = loadReg('f6_trees');
  const f7 = resolveDerived(loadReg('f7_canopies'), { f6_trees: f6 });
  assert.equal(f7.archetypes.length, f6.archetypes.length - 1); // bald_cypress excluded
  assert.ok(f7.archetypes.every((a) => a.fruit === false)); // canopies carry no fruit axis
  const r = enumerateRegistry(f7);
  assert.equal(r.instances, 24 - 1); // bald_cypress was swamp-only: 1 instance dropped
});
```

- [ ] **Step 4: Run tests, verify the new ones fail** (`resolveDerived` missing).

- [ ] **Step 5: Implement `resolveDerived` in `lib/enumerate.mjs`:**

```js
export function resolveDerived(reg, registryById) {
  if (!reg.derive_from) return reg;
  const src = registryById[reg.derive_from];
  if (!src) throw new Error(`${reg.id}: derive_from ${reg.derive_from} not found`);
  const exclude = new Set(reg.derive_exclude ?? []);
  return {
    ...reg,
    archetypes: src.archetypes
      .filter((a) => !exclude.has(a.name))
      .map((a) => ({ name: a.name, desc: a.desc, biomes: a.biomes, fruit: false })),
  };
}
```

- [ ] **Step 6: Run tests, all pass. Commit.**

```bash
git add scripts/asset-corpus/registry/f6_trees.json scripts/asset-corpus/registry/f7_canopies.json scripts/asset-corpus/lib/enumerate.mjs test/asset-corpus.test.mjs
git commit -m "feat(assets): W2 registries — 18 tree archetypes + derived canopy overlays"
```

---

### Task 3: Batch emission — `lib/emit.mjs`

**Files:**
- Create: `scripts/asset-corpus/lib/emit.mjs`
- Test: `test/asset-corpus.test.mjs` (append)

- [ ] **Step 1: Write the failing tests:**

```js
import { emitBatch } from '../scripts/asset-corpus/lib/emit.mjs';

test('emitBatch produces create/state/anim jobs for an armed object registry', () => {
  const f6 = loadReg('f6_trees');
  const batch = emitBatch(f6, {});
  assert.equal(batch.burst, 'w2-f6_trees');
  assert.equal(batch.gate, 'armed');
  const byKind = (k) => batch.jobs.filter((j) => j.kind === k);
  assert.equal(byKind('create').length, 24);
  assert.equal(byKind('state').length, 24 * 7 + 4 * 3);
  assert.equal(byKind('anim').length, 24);
  const oak = byKind('create').find((j) => j.id === 'forest/oak');
  assert.equal(oak.size, 192);
  assert.equal(oak.keep, 64);
  assert.equal(oak.calls, 16);
  assert.equal(oak.candidates, 4);
  assert.match(oak.prompt, /mighty oak tree/);
  assert.match(oak.prompt, /Final Fantasy aesthetic/);
  assert.equal(oak.out, 'assets/pixelab/landscape_v2/micro/large_flora/forest/oak');
  const st = byKind('state').find((j) => j.id === 'forest/oak/stump');
  assert.equal(st.parent, 'forest/oak');
  assert.equal(st.pool, 64);
  assert.match(st.edit, /growth rings/);
  const an = byKind('anim').find((j) => j.id === 'forest/oak/wind_sway');
  assert.equal(an.frames, 8);
});

test('emitBatch is deterministic (stable job order)', () => {
  const f6 = loadReg('f6_trees');
  assert.deepEqual(emitBatch(f6, {}), emitBatch(f6, {}));
});

test('emitBatch refuses dormant registries', () => {
  assert.throws(() => emitBatch({ ...loadReg('f6_trees'), status: 'dormant' }, {}),
    /dormant/);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `lib/emit.mjs`:**

```js
// scripts/asset-corpus/lib/emit.mjs
// Pure: registry -> batch (job records the runner consumes). No I/O.
import { resolveDerived } from './enumerate.mjs';

export function emitBatch(regIn, registryById) {
  const reg = resolveDerived(regIn, registryById);
  if (reg.status === 'dormant') throw new Error(`${reg.id} is dormant — not emittable`);
  if (reg.category === 'wang') return emitWang(reg);
  return emitObject(reg);
}

function emitObject(reg) {
  const jobs = [];
  for (const a of reg.archetypes) {
    for (const biome of a.biomes) {
      const id = `${biome}/${a.name}`;
      const out = `${reg.output_root}/${biome}/${a.name}`;
      jobs.push({
        kind: 'create', id, out,
        size: reg.size, keep: reg.variants,
        calls: reg.create_calls, candidates: reg.candidates_per_call,
        prompt: reg.prompt_template.replaceAll('{desc}', a.desc),
      });
      const states = { ...reg.states, ...(a.fruit ? reg.fruit_states : {}) };
      for (const [st, edit] of Object.entries(states)) {
        jobs.push({
          kind: 'state', id: `${id}/${st}`, parent: id,
          out: `${out}/_states/${st}`, pool: reg.variants, edit,
        });
      }
      for (const animState of reg.anim?.states ?? []) {
        jobs.push({
          kind: 'anim', id: `${id}/wind_sway`, parent: id, animState,
          out: `${out}/anim/wind_sway`, action: reg.anim.action, frames: reg.anim.frames,
        });
      }
    }
  }
  return batchOf(reg, jobs);
}

function emitWang(reg) {
  const jobs = [];
  for (const m of reg.materials) {
    for (const biome of reg.biomes) {
      jobs.push({
        kind: 'wang', id: `${m.name}__${biome}`,
        out: `${reg.output_root}/${m.name}__${biome}`,
        tile_size: reg.tile_size,
        lower_biome: biome,             // runner resolves desc + base tile id
        upper_description: m.desc,
        transition_size: reg.transition_size ?? 0.5,
      });
    }
  }
  return batchOf(reg, jobs);
}

function batchOf(reg, jobs) {
  jobs.sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  return {
    burst: `${reg.consuming_plan.toLowerCase()}-${reg.id}`,
    registry: reg.id, gate: reg.status, jobs,
  };
}
```

- [ ] **Step 4: Run tests, all pass. Commit.**

```bash
git add scripts/asset-corpus/lib/emit.mjs test/asset-corpus.test.mjs
git commit -m "feat(assets): batch emission — create/state/anim/wang job records"
```

---

### Task 4: Roads Wang registry + biome base-tile table + pilot subsets

**Files:**
- Create: `scripts/asset-corpus/registry/biome_base_tiles.json`
- Create: `scripts/asset-corpus/registry/roads_wang.json`
- Modify: `scripts/asset-corpus/lib/emit.mjs` (pilot batch emission)
- Test: `test/asset-corpus.test.mjs` (append)

- [ ] **Step 1: Create `registry/biome_base_tiles.json`** by copying the 21-entry BIOMES table from `scripts/gen_all_wang.py:12-34` into JSON form — keys are biome names, values `{ "desc": <description string>, "base_tile_id": <second tuple element> }`. (The tuple is `(description, base_tile_id, alt_id)`; take elements 0 and 1.) Verify all 21 biomes present: arctic, beach, deep_ocean, dense_forest, desert, forest, grassland, hills, lake, mountains, mystic, ocean, river, savanna, shallow_water, steppe, swamp, taiga, tropical_forest, tundra, volcanic.

- [ ] **Step 2: Create `registry/roads_wang.json`:**

```json
{
  "id": "roads_wang",
  "consuming_plan": "P2",
  "status": "pilot_required",
  "category": "wang",
  "tile_size": 32,
  "variants": 1,
  "transition_size": 0.5,
  "output_root": "assets/pixelab/landscape_v2/roads",
  "materials": [
    { "name": "dirt_road", "desc": "hard-packed dirt road with wheel ruts and scattered small stones" },
    { "name": "cobble_road", "desc": "grey cobblestone road with fitted rounded stones and moss in the seams" }
  ],
  "biomes": ["arctic", "beach", "dense_forest", "desert", "forest", "grassland", "hills", "mountains", "mystic", "savanna", "steppe", "swamp", "taiga", "tropical_forest", "tundra", "volcanic"],
  "pilot": {
    "materials": ["dirt_road"],
    "biomes": ["grassland", "desert", "taiga"]
  }
}
```

(Water/ocean biomes excluded — roads don't cross open water; bridges are P2.5's lane.)

- [ ] **Step 3: Write the failing tests:**

```js
import { emitPilotBatch } from '../scripts/asset-corpus/lib/emit.mjs';

test('roads pilot batch is the declared 1x3 subset', () => {
  const roads = loadReg('roads_wang');
  const pilot = emitPilotBatch(roads, {});
  assert.equal(pilot.burst, 'p2-roads_wang-pilot');
  assert.equal(pilot.gate, 'pilot');
  assert.equal(pilot.jobs.length, 3);
  assert.ok(pilot.jobs.every((j) => j.kind === 'wang' && j.tile_size === 32));
  assert.deepEqual(pilot.jobs.map((j) => j.id).sort(),
    ['dirt_road__desert', 'dirt_road__grassland', 'dirt_road__taiga']);
});

test('pilot_required full batch carries its gate so the runner can refuse it', () => {
  const batch = emitBatch(loadReg('roads_wang'), {});
  assert.equal(batch.gate, 'pilot_required');
  assert.equal(batch.jobs.length, 2 * 16);
});

test('biome base tile table covers all road biomes', () => {
  const tiles = loadReg('biome_base_tiles');
  for (const b of loadReg('roads_wang').biomes) {
    assert.ok(tiles[b]?.base_tile_id, `missing base tile for ${b}`);
    assert.ok(tiles[b]?.desc);
  }
});
```

- [ ] **Step 4: Run, verify fail (`emitPilotBatch` missing).**

- [ ] **Step 5: Implement `emitPilotBatch` in `lib/emit.mjs`:**

```js
export function emitPilotBatch(regIn, registryById) {
  const reg = resolveDerived(regIn, registryById);
  if (!reg.pilot) throw new Error(`${reg.id} declares no pilot subset`);
  const sub = { ...reg, status: 'armed' };
  if (reg.category === 'wang') {
    sub.materials = reg.materials.filter((m) => reg.pilot.materials.includes(m.name));
    sub.biomes = reg.pilot.biomes;
  } else {
    sub.archetypes = reg.archetypes.filter((a) => reg.pilot.archetypes.includes(a.name));
  }
  const batch = emitBatch(sub, registryById);
  return { ...batch, burst: `${batch.burst}-pilot`, gate: 'pilot' };
}
```

- [ ] **Step 6: Run tests, all pass. Commit.**

```bash
git add scripts/asset-corpus/registry/biome_base_tiles.json scripts/asset-corpus/registry/roads_wang.json scripts/asset-corpus/lib/emit.mjs test/asset-corpus.test.mjs
git commit -m "feat(assets): roads Wang registry (2 materials x 16 biomes) + pilot subsets"
```

---

### Task 5: Dormant registries — fauna, body parts, building pieces, items, elevation

**Files:**
- Create: `scripts/asset-corpus/registry/fauna.json`, `body_parts.json`, `building_pieces.json`, `items.json`, `elevation_wang.json`
- Test: `test/asset-corpus.test.mjs` (append)

Counts mirror the X1 manifest (`docs/superpowers/plans/2026-06-12-pixellab-asset-manifest.md` §2–§6) with the flat-64 variant decision applied. These rows exist so `counts.md` enumerates the whole corpus; batches for them are NOT emitted (gates).

- [ ] **Step 1: Write the five registries.**

`fauna.json` (matrix — 12 species × 4 lifecycle states × 4 directions, manifest §2):
```json
{ "id": "fauna", "consuming_plan": "L4", "status": "dormant", "category": "matrix",
  "size": 64, "variants": 64,
  "axes": { "species": 12, "lifecycle_states": 4, "directions": 4 } }
```

`body_parts.json` (matrix — manifest §3; pilot = adult human, 1 direction, all 13 parts):
```json
{ "id": "body_parts", "consuming_plan": "L2", "status": "pilot_required", "category": "matrix",
  "size": 64, "variants": 64,
  "axes": { "parts": 13, "directions": 4, "races": 6, "body_types": 3, "age_bands": 3 },
  "pilot_note": "13 humanoid parts x 1 direction x adult human x few variants; assembly probe must prove seams/palette/joint alignment against the X2 rig vocabulary before any wave fires. Fallback: PixelLab character tools (full bodies + skeleton anim)." }
```

`building_pieces.json` (matrix — manifest §4 piece counts × 4 styles ≈ 198 pieces):
```json
{ "id": "building_pieces", "consuming_plan": "P4", "status": "pilot_required", "category": "matrix",
  "size": 32, "variants": 64,
  "axes": { "pieces": 50, "styles": 4 },
  "pilot_note": "wall straight + corner + floor in one style; grid assembly probe before burst." }
```

`items.json` (matrix — manifest §6: ~40 raw + ~50 equipment icons; discovered-recipe icons are runtime-demand, not enumerated):
```json
{ "id": "items", "consuming_plan": "M5", "status": "dormant", "category": "matrix",
  "size": 32, "variants": 64, "axes": { "icons": 90 } }
```

`elevation_wang.json` (wang — dormant; cliff/ramp grammar needs its own design):
```json
{ "id": "elevation_wang", "consuming_plan": "P2.5", "status": "dormant", "category": "wang",
  "tile_size": 32, "variants": 1, "transition_size": 0.5,
  "output_root": "assets/pixelab/landscape_v2/elevation_roads",
  "materials": [ { "name": "cliff_edge", "desc": "PLACEHOLDER-BY-DESIGN: dormant until elevation design exists" } ],
  "biomes": ["forest", "grassland", "hills", "mountains"] }
```

- [ ] **Step 2: Write the failing test:**

```js
test('matrix pilot_required registries refuse full emission but the corpus enumerates them', () => {
  const bp = loadReg('body_parts');
  assert.equal(enumerateRegistry(bp).totalSprites, 13 * 4 * 6 * 3 * 3 * 64);
  assert.equal(emitBatch(bp, {}).gate, 'pilot_required');
  assert.throws(() => emitBatch(loadReg('fauna'), {}), /dormant/);
  assert.throws(() => emitBatch(loadReg('items'), {}), /dormant/);
  assert.throws(() => emitBatch(loadReg('elevation_wang'), {}), /dormant/);
});
```

Note: `emitBatch` for a matrix registry needs a guard — matrix rows are count-only until their consuming plan defines per-axis descriptors. Extend `emitBatch`:

```js
// in emitBatch(), after the dormant check:
if (reg.category === 'matrix') {
  return { burst: `${reg.consuming_plan.toLowerCase()}-${reg.id}`, registry: reg.id,
           gate: reg.status, jobs: [], note: 'matrix registry: counts only until consuming plan defines descriptors' };
}
```

Adjust the test accordingly: `emitBatch(bp, {}).jobs.length === 0` and `gate === 'pilot_required'`.

- [ ] **Step 3: Run, fix, all tests pass.**

- [ ] **Step 4: Commit.**

```bash
git add scripts/asset-corpus/registry/*.json scripts/asset-corpus/lib/emit.mjs test/asset-corpus.test.mjs
git commit -m "feat(assets): dormant corpus rows — fauna, body parts, building pieces, items, elevation"
```

---

### Task 6: Compiler CLI — `compile.mjs` (counts.md + batches/ + manifest cross-check)

**Files:**
- Create: `scripts/asset-corpus/compile.mjs`
- Modify: `.gitignore`
- Test: `test/asset-corpus.test.mjs` (append)

- [ ] **Step 1: Write the failing test** (run compiler as child process into a temp dir):

```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('compile.mjs writes counts.md and one batch per armed/pilot registry', () => {
  const out = mkdtempSync(join(tmpdir(), 'corpus-'));
  execFileSync('node', ['scripts/asset-corpus/compile.mjs', '--out', out]);
  const counts = readFileSync(join(out, 'counts.md'), 'utf8');
  assert.match(counts, /f6_trees/);
  assert.match(counts, /body_parts/);
  assert.match(counts, /GRAND TOTAL/);
  assert.ok(existsSync(join(out, 'batches', 'w2-f6_trees.json')));
  assert.ok(existsSync(join(out, 'batches', 'w2-f7_canopies.json')));
  assert.ok(existsSync(join(out, 'batches', 'p2-roads_wang.json')));
  assert.ok(existsSync(join(out, 'batches', 'p2-roads_wang-pilot.json')));
  // dormant rows emit no batch
  assert.ok(!existsSync(join(out, 'batches', 'l4-fauna.json')));
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `compile.mjs`:**

```js
#!/usr/bin/env node
// scripts/asset-corpus/compile.mjs — registry/ -> out/counts.md + out/batches/*.json
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateRegistry, resolveDerived } from './lib/enumerate.mjs';
import { emitBatch, emitPilotBatch } from './lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_DIR = join(HERE, 'registry');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : join(HERE, 'out');

const DATA_FILES = new Set(['biome_base_tiles.json']);
const byId = {};
for (const f of readdirSync(REG_DIR).filter((f) => f.endsWith('.json') && !DATA_FILES.has(f))) {
  const reg = JSON.parse(readFileSync(join(REG_DIR, f), 'utf8'));
  byId[reg.id] = reg;
}

mkdirSync(join(OUT, 'batches'), { recursive: true });

const lines = ['# Asset Corpus Enumeration', '', `Generated by compile.mjs — do not edit. Registry is the source.`, '',
  '| registry | plan | status | instances | base | states | anim jobs | total sprites |',
  '|---|---|---|---|---|---|---|---|'];
let grand = 0, grandAnim = 0;

for (const id of Object.keys(byId).sort()) {
  const reg = resolveDerived(byId[id], byId);
  const e = enumerateRegistry(reg);
  grand += e.totalSprites; grandAnim += e.animJobs;
  lines.push(`| ${e.id} | ${e.plan} | ${e.status} | ${e.instances} | ${e.baseSprites} | ${e.stateSprites} | ${e.animJobs} | ${e.totalSprites} |`);

  if (reg.status !== 'dormant') {
    const batch = emitBatch(byId[id], byId);
    writeFileSync(join(OUT, 'batches', `${batch.burst}.json`), JSON.stringify(batch, null, 2));
    if (byId[id].pilot) {
      const pilot = emitPilotBatch(byId[id], byId);
      writeFileSync(join(OUT, 'batches', `${pilot.burst}.json`), JSON.stringify(pilot, null, 2));
    }
  }
}

lines.push('', `**GRAND TOTAL: ${grand} sprites + ${grandAnim} animation jobs** (excluding open-ended runtime rows: discovered-recipe icons).`, '');
writeFileSync(join(OUT, 'counts.md'), lines.join('\n'));
console.log(`counts.md + batches written to ${OUT} — total ${grand} sprites, ${grandAnim} anim jobs`);
```

- [ ] **Step 4: Run tests, all pass.**

- [ ] **Step 5: Add to `.gitignore`** (append lines):

```
scripts/asset-corpus/out/batches/
scripts/.bursts/
scripts/.pixellab_inflight.json
```

- [ ] **Step 6: Run the compiler for real, eyeball counts.md, compare against the X1 manifest estimates** (`docs/superpowers/plans/2026-06-12-pixellab-asset-manifest.md`). Differences are expected (flat-64 supersedes old estimates) — update the manifest doc's affected rows with a one-line note: "counts now compiled — see `scripts/asset-corpus/out/counts.md` (flat 64 variants, user decision 2026-06-12)".

Run: `node scripts/asset-corpus/compile.mjs`
Expected: counts.md lists 8 registries; W2 rows armed; grand total printed.

- [ ] **Step 7: Commit (including generated counts.md and manifest doc update).**

```bash
git add scripts/asset-corpus/compile.mjs scripts/asset-corpus/out/counts.md .gitignore docs/superpowers/plans/2026-06-12-pixellab-asset-manifest.md test/asset-corpus.test.mjs
git commit -m "feat(assets): corpus compiler CLI — full enumeration + batch emission, manifest cross-noted"
```

---

### Task 7: Generic runner skeleton — batch load, gates, state, dry-run

**Files:**
- Create: `scripts/bulk_generate.py`

The runner generalizes `scripts/bulk_generate_f4.py` (DO NOT modify that file — it is running). Port these functions **verbatim** from it: `get_api_key` (:110), `api_call` (:127), `fetch_bytes` (:160), `valid_png` (:175), `save_png` (:195), `track_usage` (:226), `credits_ok` (:275). Keep its constants: `API_BASE`, `POLL_INTERVAL=20`, `SUBMIT_DELAY=2`, `JOB_TIMEOUT=10800`, `MAX_RETRIES=3`, `CREDITS_FLOOR=3.00`, `CREDITS_CHECK_EVERY=600`.

- [ ] **Step 1: Write the skeleton:**

```python
#!/usr/bin/env python3
"""
bulk_generate.py — generic PixelLab batch runner for asset-corpus batches.

Consumes scripts/asset-corpus/out/batches/<burst>.json (from compile.mjs).
Job kinds: create | state | anim | wang. Resumable; never redoes valid PNGs.

Gates:
  armed          -> runs
  pilot          -> runs (pilot batches are how pilots happen)
  pilot_required -> REFUSES unless scripts/.bursts/<burst>/pilot_pass.json exists
  dormant        -> always refuses

Usage:
  python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/w2-f6_trees.json
  python scripts/bulk_generate.py --batch <file> --dry-run
  python scripts/bulk_generate.py --batch <file> --phase create --max-inflight 4
  python scripts/bulk_generate.py --batch <file> --status
"""
import argparse, json, sys, time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BURSTS_DIR = REPO_ROOT / "scripts" / ".bursts"
BIOME_TILES = REPO_ROOT / "scripts" / "asset-corpus" / "registry" / "biome_base_tiles.json"
ACCOUNT_LIMIT = 20

# ... ported helpers from bulk_generate_f4.py go here (see task header) ...

def load_batch(path: Path) -> dict:
    with open(path) as f:
        batch = json.load(f)
    for k in ("burst", "registry", "gate", "jobs"):
        if k not in batch:
            sys.exit(f"malformed batch: missing {k}")
    return batch

def check_gate(batch: dict) -> None:
    gate = batch["gate"]
    if gate == "dormant":
        sys.exit(f"{batch['burst']}: dormant — refusing (enumerate-only row)")
    if gate == "pilot_required":
        marker = BURSTS_DIR / batch["burst"] / "pilot_pass.json"
        if not marker.exists():
            sys.exit(f"{batch['burst']}: pilot_required — refusing. Run the pilot batch, "
                     f"verify assembly/seams, then record {marker} "
                     f'(JSON: {{"passed_by": "<user>", "date": "YYYY-MM-DD", "evidence": "<note>"}})')
    if not batch["jobs"]:
        sys.exit(f"{batch['burst']}: batch has no jobs (matrix counts-only row?)")

def burst_paths(burst: str):
    d = BURSTS_DIR / burst
    d.mkdir(parents=True, exist_ok=True)
    return d / "state.json", d / "run.log"

def load_state(state_file: Path) -> dict:
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {"tasks": {}, "usage": {}}

def save_state(state: dict, state_file: Path):
    tmp = state_file.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f)
    tmp.replace(state_file)

def dry_run(batch: dict):
    from collections import Counter
    kinds = Counter(j["kind"] for j in batch["jobs"])
    print(f"burst={batch['burst']} gate={batch['gate']} jobs={len(batch['jobs'])} {dict(kinds)}")
    for j in batch["jobs"][:5]:
        print(" ", json.dumps(j)[:160])
    if len(batch["jobs"]) > 5:
        print(f"  ... {len(batch['jobs']) - 5} more")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--phase", choices=["create", "state", "anim", "wang"])
    ap.add_argument("--max-inflight", type=int, default=4)
    args = ap.parse_args()
    batch = load_batch(Path(args.batch))
    if args.dry_run:
        check_gate(batch); dry_run(batch); return
    if args.status:
        report_status(batch); return  # implemented in Task 9
    check_gate(batch)
    run(batch, args)                  # implemented in Task 9

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify gate enforcement by hand** (after compiling batches in Task 6):

Run: `node scripts/asset-corpus/compile.mjs && python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/p2-roads_wang.json --dry-run`
Expected: exits with `pilot_required — refusing` message.

Run: `python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/w2-f6_trees.json --dry-run`
Expected: prints `burst=w2-f6_trees gate=armed jobs=... {'create': 24, 'state': 180, 'anim': 24}`.

Run: `python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/p2-roads_wang-pilot.json --dry-run`
Expected: prints `gate=pilot jobs=3`.

- [ ] **Step 3: Commit.**

```bash
git add scripts/bulk_generate.py
git commit -m "feat(assets): generic runner skeleton — batch loading, burst gates, dry-run"
```

---

### Task 8: Shared concurrency ledger

**Files:**
- Modify: `scripts/bulk_generate.py`

The live F4/F5 runs don't participate in the ledger; the operator caps new bursts with `--max-inflight` (default 4) while they're alive. The ledger prevents multiple *new* runner instances from jointly exceeding the account limit.

- [ ] **Step 1: Add the ledger class:**

```python
import os

LEDGER = REPO_ROOT / "scripts" / ".pixellab_inflight.json"
STALE_S = 600  # entries without heartbeat for 10 min are dead runners

class InflightLedger:
    """Cooperative inflight accounting across bulk_generate.py instances.
    Lockfile-free best-effort: read-modify-write with atomic replace; collisions
    only ever overcount briefly, which is safe (we submit fewer, never more)."""

    def __init__(self, burst: str):
        self.key = f"{burst}:{os.getpid()}"

    def _read(self) -> dict:
        try:
            with open(LEDGER) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}
        now = time.time()
        return {k: v for k, v in data.items() if now - v.get("ts", 0) < STALE_S}

    def publish(self, count: int):
        data = self._read()
        data[self.key] = {"count": count, "ts": time.time()}
        tmp = LEDGER.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(data, f)
        tmp.replace(LEDGER)

    def others(self) -> int:
        return sum(v["count"] for k, v in self._read().items() if k != self.key)

    def headroom(self, my_cap: int, my_inflight: int) -> int:
        budget = min(my_cap, ACCOUNT_LIMIT - self.others())
        return max(0, budget - my_inflight)

    def clear(self):
        data = self._read()
        data.pop(self.key, None)
        tmp = LEDGER.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(data, f)
        tmp.replace(LEDGER)
```

- [ ] **Step 2: Verify with a quick inline check:**

Run: `python - <<'EOF'
import sys; sys.path.insert(0, 'scripts')
from bulk_generate import InflightLedger
a = InflightLedger('burst-a'); b = InflightLedger('burst-b')
a.publish(6); b.publish(3)
assert a.others() == 3 and b.others() == 6
assert a.headroom(my_cap=4, my_inflight=2) == 2
assert b.headroom(my_cap=20, my_inflight=0) == 14  # 20 - 6 others
a.clear(); b.clear()
print("ledger OK")
EOF`
Expected: `ledger OK`

(If importing `bulk_generate` triggers main(), guard is already `if __name__ == "__main__"` — fine.)

- [ ] **Step 3: Commit.**

```bash
git add scripts/bulk_generate.py
git commit -m "feat(assets): shared inflight ledger — new bursts cooperate under the 20-job limit"
```

---

### Task 9: Runner stages — create / state / anim / wang submit+finalize + scheduler

**Files:**
- Modify: `scripts/bulk_generate.py`

Port the proven scheduler and stage logic from `bulk_generate_f4.py`, parameterized by job records instead of the hardcoded CATALOG/STATES tables. Source line references (read each before porting):
- scheduler loop + inflight adoption: `bulk_generate_f4.py:575-660` — same structure; replace `MAX_INFLIGHT` checks with `ledger.headroom(args.max_inflight, len(inflight))` and call `ledger.publish(len(inflight))` each tick; `ledger.clear()` on exit.
- `submit_base` (:389) → `submit_create(job)`: POST `create-1-direction-object` with `{"description": job["prompt"], "image_size": {"width": job["size"], "height": job["size"]}, "n_images": job["candidates"]}` — submit `job["calls"]` separate calls (tracked as `create:<id>:<call_n>` tasks), keep up to `job["keep"]` valid variants total across calls.
- `finalize_base` (:436) → `finalize_create`: download candidate PNGs, `valid_png` filter, save as `{REPO_ROOT}/{job['out']}/v{NNN}.png` (zero-padded, F4 convention `variant_path` :243).
- `submit_state` (:397) / `finalize_state` (:476) → `submit_state(job)`: POST `objects/{parent_object_id}/states` with `{"edit_description": job["edit"], "n_images": min(job["pool"], 16)}` — repeat calls until `job["pool"]` valid PNGs exist in `{job['out']}/`. Parent object id comes from the create task's stored response id (`state["tasks"]["create:"+job["parent"]]["object_ids"]`); states must be submitted promptly after create finalize (objects expire after 8h — same constraint F4 documents at :8).
- `submit_anim` (:421) / `finalize_anim` (:509) → anim jobs: POST `animate-with-text-v3` with `{"description": job["action"], "n_frames": job["frames"], "image_size": ..., "init_image": <base64 of variant PNG>}` per variant, saving frames to `{job['out']}/v{NNN}/frame_{K}.png` (F4 convention `anim_dir` :249).
- wang jobs → from `gen_all_wang.py:56-95`: POST `create-tileset` with `{"lower_description": <biome_tiles[job["lower_biome"]]["desc"]>, "lower_base_tile_id": <...["base_tile_id"]>, "upper_description": job["upper_description"], "transition_description": f"{lower desc} transitioning to {job['upper_description']}", "transition_size": job["transition_size"], "tile_size": {"width": 32, "height": 32}, "view": "high top-down", "outline": "lineless", "detail": "highly detailed", "shading": "highly detailed shading"}`; poll `GET create-tileset/{tileset_id}`; save the 25 tiles base64-decoded to `{job['out']}/` as `{job['id']}__wang_{idx}.png` (per `save_tiles` :82). **Content-hash each downloaded tile (sha256, first 12 hex chars) into `state["tasks"][key]["tile_hashes"]`** — this is the regenerate-instead-of-reuse detector from the spec: identical reference IDs producing different hashes across bursts is logged as a WARNING.
- `--status` report: port the shape of f4's `--status` (task counts per phase/status from the state table).

Task-table states follow F4's: `pending -> queued -> (review) -> done | failed | expired` (:306-309). Resume = re-adopt `queued` tasks on restart (:595-602).

- [ ] **Step 1: Implement all four stages + scheduler as specified above.** This is the largest step; keep each stage function under ~60 lines by reusing the ported helpers.

- [ ] **Step 2: Dry-run every emitted batch:**

Run: `for b in scripts/asset-corpus/out/batches/*.json; do python scripts/bulk_generate.py --batch "$b" --dry-run || true; done`
Expected: w2 batches + roads pilot print job tables; `p2-roads_wang.json` refuses (pilot_required); no tracebacks.

- [ ] **Step 3: Live smoke test — ONE create job** (cheap, ~1 call): temporarily make a smoke batch:

Run: `python - <<'EOF'
import json
b = json.load(open('scripts/asset-corpus/out/batches/w2-f6_trees.json'))
b['jobs'] = [j for j in b['jobs'] if j['id'] == 'forest/oak' and j['kind'] == 'create'][:1]
b['jobs'][0]['calls'] = 1; b['jobs'][0]['keep'] = 4
b['burst'] = 'smoke-oak'
json.dump(b, open('scripts/asset-corpus/out/batches/smoke-oak.json', 'w'))
EOF
python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/smoke-oak.json --max-inflight 1`
Expected: 1 job submitted, candidates downloaded, ≥1 valid 192px PNG lands in `assets/pixelab/landscape_v2/micro/large_flora/forest/oak/`. Check credits first: the F4/F5 runs are live — if `--status` style balance check shows < $5, pause and ask the user.

- [ ] **Step 4: Verify the PNG** — open it (Read tool can read images), confirm: top-down tree, alpha background, plausibly 192×192 (`python -c "from PIL import Image; im=Image.open(<path>); print(im.size)"`).

- [ ] **Step 5: Delete the smoke batch file, commit.**

```bash
rm scripts/asset-corpus/out/batches/smoke-oak.json
git add scripts/bulk_generate.py
git commit -m "feat(assets): runner stages — create/state/anim/wang with hash-based wang reuse detection"
```

---

### Task 10: Fire the W2 burst + roadmap bookkeeping

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md` (W2 + X1 status cells only — surgical edit, other agents edit this file too: re-read it immediately before editing)

- [ ] **Step 1: Check the account is not saturated:** `tail -5 assets/pixelab/landscape_v2/micro/medium_flora/_f4_run.log` and same for `_f5_run.log`. If both are still submitting heavily / 429-looping, start W2 at `--max-inflight 2`; otherwise 4.

- [ ] **Step 2: Fire W2 create phase in the background:**

Run (background): `python scripts/bulk_generate.py --batch scripts/asset-corpus/out/batches/w2-f6_trees.json --phase create --max-inflight 4`
Expected: submits tree create jobs as headroom allows; state file at `scripts/.bursts/w2-f6_trees/state.json`; resumable on interrupt. (F7 canopies and state/anim phases follow after creates finalize — the runner's normal flow; do NOT fire f7 until f6 creates are reviewed for quality.)

- [ ] **Step 3: Update roadmap rows** — W2 status cell: `executing (asset burst live — corpus tooling + runner shipped this date; renderer wiring + size tuner = separate plan)`. X1 status cell: `executing (registry + compiler + counts.md live — scripts/asset-corpus/)`.

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/plans/2026-06-12-pass2plus-roadmap.md
git commit -m "docs(assets): roadmap — W2 burst firing, X1 corpus tooling live"
```

---

## Verification (whole plan)

1. `node --test test/asset-corpus.test.mjs` — all green.
2. `node scripts/asset-corpus/compile.mjs` — deterministic (run twice, `git diff --quiet scripts/asset-corpus/out/counts.md` after second run).
3. Every batch dry-runs; dormant/pilot_required gates refuse correctly.
4. Smoke oak PNG visually verified (192px, alpha, top-down).
5. W2 burst running in background without starving the live F4/F5 runs (watch their logs for continued progress).

## Follow-on plans (not this doc)

- **W2 renderer wiring + F6 per-biome size tuner** — after first archetypes land on disk (needs sprites to tune).
- **Settlements debug overlay** — independent; integration surfaces already researched (canvas-renderer.js:222 draw entry, elevation-overlay pattern at :430, field-tuner key wiring at field-tuner.js:355, SimClient entities/deltas at sim-client.js:11-17).
- **Road Wang pilot evaluation** — run `p2-roads_wang-pilot.json`, visually check seams against existing transitions, record `pilot_pass.json` or iterate prompts.
