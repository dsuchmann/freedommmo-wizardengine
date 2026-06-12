# Fine-Grain Traversal + Interaction Plane — Design (Plan B)

**Date:** 2026-06-12
**Lane:** third agent (asset corpus / client). Companion to `2026-06-12-f6-trees-alpha-trim-design.md` (Plan A, shipped — placements carry `trim`).
**Status:** approved by user (this conversation)

## Goal

Players collide with, jump over, walk up onto, and stand on decoration objects (boulders, trees, walls, fences, stumps) — with collision geometry **inferred from the art itself** (alpha silhouettes, wang-tile pixels), not hand-authored per sprite. Alongside it, build the **interaction plane**: the enumerable data structure of everything a player could ever do with an object (traverse, destroy, read, activate, …), populated now for traversal and left honestly absent elsewhere.

User directives driving this design:
- "Use maximally the information that we have to infer the state from the game world" — ledge collision must match the drawn wall inside the wang tile, not the tile boundary; tree roots are walk-up-able; you can stand on roots **under** the canopy.
- Build the interaction-category data structures now, populate over time.
- Get "really, really elegant about" 3D-feeling traversal in a 2D game.

## Existing substrate (verified 2026-06-12)

- Player already has z-physics: jump (space, vz 7.5), gravity 16, glide, roll, slope-climb (`src/player.js`, `src/physics/movement.js`). Movement is client-only (no wire).
- Legacy collision: `objectBlocksPlayer()` blocks hand-placed F0/F1 objects with hardcoded radii. F4/F5/F6 field sprites are walk-through today.
- Plan A shipped per-variant alpha `trims` in MO/LG catalogs and `f4/f5/f6Placements()` records carrying `trim`, `bx/by/fw/fh`, `sizeTiles`, `state`.
- Catalog generation (`scripts/gen-mf-catalog.mjs`) already decodes every base-variant PNG (`scripts/lib/png-alpha-bbox.mjs`).

## Approach (chosen)

**Volumetric templates × alpha measurements.** Every object is a small stack of 3D primitives whose proportions come from the sprite's silhouette. Catalog time measures; a small set of templates interprets; movement resolves against the resulting volumes. Per-variant fidelity is free: a wide-rooted oak variant gets a wider root ramp than a slender birch because the art says so.

Rejected: full per-sprite collision masks (heights still need templates; sub-cell fidelity imperceptible at 32px/tile); curated numbers only (ignores the art, all variants collide identically).

## Components

### 1. Silhouette measurement — `scripts/lib/silhouette-measure.mjs`

Pure node lib beside the bbox reader. From a decoded RGBA buffer, emit per-variant measurements (~10 numbers, all in trim-local pixel units):

- `bands[16]` — silhouette width per row, 16 vertical bands over the trim bbox.
- `baseW` — max width of the bottom 15% of the silhouette (the footprint band).
- `coreW`, `coreX` — narrowest column width and its center-x in the band region between 20% and 60% of silhouette height (the trunk).
- `visH` — trim height (redundant with trims but kept local for convenience).

Stored in MF/MO/LG catalogs as `sil: [...]` next to `trims`, indexed by variant. **Raw measurements, not volumes** — template tuning never requires catalog regen. Catalog regen stays order-stable and additive (superset rule for existing consumers).

### 2. Traversal templates — `src/world/traversal-templates.js`

Pure functions: `volumeFor(sil, cls, state, scale, sizeTiles)` → volume record in tile/z units (z in tiles, matching player z):

```
{ baseRX, baseRY,        // solid-core ellipse radii at ground
  rampW, rampH,          // ramp annulus width beyond core, max z at core edge
  solidH,                // core height; Infinity = never jumpable over
  topZ,                  // standable surface height, or null
  overheadZ }            // canopy underside height, or null
```

Template classes and their interpretation of measurements:

- `tree` — ramp annulus from `baseW` (roots: z 0 → ~0.3 walking inward), solid core from `coreW` (trunk; solidH = Infinity), `overheadZ` from the band where width exceeds 2× coreW (canopy underside). Stand on roots under canopy.
- `boulder` — solid frustum from `baseW`, `topZ` proportional to visH×scale, jumpable when short (solidH ≤ jump apex).
- `stump`/`snag` — short solid, standable `topZ` (~0.4–0.6 tiles). **Selected by state**: a tree archetype in state `stump`/`snag` uses this template — traversal changes automatically when the world changes the object.
- `fence`/`wall` — thin solid (baseRY small), height from visH; jumpable if measured height clears.
- `flora` — no collision (null volume). F2/F3 and soft F4 plants.
- `prop` — plain solid cylinder, no ramp (altars, statues).

Archetype→class mapping: one small curated table (`TRAVERSAL_CLASS`) keyed by archetype name, with defaults by field+size (F6 default `tree`, F5 default `boulder`-ish solid, F4 default `flora`). State overrides applied after class lookup.

### 3. Movement resolver — extend `src/physics/movement.js`

Per frame, gather `f4/f5/f6Placements()` for the 3×3 tile neighborhood (results are already cached per tile by decoration-claims), build volumes via templates (memoized per placement), resolve the player capsule (x, y, z, radius ~0.3):

- **Horizontal block**: capsule vs solid-core ellipse when `player.z < solidH` — slide along, same contract as legacy blocking.
- **Ramp**: inside the ramp annulus, the floor is raised: `floorZ = rampH × (1 − dist/rampEdge)`; existing slope-climb feel reused. Walking up roots is just floor.
- **Support**: when falling/landing with the capsule over a standable volume and `player.z ≥ topZ − ε`, floor = `topZ`. Standing on a stump is gravity meeting a higher floor — no new verbs.
- **Jump-over**: nothing special — if `player.z > solidH` the horizontal block simply doesn't apply (requires finite solidH, e.g. fences, logs, short boulders).
- **underCanopy**: boolean exposed on the player when inside a volume's overhead band footprint with `player.z < overheadZ` — consumed by the renderer later (canopy fade follow-up), physics-inert now.

Legacy `objectBlocksPlayer` (F0/F1) unchanged. Movement stays client-only.

### 4. Wang occupancy — the ledge case

Catalog-time analyzer (`scripts/lib/` + a gen step) producing, for tilesets on a `COLLIDABLE_WANG` list, a per-wang-index occupancy strip: which cells of an 8×8 grid inside the 32px tile contain the drawn wall/ledge band (alpha or art-band analysis per tileset rules). Movement consults the strip so the player collides with the drawn ledge, not the tile boundary.

**Honest absence:** `COLLIDABLE_WANG` starts **empty** — today's wang sets are terrain transitions and roads, neither collides. When P4 wall/cliff tilesets land, they get pixel-true edges by adding one list entry. The analyzer + resolver path is built and tested against synthetic tiles now; no fake cliffs.

### 5. Interaction plane — `src/world/interaction-taxonomy.js` + `interaction-registry.js`

- **Taxonomy** (data, not code): categories `traversal`, `manipulation` (destroy, harvest, push, ignite, …), `use` (read, activate, offer, enchant, summon, unlock, …), `observation` (inspect, listen), `social`. Each verb is a record: `{ id, category, owner: 'client'|'sim', preconditions: [...] }`. Enumerating the space is cheap; implementing a verb is a system.
- **Registry**: sparse map `archetype(+state) → verb ids`. Traversal entries are **auto-filled** from the template system (an object with a finite solidH advertises `jump-over`; a topZ advertises `stand-on`). All other verbs start absent — an altar with no registered `use` verbs is just geometry until the sim lane gives it meaning. No placeholder interactions, ever.
- Shapes are plain JSON — the sim consumes the same records when sim-owned verbs (destroy → permanence delta) come alive. Atlas placement: this plane is the S3/S4 boundary surface; traversal is client-side S2-adjacent physics.

## Verification

- Node tests: silhouette measurements vs synthetic PNGs (known shapes: T-shaped tree, dome boulder); template math (tree/stump/fence volumes from fixed sil); resolver scenarios with stub placements (blocked walk slides, root ramp raises z, stump stand supports at topZ, low fence jump clears, tall trunk jump does not); wang occupancy vs synthetic tiles; registry auto-fill.
- Headless probe (F2-probe pattern): teleport at a forest oak — walk into trunk → position clamped; jump state over an F4 obstacle → passes; spawn over a stump-state tree → z settles at topZ > 0.
- Manual feel pass: forest walk — roots bump-and-ramp, trunk blocks, canopy overhead while on roots.

## Out of scope (follow-ups)

- Canopy fade rendering when underCanopy (draw tweak; flag is provided).
- Live semantic verbs (read/activate/…) — registered shapes only; each verb arrives with its owning system.
- Cliff/wall wang tilesets themselves (P4 lane); water-edge collision tuning.
- NPC/entity use of traversal volumes (sim lane; data shapes are ready).

## Constraints

- Shared working tree: exact-path staging; never touch `sim/`, running bursts, or other agents' surfaces beyond minimal call sites in `movement.js`.
- Catalog changes additive (superset rule); regen order-stable and rerunnable mid-burst.
- No-mock rule: absent verbs/tilesets are absent, never stubbed with fake behavior.
