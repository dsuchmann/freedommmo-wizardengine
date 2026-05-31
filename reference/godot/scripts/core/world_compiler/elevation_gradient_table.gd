class_name ElevationGradientTable

## Static data: biome elevation gradients and surface metadata.
## Loaded once from gradients.json. Given (biome, elevation) -> surface_id.

const GRADIENTS_PATH = "res://assets/catalog/terrain_v3/gradients.json"
const SURFACES_DIR = "res://assets/catalog/terrain_v3/surfaces"
const TRANSITIONS_DIR = "res://assets/catalog/terrain_v3/transitions"

# biome_name -> Array of [max_elevation: float, surface_id: String]
static var _gradients: Dictionary = {}
# Set of surface_id strings that have a directory in surfaces/
static var _available_surfaces: Dictionary = {}
# Set of "lower__upper" keys that have a directory in transitions/
static var _available_transitions: Dictionary = {}
static var _loaded: bool = false

# Biome ID -> biome name (matches BiomeLayer enum order + MYSTIC)
const BIOME_NAMES: Array[String] = [
	"ocean", "beach", "grassland", "forest", "dense_forest", "desert",
	"savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
	"tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
]


static func load() -> void:
	if _loaded:
		return
	_gradients.clear()
	_available_surfaces.clear()
	_available_transitions.clear()

	# Load gradient definitions
	if not FileAccess.file_exists(GRADIENTS_PATH):
		push_error("[ElevationGradientTable] Missing %s" % GRADIENTS_PATH)
		return

	var f = FileAccess.open(GRADIENTS_PATH, FileAccess.READ)
	var data = JSON.parse_string(f.get_as_text())
	f.close()
	if data == null or not data.has("gradients"):
		push_error("[ElevationGradientTable] Failed to parse gradients.json")
		return

	var grads = data["gradients"]
	for biome_name in grads:
		var entries = grads[biome_name]
		var parsed: Array = []
		for entry in entries:
			parsed.append([float(entry[0]), String(entry[1])])
		_gradients[biome_name] = parsed

	# Scan surfaces/ directory for available tilesets
	var surfaces_da = DirAccess.open(SURFACES_DIR)
	if surfaces_da != null:
		surfaces_da.list_dir_begin()
		var dir_name = surfaces_da.get_next()
		while dir_name != "":
			if surfaces_da.current_is_dir():
				_available_surfaces[dir_name] = true
			dir_name = surfaces_da.get_next()

	# Scan transitions/ directory
	var trans_da = DirAccess.open(TRANSITIONS_DIR)
	if trans_da != null:
		trans_da.list_dir_begin()
		var dir_name = trans_da.get_next()
		while dir_name != "":
			if trans_da.current_is_dir():
				_available_transitions[dir_name] = true
			dir_name = trans_da.get_next()

	_loaded = true
	print("[ElevationGradientTable] Loaded %d biome gradients, %d surfaces, %d transitions" % [
		_gradients.size(), _available_surfaces.size(), _available_transitions.size()
	])


static func biome_name_from_id(biome_id: int) -> String:
	if biome_id < 0 or biome_id >= BIOME_NAMES.size():
		return "grassland"
	return BIOME_NAMES[biome_id]


static func surface_at(biome_name: String, elevation: float) -> String:
	## Return the surface_id for a given biome and elevation.
	var grad = _gradients.get(biome_name, null)
	if grad == null:
		return "lush_grass"
	for entry in grad:
		if elevation <= entry[0]:
			return entry[1]
	# Above all thresholds — return last surface
	return grad[grad.size() - 1][1]


static func has_surface(surface_id: String) -> bool:
	return _available_surfaces.has(surface_id)


static func has_transition(lower: String, upper: String) -> bool:
	return _available_transitions.has(lower + "__" + upper)


static func transition_key(lower: String, upper: String) -> String:
	return lower + "__" + upper


static func gradient_rank(biome_name: String, surface_id: String) -> int:
	## Return the index of surface_id in the biome's gradient.
	## Lower rank = appears at lower elevation. Returns 999 if not found.
	var grad = _gradients.get(biome_name, null)
	if grad == null:
		return 999
	for i in range(grad.size()):
		if grad[i][1] == surface_id:
			return i
	return 999
