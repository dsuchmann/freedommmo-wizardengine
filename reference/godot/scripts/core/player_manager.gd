class_name PlayerManager
extends RefCounted

signal level_up(new_level: int)
signal gold_changed(new_amount: int)
signal time_critical(time_remaining: float)

var entity: EntityBody
var gold: int = 100
var level: int = 1
var experience: float = 0.0
var _xp_per_level: float = 100.0
var _time_warning_threshold: float = 1000.0
var _time_warned: bool = false

var skill_prog: SkillProgression
var discovery: DiscoverySystem
var entity_lifecycle: EntityLifecycle
var status_fx: StatusEffects

func _init(p_skill: SkillProgression = null, p_disc: DiscoverySystem = null,
		p_lifecycle: EntityLifecycle = null, p_status: StatusEffects = null) -> void:
	skill_prog = p_skill
	discovery = p_disc
	entity_lifecycle = p_lifecycle
	status_fx = p_status

func create_player(name: String, species: int) -> EntityBody:
	entity = EntityBody.new(0, species)
	entity.name = name
	entity.base_stats["attack"] = 15.0
	entity.base_stats["strength"] = 15.0
	entity.base_stats["defense"] = 5.0
	entity.base_stats["speed"] = 10.0
	entity.base_stats["health"] = 100.0
	entity.base_stats["max_health"] = 100.0
	entity.time_pool = 36000.0
	return entity

func gain_xp(amount: float) -> void:
	experience += amount
	while experience >= xp_to_next_level():
		experience -= xp_to_next_level()
		level += 1
		_apply_level_bonuses()
		level_up.emit(level)

func xp_to_next_level() -> float:
	return _xp_per_level * (1.0 + (level - 1) * 0.5)

func add_gold(amount: int) -> void:
	gold += amount
	gold_changed.emit(gold)

func spend_gold(amount: int) -> bool:
	if gold < amount:
		return false
	gold -= amount
	gold_changed.emit(gold)
	return true

func tick(delta: float) -> void:
	if entity == null:
		return
	# Natural time consumption — the core mechanic
	# Time drains constantly; rate increases with age
	var base_drain = 0.5  # base units per second
	if entity_lifecycle:
		var life_pct = entity_lifecycle.get_life_percentage(entity)
		base_drain *= 1.0 + life_pct  # elderly consume 2x
	entity.time_pool -= base_drain * delta

	# Apply status effect stat mods
	if status_fx:
		var mods = status_fx.get_stat_modifiers(entity.entity_id)
		if mods.has("health_drain"):
			entity.base_stats["health"] -= mods["health_drain"] * delta
		if mods.has("health_regen"):
			entity.base_stats["health"] = minf(
				entity.base_stats["health"] + mods["health_regen"] * delta,
				entity.base_stats.get("max_health", 100.0))
		if mods.has("time_drain"):
			entity.time_pool -= mods["time_drain"] * delta
		if mods.has("time_regen"):
			entity.time_pool += mods["time_regen"] * delta

	# Time critical warning
	if entity.time_pool < _time_warning_threshold and not _time_warned:
		_time_warned = true
		time_critical.emit(entity.time_pool)
	elif entity.time_pool >= _time_warning_threshold:
		_time_warned = false

func get_life_stage() -> String:
	if entity_lifecycle and entity:
		return entity_lifecycle.get_life_stage_name(entity)
	return "unknown"

func get_stat_summary() -> Dictionary:
	if entity == null:
		return {}
	var stats = entity.get_computed_stats()
	return {
		"name": entity.name,
		"level": level,
		"xp": experience,
		"xp_next": xp_to_next_level(),
		"gold": gold,
		"health": stats.get("health", 0),
		"max_health": stats.get("max_health", 100),
		"time_pool": entity.time_pool,
		"attack": stats.get("attack", 0),
		"defense": stats.get("defense", 0),
		"speed": stats.get("speed", 0),
		"life_stage": get_life_stage(),
	}

func _apply_level_bonuses() -> void:
	if entity == null:
		return
	entity.base_stats["max_health"] += 10.0
	entity.base_stats["health"] = entity.base_stats["max_health"]
	entity.base_stats["attack"] += 2.0
	entity.base_stats["defense"] += 1.0
	entity.base_stats["strength"] += 1.5
