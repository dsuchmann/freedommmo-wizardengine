class_name DeathRespawn
extends RefCounted

signal entity_died(entity_id: int, cause: String, world_x: int, world_y: int)
signal player_respawned(world_x: int, world_y: int)

var _respawn_point := Vector2i(64, 64)
var _death_penalty_time: float = 500.0
var _death_penalty_xp: float = 0.1

func set_respawn_point(x: int, y: int) -> void:
	_respawn_point = Vector2i(x, y)

func process_death(entity: EntityBody, cause: String, world_x: int, world_y: int) -> Dictionary:
	entity_died.emit(entity.entity_id, cause, world_x, world_y)

	var result := {
		"entity_id": entity.entity_id,
		"name": entity.name,
		"cause": cause,
		"time_lost": 0.0,
		"respawn_x": _respawn_point.x,
		"respawn_y": _respawn_point.y,
	}

	if entity.entity_id == 0:
		result["time_lost"] = _death_penalty_time
		entity.time_pool = maxf(0.0, entity.time_pool - _death_penalty_time)
		entity.base_stats["health"] = entity.base_stats.get("max_health", 100.0) * 0.5
		entity.base_stats["stamina"] = entity.base_stats.get("stamina", 100.0) * 0.5

		var grief := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.GRIEF)
		grief.intensity = 0.4
		grief.salience = 0.6
		entity.mind.add(grief)

		var memory := InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
		memory.intensity = 0.7
		memory.context = {"type": "death", "cause": cause, "location_x": world_x, "location_y": world_y}
		memory.decay_rate = 0.002
		entity.mind.add(memory)

		player_respawned.emit(_respawn_point.x, _respawn_point.y)

	return result

func is_dead(entity: EntityBody) -> bool:
	return entity.base_stats.get("health", 0) <= 0 or entity.time_pool <= 0

func get_death_cause(entity: EntityBody) -> String:
	if entity.base_stats.get("health", 0) <= 0:
		return "combat"
	if entity.time_pool <= 0:
		return "time_expired"
	return "unknown"
