# Pass 1 Plan D — Asset-State Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver spec §6.3 — the canonical lifecycle state machine that every rendered living thing maps onto, plus per-archetype requirement sheets for F2–F7 (and future fauna/body) at PixelLab quantizations, as BOTH a human-readable spec doc and a machine-readable module that Plan E's renderer binding will consume.

**Architecture:** One spec doc (`docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md`) is the human contract; one ESM module (`src/world/asset-state-taxonomy.js`) mirrors it exactly and is the only thing code imports. Two pure functions (`spineStateOf`, `visualStateOf`) map kernel truth (stage, age, reserve buffer) onto the spine and the spine onto on-disk visual states. Tests pin the module to the kernel's real species tables and to the real on-disk state vocabularies (taxonomy must subsume reality — spec: "nothing is thrown away"). NO asset generation in this plan (spec: "generation itself rides the existing pipeline").

**Tech Stack:** Markdown spec, plain ESM JS, node:test. No new dependencies.

**Spec authority:** `docs/superpowers/specs/2026-06-11-pass1-time-metabolism-simulation-kernel-design.md` §6.3. Grounding facts (verified 2026-06-11): sim stages are seedling/growing/mature per species via `stageAt(species, ageTicks)` in `sim/time/metabolism.js`; senescence begins at `SPECIES[s].senescence.start` (ticks); corpses are nodes with `attrs.E` decaying to GONE_THRESHOLD 0.5; protocol serializes `stage` names seedling/growing/mature/corpse. On-disk states: F3 = decayed/cracked/destroyed/burned/frozen/enchanted (complete); F4 = seedling/wilting/dead/crushed/burned/frozen/enchanted under `_states/` (complete); F5 = cracked/destroyed/mossy_overgrown/burned/frozen/enchanted (in progress); F2 = base + wind_sway only (no lifecycle states yet). Quantizations: 32px F2–F3, 64px F4 (80px for 6 large types), 96px F5, 192px F6–F7. Approved renderer distribution (memory, user-approved): 15% seedling / 55% normal / 20% wilting / 10% dead, seedling via transform scaling where no dedicated sprite exists.

## GIT SAFETY (include in every subagent prompt)

The repo has many unrelated dirty/untracked asset files. NEVER use `git add -A`, `git add .`, `git reset --hard`, `git checkout --`, `git stash`, or `--amend`. Stage ONLY the exact files you change. NEVER push.

## File structure

- `docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md` — Task 1+2 (human contract: state machine + requirement sheets)
- `src/world/asset-state-taxonomy.js` — Task 3 (machine contract; imported by Plan E renderer + tests)
- `sim/test/taxonomy.test.js` — Task 3 (pins module to kernel species tables)
- `sim/test/probe-taxonomy-coverage.test.js` — Task 4 (pins module to on-disk asset reality)

---

### Task 1: Canonical taxonomy spec doc — the state machine

**Files:**
- Create: `docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md`

- [ ] **Step 1: Write the doc** with exactly this content (verbatim; this IS the design):

````markdown
# Asset-State Taxonomy — canonical lifecycle states for everything rendered

**Status:** Pass 1 Plan D deliverable (spec §6.3). This doc + `src/world/asset-state-taxonomy.js` are the same contract in two forms; if they diverge, fix the divergence — neither wins by default.

## 1. The spine (simulation truth)

Every living thing the kernel simulates is, at any tick, in exactly one spine state:

```
seedling → growing → mature ⇄ flourishing/wilting → senescent → dead → decaying → gone
```

Derivation from kernel truth (all inputs already exist in Pass 1):

| Spine state | Kernel condition |
|---|---|
| seedling | `stageAt(species, age)[0] === 'seedling'` |
| growing | `stageAt(...) === 'growing'` |
| mature | `stageAt(...) === 'mature'`, not senescent, buffer in [WILT_BELOW_DAYS, FLOURISH_ABOVE_DAYS] |
| flourishing | mature, not senescent, buffer > FLOURISH_ABOVE_DAYS (10 days) |
| wilting | mature or senescent, buffer < WILT_BELOW_DAYS (2 days) |
| senescent | `age ≥ SPECIES[s].senescence.start` (and not wilting) |
| dead | death event fired; node replaced by corpse |
| decaying | corpse node exists, `attrs.E > GONE_THRESHOLD (0.5)` |
| gone | corpse removed (decay_gone) — nothing rendered |

**buffer** = `R / dailyBurn` — how many days of burn the entity's reserve covers. It is the
metabolism speaking: a plant that cannot cover ~2 days wilts visibly; one holding >10 days
flourishes. The thresholds are taxonomy constants (`CONDITION` in the module), not per-species
knobs. The protocol's `stage` field carries seedling/growing/mature/corpse today; Plan E extends
serialization with the derived spine state (or buffer) — the rule lives HERE so both sides agree.

## 2. Visual quantization (asset truth)

Sprites cannot afford nine states per archetype. The core visual vocabulary is four states, and
the spine maps onto it **1:1 with the existing F2–F4 pipeline states — nothing is thrown away**:

| Spine | Visual |
|---|---|
| seedling | `seedling` |
| growing, mature, flourishing | `normal` (base sprite) |
| wilting, senescent | `wilting` |
| dead, decaying | `dead` |
| gone | — (not rendered) |

Continuous ramps (growth scale within `growing`, decay fade within `decaying`, flourish dress on
`flourishing`) are renderer transforms over these sprites, never new sprite states. The
user-approved transform approach (15/55/20/10 distribution, seedling = scaled base) remains valid
wherever a dedicated sprite is not required by a sheet (§3 of the sheets doc section).

## 3. Orthogonal axes

A rendered state = one core visual state × at most one damage overlay × at most one dress.
Damage states REPLACE the core sprite; dress states RECOLOR/OVERLAY it.

- **Yield** (only yield-bearing archetypes): `budding → fruiting → harvested → (regrow to budding)`.
  Kernel: fruiting when mature + reserve above seed floor; `pick` ⇒ harvested until regrowth.
- **Damage** (replaces core): flora `crushed` (F4), `cut → stump` (trees), `broken → snag` (trees),
  inorganic `cracked → destroyed` (F3/F5). Damage is written by interaction verbs as deltas
  (Plan E); a damaged state persists until decay/regrowth reclaims it.
- **Dress** (overlays core): `burned`, `frozen`, `enchanted`, `mossy_overgrown`. Driven by biome /
  elemental events; orthogonal to lifecycle.

## 4. Matter vs Life

F3 scatter and most F5 objects are MATTER, not Life: they have no spine, only damage/dress axes
and (for organic matter: stumps, logs, bone) the decaying tail of the spine (`decaying → gone`
via embodied-reserve decay). This is honest absence: a boulder does not pretend to live.

## 5. Honest-absence rules for missing sprites

- A required state with no generated sprite yet renders as its nearest spine ancestor with a
  renderer transform (wilting → desaturated normal, dead → flattened/desaturated) — a DECLARED
  fallback in the catalog, never a silent wrong sprite.
- `gone` is always honest: the entity is removed; the claim frees; F0/F1 ground shows through.
- No state may be rendered that the ledger cannot justify (no decorative corpses).
````

(Continue the same file with the §6 requirement sheets from Task 2 — Task 2 appends to this doc.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md
git commit -m "docs(taxonomy): canonical lifecycle state machine — spine, visual map, axes (spec 6.3)"
```

---

### Task 2: Per-archetype requirement sheets

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md` (append §6)

- [ ] **Step 1: Append** exactly this content:

````markdown
## 6. Per-archetype requirement sheets (F2–F7 + future fauna/body)

Legend — each state is marked: **E** exists on disk, **R** required (generate via existing
pipeline), **T** via renderer transform (no sprite), **F** future pass (declared, not Pass 1 work).

### F2 — small flora, 32px, ~48 archetypes (16 biomes × ~3)
| State | Mark | Note |
|---|---|---|
| normal | E | base v000–v063 per archetype |
| seedling | T | scale ~0.55 of base (user-approved) |
| wilting | R | one sprite per archetype |
| dead | R | one sprite per archetype |
| dress: frozen/enchanted | F | per-biome, later pass |
| anim: wind_sway | E (partial) | rolling deployment |
Yield/damage axes: none at 32px — destruction = removal (claim freed).

### F3 — small scatter, 32px, 64 archetypes — MATTER (no spine)
| State | Mark |
|---|---|
| base | E |
| decayed, cracked, destroyed, burned, frozen, enchanted | E (complete 2026-06-08, selective per organic/mineral/bone category) |
Sheet status: DONE — F3 already satisfies its taxonomy row.

### F4 — medium flora, 64px (80px for 6 large types), 48 archetypes
| State | Mark |
|---|---|
| normal (base), seedling, wilting, dead | E |
| damage: crushed | E |
| dress: burned, frozen, enchanted | E |
| anim: wind_sway (9 frames) | E (rolling) |
Sheet status: DONE — F4 is the reference implementation of the core visual vocabulary.

### F5 — medium objects, 96px, 48 archetypes (Geological / Organic / Relic)
Geological + Relic (MATTER): | base E | cracked, destroyed R/E (in progress) | dress: mossy_overgrown, burned, frozen, enchanted R/E (in progress) |
Organic (stumps, fallen logs, hay — decaying-tail matter): | base E | mossy_overgrown = decay progression R/E | dress as above |
Sheet status: generation in progress on the existing F5 pipeline; taxonomy adds NO new states.

### F6 — large objects (trees), 192px, archetypes TBD per biome — NOT YET GENERATED
| State | Mark | Note |
|---|---|---|
| seedling | R | dedicated sprite (192px canvas, small sapling) |
| growing | R | sapling, distinct silhouette |
| normal (mature) | R | base |
| wilting | R | thinned/browned canopy |
| dead | R | bare snag |
| damage: cut → stump | R | stump is the persistent delta after `chop` |
| damage: broken → snag | R | storm/fauna damage |
| dress: burned | R | charred variant |
| yield: budding/fruiting/harvested | R (fruit-bearing archetypes only) |
| dress: frozen/enchanted, season dress | F |

### F7 — canopy overlay, 192px — NOT YET STARTED
One overlay per F6 state that has canopy (seedling/growing have none): normal, wilting,
flourish dress, season dress. Marks: R for normal/wilting, F for the rest. Canopy state must
always equal its trunk's state (single source: the F6 entity).

### Fauna / body (future — S4 Life pass; declared here so the kernel needs no rework)
Quantization 64px (32px small fauna). Spine maps to: juvenile (seedling+growing), adult
(mature/flourishing/wilting via condition dress), elderly (senescent), corpse (dead/decaying),
gone. Marks: all F. Kernel's grazer already walks this spine; only sprites are future.

### Kernel species → archetype-class binding (Plan E consumes)
| Kernel species | Class | Yield axis |
|---|---|---|
| grass | F2 small flora | no |
| berry_bush | F4 medium flora | yes (budding/fruiting/harvested) |
| tree | F6 large object | per-archetype |
| grazer | fauna | no |
````

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md
git commit -m "docs(taxonomy): per-archetype requirement sheets F2-F7 + fauna at PixelLab quantizations (spec 6.3)"
```

---

### Task 3: Machine-readable taxonomy module + tests

**Files:**
- Create: `src/world/asset-state-taxonomy.js`
- Test: `sim/test/taxonomy.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// sim/test/taxonomy.test.js — the taxonomy module must agree with the kernel's species tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPINE, CORE_VISUAL, SPINE_TO_VISUAL, CONDITION, AXES, FIELD_SHEETS,
  spineStateOf, visualStateOf,
} from '../../src/world/asset-state-taxonomy.js';
import { SPECIES, stageAt, DAY } from '../time/metabolism.js';

test('spine is complete and maps totally onto the visual vocabulary', () => {
  assert.deepEqual(SPINE, ['seedling', 'growing', 'mature', 'flourishing', 'wilting', 'senescent', 'dead', 'decaying', 'gone']);
  for (const s of SPINE) assert.ok(s in SPINE_TO_VISUAL, `${s} mapped`);
  for (const [s, v] of Object.entries(SPINE_TO_VISUAL)) {
    assert.ok(v === null || CORE_VISUAL.includes(v), `${s}→${v} legal`);
  }
  assert.equal(SPINE_TO_VISUAL.gone, null);
});

test('every kernel species stage name is spine vocabulary', () => {
  for (const [name, sp] of Object.entries(SPECIES)) {
    for (let d = 0; d <= 2 * (sp.senescence.start / DAY); d += 5) {
      const stage = stageAt(name, d * DAY)[0];
      assert.ok(['seedling', 'growing', 'mature'].includes(stage), `${name}@${d}d: ${stage}`);
    }
  }
});

test('spineStateOf derives condition and senescence from kernel truth', () => {
  const base = { stage: 'mature', ageTicks: 0, senescenceStartTicks: 1e12 };
  assert.equal(spineStateOf({ ...base, bufferDays: 5 }), 'mature');
  assert.equal(spineStateOf({ ...base, bufferDays: CONDITION.flourishAboveDays + 1 }), 'flourishing');
  assert.equal(spineStateOf({ ...base, bufferDays: CONDITION.wiltBelowDays - 1 }), 'wilting');
  // senescence overrides flourishing, wilting overrides senescence
  const old = { stage: 'mature', ageTicks: 100, senescenceStartTicks: 50 };
  assert.equal(spineStateOf({ ...old, bufferDays: 99 }), 'senescent');
  assert.equal(spineStateOf({ ...old, bufferDays: 0 }), 'wilting');
  // pre-mature stages pass through; corpse is decaying; unknown buffer (null) never wilts
  assert.equal(spineStateOf({ stage: 'seedling', ageTicks: 0, senescenceStartTicks: 1e12, bufferDays: 0 }), 'seedling');
  assert.equal(spineStateOf({ stage: 'corpse' }), 'decaying');
  assert.equal(spineStateOf({ ...base, bufferDays: null }), 'mature');
});

test('visualStateOf composes core with the 1:1 map', () => {
  assert.equal(visualStateOf('flourishing'), 'normal');
  assert.equal(visualStateOf('senescent'), 'wilting');
  assert.equal(visualStateOf('decaying'), 'dead');
  assert.equal(visualStateOf('gone'), null);
});

test('field sheets: quantizations and legal vocabularies', () => {
  const sheets = Object.entries(FIELD_SHEETS).filter(([f]) => f !== '_meta');
  const px = Object.fromEntries(sheets.map(([f, s]) => [f, s.px]));
  assert.deepEqual(px, { F2: 32, F3: 32, F4: 64, F5: 96, F6: 192, F7: 192, fauna: 64 });
  // 'growing' is admitted for F6 only: trees get a dedicated sapling sprite (spec doc §6 F6 sheet).
  const legal = new Set([...CORE_VISUAL, ...AXES.yield, ...AXES.damage, ...AXES.dress, 'base', 'growing']);
  for (const [field, sheet] of sheets) {
    for (const [state, mark] of Object.entries(sheet.states)) {
      assert.ok(legal.has(state), `${field}.${state} in legal vocabulary`);
      assert.ok(['E', 'R', 'T', 'F'].includes(mark), `${field}.${state} mark ${mark}`);
    }
  }
});

test('kernel species all bind to an archetype class with a sheet', () => {
  const { SPECIES_CLASS } = FIELD_SHEETS._meta;
  for (const name of Object.keys(SPECIES)) {
    const cls = SPECIES_CLASS[name];
    assert.ok(cls && FIELD_SHEETS[cls], `${name} → ${cls}`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test sim/test/taxonomy.test.js`
Expected: FAIL — `Cannot find module '../../src/world/asset-state-taxonomy.js'`.

(Verify first that `sim/time/metabolism.js` exports `DAY` and that `SPECIES[*].senescence.start` exists for every species — adapt the test's kernel imports to the real export names if they differ, and report the deviation.)

- [ ] **Step 3: Implement**

```js
// src/world/asset-state-taxonomy.js — machine form of docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md.
// Pure data + two pure functions. No imports: consumed by both renderer and sim tests.

export const SPINE = ['seedling', 'growing', 'mature', 'flourishing', 'wilting', 'senescent', 'dead', 'decaying', 'gone'];

export const CORE_VISUAL = ['seedling', 'normal', 'wilting', 'dead'];

export const SPINE_TO_VISUAL = {
  seedling: 'seedling', growing: 'normal', mature: 'normal', flourishing: 'normal',
  wilting: 'wilting', senescent: 'wilting', dead: 'dead', decaying: 'dead', gone: null,
};

/** Reserve-buffer thresholds (days of burn covered by R). Taxonomy constants, not species knobs. */
export const CONDITION = { wiltBelowDays: 2, flourishAboveDays: 10 };

export const AXES = {
  yield: ['budding', 'fruiting', 'harvested'],
  damage: ['crushed', 'cut', 'broken', 'cracked', 'destroyed', 'stump', 'snag'],
  dress: ['burned', 'frozen', 'enchanted', 'mossy_overgrown', 'decayed'],
};

/** Kernel truth → spine state. bufferDays = R / dailyBurn (null when unknown: never wilt on ignorance). */
export function spineStateOf({ stage, ageTicks = 0, senescenceStartTicks = Infinity, bufferDays = null }) {
  if (stage === 'corpse') return 'decaying';
  if (stage !== 'mature') return stage;                       // seedling | growing pass through
  if (bufferDays != null && bufferDays < CONDITION.wiltBelowDays) return 'wilting';
  if (ageTicks >= senescenceStartTicks) return 'senescent';
  if (bufferDays != null && bufferDays > CONDITION.flourishAboveDays) return 'flourishing';
  return 'mature';
}

/** Spine state → on-disk visual state (null = render nothing). */
export function visualStateOf(spineState) {
  return SPINE_TO_VISUAL[spineState] ?? null;
}

/** Requirement sheets. Marks: E exists on disk, R required (existing pipeline), T renderer transform, F future pass.
 *  `states` use the core-visual + axes vocabulary ('base' = the unstated base sprite for matter). */
export const FIELD_SHEETS = {
  _meta: {
    marks: { E: 'exists', R: 'required', T: 'transform', F: 'future' },
    SPECIES_CLASS: { grass: 'F2', berry_bush: 'F4', tree: 'F6', grazer: 'fauna' },
  },
  F2: { px: 32, kind: 'life', diskDir: 'small_flora',
    states: { normal: 'E', seedling: 'T', wilting: 'R', dead: 'R', frozen: 'F', enchanted: 'F' } },
  F3: { px: 32, kind: 'matter', diskDir: 'small_scatter',
    states: { base: 'E', decayed: 'E', cracked: 'E', destroyed: 'E', burned: 'E', frozen: 'E', enchanted: 'E' } },
  F4: { px: 64, kind: 'life', diskDir: 'medium_flora',
    states: { normal: 'E', seedling: 'E', wilting: 'E', dead: 'E', crushed: 'E', burned: 'E', frozen: 'E', enchanted: 'E' } },
  F5: { px: 96, kind: 'matter', diskDir: 'medium_objects',
    states: { base: 'E', cracked: 'R', destroyed: 'R', mossy_overgrown: 'R', burned: 'R', frozen: 'R', enchanted: 'R' } },
  F6: { px: 192, kind: 'life', diskDir: 'large_objects',
    states: { seedling: 'R', growing: 'R', normal: 'R', wilting: 'R', dead: 'R', stump: 'R', snag: 'R', burned: 'R',
              budding: 'R', fruiting: 'R', harvested: 'R', frozen: 'F', enchanted: 'F' } },
  F7: { px: 192, kind: 'life', diskDir: 'canopy',
    states: { normal: 'R', wilting: 'R' } },
  fauna: { px: 64, kind: 'life', diskDir: null,
    states: { seedling: 'F', normal: 'F', wilting: 'F', dead: 'F' } },
};
```

NOTE: sheets list VISUAL states only, so F2 has no `growing` row (`growing` → visual `normal` via SPINE_TO_VISUAL). The single exception is F6: trees get a DEDICATED sapling sprite, so `growing: 'R'` appears in F6's states and `'growing'` is admitted in the legal-vocabulary set of BOTH test files (with a comment). Doc and module agree on this; keep them identical.

- [ ] **Step 4: Run tests**

Run: `node --test sim/test/taxonomy.test.js` → PASS. Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/world/asset-state-taxonomy.js sim/test/taxonomy.test.js
git commit -m "feat(taxonomy): machine-readable asset-state taxonomy — spine, visual map, sheets (spec 6.3)"
```

---

### Task 4: Coverage probe — taxonomy subsumes on-disk reality

**Files:**
- Test: `sim/test/probe-taxonomy-coverage.test.js` (create)

The probe (CLAUDE.md continuous testability): every state name that EXISTS on disk must be declared in its field's sheet (the taxonomy throws nothing away); required-but-ungenerated states are REPORTED, never failed (generation rides the existing pipeline, later).

- [ ] **Step 1: Write the probe**

```js
// sim/test/probe-taxonomy-coverage.test.js — the taxonomy must subsume what the pipeline
// already generated (spec §6.3: "nothing is thrown away"). Missing assets are informational.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FIELD_SHEETS, CORE_VISUAL, AXES } from '../../src/world/asset-state-taxonomy.js';

const MICRO = join(import.meta.dirname, '../../assets/pixelab/landscape_v2/micro');

/** Collect distinct `_states/<name>` dir names under micro/<diskDir>/<biome>/<archetype>/. */
function statesOnDisk(diskDir) {
  const root = join(MICRO, diskDir);
  if (!existsSync(root)) return null;                       // field tree absent → skip
  const found = new Set();
  for (const biome of readdirSync(root, { withFileTypes: true })) {
    if (!biome.isDirectory() || biome.name.startsWith('_')) continue;
    const bdir = join(root, biome.name);
    for (const arch of readdirSync(bdir, { withFileTypes: true })) {
      if (!arch.isDirectory()) continue;
      const sdir = join(bdir, arch.name, '_states');
      if (!existsSync(sdir)) continue;
      for (const st of readdirSync(sdir, { withFileTypes: true })) {
        if (st.isDirectory()) found.add(st.name);
      }
    }
  }
  return found;
}

test('probe: every on-disk state name is declared in its field sheet', () => {
  for (const [field, sheet] of Object.entries(FIELD_SHEETS)) {
    if (field === '_meta' || !sheet.diskDir) continue;
    const disk = statesOnDisk(sheet.diskDir);
    if (disk === null) { console.log(`[taxonomy] ${field}: no asset tree at ${sheet.diskDir} — skipped`); continue; }
    const undeclared = [...disk].filter(s => !(s in sheet.states));
    assert.deepEqual(undeclared, [], `${field}: on-disk states missing from sheet: ${undeclared}`);
    const missing = Object.entries(sheet.states)
      .filter(([s, m]) => (m === 'E' || m === 'R') && s !== 'base' && s !== 'normal' && !disk.has(s))
      .map(([s]) => s);
    console.log(`[taxonomy] ${field}: disk=${[...disk].sort()} | declared-not-yet-on-disk=${missing.sort()}`);
  }
});

test('probe: sheet vocabularies stay inside the taxonomy', () => {
  // 'growing' admitted for F6's dedicated sapling sprite (mirrors taxonomy.test.js).
  const legal = new Set([...CORE_VISUAL, ...AXES.yield, ...AXES.damage, ...AXES.dress, 'base', 'growing']);
  for (const [field, sheet] of Object.entries(FIELD_SHEETS)) {
    if (field === '_meta') continue;
    for (const s of Object.keys(sheet.states)) assert.ok(legal.has(s), `${field}.${s}`);
  }
});
```

- [ ] **Step 2: Run the probe and reconcile reality**

Run: `node --test sim/test/probe-taxonomy-coverage.test.js`

The first assertion is EXPECTED to surface real on-disk state names the sheets don't know
(e.g. different F3/F5 directory layouts or extra state dirs). Reconciliation rule, in order:
1. If a disk state is a legal taxonomy word missing from that sheet → add it to the sheet
   (module AND spec doc) with mark E.
2. If a disk state is NOT in the taxonomy vocabulary (e.g. an animation dir wrongly under
   `_states/`, or a pipeline-internal name) → inspect the directory; if it is a real visual
   state, extend AXES.dress (module + doc + the legal-vocabulary test in BOTH test files);
   if it is not a state (staging/junk), exclude it in `statesOnDisk` with a comment naming it.
3. If a field's disk layout differs from `<biome>/<archetype>/_states/<state>/` (F3 and F5 may
   differ — VERIFY by listing the real tree), adapt `statesOnDisk` per-field via a
   `sheet.layout` hint added to FIELD_SHEETS rather than forking the probe.
Document every reconciliation in the final report.

- [ ] **Step 3: Run the full suite**

Run: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add sim/test/probe-taxonomy-coverage.test.js src/world/asset-state-taxonomy.js docs/superpowers/specs/2026-06-11-asset-state-taxonomy.md sim/test/taxonomy.test.js
git commit -m "test(taxonomy): coverage probe — taxonomy subsumes on-disk states (spec 6.3)"
```

(Stage only the files actually modified during reconciliation.)

---

### Task 5: Close-out

- [ ] **Step 1:** `npm test` one final time → all green; note final test count.
- [ ] **Step 2:** Check every box in this plan doc.
- [ ] **Step 3:** Update `docs/superpowers/plans/2026-06-11-pass1-roadmap.md`: Plan D row → `**DONE**` (cite this plan doc + any entries in "Canonical deviations" below), Plan E row → `**NEXT**`.
- [ ] **Step 4:** Commit:

```bash
git add docs/superpowers/plans/2026-06-11-pass1d-asset-state-taxonomy.md docs/superpowers/plans/2026-06-11-pass1-roadmap.md
git commit -m "docs: roadmap — Plan D DONE, Plan E NEXT"
```

---

## Canonical deviations (authoritative over task text above)

*Append entries here when execution legitimately diverges from the plan. Each entry: what changed, why, and which task it affects.*
