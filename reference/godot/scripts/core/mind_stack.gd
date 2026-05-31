class_name MindStack
extends RefCounted

var grains: Array = []
var entity_id: int = 0

func add(grain: InfoGrain) -> void:
	grains.append(grain)
	_sort_by_salience()

func remove_expired() -> int:
	var before := grains.size()
	grains = grains.filter(func(g: InfoGrain) -> bool: return !g.is_expired())
	return before - grains.size()

func tick(delta: float) -> void:
	for grain in grains:
		grain.tick(delta)
	remove_expired()

func get_by_category(cat: int) -> Array:
	return grains.filter(func(g: InfoGrain) -> bool: return g.category == cat)

func get_by_type(cat: int, info_type: int) -> Array:
	return grains.filter(func(g: InfoGrain) -> bool: return g.category == cat and g.info_type == info_type)

func get_toward(target_id: int) -> Array:
	return grains.filter(func(g: InfoGrain) -> bool: return g.target_entity_id == target_id)

func get_dominant_emotion() -> InfoGrain:
	var emotions := get_by_category(InfoGrainTypes.Category.EMOTIONAL)
	if emotions.is_empty():
		return null
	return emotions[0]

func get_strongest_motivation() -> InfoGrain:
	var motivations := get_by_category(InfoGrainTypes.Category.MOTIVATIONAL)
	if motivations.is_empty():
		return null
	return motivations[0]

func has_grudge_against(target_id: int) -> bool:
	var grudges := get_by_type(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
	for g in grudges:
		if g.target_entity_id == target_id and g.intensity > 0.1:
			return true
	return false

func has_bond_with(target_id: int) -> bool:
	var bonds := get_by_type(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
	for g in bonds:
		if g.target_entity_id == target_id and g.intensity > 0.1:
			return true
	return false

func get_relationship_summary(target_id: int) -> Dictionary:
	var toward := get_toward(target_id)
	var summary := {}
	for g in toward:
		var key := str(g.category) + "_" + str(g.info_type)
		summary[key] = g.intensity
	return summary

func to_llm_context() -> String:
	var lines: Array = []
	var emotions := get_by_category(InfoGrainTypes.Category.EMOTIONAL)
	if not emotions.is_empty():
		var top: InfoGrain = emotions[0]
		lines.append("Currently feeling: %s (intensity: %.1f)" % [_emotion_name(top.info_type), top.intensity])

	var motivations := get_by_category(InfoGrainTypes.Category.MOTIVATIONAL)
	if not motivations.is_empty():
		var top: InfoGrain = motivations[0]
		lines.append("Primary drive: %s (intensity: %.1f)" % [_motivation_name(top.info_type), top.intensity])

	var relations := get_by_category(InfoGrainTypes.Category.RELATIONAL)
	for r in relations.slice(0, 3):
		lines.append("Relationship with entity %d: %s (%.1f)" % [r.target_entity_id, _relation_name(r.info_type), r.intensity])

	var memories := get_by_type(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
	for m in memories.slice(0, 3):
		if m.context.has("description"):
			lines.append("Remembers: %s" % m.context["description"])

	return "\n".join(lines)

func size() -> int:
	return grains.size()

func _sort_by_salience() -> void:
	grains.sort_custom(func(a: InfoGrain, b: InfoGrain) -> bool: return a.salience > b.salience)

func _emotion_name(t: int) -> String:
	match t:
		0: return "joy"
		1: return "sadness"
		2: return "anger"
		3: return "fear"
		4: return "disgust"
		8: return "love"
		9: return "grief"
		11: return "pride"
		_: return "emotion_%d" % t

func _motivation_name(t: int) -> String:
	match t:
		0: return "desire"
		1: return "need"
		2: return "goal"
		9: return "vengeance"
		13: return "survival"
		_: return "motivation_%d" % t

func _relation_name(t: int) -> String:
	match t:
		0: return "bond"
		1: return "grudge"
		2: return "debt"
		3: return "oath"
		9: return "romance"
		_: return "relation_%d" % t

func to_dict() -> Dictionary:
	var grain_dicts: Array = []
	for g in grains:
		grain_dicts.append(g.to_dict())
	return {"entity_id": entity_id, "grains": grain_dicts}

static func from_dict(d: Dictionary) -> MindStack:
	var ms := MindStack.new()
	ms.entity_id = int(d.get("entity_id", 0))
	for gd in d.get("grains", []):
		ms.grains.append(InfoGrain.from_dict(gd))
	ms._sort_by_salience()
	return ms
