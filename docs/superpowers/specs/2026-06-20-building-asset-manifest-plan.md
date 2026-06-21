# Building Asset Manifest — Implementation Plan & Generation Runbook

**Date:** 2026-06-20
**Design:** `2026-06-20-building-asset-manifest-design.md`
**Status:** pre-generation work COMPLETE; generation + integration pending (run together)

## What is already done (this session)

| Artifact | Path | State |
|---|---|---|
| Design spec | `docs/superpowers/specs/2026-06-20-building-asset-manifest-design.md` | ✅ written |
| Material vocabulary (168) | `assets/pixelab/buildings/manifest/building-materials.json` | ✅ 21 biomes × (4 wall + 4 roof), generation-ready prompts |
| JS registry (game-side) | `sim/world/buildings/building-material-registry.js` | ✅ auto-generated, `node --check` clean |
| Generation pipeline | `scripts/bulk_generate_buildings.py` | ✅ `--dry-run` validates **5,040 tasks** (168 base + 4,200 edit + 672 anim) |
| Vocabulary assembler | `scripts/_assemble_building_materials.py` | ✅ regenerates JSON + registry from the workflow output |

Nothing is committed yet, and **no PixelLab assets have been generated** (per instruction — we run generation together).

## Phase 1 — Pilot (do FIRST, together)

CLAUDE.md gate: "composable assets need pilots." Prove one biome end-to-end before the ~5,000-call burst.

```bash
# 1. Confirm credits + key, then generate ONE biome's full set (4 walls + 4 roofs, all pieces):
python scripts/bulk_generate_buildings.py --biome grassland
# ~240 tasks ≈ 20-40 min. Watch _buildings_run.log.

# 2. Check progress any time:
python scripts/bulk_generate_buildings.py --status
```

**Verify on the pilot output (the empirical decisions deferred from the spec):**
1. **Tileability** — does `south_base__normal` repeat horizontally and stack vertically without seams?
2. **Crop geometry** — PixelLab returns square (128×128 walls, 64×64 roofs). Confirm the square→target crop. If the wall face doesn't fill the frame correctly, tune `PIECE_SPEC` in `bulk_generate_buildings.py` (gen_size / view) and/or enable a PIL crop step. Decide square-then-crop vs. `create_map_object` (native non-square) here.
3. **Door proportion** — does the 64×128 door read as a floor-to-near-ceiling (3-tile) opening the ~80px player can walk through?
4. **Roof distinctness** — does `roof_top` read as a roof, clearly different from the grassland ground (`lush_grass`)?
5. **Wear legibility** — are `weathered/damaged/mossy` distinguishable at tile scale?
6. **Door anim** — do the 9 `anim/door_open/` frames form a clean open→close (and reversed)?

Iterate the prompt templates / PIECE_SPEC until grassland looks right. **Only then** proceed.

## Phase 2 — Mass generation

```bash
python scripts/bulk_generate_buildings.py            # full 5,040-task matrix, resumable
```

- Resumable: re-run any time; valid PNGs on disk are never redone; in-flight jobs tracked in `_buildings_state.json`.
- Throttle/phases if the account's 20-job cap is contended:
  - `--phase base` (168 roots), then `--phase states`, `--phase doors`, `--phase anims`, `--phase roof`.
  - or `--biome <id>` to go biome-by-biome.
- Credits guard auto-pauses below $3 and resumes on top-up.
- Budget: ~8-9 h pure API, ~12-16 h realistic ("a day or two").

## Phase 3 — Integration (after assets exist)

All of this is **post-generation** and must route world content through GL (CLAUDE.md non-negotiable). Each step is independently shippable.

1. **Loader (non-breaking, fallback-first)** — extend the wall/floor loader (`src/render/building-renderer.js` `ensureFloorImages`, and the GL interior loader) to resolve `walls/{biome}/{material}/{piece}` via `building-material-registry.js` (`wallAssetDir`, `wallPieceFile`). Fall back to `stone_brick_tiles/` when a biome's assets are absent (honest absence). Ship behind a flag first.
2. **Biome→material assignment** — each building deterministically picks one of its biome's 4 wall + 4 roof materials via `pickMaterial(wallsForBiome(biome), hash(buildingId))`. Later the world-compiler "culture fingerprint" can bias this. Store the choice on the resolved building so renderer + interior agree.
3. **Renderer sub-rect / crop** — update the `drawImage(..., 0,0,64,128, ...)` source rects to match the pilot-confirmed crop geometry for windows/doors (they're 2-tile-wide). This is the one renderer change the new asset dims force.
4. **Wear** — building condition (chronicle age/damage) selects the wear suffix; missing wear → `normal` + GL darken/desaturate.
5. **Doors** — closed/open sprite swap + `doorAnimFrame()` clip on player proximity/entry; ties into the diegetic walk-in.
6. **Roof texture swap** — feed `roof/{biome}/{material}/roof_top__v00x` (+ `roof_fascia`) into the existing roof interpolation, replacing the soil texture source. **Keep** the procedural roof shape/role system; bake the texture sample through GL (`worker-chunk-renderer.js`-style), retiring the main-thread procedural roof texture as tech debt.

## Regenerating the vocabulary

If you want to revise materials (rename, re-prompt, add a 5th, etc.), edit `building-materials.json` directly, or re-run the authoring workflow and re-assemble:

```bash
python scripts/_assemble_building_materials.py <workflow_output.json>   # rewrites JSON + registry
```

The registry JS is always derived — never hand-edit it.

## Risks / open items

- **Crop geometry** is the one real unknown — resolved empirically at the pilot (Phase 1, item 2). The manifest is generation-method-agnostic so this won't require re-authoring.
- **Interior "sandwich"** is currently derived from the exterior via an edit ("interior face of this wall"). If you want a genuinely different interior *material* (stone-out / wood-in), the pilot is where to judge whether the edit reads as a distinct inner material or whether interiors need their own base generation. (Cost is already budgeted per-exterior either way.)
- **Account job cap (20)** is shared with other PixelLab workers; `MAX_INFLIGHT=10` leaves headroom. Drop it if contention shows up as 429s in the log.
