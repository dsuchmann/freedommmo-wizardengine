class_name MapObjectRenderer
extends RefCounted

## Renders structures and world objects using PixelLab map object sprites.
## Scans directories dynamically — no hardcoded paths. Supports unlimited assets.

const WORLD_SCALE = 32

var _building_sprites: Dictionary = {}  # base_name → Array[Texture2D]
var _nature_sprites: Dictionary = {}
var _decoration_sprites: Dictionary = {}
var _spawned_structures: Dictionary = {}
var _spawned_cells: Dictionary = {}

func _init() -> void:
	_load_sprites()

func _load_sprites() -> void:
	_building_sprites = _scan_dir("res://assets/map_objects/buildings/")
	_nature_sprites = _scan_dir("res://assets/map_objects/nature/")
	_decoration_sprites = _scan_dir("res://assets/map_objects/decorations/")
	# Also load 42x42 PixelLab objects as extra nature variants
	var extra = _scan_dir("res://assets/objects/nature/")
	for key in extra:
		if not _nature_sprites.has("extra"):
			_nature_sprites["extra"] = []
		_nature_sprites["extra"].append_array(extra[key])
	# Fallback: if directory scanning found nothing, try loading known files directly
	if _nature_sprites.is_empty():
		print("MapObjectRenderer: directory scan found no nature sprites, trying direct load")
		var known_nature := {
			"oak_tree": "res://assets/map_objects/nature/oak_tree.png",
			"pine_tree": "res://assets/map_objects/nature/pine_tree.png",
			"bush": "res://assets/map_objects/nature/bush.png",
			"rock": "res://assets/map_objects/nature/rock.png",
		}
		for key in known_nature:
			if ResourceLoader.exists(known_nature[key]):
				_nature_sprites[key] = [load(known_nature[key])]
	if _building_sprites.is_empty():
		var known_buildings := {
			"house": "res://assets/map_objects/buildings/house.png",
			"forge": "res://assets/map_objects/buildings/forge.png",
			"tavern": "res://assets/map_objects/buildings/tavern.png",
		}
		for key in known_buildings:
			if ResourceLoader.exists(known_buildings[key]):
				_building_sprites[key] = [load(known_buildings[key])]
	print("MapObjectRenderer: %d building types, %d nature types, %d deco types" % [
		_building_sprites.size(), _nature_sprites.size(), _decoration_sprites.size()])

## Get nature sprites appropriate for the biome and object type
func _get_biome_nature_sprites(obj_type: String, biome: String, hash_val: int) -> Array:
	# Biome-specific sprite preferences
	var biome_preferred: Dictionary = {
		"desert": ["cactus", "rock", "pebbles"],
		"beach": ["palm_tree", "rock", "pebbles"],
		"tundra": ["snow_pine", "rock", "dead_tree", "pebbles"],
		"frozen_lake": ["snow_pine", "rock"],
		"swamp": ["dead_tree", "mushroom_cluster", "fallen_log", "fern"],
		"forest": ["oak_tree", "pine_tree", "ancient_tree", "birch_tree", "bush", "fern", "mushroom_cluster", "fallen_log"],
		"mushroom_forest": ["mushroom_cluster", "dead_tree", "fern", "magic_tree"],
		"volcanic": ["dead_tree", "rock"],
	}
	# Try biome-specific sprites first
	var preferred = biome_preferred.get(biome, [])
	for key in preferred:
		if _nature_sprites.has(key) and not _nature_sprites[key].is_empty():
			if obj_type in ["pine_tree", "oak_tree"] and key.contains("tree"):
				return _nature_sprites[key]
			elif obj_type == "rock" and key == "rock":
				return _nature_sprites[key]
			elif obj_type == "bush" and key in ["bush", "fern", "cactus"]:
				return _nature_sprites[key]
	# Fallback: match by object type name
	var sprite_key = obj_type
	if obj_type in ["dead_stump", "fern", "mushroom"]:
		sprite_key = "bush"
	var result = _nature_sprites.get(sprite_key, [])
	if result.is_empty():
		result = _nature_sprites.get("extra", [])
	if result.is_empty():
		result = _nature_sprites.get("misc", [])
	if result.is_empty():
		for k in _nature_sprites:
			if not _nature_sprites[k].is_empty():
				result = _nature_sprites[k]
				break
	return result

## Scan directory, load all PNGs, group by base name
func _scan_dir(dir_path: String) -> Dictionary:
	var result: Dictionary = {}
	if not DirAccess.dir_exists_absolute(dir_path):
		return result
	var dir = DirAccess.open(dir_path)
	if dir == null:
		return result
	dir.list_dir_begin()
	var file = dir.get_next()
	while file != "":
		if file.ends_with(".png") and not file.ends_with(".import"):
			var tex = load(dir_path + file)
			if tex is Texture2D:
				var base = file.get_basename()
				# UUID filenames → group as "misc"
				if "-" in base and base.length() > 30:
					base = "misc"
				else:
					# Strip _v2, _v3 suffixes to group variants
					while base.length() > 2 and (base[-1] >= "0" and base[-1] <= "9"):
						base = base.substr(0, base.length() - 1)
					base = base.rstrip("_v").rstrip("_")
				if not result.has(base):
					result[base] = []
				result[base].append(tex)
		file = dir.get_next()
	return result

func spawn_structures(structures_system, center_x: int, center_y: int,
		radius: int, parent: Node2D) -> void:
	var nearby = structures_system.get_structures_near(center_x, center_y, radius)
	for s in nearby:
		var sx = s.get("world_x", 0)
		var sy = s.get("world_y", 0)
		var key = Vector2i(sx, sy)
		if _spawned_structures.has(key):
			continue
		_spawned_structures[key] = true
		var stype = s.get("type", "house")
		# Find matching building sprite — try exact type, then "house" fallback
		var tex_list = _building_sprites.get(stype, [])
		if tex_list.is_empty():
			tex_list = _building_sprites.get("house", [])
		if tex_list.is_empty():
			# Try any available building
			for k in _building_sprites:
				if not _building_sprites[k].is_empty():
					tex_list = _building_sprites[k]
					break
		if tex_list.is_empty():
			continue
		var variant_hash = ((sx * 73856093) ^ (sy * 19349663)) & 0xFFFF
		var tex = tex_list[variant_hash % tex_list.size()]
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.position = Vector2(sx * WORLD_SCALE, sy * WORLD_SCALE)
		# Scale buildings to ~6-10 world tiles
		var target_tiles = 8.0
		match stype:
			"market_stall": target_tiles = 6.0
			"tavern": target_tiles = 12.0
			"watchtower": target_tiles = 7.0
			"well", "campfire", "altar": target_tiles = 4.0
			"farm_plot": target_tiles = 8.0
			"church": target_tiles = 10.0
			"windmill": target_tiles = 9.0
			"shed": target_tiles = 6.0
		var sf = (target_tiles * WORLD_SCALE) / maxf(tex.get_width(), 1)
		sprite.scale = Vector2(sf, sf)
		sprite.z_index = 3
		# Drop shadow
		var shadow = Sprite2D.new()
		shadow.texture = tex
		shadow.scale = Vector2(1.0, 0.5)
		shadow.modulate = Color(0, 0, 0, 0.15)
		shadow.position = Vector2(2, tex.get_height() * 0.25)
		shadow.z_index = -1
		sprite.add_child(shadow)
		parent.add_child(sprite)
		# Place matching decoration if type matches
		var deco_list = _decoration_sprites.get(stype, [])
		if not deco_list.is_empty():
			var deco = Sprite2D.new()
			deco.texture = deco_list[variant_hash % deco_list.size()]
			deco.position = Vector2((sx + 3) * WORLD_SCALE, (sy + 3) * WORLD_SCALE)
			var ds = (3.0 * WORLD_SCALE) / maxf(deco.texture.get_width(), 1)
			deco.scale = Vector2(ds, ds)
			deco.z_index = 4
			deco.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			parent.add_child(deco)

## Scatter decorative objects around structures for village richness
func scatter_decorations(center_x: int, center_y: int, radius: int, parent: Node2D) -> void:
	# Collect all available decorations
	var all_decos: Array = []
	for key in _decoration_sprites:
		all_decos.append_array(_decoration_sprites[key])
	if all_decos.is_empty():
		return
	# Also include some nature sprites as village decorations
	for key in _nature_sprites:
		if key in ["bush", "flower_garden", "mushroom_cluster", "extra", "misc"]:
			all_decos.append_array(_nature_sprites[key])
	if all_decos.is_empty():
		return
	# Scatter ~15-25 decorations around the village
	var rng = RandomNumberGenerator.new()
	rng.seed = center_x * 73856093 + center_y * 19349663
	var count = rng.randi_range(30, 50)
	for i in range(count):
		var dx = rng.randi_range(-radius, radius)
		var dy = rng.randi_range(-radius, radius)
		var wx = (center_x + dx) * WORLD_SCALE
		var wy = (center_y + dy) * WORLD_SCALE
		var tex = all_decos[rng.randi() % all_decos.size()]
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.position = Vector2(wx, wy)
		var target_tiles = rng.randf_range(1.5, 3.0)
		var sf = (target_tiles * WORLD_SCALE) / maxf(tex.get_width(), 1)
		sprite.scale = Vector2(sf, sf)
		sprite.z_index = 2
		# Color variation
		var hv = rng.randf_range(-0.03, 0.03)
		sprite.modulate = Color(1.0 + hv, 1.0 + hv * 0.5, 1.0 - hv, 1.0)
		parent.add_child(sprite)

## Scatter ground details (grass tufts, small flowers, pebbles) across terrain
## These are tiny sprites at z_index=1 that fill empty ground with texture
func scatter_ground_details(cell_x: int, cell_y: int, biome: String, parent: Node2D) -> void:
	# Only scatter small nature sprites as ground detail
	var detail_sprites: Array = []
	for key in ["grass_tuft", "flower_border", "flower_garden", "mushroom_cluster", "veggie_garden"]:
		if _nature_sprites.has(key):
			detail_sprites.append_array(_nature_sprites[key])
	# Also include extra/misc (42px PixelLab objects)
	if _nature_sprites.has("extra"):
		detail_sprites.append_array(_nature_sprites["extra"])
	if _nature_sprites.has("misc"):
		detail_sprites.append_array(_nature_sprites["misc"])
	if detail_sprites.is_empty():
		return
	# Density based on biome
	var density = 30
	match biome:
		"forest", "mushroom_forest": density = 60
		"grassland": density = 40
		"swamp": density = 35
		"hills": density = 25
		"desert", "beach": density = 8
		"tundra": density = 10
		"mountains": density = 15
	var rng = RandomNumberGenerator.new()
	rng.seed = cell_x * 2654435761 + cell_y * 2246822519
	var base_x = cell_x * 128
	var base_y = cell_y * 128
	for i in range(density):
		var lx = rng.randi_range(0, 127)
		var ly = rng.randi_range(0, 127)
		var wx = (base_x + lx) * WORLD_SCALE
		var wy = (base_y + ly) * WORLD_SCALE
		var tex = detail_sprites[rng.randi() % detail_sprites.size()]
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.position = Vector2(wx, wy)
		# Ground details are SMALL — 0.5 to 1.5 tiles
		var target_tiles = rng.randf_range(0.5, 1.5)
		var sf = (target_tiles * WORLD_SCALE) / maxf(tex.get_width(), 1)
		sprite.scale = Vector2(sf, sf)
		sprite.z_index = 1  # Between terrain (0) and objects (2-3)
		sprite.modulate.a = rng.randf_range(0.6, 1.0)  # Semi-transparent variety
		parent.add_child(sprite)

func spawn_nature(objects: Array, parent: Node2D, cell_key: Vector2i, biome: String = "") -> void:
	if _spawned_cells.has(cell_key):
		return
	_spawned_cells[cell_key] = true
	for obj in objects:
		var obj_type = obj["type"]
		var scale_val = obj["scale"]
		var wx = obj["world_x"] * WORLD_SCALE
		var wy = obj["world_y"] * WORLD_SCALE
		var obj_hash = ((obj["world_x"] * 2654435761) ^ (obj["world_y"] * 2246822519)) & 0xFFFF
		# Build biome-aware sprite pool
		var tex_list = _get_biome_nature_sprites(obj_type, biome, obj_hash)
		if tex_list.is_empty():
			continue
		var tex = tex_list[obj_hash % tex_list.size()]
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.position = Vector2(wx, wy)
		var target_tiles = 3.5 * scale_val
		if obj_type in ["pine_tree", "oak_tree"]:
			target_tiles = 6.0 * scale_val
		elif obj_type in ["rock", "dead_stump"]:
			target_tiles = 2.5 * scale_val
		elif obj_type in ["flower_patch", "fern", "mushroom"]:
			target_tiles = 1.5 * scale_val
		elif obj_type == "bush":
			target_tiles = 3.0 * scale_val
		var sf = (target_tiles * WORLD_SCALE) / maxf(tex.get_width(), 1)
		sprite.scale = Vector2(sf, sf)
		var hue_var = (obj_hash & 0xFF) / 255.0 * 0.06 - 0.03
		sprite.modulate = Color(1.0 + hue_var, 1.0 + hue_var * 0.5, 1.0 - hue_var, 1.0)
		sprite.z_index = 3
		# Drop shadow for depth
		if obj_type in ["pine_tree", "oak_tree", "bush", "rock", "dead_stump"]:
			var shadow = Sprite2D.new()
			shadow.texture = tex
			shadow.scale = Vector2(0.9, 0.4)
			shadow.modulate = Color(0, 0, 0, 0.18)
			shadow.position = Vector2(tex.get_width() * 0.05, tex.get_height() * 0.55)
			shadow.z_index = -1
			sprite.add_child(shadow)
		parent.add_child(sprite)
