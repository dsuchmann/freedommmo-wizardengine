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
