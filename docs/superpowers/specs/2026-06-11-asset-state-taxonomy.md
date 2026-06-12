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
