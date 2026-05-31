class_name NPCBrain
extends RefCounted

signal action_decided(entity_id: int, action: Dictionary)
signal dialogue_initiated(entity_id: int, target_id: int, message: String)

var entity: EntityBody
var causal_tracker: CausalTracker
var time_system: TimeSystem
var _decision_cooldown: float = 0.0

func _init(p_entity: EntityBody = null, p_tracker: CausalTracker = null, p_time: TimeSystem = null) -> void:
	entity = p_entity
	causal_tracker = p_tracker
	time_system = p_time

func tick(delta: float) -> void:
	if entity == null:
		return
	_decision_cooldown -= delta
	if _decision_cooldown > 0.0:
		return
	_decision_cooldown = 1.0 + randf() * 2.0

	var action := _decide_action()
	if not action.is_empty():
		action_decided.emit(entity.entity_id, action)

func _decide_action() -> Dictionary:
	var motivation = entity.mind.get_strongest_motivation()
	if motivation == null:
		return _wander()

	match motivation.info_type:
		InfoGrainTypes.Motivational.SURVIVAL:
			return _seek_survival()
		InfoGrainTypes.Motivational.DESIRE:
			return _pursue_desire(motivation)
		InfoGrainTypes.Motivational.VENGEANCE:
			return _seek_vengeance(motivation)
		InfoGrainTypes.Motivational.PROTECTION:
			return _protect(motivation)
		InfoGrainTypes.Motivational.GREED:
			return _seek_wealth()
		InfoGrainTypes.Motivational.GOAL:
			return _pursue_goal(motivation)
		_:
			return _wander()

func _seek_survival() -> Dictionary:
	var stats = entity.get_computed_stats()
	if stats.get("health", 100.0) < 30.0:
		return {"action": "flee", "priority": 1.0}
	if entity.time_pool < 1000.0:
		return {"action": "seek_time_source", "priority": 0.9}
	return {"action": "forage", "priority": 0.5}

func _pursue_desire(motivation: InfoGrain) -> Dictionary:
	var target := motivation.target_entity_id
	if target >= 0:
		return {"action": "approach", "target_id": target, "priority": 0.7}
	return {"action": "explore", "priority": 0.4}

func _seek_vengeance(motivation: InfoGrain) -> Dictionary:
	var target := motivation.target_entity_id
	if target < 0:
		return _wander()
	if motivation.intensity > 0.8:
		return {"action": "attack", "target_id": target, "priority": 0.95}
	return {"action": "stalk", "target_id": target, "priority": 0.6}

func _protect(motivation: InfoGrain) -> Dictionary:
	var target := motivation.target_entity_id
	if target >= 0:
		return {"action": "guard", "target_id": target, "priority": 0.8}
	return {"action": "patrol", "priority": 0.5}

func _seek_wealth() -> Dictionary:
	return {"action": "mine", "priority": 0.6}

func _pursue_goal(motivation: InfoGrain) -> Dictionary:
	var goal_type: String = motivation.context.get("goal_type", "explore")
	return {"action": goal_type, "priority": motivation.intensity}

func _wander() -> Dictionary:
	return {"action": "wander", "priority": 0.1}

func should_initiate_dialogue(target_id: int) -> bool:
	if entity == null:
		return false
	var dominant = entity.mind.get_dominant_emotion()
	if dominant and dominant.intensity > 0.7:
		return true
	if entity.mind.has_bond_with(target_id):
		return randf() > 0.5
	var motivation = entity.mind.get_strongest_motivation()
	if motivation and motivation.info_type == InfoGrainTypes.Motivational.NEED:
		return true
	return randf() > 0.9

func generate_dialogue_context(target_id: int) -> String:
	var lines: Array = []
	lines.append("You are %s, a %s." % [entity.name, _species_name(entity.species)])
	lines.append("Age: %.0f years. Time remaining: %.0f." % [entity.age, entity.time_pool])
	var mind_ctx = entity.mind.to_llm_context()
	if not mind_ctx.is_empty():
		lines.append("\nMental state:\n%s" % mind_ctx)
	if causal_tracker:
		var history := causal_tracker.to_llm_context(entity.entity_id, 5)
		if not history.is_empty():
			lines.append("\nRecent events:\n%s" % history)
	var relationship = entity.mind.get_relationship_summary(target_id)
	if not relationship.is_empty():
		lines.append("\nRelationship with this person: %s" % str(relationship))
	lines.append("\nRespond in character. Be brief (1-2 sentences).")
	return "\n".join(lines)

func _species_name(s: int) -> String:
	match s:
		EntityBody.Species.HUMAN: return "human"
		EntityBody.Species.ELF: return "elf"
		EntityBody.Species.DWARF: return "dwarf"
		EntityBody.Species.ORC: return "orc"
		EntityBody.Species.GOBLIN: return "goblin"
		EntityBody.Species.DRAGON: return "dragon"
		EntityBody.Species.GOD: return "divine being"
		EntityBody.Species.SPIRIT: return "spirit"
		EntityBody.Species.DEMON: return "demon"
		EntityBody.Species.ANGEL: return "angel"
		_: return "creature"
