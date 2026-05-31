class_name StructureSystem
extends RefCounted

signal structure_placed(structure_id: int, structure_type: String, x: int, y: int)
signal structure_destroyed(structure_id: int)

var _structures: Dictionary = {}
var _next_id: int = 9000
var _structure_templates: Dictionary = {}

func _init() -> void:
	_init_templates()

func place_structure(structure_type: String, world_x: int, world_y: int, owner_id: int = -1) -> int:
	if not _structure_templates.has(structure_type):
		return -1
	_next_id += 1
	var template: Dictionary = _structure_templates[structure_type]
	_structures[_next_id] = {
		"id": _next_id,
		"type": structure_type,
		"world_x": world_x,
		"world_y": world_y,
		"owner_id": owner_id,
		"health": template.get("max_health", 100.0),
		"max_health": template.get("max_health", 100.0),
		"footprint": template.get("footprint", [[0, 0]]),
		"provides": template.get("provides", []),
		"storage": [],
		"built_at": Time.get_unix_time_from_system(),
	}
	structure_placed.emit(_next_id, structure_type, world_x, world_y)
	return _next_id

func get_structure(structure_id: int) -> Dictionary:
	return _structures.get(structure_id, {})

func get_structures_near(world_x: int, world_y: int, radius: int = 20) -> Array:
	var result: Array = []
	for id in _structures:
		var s: Dictionary = _structures[id]
		var dx: int = abs(s["world_x"] - world_x)
		var dy: int = abs(s["world_y"] - world_y)
		if dx <= radius and dy <= radius:
			result.append(s)
	return result

func damage_structure(structure_id: int, damage: float) -> bool:
	if not _structures.has(structure_id):
		return false
	_structures[structure_id]["health"] -= damage
	if _structures[structure_id]["health"] <= 0:
		structure_destroyed.emit(structure_id)
		_structures.erase(structure_id)
		return true
	return false

func structure_count() -> int:
	return _structures.size()

func _init_templates() -> void:
	_structure_templates["campfire"] = {
		"name": "Campfire", "max_health": 30.0,
		"footprint": [[0, 0]],
		"provides": ["light", "warmth", "cooking"],
		"build_cost": [{"item": "wood", "count": 3}],
	}
	_structure_templates["tent"] = {
		"name": "Tent", "max_health": 50.0,
		"footprint": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"provides": ["shelter", "rest"],
		"build_cost": [{"item": "wood", "count": 4}, {"item": "cloth", "count": 2}],
	}
	_structure_templates["house"] = {
		"name": "House", "max_health": 200.0,
		"footprint": [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
		"provides": ["shelter", "rest", "storage", "crafting"],
		"build_cost": [{"item": "wood", "count": 20}, {"item": "stone", "count": 10}],
	}
	_structure_templates["forge"] = {
		"name": "Forge", "max_health": 150.0,
		"footprint": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"provides": ["smelting", "smithing", "light", "warmth"],
		"build_cost": [{"item": "stone", "count": 15}, {"item": "iron", "count": 5}],
	}
	_structure_templates["market_stall"] = {
		"name": "Market Stall", "max_health": 40.0,
		"footprint": [[0, 0], [1, 0]],
		"provides": ["trading"],
		"build_cost": [{"item": "wood", "count": 6}],
	}
	_structure_templates["watchtower"] = {
		"name": "Watchtower", "max_health": 120.0,
		"footprint": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"provides": ["vision", "defense"],
		"build_cost": [{"item": "stone", "count": 20}, {"item": "wood", "count": 10}],
	}
	_structure_templates["well"] = {
		"name": "Well", "max_health": 80.0,
		"footprint": [[0, 0]],
		"provides": ["water"],
		"build_cost": [{"item": "stone", "count": 8}],
	}
	_structure_templates["farm_plot"] = {
		"name": "Farm Plot", "max_health": 20.0,
		"footprint": [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
		"provides": ["farming", "food"],
		"build_cost": [{"item": "wood", "count": 4}],
	}
	_structure_templates["altar"] = {
		"name": "Altar", "max_health": 100.0,
		"footprint": [[0, 0], [1, 0]],
		"provides": ["worship", "divine_power"],
		"build_cost": [{"item": "stone", "count": 12}, {"item": "crystal", "count": 3}],
	}
