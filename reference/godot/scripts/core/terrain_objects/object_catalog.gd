class_name ObjectCatalog
extends RefCounted

## Loads and indexes all object definitions from data/terrain_objects/objects/.

var _objects: Dictionary = {}  # id -> Dictionary
var _by_category: Dictionary = {}  # category_prefix -> [id, ...]

const DATA_PATH = "res://data/terrain_objects/objects"


func _init():
	_load_all()


func _load_all() -> void:
	_scan_dir(DATA_PATH)
	print("[ObjectCatalog] Loaded %d objects across %d categories" % [_objects.size(), _by_category.size()])


func _scan_dir(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		push_warning("[ObjectCatalog] Cannot open: %s" % path)
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
		push_warning("[ObjectCatalog] Cannot read: %s" % path)
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	var err = json.parse(text)
	if err != OK:
		push_warning("[ObjectCatalog] JSON parse error in %s: %s" % [path, json.get_error_message()])
		return
	var data = json.get_data()
	var obj_id = data.get("id", "")
	if obj_id == "":
		push_warning("[ObjectCatalog] No id in %s" % path)
		return
	_objects[obj_id] = data
	var cat = data.get("category", "")
	if cat != "":
		var parts = cat.split("/")
		var prefix = ""
		for p in parts:
			prefix = p if prefix == "" else prefix + "/" + p
			if not _by_category.has(prefix):
				_by_category[prefix] = []
			_by_category[prefix].append(obj_id)


func get_object(id: String) -> Dictionary:
	return _objects.get(id, {})


func get_by_category(prefix: String) -> Array:
	return _by_category.get(prefix, [])


func has_object(id: String) -> bool:
	return _objects.has(id)


func get_all_ids() -> Array:
	return _objects.keys()


func get_interactions_for(id: String, phase: String = "") -> Array:
	var obj = _objects.get(id, {})
	if obj.is_empty():
		return []
	if obj.get("ontology", "") == "animate" and phase != "":
		var lifecycle = obj.get("lifecycle", {})
		var pi = lifecycle.get("phase_interactions", {})
		return pi.get(phase, [])
	return obj.get("interactions", [])
