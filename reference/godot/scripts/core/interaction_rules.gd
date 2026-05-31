class_name InteractionRules
extends RefCounted

enum ActionType {
	DIG,
	BURN,
	FREEZE,
	STRIKE,
	CAST,
	POUR,
	PLANT,
	HARVEST,
	MINE,
	SMELT,
	BUILD,
	DESTROY,
	ENCHANT,
	PURIFY,
	CORRUPT,
}

var _rules: Dictionary = {}

func _init() -> void:
	_register_all_rules()

func can_interact(action: int, stack: GrainStack) -> bool:
	if stack == null or stack.top() == null:
		return false
	var key = _rule_key(action, stack.top().category, stack.top().grain_type)
	if _rules.has(key):
		return true
	var generic_key = _rule_key(action, stack.top().category, -1)
	return _rules.has(generic_key)

func get_rule(action: int, grain_category: int, grain_type: int) -> Dictionary:
	var key := _rule_key(action, grain_category, grain_type)
	if _rules.has(key):
		return _rules[key]
	var generic_key := _rule_key(action, grain_category, -1)
	return _rules.get(generic_key, {})

func get_required_strength(action: int, stack: GrainStack) -> float:
	if stack == null or stack.top() == null:
		return 999.0
	var rule = get_rule(action, stack.top().category, stack.top().grain_type)
	return rule.get("min_strength", stack.top().properties.hardness)

func get_result_type(action: int, grain_category: int, grain_type: int) -> Dictionary:
	var rule := get_rule(action, grain_category, grain_type)
	return {
		"produces": rule.get("produces", ""),
		"removes_top": rule.get("removes_top", false),
		"damages": rule.get("damages", 0.0),
		"transforms_to": rule.get("transforms_to", -1),
		"spreads": rule.get("spreads", false),
		"spread_radius": rule.get("spread_radius", 0),
	}

func _rule_key(action: int, category: int, grain_type: int) -> String:
	return "%d_%d_%d" % [action, category, grain_type]

func _register_all_rules() -> void:
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS,
		{"removes_top": true, "min_strength": 0.05})
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SOIL,
		{"removes_top": true, "min_strength": 0.2})
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SAND,
		{"removes_top": true, "min_strength": 0.1})
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MUD,
		{"removes_top": true, "min_strength": 0.05})
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRAVEL,
		{"removes_top": true, "min_strength": 0.3})
	_add_rule(ActionType.DIG, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.CLAY,
		{"removes_top": true, "min_strength": 0.2})

	_add_rule(ActionType.MINE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE,
		{"removes_top": true, "min_strength": 0.6, "produces": "gravel"})
	_add_rule(ActionType.MINE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.IRON,
		{"removes_top": true, "min_strength": 0.5, "produces": "iron"})
	_add_rule(ActionType.MINE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GOLD,
		{"removes_top": true, "min_strength": 0.3, "produces": "gold"})
	_add_rule(ActionType.MINE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MITHRIL,
		{"removes_top": true, "min_strength": 0.8, "produces": "mithril"})
	_add_rule(ActionType.MINE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.COAL,
		{"removes_top": true, "min_strength": 0.3, "produces": "coal"})

	_add_rule(ActionType.BURN, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS,
		{"removes_top": true, "produces": "ash", "spreads": true, "spread_radius": 2})
	_add_rule(ActionType.BURN, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.WOOD,
		{"removes_top": true, "produces": "charcoal", "spreads": true, "spread_radius": 1})
	_add_rule(ActionType.BURN, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.LEAF,
		{"removes_top": true, "produces": "ash", "spreads": true, "spread_radius": 3})
	_add_rule(ActionType.BURN, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MOSS,
		{"removes_top": true, "produces": "ash", "spreads": true, "spread_radius": 1})

	_add_rule(ActionType.FREEZE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.WATER,
		{"transforms_to": GrainTypes.Physical.ICE})
	_add_rule(ActionType.FREEZE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MUD,
		{"transforms_to": GrainTypes.Physical.CLAY, "min_strength": 0.3})

	_add_rule(ActionType.POUR, GrainTypes.Category.PHYSICAL, -1,
		{"produces": "water", "min_strength": 0.0})

	_add_rule(ActionType.PLANT, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SOIL,
		{"produces": "grass", "min_strength": 0.0})
	_add_rule(ActionType.PLANT, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MUD,
		{"produces": "moss", "min_strength": 0.0})

	_add_rule(ActionType.HARVEST, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS,
		{"removes_top": true, "min_strength": 0.01})
	_add_rule(ActionType.HARVEST, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.FLOWER,
		{"removes_top": true, "min_strength": 0.01})
	_add_rule(ActionType.HARVEST, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.MUSHROOM,
		{"removes_top": true, "min_strength": 0.01})

	_add_rule(ActionType.STRIKE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GLASS,
		{"removes_top": true, "min_strength": 0.3})
	_add_rule(ActionType.STRIKE, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.ICE,
		{"removes_top": true, "min_strength": 0.2, "produces": "water"})

	_add_rule(ActionType.ENCHANT, GrainTypes.Category.PHYSICAL, GrainTypes.Physical.CRYSTAL,
		{"transforms_to": -1, "produces": "mana_crystal_effect"})

func _add_rule(action: int, category: int, grain_type: int, rule: Dictionary) -> void:
	_rules[_rule_key(action, category, grain_type)] = rule
