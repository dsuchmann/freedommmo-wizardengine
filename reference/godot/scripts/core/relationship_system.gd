class_name RelationshipSystem
extends RefCounted

signal relationship_formed(entity_a: int, entity_b: int, rel_type: String)
signal relationship_changed(entity_a: int, entity_b: int, rel_type: String, strength: float)
signal child_born(parent_a: int, parent_b: int, child_id: int)

enum RelType {
	STRANGER,
	ACQUAINTANCE,
	FRIEND,
	CLOSE_FRIEND,
	ROMANTIC,
	PARTNER,
	SPOUSE,
	PARENT,
	CHILD,
	SIBLING,
	MENTOR,
	STUDENT,
	RIVAL,
	ENEMY,
}

var _relationships: Dictionary = {}
var _family_trees: Dictionary = {}

func get_relationship(entity_a: int, entity_b: int) -> Dictionary:
	var key := _rel_key(entity_a, entity_b)
	return _relationships.get(key, {"type": RelType.STRANGER, "strength": 0.0, "history": []})

func set_relationship(entity_a: int, entity_b: int, rel_type: int, strength: float = 0.5) -> void:
	var key := _rel_key(entity_a, entity_b)
	_relationships[key] = {
		"type": rel_type,
		"strength": clampf(strength, 0.0, 1.0),
		"history": _relationships.get(key, {}).get("history", []),
		"started_at": Time.get_unix_time_from_system(),
	}
	relationship_formed.emit(entity_a, entity_b, _rel_type_name(rel_type))

func modify_strength(entity_a: int, entity_b: int, amount: float) -> void:
	var key := _rel_key(entity_a, entity_b)
	if _relationships.has(key):
		_relationships[key]["strength"] = clampf(
			_relationships[key]["strength"] + amount, 0.0, 1.0)
		_check_relationship_evolution(entity_a, entity_b)
		relationship_changed.emit(entity_a, entity_b,
			_rel_type_name(_relationships[key]["type"]),
			_relationships[key]["strength"])

func record_interaction(entity_a: int, entity_b: int, interaction_type: String) -> void:
	var key := _rel_key(entity_a, entity_b)
	if not _relationships.has(key):
		set_relationship(entity_a, entity_b, RelType.ACQUAINTANCE, 0.1)
	_relationships[key]["history"].append({
		"type": interaction_type,
		"timestamp": Time.get_unix_time_from_system(),
	})
	# Interactions increase relationship strength
	match interaction_type:
		"conversation": modify_strength(entity_a, entity_b, 0.05)
		"gift": modify_strength(entity_a, entity_b, 0.1)
		"helped": modify_strength(entity_a, entity_b, 0.15)
		"fought_together": modify_strength(entity_a, entity_b, 0.1)
		"betrayed": modify_strength(entity_a, entity_b, -0.3)
		"attacked": modify_strength(entity_a, entity_b, -0.2)
		"traded": modify_strength(entity_a, entity_b, 0.03)

func register_family(parent_a: int, parent_b: int, child_id: int) -> void:
	set_relationship(parent_a, child_id, RelType.PARENT, 0.9)
	set_relationship(parent_b, child_id, RelType.PARENT, 0.9)
	set_relationship(child_id, parent_a, RelType.CHILD, 0.9)
	set_relationship(child_id, parent_b, RelType.CHILD, 0.9)

	if not _family_trees.has(parent_a):
		_family_trees[parent_a] = {"children": [], "partner": -1}
	if not _family_trees.has(parent_b):
		_family_trees[parent_b] = {"children": [], "partner": -1}
	_family_trees[parent_a]["children"].append(child_id)
	_family_trees[parent_b]["children"].append(child_id)
	_family_trees[parent_a]["partner"] = parent_b
	_family_trees[parent_b]["partner"] = parent_a

	# Siblings
	for existing_child in _family_trees[parent_a]["children"]:
		if existing_child != child_id:
			set_relationship(child_id, existing_child, RelType.SIBLING, 0.7)
			set_relationship(existing_child, child_id, RelType.SIBLING, 0.7)

	child_born.emit(parent_a, parent_b, child_id)

func get_family(entity_id: int) -> Dictionary:
	return _family_trees.get(entity_id, {"children": [], "partner": -1})

func get_all_relationships(entity_id: int) -> Array:
	var result: Array = []
	for key in _relationships:
		if key.begins_with(str(entity_id) + "_") or key.ends_with("_" + str(entity_id)):
			var parts = key.split("_")
			var other_id := int(parts[0]) if int(parts[1]) == entity_id else int(parts[1])
			result.append({
				"entity_id": other_id,
				"type": _relationships[key]["type"],
				"strength": _relationships[key]["strength"],
			})
	return result

func _check_relationship_evolution(entity_a: int, entity_b: int) -> void:
	var key := _rel_key(entity_a, entity_b)
	var rel: Dictionary = _relationships[key]
	var strength: float = rel["strength"]

	match rel["type"]:
		RelType.STRANGER:
			if strength > 0.2:
				rel["type"] = RelType.ACQUAINTANCE
		RelType.ACQUAINTANCE:
			if strength > 0.4:
				rel["type"] = RelType.FRIEND
		RelType.FRIEND:
			if strength > 0.7:
				rel["type"] = RelType.CLOSE_FRIEND
		RelType.CLOSE_FRIEND:
			if strength > 0.85:
				rel["type"] = RelType.ROMANTIC

func _rel_key(a: int, b: int) -> String:
	if a < b:
		return "%d_%d" % [a, b]
	return "%d_%d" % [b, a]

func _rel_type_name(t: int) -> String:
	match t:
		RelType.STRANGER: return "stranger"
		RelType.ACQUAINTANCE: return "acquaintance"
		RelType.FRIEND: return "friend"
		RelType.CLOSE_FRIEND: return "close friend"
		RelType.ROMANTIC: return "romantic"
		RelType.PARTNER: return "partner"
		RelType.SPOUSE: return "spouse"
		RelType.PARENT: return "parent"
		RelType.CHILD: return "child"
		RelType.SIBLING: return "sibling"
		RelType.MENTOR: return "mentor"
		RelType.STUDENT: return "student"
		RelType.RIVAL: return "rival"
		RelType.ENEMY: return "enemy"
		_: return "unknown"
