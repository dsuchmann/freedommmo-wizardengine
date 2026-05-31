class_name MaterialRegistry
extends RefCounted

var _recipes: Dictionary = {}
var _emergent_rules: Array = []
var grain_registry: GrainRegistry

func _init(p_grain_registry: GrainRegistry = null) -> void:
	if p_grain_registry:
		grain_registry = p_grain_registry
	else:
		grain_registry = GrainRegistry.new()
	_init_recipes()
	_init_emergent_rules()

func craft(recipe_id: String, input_grains: Array) -> Grain:
	if not _recipes.has(recipe_id):
		return null
	var recipe: Dictionary = _recipes[recipe_id]
	var required: Dictionary = recipe.get("inputs", {})
	for req_id in required:
		var found := false
		for g in input_grains:
			if grain_registry.get_template(req_id).get("type", -1) == g.grain_type:
				found = true
				break
		if not found:
			return null
	return grain_registry.create_grain(recipe.get("output", ""))

func get_emergent_properties(stack: GrainStack) -> Dictionary:
	var props := {}
	for rule in _emergent_rules:
		var check_fn: Callable = rule["check"]
		if check_fn.call(stack):
			var result: Dictionary = rule["properties"]
			for key in result:
				props[key] = result[key]
	return props

func get_recipe(recipe_id: String) -> Dictionary:
	return _recipes.get(recipe_id, {})

func get_all_recipe_ids() -> Array:
	return _recipes.keys()

func _init_recipes() -> void:
	_recipes["steel"] = {
		"inputs": {"iron": 2, "coal": 1},
		"output": "iron",
		"properties_override": {"hardness": 0.85, "density": 7.9},
		"description": "Smelted iron and coal produce hardened steel",
	}
	_recipes["glass_from_sand"] = {
		"inputs": {"sand": 3},
		"output": "glass",
		"requires_heat": 1700.0,
		"description": "Sand heated to extreme temperatures produces glass",
	}
	_recipes["charcoal_from_wood"] = {
		"inputs": {"wood": 2},
		"output": "charcoal",
		"requires_heat": 400.0,
		"description": "Wood burned in low oxygen produces charcoal",
	}
	_recipes["brick"] = {
		"inputs": {"clay": 2},
		"output": "stone",
		"requires_heat": 1000.0,
		"properties_override": {"hardness": 0.65},
		"description": "Fired clay produces brick",
	}
	_recipes["obsidian_from_lava"] = {
		"inputs": {"lava": 1, "water": 1},
		"output": "obsidian",
		"description": "Rapidly cooled lava crystallizes into obsidian",
	}

func _init_emergent_rules() -> void:
	_emergent_rules.append({
		"name": "wet_surface",
		"check": func(stack: GrainStack) -> bool:
			if stack.top() == null: return false
			return stack.top().properties.moisture > 0.6,
		"properties": {"slippery": true, "movement_penalty": 0.3},
	})
	_emergent_rules.append({
		"name": "frozen_surface",
		"check": func(stack: GrainStack) -> bool:
			if stack.top() == null: return false
			return stack.top().properties.temperature < 0.0,
		"properties": {"frozen": true, "slippery": true, "movement_penalty": 0.5},
	})
	_emergent_rules.append({
		"name": "volcanic_heat",
		"check": func(stack: GrainStack) -> bool:
			for g in stack.layers:
				if g.properties.temperature > 500.0:
					return true
			return false,
		"properties": {"heat_damage": true, "damage_per_second": 5.0},
	})
	_emergent_rules.append({
		"name": "hidden_ore",
		"check": func(stack: GrainStack) -> bool:
			if stack.size() < 3: return false
			for i in range(2, stack.size()):
				var g: Grain = stack.layers[i]
				if g.grain_type == GrainTypes.Physical.IRON or \
				   g.grain_type == GrainTypes.Physical.GOLD or \
				   g.grain_type == GrainTypes.Physical.MITHRIL:
					return true
			return false,
		"properties": {"contains_ore": true, "requires_mining": true},
	})
