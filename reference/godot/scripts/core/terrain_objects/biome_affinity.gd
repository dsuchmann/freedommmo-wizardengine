class_name BiomeAffinityLoader
extends RefCounted

## Loads biome affinity and transition data.

var _affinities: Dictionary = {}  # biome_id -> Dictionary
var _transitions: Dictionary = {}  # "biomeA_biomeB" -> Dictionary

const AFF_PATH = "res://data/terrain_objects/affinities"
const TRANS_PATH = "res://data/terrain_objects/transitions"


func _init():
	_load_affinities()
	_load_transitions()


func _load_affinities() -> void:
	var dir = DirAccess.open(AFF_PATH)
	if dir == null:
		push_warning("[BiomeAffinity] Cannot open: %s" % AFF_PATH)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json"):
			var path = AFF_PATH + "/" + file_name
			var data = _load_json(path)
			if not data.is_empty():
				var biome_id = data.get("biome_id", "")
				if biome_id != "":
					_affinities[biome_id] = data
		file_name = dir.get_next()
	dir.list_dir_end()
	print("[BiomeAffinity] Loaded %d biome affinities" % _affinities.size())


func _load_transitions() -> void:
	var dir = DirAccess.open(TRANS_PATH)
	if dir == null:
		push_warning("[BiomeAffinity] Cannot open: %s" % TRANS_PATH)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		if file_name.ends_with(".json"):
			var path = TRANS_PATH + "/" + file_name
			var data = _load_json(path)
			if not data.is_empty():
				var key = "%s_%s" % [data.get("biome_a", ""), data.get("biome_b", "")]
				_transitions[key] = data
		file_name = dir.get_next()
	dir.list_dir_end()
	print("[BiomeAffinity] Loaded %d biome transitions" % _transitions.size())


func _load_json(path: String) -> Dictionary:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return {}
	return json.get_data()


func get_affinity(biome_id: String) -> Dictionary:
	return _affinities.get(biome_id, {})


func get_object_pools(biome_id: String) -> Array:
	var aff = _affinities.get(biome_id, {})
	return aff.get("object_pools", [])


func get_transition(biome_a: String, biome_b: String) -> Dictionary:
	var key1 = "%s_%s" % [biome_a, biome_b]
	var key2 = "%s_%s" % [biome_b, biome_a]
	if _transitions.has(key1):
		return _transitions[key1]
	if _transitions.has(key2):
		return _transitions[key2]
	return {}


func get_ambient(biome_id: String) -> Dictionary:
	var aff = _affinities.get(biome_id, {})
	return aff.get("ambient", {})
