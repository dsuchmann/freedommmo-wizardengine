# Runtime Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-layer tile rendering system that composites 5 sub-layers per chunk, with a state machine that swaps layer frames based on game events.

**Architecture:** Each chunk renders as 5 stacked Sprite2D nodes (one per sub-layer). The chunk streamer builds 5 Images per chunk instead of 1. A TileStateManager tracks per-tile states and triggers layer rebuilds on state changes. Phase 1: pristine state rendering only. State machine architecture wired but only pristine frames loaded.

**Tech Stack:** GDScript (Godot 4.4), existing ChunkStreamer + TileMapTerrainRenderer

**Spec:** `docs/superpowers/specs/2026-05-26-runtime-compositor-spec.md`

**Dependency:** Plan 1 (Infrastructure) must be complete. Plan 2 (Asset Generation) should have at least grassland L1-L5 downloaded for testing.

**GDScript safety:** NEVER use `:=` with `Dictionary.get()`, `abs()`, or untyped returns. Always use `=`.

---

### Task 1: Create LayeredTilesetLoader

**Files:**
- Create: `scripts/core/world_compiler/layered_tileset_loader.gd`

This replaces the flat tileset loading with the new `terrain_v2/` structure. It loads all 5 sub-layers per biome.

- [ ] **Step 1: Write the loader**

```gdscript
class_name LayeredTilesetLoader

## Loads layered terrain tilesets from assets/catalog/terrain_v2/.
## Each biome has up to 5 sub-layers (L1-L5), each with 16 Wang tiles.

const CATALOG_PATH = "res://assets/catalog/terrain_v2"
const LAYER_NAMES = ["L1_base", "L2_detail", "L3_vegetation", "L4_scatter", "L5_atmospheric"]

# biome_name -> layer_name -> wang_idx -> Image
static var _cache: Dictionary = {}
static var _loaded: bool = false


static func load_all() -> void:
	if _loaded:
		return
	_cache.clear()

	var manifest_path = CATALOG_PATH + "/_manifest.json"
	if not FileAccess.file_exists(manifest_path):
		push_warning("[LayeredTilesetLoader] No manifest at %s" % manifest_path)
		return

	var f = FileAccess.open(manifest_path, FileAccess.READ)
	var manifest = JSON.parse_string(f.get_as_text())
	f.close()
	if manifest == null:
		push_warning("[LayeredTilesetLoader] Failed to parse manifest")
		return

	var biomes = manifest.get("biomes", {})
	var total_tiles = 0

	for biome_name in biomes:
		var biome_info = biomes[biome_name]
		var active_layers = biome_info.get("active_layers", [])
		_cache[biome_name] = {}

		for layer_name in active_layers:
			var layer_dict = {}
			var layer_dir = "%s/%s/%s" % [CATALOG_PATH, biome_name, layer_name]

			for wang_idx in range(16):
				var img_path = "%s/wang_%d.png" % [layer_dir, wang_idx]
				if FileAccess.file_exists(img_path):
					var tex = load(img_path) as Texture2D
					if tex != null:
						var img = tex.get_image()
						if img.get_format() != Image.FORMAT_RGBA8:
							img.convert(Image.FORMAT_RGBA8)
						layer_dict[wang_idx] = img
						total_tiles += 1

			if layer_dict.size() > 0:
				_cache[biome_name][layer_name] = layer_dict

	_loaded = true
	print("[LayeredTilesetLoader] Loaded %d tiles across %d biomes" % [total_tiles, _cache.size()])


static func get_tile(biome: String, layer: String, wang_idx: int) -> Image:
	## Get a specific Wang tile image. Returns null if not found.
	if not _cache.has(biome):
		return null
	var biome_cache = _cache[biome]
	if not biome_cache.has(layer):
		return null
	var layer_cache = biome_cache[layer]
	return layer_cache.get(wang_idx, null)


static func get_active_layers(biome: String) -> Array:
	## Get list of layer names that have loaded tiles for this biome.
	if not _cache.has(biome):
		return []
	return _cache[biome].keys()


static func has_layer(biome: String, layer: String) -> bool:
	if not _cache.has(biome):
		return false
	return _cache[biome].has(layer)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_tileset_loader.gd
git commit -m "feat: LayeredTilesetLoader — loads 5 sub-layer tilesets per biome

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create TileStateManager

**Files:**
- Create: `scripts/core/tile_state_manager.gd`

Phase 1: All tiles stay in PRISTINE state. Architecture supports all 13 states from day one.

- [ ] **Step 1: Write the state manager**

```gdscript
class_name TileStateManager

## Tracks per-tile state for event-driven animation.
## Phase 1: pristine state only. Full state machine wired but inactive.

enum TileState {
	PRISTINE = 0,
	DISTURBED = 1,
	TRAMPLED = 2,
	DUG = 3,
	BURNING = 4,
	BURNED = 5,
	FROZEN = 6,
	WET = 7,
	CURSED = 8,
	ENCHANTED = 9,
	DECAYING = 10,
	GROWING = 11,
	DRY = 12
}

signal tile_state_changed(tile_world_pos: Vector2i, old_state: int, new_state: int)

# Chunk-level state storage: Vector2i(chunk_x, chunk_y) -> PackedByteArray (SIZE*SIZE bytes)
var _chunk_states: Dictionary = {}


func get_state(chunk_x: int, chunk_y: int, local_x: int, local_y: int) -> int:
	var key = Vector2i(chunk_x, chunk_y)
	if not _chunk_states.has(key):
		return TileState.PRISTINE
	var states = _chunk_states[key]
	var idx = local_y * ChunkData.SIZE + local_x
	if idx < 0 or idx >= states.size():
		return TileState.PRISTINE
	return states[idx]


func set_state(chunk_x: int, chunk_y: int, local_x: int, local_y: int, new_state: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if not _chunk_states.has(key):
		var states = PackedByteArray()
		states.resize(ChunkData.SIZE * ChunkData.SIZE)
		states.fill(TileState.PRISTINE)
		_chunk_states[key] = states
	var idx = local_y * ChunkData.SIZE + local_x
	if idx < 0 or idx >= _chunk_states[key].size():
		return
	var old_state = _chunk_states[key][idx]
	if old_state == new_state:
		return
	_chunk_states[key][idx] = new_state
	var world_x = chunk_x * ChunkData.SIZE + local_x
	var world_y = chunk_y * ChunkData.SIZE + local_y
	tile_state_changed.emit(Vector2i(world_x, world_y), old_state, new_state)


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	_chunk_states.erase(Vector2i(chunk_x, chunk_y))
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/tile_state_manager.gd
git commit -m "feat: TileStateManager — per-tile state tracking for event-driven animation

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create LayeredChunkRenderer

**Files:**
- Create: `scripts/core/world_compiler/layered_chunk_renderer.gd`

Renders a single chunk as 5 stacked Sprite2D nodes.

- [ ] **Step 1: Write the renderer**

```gdscript
class_name LayeredChunkRenderer

## Renders a chunk as 5 stacked transparent layer Sprite2Ds.
## Each layer is a 2048x2048 image (64 tiles × 32px).

const LAYER_NAMES = LayeredTilesetLoader.LAYER_NAMES
const BIOME_NAMES = [
	"ocean", "beach", "grassland", "forest", "dense_forest", "desert",
	"savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
	"tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
]

var _parent: Node2D
var _tile_size: int = 32
# chunk_key (Vector2i) -> Array[Sprite2D] (5 sprites, one per layer)
var _chunk_sprites: Dictionary = {}


func setup(parent: Node2D, tile_size: int = 32) -> void:
	_parent = parent
	_tile_size = tile_size
	LayeredTilesetLoader.load_all()


func render_chunk_layers(chunk: ChunkData) -> void:
	## Build and display 5 layer images for a chunk.
	var key = Vector2i(chunk.chunk_x, chunk.chunk_y)

	# Clear existing sprites for this chunk
	clear_chunk(chunk.chunk_x, chunk.chunk_y)

	var px_size = ChunkData.SIZE * _tile_size
	var origin_x = chunk.chunk_x * px_size
	var origin_y = chunk.chunk_y * px_size

	var sprites: Array = []

	for layer_idx in range(LAYER_NAMES.size()):
		var layer_name = LAYER_NAMES[layer_idx]
		var img = _build_layer_image(chunk, layer_name)
		if img == null:
			sprites.append(null)
			continue

		var tex = ImageTexture.create_from_image(img)
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.centered = false
		sprite.position = Vector2(origin_x, origin_y)
		sprite.z_index = layer_idx  # L1=0, L2=1, ..., L5=4
		_parent.add_child(sprite)
		sprites.append(sprite)

	_chunk_sprites[key] = sprites


func _build_layer_image(chunk: ChunkData, layer_name: String) -> Image:
	## Composite a single layer image for the chunk from Wang tiles.
	var size = ChunkData.SIZE
	var px_size = size * _tile_size
	var has_any_tile = false

	# Create transparent image
	var img = Image.create(px_size, px_size, false, Image.FORMAT_RGBA8)
	if layer_name == "L1_base":
		img.fill(Color(0.2, 0.2, 0.2, 1.0))  # Dark gray default for L1
	else:
		img.fill(Color(0, 0, 0, 0))  # Fully transparent for overlays

	for y in range(size):
		for x in range(size):
			var biome_id = chunk.biome_id[y * size + x]
			if biome_id >= BIOME_NAMES.size():
				continue
			var biome_name = BIOME_NAMES[biome_id]

			if not LayeredTilesetLoader.has_layer(biome_name, layer_name):
				continue

			# Compute Wang index from 4 corners (same logic as existing renderer)
			var wang_idx = _compute_wang_index(chunk, x, y, biome_name)
			var tile_img = LayeredTilesetLoader.get_tile(biome_name, layer_name, wang_idx)
			if tile_img == null:
				continue

			has_any_tile = true
			var dest = Vector2i(x * _tile_size, y * _tile_size)
			if layer_name == "L1_base":
				img.blit_rect(tile_img, Rect2i(0, 0, _tile_size, _tile_size), dest)
			else:
				img.blend_rect(tile_img, Rect2i(0, 0, _tile_size, _tile_size), dest)

	if not has_any_tile:
		return null
	return img


func _compute_wang_index(chunk: ChunkData, x: int, y: int, biome_name: String) -> int:
	## Compute Wang corner index based on neighbors.
	## Self-transition: use hash for variation (same logic as C++ renderer).
	var size = ChunkData.SIZE
	var wx = chunk.chunk_x * size + x
	var wy = chunk.chunk_y * size + y
	var hv = ((wx * 73856093) ^ (wy * 19349663) ^ chunk.world_seed) & 0x7FFFFFFF
	# 10% chance of variant tile (wang 15), otherwise base (wang 0)
	return 15 if (hv % 10 == 0) else 0


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if _chunk_sprites.has(key):
		for sprite in _chunk_sprites[key]:
			if sprite != null and is_instance_valid(sprite):
				sprite.queue_free()
		_chunk_sprites.erase(key)


func clear_all() -> void:
	for key in _chunk_sprites:
		for sprite in _chunk_sprites[key]:
			if sprite != null and is_instance_valid(sprite):
				sprite.queue_free()
	_chunk_sprites.clear()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_chunk_renderer.gd
git commit -m "feat: LayeredChunkRenderer — 5-layer Sprite2D stack per chunk

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Integrate Layered Renderer into CleanWorld

**Files:**
- Modify: `scripts/CleanWorld.gd`

Add the layered renderer alongside the existing single-image renderer. The layered renderer displays on TOP of the existing terrain (so we can see the overlay layers while the base layer comes from the existing C++ pipeline).

- [ ] **Step 1: Add layered renderer initialization**

In `_ready()`, after the existing renderer setup, add:

```gdscript
# Layered terrain rendering (overlay on existing C++ terrain)
var _layered_renderer: LayeredChunkRenderer
# ... in _ready():
_layered_renderer = LayeredChunkRenderer.new()
_layered_renderer.setup(self, TILE_SIZE)
```

- [ ] **Step 2: Hook into chunk_loaded signal**

Connect the chunk_streamer's `chunk_loaded` signal to render overlay layers:

```gdscript
# In _ready(), after chunk_streamer.setup():
_chunk_streamer.chunk_loaded.connect(_on_chunk_loaded_layers)

func _on_chunk_loaded_layers(cx: int, cy: int) -> void:
	var chunk = _chunk_streamer.get_chunk(cx, cy)
	if chunk != null:
		_layered_renderer.render_chunk_layers(chunk)
```

- [ ] **Step 3: Clean up layered sprites on teleport**

In `_teleport_to`, add before `_renderer.clear_all()`:

```gdscript
_layered_renderer.clear_all()
```

- [ ] **Step 4: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: integrate layered renderer into CleanWorld — overlay layers on terrain

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Register TileStateManager in WorldManager

**Files:**
- Modify: `scripts/autoload/WorldManager.gd`

- [ ] **Step 1: Add TileStateManager to WorldManager**

Find the system initialization section and add:

```gdscript
var tile_state_manager: TileStateManager

# In _initialize_systems() or equivalent:
tile_state_manager = TileStateManager.new()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/autoload/WorldManager.gd
git commit -m "feat: register TileStateManager in WorldManager

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Test End-to-End Layer Rendering

**Files:** None (verification task)

- [ ] **Step 1: Ensure at least grassland has L1-L5 tiles in terrain_v2/**

If asset generation hasn't completed yet, manually copy existing grassland tiles into the new structure for testing:

```bash
cp assets/catalog/terrain/grassland/wang_*.png assets/catalog/terrain_v2/grassland/L1_base/
```

- [ ] **Step 2: Run the game (F6)**

Verify:
- Existing C++ terrain renders as before (base layer)
- Layered renderer adds L2-L5 overlays on top (if tiles exist)
- No crashes, no performance degradation
- Teleport works with layered renderer cleanup

- [ ] **Step 3: Check Godot output log**

Expect: `[LayeredTilesetLoader] Loaded N tiles across M biomes`

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end layer rendering verification fixes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
