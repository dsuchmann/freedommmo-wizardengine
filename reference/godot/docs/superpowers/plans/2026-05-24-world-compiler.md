# World Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scatter-placement worldgen with a deterministic layered world compiler that produces spatially coherent worlds with buildings-as-structures, deferred rendering, and debug views.

**Architecture:** A `WorldCompiler` orchestrator runs 14 layer classes in dependency order, each producing typed grid data stored in `ChunkData` resources. A `DeferredRenderer` spreads node creation across frames. A `BuildingCompiler` stamps walls/floors/doors/interiors on the world grid. Debug overlays toggled with F1-F14 keys.

**Tech Stack:** Godot 4.4 GDScript, FastNoiseLite, existing GrainRegistry/GrainStack system, TileMapRenderer

**Spec:** `docs/superpowers/specs/2026-05-24-world-compiler-design.md`

---

## File Structure

```
scripts/core/world_compiler/
  world_compiler.gd           # Pipeline orchestrator — runs layers in order
  chunk_data.gd                # Resource holding all grid data for a 256x256 chunk
  seed_hasher.gd               # Deterministic sub-seed derivation
  layer_base.gd                # Base class for all compiler layers
  layers/
    elevation_layer.gd         # L1: continental noise → float32 elevation grid
    ocean_mask_layer.gd        # L2: sea threshold → binary land/ocean
    drainage_layer.gd          # L3: Priority-Flood pit correction
    rivers_lakes_layer.gd      # L4: D8 flow → rivers + lakes
    climate_layer.gd           # L5: temperature + precipitation grids
    biome_layer.gd             # L6: Whittaker lookup → biome IDs
    soil_fertility_layer.gd    # L7: terrain class → soil + fertility
    vegetation_layer.gd        # L8: biome + fertility → density + species
    coastal_layer.gd           # L9: coast type classification
    roads_layer.gd             # L10: A* least-cost road graph
    settlements_layer.gd       # L11: scored placement + building compilation
    farms_layer.gd             # L12: farm/industry from settlement + fertility
    pois_layer.gd              # L13: triggered POI spawning
    events_layer.gd            # L14: event log + narrative interpreter
  building_compiler.gd         # Stamps buildings as wall/floor/door tiles
  deferred_renderer.gd         # Spreads node creation across frames
  debug/
    debug_overlay.gd           # F1-F14 toggle manager
    layer_visualizer.gd        # Renders grid data as colored overlay images
data/
  building_templates/
    house.json                 # 3x4 house with bed, table, storage
    forge.json                 # 4x5 forge with anvil, workbench
    market_stall.json          # 2x2 open-air stall
    well.json                  # 1x1 water source
    watchtower.json            # 2x3 guard tower
    tavern.json                # 4x4 inn with beds, bar
```

---

### Task 1: ChunkData Resource + SeedHasher

**Files:**
- Create: `scripts/core/world_compiler/chunk_data.gd`
- Create: `scripts/core/world_compiler/seed_hasher.gd`

- [ ] **Step 1: Create SeedHasher**

```gdscript
# scripts/core/world_compiler/seed_hasher.gd
class_name SeedHasher

## Derives deterministic sub-seeds for each layer from a world seed + chunk coords.
## Uses avalanche-quality hashing because Godot's RandomNumberGenerator lacks avalanche effect.

static func hash_seed(world_seed: int, chunk_x: int, chunk_y: int, layer_id: int) -> int:
	var h = world_seed
	h = _mix(h, chunk_x)
	h = _mix(h, chunk_y)
	h = _mix(h, layer_id)
	return h & 0x7FFFFFFF  # positive int

static func _mix(h: int, val: int) -> int:
	h = h ^ (val * 0x9E3779B9)
	h = (h ^ (h >> 16)) * 0x85EBCA6B
	h = (h ^ (h >> 13)) * 0xC2B2AE35
	h = h ^ (h >> 16)
	return h
```

- [ ] **Step 2: Create ChunkData resource**

```gdscript
# scripts/core/world_compiler/chunk_data.gd
class_name ChunkData
extends Resource

## Holds all compiled grid data for a 256x256 chunk.
## Each layer writes its output here; later layers read earlier outputs.

const SIZE: int = 256

var chunk_x: int = 0
var chunk_y: int = 0
var world_seed: int = 0
var compiler_version: String = "0.1.0"

# L1: Elevation
var elevation: PackedFloat32Array       # SIZE*SIZE, row-major
var slope: PackedFloat32Array           # SIZE*SIZE

# L2: Ocean mask
var ocean_mask: PackedByteArray         # SIZE*SIZE, 0=land 1=ocean

# L3: Drainage
var corrected_elevation: PackedFloat32Array
var basin_ids: PackedInt32Array         # SIZE*SIZE

# L4: Rivers & Lakes
var flow_dir: PackedByteArray           # SIZE*SIZE, D8 direction 0-7
var flow_accum: PackedInt32Array        # SIZE*SIZE
var river_cells: Dictionary = {}       # Vector2i → river_order (int)
var lake_cells: Dictionary = {}        # Vector2i → lake_id (int)

# L5: Climate
var temperature: PackedFloat32Array
var precipitation: PackedFloat32Array

# L6: Biomes
var biome_id: PackedByteArray           # SIZE*SIZE, enum index

# L7: Soil
var fertility: PackedByteArray          # SIZE*SIZE, 0-255

# L8: Vegetation
var vegetation_density: PackedByteArray # SIZE*SIZE, 0-255
var vegetation_species: PackedByteArray # SIZE*SIZE, species class

# L9: Coastal
var coast_type: PackedByteArray         # SIZE*SIZE, 0=none 1=beach 2=cliff 3=marsh 4=dune

# L10: Roads
var road_cost: PackedFloat32Array       # SIZE*SIZE
var road_cells: Dictionary = {}        # Vector2i → road_type (int)

# L11: Settlements
var walkability: PackedFloat32Array     # SIZE*SIZE, -1=impassable, 1.0=normal
var settlement_suitability: PackedFloat32Array
var structures: Array = []             # Array of structure dicts
var building_tiles: Dictionary = {}    # Vector2i → {type, material, z_index}

# L13: POIs
var pois: Array = []                   # Array of POI dicts

# L14: Events
var events: Array = []                 # Array of event dicts

func _init():
	var total = SIZE * SIZE
	elevation = PackedFloat32Array()
	elevation.resize(total)
	slope = PackedFloat32Array()
	slope.resize(total)
	ocean_mask = PackedByteArray()
	ocean_mask.resize(total)
	corrected_elevation = PackedFloat32Array()
	corrected_elevation.resize(total)
	basin_ids = PackedInt32Array()
	basin_ids.resize(total)
	flow_dir = PackedByteArray()
	flow_dir.resize(total)
	flow_accum = PackedInt32Array()
	flow_accum.resize(total)
	temperature = PackedFloat32Array()
	temperature.resize(total)
	precipitation = PackedFloat32Array()
	precipitation.resize(total)
	biome_id = PackedByteArray()
	biome_id.resize(total)
	fertility = PackedByteArray()
	fertility.resize(total)
	vegetation_density = PackedByteArray()
	vegetation_density.resize(total)
	vegetation_species = PackedByteArray()
	vegetation_species.resize(total)
	coast_type = PackedByteArray()
	coast_type.resize(total)
	road_cost = PackedFloat32Array()
	road_cost.resize(total)
	walkability = PackedFloat32Array()
	walkability.resize(total)
	settlement_suitability = PackedFloat32Array()
	settlement_suitability.resize(total)

## Helper: get/set by x,y coordinates
func idx(x: int, y: int) -> int:
	return y * SIZE + x

func get_elevation(x: int, y: int) -> float:
	return elevation[idx(x, y)]

func set_elevation(x: int, y: int, val: float) -> void:
	elevation[idx(x, y)] = val

func is_ocean(x: int, y: int) -> bool:
	return ocean_mask[idx(x, y)] == 1

func get_biome(x: int, y: int) -> int:
	return biome_id[idx(x, y)]

func get_fertility(x: int, y: int) -> int:
	return fertility[idx(x, y)]

func get_walkability(x: int, y: int) -> float:
	return walkability[idx(x, y)]

func get_deterministic_hash() -> String:
	var ctx = HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(elevation.to_byte_array())
	ctx.update(ocean_mask)
	ctx.update(biome_id)
	ctx.update(fertility)
	return ctx.finish().hex_encode()
```

- [ ] **Step 3: Verify SeedHasher produces distinct seeds**

```gdscript
# Quick verification in Godot console or test scene:
# SeedHasher.hash_seed(42, 0, 0, 1) != SeedHasher.hash_seed(42, 0, 0, 2)
# SeedHasher.hash_seed(42, 0, 0, 1) != SeedHasher.hash_seed(42, 1, 0, 1)
# SeedHasher.hash_seed(42, 0, 0, 1) == SeedHasher.hash_seed(42, 0, 0, 1)  # deterministic
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/chunk_data.gd scripts/core/world_compiler/seed_hasher.gd
git commit -m "feat(world-compiler): ChunkData resource + SeedHasher for deterministic sub-seeds"
```

---

### Task 2: LayerBase + WorldCompiler Orchestrator

**Files:**
- Create: `scripts/core/world_compiler/layer_base.gd`
- Create: `scripts/core/world_compiler/world_compiler.gd`

- [ ] **Step 1: Create LayerBase**

```gdscript
# scripts/core/world_compiler/layer_base.gd
class_name LayerBase

## Base class for all compiler layers.
## Each layer reads from ChunkData (earlier layers) and writes to ChunkData.

var layer_name: String = "base"
var layer_id: int = 0

func compile(chunk: ChunkData, seed: int) -> void:
	push_error("LayerBase.compile() not overridden in " + layer_name)

func validate(chunk: ChunkData) -> Array:
	## Returns array of error strings. Empty = passed.
	return []

func get_debug_image(chunk: ChunkData) -> Image:
	## Returns a 256x256 debug visualization. Override per layer.
	return Image.create(ChunkData.SIZE, ChunkData.SIZE, false, Image.FORMAT_RGB8)
```

- [ ] **Step 2: Create WorldCompiler orchestrator**

```gdscript
# scripts/core/world_compiler/world_compiler.gd
class_name WorldCompiler

## Orchestrates the 14-layer compilation pipeline.
## Runs layers in dependency order, validates after each layer.

var layers: Array = []  # Array of LayerBase instances
var world_seed: int = 42
var _compiled_chunks: Dictionary = {}  # Vector2i → ChunkData

func _init(seed: int = 42):
	world_seed = seed
	_init_layers()

func _init_layers():
	layers = []
	# Layers added in dependency order
	# Each layer class will be added as implemented
	# For now, start with elevation only

func register_layer(layer: LayerBase) -> void:
	layers.append(layer)

func compile_chunk(chunk_x: int, chunk_y: int) -> ChunkData:
	var key = Vector2i(chunk_x, chunk_y)
	if _compiled_chunks.has(key):
		return _compiled_chunks[key]
	
	var chunk = ChunkData.new()
	chunk.chunk_x = chunk_x
	chunk.chunk_y = chunk_y
	chunk.world_seed = world_seed
	
	for layer in layers:
		var layer_seed = SeedHasher.hash_seed(world_seed, chunk_x, chunk_y, layer.layer_id)
		layer.compile(chunk, layer_seed)
		
		var errors = layer.validate(chunk)
		if errors.size() > 0:
			for err in errors:
				push_warning("[WorldCompiler] %s validation: %s" % [layer.layer_name, err])
	
	_compiled_chunks[key] = chunk
	return chunk

func get_chunk(chunk_x: int, chunk_y: int) -> ChunkData:
	var key = Vector2i(chunk_x, chunk_y)
	if _compiled_chunks.has(key):
		return _compiled_chunks[key]
	return null

func get_debug_image(chunk_x: int, chunk_y: int, layer_index: int) -> Image:
	var chunk = get_chunk(chunk_x, chunk_y)
	if chunk == null or layer_index >= layers.size():
		return Image.create(ChunkData.SIZE, ChunkData.SIZE, false, Image.FORMAT_RGB8)
	return layers[layer_index].get_debug_image(chunk)

func get_layer_names() -> Array:
	var names = []
	for layer in layers:
		names.append(layer.layer_name)
	return names
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/layer_base.gd scripts/core/world_compiler/world_compiler.gd
git commit -m "feat(world-compiler): LayerBase + WorldCompiler orchestrator"
```

---

### Task 3: ElevationLayer (L1)

**Files:**
- Create: `scripts/core/world_compiler/layers/elevation_layer.gd`

- [ ] **Step 1: Implement ElevationLayer**

Adapts existing TerrainGenerator noise logic but outputs to ChunkData grids instead of GrainStacks.

```gdscript
# scripts/core/world_compiler/layers/elevation_layer.gd
class_name ElevationLayer
extends LayerBase

## L1: Generates elevation grid from multi-octave noise.
## Outputs: elevation (float32), slope (float32)

var noise: FastNoiseLite

func _init():
	layer_name = "elevation"
	layer_id = 1

func compile(chunk: ChunkData, seed: int) -> void:
	noise = FastNoiseLite.new()
	noise.seed = seed
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 6
	noise.frequency = 0.0008
	
	var size = ChunkData.SIZE
	var origin_x = chunk.chunk_x * size
	var origin_y = chunk.chunk_y * size
	
	# Generate elevation
	for y in range(size):
		for x in range(size):
			var wx = origin_x + x
			var wy = origin_y + y
			var h = _sample_elevation(wx, wy)
			chunk.set_elevation(x, y, h)
	
	# Calculate slope from elevation gradients
	for y in range(size):
		for x in range(size):
			var s = _calc_slope(chunk, x, y)
			chunk.slope[chunk.idx(x, y)] = s

func _sample_elevation(wx: int, wy: int) -> float:
	# Multi-scale sampling for continental shapes + mountain detail
	var continental = noise.get_noise_2d(wx * 0.0008, wy * 0.0008) * 0.35
	
	# Ridge noise for mountain spines
	var ridge_noise = FastNoiseLite.new()
	ridge_noise.seed = noise.seed + 1000
	ridge_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	ridge_noise.frequency = 0.003
	var ridge = abs(ridge_noise.get_noise_2d(wx, wy)) * 0.25
	
	# Medium detail
	var med = noise.get_noise_2d(wx * 0.012, wy * 0.012) * 0.15
	
	# Fine detail
	var fine = noise.get_noise_2d(wx * 0.05, wy * 0.05) * 0.1
	
	var h = continental + ridge + med + fine + 0.5  # Normalize to ~0-1
	return clampf(h, 0.0, 1.0)

func _calc_slope(chunk: ChunkData, x: int, y: int) -> float:
	var size = ChunkData.SIZE
	var h = chunk.get_elevation(x, y)
	var dx = 0.0
	var dy = 0.0
	if x > 0 and x < size - 1:
		dx = chunk.get_elevation(x + 1, y) - chunk.get_elevation(x - 1, y)
	if y > 0 and y < size - 1:
		dy = chunk.get_elevation(x, y + 1) - chunk.get_elevation(x, y - 1)
	return sqrt(dx * dx + dy * dy)

func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	# Check no extreme spikes (elevation should be smooth)
	for y in range(1, size - 1):
		for x in range(1, size - 1):
			var h = chunk.get_elevation(x, y)
			var avg_neighbors = (
				chunk.get_elevation(x-1, y) + chunk.get_elevation(x+1, y) +
				chunk.get_elevation(x, y-1) + chunk.get_elevation(x, y+1)
			) / 4.0
			if abs(h - avg_neighbors) > 0.3:
				errors.append("Elevation spike at (%d,%d): %.2f vs avg %.2f" % [x, y, h, avg_neighbors])
				if errors.size() > 10:
					return errors  # Don't flood
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			# Green-brown-white gradient for elevation
			var color: Color
			if h < 0.3:
				color = Color(0.1, 0.2, 0.5)  # Deep blue (low)
			elif h < 0.5:
				color = Color(0.2, 0.6, 0.2)  # Green
			elif h < 0.7:
				color = Color(0.5, 0.4, 0.2)  # Brown
			elif h < 0.85:
				color = Color(0.6, 0.6, 0.6)  # Gray
			else:
				color = Color(0.9, 0.9, 0.95)  # White (peaks)
			img.set_pixel(x, y, color)
	return img
```

- [ ] **Step 2: Register in WorldCompiler**

Add to `WorldCompiler._init_layers()`:
```gdscript
func _init_layers():
	layers = []
	var elev = ElevationLayer.new()
	register_layer(elev)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/layers/elevation_layer.gd
git commit -m "feat(world-compiler): L1 ElevationLayer with noise sampling + slope + debug view"
```

---

### Task 4: OceanMaskLayer (L2) + DrainageLayer (L3)

**Files:**
- Create: `scripts/core/world_compiler/layers/ocean_mask_layer.gd`
- Create: `scripts/core/world_compiler/layers/drainage_layer.gd`

- [ ] **Step 1: Implement OceanMaskLayer**

```gdscript
# scripts/core/world_compiler/layers/ocean_mask_layer.gd
class_name OceanMaskLayer
extends LayerBase

## L2: Applies sea-level threshold to elevation → binary ocean/land mask.

const SEA_LEVEL: float = 0.38

func _init():
	layer_name = "ocean_mask"
	layer_id = 2

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			chunk.ocean_mask[chunk.idx(x, y)] = 1 if h < SEA_LEVEL else 0

func validate(chunk: ChunkData) -> Array:
	# Count ocean vs land ratio as sanity check
	var ocean_count = 0
	var total = ChunkData.SIZE * ChunkData.SIZE
	for i in range(total):
		if chunk.ocean_mask[i] == 1:
			ocean_count += 1
	var ratio = float(ocean_count) / total
	var errors = []
	if ratio > 0.99:
		errors.append("Chunk is >99%% ocean (%.1f%%)" % [ratio * 100])
	if ratio < 0.01 and chunk.chunk_x == 0 and chunk.chunk_y == 0:
		pass  # Starting chunk being all land is fine
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.2, 0.6))
			else:
				img.set_pixel(x, y, Color(0.3, 0.7, 0.3))
	return img
```

- [ ] **Step 2: Implement DrainageLayer (Priority-Flood)**

```gdscript
# scripts/core/world_compiler/layers/drainage_layer.gd
class_name DrainageLayer
extends LayerBase

## L3: Priority-Flood pit correction ensures every land cell drains to ocean or edge.
## Guarantees no unflagged inland pits before flow direction assignment.

func _init():
	layer_name = "drainage"
	layer_id = 3

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	
	# Copy elevation for correction
	for i in range(size * size):
		chunk.corrected_elevation[i] = chunk.elevation[i]
	
	# Priority-Flood: process cells in elevation order from edges inward
	# Uses a min-heap (simulated with sorted array for simplicity)
	var visited = PackedByteArray()
	visited.resize(size * size)
	visited.fill(0)
	
	# Heap entries: [elevation, x, y]
	var heap: Array = []
	var basin_counter = 0
	chunk.basin_ids.fill(-1)
	
	# Seed heap with edge cells and ocean cells
	for y in range(size):
		for x in range(size):
			if x == 0 or x == size - 1 or y == 0 or y == size - 1 or chunk.is_ocean(x, y):
				var idx = chunk.idx(x, y)
				heap.append([chunk.corrected_elevation[idx], x, y])
				visited[idx] = 1
				chunk.basin_ids[idx] = basin_counter
				basin_counter += 1
	
	# Sort heap by elevation (ascending)
	heap.sort_custom(func(a, b): return a[0] < b[0])
	
	# D8 neighbor offsets
	var dx = [-1, 0, 1, -1, 1, -1, 0, 1]
	var dy = [-1, -1, -1, 0, 0, 1, 1, 1]
	
	var head = 0
	while head < heap.size():
		var entry = heap[head]
		head += 1
		var elev = entry[0]
		var cx = entry[1]
		var cy = entry[2]
		var c_idx = chunk.idx(cx, cy)
		
		for d in range(8):
			var nx = cx + dx[d]
			var ny = cy + dy[d]
			if nx < 0 or nx >= size or ny < 0 or ny >= size:
				continue
			var n_idx = chunk.idx(nx, ny)
			if visited[n_idx] == 1:
				continue
			visited[n_idx] = 1
			
			# If neighbor is lower than current, raise it (fill pit)
			if chunk.corrected_elevation[n_idx] < elev:
				chunk.corrected_elevation[n_idx] = elev
			
			# Assign to same basin
			chunk.basin_ids[n_idx] = chunk.basin_ids[c_idx]
			
			# Insert into heap (maintain sort — simple insertion)
			var n_elev = chunk.corrected_elevation[n_idx]
			# Binary search for insertion point
			var insert_pos = head
			while insert_pos < heap.size() and heap[insert_pos][0] < n_elev:
				insert_pos += 1
			heap.insert(insert_pos, [n_elev, nx, ny])

func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	# Every land cell should have a non-negative basin ID
	for y in range(size):
		for x in range(size):
			if not chunk.is_ocean(x, y):
				if chunk.basin_ids[chunk.idx(x, y)] < 0:
					errors.append("Land cell (%d,%d) has no basin assignment" % [x, y])
					if errors.size() > 5:
						return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	# Color each basin with a deterministic color
	for y in range(size):
		for x in range(size):
			var bid = chunk.basin_ids[chunk.idx(x, y)]
			if bid < 0 or chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				var r = fmod(bid * 0.618033988, 1.0)
				var g = fmod(bid * 0.381966011, 1.0)
				var b = fmod(bid * 0.247213595, 1.0)
				img.set_pixel(x, y, Color(r * 0.7 + 0.3, g * 0.7 + 0.3, b * 0.7 + 0.3))
	return img
```

- [ ] **Step 3: Register both in WorldCompiler**

Update `WorldCompiler._init_layers()`:
```gdscript
func _init_layers():
	layers = []
	register_layer(ElevationLayer.new())
	register_layer(OceanMaskLayer.new())
	register_layer(DrainageLayer.new())
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/layers/ocean_mask_layer.gd scripts/core/world_compiler/layers/drainage_layer.gd
git commit -m "feat(world-compiler): L2 OceanMask + L3 Drainage (Priority-Flood pit correction)"
```

---

### Task 5: RiversLakesLayer (L4)

**Files:**
- Create: `scripts/core/world_compiler/layers/rivers_lakes_layer.gd`

- [ ] **Step 1: Implement D8 flow + river extraction**

```gdscript
# scripts/core/world_compiler/layers/rivers_lakes_layer.gd
class_name RiversLakesLayer
extends LayerBase

## L4: D8 flow direction → flow accumulation → river extraction + lake detection.

const RIVER_THRESHOLD: int = 50  # Minimum accumulation to be a river cell
const MIN_RIVER_ORDER: int = 1

# D8 neighbor offsets (same order as drainage)
var _dx = [-1, 0, 1, -1, 1, -1, 0, 1]
var _dy = [-1, -1, -1, 0, 0, 1, 1, 1]

func _init():
	layer_name = "rivers_lakes"
	layer_id = 4

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	
	# Step 1: Compute D8 flow direction
	_compute_flow_direction(chunk, size)
	
	# Step 2: Compute flow accumulation
	_compute_flow_accumulation(chunk, size)
	
	# Step 3: Extract river cells
	_extract_rivers(chunk, size)
	
	# Step 4: Detect lake cells (low points that aren't ocean)
	_detect_lakes(chunk, size)

func _compute_flow_direction(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.flow_dir[idx] = 255  # No flow for ocean
				continue
			
			var h = chunk.corrected_elevation[idx]
			var steepest_drop = 0.0
			var best_dir = 255  # No valid direction
			
			for d in range(8):
				var nx = x + _dx[d]
				var ny = y + _dy[d]
				if nx < 0 or nx >= size or ny < 0 or ny >= size:
					# Edge cells flow off-map
					best_dir = d
					steepest_drop = 0.01
					continue
				var n_idx = chunk.idx(nx, ny)
				var nh = chunk.corrected_elevation[n_idx]
				var drop = h - nh
				# Diagonal distance is sqrt(2)
				if d == 0 or d == 2 or d == 5 or d == 7:
					drop /= 1.414
				if drop > steepest_drop:
					steepest_drop = drop
					best_dir = d
			
			chunk.flow_dir[idx] = best_dir

func _compute_flow_accumulation(chunk: ChunkData, size: int) -> void:
	# Count how many cells flow into each cell
	chunk.flow_accum.fill(1)  # Each cell contributes 1 (itself)
	
	# Build in-degree count and topological sort
	var in_degree = PackedInt32Array()
	in_degree.resize(size * size)
	in_degree.fill(0)
	
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			var dir = chunk.flow_dir[idx]
			if dir >= 8:
				continue
			var nx = x + _dx[dir]
			var ny = y + _dy[dir]
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				in_degree[chunk.idx(nx, ny)] += 1
	
	# Start from cells with no incoming flow (headwaters)
	var queue: Array = []
	for i in range(size * size):
		if in_degree[i] == 0:
			queue.append(i)
	
	var head = 0
	while head < queue.size():
		var idx = queue[head]
		head += 1
		var x = idx % size
		var y = idx / size
		var dir = chunk.flow_dir[idx]
		if dir >= 8:
			continue
		var nx = x + _dx[dir]
		var ny = y + _dy[dir]
		if nx < 0 or nx >= size or ny < 0 or ny >= size:
			continue
		var n_idx = chunk.idx(nx, ny)
		chunk.flow_accum[n_idx] += chunk.flow_accum[idx]
		in_degree[n_idx] -= 1
		if in_degree[n_idx] == 0:
			queue.append(n_idx)

func _extract_rivers(chunk: ChunkData, size: int) -> void:
	chunk.river_cells.clear()
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				continue
			var accum = chunk.flow_accum[idx]
			if accum >= RIVER_THRESHOLD:
				# Simple Strahler-like order based on accumulation
				var order = 1
				if accum > 200:
					order = 2
				if accum > 500:
					order = 3
				if accum > 1000:
					order = 4
				chunk.river_cells[Vector2i(x, y)] = order

func _detect_lakes(chunk: ChunkData, size: int) -> void:
	chunk.lake_cells.clear()
	# Lakes form where corrected elevation was raised (pit was filled)
	var lake_id = 0
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				continue
			var orig = chunk.elevation[idx]
			var corrected = chunk.corrected_elevation[idx]
			if corrected - orig > 0.01:  # Pit was filled significantly
				chunk.lake_cells[Vector2i(x, y)] = lake_id
				# Flood fill would assign same lake_id to connected pit cells
				# Simplified: each pit cell gets its own ID for now
				lake_id += 1

func validate(chunk: ChunkData) -> Array:
	var errors = []
	# Check river cells have monotonically decreasing elevation downstream
	for pos in chunk.river_cells:
		var idx = chunk.idx(pos.x, pos.y)
		var dir = chunk.flow_dir[idx]
		if dir >= 8:
			continue
		var nx = pos.x + _dx[dir]
		var ny = pos.y + _dy[dir]
		if nx < 0 or nx >= ChunkData.SIZE or ny < 0 or ny >= ChunkData.SIZE:
			continue
		var h = chunk.corrected_elevation[idx]
		var nh = chunk.corrected_elevation[chunk.idx(nx, ny)]
		if nh > h + 0.001:
			errors.append("River flows uphill at (%d,%d): %.3f → %.3f" % [pos.x, pos.y, h, nh])
			if errors.size() > 5:
				return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	# Background: elevation
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.05, 0.1, 0.3))
			else:
				img.set_pixel(x, y, Color(h * 0.5, h * 0.6, h * 0.3))
	# Rivers in blue (thicker = higher order)
	for pos in chunk.river_cells:
		var order = chunk.river_cells[pos]
		var blue = Color(0.2, 0.4, 0.9)
		img.set_pixel(pos.x, pos.y, blue)
	# Lakes in cyan
	for pos in chunk.lake_cells:
		img.set_pixel(pos.x, pos.y, Color(0.2, 0.7, 0.8))
	return img
```

- [ ] **Step 2: Register in WorldCompiler**

```gdscript
func _init_layers():
	layers = []
	register_layer(ElevationLayer.new())
	register_layer(OceanMaskLayer.new())
	register_layer(DrainageLayer.new())
	register_layer(RiversLakesLayer.new())
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/layers/rivers_lakes_layer.gd
git commit -m "feat(world-compiler): L4 RiversLakes with D8 flow, accumulation, Strahler order"
```

---

### Task 6: ClimateLayer (L5) + BiomeLayer (L6)

**Files:**
- Create: `scripts/core/world_compiler/layers/climate_layer.gd`
- Create: `scripts/core/world_compiler/layers/biome_layer.gd`

- [ ] **Step 1: Implement ClimateLayer**

```gdscript
# scripts/core/world_compiler/layers/climate_layer.gd
class_name ClimateLayer
extends LayerBase

## L5: Temperature + precipitation from latitude, elevation, ocean distance, rain shadow.

func _init():
	layer_name = "climate"
	layer_id = 5

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var origin_x = chunk.chunk_x * size
	var origin_y = chunk.chunk_y * size
	
	# Moisture noise for precipitation variation
	var moisture_noise = FastNoiseLite.new()
	moisture_noise.seed = seed
	moisture_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	moisture_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	moisture_noise.fractal_octaves = 4
	moisture_noise.frequency = 0.002
	
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			var wx = origin_x + x
			var wy = origin_y + y
			var h = chunk.get_elevation(x, y)
			var is_ocean_cell = chunk.is_ocean(x, y)
			
			# Temperature: base from latitude proxy (wy), reduced by altitude
			var lat_factor = 1.0 - abs(float(wy) / 2048.0)  # Warmer near y=0
			lat_factor = clampf(lat_factor, 0.0, 1.0)
			var temp = lat_factor * 0.8 + 0.1
			# Altitude lapse rate
			if h > 0.5:
				temp -= (h - 0.5) * 0.7
			temp = clampf(temp, 0.0, 1.0)
			chunk.temperature[idx] = temp
			
			# Precipitation: base from moisture noise + ocean proximity boost
			var moist = (moisture_noise.get_noise_2d(wx, wy) + 1.0) * 0.5
			# Ocean proximity increases moisture
			var ocean_dist = _distance_to_ocean(chunk, x, y, size)
			if ocean_dist < 20:
				moist += (20.0 - ocean_dist) / 20.0 * 0.3
			# Rain shadow: reduce moisture behind mountains
			# Simplified: check if upwind cells have high elevation
			if x > 5:
				var upwind_h = chunk.get_elevation(x - 5, y)
				if upwind_h > 0.75:
					moist *= 0.5  # Rain shadow effect
			moist = clampf(moist, 0.0, 1.0)
			chunk.precipitation[idx] = moist

func _distance_to_ocean(chunk: ChunkData, x: int, y: int, size: int) -> float:
	# Quick scan in cardinal directions for nearest ocean cell
	var min_dist = 999.0
	for radius in range(1, 30):
		for dir in [[1,0],[-1,0],[0,1],[0,-1]]:
			var nx = x + dir[0] * radius
			var ny = y + dir[1] * radius
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				if chunk.is_ocean(nx, ny):
					if radius < min_dist:
						min_dist = radius
		if min_dist < 999.0:
			break
	return min_dist

func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			var t = chunk.temperature[idx]
			var h = chunk.get_elevation(x, y)
			# No hot high peaks (unless volcanic — skip for now)
			if h > 0.85 and t > 0.7:
				errors.append("Hot mountain peak at (%d,%d): elev=%.2f temp=%.2f" % [x, y, h, t])
				if errors.size() > 5:
					return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			var t = chunk.temperature[idx]
			var p = chunk.precipitation[idx]
			# Red=hot, Blue=cold, Green=wet
			img.set_pixel(x, y, Color(t, p * 0.5, 1.0 - t))
	return img
```

- [ ] **Step 2: Implement BiomeLayer (Whittaker lookup)**

```gdscript
# scripts/core/world_compiler/layers/biome_layer.gd
class_name BiomeLayer
extends LayerBase

## L6: Whittaker-style biome classification from temperature + precipitation.
## Data-driven lookup table, NOT nested if/else.

enum Biome {
	OCEAN, BEACH, GRASSLAND, FOREST, DENSE_FOREST, DESERT,
	SAVANNA, STEPPE, TUNDRA, TAIGA, MOUNTAINS, SWAMP,
	TROPICAL_FOREST, VOLCANIC, ARCTIC, LAKE, RIVER
}

# Whittaker rules: [temp_min, temp_max, precip_min, precip_max, biome]
var _rules: Array = []

func _init():
	layer_name = "biomes"
	layer_id = 6
	_init_rules()

func _init_rules():
	# Rules checked in order — first match wins
	# More specific rules first
	_rules = [
		# Extreme cold
		[0.0, 0.15, 0.0, 1.0, Biome.ARCTIC],
		# Cold + dry = tundra
		[0.15, 0.3, 0.0, 0.4, Biome.TUNDRA],
		# Cold + wet = taiga
		[0.15, 0.3, 0.4, 1.0, Biome.TAIGA],
		# Hot + dry = desert
		[0.6, 1.0, 0.0, 0.2, Biome.DESERT],
		# Hot + moderate = savanna
		[0.6, 1.0, 0.2, 0.5, Biome.SAVANNA],
		# Hot + wet = tropical forest
		[0.6, 1.0, 0.5, 1.0, Biome.TROPICAL_FOREST],
		# Moderate + dry = steppe
		[0.3, 0.6, 0.0, 0.3, Biome.STEPPE],
		# Moderate + moderate = grassland
		[0.3, 0.6, 0.3, 0.55, Biome.GRASSLAND],
		# Moderate + wet = forest
		[0.3, 0.6, 0.55, 0.75, Biome.FOREST],
		# Moderate + very wet = dense forest
		[0.3, 0.6, 0.75, 1.0, Biome.DENSE_FOREST],
	]

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			
			# Ocean cells
			if chunk.is_ocean(x, y):
				chunk.biome_id[idx] = Biome.OCEAN
				continue
			
			# River cells
			if chunk.river_cells.has(Vector2i(x, y)):
				chunk.biome_id[idx] = Biome.RIVER
				continue
			
			# Lake cells
			if chunk.lake_cells.has(Vector2i(x, y)):
				chunk.biome_id[idx] = Biome.LAKE
				continue
			
			var h = chunk.get_elevation(x, y)
			var t = chunk.temperature[idx]
			var p = chunk.precipitation[idx]
			
			# High elevation override
			if h > 0.82:
				chunk.biome_id[idx] = Biome.MOUNTAINS
				continue
			
			# Beach: near ocean and low elevation
			if h < 0.42 and _near_ocean(chunk, x, y, size):
				chunk.biome_id[idx] = Biome.BEACH
				continue
			
			# Very wet lowlands = swamp
			if p > 0.8 and h < 0.5 and t > 0.3:
				chunk.biome_id[idx] = Biome.SWAMP
				continue
			
			# Whittaker rules
			var biome = Biome.GRASSLAND  # Default fallback
			for rule in _rules:
				if t >= rule[0] and t < rule[1] and p >= rule[2] and p < rule[3]:
					biome = rule[4]
					break
			
			chunk.biome_id[idx] = biome

func _near_ocean(chunk: ChunkData, x: int, y: int, size: int) -> bool:
	for dy in range(-3, 4):
		for dx in range(-3, 4):
			var nx = x + dx
			var ny = y + dy
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				if chunk.is_ocean(nx, ny):
					return true
	return false

static func biome_name(b: int) -> String:
	match b:
		Biome.OCEAN: return "ocean"
		Biome.BEACH: return "beach"
		Biome.GRASSLAND: return "grassland"
		Biome.FOREST: return "forest"
		Biome.DENSE_FOREST: return "dense_forest"
		Biome.DESERT: return "desert"
		Biome.SAVANNA: return "savanna"
		Biome.STEPPE: return "steppe"
		Biome.TUNDRA: return "tundra"
		Biome.TAIGA: return "taiga"
		Biome.MOUNTAINS: return "mountains"
		Biome.SWAMP: return "swamp"
		Biome.TROPICAL_FOREST: return "tropical_forest"
		Biome.VOLCANIC: return "volcanic"
		Biome.ARCTIC: return "arctic"
		Biome.LAKE: return "lake"
		Biome.RIVER: return "river"
		_: return "unknown"

# Biome → display color for debug view
static func biome_color(b: int) -> Color:
	match b:
		Biome.OCEAN: return Color(0.1, 0.2, 0.5)
		Biome.BEACH: return Color(0.9, 0.85, 0.6)
		Biome.GRASSLAND: return Color(0.4, 0.75, 0.3)
		Biome.FOREST: return Color(0.15, 0.5, 0.15)
		Biome.DENSE_FOREST: return Color(0.05, 0.35, 0.1)
		Biome.DESERT: return Color(0.85, 0.75, 0.45)
		Biome.SAVANNA: return Color(0.7, 0.65, 0.3)
		Biome.STEPPE: return Color(0.6, 0.55, 0.35)
		Biome.TUNDRA: return Color(0.7, 0.75, 0.8)
		Biome.TAIGA: return Color(0.2, 0.4, 0.3)
		Biome.MOUNTAINS: return Color(0.55, 0.55, 0.55)
		Biome.SWAMP: return Color(0.3, 0.4, 0.25)
		Biome.TROPICAL_FOREST: return Color(0.1, 0.6, 0.2)
		Biome.VOLCANIC: return Color(0.6, 0.2, 0.1)
		Biome.ARCTIC: return Color(0.85, 0.9, 0.95)
		Biome.LAKE: return Color(0.2, 0.5, 0.8)
		Biome.RIVER: return Color(0.3, 0.5, 0.9)
		_: return Color(1, 0, 1)  # Magenta = unmapped

func validate(chunk: ChunkData) -> Array:
	var errors = []
	# Check no biome checkerboarding (adjacent cells shouldn't flip rapidly)
	var size = ChunkData.SIZE
	var flips = 0
	for y in range(1, size - 1):
		for x in range(1, size - 1):
			var b = chunk.get_biome(x, y)
			var br = chunk.get_biome(x + 1, y)
			var bd = chunk.get_biome(x, y + 1)
			if b != br and br != chunk.get_biome(x + 2 if x + 2 < size else x + 1, y):
				flips += 1
	if flips > size * size * 0.1:
		errors.append("Excessive biome checkerboarding: %d flips" % flips)
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var b = chunk.get_biome(x, y)
			img.set_pixel(x, y, BiomeLayer.biome_color(b))
	return img
```

- [ ] **Step 3: Register in WorldCompiler**

```gdscript
func _init_layers():
	layers = []
	register_layer(ElevationLayer.new())
	register_layer(OceanMaskLayer.new())
	register_layer(DrainageLayer.new())
	register_layer(RiversLakesLayer.new())
	register_layer(ClimateLayer.new())
	register_layer(BiomeLayer.new())
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/layers/climate_layer.gd scripts/core/world_compiler/layers/biome_layer.gd
git commit -m "feat(world-compiler): L5 Climate (temp/precip) + L6 Biomes (Whittaker lookup)"
```

---

### Task 7: SoilFertilityLayer (L7) + VegetationLayer (L8) + CoastalLayer (L9)

**Files:**
- Create: `scripts/core/world_compiler/layers/soil_fertility_layer.gd`
- Create: `scripts/core/world_compiler/layers/vegetation_layer.gd`
- Create: `scripts/core/world_compiler/layers/coastal_layer.gd`

- [ ] **Step 1: Implement SoilFertilityLayer**

```gdscript
# scripts/core/world_compiler/layers/soil_fertility_layer.gd
class_name SoilFertilityLayer
extends LayerBase

## L7: Soil quality and fertility from elevation, slope, water proximity, biome.

func _init():
	layer_name = "soil_fertility"
	layer_id = 7

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.fertility[idx] = 0
				continue
			
			var h = chunk.get_elevation(x, y)
			var s = chunk.slope[idx]
			var p = chunk.precipitation[idx]
			var t = chunk.temperature[idx]
			var biome = chunk.get_biome(x, y)
			
			var fert = 0.5  # Base fertility
			
			# Slope penalty (steep = poor soil)
			fert -= s * 3.0
			
			# Water proximity boost
			var near_water = chunk.river_cells.has(Vector2i(x, y)) or chunk.lake_cells.has(Vector2i(x, y))
			if not near_water:
				for dy in range(-5, 6):
					for dx in range(-5, 6):
						if chunk.river_cells.has(Vector2i(x + dx, y + dy)):
							var dist = sqrt(dx * dx + dy * dy)
							fert += (5.0 - dist) / 5.0 * 0.3  # Floodplain boost
							near_water = true
							break
					if near_water:
						break
			
			# Precipitation boost
			fert += p * 0.3
			
			# Temperature sweet spot (moderate temp = best)
			if t > 0.3 and t < 0.7:
				fert += 0.1
			
			# Biome modifiers
			match biome:
				BiomeLayer.Biome.DESERT: fert *= 0.2
				BiomeLayer.Biome.MOUNTAINS: fert *= 0.3
				BiomeLayer.Biome.ARCTIC: fert *= 0.1
				BiomeLayer.Biome.TUNDRA: fert *= 0.2
				BiomeLayer.Biome.SWAMP: fert *= 0.7  # Wet but acidic
				BiomeLayer.Biome.FOREST: fert *= 1.1
				BiomeLayer.Biome.GRASSLAND: fert *= 1.2
			
			chunk.fertility[idx] = clampi(int(fert * 255), 0, 255)

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var f = float(chunk.get_fertility(x, y)) / 255.0
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				img.set_pixel(x, y, Color(0.6 - f * 0.5, 0.2 + f * 0.6, 0.1))
	return img
```

- [ ] **Step 2: Implement VegetationLayer**

```gdscript
# scripts/core/world_compiler/layers/vegetation_layer.gd
class_name VegetationLayer
extends LayerBase

## L8: Vegetation density and species from biome, fertility, slope, moisture.

enum Species { NONE, GRASS, SHRUB, DECIDUOUS, CONIFER, TROPICAL, CACTUS, MOSS, FERN }

func _init():
	layer_name = "vegetation"
	layer_id = 8

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed
	
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.vegetation_density[idx] = 0
				chunk.vegetation_species[idx] = Species.NONE
				continue
			
			var fert = float(chunk.fertility[idx]) / 255.0
			var biome = chunk.get_biome(x, y)
			var s = chunk.slope[idx]
			var p = chunk.precipitation[idx]
			
			# Base density from fertility and precipitation
			var density = (fert * 0.6 + p * 0.4) * 255.0
			
			# Slope reduces vegetation
			density -= s * 200.0
			
			# Species selection based on biome
			var species = Species.GRASS
			match biome:
				BiomeLayer.Biome.FOREST:
					species = Species.DECIDUOUS
					density *= 1.3
				BiomeLayer.Biome.DENSE_FOREST:
					species = Species.DECIDUOUS
					density *= 1.5
				BiomeLayer.Biome.TAIGA:
					species = Species.CONIFER
					density *= 1.2
				BiomeLayer.Biome.TROPICAL_FOREST:
					species = Species.TROPICAL
					density *= 1.4
				BiomeLayer.Biome.DESERT:
					species = Species.CACTUS
					density *= 0.15
				BiomeLayer.Biome.TUNDRA:
					species = Species.MOSS
					density *= 0.3
				BiomeLayer.Biome.SWAMP:
					species = Species.FERN
					density *= 0.8
				BiomeLayer.Biome.STEPPE, BiomeLayer.Biome.SAVANNA:
					species = Species.SHRUB
					density *= 0.5
				BiomeLayer.Biome.MOUNTAINS:
					species = Species.CONIFER if p > 0.3 else Species.MOSS
					density *= 0.3
				BiomeLayer.Biome.GRASSLAND:
					species = Species.GRASS
				BiomeLayer.Biome.BEACH:
					species = Species.NONE
					density *= 0.05
				BiomeLayer.Biome.RIVER, BiomeLayer.Biome.LAKE:
					species = Species.NONE
					density = 0
			
			chunk.vegetation_density[idx] = clampi(int(density), 0, 255)
			chunk.vegetation_species[idx] = species

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var d = float(chunk.vegetation_density[chunk.idx(x, y)]) / 255.0
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				img.set_pixel(x, y, Color(0.4 - d * 0.3, 0.15 + d * 0.7, 0.1))
	return img
```

- [ ] **Step 3: Implement CoastalLayer**

```gdscript
# scripts/core/world_compiler/layers/coastal_layer.gd
class_name CoastalLayer
extends LayerBase

## L9: Coastal material classification (beach, cliff, marsh, dune).

enum CoastType { NONE, BEACH, CLIFF, MARSH, DUNE }

func _init():
	layer_name = "coastal"
	layer_id = 9

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			chunk.coast_type[idx] = CoastType.NONE
			
			if chunk.is_ocean(x, y):
				continue
			
			# Only classify cells near ocean
			var near_ocean = false
			for dy in range(-3, 4):
				for dx in range(-3, 4):
					var nx = x + dx
					var ny = y + dy
					if nx >= 0 and nx < size and ny >= 0 and ny < size:
						if chunk.is_ocean(nx, ny):
							near_ocean = true
							break
				if near_ocean:
					break
			
			if not near_ocean:
				continue
			
			var s = chunk.slope[idx]
			var p = chunk.precipitation[idx]
			var veg = float(chunk.vegetation_density[idx]) / 255.0
			
			if s > 0.15:
				chunk.coast_type[idx] = CoastType.CLIFF
			elif p > 0.7 and chunk.get_elevation(x, y) < 0.42:
				chunk.coast_type[idx] = CoastType.MARSH
			elif p < 0.3 and veg < 0.2:
				chunk.coast_type[idx] = CoastType.DUNE
			else:
				chunk.coast_type[idx] = CoastType.BEACH

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var ct = chunk.coast_type[chunk.idx(x, y)]
			match ct:
				CoastType.BEACH: img.set_pixel(x, y, Color(0.95, 0.9, 0.6))
				CoastType.CLIFF: img.set_pixel(x, y, Color(0.5, 0.5, 0.5))
				CoastType.MARSH: img.set_pixel(x, y, Color(0.3, 0.5, 0.3))
				CoastType.DUNE: img.set_pixel(x, y, Color(0.85, 0.8, 0.5))
				_:
					if chunk.is_ocean(x, y):
						img.set_pixel(x, y, Color(0.1, 0.2, 0.5))
					else:
						var h = chunk.get_elevation(x, y)
						img.set_pixel(x, y, Color(h * 0.4, h * 0.5, h * 0.3))
	return img
```

- [ ] **Step 4: Register all three + commit**

```gdscript
# Add to WorldCompiler._init_layers():
register_layer(SoilFertilityLayer.new())
register_layer(VegetationLayer.new())
register_layer(CoastalLayer.new())
```

```bash
git add scripts/core/world_compiler/layers/soil_fertility_layer.gd scripts/core/world_compiler/layers/vegetation_layer.gd scripts/core/world_compiler/layers/coastal_layer.gd
git commit -m "feat(world-compiler): L7 Soil/Fertility + L8 Vegetation + L9 Coastal materials"
```

---

### Task 8: DebugOverlay System

**Files:**
- Create: `scripts/core/world_compiler/debug/debug_overlay.gd`
- Create: `scripts/core/world_compiler/debug/layer_visualizer.gd`

- [ ] **Step 1: Create LayerVisualizer**

```gdscript
# scripts/core/world_compiler/debug/layer_visualizer.gd
class_name LayerVisualizer
extends Node2D

## Renders debug images from WorldCompiler layers as screen overlays.

var _overlay_sprite: Sprite2D = null
var _current_layer: int = -1  # -1 = no overlay
var _compiler: WorldCompiler = null
var _chunk_x: int = 0
var _chunk_y: int = 0

func setup(compiler: WorldCompiler) -> void:
	_compiler = compiler
	_overlay_sprite = Sprite2D.new()
	_overlay_sprite.z_index = 100
	_overlay_sprite.modulate.a = 0.7
	_overlay_sprite.visible = false
	add_child(_overlay_sprite)

func show_layer(layer_index: int, cx: int, cy: int) -> void:
	if _compiler == null:
		return
	_current_layer = layer_index
	_chunk_x = cx
	_chunk_y = cy
	var img = _compiler.get_debug_image(cx, cy, layer_index)
	if img == null:
		return
	var tex = ImageTexture.create_from_image(img)
	_overlay_sprite.texture = tex
	# Position overlay to cover the chunk area
	var world_scale = 32  # pixels per tile
	_overlay_sprite.position = Vector2(cx * ChunkData.SIZE * world_scale, cy * ChunkData.SIZE * world_scale)
	_overlay_sprite.scale = Vector2(world_scale, world_scale)
	_overlay_sprite.visible = true

func hide_overlay() -> void:
	_current_layer = -1
	if _overlay_sprite:
		_overlay_sprite.visible = false

func is_active() -> bool:
	return _current_layer >= 0
```

- [ ] **Step 2: Create DebugOverlay manager with F-key toggles**

```gdscript
# scripts/core/world_compiler/debug/debug_overlay.gd
class_name DebugOverlay
extends Node

## F1-F14 key toggles for debug layer visualization.

var _visualizer: LayerVisualizer = null
var _compiler: WorldCompiler = null
var _label: Label = null
var _current_chunk: Vector2i = Vector2i.ZERO

func setup(compiler: WorldCompiler, parent: Node2D) -> void:
	_compiler = compiler
	_visualizer = LayerVisualizer.new()
	_visualizer.setup(compiler)
	parent.add_child(_visualizer)
	
	# Debug label showing current overlay name
	_label = Label.new()
	_label.position = Vector2(10, 10)
	_label.z_index = 200
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_font_size_override("font_size", 16)
	_label.visible = false
	parent.add_child(_label)

func set_chunk(cx: int, cy: int) -> void:
	_current_chunk = Vector2i(cx, cy)
	# Refresh if overlay is active
	if _visualizer and _visualizer.is_active():
		var layer_names = _compiler.get_layer_names()
		var idx = _visualizer._current_layer
		if idx >= 0 and idx < layer_names.size():
			_visualizer.show_layer(idx, cx, cy)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var key = event.keycode
		# F1-F12 = layers 0-11, Shift+F1-F2 = layers 12-13
		var layer_index = -1
		match key:
			KEY_F1: layer_index = 0
			KEY_F2: layer_index = 1
			KEY_F3: layer_index = 2
			KEY_F4: layer_index = 3
			KEY_F5: layer_index = 4
			KEY_F6: layer_index = 5
			KEY_F7: layer_index = 6
			KEY_F8: layer_index = 7
			KEY_F9: layer_index = 8
			KEY_F10: layer_index = 9
			KEY_F11: layer_index = 10
			KEY_F12: layer_index = 11
		
		if layer_index < 0:
			return
		
		if _compiler == null:
			return
		
		var layer_names = _compiler.get_layer_names()
		if layer_index >= layer_names.size():
			return
		
		# Toggle: if same layer, hide; if different, switch
		if _visualizer._current_layer == layer_index:
			_visualizer.hide_overlay()
			_label.visible = false
		else:
			_visualizer.show_layer(layer_index, _current_chunk.x, _current_chunk.y)
			_label.text = "DEBUG: %s (F%d to toggle)" % [layer_names[layer_index], layer_index + 1]
			_label.visible = true
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/debug/debug_overlay.gd scripts/core/world_compiler/debug/layer_visualizer.gd
git commit -m "feat(world-compiler): debug overlay system with F1-F12 layer toggles"
```

---

### Task 9: DeferredRenderer

**Files:**
- Create: `scripts/core/world_compiler/deferred_renderer.gd`

- [ ] **Step 1: Implement deferred rendering that spreads nodes across frames**

```gdscript
# scripts/core/world_compiler/deferred_renderer.gd
class_name DeferredRenderer
extends Node

## Renders compiled ChunkData to Godot nodes across multiple frames.
## Never creates more than MAX_NODES_PER_FRAME nodes in a single frame.

const MAX_NODES_PER_FRAME: int = 40

signal chunk_render_complete(chunk_x: int, chunk_y: int)

var _render_queue: Array = []  # Array of callables
var _rendering: bool = false
var _parent: Node2D = null
var _tilemap: TileMapLayer = null
var _tileset: TileSet = null
var _world_scale: int = 32

func setup(parent: Node2D, world_scale: int = 32) -> void:
	_parent = parent
	_world_scale = world_scale
	_setup_tilemap()

func _setup_tilemap() -> void:
	_tileset = TileSet.new()
	_tileset.tile_size = Vector2i(32, 32)
	
	_tilemap = TileMapLayer.new()
	_tilemap.tile_set = _tileset
	_tilemap.z_index = -1
	_tilemap.scale = Vector2(_world_scale / 32.0, _world_scale / 32.0)
	_parent.add_child(_tilemap)

func render_chunk(chunk: ChunkData) -> void:
	## Queue chunk rendering phases. Each phase runs across frames.
	var cx = chunk.chunk_x
	var cy = chunk.chunk_y
	var size = ChunkData.SIZE
	var origin_x = cx * size
	var origin_y = cy * size
	
	# Phase 1: Terrain tiles (batched, no node creation)
	_render_queue.append(func(): _render_terrain_tiles(chunk, origin_x, origin_y))
	
	# Phase 2: River/lake water tiles
	_render_queue.append(func(): _render_water(chunk, origin_x, origin_y))
	
	# Phase 3: Road tiles
	_render_queue.append(func(): _render_roads(chunk, origin_x, origin_y))
	
	# Phase 4-N: Building structures (deferred per building)
	for structure in chunk.structures:
		_render_queue.append(func(): _render_structure(structure))
	
	# Phase N+1: Nature objects
	_render_queue.append(func(): _render_vegetation(chunk, origin_x, origin_y))
	
	# Final: signal complete
	_render_queue.append(func(): chunk_render_complete.emit(cx, cy))
	
	if not _rendering:
		_rendering = true
		_process_render_queue()

func _process_render_queue() -> void:
	while _render_queue.size() > 0:
		var task = _render_queue.pop_front()
		task.call()
		# Yield after each phase to prevent freezing
		await get_tree().process_frame
	_rendering = false

func _render_terrain_tiles(chunk: ChunkData, ox: int, oy: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var biome = chunk.get_biome(x, y)
			var color = BiomeLayer.biome_color(biome)
			# For now, set tilemap cells using biome colors
			# Later: use PixelLab-generated tile sources
			var world_x = ox + x
			var world_y = oy + y
			# TileMapLayer uses atlas sources — we need to set up sources per biome
			# For the initial version, we use the existing TileMapRenderer approach
			# This will be upgraded when PixelLab tile sources are generated

func _render_water(chunk: ChunkData, ox: int, oy: int) -> void:
	# Render river and lake cells as water tiles
	for pos in chunk.river_cells:
		var world_x = ox + pos.x
		var world_y = oy + pos.y
		# Set water tile at this position
		pass  # Will use tilemap source for water

func _render_roads(chunk: ChunkData, ox: int, oy: int) -> void:
	for pos in chunk.road_cells:
		var world_x = ox + pos.x
		var world_y = oy + pos.y
		# Set road tile at this position
		pass  # Will use tilemap source for roads

func _render_structure(structure: Dictionary) -> void:
	# Render building as wall/floor/door tiles + roof sprite
	# This delegates to BuildingCompiler output
	pass  # Implemented in Task 10

func _render_vegetation(chunk: ChunkData, ox: int, oy: int) -> void:
	# Sparse tree/shrub placement based on vegetation density
	var size = ChunkData.SIZE
	var nodes_created = 0
	var rng = RandomNumberGenerator.new()
	rng.seed = chunk.world_seed ^ (chunk.chunk_x * 73856093) ^ (chunk.chunk_y * 19349663)
	
	for y in range(0, size, 4):  # Sample every 4th cell
		for x in range(0, size, 4):
			var density = float(chunk.vegetation_density[chunk.idx(x, y)]) / 255.0
			if rng.randf() > density:
				continue
			if chunk.is_ocean(x, y):
				continue
			
			# Create vegetation sprite
			# For now: colored circle placeholder
			# Later: PixelLab-generated tree sprites
			var sprite = Sprite2D.new()
			sprite.position = Vector2((ox + x) * _world_scale, (oy + y) * _world_scale)
			sprite.z_index = 2
			# Placeholder: green circle
			var img = Image.create(16, 16, false, Image.FORMAT_RGBA8)
			img.fill(Color(0.1, 0.5, 0.15, 0.8))
			sprite.texture = ImageTexture.create_from_image(img)
			sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			_parent.add_child(sprite)
			
			nodes_created += 1
			if nodes_created >= MAX_NODES_PER_FRAME:
				nodes_created = 0
				await get_tree().process_frame
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/deferred_renderer.gd
git commit -m "feat(world-compiler): DeferredRenderer spreads node creation across frames"
```

---

### Task 10: BuildingCompiler + Building Templates

**Files:**
- Create: `scripts/core/world_compiler/building_compiler.gd`
- Create: `data/building_templates/house.json`
- Create: `data/building_templates/forge.json`
- Create: `data/building_templates/market_stall.json`
- Create: `data/building_templates/well.json`
- Create: `data/building_templates/tavern.json`
- Create: `data/building_templates/watchtower.json`

- [ ] **Step 1: Create building template JSON files**

```json
// data/building_templates/house.json
{
  "template_id": "house",
  "category": "residential",
  "footprint": { "width": 3, "height": 4 },
  "walls": {
    "material": "wood",
    "pattern": "perimeter",
    "doors": [{ "side": "south", "offset": 1, "width": 1 }],
    "windows": [{ "side": "east", "offset": 1 }]
  },
  "floor": { "material": "wood_plank" },
  "roof": { "material": "thatch", "style": "peaked" },
  "interior_features": [
    { "type": "bed", "pos": [1, 1], "provides": ["rest"] },
    { "type": "table", "pos": [1, 2], "provides": ["eating"] },
    { "type": "storage_chest", "pos": [2, 1], "provides": ["storage"] }
  ],
  "requires": {
    "settlement_tier_min": "hamlet"
  },
  "npc_slots": [
    { "role": "resident", "sleep": "bed" }
  ]
}
```

```json
// data/building_templates/forge.json
{
  "template_id": "forge",
  "category": "workshop",
  "footprint": { "width": 4, "height": 5 },
  "walls": {
    "material": "stone",
    "pattern": "perimeter",
    "doors": [{ "side": "south", "offset": 1, "width": 1 }],
    "windows": [{ "side": "east", "offset": 2 }]
  },
  "floor": { "material": "stone_slab" },
  "roof": { "material": "thatch", "style": "peaked" },
  "interior_features": [
    { "type": "forge_station", "pos": [1, 1], "provides": ["smelting", "smithing"] },
    { "type": "anvil", "pos": [2, 1], "provides": ["metalworking"] },
    { "type": "workbench", "pos": [1, 2], "provides": ["crafting"] },
    { "type": "storage_chest", "pos": [3, 3], "provides": ["storage"] },
    { "type": "bed", "pos": [1, 4], "provides": ["rest"] }
  ],
  "requires": {
    "settlement_tier_min": "village",
    "population_min": 10
  },
  "npc_slots": [
    { "role": "blacksmith", "workplace": "forge_station", "sleep": "bed" }
  ]
}
```

```json
// data/building_templates/market_stall.json
{
  "template_id": "market_stall",
  "category": "commerce",
  "footprint": { "width": 2, "height": 2 },
  "walls": {
    "material": "wood",
    "pattern": "three_sides",
    "doors": [{ "side": "south", "offset": 0, "width": 2 }]
  },
  "floor": { "material": "wood_plank" },
  "roof": { "material": "canvas", "style": "awning" },
  "interior_features": [
    { "type": "counter", "pos": [0, 0], "provides": ["trading"] },
    { "type": "goods_display", "pos": [1, 0], "provides": ["display"] }
  ],
  "requires": { "settlement_tier_min": "village", "population_min": 15 },
  "npc_slots": [
    { "role": "merchant", "workplace": "counter" }
  ]
}
```

```json
// data/building_templates/well.json
{
  "template_id": "well",
  "category": "utility",
  "footprint": { "width": 1, "height": 1 },
  "walls": { "material": "stone", "pattern": "none" },
  "floor": { "material": "stone_slab" },
  "roof": { "material": "none" },
  "interior_features": [
    { "type": "water_source", "pos": [0, 0], "provides": ["water"] }
  ],
  "requires": { "settlement_tier_min": "hamlet" },
  "npc_slots": []
}
```

```json
// data/building_templates/tavern.json
{
  "template_id": "tavern",
  "category": "social",
  "footprint": { "width": 5, "height": 4 },
  "walls": {
    "material": "wood",
    "pattern": "perimeter",
    "doors": [{ "side": "south", "offset": 2, "width": 1 }],
    "windows": [{ "side": "west", "offset": 1 }, { "side": "east", "offset": 1 }]
  },
  "floor": { "material": "wood_plank" },
  "roof": { "material": "thatch", "style": "peaked" },
  "interior_features": [
    { "type": "bar_counter", "pos": [1, 1], "provides": ["drinks", "socializing"] },
    { "type": "table", "pos": [3, 1], "provides": ["eating"] },
    { "type": "table", "pos": [3, 2], "provides": ["eating"] },
    { "type": "bed", "pos": [1, 3], "provides": ["rest"] },
    { "type": "bed", "pos": [2, 3], "provides": ["rest"] },
    { "type": "storage_chest", "pos": [4, 3], "provides": ["storage"] }
  ],
  "requires": { "settlement_tier_min": "village", "population_min": 20 },
  "npc_slots": [
    { "role": "innkeeper", "workplace": "bar_counter", "sleep": "bed" }
  ]
}
```

```json
// data/building_templates/watchtower.json
{
  "template_id": "watchtower",
  "category": "military",
  "footprint": { "width": 2, "height": 3 },
  "walls": {
    "material": "stone",
    "pattern": "perimeter",
    "doors": [{ "side": "south", "offset": 0, "width": 1 }]
  },
  "floor": { "material": "stone_slab" },
  "roof": { "material": "stone", "style": "crenellated" },
  "interior_features": [
    { "type": "weapon_rack", "pos": [1, 0], "provides": ["arming"] },
    { "type": "bed", "pos": [0, 2], "provides": ["rest"] }
  ],
  "requires": { "settlement_tier_min": "village", "population_min": 15 },
  "npc_slots": [
    { "role": "guard", "workplace": "weapon_rack", "sleep": "bed" }
  ]
}
```

- [ ] **Step 2: Implement BuildingCompiler**

```gdscript
# scripts/core/world_compiler/building_compiler.gd
class_name BuildingCompiler

## Compiles building templates into world-grid tiles.
## Stamps walls (impassable), floors (walkable), doors (entry points),
## and interior features onto ChunkData.

var _templates: Dictionary = {}  # template_id → Dictionary

func _init():
	_load_templates()

func _load_templates() -> void:
	var dir_path = "res://data/building_templates/"
	var dir = DirAccess.open(dir_path)
	if dir == null:
		push_warning("BuildingCompiler: Cannot open %s" % dir_path)
		return
	dir.list_dir_begin()
	var file = dir.get_next()
	while file != "":
		if file.ends_with(".json"):
			var full_path = dir_path + file
			var json_text = FileAccess.get_file_as_string(full_path)
			if json_text != "":
				var json = JSON.new()
				if json.parse(json_text) == OK:
					var data = json.data
					if data.has("template_id"):
						_templates[data["template_id"]] = data
		file = dir.get_next()
	dir.list_dir_end()

func get_template(template_id: String) -> Dictionary:
	return _templates.get(template_id, {})

func get_all_template_ids() -> Array:
	return _templates.keys()

func compile_building(chunk: ChunkData, template_id: String, pos_x: int, pos_y: int) -> Dictionary:
	## Stamps a building at (pos_x, pos_y) within the chunk.
	## Returns a structure dict with all tile positions and NPC slots.
	
	var tmpl = get_template(template_id)
	if tmpl.is_empty():
		push_warning("BuildingCompiler: Unknown template '%s'" % template_id)
		return {}
	
	var w = tmpl["footprint"]["width"]
	var h = tmpl["footprint"]["height"]
	var structure = {
		"template_id": template_id,
		"category": tmpl.get("category", "misc"),
		"pos_x": pos_x,
		"pos_y": pos_y,
		"width": w,
		"height": h,
		"wall_tiles": [],
		"floor_tiles": [],
		"door_tiles": [],
		"interior_features": [],
		"npc_slots": tmpl.get("npc_slots", []),
		"roof_bounds": [pos_x, pos_y, pos_x + w - 1, pos_y + h - 1],
	}
	
	# Determine door positions
	var door_positions = {}  # local (dx, dy) → true
	for door in tmpl["walls"].get("doors", []):
		var side = door["side"]
		var offset = door["offset"]
		var door_w = door.get("width", 1)
		for i in range(door_w):
			match side:
				"south": door_positions[Vector2i(offset + i, h - 1)] = true
				"north": door_positions[Vector2i(offset + i, 0)] = true
				"east": door_positions[Vector2i(w - 1, offset + i)] = true
				"west": door_positions[Vector2i(0, offset + i)] = true
	
	# Stamp tiles
	for dy in range(h):
		for dx in range(w):
			var wx = pos_x + dx
			var wy = pos_y + dy
			if wx < 0 or wx >= ChunkData.SIZE or wy < 0 or wy >= ChunkData.SIZE:
				continue
			
			var idx = chunk.idx(wx, wy)
			var local = Vector2i(dx, dy)
			var is_perimeter = (dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1)
			
			if door_positions.has(local):
				# Door tile
				chunk.walkability[idx] = 0.8
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "door",
					"material": tmpl["walls"]["material"],
					"z_index": 2,
					"structure_id": template_id + "_%d_%d" % [pos_x, pos_y]
				}
				structure["door_tiles"].append(Vector2i(wx, wy))
			elif is_perimeter and tmpl["walls"]["pattern"] != "none":
				# Wall tile
				chunk.walkability[idx] = -1.0
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "wall",
					"material": tmpl["walls"]["material"],
					"z_index": 2,
					"structure_id": template_id + "_%d_%d" % [pos_x, pos_y]
				}
				structure["wall_tiles"].append(Vector2i(wx, wy))
			else:
				# Floor tile
				chunk.walkability[idx] = 1.0
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "floor",
					"material": tmpl["floor"]["material"],
					"z_index": 0,
					"structure_id": template_id + "_%d_%d" % [pos_x, pos_y]
				}
				structure["floor_tiles"].append(Vector2i(wx, wy))
	
	# Place interior features
	for feat in tmpl.get("interior_features", []):
		var fx = pos_x + feat["pos"][0]
		var fy = pos_y + feat["pos"][1]
		if fx >= 0 and fx < ChunkData.SIZE and fy >= 0 and fy < ChunkData.SIZE:
			structure["interior_features"].append({
				"type": feat["type"],
				"world_x": fx,
				"world_y": fy,
				"provides": feat.get("provides", []),
			})
			# Interior features may partially block (furniture)
			chunk.walkability[chunk.idx(fx, fy)] = 2.0  # Slow but passable
	
	# Add to chunk structures list
	chunk.structures.append(structure)
	
	return structure
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/building_compiler.gd data/building_templates/
git commit -m "feat(world-compiler): BuildingCompiler + 6 building templates (house, forge, tavern, market, well, watchtower)"
```

---

### Task 11: RoadsLayer (L10) + SettlementsLayer (L11)

**Files:**
- Create: `scripts/core/world_compiler/layers/roads_layer.gd`
- Create: `scripts/core/world_compiler/layers/settlements_layer.gd`

- [ ] **Step 1: Implement RoadsLayer with terrain cost A***

```gdscript
# scripts/core/world_compiler/layers/roads_layer.gd
class_name RoadsLayer
extends LayerBase

## L10: Computes terrain traversal costs and generates road network between settlements.

func _init():
	layer_name = "roads"
	layer_id = 10

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	
	# Step 1: Compute base road cost from terrain
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.road_cost[idx] = 999.0  # Impassable without bridge
				continue
			
			var cost = 1.0
			var s = chunk.slope[idx]
			var biome = chunk.get_biome(x, y)
			var veg = float(chunk.vegetation_density[idx]) / 255.0
			
			# Slope increases cost
			cost += s * 10.0
			
			# Dense vegetation increases cost
			cost += veg * 2.0
			
			# River crossing is expensive
			if chunk.river_cells.has(Vector2i(x, y)):
				cost += 5.0  # Needs ford/bridge
			
			# Biome modifiers
			match biome:
				BiomeLayer.Biome.SWAMP: cost += 3.0
				BiomeLayer.Biome.MOUNTAINS: cost += 4.0
				BiomeLayer.Biome.DESERT: cost += 1.5
			
			chunk.road_cost[idx] = cost
	
	# Step 2: Roads will be generated by SettlementsLayer after placement
	# (needs settlement positions first)

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var cost = chunk.road_cost[chunk.idx(x, y)]
			if cost >= 999.0:
				img.set_pixel(x, y, Color(0.1, 0.1, 0.3))  # Ocean/impassable
			else:
				# Green = easy, red = hard
				var t = clampf(cost / 10.0, 0.0, 1.0)
				img.set_pixel(x, y, Color(t, 1.0 - t, 0.1))
	# Overlay road cells
	for pos in chunk.road_cells:
		img.set_pixel(pos.x, pos.y, Color(0.8, 0.7, 0.4))
	return img
```

- [ ] **Step 2: Implement SettlementsLayer with scored placement + road generation**

```gdscript
# scripts/core/world_compiler/layers/settlements_layer.gd
class_name SettlementsLayer
extends LayerBase

## L11: Scores settlement suitability, places settlements, compiles buildings,
## then generates roads connecting them.

var _building_compiler: BuildingCompiler = null

func _init():
	layer_name = "settlements"
	layer_id = 11
	_building_compiler = BuildingCompiler.new()

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed
	
	# Step 1: Compute settlement suitability scores
	_compute_suitability(chunk, size)
	
	# Step 2: Find local maxima for settlement placement
	var sites = _find_settlement_sites(chunk, size, rng)
	
	# Step 3: For each site, compile buildings
	for site in sites:
		_compile_settlement(chunk, site, rng)
	
	# Step 4: Generate roads between settlements
	_generate_roads(chunk, sites, size)
	
	# Step 5: Initialize walkability for non-building tiles
	_init_walkability(chunk, size)

func _compute_suitability(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.settlement_suitability[idx] = 0.0
				continue
			
			var score = 0.0
			
			# Water access (river/lake nearby)
			var water_score = 0.0
			for dy in range(-10, 11):
				for dx in range(-10, 11):
					var np = Vector2i(x + dx, y + dy)
					if chunk.river_cells.has(np) or chunk.lake_cells.has(np):
						var dist = sqrt(dx * dx + dy * dy)
						water_score = maxf(water_score, 1.0 - dist / 10.0)
			score += water_score * 0.3
			
			# Fertility
			var fert = float(chunk.fertility[idx]) / 255.0
			score += fert * 0.25
			
			# Flat terrain (low slope)
			var s = chunk.slope[idx]
			score += maxf(0, 0.2 - s * 2.0)
			
			# Not in extreme biomes
			var biome = chunk.get_biome(x, y)
			match biome:
				BiomeLayer.Biome.OCEAN, BiomeLayer.Biome.LAKE, BiomeLayer.Biome.RIVER:
					score = 0.0
				BiomeLayer.Biome.MOUNTAINS:
					score *= 0.3
				BiomeLayer.Biome.DESERT:
					score *= 0.4
				BiomeLayer.Biome.SWAMP:
					score *= 0.5
				BiomeLayer.Biome.ARCTIC, BiomeLayer.Biome.TUNDRA:
					score *= 0.3
				BiomeLayer.Biome.GRASSLAND, BiomeLayer.Biome.FOREST:
					score *= 1.2
			
			# Moderate elevation preferred
			var h = chunk.get_elevation(x, y)
			if h > 0.4 and h < 0.7:
				score += 0.15
			
			chunk.settlement_suitability[idx] = clampf(score, 0.0, 1.0)

func _find_settlement_sites(chunk: ChunkData, size: int, rng: RandomNumberGenerator) -> Array:
	var sites = []
	var min_spacing = 40  # Minimum distance between settlements
	
	# Find cells above suitability threshold
	var candidates = []
	for y in range(20, size - 20):
		for x in range(20, size - 20):
			var score = chunk.settlement_suitability[chunk.idx(x, y)]
			if score > 0.5:
				candidates.append({"x": x, "y": y, "score": score})
	
	# Sort by score descending
	candidates.sort_custom(func(a, b): return a["score"] > b["score"])
	
	# Greedy selection with spacing constraint
	for candidate in candidates:
		var too_close = false
		for existing in sites:
			var dist = sqrt(pow(candidate["x"] - existing["x"], 2) + pow(candidate["y"] - existing["y"], 2))
			if dist < min_spacing:
				too_close = true
				break
		if not too_close:
			# Determine settlement tier from score
			var tier = "hamlet"
			if candidate["score"] > 0.8:
				tier = "town"
			elif candidate["score"] > 0.65:
				tier = "village"
			
			# Determine reason codes
			var reasons = []
			var idx = chunk.idx(candidate["x"], candidate["y"])
			if float(chunk.fertility[idx]) / 255.0 > 0.5:
				reasons.append("fertile_land")
			var near_water = false
			for dy in range(-8, 9):
				for dx in range(-8, 9):
					if chunk.river_cells.has(Vector2i(candidate["x"] + dx, candidate["y"] + dy)):
						near_water = true
						break
				if near_water:
					break
			if near_water:
				reasons.append("water_access")
			if chunk.slope[idx] < 0.05:
				reasons.append("flat_terrain")
			
			candidate["tier"] = tier
			candidate["reasons"] = reasons
			sites.append(candidate)
			
			if sites.size() >= 3:  # Max 3 settlements per chunk
				break
	
	return sites

func _compile_settlement(chunk: ChunkData, site: Dictionary, rng: RandomNumberGenerator) -> void:
	var cx = site["x"]
	var cy = site["y"]
	var tier = site["tier"]
	
	# Determine building set based on tier
	var buildings = []
	match tier:
		"hamlet":
			buildings = ["well", "house", "house"]
		"village":
			buildings = ["well", "house", "house", "house", "forge", "market_stall"]
		"town":
			buildings = ["well", "house", "house", "house", "house", "forge", "market_stall", "tavern", "watchtower"]
	
	# Place buildings in a ring around the settlement center
	var placed = 0
	var ring_radius = 5
	for template_id in buildings:
		var tmpl = _building_compiler.get_template(template_id)
		if tmpl.is_empty():
			continue
		
		# Find placement position on ring
		var angle = (float(placed) / buildings.size()) * TAU + rng.randf() * 0.3
		var bx = cx + int(cos(angle) * ring_radius) - tmpl["footprint"]["width"] / 2
		var by = cy + int(sin(angle) * ring_radius) - tmpl["footprint"]["height"] / 2
		
		# Clamp to chunk bounds
		bx = clampi(bx, 1, ChunkData.SIZE - tmpl["footprint"]["width"] - 1)
		by = clampi(by, 1, ChunkData.SIZE - tmpl["footprint"]["height"] - 1)
		
		# Check not overlapping existing buildings
		var overlaps = false
		for dy in range(tmpl["footprint"]["height"]):
			for dx in range(tmpl["footprint"]["width"]):
				if chunk.building_tiles.has(Vector2i(bx + dx, by + dy)):
					overlaps = true
					break
			if overlaps:
				break
		
		if overlaps:
			ring_radius += 3  # Push outward
			continue
		
		_building_compiler.compile_building(chunk, template_id, bx, by)
		placed += 1
		ring_radius += 2  # Space next building further

func _generate_roads(chunk: ChunkData, sites: Array, size: int) -> void:
	if sites.size() < 2:
		# Single settlement: just add paths from center to each building door
		if sites.size() == 1:
			var cx = sites[0]["x"]
			var cy = sites[0]["y"]
			for structure in chunk.structures:
				for door in structure.get("door_tiles", []):
					var path = _find_path(chunk, Vector2i(cx, cy), door, size)
					for pos in path:
						chunk.road_cells[pos] = 1  # Trail
						chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5
		return
	
	# Connect settlements with roads
	for i in range(sites.size() - 1):
		var from = Vector2i(sites[i]["x"], sites[i]["y"])
		var to = Vector2i(sites[i + 1]["x"], sites[i + 1]["y"])
		var path = _find_path(chunk, from, to, size)
		for pos in path:
			chunk.road_cells[pos] = 2  # Road
			chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5
	
	# Also connect each building to nearest road
	for structure in chunk.structures:
		for door in structure.get("door_tiles", []):
			# Find nearest road cell
			var nearest_road = Vector2i(-1, -1)
			var best_dist = 999.0
			for road_pos in chunk.road_cells:
				var dist = door.distance_to(road_pos)
				if dist < best_dist:
					best_dist = dist
					nearest_road = road_pos
			if nearest_road.x >= 0:
				var path = _find_path(chunk, door, nearest_road, size)
				for pos in path:
					chunk.road_cells[pos] = 1
					chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5

func _find_path(chunk: ChunkData, from: Vector2i, to: Vector2i, size: int) -> Array:
	## Simple A* on road_cost grid
	var open_set = {from: true}
	var came_from = {}
	var g_score = {from: 0.0}
	var f_score = {from: from.distance_to(to)}
	
	var dx = [-1, 0, 1, -1, 1, -1, 0, 1]
	var dy = [-1, -1, -1, 0, 0, 1, 1, 1]
	
	var iterations = 0
	while open_set.size() > 0 and iterations < 10000:
		iterations += 1
		
		# Find lowest f_score in open set
		var current = Vector2i(-1, -1)
		var best_f = 999999.0
		for pos in open_set:
			var f = f_score.get(pos, 999999.0)
			if f < best_f:
				best_f = f
				current = pos
		
		if current == to:
			break
		
		open_set.erase(current)
		
		for d in range(8):
			var nx = current.x + dx[d]
			var ny = current.y + dy[d]
			if nx < 0 or nx >= size or ny < 0 or ny >= size:
				continue
			var neighbor = Vector2i(nx, ny)
			var cost = chunk.road_cost[chunk.idx(nx, ny)]
			if cost >= 999.0:
				continue  # Impassable
			
			var tent_g = g_score.get(current, 999999.0) + cost
			if tent_g < g_score.get(neighbor, 999999.0):
				came_from[neighbor] = current
				g_score[neighbor] = tent_g
				f_score[neighbor] = tent_g + neighbor.distance_to(to)
				open_set[neighbor] = true
	
	# Reconstruct path
	var path = []
	var current = to
	while came_from.has(current):
		path.append(current)
		current = came_from[current]
	path.reverse()
	return path

func _init_walkability(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var idx = chunk.idx(x, y)
			# Only set walkability if not already set by building compiler
			if chunk.building_tiles.has(Vector2i(x, y)):
				continue  # Already set
			if chunk.road_cells.has(Vector2i(x, y)):
				continue  # Already set
			
			if chunk.is_ocean(x, y):
				chunk.walkability[idx] = -1.0
			elif chunk.river_cells.has(Vector2i(x, y)):
				chunk.walkability[idx] = -1.0  # Rivers block (need bridge)
			elif chunk.lake_cells.has(Vector2i(x, y)):
				chunk.walkability[idx] = -1.0
			else:
				var biome = chunk.get_biome(x, y)
				match biome:
					BiomeLayer.Biome.MOUNTAINS:
						chunk.walkability[idx] = 3.0
					BiomeLayer.Biome.SWAMP:
						chunk.walkability[idx] = 2.0
					BiomeLayer.Biome.DESERT:
						chunk.walkability[idx] = 1.3
					_:
						chunk.walkability[idx] = 1.0

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	# Suitability heatmap
	for y in range(size):
		for x in range(size):
			var s = chunk.settlement_suitability[chunk.idx(x, y)]
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.3))
			else:
				img.set_pixel(x, y, Color(s, s * 0.3, 0.0))
	# Buildings in white
	for pos in chunk.building_tiles:
		var tile = chunk.building_tiles[pos]
		match tile["type"]:
			"wall": img.set_pixel(pos.x, pos.y, Color(0.6, 0.4, 0.2))
			"floor": img.set_pixel(pos.x, pos.y, Color(0.8, 0.7, 0.5))
			"door": img.set_pixel(pos.x, pos.y, Color(0.2, 0.8, 0.2))
	# Roads in tan
	for pos in chunk.road_cells:
		img.set_pixel(pos.x, pos.y, Color(0.7, 0.6, 0.4))
	return img
```

- [ ] **Step 3: Register both + update WorldCompiler with all layers**

Final `WorldCompiler._init_layers()`:
```gdscript
func _init_layers():
	layers = []
	register_layer(ElevationLayer.new())       # L1
	register_layer(OceanMaskLayer.new())        # L2
	register_layer(DrainageLayer.new())         # L3
	register_layer(RiversLakesLayer.new())      # L4
	register_layer(ClimateLayer.new())          # L5
	register_layer(BiomeLayer.new())            # L6
	register_layer(SoilFertilityLayer.new())    # L7
	register_layer(VegetationLayer.new())       # L8
	register_layer(CoastalLayer.new())          # L9
	register_layer(RoadsLayer.new())            # L10
	register_layer(SettlementsLayer.new())       # L11
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/layers/roads_layer.gd scripts/core/world_compiler/layers/settlements_layer.gd
git commit -m "feat(world-compiler): L10 Roads (A* cost) + L11 Settlements (scored placement + building compilation)"
```

---

### Task 12: Integration — Replace Scatter Startup with WorldCompiler

**Files:**
- Modify: `scripts/GrainWorldDemo.gd`
- Modify: `scripts/autoload/WorldManager.gd`

- [ ] **Step 1: Add WorldCompiler to WorldManager**

In `WorldManager.gd`, add to `_init_systems()`:
```gdscript
# After existing system initialization
var world_compiler = WorldCompiler.new(ServerConfig.get_world_seed())
```

Add member variable:
```gdscript
var world_compiler: WorldCompiler = null
```

- [ ] **Step 2: Replace _start_game() scatter flow in GrainWorldDemo.gd**

Replace the village generation, scatter decoration, and synchronous node creation with:

```gdscript
# In _start_game(), REPLACE:
# - _generate_area(0, 0, 0) 
# - village generation
# - scatter_decorations
# - all synchronous sprite spawning
# WITH:

# Compile chunk at origin
var chunk = WorldManager.world_compiler.compile_chunk(0, 0)

# Deferred rendering
var renderer = DeferredRenderer.new()
renderer.setup(self)
add_child(renderer)
renderer.chunk_render_complete.connect(_on_chunk_rendered)
renderer.render_chunk(chunk)

# Debug overlay
var debug = DebugOverlay.new()
debug.setup(WorldManager.world_compiler, self)
add_child(debug)
_debug_overlay = debug
```

- [ ] **Step 3: Add roof fade logic**

In `_process(delta)`, add building proximity check:
```gdscript
# Check if player is inside any building (for roof fade)
for structure in WorldManager.world_compiler.get_chunk(0, 0).structures:
	var bounds = structure.get("roof_bounds", [])
	if bounds.size() == 4:
		var px = int(_player_pos.x / 32)
		var py = int(_player_pos.y / 32)
		var inside = px >= bounds[0] and px <= bounds[2] and py >= bounds[1] and py <= bounds[3]
		# Find roof sprite and fade it
		# (Roof sprites tracked by structure_id in DeferredRenderer)
```

- [ ] **Step 4: Update player movement to use compiled walkability**

Replace existing walkability checks with:
```gdscript
func _can_move_to(world_pos: Vector2) -> bool:
	var chunk = WorldManager.world_compiler.get_chunk(0, 0)
	if chunk == null:
		return true
	var tx = int(world_pos.x / 32)
	var ty = int(world_pos.y / 32)
	if tx < 0 or tx >= ChunkData.SIZE or ty < 0 or ty >= ChunkData.SIZE:
		return true
	var w = chunk.get_walkability(tx, ty)
	return w > 0.0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/GrainWorldDemo.gd scripts/autoload/WorldManager.gd
git commit -m "feat(world-compiler): integrate WorldCompiler into game startup, replace scatter placement"
```

---

### Task 13: POIsLayer (L13) + EventsLayer (L14)

**Files:**
- Create: `scripts/core/world_compiler/layers/pois_layer.gd`
- Create: `scripts/core/world_compiler/layers/events_layer.gd`

- [ ] **Step 1: Implement POIsLayer**

```gdscript
# scripts/core/world_compiler/layers/pois_layer.gd
class_name POIsLayer
extends LayerBase

## L13: POI spawning from explainable triggers (waterfalls, crossroads, ruins, ore deposits).

func _init():
	layer_name = "pois"
	layer_id = 13

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed
	
	chunk.pois.clear()
	
	for y in range(10, size - 10):
		for x in range(10, size - 10):
			if chunk.is_ocean(x, y):
				continue
			
			var triggers = _check_triggers(chunk, x, y)
			if triggers.is_empty():
				continue
			
			# Don't place too close to existing POIs or settlements
			var too_close = false
			for poi in chunk.pois:
				var dist = sqrt(pow(x - poi["x"], 2) + pow(y - poi["y"], 2))
				if dist < 15:
					too_close = true
					break
			for structure in chunk.structures:
				var dist = sqrt(pow(x - structure["pos_x"], 2) + pow(y - structure["pos_y"], 2))
				if dist < 10:
					too_close = true
					break
			if too_close:
				continue
			
			# Probability check
			if rng.randf() > 0.3:
				continue
			
			chunk.pois.append({
				"x": x,
				"y": y,
				"triggers": triggers,
				"type": _poi_type_from_triggers(triggers),
			})

func _check_triggers(chunk: ChunkData, x: int, y: int) -> Array:
	var triggers = []
	var idx = chunk.idx(x, y)
	
	# Waterfall: river cell with steep slope
	if chunk.river_cells.has(Vector2i(x, y)) and chunk.slope[idx] > 0.1:
		triggers.append("waterfall")
	
	# River crossing: road meets river
	if chunk.road_cells.has(Vector2i(x, y)) and chunk.river_cells.has(Vector2i(x, y)):
		triggers.append("river_crossing")
	
	# Road junction: 3+ road neighbors
	if chunk.road_cells.has(Vector2i(x, y)):
		var road_neighbors = 0
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dy == 0:
					continue
				if chunk.road_cells.has(Vector2i(x + dx, y + dy)):
					road_neighbors += 1
		if road_neighbors >= 3:
			triggers.append("road_junction")
	
	# Mineral deposit: high elevation, specific biome
	var h = chunk.get_elevation(x, y)
	if h > 0.7 and chunk.get_biome(x, y) == BiomeLayer.Biome.MOUNTAINS:
		triggers.append("mineral_deposit")
	
	# Isolated plateau: high flat area surrounded by slopes
	if h > 0.6 and chunk.slope[idx] < 0.02:
		var surrounding_slope = 0.0
		var count = 0
		for dy in range(-3, 4):
			for dx in range(-3, 4):
				var nx = x + dx
				var ny = y + dy
				if nx >= 0 and nx < ChunkData.SIZE and ny >= 0 and ny < ChunkData.SIZE:
					surrounding_slope += chunk.slope[chunk.idx(nx, ny)]
					count += 1
		if count > 0 and surrounding_slope / count > 0.08:
			triggers.append("isolated_plateau")
	
	return triggers

func _poi_type_from_triggers(triggers: Array) -> String:
	if "waterfall" in triggers:
		return "scenic_overlook"
	if "river_crossing" in triggers:
		return "bridge_site"
	if "road_junction" in triggers:
		return "crossroads_shrine"
	if "mineral_deposit" in triggers:
		return "mine_entrance"
	if "isolated_plateau" in triggers:
		return "ancient_ruins"
	return "point_of_interest"

func validate(chunk: ChunkData) -> Array:
	var errors = []
	for poi in chunk.pois:
		if poi.get("triggers", []).is_empty():
			errors.append("POI at (%d,%d) has no triggers" % [poi["x"], poi["y"]])
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	# Start with biome base
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			img.set_pixel(x, y, BiomeLayer.biome_color(chunk.get_biome(x, y)))
	# POIs as bright markers
	for poi in chunk.pois:
		var color = Color(1, 1, 0)  # Yellow
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				var px = poi["x"] + dx
				var py = poi["y"] + dy
				if px >= 0 and px < size and py >= 0 and py < size:
					img.set_pixel(px, py, color)
	return img
```

- [ ] **Step 2: Implement EventsLayer**

```gdscript
# scripts/core/world_compiler/layers/events_layer.gd
class_name EventsLayer
extends LayerBase

## L14: Generates initial world events from compiled state.
## Seeds the event log with settlement founding, road construction, etc.

func _init():
	layer_name = "events"
	layer_id = 14

func compile(chunk: ChunkData, seed: int) -> void:
	chunk.events.clear()
	var tick = 0
	
	# Settlement founding events
	for structure in chunk.structures:
		chunk.events.append({
			"event_id": "evt_founding_%d_%d" % [structure["pos_x"], structure["pos_y"]],
			"tick": tick,
			"event_type": "settlement_founding",
			"location": {"x": structure["pos_x"], "y": structure["pos_y"]},
			"actors": [structure["template_id"]],
			"causes": structure.get("reasons", ["unknown"]) if structure.has("reasons") else ["settlement_placed"],
			"effects": [{"type": "structure_built", "target": structure["template_id"]}],
		})
		tick += 1
	
	# POI discovery events
	for poi in chunk.pois:
		chunk.events.append({
			"event_id": "evt_poi_%d_%d" % [poi["x"], poi["y"]],
			"tick": tick,
			"event_type": "poi_discovered",
			"location": {"x": poi["x"], "y": poi["y"]},
			"actors": [],
			"causes": poi["triggers"],
			"effects": [{"type": "poi_marked", "target": poi["type"]}],
		})
		tick += 1

func validate(chunk: ChunkData) -> Array:
	var errors = []
	for event in chunk.events:
		if event.get("causes", []).is_empty():
			errors.append("Event %s has no causes" % event.get("event_id", "unknown"))
	return errors
```

- [ ] **Step 3: Register + commit**

```bash
git add scripts/core/world_compiler/layers/pois_layer.gd scripts/core/world_compiler/layers/events_layer.gd
git commit -m "feat(world-compiler): L13 POIs (triggered spawning) + L14 Events (append-only log)"
```

---

### Task 14: Final WorldCompiler Integration + Game Boot Test

**Files:**
- Modify: `scripts/core/world_compiler/world_compiler.gd` (register all 13 layers)
- Modify: `scripts/GrainWorldDemo.gd` (full integration)

- [ ] **Step 1: Register all 13 layers in WorldCompiler._init_layers()**

```gdscript
func _init_layers():
	layers = []
	register_layer(ElevationLayer.new())        # L1
	register_layer(OceanMaskLayer.new())         # L2
	register_layer(DrainageLayer.new())          # L3
	register_layer(RiversLakesLayer.new())       # L4
	register_layer(ClimateLayer.new())           # L5
	register_layer(BiomeLayer.new())             # L6
	register_layer(SoilFertilityLayer.new())     # L7
	register_layer(VegetationLayer.new())        # L8
	register_layer(CoastalLayer.new())           # L9
	register_layer(RoadsLayer.new())             # L10
	register_layer(SettlementsLayer.new())        # L11
	register_layer(POIsLayer.new())              # L13
	register_layer(EventsLayer.new())            # L14
```

- [ ] **Step 2: Print compilation summary for verification**

Add to `compile_chunk()` after all layers run:
```gdscript
# Print summary
print("[WorldCompiler] Chunk (%d,%d) compiled:" % [chunk_x, chunk_y])
print("  Layers: %d" % layers.size())
print("  Structures: %d" % chunk.structures.size())
print("  Road cells: %d" % chunk.road_cells.size())
print("  River cells: %d" % chunk.river_cells.size())
print("  POIs: %d" % chunk.pois.size())
print("  Events: %d" % chunk.events.size())
print("  Hash: %s" % chunk.get_deterministic_hash().substr(0, 16))
```

- [ ] **Step 3: Test by running in Godot**

Launch the game (F5 or F6). Expected output:
- No freeze (deferred rendering)
- Debug output in console showing compilation summary
- Terrain renders via existing TileMapRenderer (biome colors)
- Buildings rendered as wall/floor/door tiles (initially colored rectangles)
- Roads visible as path tiles connecting buildings
- F1-F12 keys toggle debug overlays
- Player movement blocked by walls, flows through doors

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/ scripts/GrainWorldDemo.gd scripts/autoload/WorldManager.gd data/building_templates/
git commit -m "feat(world-compiler): full 13-layer pipeline integration + game boot"
```
