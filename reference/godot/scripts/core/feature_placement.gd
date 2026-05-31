class_name FeaturePlacement
extends RefCounted

var registry: GrainRegistry
var _feature_templates: Dictionary = {}
var _placed_features: Array = []

func _init(p_registry: GrainRegistry = null) -> void:
	registry = p_registry if p_registry else GrainRegistry.new()
	_init_templates()

func place_features(cell: WorldCell, density: float = 1.0) -> int:
	var placed := 0
	var rng := RandomNumberGenerator.new()
	rng.seed = cell.cell_x * 73856093 ^ cell.cell_y * 19349663

	for template_name in _feature_templates:
		var template: Dictionary = _feature_templates[template_name]
		if cell.biome not in template.get("biomes", []):
			continue
		var count := int(template.get("density", 0.01) * WorldCell.CELL_SIZE * WorldCell.CELL_SIZE * density)
		for i in range(count):
			var x := rng.randi_range(2, WorldCell.CELL_SIZE - 3)
			var y := rng.randi_range(2, WorldCell.CELL_SIZE - 3)
			if _can_place(cell, x, y, template):
				_place_feature(cell, x, y, template)
				placed += 1
	return placed

func _can_place(cell: WorldCell, x: int, y: int, template: Dictionary) -> bool:
	var stack = cell.get_grain_stack(x, y)
	if stack == null:
		return false
	var required_surface: Array = template.get("required_surface", [])
	if not required_surface.is_empty():
		if stack.top() == null:
			return false
		if stack.top().grain_type not in required_surface:
			return false
	var footprint: Array = template.get("footprint", [[0, 0]])
	for offset in footprint:
		var fx: int = x + offset[0]
		var fy: int = y + offset[1]
		if fx < 0 or fx >= WorldCell.CELL_SIZE or fy < 0 or fy >= WorldCell.CELL_SIZE:
			return false
	return true

func _place_feature(cell: WorldCell, x: int, y: int, template: Dictionary) -> void:
	var grain_layers: Array = template.get("grain_layers", [])
	var footprint: Array = template.get("footprint", [[0, 0]])

	for offset in footprint:
		var fx: int = x + offset[0]
		var fy: int = y + offset[1]
		var stack = cell.get_grain_stack(fx, fy)
		if stack == null:
			continue
		for grain_id in grain_layers:
			var grain = registry.create_grain(grain_id)
			if grain:
				stack.push(grain)

	_placed_features.append({
		"template": template.get("name", ""),
		"cell_x": cell.cell_x, "cell_y": cell.cell_y,
		"x": x, "y": y,
	})

func get_placed_count() -> int:
	return _placed_features.size()

func _init_templates() -> void:
	_feature_templates["tree"] = {
		"name": "tree", "biomes": ["forest", "grassland", "hills"],
		"density": 0.005,
		"footprint": [[0, 0], [0, -1], [1, 0], [-1, 0]],
		"grain_layers": ["wood", "bark", "leaf"],
		"required_surface": [GrainTypes.Physical.GRASS, GrainTypes.Physical.SOIL, GrainTypes.Physical.MOSS],
	}
	_feature_templates["rock_formation"] = {
		"name": "rock_formation", "biomes": ["hills", "mountains", "desert", "grassland"],
		"density": 0.003,
		"footprint": [[0, 0], [1, 0], [0, 1]],
		"grain_layers": ["stone", "granite"],
		"required_surface": [GrainTypes.Physical.GRASS, GrainTypes.Physical.STONE, GrainTypes.Physical.SAND, GrainTypes.Physical.GRAVEL],
	}
	_feature_templates["pond"] = {
		"name": "pond", "biomes": ["grassland", "forest"],
		"density": 0.0005,
		"footprint": [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],
		"grain_layers": ["water"],
		"required_surface": [GrainTypes.Physical.GRASS, GrainTypes.Physical.SOIL],
	}
	_feature_templates["cave_entrance"] = {
		"name": "cave_entrance", "biomes": ["hills", "mountains"],
		"density": 0.0002,
		"footprint": [[0, 0], [1, 0]],
		"grain_layers": ["stone"],
		"required_surface": [GrainTypes.Physical.STONE, GrainTypes.Physical.GRAVEL],
	}
	_feature_templates["cactus"] = {
		"name": "cactus", "biomes": ["desert"],
		"density": 0.002,
		"footprint": [[0, 0]],
		"grain_layers": ["wood"],
		"required_surface": [GrainTypes.Physical.SAND],
	}
	_feature_templates["coral_reef"] = {
		"name": "coral_reef", "biomes": ["shallow_water", "ocean"],
		"density": 0.001,
		"footprint": [[0, 0], [1, 0], [0, 1]],
		"grain_layers": ["coral"],
		"required_surface": [GrainTypes.Physical.WATER, GrainTypes.Physical.SAND],
	}
	_feature_templates["mushroom_cluster"] = {
		"name": "mushroom_cluster", "biomes": ["forest", "swamp"],
		"density": 0.003,
		"footprint": [[0, 0], [1, 0]],
		"grain_layers": ["mushroom"],
		"required_surface": [GrainTypes.Physical.MOSS, GrainTypes.Physical.SOIL, GrainTypes.Physical.MUD],
	}
	_feature_templates["ice_formation"] = {
		"name": "ice_formation", "biomes": ["tundra", "frozen_lake"],
		"density": 0.002,
		"footprint": [[0, 0], [1, 0], [0, 1]],
		"grain_layers": ["ice", "crystal"],
		"required_surface": [GrainTypes.Physical.ICE, GrainTypes.Physical.SNOW],
	}
	_feature_templates["dungeon_entrance"] = {
		"name": "dungeon_entrance", "biomes": ["mountains", "hills", "volcanic"],
		"density": 0.00005,
		"footprint": [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]],
		"grain_layers": ["stone", "obsidian"],
		"required_surface": [GrainTypes.Physical.STONE, GrainTypes.Physical.GRAVEL],
		"is_dungeon": true,
	}
	_feature_templates["lava_pool"] = {
		"name": "lava_pool", "biomes": ["volcanic"],
		"density": 0.002,
		"footprint": [[0, 0], [1, 0], [0, 1], [1, 1]],
		"grain_layers": ["lava"],
		"required_surface": [GrainTypes.Physical.STONE, GrainTypes.Physical.OBSIDIAN],
	}
	_feature_templates["crystal_cluster"] = {
		"name": "crystal_cluster", "biomes": ["mountains", "volcanic"],
		"density": 0.001,
		"footprint": [[0, 0], [1, 0]],
		"grain_layers": ["crystal"],
		"required_surface": [GrainTypes.Physical.STONE, GrainTypes.Physical.OBSIDIAN],
	}
	_feature_templates["giant_mushroom"] = {
		"name": "giant_mushroom", "biomes": ["mushroom_forest", "swamp"],
		"density": 0.004,
		"footprint": [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]],
		"grain_layers": ["mushroom", "vine"],
		"required_surface": [GrainTypes.Physical.MOSS, GrainTypes.Physical.SOIL, GrainTypes.Physical.MUD],
	}
