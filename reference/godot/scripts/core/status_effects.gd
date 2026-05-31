class_name StatusEffects
extends RefCounted

signal effect_applied(entity_id: int, effect_name: String)
signal effect_expired(entity_id: int, effect_name: String)

var _entity_effects: Dictionary = {}

func apply_effect(entity_id: int, effect_name: String, duration: float, potency: float = 1.0) -> void:
	if not _entity_effects.has(entity_id):
		_entity_effects[entity_id] = []
	_entity_effects[entity_id].append({
		"name": effect_name,
		"remaining": duration,
		"potency": potency,
		"applied_at": Time.get_unix_time_from_system(),
	})
	effect_applied.emit(entity_id, effect_name)

func tick(entity_id: int, delta: float) -> Array:
	if not _entity_effects.has(entity_id):
		return []
	var expired: Array = []
	var active: Array = _entity_effects[entity_id]
	var to_remove: Array = []
	for i in range(active.size()):
		active[i]["remaining"] -= delta
		if active[i]["remaining"] <= 0:
			expired.append(active[i]["name"])
			to_remove.append(i)
	for i in range(to_remove.size() - 1, -1, -1):
		active.remove_at(to_remove[i])
	for name in expired:
		effect_expired.emit(entity_id, name)
	return expired

func get_effects(entity_id: int) -> Array:
	return _entity_effects.get(entity_id, [])

func has_effect(entity_id: int, effect_name: String) -> bool:
	for e in _entity_effects.get(entity_id, []):
		if e["name"] == effect_name:
			return true
	return false

func get_stat_modifiers(entity_id: int) -> Dictionary:
	var mods := {}
	for e in _entity_effects.get(entity_id, []):
		match e["name"]:
			"strength_buff": mods["strength"] = mods.get("strength", 0.0) + 5.0 * e["potency"]
			"speed_buff": mods["speed"] = mods.get("speed", 0.0) + 3.0 * e["potency"]
			"defense_buff": mods["defense"] = mods.get("defense", 0.0) + 5.0 * e["potency"]
			"poison": mods["health_drain"] = mods.get("health_drain", 0.0) + 2.0 * e["potency"]
			"burning": mods["health_drain"] = mods.get("health_drain", 0.0) + 5.0 * e["potency"]
			"frozen": mods["speed"] = mods.get("speed", 0.0) - 4.0 * e["potency"]
			"blessed": mods["time_regen"] = mods.get("time_regen", 0.0) + 1.0 * e["potency"]
			"cursed": mods["time_drain"] = mods.get("time_drain", 0.0) + 1.0 * e["potency"]
			"invisible": mods["stealth"] = 1.0
			"regeneration": mods["health_regen"] = mods.get("health_regen", 0.0) + 3.0 * e["potency"]
	return mods

func clear_effects(entity_id: int) -> void:
	_entity_effects.erase(entity_id)
