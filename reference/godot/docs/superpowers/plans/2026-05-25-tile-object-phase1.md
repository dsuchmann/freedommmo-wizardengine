# Tile Object System Phase 1 — Data Model + Terrain Tiles + Renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace colored-pixel terrain with PixelLab-generated tile art, backed by a TileObjectStack data model that supports multiple objects per tile.

**Architecture:** TileObject/TileStack classes hold stacked objects per tile. AssetCatalog loads tile manifests from JSON. PixelLab generates terrain tiles (grass, water, sand, stone, paths). DeferredRenderer paints real textures instead of flat colors.

**Tech Stack:** Godot 4.4 GDScript, PixelLab MCP (create_tiles_pro), existing WorldCompiler

---

### Task 1: TileObject + TileStack Classes

**Files:**
- Create: `scripts/core/world_compiler/tile_object.gd`

- [ ] **Step 1: Create TileObject and TileStack**

```gdscript
# scripts/core/world_compiler/tile_object.gd
class_name TileObject

var asset_id: String = ""
var category: String = ""
var z_layer: int = 0
var walkable: bool = true
var blocking: bool = false
var pickable: bool = false
var interactable: bool = false
var provides: Array = []
var value: int = 0
var properties: Dictionary = {}

func _init(p_asset_id: String = "", p_category: String = "", p_z_layer: int = 0):
	asset_id = p_asset_id
	category = p_category
	z_layer = p_z_layer

class TileStack:
	var objects: Array = []

	func add(obj: TileObject) -> void:
		objects.append(obj)
		objects.sort_custom(func(a, b): return a.z_layer < b.z_layer)

	func remove(obj: TileObject) -> void:
		objects.erase(obj)

	func top() -> TileObject:
		if objects.is_empty():
			return null
		return objects[objects.size() - 1]

	func is_walkable() -> bool:
		for obj in objects:
			if obj.blocking:
				return false
		return true

	func get_interactables() -> Array:
		var result = []
		for i in range(objects.size() - 1, -1, -1):
			if objects[i].interactable:
				result.append(objects[i])
		return result

	func get_pickables() -> Array:
		var result = []
		for i in range(objects.size() - 1, -1, -1):
			if objects[i].pickable:
				result.append(objects[i])
		return result

	func get_by_category(cat: String) -> Array:
		var result = []
		for obj in objects:
			if obj.category == cat:
				result.append(obj)
		return result

	func has_surface() -> bool:
		for obj in objects:
			if obj.properties.get("surface", false):
				return true
		return false
```

- [ ] **Step 2: Add tile_stacks to ChunkData**

In `scripts/core/world_compiler/chunk_data.gd`, add after `var building_tiles`:
```gdscript
var tile_stacks: Dictionary = {}     # Vector2i → TileStack
```

Add helper methods:
```gdscript
func get_tile_stack(x: int, y: int) -> TileObject.TileStack:
	var key = Vector2i(x, y)
	if not tile_stacks.has(key):
		tile_stacks[key] = TileObject.TileStack.new()
	return tile_stacks[key]

func add_tile_object(x: int, y: int, obj: TileObject) -> void:
	get_tile_stack(x, y).add(obj)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/tile_object.gd scripts/core/world_compiler/chunk_data.gd
git commit -m "feat: TileObject + TileStack data model for stacked objects per tile"
```

---

### Task 2: AssetCatalog

**Files:**
- Create: `scripts/core/world_compiler/asset_catalog.gd`
- Create: `assets/catalog/terrain/manifest.json` (empty starter)

- [ ] **Step 1: Create AssetCatalog**

```gdscript
# scripts/core/world_compiler/asset_catalog.gd
class_name AssetCatalog

var _assets: Dictionary = {}
var _by_category: Dictionary = {}
var _textures: Dictionary = {}

func load_manifests(base_path: String) -> void:
	var dir = DirAccess.open(base_path)
	if dir == null:
		push_warning("AssetCatalog: Cannot open %s" % base_path)
		return
	dir.list_dir_begin()
	var subdir = dir.get_next()
	while subdir != "":
		if dir.current_is_dir() and subdir != "." and subdir != "..":
			var manifest_path = base_path + "/" + subdir + "/manifest.json"
			_load_manifest(manifest_path, subdir)
		subdir = dir.get_next()
	dir.list_dir_end()
	print("[AssetCatalog] Loaded %d assets across %d categories" % [_assets.size(), _by_category.size()])

func _load_manifest(path: String, category: String) -> void:
	var json_text = FileAccess.get_file_as_string(path)
	if json_text == "":
		return
	var json = JSON.new()
	if json.parse(json_text) != OK:
		push_warning("AssetCatalog: Failed to parse %s" % path)
		return
	var data = json.data
	if not data.has("assets"):
		return
	if not _by_category.has(category):
		_by_category[category] = []
	for asset in data["assets"]:
		var id = asset.get("id", "")
		if id == "":
			continue
		asset["_category"] = category
		asset["_dir"] = path.get_base_dir()
		_assets[id] = asset
		_by_category[category].append(id)

func get_asset(id: String) -> Dictionary:
	return _assets.get(id, {})

func get_random_from_category(category: String, rng: RandomNumberGenerator) -> String:
	var ids = _by_category.get(category, [])
	if ids.is_empty():
		return ""
	return ids[rng.randi() % ids.size()]

func get_ids_for_category(category: String) -> Array:
	return _by_category.get(category, [])

func get_texture(id: String) -> Texture2D:
	if _textures.has(id):
		return _textures[id]
	var asset = _assets.get(id, {})
	if asset.is_empty():
		return null
	var dir_path = asset.get("_dir", "")
	var file_name = asset.get("file", "")
	if dir_path == "" or file_name == "":
		return null
	var full_path = dir_path + "/" + file_name
	var tex = load(full_path) as Texture2D
	if tex:
		_textures[id] = tex
	return tex

func get_tile_image(id: String) -> Image:
	var asset = _assets.get(id, {})
	if asset.is_empty():
		return null
	var dir_path = asset.get("_dir", "")
	var file_name = asset.get("file", "")
	if dir_path == "" or file_name == "":
		return null
	var full_path = dir_path + "/" + file_name
	var img = Image.load_from_file(full_path)
	return img
```

- [ ] **Step 2: Create empty terrain manifest**

```json
{
  "category": "terrain",
  "tile_size": 32,
  "assets": []
}
```

Save to `assets/catalog/terrain/manifest.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/asset_catalog.gd assets/catalog/terrain/manifest.json
git commit -m "feat: AssetCatalog — loads tile manifests from JSON, serves textures"
```

---

### Task 3: Generate PixelLab Terrain Tiles

**Files:**
- Update: `assets/catalog/terrain/manifest.json`
- Download: terrain PNGs to `assets/catalog/terrain/`

- [ ] **Step 1: Generate grass tiles (5 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). lush green grass tile 2). green grass with small flowers 3). tall grass meadow 4). short trimmed grass 5). grass with clover patches"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 2: Generate water tiles (5 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). deep blue ocean water 2). shallow turquoise water 3). river water with current 4). calm lake water 5). murky swamp water"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 3: Generate sand/desert tiles (4 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). golden sand beach 2). dry desert sand 3). sand with small pebbles 4). sandy path"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 4: Generate stone/mountain tiles (4 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). grey mountain rock 2). dark stone cliff 3). mossy cobblestone 4). gravel path"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 5: Generate path tiles (3 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). dirt path worn brown 2). cobblestone road 3). forest trail"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 6: Generate snow/ice tiles (3 variants)**

Call PixelLab `create_tiles_pro` with:
- description: "1). white snow ground 2). frozen ice surface 3). snow with footprints"
- tile_type: square_topdown
- tile_size: 32
- tile_view: top-down

- [ ] **Step 7: Download all tiles and write manifest**

For each generated tile set:
1. Use `get_tiles_pro` to check status and get image data
2. Save PNGs to `assets/catalog/terrain/`
3. Update `manifest.json` with entries mapping biome → asset IDs

Final manifest should have ~24 terrain tile assets with biome tags.

- [ ] **Step 8: Commit**

```bash
git add assets/catalog/terrain/
git commit -m "feat: 24 PixelLab terrain tiles — grass, water, sand, stone, path, snow"
```

---

### Task 4: BiomeToAsset Mapping

**Files:**
- Create: `data/biome_assets.json`

- [ ] **Step 1: Create biome-to-terrain-asset mapping**

```json
{
  "biome_terrain": {
    "grassland": ["grass_01", "grass_02", "grass_03", "grass_04", "grass_05"],
    "forest": ["grass_01", "grass_04"],
    "dense_forest": ["grass_01", "grass_04"],
    "ocean": ["water_deep_01"],
    "lake": ["water_lake_01"],
    "river": ["water_river_01"],
    "beach": ["sand_beach_01"],
    "desert": ["sand_desert_01", "sand_pebbles_01"],
    "savanna": ["grass_01", "sand_desert_01"],
    "steppe": ["grass_03", "sand_pebbles_01"],
    "mountains": ["stone_mountain_01", "stone_cliff_01"],
    "tundra": ["snow_01", "snow_footprints_01"],
    "arctic": ["snow_01", "ice_01"],
    "taiga": ["snow_01", "grass_01"],
    "swamp": ["water_swamp_01", "grass_01"],
    "tropical_forest": ["grass_02", "grass_05"],
    "volcanic": ["stone_cliff_01"]
  },
  "road_tiles": ["path_dirt_01", "path_cobble_01", "path_forest_01"],
  "wall_tiles": {},
  "floor_tiles": {}
}
```

Note: Asset IDs will be updated after PixelLab generation to match actual generated IDs.

- [ ] **Step 2: Commit**

```bash
git add data/biome_assets.json
git commit -m "feat: biome-to-terrain-asset mapping for tile rendering"
```

---

### Task 5: Upgrade DeferredRenderer to Use Real Tiles

**Files:**
- Modify: `scripts/core/world_compiler/deferred_renderer.gd`

- [ ] **Step 1: Add AssetCatalog to DeferredRenderer**

Add member variable and update setup():
```gdscript
var _catalog: AssetCatalog = null
var _biome_map: Dictionary = {}

func setup(parent: Node2D, world_scale: int = 32) -> void:
	_parent = parent
	_world_scale = world_scale
	_catalog = AssetCatalog.new()
	_catalog.load_manifests("res://assets/catalog")
	_load_biome_map()

func _load_biome_map() -> void:
	var json_text = FileAccess.get_file_as_string("res://data/biome_assets.json")
	if json_text == "":
		return
	var json = JSON.new()
	if json.parse(json_text) == OK:
		_biome_map = json.data
```

- [ ] **Step 2: Rewrite _render_terrain to use tile textures**

Replace the current `_render_terrain` with a version that paints real 32x32 tile images instead of single-color pixels:

```gdscript
func _render_terrain(chunk: ChunkData, ox: int, oy: int, size: int) -> void:
	var tile_px = 32
	var img = Image.create(size * tile_px, size * tile_px, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.2, 0.2, 0.2, 1.0))
	
	var rng = RandomNumberGenerator.new()
	rng.seed = chunk.world_seed ^ (chunk.chunk_x * 73856093) ^ (chunk.chunk_y * 19349663)
	
	var biome_terrain = _biome_map.get("biome_terrain", {})
	var tile_cache: Dictionary = {}  # asset_id → Image
	
	for y in range(size):
		for x in range(size):
			var biome = chunk.get_biome(x, y)
			var biome_name = BiomeLayer.biome_name(biome)
			var tile_ids = biome_terrain.get(biome_name, [])
			
			if tile_ids.is_empty():
				# Fallback: paint solid color
				var color = BiomeLayer.biome_color(biome)
				for py in range(tile_px):
					for px in range(tile_px):
						img.set_pixel(x * tile_px + px, y * tile_px + py, color)
				continue
			
			# Pick a variant deterministically from position
			var hash_val = ((x * 73856093) ^ (y * 19349663)) & 0x7FFFFFFF
			var tile_id = tile_ids[hash_val % tile_ids.size()]
			
			# Load tile image (cached)
			if not tile_cache.has(tile_id):
				var tile_img = _catalog.get_tile_image(tile_id)
				if tile_img:
					tile_cache[tile_id] = tile_img
				else:
					tile_cache[tile_id] = null
			
			var tile_img = tile_cache.get(tile_id)
			if tile_img and tile_img is Image:
				# Blit 32x32 tile onto terrain image
				var src_rect = Rect2i(0, 0, mini(tile_img.get_width(), tile_px), mini(tile_img.get_height(), tile_px))
				var dst_pos = Vector2i(x * tile_px, y * tile_px)
				img.blit_rect(tile_img, src_rect, dst_pos)
			else:
				# Fallback: solid color
				var color = BiomeLayer.biome_color(biome)
				for py in range(tile_px):
					for px in range(tile_px):
						img.set_pixel(x * tile_px + px, y * tile_px + py, color)
	
	var tex = ImageTexture.create_from_image(img)
	var sprite = Sprite2D.new()
	sprite.texture = tex
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.position = Vector2(
		ox * _world_scale + size * _world_scale / 2,
		oy * _world_scale + size * _world_scale / 2
	)
	# Scale: image is size*32 pixels, world is size*world_scale pixels
	# If world_scale == 32, scale = 1.0. If world_scale != 32, adjust.
	sprite.scale = Vector2(float(_world_scale) / tile_px, float(_world_scale) / tile_px)
	sprite.z_index = -2
	_parent.add_child(sprite)
```

- [ ] **Step 3: Similarly update _render_water, _render_roads, _render_buildings to use larger images**

These also need to render at tile_px resolution (size*32 × size*32) instead of size×size when real tiles are available. For now, they paint colored rectangles at 32x scale within the larger image:

```gdscript
func _render_water(chunk: ChunkData, ox: int, oy: int, size: int) -> void:
	var tile_px = 32
	var img = Image.create(size * tile_px, size * tile_px, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var blue = Color(0.2, 0.4, 0.9, 1.0)
	for pos in chunk.river_cells:
		for py in range(tile_px):
			for px in range(tile_px):
				img.set_pixel(pos.x * tile_px + px, pos.y * tile_px + py, blue)
	for pos in chunk.lake_cells:
		var lake_blue = Color(0.15, 0.35, 0.75, 1.0)
		for py in range(tile_px):
			for px in range(tile_px):
				img.set_pixel(pos.x * tile_px + px, pos.y * tile_px + py, lake_blue)
	_make_sprite_hires(img, ox, oy, size, -1)

func _render_roads(chunk: ChunkData, ox: int, oy: int, size: int) -> void:
	var tile_px = 32
	var img = Image.create(size * tile_px, size * tile_px, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var road_color = Color(0.65, 0.55, 0.35, 1.0)
	for pos in chunk.road_cells:
		for py in range(tile_px):
			for px in range(tile_px):
				img.set_pixel(pos.x * tile_px + px, pos.y * tile_px + py, road_color)
	_make_sprite_hires(img, ox, oy, size, 0)

func _render_buildings(chunk: ChunkData, ox: int, oy: int, size: int) -> void:
	var tile_px = 32
	var img = Image.create(size * tile_px, size * tile_px, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	for pos in chunk.building_tiles:
		if pos.x < 0 or pos.x >= size or pos.y < 0 or pos.y >= size:
			continue
		var tile = chunk.building_tiles[pos]
		var color: Color
		match tile["type"]:
			"wall": color = Color(0.45, 0.3, 0.15, 1.0)
			"floor": color = Color(0.65, 0.55, 0.4, 1.0)
			"door": color = Color(0.3, 0.6, 0.2, 1.0)
			_: color = Color(0.5, 0.5, 0.5, 1.0)
		for py in range(tile_px):
			for px in range(tile_px):
				img.set_pixel(pos.x * tile_px + px, pos.y * tile_px + py, color)
	_make_sprite_hires(img, ox, oy, size, 1)

func _make_sprite_hires(img: Image, ox: int, oy: int, size: int, z: int) -> void:
	var tex = ImageTexture.create_from_image(img)
	var sprite = Sprite2D.new()
	sprite.texture = tex
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.position = Vector2(
		ox * _world_scale + size * _world_scale / 2,
		oy * _world_scale + size * _world_scale / 2
	)
	sprite.scale = Vector2(float(_world_scale) / 32.0, float(_world_scale) / 32.0)
	sprite.z_index = z
	_parent.add_child(sprite)
```

Also update _render_vegetation and _render_roofs similarly.

- [ ] **Step 4: Commit**

```bash
git add scripts/core/world_compiler/deferred_renderer.gd
git commit -m "feat: DeferredRenderer renders real tile textures from AssetCatalog"
```

---

### Task 6: Add Walkability to Player Movement

**Files:**
- Modify: `scripts/GrainWorldDemo.gd`

- [ ] **Step 1: Check walkability before moving**

In the compiler-mode `_process()` movement section, add walkability check:

```gdscript
if move_dir != Vector2.ZERO:
	var new_pos = _player_pos + move_dir.normalized() * 3.0 * delta
	# Check walkability at target position
	var can_move = true
	if _compiled_chunk:
		var tx = int(new_pos.x)
		var ty = int(new_pos.y)
		if tx >= 0 and tx < ChunkData.SIZE and ty >= 0 and ty < ChunkData.SIZE:
			var w = _compiled_chunk.get_walkability(tx, ty)
			if w < 0:
				can_move = false
	if can_move:
		_player_pos = new_pos
```

- [ ] **Step 2: Commit**

```bash
git add scripts/GrainWorldDemo.gd
git commit -m "feat: player blocked by water and walls (walkability check)"
```

---

### Task 7: Wire AssetCatalog into WorldManager

**Files:**
- Modify: `scripts/autoload/WorldManager.gd`

- [ ] **Step 1: Add asset_catalog to WorldManager**

Add member variable:
```gdscript
var asset_catalog: AssetCatalog = null
```

In `_init_systems()`, after world_compiler initialization:
```gdscript
asset_catalog = AssetCatalog.new()
asset_catalog.load_manifests("res://assets/catalog")
```

- [ ] **Step 2: Pass catalog to DeferredRenderer in GrainWorldDemo**

Update the DeferredRenderer setup in the compiler branch of _start_game():
```gdscript
_deferred_renderer = DeferredRenderer.new()
_deferred_renderer.setup(self)
```
The DeferredRenderer now loads its own catalog in setup(), so no change needed here. But if we want shared catalog, pass it:
```gdscript
_deferred_renderer._catalog = WorldManager.asset_catalog
```

- [ ] **Step 3: Commit**

```bash
git add scripts/autoload/WorldManager.gd scripts/GrainWorldDemo.gd
git commit -m "feat: AssetCatalog wired into WorldManager + DeferredRenderer"
```
