class_name TilePainter
extends RefCounted

var ground_tilemap: TileMap
var cliff_tilemap: TileMap
var water_tilemap: TileMap
var deco_tilemap: TileMap
var tileset: TileSet
var _tile_source_id: int = 0

var biome_tile_mapping: Dictionary = {}

func _init():
	print("[HB] TilePainter ready")

func load_tileset_metadata(metadata_path: String) -> void:
	# Load tileset metadata for tile ID mapping
	if not FileAccess.file_exists(metadata_path):
		push_error("Tileset metadata not found: " + metadata_path)
		return
	
	var file := FileAccess.open(metadata_path, FileAccess.READ)
	var json_text := file.get_as_text()
	file.close()
	
	var json := JSON.new()
	var parse_result := json.parse(json_text)
	if parse_result != OK:
		push_error("Failed to parse tileset metadata")
		return
	
	var metadata: Dictionary = json.data

	# If no atlases found OR TileMaps have no tileset, fall back to a debug tileset so we can see painting
	var need_debug := (not FileAccess.file_exists("res://assets/tilesets/WorldTileSet.tres"))
	need_debug = need_debug or (ground_tilemap != null and ground_tilemap.tile_set == null)
	need_debug = need_debug or (cliff_tilemap != null and cliff_tilemap.tile_set == null)
	need_debug = need_debug or (water_tilemap != null and water_tilemap.tile_set == null)
	need_debug = need_debug or (deco_tilemap != null and deco_tilemap.tile_set == null)
	if need_debug and FileAccess.file_exists("res://assets/tilesets/DebugTileSet.tres"):
		print("[HB] Using debug tileset")
		var set := load("res://assets/tilesets/DebugTileSet.tres") as TileSet
		if ground_tilemap:
			ground_tilemap.tile_set = set
		if cliff_tilemap:
			cliff_tilemap.tile_set = set
		if water_tilemap:
			water_tilemap.tile_set = set
		if deco_tilemap:
			deco_tilemap.tile_set = set

		# Build a simple biome→tile index mapping for the debug atlas (tiles in a single row)
		var debug_map := {
			"ocean": 0,
			"beach": 1,
			"grass": 2,
			"desert": 3,
			"forest": 4,
			"rock": 5,
			"tundra": 6
		}
		for name in debug_map.keys():
			biome_tile_mapping[name] = {
				"ground_tiles": [int(debug_map[name])],
				"cliff_tiles": [5],
				"water_tiles": [0]
			}

	# Cache the first source id from the assigned tileset (required by set_cell)
	var any_tm := ground_tilemap if ground_tilemap != null else (cliff_tilemap if cliff_tilemap != null else (water_tilemap if water_tilemap != null else deco_tilemap))
	if any_tm != null and any_tm.tile_set != null and any_tm.tile_set.get_source_count() > 0:
		_tile_source_id = any_tm.tile_set.get_source_id(0)
	else:
		_tile_source_id = 0
	
	# Build biome to tile ID mapping
	var biome_keys: Array = metadata["biomes"].keys()
	for i in range(biome_keys.size()):
		var biome_name: String = String(biome_keys[i])
		var biome_data: Dictionary = metadata["biomes"][biome_name]
		biome_tile_mapping[biome_name] = {
			"ground_tiles": [],
			"cliff_tiles": [],
			"water_tiles": []
		}
		
		for tile in biome_data["tiles"]:
			var source_file: String = tile["source_file"]
			var tile_id: int = tile["global_id"]
			
			if "ground" in source_file:
				biome_tile_mapping[biome_name]["ground_tiles"].append(tile_id)
			elif "cliff" in source_file:
				biome_tile_mapping[biome_name]["cliff_tiles"].append(tile_id)
			elif "water" in source_file:
				biome_tile_mapping[biome_name]["water_tiles"].append(tile_id)

func paint_chunk_from_masks(chunk_x: int, chunk_y: int, masks_dir: String) -> void:
	# Paint TileMaps using precomputed masks
	var mask_dir := masks_dir + "/chunk_%d_%d" % [chunk_x, chunk_y]ss
	
	if not DirAccess.dir_exists_absolute(mask_dir):
		push_error("Mask directory not found: " + mask_dir)
		return
	
	# Load metadata
	var meta_path := mask_dir + "/metadata.json"
	var file := FileAccess.open(meta_path, FileAccess.READ)
	if file == null:
		push_error("Failed to load chunk metadata: " + meta_path)
		return
	
	var json := JSON.new()
	var parse_result := json.parse(file.get_as_text())
	file.close()
	
	if parse_result != OK:
		push_error("Failed to parse chunk metadata")
		return
	
	var metadata: Dictionary = json.data
	var chunk_size: int = metadata["chunk_size"]
	
	# Load masks from PNGs baked by tools/bake_masks.py (biome/slope/river/blue_noise)
	var biome_mask := _load_mask_png(mask_dir + "/biome.png", chunk_size)
	var slope_mask := _load_mask_png(mask_dir + "/slope.png", chunk_size)
	var river_mask := _load_mask_png(mask_dir + "/river.png", chunk_size)
	var blue_noise := _load_mask_png(mask_dir + "/blue_noise.png", chunk_size)
	
	# Paint layers in order: water -> ground -> cliffs -> rivers -> deco
	var c_water := _paint_water_layer(biome_mask, chunk_size)
	var c_ground := _paint_ground_layer(biome_mask, slope_mask, chunk_size)
	var c_cliff := _paint_cliff_layer(slope_mask, chunk_size)
	var c_river := _paint_river_layer(river_mask, chunk_size)
	var c_deco := _paint_deco_layer(blue_noise, biome_mask, chunk_size)
	
	if ground_tilemap: ground_tilemap.visible = true
	if cliff_tilemap: cliff_tilemap.visible = true
	if water_tilemap: water_tilemap.visible = true
	if deco_tilemap: deco_tilemap.visible = true
	
	print("[HB] Painted chunk (%d,%d) tiles: ground=", c_ground, " cliff=", c_cliff, " water=", c_water, " river=", c_river, " deco=", c_deco)

func _load_mask_png(path: String, size: int) -> PackedByteArray:
	var mask := PackedByteArray()
	mask.resize(size * size)
	if not FileAccess.file_exists(path):
		return mask
	var img := Image.load_from_file(path)
	if img == null:
		return mask
	img.convert(Image.FORMAT_L8)
	img.flip_y()
	for y in range(size):
		for x in range(size):
			var v := img.get_pixel(x, y).r
			mask[y * size + x] = int(round(v * 255.0)) if path.ends_with("biome.png") else int(v > 0.5)
	return mask

func _paint_water_layer(biome_mask: PackedByteArray, chunk_size: int) -> int:
	# Paint water tiles
	if water_tilemap == null:
		return 0
	
	var water_tile_id := _get_tile_id_for_biome("ocean", "water")
	var count := 0
	
	for y in range(chunk_size):
		for x in range(chunk_size):
			var idx := y * chunk_size + x
			if idx < biome_mask.size() and biome_mask[idx] == 0:  # ocean biome
				water_tilemap.set_cell(0, Vector2i(x, y), _tile_source_id, Vector2i(water_tile_id, 0))
				count += 1
	return count

func _paint_ground_layer(biome_mask: PackedByteArray, slope_mask: PackedByteArray, chunk_size: int) -> int:
	# Paint ground tiles with biome variation
	if ground_tilemap == null:
		return 0
	
	var biome_names := ["ocean", "beach", "grass", "desert", "forest", "rock", "tundra"]
	var count := 0
	
	for y in range(chunk_size):
		for x in range(chunk_size):
			var idx := y * chunk_size + x
			if idx >= biome_mask.size() or idx >= slope_mask.size():
				continue
			
			# Skip if this is a cliff
			if slope_mask[idx] == 1:
				continue
			
			var biome_id: int = biome_mask[idx]
			if biome_id > 0 and biome_id < biome_names.size():  # Skip ocean
				var biome_name: String = String(biome_names[biome_id])
				var tile_id := _get_tile_id_for_biome(biome_name, "ground")
				ground_tilemap.set_cell(0, Vector2i(x, y), _tile_source_id, Vector2i(tile_id, 0))
				count += 1
	return count

func _paint_cliff_layer(slope_mask: PackedByteArray, chunk_size: int) -> int:
	# Paint cliff tiles where slope is high
	if cliff_tilemap == null:
		return 0
	
	var cliff_tile_id := _get_tile_id_for_biome("rock", "cliff")
	var count := 0
	
	for y in range(chunk_size):
		for x in range(chunk_size):
			var idx := y * chunk_size + x
			if idx < slope_mask.size() and slope_mask[idx] == 1:
				cliff_tilemap.set_cell(0, Vector2i(x, y), _tile_source_id, Vector2i(cliff_tile_id, 0))
				count += 1
	return count

func _paint_river_layer(river_mask: PackedByteArray, chunk_size: int) -> int:
	# Paint river overlay tiles
	if water_tilemap == null:
		return 0
	
	var river_tile_id := _get_tile_id_for_biome("grass", "water")  # River water
	var count := 0
	
	for y in range(chunk_size):
		for x in range(chunk_size):
			var idx := y * chunk_size + x
			if idx < river_mask.size() and river_mask[idx] == 1:
				water_tilemap.set_cell(1, Vector2i(x, y), _tile_source_id, Vector2i(river_tile_id, 0))  # Layer 1 for rivers
				count += 1
	return count

func _paint_deco_layer(blue_noise: PackedByteArray, biome_mask: PackedByteArray, chunk_size: int) -> int:
	# Paint decoration variants using blue noise
	if deco_tilemap == null:
		return 0
	
	var biome_names := ["ocean", "beach", "grass", "desert", "forest", "rock", "tundra"]
	var count := 0
	
	for y in range(chunk_size):
		for x in range(chunk_size):
			var idx := y * chunk_size + x
			if idx >= blue_noise.size() or idx >= biome_mask.size():
				continue
			
			# Only place deco on blue noise points
			if blue_noise[idx] == 1:
				var biome_id: int = biome_mask[idx]
				if biome_id > 1 and biome_id < biome_names.size():  # Skip ocean/beach
					var biome_name: String = String(biome_names[biome_id])
					var tile_id := _get_tile_id_for_biome(biome_name, "ground", 1)  # Variant 1
					deco_tilemap.set_cell(0, Vector2i(x, y), _tile_source_id, Vector2i(tile_id, 0))
					count += 1
	return count

func _get_tile_id_for_biome(biome_name: String, tile_type: String, variant: int = 0) -> int:
	# Get tile ID for biome and type
	if not biome_tile_mapping.has(biome_name):
		return 0
	
	var tile_key := tile_type + "_tiles"
	if not biome_tile_mapping[biome_name].has(tile_key):
		return 0
	
	var tiles: Array = biome_tile_mapping[biome_name][tile_key]
	if tiles.is_empty():
		return 0
	
	return tiles[variant % tiles.size()]

# Mock mask loaders (replace with actual .npy loading)
func _load_mock_biome_mask(size: int) -> PackedByteArray:
	var mask := PackedByteArray()
	mask.resize(size * size)
	for i in range(size * size):
		# Simple pattern: ocean at edges, grass in middle, some forest
		var x := i % size
		var y := i / size
		if x < 5 or x >= size - 5 or y < 5 or y >= size - 5:
			mask[i] = 0  # ocean
		elif (x + y) % 7 == 0:
			mask[i] = 4  # forest
		else:
			mask[i] = 2  # grass
	return mask

func _load_mock_slope_mask(size: int) -> PackedByteArray:
	var mask := PackedByteArray()
	mask.resize(size * size)
	for i in range(size * size):
		# Random cliffs
		mask[i] = 1 if (i % 13 == 0) else 0
	return mask

func _load_mock_river_mask(size: int) -> PackedByteArray:
	var mask := PackedByteArray()
	mask.resize(size * size)
	for i in range(size * size):
		# Diagonal river
		var x := i % size
		var y := i / size
		mask[i] = 1 if abs(x - y) <= 1 and x > 10 and x < size - 10 else 0
	return mask

func _load_mock_blue_noise(size: int) -> PackedByteArray:
	var mask := PackedByteArray()
	mask.resize(size * size)
	for i in range(size * size):
		# Sparse decoration points
		mask[i] = 1 if (i % 17 == 0) else 0
	return mask
