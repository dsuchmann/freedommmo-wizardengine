class_name QuestGenerator
extends RefCounted

signal quest_available(quest: Dictionary)

var _active_quests: Dictionary = {}
var _completed_quests: Array = []
var _next_id: int = 0
var _gen_timer: float = 0.0

func tick(delta: float, world_state: Dictionary = {}) -> void:
	_gen_timer += delta
	if _gen_timer < 15.0:
		return
	_gen_timer = 0.0
	_try_generate_quest(world_state)

func _try_generate_quest(world_state: Dictionary) -> void:
	if _active_quests.size() >= 10:
		return

	var templates := [
		_generate_hunt_quest,
		_generate_gather_quest,
		_generate_explore_quest,
		_generate_deliver_quest,
		_generate_rescue_quest,
		_generate_bounty_quest,
		_generate_craft_quest,
	]

	var gen_func: Callable = templates.pick_random()
	var quest: Dictionary = gen_func.call()
	if not quest.is_empty():
		_next_id += 1
		quest["id"] = _next_id
		quest["status"] = "available"
		quest["accepted_at"] = 0.0
		_active_quests[_next_id] = quest
		quest_available.emit(quest)

func accept_quest(quest_id: int) -> bool:
	if not _active_quests.has(quest_id):
		return false
	_active_quests[quest_id]["status"] = "active"
	_active_quests[quest_id]["accepted_at"] = Time.get_unix_time_from_system()
	return true

func complete_quest(quest_id: int) -> Dictionary:
	if not _active_quests.has(quest_id):
		return {}
	var quest: Dictionary = _active_quests[quest_id]
	quest["status"] = "completed"
	_completed_quests.append(quest)
	_active_quests.erase(quest_id)
	return quest.get("rewards", {})

func get_active_quests() -> Array:
	return _active_quests.values()

func update_kill_progress(target_type: String) -> Array:
	var completed_quests: Array = []
	for qid in _active_quests:
		var quest = _active_quests[qid]
		if quest["status"] != "active":
			continue
		var objectives: Array = quest.get("objectives", [])
		for obj in objectives:
			if obj.get("type", "") == "kill" and obj.get("target", "").find(target_type) >= 0:
				obj["progress"] = obj.get("progress", 0) + 1
				if obj["progress"] >= obj.get("count", 1):
					completed_quests.append(qid)
	return completed_quests

func update_gather_progress(item_name: String) -> Array:
	var completed_quests: Array = []
	for qid in _active_quests:
		var quest = _active_quests[qid]
		if quest["status"] != "active":
			continue
		var objectives: Array = quest.get("objectives", [])
		for obj in objectives:
			if obj.get("type", "") == "collect" and obj.get("item", "").find(item_name) >= 0:
				obj["progress"] = obj.get("progress", 0) + 1
				if obj["progress"] >= obj.get("count", 1):
					completed_quests.append(qid)
	return completed_quests

func get_available_quests() -> Array:
	var result: Array = []
	for q in _active_quests.values():
		if q["status"] == "available":
			result.append(q)
	return result

func _generate_hunt_quest() -> Dictionary:
	var targets := ["wolves", "goblins", "bandits", "wild boars", "giant spiders"]
	var target: String = targets.pick_random()
	var count := 3 + randi() % 5
	return {
		"type": "hunt", "title": "Hunt %d %s" % [count, target],
		"description": "The village needs protection. Hunt %d %s threatening the area." % [count, target],
		"objectives": [{"type": "kill", "target": target, "count": count, "progress": 0}],
		"rewards": {"coins": 20 + count * 10, "experience": 50 + count * 15, "reputation": 5},
	}

func _generate_gather_quest() -> Dictionary:
	var items := ["mushrooms", "herbs", "iron ore", "wood", "crystal shards"]
	var item: String = items.pick_random()
	var count := 5 + randi() % 10
	return {
		"type": "gather", "title": "Gather %d %s" % [count, item],
		"description": "A local craftsman needs %d %s for their work." % [count, item],
		"objectives": [{"type": "collect", "item": item, "count": count, "progress": 0}],
		"rewards": {"coins": 10 + count * 5, "experience": 30 + count * 5},
	}

func _generate_explore_quest() -> Dictionary:
	var locations := ["ancient ruins", "cave system", "mountain peak", "hidden grove", "abandoned mine"]
	var location: String = locations.pick_random()
	return {
		"type": "explore", "title": "Explore the %s" % location,
		"description": "Rumors speak of a %s waiting to be discovered." % location,
		"objectives": [{"type": "discover", "location": location, "progress": 0}],
		"rewards": {"coins": 30, "experience": 80, "item": "Strange Stone"},
	}

func _generate_deliver_quest() -> Dictionary:
	var recipients := ["the blacksmith", "the elder", "a traveling merchant", "the healer"]
	var recipient: String = recipients.pick_random()
	return {
		"type": "deliver", "title": "Deliver package to %s" % recipient,
		"description": "An urgent package needs to reach %s before nightfall." % recipient,
		"objectives": [{"type": "deliver", "to": recipient, "progress": 0}],
		"rewards": {"coins": 15, "experience": 25, "reputation": 3},
	}

func _generate_rescue_quest() -> Dictionary:
	var names := ["a lost child", "a kidnapped villager", "a trapped miner", "an injured traveler"]
	var target: String = names.pick_random()
	return {
		"type": "rescue", "title": "Rescue %s" % target,
		"description": "%s needs your help! Time is running out." % target.capitalize(),
		"objectives": [{"type": "rescue", "target": target, "progress": 0}],
		"rewards": {"coins": 40, "experience": 100, "reputation": 10, "karma": 5},
	}

func _generate_bounty_quest() -> Dictionary:
	var targets := ["the Bandit King", "a rogue mage", "an orc warchief", "a corrupt merchant"]
	var target: String = targets.pick_random()
	return {
		"type": "bounty", "title": "Bounty: %s" % target,
		"description": "A bounty has been placed on %s. Bring proof of defeat." % target,
		"objectives": [{"type": "kill", "target": target, "count": 1, "progress": 0}],
		"rewards": {"coins": 100, "experience": 200, "reputation": 15},
	}

func _generate_craft_quest() -> Dictionary:
	var items := ["a steel sword", "healing potions", "leather armor", "a torch"]
	var item: String = items.pick_random()
	return {
		"type": "craft", "title": "Craft %s" % item,
		"description": "The village needs %s. Gather materials and craft it." % item,
		"objectives": [{"type": "craft", "item": item, "count": 1, "progress": 0}],
		"rewards": {"coins": 25, "experience": 60},
	}
