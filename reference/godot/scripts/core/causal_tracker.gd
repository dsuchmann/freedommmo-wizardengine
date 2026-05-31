class_name CausalTracker
extends RefCounted

signal event_recorded(event: Dictionary)

var _events: Array = []
var _entity_histories: Dictionary = {}
var _max_recent_events: int = 10000
var _event_id_counter: int = 0

func record_event(source_id: int, target_id: int, action: String, details: Dictionary = {}) -> int:
	_event_id_counter += 1
	var event := {
		"id": _event_id_counter,
		"source_id": source_id,
		"target_id": target_id,
		"action": action,
		"timestamp": Time.get_unix_time_from_system(),
		"details": details,
		"direct_effects": [],
		"ripple_effects": [],
	}
	_events.append(event)
	_add_to_history(source_id, event)
	if target_id != source_id and target_id >= 0:
		_add_to_history(target_id, event)
	if _events.size() > _max_recent_events:
		_events = _events.slice(_events.size() - _max_recent_events)
	event_recorded.emit(event)
	return _event_id_counter

func add_direct_effect(event_id: int, effect: Dictionary) -> void:
	for e in _events:
		if e["id"] == event_id:
			e["direct_effects"].append(effect)
			return

func add_ripple_effect(event_id: int, effect: Dictionary) -> void:
	for e in _events:
		if e["id"] == event_id:
			e["ripple_effects"].append(effect)
			return

func get_entity_history(entity_id: int, limit: int = 50) -> Array:
	var history: Array = _entity_histories.get(entity_id, [])
	if history.size() <= limit:
		return history.duplicate()
	return history.slice(history.size() - limit)

func get_events_between(entity_a: int, entity_b: int) -> Array:
	var result: Array = []
	for e in _events:
		if (e["source_id"] == entity_a and e["target_id"] == entity_b) or \
		   (e["source_id"] == entity_b and e["target_id"] == entity_a):
			result.append(e)
	return result

func get_events_by_action(action: String, limit: int = 100) -> Array:
	var result: Array = []
	for i in range(_events.size() - 1, -1, -1):
		if _events[i]["action"] == action:
			result.append(_events[i])
			if result.size() >= limit:
				break
	return result

func get_recent_events(limit: int = 20) -> Array:
	if _events.size() <= limit:
		return _events.duplicate()
	return _events.slice(_events.size() - limit)

func to_llm_context(entity_id: int, limit: int = 10) -> String:
	var history := get_entity_history(entity_id, limit)
	var lines: Array = []
	for e in history:
		var who: String
		if e["source_id"] == entity_id:
			who = "You"
		else:
			who = "Entity %d" % e["source_id"]
		var target_str := ""
		if e["target_id"] >= 0 and e["target_id"] != e["source_id"]:
			if e["target_id"] == entity_id:
				target_str = " (to you)"
			else:
				target_str = " (to entity %d)" % e["target_id"]
		lines.append("%s: %s%s" % [who, e["action"], target_str])
	return "\n".join(lines)

func event_count() -> int:
	return _events.size()

func _add_to_history(entity_id: int, event: Dictionary) -> void:
	if not _entity_histories.has(entity_id):
		_entity_histories[entity_id] = []
	_entity_histories[entity_id].append(event)
