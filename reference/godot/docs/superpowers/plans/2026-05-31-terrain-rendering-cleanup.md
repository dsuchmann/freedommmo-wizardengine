# Terrain Rendering Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip 10 dead/fighting rendering systems, rebuild terrain rendering with Godot-native TileMapLayer + `set_cells_terrain_connect()`, 16×16 chunks.

**Architecture:** Single TileMapLayer-based pipeline. Chunks compiled by WorldCompiler → surfaces mapped by ElevationGradientTable → tiles placed by `set_cells_terrain_connect()` → cliff/shading overlays on separate layers. All layers visible in editor scene tree.

**Tech Stack:** Godot 4.4, GDScript, TileMapLayer terrain sets, terrain_v4 PixelLab tilesets

**Spec:** `docs/superpowers/specs/2026-05-31-terrain-rendering-cleanup-design.md`

---

### Task 1: Delete dead rendering systems

**Files:**
- Delete: `scripts/core/world_compiler/elevation_renderer.gd`
- Delete: `scripts/core/world_compiler/layered_chunk_renderer.gd`
- Delete: `scripts/core/world_compiler/layered_tileset_loader.gd`
- Delete: `scripts/core/world_compiler/surface_layer_compositor.gd`
- Delete: `scripts/core/world_compiler/cliff_tile_loader.gd`
- Delete: `scripts/core/world_compiler/deferred_renderer.gd`
- Delete: `scripts/core/world_compiler/tileset_renderer.gd`
- Delete: `scripts/visual/Mode7Ground.gd`
- Delete: `scripts/visual/SpriteStack.gd`
- Delete: `scripts/visual/OccluderLoader.gd`

Also delete any associated `.uid` files next to them.

- [ ] **Step 1: Delete the 10 files**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
rm scripts/core/world_compiler/elevation_renderer.gd
rm scripts/core/world_compiler/elevation_renderer.gd.uid
rm scripts/core/world_compiler/layered_chunk_renderer.gd
rm scripts/core/world_compiler/layered_chunk_renderer.gd.uid
rm scripts/core/world_compiler/layered_tileset_loader.gd
rm scripts/core/world_compiler/layered_tileset_loader.gd.uid
rm scripts/core/world_compiler/surface_layer_compositor.gd
rm scripts/core/world_compiler/surface_layer_compositor.gd.uid
rm scripts/core/world_compiler/cliff_tile_loader.gd
rm scripts/core/world_compiler/cliff_tile_loader.gd.uid
rm scripts/core/world_compiler/deferred_renderer.gd
rm scripts/core/world_compiler/deferred_renderer.gd.uid
rm scripts/core/world_compiler/tileset_renderer.gd
rm scripts/core/world_compiler/tileset_renderer.gd.uid
rm scripts/visual/Mode7Ground.gd
rm scripts/visual/SpriteStack.gd
rm scripts/visual/OccluderLoader.gd
```

- [ ] **Step 2: Verify no remaining imports reference deleted classes**

```bash
grep -rn "ElevationRenderer\|LayeredChunkRenderer\|LayeredTilesetLoader\|SurfaceLayerCompositor\|CliffTileLoader\|DeferredRenderer\|TilesetRenderer\|Mode7Ground\|SpriteStack\|OccluderLoader" scripts/ --include="*.gd"
```

Note every file that references these classes — they will be cleaned up in Tasks 2 and 3.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete 10 dead/fighting rendering systems (~2900 lines)"
```

---

### Task 2: Change ChunkData.SIZE from 64 to 16

**Files:**
- Modify: `scripts/core/world_compiler/chunk_data.gd:8`

- [ ] **Step 1: Change the SIZE constant**

In `scripts/core/world_compiler/chunk_data.gd`, change line 8:

```gdscript
const SIZE: int = 16
```

- [ ] **Step 2: Verify nothing hardcodes 64**

```bash
grep -rn "64" scripts/core/world_compiler/chunk_data.gd
grep -rn "ChunkData.SIZE\|chunk.*SIZE\|CHUNK_SIZE" scripts/ --include="*.gd" | head -30
```

Confirm all code uses `ChunkData.SIZE` rather than hardcoded 64.

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/chunk_data.gd
git commit -m "feat: reduce ChunkData.SIZE from 64 to 16 for terrain_connect perf"
```

---

### Task 3: Rewrite TileMapTerrainRenderer (complete replacement)

**Files:**
- Rewrite: `scripts/core/world_compiler/tilemap_terrain_renderer.gd`

The current file is 1511 lines of mixed legacy/native code. Replace it entirely with ~200 lines.

- [ ] **Step 1: Write the new TileMapTerrainRenderer**

Replace the entire contents of `scripts/core/world_compiler/tilemap_terrain_renderer.gd` with:

```gdscript
class_name TileMapTerrainRenderer
extends Node

## Renders compiled ChunkData onto Godot-native TileMapLayer nodes.
## Uses set_cells_terrain_connect() for automatic edge matching.
## Layers are scene-tree nodes found by name, not created dynamically.

signal chunk_render_complete(chunk_x: int, chunk_y: int)

var _tileset: TileSet = null
var _terrain_builder: TerrainTilesetBuilder = null
var _world_scale: int = 32

# Layer references (found in scene tree by name)
var _terrain_layer: TileMapLayer = null
var _cliff_layer: TileMapLayer = null
var _shading_layer: TileMapLayer = null
var _water_layer: TileMapLayer = null
var _road_layer: TileMapLayer = null
var _building_layer: TileMapLayer = null
var _roof_layer: TileMapLayer = null

# Shading + cliff tile source IDs (added dynamically to the TileSet)
var _shading_source_id: int = -1
var _cliff_source_ids: Dictionary = {}  # tier_diff -> source_id

# Elevation tier system
const TIER_THRESHOLDS: Array = [0.38, 0.50, 0.62, 0.75]
const TIER_COUNT: int = 5

# Cross-chunk lookup for neighbor surfaces
var _chunks: Dictionary = {}  # Vector2i -> ChunkData


func register_chunk(chunk: ChunkData) -> void:
	_chunks[Vector2i(chunk.chunk_x, chunk.chunk_y)] = chunk


func setup(tilemap_parent: Node2D, world_scale: int = 32) -> void:
	_world_scale = world_scale

	# Build TileSet from terrain_v4 assets
	ElevationGradientTable.load()
	_terrain_builder = TerrainTilesetBuilder.new()
	_tileset = _terrain_builder.build(world_scale)

	# Add shading + cliff tile sources
	_add_shading_and_cliff_sources()

	# Find layers in scene tree (they exist in the .tscn file)
	_terrain_layer = tilemap_parent.get_node("TerrainLayer")
	_cliff_layer = tilemap_parent.get_node("CliffLayer")
	_shading_layer = tilemap_parent.get_node("ShadingLayer")
	_water_layer = tilemap_parent.get_node("WaterLayer")
	_road_layer = tilemap_parent.get_node("RoadLayer")
	_building_layer = tilemap_parent.get_node("BuildingLayer")
	_roof_layer = tilemap_parent.get_node("RoofLayer")

	# Assign TileSet to all layers
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer != null:
			layer.tile_set = _tileset
			layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	print("[TileMapTerrainRenderer] Setup: %d terrains, %d sources" % [
		_terrain_builder.terrain_ids.size(), _terrain_builder.source_ids.size()])


func _add_shading_and_cliff_sources() -> void:
	var next_sid = _terrain_builder._next_source_id

	# 4 shade levels + 1 highlight
	_shading_source_id = next_sid
	var shade_alphas = [0.08, 0.15, 0.22, 0.30]
	for i in range(shade_alphas.size()):
		var img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
		img.fill(Color(0, 0, 0, shade_alphas[i]))
		_add_single_tile_source(img, next_sid + i)
	var hl_img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
	hl_img.fill(Color(1, 1, 1, 0.1))
	_add_single_tile_source(hl_img, next_sid + 4)

	# 4 cliff face darkness levels
	var cliff_sid = next_sid + 5
	var cliff_colors = [
		Color(0.35, 0.28, 0.18),
		Color(0.28, 0.22, 0.14),
		Color(0.22, 0.17, 0.10),
		Color(0.16, 0.12, 0.08),
	]
	for i in range(cliff_colors.size()):
		var img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
		for py in range(_world_scale):
			var t = float(py) / float(_world_scale)
			var row_color = cliff_colors[i].darkened(0.2).lerp(cliff_colors[i].lightened(0.1), t)
			for px in range(_world_scale):
				if py % 6 == 0:
					img.set_pixel(px, py, row_color.darkened(0.08))
				else:
					img.set_pixel(px, py, row_color)
		_add_single_tile_source(img, cliff_sid + i)
		_cliff_source_ids[i] = cliff_sid + i


func _add_single_tile_source(img: Image, sid: int) -> void:
	var tex = ImageTexture.create_from_image(img)
	var source = TileSetAtlasSource.new()
	source.texture = tex
	source.texture_region_size = Vector2i(_world_scale, _world_scale)
	source.create_tile(Vector2i(0, 0))
	_tileset.add_source(source, sid)


func render_chunk(chunk: ChunkData) -> void:
	register_chunk(chunk)
	var ox = chunk.chunk_x * ChunkData.SIZE
	var oy = chunk.chunk_y * ChunkData.SIZE
	_render_terrain(chunk, ox, oy)
	_render_cliffs(chunk, ox, oy)
	_render_shading(chunk, ox, oy)
	chunk_render_complete.emit(chunk.chunk_x, chunk.chunk_y)


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var ox = chunk_x * ChunkData.SIZE
	var oy = chunk_y * ChunkData.SIZE
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer == null:
			continue
		for y in range(ChunkData.SIZE):
			for x in range(ChunkData.SIZE):
				layer.erase_cell(Vector2i(ox + x, oy + y))


func clear_all() -> void:
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer != null:
			layer.clear()
	_chunks.clear()


# --- Terrain rendering via set_cells_terrain_connect ---

func _render_terrain(chunk: ChunkData, ox: int, oy: int) -> void:
	var size = ChunkData.SIZE
	var terrain_cells: Dictionary = {}  # terrain_id -> Array[Vector2i]

	for y in range(size):
		for x in range(size):
			var idx = y * size + x
			var surface_id = ""
			if chunk.ocean_mask[idx] == 1:
				surface_id = "ocean_water"
			else:
				var biome_id = chunk.biome_id[idx]
				var biome_name = ElevationGradientTable.biome_name_from_id(biome_id)
				var elevation = chunk.elevation[idx]
				surface_id = ElevationGradientTable.surface_at(biome_name, elevation)

			var terrain_id = _terrain_builder.get_terrain_id(surface_id)
			if terrain_id < 0:
				continue

			if not terrain_cells.has(terrain_id):
				terrain_cells[terrain_id] = []
			terrain_cells[terrain_id].append(Vector2i(ox + x, oy + y))

	# Largest groups first so transitions compute with full context
	var sorted_ids: Array = terrain_cells.keys()
	sorted_ids.sort_custom(func(a, b): return terrain_cells[a].size() > terrain_cells[b].size())
	for terrain_id in sorted_ids:
		_terrain_layer.set_cells_terrain_connect(terrain_cells[terrain_id], 0, terrain_id, false)


# --- Cliff rendering ---

func _render_cliffs(chunk: ChunkData, ox: int, oy: int) -> void:
	if _cliff_source_ids.is_empty():
		return
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				continue
			var my_tier = _elevation_tier(chunk.elevation[chunk.idx(x, y)])
			var north_tier = _get_neighbor_tier(chunk, x, y - 1)
			var diff = north_tier - my_tier
			if diff < 2:
				continue
			# Require >=3 of 5 horizontal neighbors to also have cliff (filter noise)
			var cliff_neighbors = 0
			for dx in [-2, -1, 0, 1, 2]:
				var nx = x + dx
				if nx < 0 or nx >= size:
					continue
				var nt = _get_neighbor_tier(chunk, nx, y - 1)
				var mt = _elevation_tier(chunk.elevation[chunk.idx(clampi(nx, 0, size - 1), y)])
				if nt - mt >= 2:
					cliff_neighbors += 1
			if cliff_neighbors >= 3:
				var shade_idx = clampi(diff - 1, 0, 3)
				if _cliff_source_ids.has(shade_idx):
					_terrain_layer.set_cell(
						Vector2i(ox + x, oy + y),
						_cliff_source_ids[shade_idx],
						Vector2i(0, 0))


func _elevation_tier(elev: float) -> int:
	for i in range(TIER_THRESHOLDS.size()):
		if elev < TIER_THRESHOLDS[i]:
			return i
	return TIER_COUNT


func _get_neighbor_tier(chunk: ChunkData, lx: int, ly: int) -> int:
	var size = ChunkData.SIZE
	if lx >= 0 and lx < size and ly >= 0 and ly < size:
		return _elevation_tier(chunk.elevation[chunk.idx(lx, ly)])
	# Cross-chunk lookup
	var cx = chunk.chunk_x
	var cy = chunk.chunk_y
	var nx = lx
	var ny = ly
	if nx < 0:
		cx -= 1
		nx += size
	elif nx >= size:
		cx += 1
		nx -= size
	if ny < 0:
		cy -= 1
		ny += size
	elif ny >= size:
		cy += 1
		ny -= size
	var neighbor = _chunks.get(Vector2i(cx, cy))
	if neighbor == null:
		return 0
	return _elevation_tier(neighbor.elevation[neighbor.idx(nx, ny)])


# --- Shading ---

func _render_shading(chunk: ChunkData, ox: int, oy: int) -> void:
	if _shading_source_id < 0:
		return
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				continue
			var i = chunk.idx(x, y)
			var elev = chunk.elevation[i]
			var slope_val = chunk.slope[i]
			var cell = Vector2i(ox + x, oy + y)

			# Directional hillshade: NW light source
			var elev_se = elev
			if x + 1 < size and y + 1 < size:
				elev_se = chunk.elevation[chunk.idx(x + 1, y + 1)]
			var hill_factor = (elev - elev_se) * 8.0

			# High peaks get highlights
			if elev > 0.72 and slope_val < 0.03:
				_shading_layer.set_cell(cell, _shading_source_id + 4, Vector2i(0, 0))
				continue

			var shade = hill_factor + slope_val * 2.0
			if elev < 0.38:
				shade += (0.38 - elev) * 1.5

			if shade > 0.15:
				var level = clampi(int(shade * 6.0), 0, 3)
				_shading_layer.set_cell(cell, _shading_source_id + level, Vector2i(0, 0))
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: rewrite TileMapTerrainRenderer — 200 lines, terrain_connect only"
```

---

### Task 4: Rewrite ChunkStreamer (strip legacy)

**Files:**
- Rewrite: `scripts/core/chunk_streamer.gd`

Strip all `_layered_renderer`, shadow thread, legacy image rendering. Keep compilation pipeline, chunk caching, background threading, object placement.

- [ ] **Step 1: Strip legacy references from ChunkStreamer**

In `scripts/core/chunk_streamer.gd`, make these changes:

Remove these variables:
```gdscript
# DELETE these lines:
var skip_legacy_render: bool = false
var _layered_renderer = null
var _shadow_thread: Thread = null
var _shadow_thread_busy: bool = false
var _shadow_mutex: Mutex = Mutex.new()
var _shadow_compiled: Array = []
```

Remove these functions entirely:
- `rerender_shadows()` (~12 lines)
- `_shadow_thread_work()` (~16 lines)
- `_thread_shadow_batch()` (~15 lines)

In `_thread_compile_batch()`, simplify to remove image building and layered renderer:

```gdscript
func _thread_compile_batch(batch: Array) -> void:
	for pos in batch:
		var chunk = _compile_chunk_data(pos)
		var objects: Array = []
		if _placement_engine != null:
			objects = _placement_engine.place_chunk(chunk, pos.x, pos.y)
		_mutex.lock()
		_compiled_queue.append({"chunk": chunk, "pos": pos, "objects": objects})
		_mutex.unlock()
	_thread_busy = false
```

In `load_grid_around()`, simplify the center chunk rendering:

```gdscript
# Replace the entire rendering section (lines 63-93) with:
_renderer.render_chunk(center_chunk)
if _placement_engine != null:
	var center_objects = _placement_engine.place_chunk(center_chunk, center_pos.x, center_pos.y)
	_register_blocking_objects(center_objects)
	if _object_renderer != null and center_objects.size() > 0:
		_object_renderer.render_chunk_objects(center_pos.x, center_pos.y, center_objects, center_chunk)
_loaded_positions[center_pos] = true
```

In `_process_load_queue()`, simplify the stage 2 rendering (lines 240-273):

```gdscript
elif not _loaded_positions.has(pos):
	_renderer.render_chunk(chunk)
	var objects = entry.get("objects", [])
	_register_blocking_objects(objects)
	if _object_renderer != null and objects.size() > 0:
		_object_renderer.render_chunk_objects(pos.x, pos.y, objects, chunk)
	_loaded_positions[pos] = true
	chunk_loaded.emit(pos.x, pos.y)
```

In `_queue_needed_chunks()`, update the clear call:

```gdscript
# Change _renderer.clear_chunk_fast to:
_renderer.clear_chunk(pos.x, pos.y)
```

Update `GRID_RADIUS`:

```gdscript
const GRID_RADIUS: int = 8  # 17x17 grid of 16x16 chunks
```

Remove the C++ image rendering path from `_thread_compile_batch` (the `_native_compiler.build_chunk_image_with_normals` call). Keep `_native_compiler` for chunk compilation only.

- [ ] **Step 2: Verify no references to deleted classes remain**

```bash
grep -rn "layered_renderer\|shadow_thread\|shadow_mutex\|shadow_compiled\|skip_legacy_render\|build_chunk_image\|display_chunk_image\|clear_chunk_fast" scripts/core/chunk_streamer.gd
```

Should return 0 results.

- [ ] **Step 3: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: strip ChunkStreamer — remove elevation sprites, shadow thread, legacy image path"
```

---

### Task 5: Update CleanWorld.gd — scene tree layers + stripped wiring

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Add TileMapLayer nodes in _ready setup**

In `_setup_renderer()`, replace the current renderer setup. The renderer now expects layers to exist as children of a parent node. Create them in code for now (we'll move to .tscn later):

```gdscript
func _setup_renderer() -> void:
	_renderer = TileMapTerrainRenderer.new()
	# Create a parent node for all tile map layers
	var tilemap_parent = Node2D.new()
	tilemap_parent.name = "TileMap"
	add_child(tilemap_parent)
	# Create layers as child TileMapLayer nodes (visible in editor at runtime)
	var layer_defs = [
		["TerrainLayer", -2],
		["CliffLayer", -1],
		["ShadingLayer", -1],
		["WaterLayer", 0],
		["RoadLayer", 2],
		["BuildingLayer", 3],
		["RoofLayer", 8],
	]
	for def in layer_defs:
		var layer = TileMapLayer.new()
		layer.name = def[0]
		layer.z_index = def[1]
		tilemap_parent.add_child(layer)
	_renderer.setup(tilemap_parent, TILE_SIZE)
```

- [ ] **Step 2: Remove all layered_renderer references**

Delete these lines from CleanWorld.gd:
- `var _layered_renderer: LayeredChunkRenderer` (variable declaration)
- Everything in `_setup_chunk_streamer` related to `_layered_renderer`:
  ```gdscript
  # DELETE:
  _layered_renderer = LayeredChunkRenderer.new()
  _layered_renderer.setup(self, TILE_SIZE)
  _layered_renderer.set_chunk_streamer(_chunk_streamer)
  _chunk_streamer._layered_renderer = _layered_renderer
  ```
- In `_teleport_to()`, delete: `_layered_renderer.clear_all()`
- In `_process()`, delete the sun angle/altitude lines:
  ```gdscript
  # DELETE:
  _layered_renderer._elevation_renderer.sun_angle = ...
  _layered_renderer._elevation_renderer.sun_altitude = ...
  ```
- In `_process()`, delete shadow position update:
  ```gdscript
  # DELETE:
  _layered_renderer.update_shadow_positions(...)
  ```

- [ ] **Step 3: Update _teleport_to to use new clear_all**

In `_teleport_to()`, replace `_renderer.clear_all()` call (it still exists with the right name in the new renderer).

- [ ] **Step 4: Update clear_chunk_fast references**

Search for `clear_chunk_fast` in CleanWorld.gd and replace with `clear_chunk`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: CleanWorld uses scene-tree TileMapLayers, strips elevation renderer wiring"
```

---

### Task 6: Fix remaining broken references

**Files:**
- Possibly modify: any script that references deleted classes

- [ ] **Step 1: Full grep for broken references**

```bash
grep -rn "ElevationRenderer\|LayeredChunkRenderer\|LayeredTilesetLoader\|SurfaceLayerCompositor\|CliffTileLoader\|DeferredRenderer\|TilesetRenderer\b\|clear_chunk_fast\|build_chunk_image\|display_chunk_image\|get_wang_cache\|get_biome_pairs\|get_self_tilesets\|get_tileset_upper\|get_biome_fallback\|_wang_tile_cache\|skip_legacy_render\|_layered_renderer\|_shadow_renderer" scripts/ --include="*.gd"
```

- [ ] **Step 2: Fix each broken reference**

For each file found:
- If it's referencing a deleted class, remove the reference
- If it's calling a removed method on TileMapTerrainRenderer, update to the new API
- If it's a standalone script that only existed to support a deleted system, delete it

- [ ] **Step 3: Delete chunk cache files (old 64x64 chunks are invalid)**

```bash
rm -rf C:/Users/daves/AppData/Roaming/Godot/app_userdata/FreedomMMO/chunk_cache/
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: clean up all broken references to deleted systems"
```

---

### Task 7: Test and verify

- [ ] **Step 1: Run the game (F6 on CleanWorld.tscn)**

Verify:
- Game loads without errors
- Terrain tiles appear with correct surfaces (green grass, brown rock, white snow)
- Transitions between surfaces show smooth auto-tiled edges
- Cliff face tiles appear at major elevation drops
- Shading overlay visible (darker on NW-facing slopes)
- All layers visible in Godot Scene panel at runtime (TerrainLayer, CliffLayer, etc.)
- Loading is fast (< 3 seconds to see terrain)

- [ ] **Step 2: Take a screenshot and verify visual quality**

```
Use mcp__godot-mcp-pro__get_game_screenshot
```

- [ ] **Step 3: Check console for errors**

Read the Godot log file for any errors or warnings related to terrain rendering.

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: terrain rendering cleanup complete — single TileMapLayer pipeline"
git push
```

---

### Task 8: Update memory and documentation

- [ ] **Step 1: Update session memory**

Write a memory file documenting what was done, what the new architecture is, and what comes next.

- [ ] **Step 2: Mark previous specs as superseded**

The following specs are now partially or fully superseded by the new architecture:
- `2026-05-27-elevation-cliff-rendering-design.md` (Y-offset stacking removed)
- `2026-05-26-runtime-compositor-spec.md` (compositor deleted)
- `2026-05-25-layer-architecture-spec.md` (layer structure simplified)

Add a note at the top of each: `> **SUPERSEDED** by 2026-05-31-terrain-rendering-cleanup-design.md`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: update memory and mark superseded specs"
git push
```
