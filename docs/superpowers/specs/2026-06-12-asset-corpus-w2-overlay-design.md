# Asset Corpus Compiler, W2 Tree Burst, and Settlement Debug Overlay — Design

**Date:** 2026-06-12
**Status:** approved design (brainstorm with user, this date)
**Lane:** parallel asset/tooling track — explicitly chosen to avoid the active P3 settlements sim loop (`sim/` is off-limits to this work) and the live F4/F5 generation runs.
**Authority chain:** `2026-06-12-pixellab-asset-manifest.md` (X1, counts + quantization) → `2026-06-11-asset-state-taxonomy.md` (state sheets) → `2026-06-12-pass2plus-roadmap.md` (W2 row) → this doc.

## Decisions locked in brainstorm

1. **Lane** = X1 enumeration/prompt-corpus tooling + W2 F6/F7 tree burst + paths/settlements debug overlay. (Not: fixing the running F5 script.)
2. **Roads are Wang tilesets, 32×32** — every road material × every biome base, seamless against the existing 21-biome transition library. User accepts the volume ("thousands of generations"). Known risk: PixelLab sometimes regenerates instead of reusing a referenced Wang tile ID — mitigated by recording reference IDs + content-hashing results, and a 1-material × 3-biome pilot before the matrix fires. Elevation changes likely also Wang — enumerated but dormant pending its own design.
3. **Variants: flat 64 per generated asset** across the whole corpus (supersedes the F4 "60 base / 16 per state" precedent for new bursts).
4. **Composable categories require pilots** (user directive): PixelLab is proven for complete objects/bodies, unproven for parts assembled outside PixelLab. Body parts and building pieces carry a `pilot_required` gate — small pilot batch + assembly probe (seams, palette coherence, joint alignment against the X2 motion-DSL rig vocabulary) before any mass burst. Fallback if pilots fail: PixelLab character tools (full bodies + skeleton animation) — decided by pilot evidence, not now. Rigging itself is owned by L2/L3.

## Component 1 — Asset corpus registry + compiler (X1 tooling)

**`scripts/asset-corpus/registry/*.json`** — one declarative file per manifest row:
`f6_trees.json`, `f7_canopies.json`, `fauna.json`, `body_parts.json`, `building_pieces.json`, `items.json`, `roads_wang.json`, `elevation_wang.json`.

Each registry file declares:
- archetypes (per-biome rosters where relevant), states (from the taxonomy sheet — the taxonomy stays authoritative for state lists), directions where applicable
- quantization (32px F2–F3 / 64px F4·fauna·parts / 96px F5 / 192px F6–F7; Wang always 32×32)
- variant count (64), animation specs (which states animate, frame counts)
- prompt template + per-archetype descriptor + art-direction block (house style: "top-down high fantasy pixel art …, jaw-dropping beauty, hyper-detailed, rich saturated colors, Final Fantasy aesthetic, alpha-transparent background")
- consuming plan + burst trigger status (`armed` / `dormant` / `pilot_required`) — manifest rule 1 (nothing generated speculatively) preserved in code
- for Wang rows: the exact existing base-tile image IDs used as "lower terrain" references (from `gen_all_wang.py`'s BIOMES table)

**`scripts/asset-corpus/compile.mjs`** — pure, deterministic; registry in → two outputs:
1. `scripts/asset-corpus/out/counts.md` — full enumeration: every object × state × direction × variant, totals per plan/burst. The "enumerate every single object and tile count" deliverable.
2. `scripts/asset-corpus/out/batches/<burst-id>.json` — ready-to-fire batch files: one job record per generation call with endpoint, size, full prompt, candidate count, animation params, output path (following existing `assets/pixelab/landscape_v2/` disk conventions).

A compiler check compares registry totals against the X1 manifest doc's estimates and warns on disagreement (manifest doc remains the human-readable authority; registry is its executable form).

## Component 2 — Generic batch runner

**`scripts/bulk_generate.py`** — one runner generalizing the proven `bulk_generate_f4.py` pattern; consumes any compiled batch. No more per-field script clones. Keeps: resumable per-burst state file + log (valid PNGs never redone), $3.00 credits floor with recheck, 429 backoff, 3h job timeout, 3 retries.

New:
- **Shared concurrency ledger** — lockfile-based `scripts/.pixellab_inflight.json` so new bursts coexist with the live F4 anim and F5 runs against the 20-job account limit. Default `--max-inflight 4` while older runs are alive; configurable.
- Stage support per job type: `create` (N candidates → review → select → download 64 variants), `state`, `anim` (animate-with-text-v3), `wang` (the `gen_all_wang.py` endpoint).
- Refuses to run a `pilot_required` burst without a recorded pilot pass; refuses `dormant` bursts outright.
- Content-hashes downloaded Wang results to detect regenerate-instead-of-reuse.

`bulk_generate_f4.py` / `bulk_generate_f5.py` keep running untouched mid-burst; the new runner takes only new bursts.

## Component 3 — W2 burst content (first compiled output)

- **Roster:** ~18 tree archetypes across forested biomes (forest, dense_forest, taiga, tropical_forest, savanna, grassland edges — oak, birch, pine, spruce, baobab, acacia, palm, willow; fruit-bearers: apple, cherry), deduped where biomes share species; declared per-biome in `f6_trees.json`.
- **States:** exactly the taxonomy F6 sheet — seedling, growing, normal, wilting, dead, cut→stump, broken→snag, burned, + budding/fruiting/harvested for fruit-bearers — at 192px. F7 canopy overlays (normal, wilting; dress later) slaved to trunk state, only for archetypes with foliage; seedling/growing emit no canopy.
- **Anim:** wind_sway on normal/flourishing states only (taxonomy: no sway on dead/stump).
- **Gate:** F6 per-biome size tuner (F4-style slider — standing rule for every new field) before the mass run; tuner built while first candidate batches queue.
- Kernel side is ready now (`tree` species, chop→stump delta proven); wiring follows the F3/F4 placement-key pattern per the W2 roadmap row.

## Component 4 — Road & elevation Wang rows

- **Roads:** each material (dirt road, cobble; extensible) × each of the 21 biome bases = one 32×32 Wang tileset per pair (~42 to start), same job shape as the existing 1,470-set transition run, using the biome's existing base-tile ID as lower terrain so road sets marry the ground they sit on.
- **Pilot:** 1 material × 3 contrasting biomes, visually checked for seamlessness against existing transitions before the matrix fires.
- **Elevation:** enumerated with counts, status `dormant` — needs its own design (cliff/ramp grammar vs. the 2026-06-05 elevation Wang variants).

## Component 5 — Debug overlay (paths/settlements planning view)

Renderer-side dev overlay (toggle key, like the tuner): translucent shapes from sim state — worn-path intensity per tile, road segments + condition, and P3 nodes as they land (settlement sites with suitability reason codes, territory, districts, plots, ownership edges). Strictly read-only over the existing SimClient feed/snapshot. Lives in its own module (`src/.../debugOverlay*`); the only collision surface with the P3 agent is a one-line hookup, kept isolated and rebase-trivial. This also satisfies the W4-row note: invisible simulation must be flagged in dev tools so emptiness isn't mistaken for absence of simulation.

## Testing & probes

- Compiler: unit tests — deterministic counts, schema-valid batch JSON, manifest-vs-registry count check.
- Runner: `--dry-run` against every emitted batch; gate enforcement tested (pilot/dormant refusal).
- W2 probe: trees visible in-game via the W2 wiring pattern; chop→stump visually verified.
- Overlay probe: headless screenshot showing path/road/settlement shapes over a live sim.

## Execution order

1. Registry + compiler (+ tests) → counts.md + W2 batch emitted
2. Generic runner (+ dry-run all batches) → fire W2 at low in-flight share (F4/F5 are saturating the account limit today; tooling time is free)
3. F6 size tuner while candidates queue
4. Debug overlay while generation drains
5. Road Wang pilot → road matrix
6. Body-part / building-piece pilots when their consuming plans approach (L2/P4)

## Out of scope

- Fixing the running F5 script's `edit-images-v2` frame error (separate triage).
- Elevation Wang generation (dormant row).
- Skeletal rigging implementation (L2/L3 own it).
- Any edit under `sim/` (P3 agent's territory).
