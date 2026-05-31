class_name MoralitySystem
extends RefCounted

signal karma_changed(entity_id: int, new_karma: float, reason: String)

var _entity_karma: Dictionary = {}
var causal_tracker: CausalTracker

const MORAL_ACTIONS: Dictionary = {
	"help_injured": 5.0,
	"share_resources": 3.0,
	"protect_weak": 8.0,
	"honest_trade": 2.0,
	"teach_skill": 4.0,
	"heal_stranger": 6.0,
	"spare_defeated": 10.0,
	"charity": 7.0,
	"rescue": 15.0,
}

const IMMORAL_ACTIONS: Dictionary = {
	"murder": -20.0,
	"theft": -8.0,
	"slavery": -25.0,
	"betrayal": -15.0,
	"extortion": -10.0,
	"deception": -5.0,
	"attack_innocent": -12.0,
	"destroy_property": -6.0,
	"cannibalism": -18.0,
}

func _init(p_causal: CausalTracker = null) -> void:
	causal_tracker = p_causal

func get_karma(entity_id: int) -> float:
	return _entity_karma.get(entity_id, 0.0)

func get_alignment(entity_id: int) -> String:
	var karma := get_karma(entity_id)
	if karma >= 50: return "saintly"
	if karma >= 25: return "virtuous"
	if karma >= 10: return "good"
	if karma >= -10: return "neutral"
	if karma >= -25: return "questionable"
	if karma >= -50: return "villainous"
	return "evil"

func record_action(entity_id: int, action: String, target_id: int = -1) -> float:
	var karma_change := 0.0

	if MORAL_ACTIONS.has(action):
		karma_change = MORAL_ACTIONS[action]
	elif IMMORAL_ACTIONS.has(action):
		karma_change = IMMORAL_ACTIONS[action]

	if karma_change != 0.0:
		_entity_karma[entity_id] = get_karma(entity_id) + karma_change
		karma_changed.emit(entity_id, _entity_karma[entity_id], action)

		if causal_tracker:
			causal_tracker.record_event(entity_id, target_id, "moral_action", {
				"action": action, "karma_change": karma_change,
				"new_karma": _entity_karma[entity_id],
			})

	return karma_change

func get_time_acquisition_modifier(entity_id: int) -> float:
	var karma := get_karma(entity_id)
	if karma >= 25:
		return 1.1 + (karma - 25) * 0.002
	elif karma <= -25:
		return 0.9 + (karma + 25) * 0.002
	return 1.0

func would_npc_do(entity: EntityBody, action: String) -> bool:
	var empathy = entity.mind.get_by_type(
		InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.LOVE)
	var greed_grains = entity.mind.get_by_type(
		InfoGrainTypes.Category.MOTIVATIONAL, InfoGrainTypes.Motivational.GREED)

	var empathy_level := 0.0
	for e in empathy:
		empathy_level = maxf(empathy_level, e.intensity)

	var greed_level := 0.0
	for g in greed_grains:
		greed_level = maxf(greed_level, g.intensity)

	if MORAL_ACTIONS.has(action):
		return empathy_level > 0.3 or randf() > 0.7
	elif IMMORAL_ACTIONS.has(action):
		return greed_level > 0.6 and empathy_level < 0.3
	return randf() > 0.5
