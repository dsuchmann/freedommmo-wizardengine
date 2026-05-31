class_name BiomeLayerLoader
extends RefCounted

## Loads biome layer stack definitions from data/terrain_objects/biome_layers/.
## Supports elevation_stacks: each biome can define different layer stacks
## for different elevation bands. Falls back to flat "layers" if no stacks.

var _layers: Dictionary = {}            # biome_id -> Array[Dictionary] (flat fallback)
var _elevation_stacks: Dictionary = {}  # biome_id -> Array[{range, layers}]
var _elev_cache: Dictionary = {}        # "biome_id:band_idx" -> Array[Dictionary]

const DATA_PATH = "res://data/terrain_objects/biome_layers"


func _init():
	_load_all()


func _load_all() -> void:
	var dir = DirAccess.open(DATA_PATH)
	if dir == null:
		push_warning("[BiomeLayerLoader] Cannot open: %s" % DATA_PATH)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json"):
			_load_file(DATA_PATH + "/" + file_name)
		file_name = dir.get_next()
	dir.list_dir_end()
	var total = _layers.size() + _elevation_stacks.size()
	var elev_count = _elevation_stacks.size()
	print("[BiomeLayerLoader] Loaded %d biomes (%d with elevation stacks)" % [total, elev_count])


func _load_file(path: String) -> void:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return
	var data = json.get_data()
	var biome_id = data.get("biome_id", "")
	if biome_id == "":
		return

	var elev_stacks = data.get("elevation_stacks")
	if elev_stacks != null and elev_stacks is Array and elev_stacks.size() > 0:
		_elevation_stacks[biome_id] = elev_stacks
	else:
		_layers[biome_id] = data.get("layers", [])


func get_layers(biome_id: String) -> Array:
	## Backward-compatible: returns flat layers (ignores elevation).
	if _layers.has(biome_id):
		return _layers[biome_id]
	# If biome only has elevation_stacks, return the mid band as default
	if _elevation_stacks.has(biome_id):
		var stacks = _elevation_stacks[biome_id]
		var mid = stacks.size() / 2
		return stacks[mid].get("layers", [])
	return []


func get_layers_for_elevation(biome_id: String, elevation: float) -> Array:
	## Returns the layer stack appropriate for this biome at the given elevation.
	## Each biome defines its own elevation breakpoints.
	if _elevation_stacks.has(biome_id):
		var stacks = _elevation_stacks[biome_id]
		for i in range(stacks.size()):
			var stack = stacks[i]
			var range_arr = stack.get("range", [0.0, 1.0])
			if range_arr.size() < 2:
				continue
			var lo = float(range_arr[0])
			var hi = float(range_arr[1])
			if elevation >= lo and elevation < hi:
				return stack.get("layers", [])
		# Elevation outside all defined ranges — use highest band as fallback
		if stacks.size() > 0:
			return stacks[stacks.size() - 1].get("layers", [])
		return []

	# No elevation stacks — use flat layers for all elevations
	return _layers.get(biome_id, [])


func has_biome(biome_id: String) -> bool:
	return _layers.has(biome_id) or _elevation_stacks.has(biome_id)
