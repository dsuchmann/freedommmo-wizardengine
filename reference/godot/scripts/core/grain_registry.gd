class_name GrainRegistry
extends RefCounted

var _templates: Dictionary = {}  ## id -> template dict
var _terrain_stacks: Dictionary = {}  ## biome_name -> Array of grain IDs (top to bottom)

func _init() -> void:
	_init_terrain_stacks()

func load_templates(path: String) -> bool:
	if not FileAccess.file_exists(path):
		push_warning("GrainRegistry: template file not found at %s" % path)
		return false
	var json_text := FileAccess.get_file_as_string(path)
	var parsed = JSON.parse_string(json_text)
	if parsed == null or typeof(parsed) != TYPE_DICTIONARY:
		push_error("GrainRegistry: failed to parse %s" % path)
		return false
	if parsed.has("templates"):
		for t in parsed["templates"]:
			_templates[t["id"]] = t
	return true

func create_grain(template_id: String) -> Grain:
	if not _templates.has(template_id):
		push_warning("GrainRegistry: unknown template '%s'" % template_id)
		return null
	var t: Dictionary = _templates[template_id]
	var g := Grain.new(int(t.get("category", 0)), int(t.get("type", 0)))
	if t.has("properties"):
		g.properties = GrainProperties.from_dict(t["properties"])
	return g

func create_terrain_stack(biome: String) -> GrainStack:
	var stack := GrainStack.new()
	var grain_ids: Array = _terrain_stacks.get(biome, _terrain_stacks.get("grassland", []))
	# Build bottom-up so index 0 ends up as the surface
	for i in range(grain_ids.size() - 1, -1, -1):
		var grain := create_grain(grain_ids[i])
		if grain:
			stack.push(grain)
	return stack

func get_biome_names() -> Array:
	return _terrain_stacks.keys()

func get_template(template_id: String) -> Dictionary:
	return _templates.get(template_id, {})

func get_all_template_ids() -> Array:
	return _templates.keys()

func _init_terrain_stacks() -> void:
	_terrain_stacks["grassland"] = ["grass", "soil", "stone", "bedrock"]
	_terrain_stacks["desert"] = ["sand", "sand", "gravel", "stone", "bedrock"]
	_terrain_stacks["forest"] = ["moss", "soil", "soil", "stone", "bedrock"]
	_terrain_stacks["hills"] = ["grass", "gravel", "stone", "stone", "bedrock"]
	_terrain_stacks["mountains"] = ["stone", "stone", "stone", "bedrock"]
	_terrain_stacks["beach"] = ["sand", "sand", "clay", "stone", "bedrock"]
	_terrain_stacks["ocean"] = ["water", "sand", "clay", "stone", "bedrock"]
	_terrain_stacks["deep_ocean"] = ["water", "water", "sand", "stone", "bedrock"]
	_terrain_stacks["shallow_water"] = ["water", "sand", "stone", "bedrock"]
	_terrain_stacks["tundra"] = ["ice", "soil", "stone", "bedrock"]
	_terrain_stacks["swamp"] = ["water", "mud", "clay", "stone", "bedrock"]
	_terrain_stacks["volcanic"] = ["lava", "obsidian", "stone", "bedrock"]
	_terrain_stacks["path"] = ["gravel", "soil", "stone", "bedrock"]
	_terrain_stacks["frozen_lake"] = ["ice", "water", "stone", "bedrock"]
	_terrain_stacks["mushroom_forest"] = ["moss", "mud", "soil", "stone", "bedrock"]
