# Elevation Hypergraph Terrain System

**Date:** 2026-05-27
**Status:** Approved
**Scope:** Replace flat biome-based tile selection with elevation-driven surface gradients and hypergraph transitions.

## Problem

The current terrain renderer picks one tileset per biome and tiles it flat. A grassland biome looks the same at elevation 0.35 as it does at 0.70. Mountains are a distinct biome rather than the natural result of high elevation within any biome. Biome transitions happen abruptly at classification boundaries rather than flowing naturally with the landscape.

## Core Concept: Elevation Gradients + Surface Hypergraph

Each biome defines an **elevation gradient** — an ordered list of surfaces that appear as elevation increases. A **surface** is a distinct terrain appearance (e.g., "lush green grass," "grey mountain stone," "snow"). Surfaces are shared across biomes, forming a many-to-many **hypergraph**: the same "grey rock" surface appears in grassland's gradient at high elevation and in tundra's gradient at mid elevation.

At each tile, elevation at the 4 corners determines which surface(s) appear. When adjacent corners cross an elevation threshold, a Wang transition tileset blends between the two surfaces. This uses the exact same 16-tile Wang autotiling infrastructure that already exists.

## Surfaces (Hypergraph Nodes)

13 unique terrain surfaces, each backed by a 16-tile Wang self-tileset:

| Surface ID | Description | Source |
|---|---|---|
| `ocean_water` | Blue water with gentle waves | Existing L1: ocean |
| `golden_sand` | Sandy beach/desert surface | Existing L1: beach, desert |
| `lush_grass` | Green grass with individual blades | Existing L1: grassland |
| `dry_grass` | Windswept sparse grass on rocky soil | Existing L1: steppe |
| `forest_floor` | Dark earth with leaves, moss, twigs | Existing L1: forest |
| `dark_humus` | Very dark decomposing leaf carpet | Existing L1: dense_forest |
| `swamp_mud` | Murky mud with standing water | Existing L1: swamp |
| `grey_rock` | Mountain stone with moss, mineral veins | Existing L1: mountains |
| `volcanic_rock` | Dark rock with glowing lava cracks | Existing L1: volcanic |
| `frozen_earth` | Permafrost tundra soil | Existing L1: tundra |
| `glacial_ice` | Blue-white ice with pressure cracks | Existing L1: arctic |
| `snow` | White snow cover | Existing L1: mountains (upper variant) |
| `mystic_crystal` | Purple glowing crystal floor | Existing L1: mystic |

All 13 surfaces already exist as L1 base tilesets in `assets/catalog/terrain_v2/`. They need to be reorganized into a `surfaces/` directory but no regeneration is required.

## Transitions (Hypergraph Edges)

Transition tilesets are needed between any two surfaces that are adjacent in at least one biome's elevation gradient, or across biome boundaries. Each is a standard 16-tile Wang tileset generated via PixelLab with `base_tile_id` chaining.

### Required transitions (~20 pairs):

**Elevation transitions (within biomes):**
- `ocean_water` ↔ `golden_sand` (shoreline) — EXISTS
- `golden_sand` ↔ `lush_grass` (beach→inland) — EXISTS
- `lush_grass` ↔ `dry_grass` (lowland→hills)
- `lush_grass` ↔ `forest_floor` (grassland→forest edge) — EXISTS
- `dry_grass` ↔ `grey_rock` (foothills→mountains)
- `grey_rock` ↔ `snow` (high altitude)
- `forest_floor` ↔ `grey_rock` (treeline)
- `forest_floor` ↔ `dark_humus` (forest→deep forest) — EXISTS
- `frozen_earth` ↔ `snow` (tundra→peaks)
- `glacial_ice` ↔ `snow` (arctic variation)
- `golden_sand` ↔ `dry_grass` (desert→scrubland) — EXISTS (desert_to_savanna)
- `volcanic_rock` ↔ `grey_rock` (volcanic→normal rock)
- `swamp_mud` ↔ `lush_grass` (swamp edge)
- `swamp_mud` ↔ `forest_floor` (swamp→forest)

**Cross-biome transitions (at biome boundaries):**
- `lush_grass` ↔ `golden_sand` (grassland↔desert boundary) — EXISTS
- `lush_grass` ↔ `frozen_earth` (temperate↔tundra)
- `dry_grass` ↔ `golden_sand` (steppe↔desert)
- `forest_floor` ↔ `frozen_earth` (taiga transition)
- `mystic_crystal` ↔ `grey_rock` (mystic boundary)

Of these ~20 pairs, 6 already exist from the transition tileset generation this session. ~14 need to be generated.

## Biome Elevation Gradients

Each biome defines its gradient as an array of `{max_elevation, surface_id}` entries. All biomes converge to `snow` at peak elevations and `ocean_water` at sea level.

```
grassland:
  0.38: ocean_water
  0.42: golden_sand
  0.55: lush_grass
  0.70: dry_grass
  0.82: grey_rock
  1.00: snow

desert:
  0.38: ocean_water
  0.42: golden_sand
  0.60: golden_sand
  0.75: dry_grass
  0.85: grey_rock
  1.00: snow

forest:
  0.38: ocean_water
  0.42: golden_sand
  0.48: lush_grass
  0.65: forest_floor
  0.80: grey_rock
  1.00: snow

dense_forest:
  0.38: ocean_water
  0.42: golden_sand
  0.46: lush_grass
  0.55: forest_floor
  0.70: dark_humus
  0.82: grey_rock
  1.00: snow

tundra:
  0.38: ocean_water
  0.42: frozen_earth
  0.65: frozen_earth
  0.80: snow
  1.00: glacial_ice

arctic:
  0.38: ocean_water
  0.42: frozen_earth
  0.55: snow
  0.75: glacial_ice
  1.00: glacial_ice

taiga:
  0.38: ocean_water
  0.42: frozen_earth
  0.50: forest_floor
  0.70: frozen_earth
  0.85: snow
  1.00: glacial_ice

mountains:
  0.38: ocean_water
  0.42: golden_sand
  0.50: dry_grass
  0.65: grey_rock
  0.85: snow
  1.00: glacial_ice

steppe:
  0.38: ocean_water
  0.42: golden_sand
  0.55: dry_grass
  0.72: grey_rock
  0.88: snow
  1.00: snow

savanna:
  0.38: ocean_water
  0.42: golden_sand
  0.55: dry_grass
  0.70: golden_sand
  0.82: grey_rock
  1.00: snow

tropical_forest:
  0.38: ocean_water
  0.42: golden_sand
  0.48: lush_grass
  0.60: forest_floor
  0.72: dark_humus
  0.85: grey_rock
  1.00: snow

swamp:
  0.38: ocean_water
  0.42: swamp_mud
  0.55: swamp_mud
  0.65: forest_floor
  0.80: grey_rock
  1.00: snow

volcanic:
  0.38: ocean_water
  0.42: golden_sand
  0.55: volcanic_rock
  0.75: grey_rock
  0.88: snow
  1.00: snow

mystic:
  0.38: ocean_water
  0.42: mystic_crystal
  0.60: mystic_crystal
  0.75: grey_rock
  0.90: snow
  1.00: glacial_ice

ocean:
  1.00: ocean_water

beach:
  0.38: ocean_water
  0.44: golden_sand
  1.00: golden_sand

lake:
  1.00: ocean_water

river:
  1.00: ocean_water
```

## Wang Index Computation

For each tile at (x, y):

1. Sample elevation at 4 corners: TL(x,y), TR(x+1,y), BL(x,y+1), BR(x+1,y+1)
2. Look up biome at tile center from `chunk.biome_id`
3. Map each corner's elevation through the biome's gradient to get a surface
4. If all 4 corners → same surface: use self-tileset, wang_index from spatial hash
5. If corners span 2 surfaces: use transition tileset, wang_index from corner classification (4-bit: TL=bit0, TR=bit1, BL=bit2, BR=bit3, where 0=lower surface, 1=upper surface)
6. If corners span 3+ surfaces: clamp to the 2 most common surfaces

Cross-chunk corner sampling: when a corner falls outside the current chunk, look up elevation from the adjacent chunk via the chunk dictionary (already supported by ChunkStreamer).

## Architecture

### New Components

**`ElevationGradientTable`** — Static data class (GDScript). Holds all biome gradient definitions and the surface→tileset directory mappings. Loaded once at startup. Pure data, no logic.

**`HypergraphTileResolver`** — Given tile position, biome, and 4 corner elevations, returns `{surface_or_pair, wang_index, tileset_path}`. Handles self-tile vs transition vs cross-biome cases. Stateless — all inputs passed in, no side effects.

### Modified Components

**`LayeredChunkRenderer`** — Replace `_compute_wang_index` stub and `_build_layer_image` with calls to `HypergraphTileResolver`. Tile lookup changes from `biome_name + layer_name` to `surface_id` or `surface_pair`.

**`LayeredTilesetLoader`** — Change from biome/layer directory structure to surface-based: `surfaces/{surface_id}/wang_*.png` for self-tilesets, `transitions/{lower}_{upper}/wang_*.png` for transitions.

### Unchanged Components

- `NativeChunkCompiler` (C++) — still produces elevation, biome_id, normals
- `ChunkStreamer` — still streams 7×7 grid, still emits `chunk_loaded`
- `TileMapTerrainRenderer` — old renderer stays at z_index=-2 as fallback
- `DayNightCycle`, lighting, overmap — all unchanged

## Asset Directory Structure

```
assets/catalog/terrain_v3/
  surfaces/
    ocean_water/
      wang_0.png ... wang_15.png
      manifest.json
    lush_grass/
      wang_0.png ... wang_15.png
      manifest.json
    ...
  transitions/
    ocean_water__golden_sand/
      wang_0.png ... wang_15.png
      manifest.json
    lush_grass__dry_grass/
      wang_0.png ... wang_15.png
      manifest.json
    ...
  gradients.json    # All biome gradient definitions
```

The terrain_v2 L1 base tilesets are copied/renamed into `surfaces/`. Existing transition tilesets are copied into `transitions/`. New transitions are generated via PixelLab.

## Future: C++ Migration

Once all biome gradients are finalized and visually approved, port `HypergraphTileResolver` logic into `native_chunk_compiler.cpp`. The C++ compiler would output surface_id per tile (instead of biome_id) and compute Wang indices from elevation corners during `build_chunk_image`. This eliminates the GDScript overlay renderer entirely.

**Trigger condition:** All 18 biome gradients look correct in-game AND all transition tilesets are generated and quality-approved.

## Asset Generation Summary

| Category | Count | Status |
|---|---|---|
| Surface self-tilesets | 13 | All exist (rename from L1 bases) |
| Transition tilesets | ~20 | 6 exist, ~14 to generate |
| Biome gradients | 18 | Define in gradients.json |
| Total tiles | ~528 | ~208 self + ~320 transition |
