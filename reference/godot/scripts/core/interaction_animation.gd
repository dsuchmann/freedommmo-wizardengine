class_name InteractionAnimation
extends RefCounted

var _templates: Dictionary = {}
var _active_animations: Dictionary = {}
var _anim_counter: int = 0
var asset_pipeline: AssetPipeline

func _init(p_pipeline: AssetPipeline = null) -> void:
	asset_pipeline = p_pipeline
	_init_templates()

func start_animation(template_name: String, entities: Array) -> int:
	if not _templates.has(template_name):
		return -1
	_anim_counter += 1
	var template: Dictionary = _templates[template_name]
	var adapted_frames := _adapt_to_entities(template, entities)
	_active_animations[_anim_counter] = {
		"id": _anim_counter,
		"template": template_name,
		"entities": entities,
		"frames": adapted_frames,
		"current_frame": 0,
		"frame_timer": 0.0,
		"frame_duration": template.get("frame_duration", 0.2),
		"completed": false,
	}
	if asset_pipeline:
		asset_pipeline.queue_animation_generation(template_name, entities)
	return _anim_counter

func tick(delta: float) -> Array:
	var completed: Array = []
	for id in _active_animations:
		var anim: Dictionary = _active_animations[id]
		anim["frame_timer"] += delta
		if anim["frame_timer"] >= anim["frame_duration"]:
			anim["frame_timer"] = 0.0
			anim["current_frame"] += 1
			if anim["current_frame"] >= anim["frames"].size():
				anim["completed"] = true
				completed.append(id)
	for id in completed:
		_active_animations.erase(id)
	return completed

func get_current_frame(anim_id: int) -> Dictionary:
	if not _active_animations.has(anim_id):
		return {}
	var anim: Dictionary = _active_animations[anim_id]
	if anim["current_frame"] < anim["frames"].size():
		return anim["frames"][anim["current_frame"]]
	return {}

func active_count() -> int:
	return _active_animations.size()

func _adapt_to_entities(template: Dictionary, entities: Array) -> Array:
	var base_frames: Array = template.get("frames", [])
	var adapted: Array = []
	for frame in base_frames:
		var new_frame = frame.duplicate(true)
		for i in range(mini(entities.size(), new_frame.get("positions", []).size())):
			var entity: EntityBody = entities[i] if entities[i] is EntityBody else null
			if entity:
				var pos: Dictionary = new_frame["positions"][i]
				if not entity.has_body_part(pos.get("active_part", "hands")):
					pos["mirrored"] = true
					var alt = _find_alternative_part(pos.get("active_part", "hands"))
					pos["active_part"] = alt
		adapted.append(new_frame)
	return adapted

func _find_alternative_part(part: String) -> String:
	match part:
		"hands", "lower_arms": return "upper_arms"
		"feet", "lower_legs": return "upper_legs"
		_: return part

func _init_templates() -> void:
	_templates["melee_attack"] = {
		"name": "melee_attack", "frame_duration": 0.15,
		"frames": [
			{"positions": [{"x": 0, "y": 0, "active_part": "main_hand", "action": "wind_up"}, {"x": 32, "y": 0, "action": "idle"}]},
			{"positions": [{"x": 8, "y": 0, "active_part": "main_hand", "action": "swing"}, {"x": 32, "y": 0, "action": "brace"}]},
			{"positions": [{"x": 16, "y": 0, "active_part": "main_hand", "action": "impact"}, {"x": 32, "y": -4, "action": "hit_react"}]},
			{"positions": [{"x": 8, "y": 0, "active_part": "main_hand", "action": "recover"}, {"x": 32, "y": 0, "action": "stagger"}]},
		],
	}
	_templates["pickup_item"] = {
		"name": "pickup_item", "frame_duration": 0.2,
		"frames": [
			{"positions": [{"x": 0, "y": 0, "active_part": "hands", "action": "reach_down"}]},
			{"positions": [{"x": 0, "y": 4, "active_part": "hands", "action": "grab"}]},
			{"positions": [{"x": 0, "y": 0, "active_part": "hands", "action": "lift"}]},
		],
	}
	_templates["embrace"] = {
		"name": "embrace", "frame_duration": 0.3,
		"frames": [
			{"positions": [{"x": 0, "y": 0, "active_part": "upper_arms", "action": "open_arms"}, {"x": 24, "y": 0, "action": "approach"}]},
			{"positions": [{"x": 4, "y": 0, "active_part": "upper_arms", "action": "wrap"}, {"x": 20, "y": 0, "active_part": "upper_arms", "action": "wrap"}]},
			{"positions": [{"x": 8, "y": 0, "active_part": "upper_arms", "action": "hold"}, {"x": 16, "y": 0, "active_part": "upper_arms", "action": "hold"}]},
			{"positions": [{"x": 4, "y": 0, "active_part": "upper_arms", "action": "release"}, {"x": 20, "y": 0, "action": "step_back"}]},
		],
	}
	_templates["dig"] = {
		"name": "dig", "frame_duration": 0.2,
		"frames": [
			{"positions": [{"x": 0, "y": 0, "active_part": "main_hand", "action": "raise_tool"}]},
			{"positions": [{"x": 0, "y": 4, "active_part": "main_hand", "action": "strike_ground"}]},
			{"positions": [{"x": 0, "y": 2, "active_part": "main_hand", "action": "scoop"}]},
			{"positions": [{"x": 0, "y": 0, "active_part": "main_hand", "action": "toss"}]},
		],
	}
	_templates["cast_spell"] = {
		"name": "cast_spell", "frame_duration": 0.25,
		"frames": [
			{"positions": [{"x": 0, "y": 0, "active_part": "hands", "action": "gather_energy"}]},
			{"positions": [{"x": 0, "y": -4, "active_part": "hands", "action": "channel"}]},
			{"positions": [{"x": 4, "y": -4, "active_part": "hands", "action": "release"}]},
			{"positions": [{"x": 0, "y": 0, "active_part": "hands", "action": "recover"}]},
		],
	}
