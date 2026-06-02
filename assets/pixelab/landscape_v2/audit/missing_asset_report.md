# Missing Asset Report — Swamp Calibration Batch

Generated: 2026-06-01

## Summary

| Layer | Family | Exists | Quality | Action |
|-------|--------|--------|---------|--------|
| Base | swamp Wang (catalog) | YES | LOW (2-18 colors, flat fill) | REPLACE |
| Base | swamp_wet_mud (v2) | NO | — | GENERATE |
| Base | swamp_mud_pool (v2) | NO | — | GENERATE |
| Surface | mud_pool | NO | — | GENERATE |
| Surface | wet_mud_shine | NO | — | GENERATE |
| Surface | algae_film | NO | — | GENERATE |
| Micro | dark_mud_flecks | NO | — | GENERATE |
| Micro | moss_ground_cover | NO | — | GENERATE |
| Micro | reeds_grass_blades | NO | — | GENERATE |
| Medium | reeds | NO | — | GENERATE |
| Medium | cattails | NO | — | GENERATE |
| Medium | root_cluster | NO | — | GENERATE |
| Medium | moss_clump | NO | — | GENERATE |
| Object | forage_bush_swamp | NO | — | GENERATE |
| Object | swamp_tree | NO | — | GENERATE |
| Object | reed_harvest_node | NO | — | GENERATE |
| Transition | shallow_water → swamp | NO | — | GENERATE (CRITICAL) |
| Transition | river → swamp | NO | — | GENERATE (CRITICAL) |
| Transition | forest_floor → swamp | PARTIAL (catalog has swamp_to_forest) | UNKNOWN | AUDIT then GENERATE |

## Existing Swamp Assets — Quality Issues

### `assets/catalog/terrain/swamp/` (16 Wang masks + tileset)

- **Status:** Exists but LOW quality
- **Problem:** 2-18 unique colors per 32x32 tile. `wang_15` is essentially a 2-color solid fill (280 bytes).
- **Color issue:** Average RGB is very dark blue-teal (5-18, 15-54, 43-46). Does not read as "wet mud" — reads as dark abstract fill.
- **Recommendation:** Keep as fallback but generate replacement with:
  - 50+ unique colors per tile
  - Visible organic mud texture
  - Color palette aligned with biome-definitions.js swamp color `#42694a`
  - Natural variation between masks

### `assets/catalog/terrain/swamp_to_forest/` and `swamp_to_grass/`

- **Status:** Exist (16 Wang masks + tileset each)
- **Quality:** Not yet audited visually. File sizes suggest similar flat quality.
- **Note:** These go in the OPPOSITE direction from our v2 naming. Catalog uses `swamp_to_X`, manifest uses `X__to__swamp`. The Wang mask interpretation might need to be flipped.

## Critical Water Gaps

No water body transitions exist for swamp:

1. **shallow_water ↔ swamp_wet_mud** — MISSING. This is the most important water-swamp edge.
2. **river ↔ swamp_wet_mud** — MISSING. Rivers flow into/out of swamps.
3. **lake ↔ swamp** — MISSING. Not in current batch but needed soon.

The catalog has `ocean_to_beach` and `ocean_to_grassland` transitions, but NO river/lake/shallow_water transition sets at all.

## Nature Objects — Partial Coverage

The catalog has generic nature objects under `assets/catalog/objects/nature/`:
- `lily_pads/` — could serve as swamp surface overlay
- `fallen_logs/` — some mossy variants exist
- `bushes/`, `ferns/`, `grass/` — generic, not swamp-biome-specific

None of these are swamp-tagged or layer-contract-aligned. They may be reusable as temporary placeholders but should not be the final swamp assets.

## Generation Priority Order

1. **Base Wang tiles:** swamp_wet_mud (16 masks) — foundational
2. **Base Wang tiles:** swamp_mud_pool (16 masks) — secondary base
3. **Transition Wang:** shallow_water → swamp (16 masks) — critical water edge
4. **Transition Wang:** river → swamp (16 masks) — critical water edge
5. **Surface overlays:** mud_pool, wet_mud_shine, algae_film (8 each) — visual richness
6. **Micro decals:** dark_mud_flecks, moss_ground_cover, reeds_grass_blades (8 each) — ecological detail
7. **Medium dressing:** reeds, cattails, root_cluster, moss_clump (8 each) — sparse dressing
8. **Objects:** forage_bush, swamp_tree, reed_harvest_node (4 each) — gameplay interactables
9. **Transition Wang:** forest_floor → swamp (16 masks) — lower priority

## What PixelLab API To Use Per Layer

| Layer | PixelLab Tool | Size | Notes |
|-------|--------------|------|-------|
| Base Wang | `create_topdown_tileset` | 32x32 per tile | 16-tile Wang set |
| Transition Wang | `create_topdown_tileset` | 32x32 per tile | 16-tile transition set |
| Surface overlay | `create_tiles_pro` | 32x32 | Transparent decals |
| Micro decal | `create_tiles_pro` | 8-16px | Small transparent marks |
| Medium sprite | `create_map_object` | 32-64px | Transparent dressing |
| Object sprite | `create_map_object` | 32-96px | Interactable objects |
