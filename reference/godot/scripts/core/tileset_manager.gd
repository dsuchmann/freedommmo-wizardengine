class_name TilesetManager
extends RefCounted

var _tileset_images: Dictionary = {}
var _tile_cache: Dictionary = {}
var _grain_to_tileset: Dictionary = {}

func _init() -> void:
	_init_grain_mapping()

func load_tileset(name: String, path: String) -> bool:
	var img := Image.load_from_file(path)
	if img == null:
		push_warning("TilesetManager: failed to load %s" % path)
		return false
	_tileset_images[name] = img
	_extract_tiles(name, img)
	return true

func load_all_tilesets() -> int:
	var loaded := 0
	var tilesets := {
		"grassland": "res://assets/tilesets/grassland.png",
		"grassland_lush": "res://assets/tilesets/grassland_lush.png",
		"ocean_beach": "res://assets/tilesets/ocean_beach.png",
		"grass_stone": "res://assets/tilesets/grass_stone.png",
		"desert": "res://assets/tilesets/desert.png",
		"forest": "res://assets/tilesets/forest.png",
	}
	for name in tilesets:
		if load_tileset(name, tilesets[name]):
			loaded += 1
	return loaded

func get_tile_for_grain(grain_type: int, variant: int = 0) -> Image:
	var tileset_name: String = _grain_to_tileset.get(grain_type, "")
	if tileset_name.is_empty():
		return null
	var key := "%s_%d" % [tileset_name, variant]
	return _tile_cache.get(key)

func get_random_tile_for_grain(grain_type: int) -> Image:
	var tileset_name: String = _grain_to_tileset.get(grain_type, "")
	if tileset_name.is_empty():
		return null
	var tiles := _get_tiles_for_tileset(tileset_name)
	if tiles.is_empty():
		return null
	return tiles[randi() % tiles.size()]

func get_tileset_count() -> int:
	return _tileset_images.size()

func get_tile_count() -> int:
	return _tile_cache.size()

func _extract_tiles(name: String, img: Image) -> void:
	var tile_w := 32
	var tile_h := 32
	var cols := img.get_width() / tile_w
	var rows := img.get_height() / tile_h
	var idx := 0
	for row in range(rows):
		for col in range(cols):
			var tile := img.get_region(Rect2i(col * tile_w, row * tile_h, tile_w, tile_h))
			var key := "%s_%d" % [name, idx]
			_tile_cache[key] = tile
			idx += 1

func _get_tiles_for_tileset(name: String) -> Array:
	var result: Array = []
	for key in _tile_cache:
		if key.begins_with(name + "_"):
			result.append(_tile_cache[key])
	return result

func _init_grain_mapping() -> void:
	_grain_to_tileset[GrainTypes.Physical.GRASS] = "grassland_lush"
	_grain_to_tileset[GrainTypes.Physical.SOIL] = "grassland"
	_grain_to_tileset[GrainTypes.Physical.SAND] = "desert"
	_grain_to_tileset[GrainTypes.Physical.WATER] = "ocean_beach"
	_grain_to_tileset[GrainTypes.Physical.STONE] = "grass_stone"
	_grain_to_tileset[GrainTypes.Physical.MOSS] = "forest"
	_grain_to_tileset[GrainTypes.Physical.LEAF] = "forest"
	_grain_to_tileset[GrainTypes.Physical.WOOD] = "forest"
	_grain_to_tileset[GrainTypes.Physical.FLOWER] = "grassland_lush"
	_grain_to_tileset[GrainTypes.Physical.MUSHROOM] = "forest"
	_grain_to_tileset[GrainTypes.Physical.GRAVEL] = "grass_stone"
	_grain_to_tileset[GrainTypes.Physical.CLAY] = "desert"
	_grain_to_tileset[GrainTypes.Physical.ICE] = "ocean_beach"
	_grain_to_tileset[GrainTypes.Physical.SNOW] = "ocean_beach"
