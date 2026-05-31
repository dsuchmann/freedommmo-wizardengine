# PixelLab Object Audit Plan

## Status: IN PROGRESS

## Task
Audit all ~3,023 objects in PixelLab account. Download, review, organize, or delete every one.

## Rules (from user, non-negotiable)
1. Use `create_1_direction_object` for batches (64 at 32px, 16 at 64px)
2. Every object must be: correct perspective (top-down), no embedded shadows, proportional size, consistent art style
3. Trees ≠ same size as flowers. Trees=64-96px, bushes=32-48px, flowers/grass/pebbles=32px
4. Track everything: generated, pending, left in queue, what's next
5. Objects need correct IDs for animation and variant creation
6. Store at `assets/catalog/terrain_objects/{category}/{object_id}/variants/v{N}/base.png`

## Object Categories from Biome Affinities (146 objects, 439 variants needed)
Source: `data/terrain_objects/affinities/*.json`

### High Priority (4 variants each)
- sheet_ice, fresh_snow, wind_sand_drift, oak_tree, tall_grass, short_grass
- lake_ripple, granite_boulder, ocean_wave, river_current
- pine_tree, spruce_tree, jungle_tree, volcanic_rock

### Medium Priority (3 variants each)
- packed_snow, melting_snow, frost_pattern, icicle, ice_patch
- crystal_cluster, pebble, mossy_boulder, dead_tree

### Standard (1-2 variants)
- All remaining biome-referenced objects (~115 types)

## Script-Generated Objects (~2,500+)
These were created by the broken `pixellab_runner.py` using the `/v2/` API without style params.
- Likely inconsistent art styles, wrong perspectives, embedded shadows
- Most should be DELETED or IGNORED
- Some may be usable — need visual review

## MCP-Generated Objects (~150)
Created via `create_map_object` with correct style params.
- Already downloaded to disk (~145 sprites)
- Need organization into correct paths

## Batch Review Objects (10 pending)
Created via `create_1_direction_object` — 64 or 16 candidates each.
- grass, wildflower, pebble, fern, bush, snow, mushroom (64 candidates each)
- pine, oak, boulder (16 candidates each)
- User selects best variants in PixelLab UI
- Then download selected frames via `select_object_frames`

## Next Steps
1. List all objects, categorize by source (script vs MCP vs batch)
2. Delete script-generated garbage
3. Review batch candidates, select best
4. Download and organize selected
5. Generate remaining objects from biome affinity list
6. Continue until 439 variants complete
