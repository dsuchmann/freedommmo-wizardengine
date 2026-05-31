# Overmap + Streaming Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an overmap (6400x6400 pixel world preview), chunk streaming (5x5 grid around player), click-to-teleport, and binary chunk caching to the CleanWorld scene.

**Architecture:** Three new utility classes (OvermapGenerator, ChunkStreamer, ChunkCache) integrated into the existing CleanWorld.gd scene controller. ChunkStreamer manages the loaded grid and delegates to WorldCompiler for generation and ChunkCache for persistence. OvermapGenerator creates the world preview image from the same noise functions. CleanWorld.gd orchestrates these and owns the player/camera.

**Tech Stack:** Godot 4.4, GDScript, FastNoiseLite (deterministic noise), TileMapLayer (rendering), binary file I/O (caching)

**Spec:** `docs/superpowers/specs/2026-05-25-overmap-streaming-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/core/chunk_cache.gd` | Create | Binary serialize/deserialize ChunkData to `user://chunks/` |
| `scripts/core/chunk_streamer.gd` | Create | Manage 5x5 loaded grid, detect player movement, compile/load/unload chunks |
| `scripts/core/overmap_generator.gd` | Create | Generate 6400x6400 biome preview Image, cache as PNG |
| `scripts/CleanWorld.gd` | Modify | Replace bulk compilation with ChunkStreamer, add overmap UI + teleport |
| `scripts/core/world_compiler/tilemap_terrain_renderer.gd` | Modify (minor) | Add `clear_all()` method for teleport grid reset |

---

### Task 1: ChunkCache — Binary Serialization

**Files:**
- Create: `scripts/core/chunk_cache.gd`

- [ ] **Step 1: Create ChunkCache class with save method**

```gdscript
class_name ChunkCache

## Saves and loads compiled ChunkData as binary files.
## Format: magic + version + coords + seed + terrain arrays.

const MAGIC: int = 0x434B4E4B  # "CHNK"
const VERSION: int = 1
const CACHE_DIR: String = "user://chunks/"

static func _ensure_dir() -> void:
	if not DirAccess.dir_exists_absolute(CACHE_DIR):
		DirAccess.make_dir_recursive_absolute(CACHE_DIR)


static func get_path(cx: int, cy: int) -> String:
	return CACHE_DIR + "%d_%d.bin" % [cx, cy]


static func has_chunk(cx: int, cy: int) -> bool:
	return FileAccess.file_exists(get_path(cx, cy))


static func save_chunk(chunk: ChunkData) -> void:
	_ensure_dir()
	var path = get_path(chunk.chunk_x, chunk.chunk_y)
	var f = FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("ChunkCache: Cannot write %s" % path)
		return
	f.store_32(MAGIC)
	f.store_16(VERSION)
	f.store_32(chunk.chunk_x)
	f.store_32(chunk.chunk_y)
	f.store_32(chunk.world_seed)
	f.store_16(ChunkData.SIZE)
	# Terrain arrays
	f.store_buffer(chunk.elevation.to_byte_array())
	f.store_buffer(chunk.slope.to_byte_array())
	f.store_buffer(chunk.ocean_mask)
	f.store_buffer(chunk.ocean_distance.to_byte_array())
	f.store_buffer(chunk.temperature.to_byte_array())
	f.store_buffer(chunk.precipitation.to_byte_array())
	f.store_buffer(chunk.biome_id)
	f.store_buffer(chunk.vegetation_density)
	f.store_buffer(chunk.vegetation_species)
	f.close()
```

- [ ] **Step 2: Add load method**

```gdscript
static func load_chunk(cx: int, cy: int, expected_seed: int) -> ChunkData:
	var path = get_path(cx, cy)
	var f = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var magic = f.get_32()
	if magic != MAGIC:
		f.close()
		return null
	var version = f.get_16()
	if version != VERSION:
		f.close()
		return null
	var file_cx = f.get_32()
	var file_cy = f.get_32()
	var file_seed = f.get_32()
	var file_size = f.get_16()
	# Validate seed — discard if world changed
	if file_seed != expected_seed:
		f.close()
		DirAccess.remove_absolute(path)
		return null
	var chunk = ChunkData.new()
	chunk.chunk_x = file_cx
	chunk.chunk_y = file_cy
	chunk.world_seed = file_seed
	var total = ChunkData.SIZE * ChunkData.SIZE
	# Read terrain arrays
	chunk.elevation = f.get_buffer(total * 4).to_float32_array()
	chunk.slope = f.get_buffer(total * 4).to_float32_array()
	chunk.ocean_mask = f.get_buffer(total)
	chunk.ocean_distance = f.get_buffer(total * 4).to_float32_array()
	chunk.temperature = f.get_buffer(total * 4).to_float32_array()
	chunk.precipitation = f.get_buffer(total * 4).to_float32_array()
	chunk.biome_id = f.get_buffer(total)
	chunk.vegetation_density = f.get_buffer(total)
	chunk.vegetation_species = f.get_buffer(total)
	f.close()
	return chunk
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/chunk_cache.gd
git commit -m "feat: ChunkCache binary serialization for compiled terrain chunks"
```

---

### Task 2: ChunkStreamer — Grid Management

**Files:**
- Create: `scripts/core/chunk_streamer.gd`

- [ ] **Step 1: Create ChunkStreamer class with core state**

```gdscript
class_name ChunkStreamer

## Manages a 5x5 grid of loaded chunks around the player.
## Compiles new chunks as the player moves, caches to disk,
## loads from cache on revisit.

signal chunks_ready
signal chunk_loaded(cx: int, cy: int)

const GRID_RADIUS: int = 2  # 5x5 grid = radius 2 around center
const LOAD_THRESHOLD: float = 0.6  # Trigger loading at 60% toward edge

var _renderer: TileMapTerrainRenderer
var _phase1_compiler: WorldCompiler
var _phase2_compiler: WorldCompiler
var _world_seed: int
var _chunk_dict: Dictionary = {}  # Vector2i -> ChunkData
var _loaded_positions: Dictionary = {}  # Vector2i -> true (rendered chunks)
var _center_chunk: Vector2i = Vector2i.ZERO
var _compiling: bool = false
var _initial_load: bool = true


func setup(renderer: TileMapTerrainRenderer, phase1: WorldCompiler, phase2: WorldCompiler, seed: int) -> void:
	_renderer = renderer
	_phase1_compiler = phase1
	_phase2_compiler = phase2
	_world_seed = seed
```

- [ ] **Step 2: Add initial grid loading**

```gdscript
func load_grid_around(cx: int, cy: int, scene_tree: SceneTree) -> void:
	## Compile and render a full grid around the given chunk coordinate.
	## Used for initial load and teleport.
	_compiling = true
	_center_chunk = Vector2i(cx, cy)

	# Clear existing rendered chunks
	for pos in _loaded_positions:
		_renderer.clear_chunk(pos.x, pos.y)
	_loaded_positions.clear()

	# Phase 1: Compile or load all chunks in grid
	var grid_chunks: Array = []
	for dy in range(-GRID_RADIUS, GRID_RADIUS + 1):
		for dx in range(-GRID_RADIUS, GRID_RADIUS + 1):
			var pos = Vector2i(cx + dx, cy + dy)
			var chunk = _get_or_compile_phase1(pos)
			grid_chunks.append(chunk)
			await scene_tree.process_frame

	# Edge propagation: propagate ocean distance from neighbors into each chunk
	_propagate_ocean_distance_edges(grid_chunks)
	await scene_tree.process_frame

	# Phase 2: Compile derived layers
	for chunk in grid_chunks:
		if not _loaded_positions.has(Vector2i(chunk.chunk_x, chunk.chunk_y)):
			_compile_phase2(chunk)
			ChunkCache.save_chunk(chunk)
		await scene_tree.process_frame

	# Render all
	for chunk in grid_chunks:
		var pos = Vector2i(chunk.chunk_x, chunk.chunk_y)
		_renderer.register_chunk(chunk)
		_renderer.render_chunk(chunk)
		_loaded_positions[pos] = true
		await scene_tree.process_frame

	_compiling = false
	_initial_load = false
	chunks_ready.emit()
```

- [ ] **Step 3: Add single-chunk compile helpers**

```gdscript
func _get_or_compile_phase1(pos: Vector2i) -> ChunkData:
	## Get chunk from memory, disk cache, or compile fresh (phase 1 only).
	if _chunk_dict.has(pos):
		return _chunk_dict[pos]
	# Try disk cache
	var cached = ChunkCache.load_chunk(pos.x, pos.y, _world_seed)
	if cached != null:
		_chunk_dict[pos] = cached
		return cached
	# Compile phase 1
	var chunk = ChunkData.new()
	chunk.chunk_x = pos.x
	chunk.chunk_y = pos.y
	chunk.world_seed = _world_seed
	for layer in _phase1_compiler.layers:
		var layer_seed = SeedHasher.hash_seed(_world_seed, pos.x, pos.y, layer.layer_id)
		layer.compile(chunk, layer_seed)
		if layer.layer_name == "ocean_mask":
			_phase1_compiler._compute_ocean_distance(chunk)
	_chunk_dict[pos] = chunk
	return chunk


func _compile_phase2(chunk: ChunkData) -> void:
	## Compile derived layers (climate, biomes, vegetation).
	for layer in _phase2_compiler.layers:
		var layer_seed = SeedHasher.hash_seed(_world_seed, chunk.chunk_x, chunk.chunk_y, layer.layer_id)
		layer.compile(chunk, layer_seed)


func _propagate_ocean_distance_edges(chunks: Array) -> void:
	## Propagate ocean distance across chunk boundaries.
	## Iterates 3 times for convergence across the grid.
	var size = ChunkData.SIZE
	for _iteration in range(3):
		for chunk in chunks:
			var ck = Vector2i(chunk.chunk_x, chunk.chunk_y)
			for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var nk = ck + dir
				if not _chunk_dict.has(nk):
					continue
				var neighbor = _chunk_dict[nk]
				# Propagate along shared edge
				if dir == Vector2i(1, 0):
					for y in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(size - 1, y)]
						var their_d = neighbor.ocean_distance[neighbor.idx(0, y)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(0, y)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(size - 1, y)] = their_d + 1.0
				elif dir == Vector2i(-1, 0):
					for y in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(0, y)]
						var their_d = neighbor.ocean_distance[neighbor.idx(size - 1, y)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(size - 1, y)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(0, y)] = their_d + 1.0
				elif dir == Vector2i(0, 1):
					for x in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(x, size - 1)]
						var their_d = neighbor.ocean_distance[neighbor.idx(x, 0)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(x, 0)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(x, size - 1)] = their_d + 1.0
				elif dir == Vector2i(0, -1):
					for x in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(x, 0)]
						var their_d = neighbor.ocean_distance[neighbor.idx(x, size - 1)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(x, size - 1)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(x, 0)] = their_d + 1.0
```

- [ ] **Step 4: Add streaming update (called every frame)**

```gdscript
func update(player_world_pos: Vector2, tile_size: int, scene_tree: SceneTree) -> void:
	## Check if player has moved close to grid edge. If so, shift grid.
	if _compiling or _initial_load:
		return
	var chunk_px = ChunkData.SIZE * tile_size
	var px = int(player_world_pos.x)
	var py = int(player_world_pos.y)
	var new_cx: int
	var new_cy: int
	if px >= 0:
		new_cx = px / chunk_px
	else:
		new_cx = (px - chunk_px + 1) / chunk_px
	if py >= 0:
		new_cy = py / chunk_px
	else:
		new_cy = (py - chunk_px + 1) / chunk_px
	var new_center = Vector2i(new_cx, new_cy)

	if new_center != _center_chunk:
		_center_chunk = new_center
		_expand_grid(scene_tree)


func _expand_grid(scene_tree: SceneTree) -> void:
	## Load missing chunks and unload distant ones.
	_compiling = true
	var cx = _center_chunk.x
	var cy = _center_chunk.y
	var needed: Array = []

	# Determine which positions need loading
	for dy in range(-GRID_RADIUS, GRID_RADIUS + 1):
		for dx in range(-GRID_RADIUS, GRID_RADIUS + 1):
			var pos = Vector2i(cx + dx, cy + dy)
			if not _loaded_positions.has(pos):
				needed.append(pos)

	# Compile and render new chunks
	for pos in needed:
		var chunk = _get_or_compile_phase1(pos)
		# Edge propagation from existing neighbors
		_propagate_single_chunk_edges(chunk)
		_compile_phase2(chunk)
		ChunkCache.save_chunk(chunk)
		_renderer.register_chunk(chunk)
		_renderer.render_chunk(chunk)
		_loaded_positions[pos] = true
		chunk_loaded.emit(pos.x, pos.y)
		await scene_tree.process_frame

	# Unload distant chunks (beyond radius + 1)
	var to_remove: Array = []
	for pos in _loaded_positions:
		if abs(pos.x - cx) > GRID_RADIUS + 1 or abs(pos.y - cy) > GRID_RADIUS + 1:
			to_remove.append(pos)
	for pos in to_remove:
		_renderer.clear_chunk(pos.x, pos.y)
		_loaded_positions.erase(pos)

	_compiling = false


func _propagate_single_chunk_edges(chunk: ChunkData) -> void:
	## Propagate ocean distance from already-loaded neighbors into a single new chunk.
	var size = ChunkData.SIZE
	var ck = Vector2i(chunk.chunk_x, chunk.chunk_y)
	for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var nk = ck + dir
		if not _chunk_dict.has(nk):
			continue
		var neighbor = _chunk_dict[nk]
		if dir == Vector2i(-1, 0):  # Neighbor is to our left
			for y in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(size - 1, y)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(0, y)]:
					chunk.ocean_distance[chunk.idx(0, y)] = nd + 1.0
		elif dir == Vector2i(1, 0):  # Neighbor is to our right
			for y in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(0, y)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(size - 1, y)]:
					chunk.ocean_distance[chunk.idx(size - 1, y)] = nd + 1.0
		elif dir == Vector2i(0, -1):  # Neighbor is above
			for x in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(x, size - 1)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(x, 0)]:
					chunk.ocean_distance[chunk.idx(x, 0)] = nd + 1.0
		elif dir == Vector2i(0, 1):  # Neighbor is below
			for x in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(x, 0)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(x, size - 1)]:
					chunk.ocean_distance[chunk.idx(x, size - 1)] = nd + 1.0


func get_chunk(cx: int, cy: int) -> ChunkData:
	return _chunk_dict.get(Vector2i(cx, cy))


func get_chunk_dict() -> Dictionary:
	return _chunk_dict
```

- [ ] **Step 5: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: ChunkStreamer manages 5x5 loaded grid with streaming and caching"
```

---

### Task 3: OvermapGenerator — World Preview

**Files:**
- Create: `scripts/core/overmap_generator.gd`

- [ ] **Step 1: Create OvermapGenerator class**

```gdscript
class_name OvermapGenerator

## Generates a 6400x6400 world preview image by sampling noise at chunk centers.
## Each pixel = one chunk. Color = biome type.

const MAP_SIZE: int = 6400
const HALF_SIZE: int = 3200
const CACHE_PATH: String = "user://overmap_%d.png"

static func get_or_create(world_seed: int) -> ImageTexture:
	## Load cached overmap or generate a new one.
	var path = CACHE_PATH % world_seed
	if FileAccess.file_exists(path):
		var img = Image.load_from_file(path)
		if img != null and img.get_width() == MAP_SIZE:
			return ImageTexture.create_from_image(img)

	var img = _generate(world_seed)
	img.save_png(path)
	return ImageTexture.create_from_image(img)


static func _generate(world_seed: int) -> Image:
	## Sample elevation + climate noise at each chunk center to classify biomes.
	var img = Image.create(MAP_SIZE, MAP_SIZE, false, Image.FORMAT_RGB8)

	# Setup noise — must match ElevationLayer and ClimateLayer exactly
	var elev_noise = FastNoiseLite.new()
	elev_noise.seed = world_seed
	elev_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	elev_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	elev_noise.fractal_octaves = 6
	elev_noise.frequency = 0.006

	var ridge_noise = FastNoiseLite.new()
	ridge_noise.seed = world_seed + 1000
	ridge_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	ridge_noise.fractal_octaves = 3
	ridge_noise.frequency = 0.012

	var warp_noise = FastNoiseLite.new()
	warp_noise.seed = world_seed + 777
	warp_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	warp_noise.frequency = 0.015
	warp_noise.fractal_octaves = 3

	var med_noise = FastNoiseLite.new()
	med_noise.seed = world_seed + 2000
	med_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	med_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	med_noise.fractal_octaves = 4
	med_noise.frequency = 0.025

	var temp_noise = FastNoiseLite.new()
	temp_noise.seed = world_seed + 333
	temp_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	temp_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	temp_noise.fractal_octaves = 4
	temp_noise.frequency = 0.006

	var moisture_noise = FastNoiseLite.new()
	moisture_noise.seed = world_seed + 500
	moisture_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	moisture_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	moisture_noise.fractal_octaves = 5
	moisture_noise.frequency = 0.008

	var chunk_center_offset = ChunkData.SIZE / 2  # 32 tiles into the chunk

	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var chunk_x = px - HALF_SIZE
			var chunk_y = py - HALF_SIZE
			# World coordinate at chunk center
			var wx = float(chunk_x * ChunkData.SIZE + chunk_center_offset)
			var wy = float(chunk_y * ChunkData.SIZE + chunk_center_offset)

			# Elevation (matches ElevationLayer)
			var warp_x = warp_noise.get_noise_2d(wx, wy) * 15.0
			var warp_y = warp_noise.get_noise_2d(wx + 500.0, wy + 500.0) * 15.0
			var wwx = wx + warp_x
			var wwy = wy + warp_y
			var h = elev_noise.get_noise_2d(wwx, wwy) * 0.4
			h += abs(ridge_noise.get_noise_2d(wwx, wwy)) * 0.2
			h += med_noise.get_noise_2d(wwx, wwy) * 0.15
			h += 0.5
			h = clampf(h, 0.0, 1.0)

			# Ocean check
			if h < 0.38:
				img.set_pixel(px, py, BiomeLayer.biome_color(BiomeLayer.Biome.OCEAN))
				continue

			# Climate (matches ClimateLayer)
			var cwarp_noise_inst = warp_noise  # reuse
			var cw_x = cwarp_noise_inst.get_noise_2d(wx, wy) * 12.0
			var cw_y = cwarp_noise_inst.get_noise_2d(wx + 700.0, wy + 700.0) * 12.0
			var cwwx = wx + cw_x
			var cwwy = wy + cw_y
			var temp_base = (temp_noise.get_noise_2d(cwwx, cwwy) + 1.0) * 0.5
			var lat_factor = clampf(1.0 - abs(wy / 200.0), 0.0, 1.0)
			var temp = temp_base * 0.6 + lat_factor * 0.4
			if h > 0.5:
				temp -= (h - 0.5) * 0.8
			temp = clampf(temp, 0.0, 1.0)

			var moist = (moisture_noise.get_noise_2d(cwwx, cwwy) + 1.0) * 0.5
			moist = clampf(moist, 0.0, 1.0)

			# Biome classification (matches BiomeLayer rules)
			var biome = _classify_biome(h, temp, moist)
			img.set_pixel(px, py, BiomeLayer.biome_color(biome))

	return img


static func _classify_biome(h: float, t: float, p: float) -> int:
	if h < 0.42 and h >= 0.38:
		return BiomeLayer.Biome.BEACH
	if h > 0.82:
		return BiomeLayer.Biome.MOUNTAINS
	if p > 0.8 and h < 0.5 and t > 0.3:
		return BiomeLayer.Biome.SWAMP
	# Whittaker rules
	if t < 0.15:
		return BiomeLayer.Biome.ARCTIC
	if t >= 0.15 and t < 0.3 and p < 0.4:
		return BiomeLayer.Biome.TUNDRA
	if t >= 0.15 and t < 0.3 and p >= 0.4:
		return BiomeLayer.Biome.TAIGA
	if t >= 0.6 and p < 0.2:
		return BiomeLayer.Biome.DESERT
	if t >= 0.6 and p >= 0.2 and p < 0.5:
		return BiomeLayer.Biome.SAVANNA
	if t >= 0.6 and p >= 0.5:
		return BiomeLayer.Biome.TROPICAL_FOREST
	if t >= 0.3 and t < 0.6 and p < 0.3:
		return BiomeLayer.Biome.STEPPE
	if t >= 0.3 and t < 0.6 and p >= 0.3 and p < 0.55:
		return BiomeLayer.Biome.GRASSLAND
	if t >= 0.3 and t < 0.6 and p >= 0.55 and p < 0.75:
		return BiomeLayer.Biome.FOREST
	if t >= 0.3 and t < 0.6 and p >= 0.75:
		return BiomeLayer.Biome.DENSE_FOREST
	return BiomeLayer.Biome.GRASSLAND
```

Note: Generating 41M pixels will take ~30-60 seconds. For testing, add a smaller preview mode. But the full generation only happens once per seed and is cached to PNG.

- [ ] **Step 2: Commit**

```bash
git add scripts/core/overmap_generator.gd
git commit -m "feat: OvermapGenerator creates 6400x6400 world preview from noise"
```

---

### Task 4: TileMapTerrainRenderer — Add clear_all()

**Files:**
- Modify: `scripts/core/world_compiler/tilemap_terrain_renderer.gd`

- [ ] **Step 1: Add clear_all method for teleport resets**

Add after the existing `clear_chunk()` method:

```gdscript
func clear_all() -> void:
	## Remove all tiles from all layers and reset chunk registry.
	for layer in [_terrain_layer, _cliff_layer, _shading_layer, _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer != null:
			layer.clear()
	_chunks.clear()
	_roof_sprites.clear()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: add clear_all() to TileMapTerrainRenderer for teleport resets"
```

---

### Task 5: Integrate Into CleanWorld

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Replace bulk compilation with ChunkStreamer**

Replace the entire file with the integrated version. Key changes:
- Remove `_compile_world()` and `_global_distance_bfs()` — ChunkStreamer handles this
- Add `_chunk_streamer: ChunkStreamer` 
- Add overmap UI (CanvasLayer + TextureRect)
- Add `M` key toggle and click-to-teleport
- `_process()` calls `_chunk_streamer.update()` for streaming

```gdscript
extends Node2D

## Clean terrain scene with overmap navigation and chunk streaming.

const WORLD_SEED: int = 42
const TILE_SIZE: int = 32
const PLAYER_SPEED: float = 110.0

var _renderer: TileMapTerrainRenderer
var _chunk_streamer: ChunkStreamer
var _player: ColorRect
var _camera: Camera2D

# Elevation-driven camera/movement
const BASE_ZOOM: float = 1.5
const ZOOM_MIN: float = 1.2
const ZOOM_MAX: float = 1.7
const SPEED_UPHILL: float = 0.5
const SPEED_DOWNHILL: float = 1.3
var _target_zoom: float = BASE_ZOOM
var _bokeh_material: ShaderMaterial = null

# Overmap UI
var _overmap_layer: CanvasLayer = null
var _overmap_rect: TextureRect = null
var _overmap_marker: ColorRect = null
var _overmap_visible: bool = false

# Two-phase compilers
var _phase1_compiler: WorldCompiler
var _phase2_compiler: WorldCompiler


func _ready() -> void:
	_setup_compilers()
	_setup_renderer()
	_setup_player()
	_setup_chunk_streamer()
	_setup_overmap_ui()
	# Initial load around origin
	_chunk_streamer.load_grid_around(0, 0, get_tree())


func _setup_compilers() -> void:
	_phase1_compiler = WorldCompiler.new(WORLD_SEED)
	_phase1_compiler.register_layer(ElevationLayer.new())
	_phase1_compiler.register_layer(OceanMaskLayer.new())

	_phase2_compiler = WorldCompiler.new(WORLD_SEED)
	_phase2_compiler.register_layer(ClimateLayer.new())
	_phase2_compiler.register_layer(BiomeLayer.new())
	_phase2_compiler.register_layer(SoilFertilityLayer.new())
	_phase2_compiler.register_layer(VegetationLayer.new())
	_phase2_compiler.register_layer(CoastalLayer.new())


func _setup_renderer() -> void:
	_renderer = TileMapTerrainRenderer.new()
	_renderer.setup(self, TILE_SIZE)


func _setup_player() -> void:
	_player = ColorRect.new()
	_player.color = Color(0.9, 0.1, 0.1)
	_player.size = Vector2(16, 16)
	_player.z_index = 10
	var center = ChunkData.SIZE * TILE_SIZE / 2.0
	_player.position = Vector2(center, center)
	add_child(_player)

	_camera = Camera2D.new()
	_camera.zoom = Vector2(1.5, 1.5)
	_player.add_child(_camera)

	_setup_bokeh()


func _setup_bokeh() -> void:
	var canvas = CanvasLayer.new()
	canvas.layer = 10
	add_child(canvas)
	var bokeh_rect = ColorRect.new()
	bokeh_rect.anchors_preset = Control.PRESET_FULL_RECT
	bokeh_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader = load("res://assets/materials/elevation_bokeh.gdshader") as Shader
	if shader:
		_bokeh_material = ShaderMaterial.new()
		_bokeh_material.shader = shader
		_bokeh_material.set_shader_parameter("blur_intensity", 0.0)
		bokeh_rect.material = _bokeh_material
	canvas.add_child(bokeh_rect)


func _setup_chunk_streamer() -> void:
	_chunk_streamer = ChunkStreamer.new()
	_chunk_streamer.setup(_renderer, _phase1_compiler, _phase2_compiler, WORLD_SEED)


func _setup_overmap_ui() -> void:
	_overmap_layer = CanvasLayer.new()
	_overmap_layer.layer = 20
	_overmap_layer.visible = false
	add_child(_overmap_layer)

	# Dark background
	var bg = ColorRect.new()
	bg.color = Color(0, 0, 0, 0.7)
	bg.anchors_preset = Control.PRESET_FULL_RECT
	bg.mouse_filter = Control.MOUSE_FILTER_STOP
	_overmap_layer.add_child(bg)

	# Map image (centered, scaled to fit screen)
	_overmap_rect = TextureRect.new()
	_overmap_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_overmap_rect.anchors_preset = Control.PRESET_FULL_RECT
	_overmap_rect.mouse_filter = Control.MOUSE_FILTER_STOP
	_overmap_layer.add_child(_overmap_rect)

	# Player marker
	_overmap_marker = ColorRect.new()
	_overmap_marker.color = Color(1, 0, 0)
	_overmap_marker.size = Vector2(6, 6)
	_overmap_marker.z_index = 1
	_overmap_rect.add_child(_overmap_marker)

	# Connect click
	_overmap_rect.gui_input.connect(_on_overmap_input)

	# Label
	var label = Label.new()
	label.text = "World Map — Click to travel | M to close"
	label.position = Vector2(20, 20)
	label.add_theme_font_size_override("font_size", 20)
	_overmap_layer.add_child(label)


func _toggle_overmap() -> void:
	_overmap_visible = not _overmap_visible
	_overmap_layer.visible = _overmap_visible
	if _overmap_visible and _overmap_rect.texture == null:
		# Generate overmap on first open (this takes ~30-60s for full 6400x6400)
		# For now use a smaller preview
		_overmap_rect.texture = OvermapGenerator.get_or_create(WORLD_SEED)


func _on_overmap_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		# Map click position to chunk coordinates
		var rect_size = _overmap_rect.get_rect().size
		var tex_size = _overmap_rect.texture.get_size() if _overmap_rect.texture else Vector2(1, 1)
		var local_pos = _overmap_rect.get_local_mouse_position()
		# Normalize to 0-1 range within the texture
		var scale_factor = minf(rect_size.x / tex_size.x, rect_size.y / tex_size.y)
		var offset = (rect_size - tex_size * scale_factor) / 2.0
		var tex_pos = (local_pos - offset) / scale_factor
		var px = int(tex_pos.x)
		var py = int(tex_pos.y)
		if px >= 0 and px < int(tex_size.x) and py >= 0 and py < int(tex_size.y):
			var chunk_x = px - int(tex_size.x) / 2
			var chunk_y = py - int(tex_size.y) / 2
			_teleport_to(chunk_x, chunk_y)


func _teleport_to(chunk_x: int, chunk_y: int) -> void:
	_overmap_visible = false
	_overmap_layer.visible = false
	# Clear and reload grid at target
	_renderer.clear_all()
	var center_px = (chunk_x * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	var center_py = (chunk_y * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	_player.position = Vector2(center_px, center_py)
	_chunk_streamer.load_grid_around(chunk_x, chunk_y, get_tree())


func _process(delta: float) -> void:
	if _overmap_visible:
		return
	# Chunk streaming
	_chunk_streamer.update(_player.position, TILE_SIZE, get_tree())

	# Player movement
	var dir = Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_action_pressed("ui_left"):
		dir.x -= 1
	if Input.is_key_pressed(KEY_D) or Input.is_action_pressed("ui_right"):
		dir.x += 1
	if Input.is_key_pressed(KEY_W) or Input.is_action_pressed("ui_up"):
		dir.y -= 1
	if Input.is_key_pressed(KEY_S) or Input.is_action_pressed("ui_down"):
		dir.y += 1

	if dir != Vector2.ZERO:
		dir = dir.normalized()
		var current_elev = _get_elevation_at(_player.position)
		var ahead_elev = _get_elevation_at(_player.position + dir * TILE_SIZE)
		var slope = ahead_elev - current_elev
		var speed_mult = 1.0
		if slope > 0.01:
			speed_mult = lerpf(1.0, SPEED_UPHILL, minf(slope * 20.0, 1.0))
		elif slope < -0.01:
			speed_mult = lerpf(1.0, SPEED_DOWNHILL, minf(-slope * 20.0, 1.0))
		_player.position += dir * PLAYER_SPEED * speed_mult * delta

	# Camera zoom responds to elevation
	var elev = _get_elevation_at(_player.position)
	_target_zoom = lerpf(ZOOM_MAX, ZOOM_MIN, clampf((elev - 0.35) / 0.5, 0.0, 1.0))
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), delta * 2.0)

	# Bokeh
	if _bokeh_material:
		var bokeh_target = clampf((elev - 0.6) / 0.3, 0.0, 0.6)
		var current_bokeh = _bokeh_material.get_shader_parameter("blur_intensity")
		_bokeh_material.set_shader_parameter("blur_intensity", lerpf(current_bokeh, bokeh_target, delta * 3.0))

	# Update overmap marker position
	if _overmap_marker and _overmap_rect.texture:
		var tex_size = _overmap_rect.texture.get_size()
		var chunk_px = ChunkData.SIZE * TILE_SIZE
		var marker_x = _player.position.x / chunk_px + tex_size.x / 2.0
		var marker_y = _player.position.y / chunk_px + tex_size.y / 2.0
		_overmap_marker.position = Vector2(marker_x - 3, marker_y - 3)


func _get_elevation_at(world_pos: Vector2) -> float:
	var tile_x = int(world_pos.x) / TILE_SIZE
	var tile_y = int(world_pos.y) / TILE_SIZE
	var cx = 0
	var cy = 0
	var lx = tile_x
	var ly = tile_y
	if tile_x < 0:
		cx = (tile_x - ChunkData.SIZE + 1) / ChunkData.SIZE
		lx = tile_x - cx * ChunkData.SIZE
	else:
		cx = tile_x / ChunkData.SIZE
		lx = tile_x - cx * ChunkData.SIZE
	if tile_y < 0:
		cy = (tile_y - ChunkData.SIZE + 1) / ChunkData.SIZE
		ly = tile_y - cy * ChunkData.SIZE
	else:
		cy = tile_y / ChunkData.SIZE
		ly = tile_y - cy * ChunkData.SIZE
	var chunk = _chunk_streamer.get_chunk(cx, cy)
	if chunk == null:
		return 0.5
	lx = clampi(lx, 0, ChunkData.SIZE - 1)
	ly = clampi(ly, 0, ChunkData.SIZE - 1)
	return chunk.elevation[chunk.idx(lx, ly)]


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_M:
			_toggle_overmap()
		elif event.keycode == KEY_EQUAL:
			_camera.zoom *= 1.2
		elif event.keycode == KEY_MINUS:
			_camera.zoom *= 0.8
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_camera.zoom *= 1.1
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_camera.zoom *= 0.9
```

- [ ] **Step 2: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: integrate overmap UI, chunk streaming, and click-to-teleport"
```

---

### Task 6: Test and Verify

- [ ] **Step 1: Run the scene and verify initial chunk loading**

Run `res://scenes/CleanWorld.tscn`. Expected: 5x5 grid of terrain loads around origin. Player (red square) can walk with WASD. Scroll wheel zooms.

- [ ] **Step 2: Walk to a chunk boundary and verify streaming**

Walk east (D key) until crossing into a new chunk. Expected: new chunks appear seamlessly ahead. Old chunks behind eventually unload. No visible seams.

- [ ] **Step 3: Press M and verify overmap**

Press M. Expected: dark overlay with world map image appears. Note: first open will take 30-60 seconds to generate 6400x6400 image. After that it's cached.

For faster testing, temporarily reduce `MAP_SIZE` in OvermapGenerator to 640 (100x smaller). Restore to 6400 after verifying.

- [ ] **Step 4: Click overmap to teleport**

Click a different location on the overmap. Expected: overmap closes, terrain clears, new 5x5 grid loads at target location, player appears at clicked position.

- [ ] **Step 5: Verify chunk caching**

Check `user://chunks/` directory (typically `%APPDATA%/Godot/app_userdata/FreedomMMO/chunks/`). Expected: `.bin` files for each compiled chunk. Walk away and return to a previously visited area — it should load instantly from cache.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete overmap + streaming terrain system"
git push origin main
```
