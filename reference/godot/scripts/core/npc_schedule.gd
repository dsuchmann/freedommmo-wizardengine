class_name NPCSchedule
extends RefCounted

var _entity_schedules: Dictionary = {}

func assign_schedule(entity_id: int, occupation: String) -> void:
	_entity_schedules[entity_id] = _get_schedule(occupation)

func get_current_activity(entity_id: int, hour: float) -> Dictionary:
	var schedule: Array = _entity_schedules.get(entity_id, _get_schedule("villager"))
	for entry in schedule:
		if hour >= entry["start"] and hour < entry["end"]:
			return entry
	return {"activity": "sleep", "location": "home", "start": 22, "end": 6}

func _get_schedule(occupation: String) -> Array:
	match occupation:
		"farmer":
			return [
				{"activity": "sleep", "location": "home", "start": 0, "end": 5},
				{"activity": "wake_up", "location": "home", "start": 5, "end": 6},
				{"activity": "farm", "location": "field", "start": 6, "end": 12},
				{"activity": "eat", "location": "home", "start": 12, "end": 13},
				{"activity": "farm", "location": "field", "start": 13, "end": 18},
				{"activity": "socialize", "location": "tavern", "start": 18, "end": 21},
				{"activity": "sleep", "location": "home", "start": 21, "end": 24},
			]
		"blacksmith":
			return [
				{"activity": "sleep", "location": "home", "start": 0, "end": 6},
				{"activity": "work", "location": "forge", "start": 6, "end": 12},
				{"activity": "eat", "location": "home", "start": 12, "end": 13},
				{"activity": "work", "location": "forge", "start": 13, "end": 17},
				{"activity": "trade", "location": "market", "start": 17, "end": 19},
				{"activity": "socialize", "location": "tavern", "start": 19, "end": 22},
				{"activity": "sleep", "location": "home", "start": 22, "end": 24},
			]
		"guard":
			return [
				{"activity": "sleep", "location": "barracks", "start": 0, "end": 6},
				{"activity": "patrol", "location": "walls", "start": 6, "end": 14},
				{"activity": "eat", "location": "barracks", "start": 14, "end": 15},
				{"activity": "train", "location": "training_ground", "start": 15, "end": 18},
				{"activity": "rest", "location": "barracks", "start": 18, "end": 20},
				{"activity": "socialize", "location": "tavern", "start": 20, "end": 22},
				{"activity": "sleep", "location": "barracks", "start": 22, "end": 24},
			]
		"merchant":
			return [
				{"activity": "sleep", "location": "home", "start": 0, "end": 7},
				{"activity": "setup", "location": "market", "start": 7, "end": 8},
				{"activity": "trade", "location": "market", "start": 8, "end": 17},
				{"activity": "count_earnings", "location": "home", "start": 17, "end": 18},
				{"activity": "eat", "location": "tavern", "start": 18, "end": 20},
				{"activity": "plan", "location": "home", "start": 20, "end": 22},
				{"activity": "sleep", "location": "home", "start": 22, "end": 24},
			]
		"scholar":
			return [
				{"activity": "sleep", "location": "home", "start": 0, "end": 8},
				{"activity": "study", "location": "library", "start": 8, "end": 12},
				{"activity": "eat", "location": "home", "start": 12, "end": 13},
				{"activity": "research", "location": "laboratory", "start": 13, "end": 18},
				{"activity": "teach", "location": "academy", "start": 18, "end": 20},
				{"activity": "read", "location": "home", "start": 20, "end": 23},
				{"activity": "sleep", "location": "home", "start": 23, "end": 24},
			]
		"hunter":
			return [
				{"activity": "sleep", "location": "camp", "start": 0, "end": 4},
				{"activity": "track", "location": "wilderness", "start": 4, "end": 10},
				{"activity": "hunt", "location": "wilderness", "start": 10, "end": 16},
				{"activity": "butcher", "location": "camp", "start": 16, "end": 18},
				{"activity": "trade", "location": "market", "start": 18, "end": 20},
				{"activity": "rest", "location": "camp", "start": 20, "end": 24},
			]
		_: # villager default
			return [
				{"activity": "sleep", "location": "home", "start": 0, "end": 7},
				{"activity": "chores", "location": "home", "start": 7, "end": 9},
				{"activity": "work", "location": "village", "start": 9, "end": 12},
				{"activity": "eat", "location": "home", "start": 12, "end": 13},
				{"activity": "work", "location": "village", "start": 13, "end": 17},
				{"activity": "socialize", "location": "square", "start": 17, "end": 20},
				{"activity": "eat", "location": "home", "start": 20, "end": 21},
				{"activity": "sleep", "location": "home", "start": 21, "end": 24},
			]
