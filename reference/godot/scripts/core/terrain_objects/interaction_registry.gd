class_name InteractionRegistry
extends RefCounted

## Loads and indexes all interaction definitions from data/terrain_objects/interactions/.

var _interactions: Dictionary = {}  # id -> Dictionary
var _by_category: Dictionary = {}  # category -> [id, ...]

const DATA_PATH = "res://data/terrain_objects/interactions"


func _init():
	_load_all()


func _load_all() -> void:
	_scan_dir(DATA_PATH)
	print("[InteractionRegistry] Loaded %d interactions across %d categories" % [
		_interactions.size(), _by_category.size()])


func _scan_dir(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		push_warning("[InteractionRegistry] Cannot open: %s" % path)
		return
	dir.list_dir_begin()
	var file_name = dir.get_next()
	while file_name != "":
		var full_path = path + "/" + file_name
		if dir.current_is_dir() and not file_name.begins_with("."):
			_scan_dir(full_path)
		elif file_name.ends_with(".json"):
			_load_file(full_path)
		file_name = dir.get_next()
	dir.list_dir_end()


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
	var int_id = data.get("id", "")
	if int_id == "":
		return
	_interactions[int_id] = data
	var cat = data.get("category", "")
	if not _by_category.has(cat):
		_by_category[cat] = []
	_by_category[cat].append(int_id)


func get_interaction(id: String) -> Dictionary:
	return _interactions.get(id, {})


func get_by_category(category: String) -> Array:
	return _by_category.get(category, [])


func get_animation_spec(id: String) -> Dictionary:
	var interaction = _interactions.get(id, {})
	return interaction.get("animation", {})


func get_effects(id: String) -> Dictionary:
	var interaction = _interactions.get(id, {})
	return interaction.get("effects", {})
