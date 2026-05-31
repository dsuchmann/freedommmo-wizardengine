class_name FactionSystem
extends RefCounted

signal reputation_changed(entity_id: int, faction: String, new_value: float)
signal faction_war_declared(faction_a: String, faction_b: String)

var _factions: Dictionary = {}
var _entity_factions: Dictionary = {}
var _entity_reputation: Dictionary = {}
var _faction_relations: Dictionary = {}

func _init() -> void:
	_init_factions()

func register_entity(entity_id: int, faction: String) -> void:
	_entity_factions[entity_id] = faction
	if not _entity_reputation.has(entity_id):
		_entity_reputation[entity_id] = {}
	# Start neutral with all factions
	for f in _factions:
		if f == faction:
			_entity_reputation[entity_id][f] = 50.0
		else:
			var base_relation: float = _faction_relations.get(_relation_key(faction, f), 0.0)
			_entity_reputation[entity_id][f] = 25.0 + base_relation * 25.0

func get_faction(entity_id: int) -> String:
	return _entity_factions.get(entity_id, "neutral")

func get_reputation(entity_id: int, faction: String) -> float:
	var reps = _entity_reputation.get(entity_id, {})
	return reps.get(faction, 25.0)

func modify_reputation(entity_id: int, faction: String, amount: float) -> void:
	if not _entity_reputation.has(entity_id):
		_entity_reputation[entity_id] = {}
	var current: float = _entity_reputation[entity_id].get(faction, 25.0)
	_entity_reputation[entity_id][faction] = clampf(current + amount, -100.0, 100.0)
	reputation_changed.emit(entity_id, faction, _entity_reputation[entity_id][faction])

func get_standing(entity_id: int, faction: String) -> String:
	var rep := get_reputation(entity_id, faction)
	if rep >= 80: return "revered"
	if rep >= 60: return "honored"
	if rep >= 40: return "friendly"
	if rep >= 20: return "neutral"
	if rep >= 0: return "unfriendly"
	if rep >= -50: return "hostile"
	return "enemy"

func are_hostile(entity_a: int, entity_b: int) -> bool:
	var fa := get_faction(entity_a)
	var fb := get_faction(entity_b)
	if fa == fb:
		return false
	var relation: float = _faction_relations.get(_relation_key(fa, fb), 0.0)
	return relation < -0.5

func get_faction_members(faction: String) -> Array:
	var result: Array = []
	for eid in _entity_factions:
		if _entity_factions[eid] == faction:
			result.append(eid)
	return result

func get_all_factions() -> Array:
	return _factions.keys()

func _relation_key(a: String, b: String) -> String:
	if a < b:
		return "%s_%s" % [a, b]
	return "%s_%s" % [b, a]

func _init_factions() -> void:
	_factions["villagers"] = {"name": "Village Folk", "color": Color(0.2, 0.6, 0.3)}
	_factions["traders"] = {"name": "Merchant Guild", "color": Color(0.7, 0.6, 0.2)}
	_factions["warriors"] = {"name": "Iron Guard", "color": Color(0.6, 0.3, 0.3)}
	_factions["scholars"] = {"name": "Arcane Academy", "color": Color(0.3, 0.3, 0.7)}
	_factions["bandits"] = {"name": "Shadow Wolves", "color": Color(0.4, 0.2, 0.2)}
	_factions["forest_folk"] = {"name": "Woodland Keepers", "color": Color(0.2, 0.5, 0.2)}
	_factions["underground"] = {"name": "Deep Miners", "color": Color(0.5, 0.4, 0.3)}
	_factions["neutral"] = {"name": "Unaffiliated", "color": Color(0.5, 0.5, 0.5)}

	# Set base relations (-1 hostile to 1 allied)
	_faction_relations[_relation_key("villagers", "traders")] = 0.6
	_faction_relations[_relation_key("villagers", "warriors")] = 0.3
	_faction_relations[_relation_key("villagers", "bandits")] = -0.8
	_faction_relations[_relation_key("traders", "bandits")] = -0.6
	_faction_relations[_relation_key("warriors", "bandits")] = -0.9
	_faction_relations[_relation_key("scholars", "forest_folk")] = 0.4
	_faction_relations[_relation_key("underground", "forest_folk")] = -0.3
	_faction_relations[_relation_key("warriors", "underground")] = 0.2
