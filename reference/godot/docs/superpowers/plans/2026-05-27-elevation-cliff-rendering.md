# Elevation Cliff Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat tile rendering with continuous elevation-driven cliff layers, where terrain height is expressed as stacked cliff walls and elevated surface tiles — creating visible topography like Zelda ALTTP / CrossCode.

**Architecture:** An `ElevationRenderer` replaces the current flat `LayeredChunkRenderer`. For each chunk, it sorts tiles by (row, elevation), computes cliff wall heights between adjacent tiles, and assembles a tall composite image with surface tiles at their elevated Y-offsets connected by cliff wall strips. A new `CliffTileLoader` loads 84 cliff face assets (7 pieces × 12 surfaces). The camera Y-offset tracks player elevation.

**Tech Stack:** Godot 4.4 / GDScript. PixelLab MCP for cliff tile generation. Existing terrain_v3 surface/transition tiles reused.

**Spec:** `docs/superpowers/specs/2026-05-27-elevation-cliff-rendering-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/core/world_compiler/cliff_tile_loader.gd` | Load cliff face assets (top/mid/bot/corners/diagonals per surface) |
| Create | `scripts/core/world_compiler/elevation_renderer.gd` | Core: given ChunkData, produce sorted draw list of surfaces + cliff walls with Y-offsets |
| Create | `tools/generate_cliff_tiles.py` | PixelLab cliff tile generation + download script |
| Modify | `scripts/core/world_compiler/layered_chunk_renderer.gd` | Delegate to ElevationRenderer, create sprites with Y-offsets |
| Modify | `scripts/CleanWorld.gd` | Camera Y-offset from elevation, zoom-out at height |

---

### Task 1: Generate Cliff Face Tiles via PixelLab

Generate all 84 cliff tiles (12 surfaces × 7 pieces each) and download into `assets/catalog/terrain_v3/cliffs/`. This is independent of code work and should run first so assets are ready.

**Files:**
- Create: `tools/generate_cliff_tiles.py`
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_top.png` (32×8 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_mid.png` (32×32 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_bot.png` (32×8 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/corner_inner.png` (32×32 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/corner_outer.png` (32×32 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/diag_sw_ne.png` (32×32 each)
- Create: `assets/catalog/terrain_v3/cliffs/{surface_id}/diag_se_nw.png` (32×32 each)

- [ ] **Step 1: Generate cliff_mid tiles for all 12 surfaces via PixelLab MCP**

Use `create_topdown_tileset` for each surface's cliff face. The cliff_mid tile is the main repeating wall texture (32×32). Generate as a self-tileset (lower=wall face, upper=wall face variant) with `transition_size=0.25` for subtle variation.

For each of the 12 surfaces, call PixelLab with descriptions like:
- `lush_grass`: lower="cross-section of dirt and soil with grass roots and earthworms, cliff face side view", upper="cross-section of dirt and soil with grass roots, slightly different layer pattern"
- `grey_rock`: lower="layered stone cliff face with mineral veins and moss patches, side view", upper="layered stone cliff face with cracks and lichen, slightly different pattern"
- `golden_sand`: lower="sandy cliff face with exposed rock and crumbling sand layers, side view", upper="sandy cliff face with shells embedded in sand layers"
- `forest_floor`: lower="dark earth cliff face with tree roots and buried leaves, side view", upper="dark earth cliff face with roots and small mushrooms"
- `snow`: lower="packed snow and ice cliff face with frozen dirt layers visible, side view", upper="packed snow cliff face with blue ice crystals"
- `frozen_earth`: lower="permafrost cliff face with ice crystal layers, side view", upper="permafrost cliff face with frozen soil bands"
- `glacial_ice`: lower="blue-white glacial ice cliff face with pressure cracks, side view", upper="glacial ice cliff face with air bubble layers"
- `volcanic_rock`: lower="dark basalt cliff face with glowing orange lava veins, side view", upper="dark volcanic rock cliff face with cooling lava cracks"
- `swamp_mud`: lower="wet mud cliff face with water seeping out and rotting plant matter, side view", upper="mud cliff face with clay layers and embedded twigs"
- `dry_grass`: lower="rocky soil cliff face with sparse root systems, side view", upper="dry soil cliff face with small stones and dead roots"
- `dark_humus`: lower="very dark decomposing earth cliff face with fungal networks, side view", upper="dark humus cliff face with beetle tunnels and mycelium"
- `mystic_crystal`: lower="glowing purple crystal cliff face cross-section with arcane veins, side view", upper="purple crystal cliff face with energy pulses"

Use `tile_size={"width": 32, "height": 32}`, `detail="highly detailed"`, `shading="detailed shading"`, `view="high top-down"`.

After each tileset completes, download the spritesheet via Godot editor script (same HTTPClient approach used for transition tilesets), take wang_0 as `cliff_mid.png`.

- [ ] **Step 2: Generate cliff_top tiles (32×8 overhangs)**

For each surface, use PixelLab `create_topdown_tileset` with the surface description as lower and "edge overhang where ground meets cliff drop, viewed from top-down showing grass/dirt/snow hanging over the edge" as upper. Tile size 32×8.

If PixelLab doesn't support 32×8, generate 32×32 and crop the top 8 rows.

- [ ] **Step 3: Generate cliff_bot tiles (32×8 bases)**

Same approach as cliff_top but with "base of cliff wall meeting lower ground, rubble, shadow, and debris" as the description. Crop to bottom 8 rows if needed.

- [ ] **Step 4: Generate corner and diagonal variants**

For each surface, generate:
- `corner_inner.png` (32×32): "concave cliff corner where two walls meet at 90 degrees, viewed from top-down, [surface] material"
- `corner_outer.png` (32×32): "convex cliff corner wrapping around a protruding ledge, viewed from top-down, [surface] material"
- `diag_sw_ne.png` (32×32): "diagonal cliff face running southwest to northeast, viewed from top-down, [surface] material"
- `diag_se_nw.png` (32×32): "diagonal cliff face running southeast to northwest, viewed from top-down, [surface] material"

- [ ] **Step 5: Verify all 84 tiles exist and commit**

```bash
# Should show 12 directories, each with 7 files
ls assets/catalog/terrain_v3/cliffs/
# Spot check
ls assets/catalog/terrain_v3/cliffs/lush_grass/
# Expected: cliff_top.png cliff_mid.png cliff_bot.png corner_inner.png corner_outer.png diag_sw_ne.png diag_se_nw.png

git add assets/catalog/terrain_v3/cliffs/ tools/generate_cliff_tiles.py
git commit -m "feat: generate 84 cliff face tiles — 7 pieces × 12 surfaces"
```

---

### Task 2: Implement CliffTileLoader

Load cliff face assets from `terrain_v3/cliffs/`. Simple static loader like `LayeredTilesetLoader`.

**Files:**
- Create: `scripts/core/world_compiler/cliff_tile_loader.gd`

- [ ] **Step 1: Write CliffTileLoader**

```gdscript
class_name CliffTileLoader

## Loads cliff face tiles from assets/catalog/terrain_v3/cliffs/.
## Each surface has: cliff_top (32x8), cliff_mid (32x32), cliff_bot (32x8),
## corner_inner (32x32), corner_outer (32x32), diag_sw_ne (32x32), diag_se_nw (32x32).

const CLIFFS_DIR = "res://assets/catalog/terrain_v3/cliffs"

const PIECE_NAMES = [
	"cliff_top", "cliff_mid", "cliff_bot",
	"corner_inner", "corner_outer",
	"diag_sw_ne", "diag_se_nw"
]

# surface_id -> piece_name -> Image
static var _cache: Dictionary = {}
static var _loaded: bool = false


static func load_all() -> void:
	if _loaded:
		return
	_cache.clear()

	var da = DirAccess.open(CLIFFS_DIR)
	if da == null:
		push_warning("[CliffTileLoader] No cliffs directory at %s" % CLIFFS_DIR)
		return

	var total = 0
	da.list_dir_begin()
	var dir_name = da.get_next()
	while dir_name != "":
		if da.current_is_dir():
			var pieces: Dictionary = {}
			for piece_name in PIECE_NAMES:
				var img_path = "%s/%s/%s.png" % [CLIFFS_DIR, dir_name, piece_name]
				if FileAccess.file_exists(img_path):
					var tex = load(img_path) as Texture2D
					if tex != null:
						var img = tex.get_image()
						if img.get_format() != Image.FORMAT_RGBA8:
							img.convert(Image.FORMAT_RGBA8)
						pieces[piece_name] = img
						total += 1
			if pieces.size() > 0:
				_cache[dir_name] = pieces
		dir_name = da.get_next()

	_loaded = true
	print("[CliffTileLoader] Loaded %d cliff tiles across %d surfaces" % [total, _cache.size()])


static func get_piece(surface_id: String, piece_name: String) -> Image:
	var surface = _cache.get(surface_id, null)
	if surface == null:
		return null
	return surface.get(piece_name, null)


static func has_surface(surface_id: String) -> bool:
	return _cache.has(surface_id)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/cliff_tile_loader.gd
git commit -m "feat: CliffTileLoader — loads cliff face tiles per surface"
```

---

### Task 3: Implement ElevationRenderer

The core rendering logic. Given a chunk, it produces a list of draw commands (surface tiles at Y-offsets + cliff wall strips) sorted back-to-front.

**Files:**
- Create: `scripts/core/world_compiler/elevation_renderer.gd`

- [ ] **Step 1: Write ElevationRenderer**

```gdscript
class_name ElevationRenderer

## Given a ChunkData, produces an elevation-rendered image with cliff walls.
## Surface tiles sit at their elevation Y-offset. Cliff walls fill gaps between
## adjacent tiles at different elevations.

const SEA_LEVEL: float = 0.38
const MIN_CLIFF_PX: int = 4

var pixels_per_unit: float = 512.0
var tile_size: int = 32


func render_chunk(chunk: ChunkData, chunk_streamer) -> Dictionary:
	## Returns {"image": Image, "y_offset": int}
	## y_offset is how many pixels above the chunk's base position this image starts.
	## The image may be taller than SIZE*tile_size due to cliff walls.

	var size = ChunkData.SIZE

	# Step 1: Compute per-tile elevation and visual Y-offset
	var tile_elev = PackedFloat32Array()
	tile_elev.resize(size * size)
	var min_elev: float = 1.0
	var max_elev: float = 0.0

	for y in range(size):
		for x in range(size):
			var idx = y * size + x
			var e = chunk.elevation[idx]
			tile_elev[idx] = e
			if e < min_elev:
				min_elev = e
			if e > max_elev:
				max_elev = e

	# Clamp to sea level minimum for visual purposes
	var base_elev = maxf(min_elev, SEA_LEVEL)

	# Step 2: Compute image dimensions
	# The image extends from base_elev to max_elev in visual height,
	# plus tile_size for the top surface, plus cliff walls below base
	var elev_range = max_elev - base_elev
	var max_cliff_height = int(elev_range * pixels_per_unit)
	var img_width = size * tile_size
	var img_height = size * tile_size + max_cliff_height

	# y_offset: how many pixels this image extends ABOVE the chunk's grid position
	var y_offset = max_cliff_height

	var img = Image.create(img_width, img_height, true, Image.FORMAT_RGBA8)

	# Step 3: Render tiles back-to-front (north to south row, then by elevation)
	for y in range(size):
		for x in range(size):
			var idx = y * size + x
			var elev = tile_elev[idx]

			# Visual Y position: higher elevation = higher on screen (lower Y)
			var elev_offset = int((elev - base_elev) * pixels_per_unit)
			var dest_x = x * tile_size
			var dest_y = y * tile_size + y_offset - elev_offset

			# Get surface tile from hypergraph resolver
			var biome_id = chunk.biome_id[idx]
			var biome_name = ElevationGradientTable.biome_name_from_id(biome_id)
			var elev_tl = _sample_elev(chunk, chunk_streamer, x, y)
			var elev_tr = _sample_elev(chunk, chunk_streamer, x + 1, y)
			var elev_bl = _sample_elev(chunk, chunk_streamer, x, y + 1)
			var elev_br = _sample_elev(chunk, chunk_streamer, x + 1, y + 1)
			var wx = chunk.chunk_x * size + x
			var wy = chunk.chunk_y * size + y

			var result = HypergraphTileResolver.resolve(
				biome_name, elev_tl, elev_tr, elev_bl, elev_br,
				chunk.world_seed, wx, wy
			)
			var surface_id = result["surface_a"]

			# Draw surface tile
			var tile_img = LayeredTilesetLoader.get_tile(
				result["tileset_key"], result["wang_index"]
			)
			if tile_img == null:
				tile_img = LayeredTilesetLoader.get_tile(surface_id, 0)
			if tile_img != null:
				_blit_safe(img, tile_img, dest_x, dest_y, tile_size, tile_size)

			# Draw south cliff wall
			if y < size - 1:
				var south_elev = tile_elev[(y + 1) * size + x]
				var cliff_h = int((elev - south_elev) * pixels_per_unit)
				if cliff_h >= MIN_CLIFF_PX:
					_draw_cliff_wall(img, surface_id, dest_x, dest_y + tile_size, cliff_h)

			# Draw east cliff wall
			if x < size - 1:
				var east_elev = tile_elev[y * size + (x + 1)]
				var cliff_h = int((elev - east_elev) * pixels_per_unit)
				if cliff_h >= MIN_CLIFF_PX:
					_draw_cliff_wall_east(img, surface_id, dest_x + tile_size, dest_y, cliff_h)

			# Draw corner cliff pieces where south and east walls meet
			if x < size - 1 and y < size - 1:
				var south_elev = tile_elev[(y + 1) * size + x]
				var east_elev = tile_elev[y * size + (x + 1)]
				var se_elev = tile_elev[(y + 1) * size + (x + 1)]
				var has_south = (elev - south_elev) * pixels_per_unit >= MIN_CLIFF_PX
				var has_east = (elev - east_elev) * pixels_per_unit >= MIN_CLIFF_PX
				var has_se = (elev - se_elev) * pixels_per_unit >= MIN_CLIFF_PX

				if has_south and has_east:
					# Inner corner — two walls meet at this tile's SE corner
					var corner_img = CliffTileLoader.get_piece(surface_id, "corner_inner")
					if corner_img != null:
						_blit_safe(img, corner_img, dest_x + tile_size, dest_y + tile_size, tile_size, tile_size)
				elif has_se and not has_south and not has_east:
					# Outer corner — diagonal drop to SE
					var corner_img = CliffTileLoader.get_piece(surface_id, "corner_outer")
					if corner_img != null:
						_blit_safe(img, corner_img, dest_x + tile_size, dest_y + tile_size, tile_size, tile_size)

			# Draw diagonal cliff pieces
			if x < size - 1 and y < size - 1:
				var se_elev = tile_elev[(y + 1) * size + (x + 1)]
				var south_elev = tile_elev[(y + 1) * size + x]
				var east_elev = tile_elev[y * size + (x + 1)]
				# SW-NE diagonal: this tile high, south-east neighbor low, but south and east are mid
				var avg_adjacent = (south_elev + east_elev) * 0.5
				var diag_diff = (elev - se_elev) * pixels_per_unit
				var adj_diff = absf(elev - avg_adjacent) * pixels_per_unit
				if diag_diff >= MIN_CLIFF_PX and adj_diff < MIN_CLIFF_PX:
					var diag_img = CliffTileLoader.get_piece(surface_id, "diag_sw_ne")
					if diag_img != null:
						_blit_safe(img, diag_img, dest_x + tile_size, dest_y + tile_size, tile_size, tile_size)

	# Step 4: Draw water plane for submerged areas
	_draw_water_plane(img, chunk, base_elev, y_offset)

	return {"image": img, "y_offset": y_offset}


func _draw_cliff_wall(img: Image, surface_id: String, x: int, y: int, height: int) -> void:
	## Draw a south-facing cliff wall of given pixel height at position (x, y).
	var top_img = CliffTileLoader.get_piece(surface_id, "cliff_top")
	var mid_img = CliffTileLoader.get_piece(surface_id, "cliff_mid")
	var bot_img = CliffTileLoader.get_piece(surface_id, "cliff_bot")

	if mid_img == null:
		# No cliff tile — draw a dark fallback strip
		for py in range(height):
			for px in range(tile_size):
				var ix = x + px
				var iy = y + py
				if ix >= 0 and ix < img.get_width() and iy >= 0 and iy < img.get_height():
					img.set_pixel(ix, iy, Color(0.15, 0.12, 0.1, 1.0))
		return

	var top_h = 8 if top_img != null else 0
	var bot_h = 8 if bot_img != null else 0
	var mid_h = height - top_h - bot_h
	var cy = y

	# Top edge
	if top_img != null and top_h > 0:
		_blit_safe(img, top_img, x, cy, tile_size, top_h)
		cy += top_h

	# Middle (repeating)
	if mid_h > 0 and mid_img != null:
		var drawn = 0
		while drawn < mid_h:
			var draw_h = mini(32, mid_h - drawn)
			if draw_h < 32:
				# Partial tile — crop
				var partial = mid_img.get_region(Rect2i(0, 0, tile_size, draw_h))
				_blit_safe(img, partial, x, cy, tile_size, draw_h)
			else:
				_blit_safe(img, mid_img, x, cy, tile_size, 32)
			cy += draw_h
			drawn += draw_h

	# Bottom edge
	if bot_img != null and bot_h > 0:
		_blit_safe(img, bot_img, x, cy, tile_size, bot_h)


func _draw_cliff_wall_east(img: Image, surface_id: String, x: int, y: int, height: int) -> void:
	## Draw an east-facing cliff wall. Same logic as south but positioned on the right edge.
	## For now, reuse the same cliff tiles (rotated rendering is a future enhancement).
	_draw_cliff_wall(img, surface_id, x, y, height)


func _draw_water_plane(img: Image, chunk: ChunkData, base_elev: float, y_offset: int) -> void:
	## Draw water surface for tiles below sea level.
	var size = ChunkData.SIZE
	var water_color = Color(0.15, 0.35, 0.6, 0.85)

	for y in range(size):
		for x in range(size):
			var elev = chunk.elevation[y * size + x]
			if elev < SEA_LEVEL:
				var dest_x = x * tile_size
				# Water sits at sea level visual position
				var water_y = y * tile_size + y_offset - int((SEA_LEVEL - base_elev) * pixels_per_unit)
				# Draw water tile
				var water_img = LayeredTilesetLoader.get_tile("ocean_water", 0)
				if water_img != null:
					_blit_safe(img, water_img, dest_x, water_y, tile_size, tile_size)
				else:
					# Fallback: solid blue
					for py in range(tile_size):
						for px in range(tile_size):
							var ix = dest_x + px
							var iy = water_y + py
							if ix >= 0 and ix < img.get_width() and iy >= 0 and iy < img.get_height():
								img.set_pixel(ix, iy, water_color)


func _blit_safe(dst: Image, src: Image, x: int, y: int, w: int, h: int) -> void:
	## Blit with bounds checking — clips to destination image bounds.
	if x >= dst.get_width() or y >= dst.get_height():
		return
	if x + w < 0 or y + h < 0:
		return

	var src_x = 0
	var src_y = 0
	var dst_x = x
	var dst_y = y
	var blit_w = w
	var blit_h = h

	if dst_x < 0:
		src_x = -dst_x
		blit_w += dst_x
		dst_x = 0
	if dst_y < 0:
		src_y = -dst_y
		blit_h += dst_y
		dst_y = 0
	if dst_x + blit_w > dst.get_width():
		blit_w = dst.get_width() - dst_x
	if dst_y + blit_h > dst.get_height():
		blit_h = dst.get_height() - dst_y

	if blit_w <= 0 or blit_h <= 0:
		return

	dst.blend_rect(src, Rect2i(src_x, src_y, blit_w, blit_h), Vector2i(dst_x, dst_y))


func _sample_elev(chunk: ChunkData, streamer, x: int, y: int) -> float:
	var size = ChunkData.SIZE
	if x >= 0 and x < size and y >= 0 and y < size:
		return chunk.elevation[y * size + x]
	if streamer == null:
		return chunk.elevation[clampi(y, 0, size - 1) * size + clampi(x, 0, size - 1)]

	var adj_cx = chunk.chunk_x
	var adj_cy = chunk.chunk_y
	var lx = x
	var ly = y
	if x >= size:
		adj_cx += 1
		lx = 0
	elif x < 0:
		adj_cx -= 1
		lx = size - 1
	if y >= size:
		adj_cy += 1
		ly = 0
	elif y < 0:
		adj_cy -= 1
		ly = size - 1

	var adj = streamer.get_chunk(adj_cx, adj_cy)
	if adj != null:
		return adj.elevation[ly * size + lx]
	return chunk.elevation[clampi(y, 0, size - 1) * size + clampi(x, 0, size - 1)]
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/elevation_renderer.gd
git commit -m "feat: ElevationRenderer — cliff walls + elevated surfaces from continuous elevation"
```

---

### Task 4: Rewrite LayeredChunkRenderer to Use ElevationRenderer

Replace the flat image rendering with elevation-aware rendering. The key change: chunk sprites now have variable height and a Y-offset.

**Files:**
- Modify: `scripts/core/world_compiler/layered_chunk_renderer.gd`

- [ ] **Step 1: Rewrite LayeredChunkRenderer**

Replace the entire contents of `scripts/core/world_compiler/layered_chunk_renderer.gd` with:

```gdscript
class_name LayeredChunkRenderer

## Renders chunks with elevation-driven cliff layers.
## Delegates to ElevationRenderer for the actual image composition,
## then creates sprites positioned with Y-offsets for visual height.

var _parent: Node2D
var _tile_size: int = 32
var _chunk_sprites: Dictionary = {}  # Vector2i -> Sprite2D
var _chunk_streamer = null
var _elevation_renderer: ElevationRenderer


func setup(parent: Node2D, tile_size: int = 32) -> void:
	_parent = parent
	_tile_size = tile_size
	_elevation_renderer = ElevationRenderer.new()
	_elevation_renderer.tile_size = tile_size
	LayeredTilesetLoader.load_all()
	CliffTileLoader.load_all()


func set_chunk_streamer(streamer) -> void:
	_chunk_streamer = streamer


func render_chunk_layers(chunk: ChunkData) -> void:
	var key = Vector2i(chunk.chunk_x, chunk.chunk_y)
	clear_chunk(chunk.chunk_x, chunk.chunk_y)

	var size = ChunkData.SIZE
	var px_size = size * _tile_size

	var result = _elevation_renderer.render_chunk(chunk, _chunk_streamer)
	var img = result["image"] as Image
	var y_offset = result["y_offset"] as int

	if img == null or img.get_width() == 0:
		return

	var tex = ImageTexture.create_from_image(img)
	var sprite = Sprite2D.new()
	sprite.texture = tex
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.centered = false
	# Position: chunk grid position minus the Y-offset (image extends upward)
	sprite.position = Vector2(
		chunk.chunk_x * px_size,
		chunk.chunk_y * px_size - y_offset
	)
	sprite.z_index = -1
	_parent.add_child(sprite)
	_chunk_sprites[key] = sprite


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if _chunk_sprites.has(key):
		var sprite = _chunk_sprites[key]
		if sprite != null and is_instance_valid(sprite):
			sprite.queue_free()
		_chunk_sprites.erase(key)


func clear_all() -> void:
	for key in _chunk_sprites:
		var sprite = _chunk_sprites[key]
		if sprite != null and is_instance_valid(sprite):
			sprite.queue_free()
	_chunk_sprites.clear()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_chunk_renderer.gd
git commit -m "feat: rewrite LayeredChunkRenderer to use ElevationRenderer with cliff walls"
```

---

### Task 5: Update Camera for Elevation Y-Offset

The player's screen position must account for elevation. The camera follows the player at their visual Y position (grid position + elevation offset).

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Add elevation Y-offset to player position and camera**

In `scripts/CleanWorld.gd`, find the `_process` function. The player movement currently updates `_player.position` in grid space. We need to:

1. Track the player's visual Y-offset from elevation
2. Apply it to the camera (not the player node — the player stays in grid space, camera offsets)

Find the camera zoom section (around line 346-349):

```gdscript
	# Camera zoom responds to elevation
	var elev = _get_elevation_at(_player.position)
	_target_zoom = lerpf(ZOOM_MAX, ZOOM_MIN, clampf((elev - 0.35) / 0.5, 0.0, 1.0))
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), delta * 2.0)
```

Replace with:

```gdscript
	# Camera responds to elevation — Y-offset and zoom
	var elev = _get_elevation_at(_player.position)
	var elev_y_offset = (elev - 0.38) * 512.0  # PIXELS_PER_UNIT, matches ElevationRenderer
	_camera.offset = Vector2(0, -elev_y_offset)

	# Zoom out at height — see more from mountaintops
	_target_zoom = lerpf(ZOOM_MAX, ZOOM_MIN, clampf((elev - 0.35) / 0.5, 0.0, 1.0))
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), delta * 2.0)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: camera Y-offset from elevation — player visually rises with terrain"
```

---

### Task 6: Visual QA — Run Game and Verify

Run the game, teleport to different biomes, and verify the elevation system works.

**Files:**
- No new files — QA pass

- [ ] **Step 1: Run the game (F6 or via Godot MCP)**

Play `res://scenes/CleanWorld.tscn`. Check the output log for:
```
[CliffTileLoader] Loaded N cliff tiles across N surfaces
[ElevationGradientTable] Loaded 18 biome gradients, 13 surfaces, 19 transitions
[LayeredTilesetLoader] Loaded N tiles (N tilesets)
```

- [ ] **Step 2: Verify at spawn point**

Look for:
- Surface tiles at different visual heights (not all on one flat plane)
- Cliff walls visible between elevation changes (south-facing textured walls)
- Water at the bottom of low-elevation areas
- Camera moves up/down as player walks uphill/downhill

- [ ] **Step 3: Open overmap (M) and teleport to different biomes**

Test:
- Grassland area — gentle hills with grass→rock cliff faces
- Mountain area — dramatic cliff walls, snow at peaks
- Ocean/coastal area — water at bottom, sandy cliffs rising to shore
- Tundra — frozen earth cliffs with snow on top

- [ ] **Step 4: Screenshot and assess**

Take screenshots via `get_game_screenshot`. Honestly assess:
- Do cliffs look like real elevation or just visual noise?
- Is the cliff height proportional to actual elevation differences?
- Does the water sit correctly at the bottom of basins?
- Are there rendering artifacts (gaps, overlaps, z-fighting)?

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "feat: elevation cliff rendering — visual QA pass"
```

---

## Summary

| Task | Description | Files | Dependency |
|------|------------|-------|------------|
| 1 | Generate 84 cliff tiles via PixelLab | assets + script | None (can run first) |
| 2 | CliffTileLoader | New GDScript class | Task 1 (needs assets) |
| 3 | ElevationRenderer | New GDScript class | Task 2 |
| 4 | Rewrite LayeredChunkRenderer | Modify existing | Task 3 |
| 5 | Camera elevation Y-offset | Modify CleanWorld.gd | Task 4 |
| 6 | Visual QA | Run + screenshot | Task 5 |

**Not in this plan (deferred):**
- Player climbing/gliding mechanics (separate spec)
- C++ performance optimization (after visual validation)
- Bokeh depth-of-field integration (extend existing system after elevation works)

**Note:** Corner and diagonal cliff tiles are generated in Task 1 and their rendering logic is included in Task 3's `ElevationRenderer`. The renderer detects corner and diagonal elevation patterns and uses the appropriate cliff piece. All 84 tiles (straight + corner + diagonal) are V1 requirements.
