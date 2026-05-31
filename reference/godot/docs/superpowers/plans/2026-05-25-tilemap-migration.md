# TileMapLayer Migration — Replace Custom Renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken custom Image-based DeferredRenderer with Godot-native TileMapLayer stack + BetterTerrain autotiling, producing CrossCode-quality terrain rendering.

**Architecture:** 7 TileMapLayer nodes stacked by z-index, each using the same TileSet resource. BetterTerrain plugin handles autotile transitions. World compiler chunks feed biome data into `BetterTerrain.set_cells()` + `update_terrain_area()`. Objects (trees, decorations) remain as Sprite2D nodes with consistent sizing and biome-appropriate placement.

**Tech Stack:** Godot 4.4 TileMapLayer, BetterTerrain plugin (already installed), PixelLab Wang tilesets (already generated), GDScript

---

### Task 1: Create TileSet Resource with Terrain Sources

**Files:**
- Create: `resources/terrain_tileset.tres` (via editor script)
- Create: `scripts/core/world_compiler/tilemap_terrain_renderer.gd`

- [ ] **Step 1: Create the TileSet resource via editor script**

Use Godot MCP `execute_editor_script` to create a TileSet resource programmatically. Load all existing Wang tileset PNGs from `assets/catalog/terrain/` as TileSetAtlasSource entries.

Each biome's wang_0.png (base tile) becomes an atlas source. The 32x32 tile size matches our existing assets.

```gdscript
# Editor script to create TileSet
var ts = TileSet.new()
ts.tile_size = Vector2i(32, 32)
ts.tile_shape = TileSet.TILE_SHAPE_SQUARE

# Add each biome's base tile as an atlas source
var biome_dirs = ["grassland", "ocean", "desert", "mountains", "tundra", "swamp", "volcanic", "forest"]
var source_id = 0
for biome in biome_dirs:
    var path = "res://assets/catalog/terrain/%s/wang_0.png" % biome
    var tex = load(path)
    if tex:
        var source = TileSetAtlasSource.new()
        source.texture = tex
        source.texture_region_size = Vector2i(32, 32)
        ts.add_source(source, source_id)
        source_id += 1

ResourceSaver.save(ts, "res://resources/terrain_tileset.tres")
```

- [ ] **Step 2: Register BetterTerrain types for each biome**

```gdscript
# For each biome, register a BetterTerrain terrain type
var biomes = ["ocean", "beach", "grassland", "forest", "desert", "savanna", "tundra", "mountains", "swamp", "volcanic", "lake", "river"]
for i in range(biomes.size()):
    BetterTerrain.add_terrain(ts, biomes[i], BiomeLayer.biome_color(i), BetterTerrain.TerrainType.MATCH_TILES)
```

- [ ] **Step 3: Commit**

```bash
git add resources/ scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: TileSet resource with BetterTerrain biome types"
```

### Task 2: Create TileMapTerrainRenderer Class

**Files:**
- Create: `scripts/core/world_compiler/tilemap_terrain_renderer.gd`

- [ ] **Step 1: Write the new renderer class**

This class replaces DeferredRenderer's terrain painting. It creates 7 TileMapLayer nodes and populates them from ChunkData.

```gdscript
class_name TileMapTerrainRenderer
extends Node

var _tileset: TileSet
var _terrain_layer: TileMapLayer
var _water_layer: TileMapLayer
var _path_layer: TileMapLayer
var _building_layer: TileMapLayer
var _roof_layer: TileMapLayer
var _parent: Node2D

func setup(parent: Node2D) -> void:
    _parent = parent
    _tileset = load("res://resources/terrain_tileset.tres")
    if _tileset == null:
        push_error("TileMapTerrainRenderer: Failed to load tileset")
        return
    _create_layers()

func _create_layers() -> void:
    # Each visual domain = one TileMapLayer
    _terrain_layer = _make_layer("TerrainLayer", -2)
    _water_layer = _make_layer("WaterLayer", 0)
    _path_layer = _make_layer("PathLayer", 2)
    _building_layer = _make_layer("BuildingLayer", 3)
    _roof_layer = _make_layer("RoofLayer", 6)

func _make_layer(layer_name: String, z: int) -> TileMapLayer:
    var layer = TileMapLayer.new()
    layer.name = layer_name
    layer.tile_set = _tileset
    layer.z_index = z
    layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
    _parent.add_child(layer)
    return layer

func render_chunk(chunk: ChunkData) -> void:
    var ox = chunk.chunk_x * ChunkData.SIZE
    var oy = chunk.chunk_y * ChunkData.SIZE
    _render_terrain(chunk, ox, oy)
    _render_water(chunk, ox, oy)
    _render_paths(chunk, ox, oy)
    _render_buildings(chunk, ox, oy)
    _render_roofs(chunk, ox, oy)
```

- [ ] **Step 2: Implement `_render_terrain` using BetterTerrain**

```gdscript
func _render_terrain(chunk: ChunkData, ox: int, oy: int) -> void:
    var cells_by_terrain = {}
    for y in range(ChunkData.SIZE):
        for x in range(ChunkData.SIZE):
            var biome = chunk.get_biome(x, y)
            var terrain_idx = _biome_to_terrain(biome)
            if not cells_by_terrain.has(terrain_idx):
                cells_by_terrain[terrain_idx] = []
            cells_by_terrain[terrain_idx].append(Vector2i(ox + x, oy + y))
    # Set cells per terrain type, then autotile
    for terrain_idx in cells_by_terrain:
        BetterTerrain.set_cells(_terrain_layer, cells_by_terrain[terrain_idx], terrain_idx)
    BetterTerrain.update_terrain_area(_terrain_layer, Rect2i(ox, oy, ChunkData.SIZE, ChunkData.SIZE))
```

- [ ] **Step 3: Implement water, paths, buildings, roofs renderers**

Each follows the same pattern: read from ChunkData dictionaries, set cells on the appropriate TileMapLayer.

- [ ] **Step 4: Commit**

### Task 3: Fix Perlin Noise for Organic Biome Shapes

**Files:**
- Modify: `scripts/core/world_compiler/layers/biome_layer.gd`
- Modify: `scripts/core/world_compiler/layers/elevation_layer.gd`

- [ ] **Step 1: Increase octave count and adjust frequency**

The current Perlin noise produces rectangular biome blocks because the frequency is too low and octave count too small. Fix by:
- Increasing octaves from 4 to 6-8
- Adding domain warping (offset noise coordinates by another noise sample)
- Using smaller base frequency for larger, more organic biome regions

```gdscript
# Domain warping for organic shapes
var warp_noise = FastNoiseLite.new()
warp_noise.seed = seed + 999
warp_noise.frequency = 0.01

var warped_x = x + warp_noise.get_noise_2d(x, y) * 20.0
var warped_y = y + warp_noise.get_noise_2d(x + 1000, y + 1000) * 20.0
var elevation = noise.get_noise_2d(warped_x, warped_y)
```

- [ ] **Step 2: Test by generating chunks and verifying organic shapes**
- [ ] **Step 3: Commit**

### Task 4: Constrain Settlement Compiler

**Files:**
- Modify: `scripts/core/world_compiler/layers/settlements_layer.gd`
- Modify: `scripts/core/world_compiler/building_compiler.gd`

- [ ] **Step 1: Add water buffer zone**

Buildings must be at least 3 tiles from any water cell. Check ALL tiles in a 3-tile buffer around the footprint.

```gdscript
func _is_dry_land(chunk: ChunkData, x: int, y: int, buffer: int) -> bool:
    for dy in range(-buffer, buffer + 1):
        for dx in range(-buffer, buffer + 1):
            var nx = x + dx
            var ny = y + dy
            if nx < 0 or nx >= ChunkData.SIZE or ny < 0 or ny >= ChunkData.SIZE:
                continue
            if chunk.is_ocean(nx, ny) or chunk.lake_cells.has(Vector2i(nx, ny)) or chunk.river_cells.has(Vector2i(nx, ny)):
                return false
    return true
```

- [ ] **Step 2: Reduce building template sizes**

Current templates produce huge footprints. Reduce to 4x4 for houses, 5x5 for forge, 3x3 for well.

- [ ] **Step 3: Commit**

### Task 5: Wire TileMapTerrainRenderer into GrainWorldDemo

**Files:**
- Modify: `scripts/GrainWorldDemo.gd`

- [ ] **Step 1: Replace DeferredRenderer with TileMapTerrainRenderer for terrain layers**

Keep DeferredRenderer only for object sprites (trees, decorations). Use TileMapTerrainRenderer for all tile-based layers.

```gdscript
# In _start_game():
_tilemap_renderer = TileMapTerrainRenderer.new()
_tilemap_renderer.setup(self)
add_child(_tilemap_renderer)

# Keep deferred renderer only for objects
_deferred_renderer = DeferredRenderer.new()
_deferred_renderer.setup(self)
add_child(_deferred_renderer)
```

- [ ] **Step 2: Update render_chunk to use both renderers**

```gdscript
# In _compile_chunk_incremental:
_tilemap_renderer.render_chunk(chunk)  # Terrain, water, paths, buildings, roofs
_deferred_renderer.render_objects(chunk)  # Trees, decorations only
```

- [ ] **Step 3: Test and screenshot**
- [ ] **Step 4: Commit**

### Task 6: Generate Missing PixelLab Terrain Tiles

**Files:**
- Create tiles in: `assets/catalog/terrain/` subdirectories

- [ ] **Step 1: Generate transition tilesets for common biome pairs**

Use PixelLab `create_topdown_tileset` for:
- grassland → desert (savanna edge)
- grassland → tundra (altitude transition)  
- desert → mountains
- forest → mountains

- [ ] **Step 2: Download and integrate into TileSet resource**
- [ ] **Step 3: Commit**
