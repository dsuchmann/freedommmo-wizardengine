# Terrain Rendering Cleanup — Design Spec

**Date:** 2026-05-31
**Status:** Draft
**Goal:** Strip the rendering pipeline down to what works, rebuild terrain rendering using Godot-native TileMapLayer patterns that match standard 2D RPG tutorials.

## Problem Statement

The current codebase has ~1500 lines of competing rendering systems:
- **TileMapTerrainRenderer** renders base terrain via TileMapLayer `set_cell()`
- **ElevationRenderer** renders elevation as Image-based Sprite2D overlays using terrain_v3 tiles
- These use **different art assets** (v3 vs v4), **different rendering methods**, and **fight for the same screen space**
- Elevation is invisible despite code running — the Y-offset stacking approach doesn't produce visible results
- Transition tiles between surfaces are broken (manual wang computation is error-prone)
- All layers are created dynamically in code — invisible in the Godot editor Scene panel

## Design Principles

1. **Use Godot the way it was designed.** TileMapLayer nodes in the scene tree. `set_cells_terrain_connect()` for auto-tiling. Terrain sets with peering bits.
2. **One rendering system, not two.** No Image-based overlays competing with TileMapLayers.
3. **Visible in the editor.** All layers exist as nodes in the `.tscn` file. Clickable, inspectable, toggleable.
4. **Standard 2D RPG elevation.** Cliff wall tiles at elevation drops. Shading overlays. Surface changes via gradient table. No Y-offset stacking.
5. **Preserve what works.** Overmap → ChunkCompiler → ChunkStreamer pipeline untouched. terrain_v4 tilesets reused. Day/night cycle kept.

## Architecture

### Chunk Size: 16×16

Changed from 64×64. This makes `set_cells_terrain_connect()` fast (~1ms per call vs multi-second hangs at 64×64). Grid radius increases from 3 to 8 (17×17 grid = 289 chunks) to maintain the same visible area.

### Scene Tree Structure

```
CleanWorld (Node2D)
  ├── TileMap (Node2D, y_sort_enabled=false)
  │   ├── TerrainLayer    (TileMapLayer, z_index=-2)
  │   ├── CliffLayer      (TileMapLayer, z_index=-1)
  │   ├── ShadingLayer    (TileMapLayer, z_index=-1)
  │   ├── WaterLayer      (TileMapLayer, z_index=0)
  │   ├── RoadLayer       (TileMapLayer, z_index=2)
  │   ├── BuildingLayer   (TileMapLayer, z_index=3)
  │   └── RoofLayer       (TileMapLayer, z_index=8)
  ├── Player (CharacterBody2D)
  │   └── Camera2D
  ├── DayNightCycle
  └── UI (CanvasLayer)
```

All TileMapLayer nodes share a single TileSet resource built by TerrainTilesetBuilder at startup. The TileMap parent node exists for organizational grouping — it is NOT a TileMap node, just a Node2D.

These nodes are defined in the `.tscn` file (visible in editor). The TileSet is assigned programmatically at startup since it's built from terrain_v4 assets.

### Layer Definitions

| Layer | z_index | Content | Populated By |
|-------|---------|---------|-------------|
| TerrainLayer | -2 | Base biome tiles (lush_grass, golden_sand, etc.) with auto-tiled transitions | `set_cells_terrain_connect()` per terrain_id |
| CliffLayer | -1 | Cliff face tiles at elevation tier boundaries | Manual `set_cell()` at tier drops ≥ 2 |
| ShadingLayer | -1 | Semi-transparent dark/light overlays for hillshade | Manual `set_cell()` based on slope/elevation |
| WaterLayer | 0 | Ocean, river, lake tiles | `set_cells_terrain_connect()` for water terrain |
| RoadLayer | 2 | Dirt/cobblestone road tiles | Manual `set_cell()` from road_cells |
| BuildingLayer | 3 | Wall, floor, door tiles | Manual `set_cell()` from building_tiles |
| RoofLayer | 8 | Roof canopy (alpha-fades when player enters) | Manual `set_cell()` from structure bounds |

### Terrain Rendering Flow

```
ChunkData compiled (elevation, biome, ocean)
    │
    ▼
ElevationGradientTable.surface_at(biome, elevation) → surface_id per tile
    │
    ▼
Group tiles by terrain_id (from TerrainTilesetBuilder)
    │
    ▼
For each terrain_id:
    set_cells_terrain_connect(cells, 0, terrain_id)
    │
    ▼
Godot auto-selects correct tile from:
  - Self-tilesets (13 surfaces: lush_grass, snow, etc.)
  - Transition tilesets (19 pairs: golden_sand↔lush_grass, etc.)
  - Void-edge tilesets (12 surfaces: for cliff edges)
  using peering bits configured in TerrainTilesetBuilder
```

### Elevation Visualization

Elevation is shown through THREE visual cues (standard 2D RPG approach):

1. **Surface changes** — The gradient table maps higher elevation to different surfaces (grassland: lush_grass → dry_grass → grey_rock → snow). This already works.

2. **Cliff wall tiles** — On the CliffLayer, cliff face tiles are placed where elevation drops ≥ 2 tiers. Uses solid brown/dark cliff tiles from `_add_shading_and_cliff_sources()`. Only at sustained boundaries (≥3 of 5 horizontal neighbors must also have a cliff drop — filters noise).

3. **Shading overlay** — On the ShadingLayer, semi-transparent tiles darken valleys and NW-facing slopes. Subtle but adds depth perception.

No Y-offset stacking. No overlapping Sprite2D images. No separate elevation renderer.

### Elevation Tier System

```
TIER_THRESHOLDS = [0.38, 0.50, 0.62, 0.75]  (4 tiers)
```

Cliff walls render where a tile's tier is ≥2 lower than its north neighbor's tier. This produces cliffs at major elevation changes while ignoring gentle slopes.

## Systems Removed

| System | File(s) | Reason |
|--------|---------|--------|
| ElevationRenderer | `elevation_renderer.gd` | Image-based Y-offset stacking. Incompatible with TileMapLayer. |
| LayeredChunkRenderer | `layered_chunk_renderer.gd` | Wrapper for ElevationRenderer. |
| LayeredTilesetLoader | `layered_tileset_loader.gd` | Loads terrain_v3 only used by ElevationRenderer. |
| SurfaceLayerCompositor | `surface_layer_compositor.gd` | Disabled ground cover. Premature. |
| CliffTileLoader | `cliff_tile_loader.gd` | Loads cliff tiles for ElevationRenderer. |
| DeferredRenderer | `deferred_renderer.gd` | Legacy Image renderer. Dead. |
| TilesetRenderer | `tileset_renderer.gd` | Legacy wang renderer. Dead. |
| Mode7Ground | `scripts/visual/Mode7Ground.gd` | Experimental. Dead. |
| SpriteStack | `scripts/visual/SpriteStack.gd` | Experimental. Dead. |
| OccluderLoader | `scripts/visual/OccluderLoader.gd` | Experimental. Dead. |

Legacy code paths in TileMapTerrainRenderer (~500 lines: `build_chunk_image`, `display_chunk_image`, wang tile cache, biome pairs, normal map shader) are also removed.

Legacy wiring in ChunkStreamer (~100 lines: `_layered_renderer`, shadow thread, `build_chunk_image_with_normals` C++ path) is removed.

Legacy wiring in CleanWorld.gd (~20 lines: `_layered_renderer` setup, shadow position updates) is removed.

## Systems Kept (Unchanged)

| System | File |
|--------|------|
| OvermapGenerator | `overmap_generator.gd` |
| WorldCompiler + all layers | `world_compiler.gd` + layer scripts |
| NativeChunkCompiler | C++ GDExtension |
| ChunkData | `chunk_data.gd` (SIZE changes to 16) |
| ElevationGradientTable | `elevation_gradient_table.gd` |
| TerrainTilesetBuilder | `terrain_tileset_builder.gd` |
| Day/Night cycle | `day_night_cycle.gd` |
| terrain_v4 assets | `assets/catalog/terrain_v4/` |
| PlacementEngine + ObjectRenderer | Kept but disabled until terrain is solid |

## TileMapTerrainRenderer (Rebuilt)

The new renderer is ~150 lines total:

```gdscript
class_name TileMapTerrainRenderer

var _tileset: TileSet
var _terrain_builder: TerrainTilesetBuilder
var _layers: Dictionary  # "terrain" -> TileMapLayer node reference

func setup(tilemap_parent: Node2D) -> void:
    # Build TileSet from terrain_v4 assets
    ElevationGradientTable.load()
    _terrain_builder = TerrainTilesetBuilder.new()
    _tileset = _terrain_builder.build(32)
    _add_shading_and_cliff_sources()
    # Assign TileSet to all layers (found by name in scene tree)
    _layers = {
        "terrain": tilemap_parent.get_node("TerrainLayer"),
        "cliff": tilemap_parent.get_node("CliffLayer"),
        "shading": tilemap_parent.get_node("ShadingLayer"),
        "water": tilemap_parent.get_node("WaterLayer"),
        "road": tilemap_parent.get_node("RoadLayer"),
        "building": tilemap_parent.get_node("BuildingLayer"),
        "roof": tilemap_parent.get_node("RoofLayer"),
    }
    for layer in _layers.values():
        layer.tile_set = _tileset

func render_chunk(chunk: ChunkData) -> void:
    var ox = chunk.chunk_x * ChunkData.SIZE
    var oy = chunk.chunk_y * ChunkData.SIZE
    _render_terrain(chunk, ox, oy)
    _render_cliffs(chunk, ox, oy)
    _render_shading(chunk, ox, oy)

func clear_chunk(chunk_x: int, chunk_y: int) -> void:
    # Erase all cells in chunk bounds from all layers
    ...
```

No legacy paths. No toggles. No Image blitting. No wang cache.

## ChunkStreamer (Simplified)

```gdscript
const GRID_RADIUS: int = 8  # 17x17 grid of 16x16 chunks

func _process_load_queue():
    # Compile chunk → render_chunk() → done
    # No layered_renderer, no shadow thread, no legacy image path
```

## Future Work (NOT in this spec)

These are deferred to future specs and will build ON TOP of the clean foundation:

- **Object rendering** (trees, bushes, rocks) — PlacementEngine + TerrainObjectRenderer, re-enabled once terrain is solid
- **Ground cover stacks** (100% coverage grass/debris/flora per the biome layer stack spec) — requires texture overlay shader or dense object placement
- **Building spatial rendering** — walls/floors/doors as tile structures
- **Collision/walkability** — physics layers on tiles
- **Water animation** — animated tile frames
- **Transition tileset generation** — filling gaps in the 19 existing transition pairs

## Success Criteria

1. Game loads in < 3 seconds
2. Terrain shows correct surface per biome+elevation with smooth auto-tiled transitions
3. Cliff wall tiles visible at major elevation drops
4. Shading overlay visible (darker valleys, lighter ridges)
5. All layers visible in Godot editor Scene panel
6. No competing rendering systems — one clean pipeline
7. ~1500 lines of code removed
