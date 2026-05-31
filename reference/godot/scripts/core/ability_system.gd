class_name AbilitySystem
extends RefCounted

signal ability_used(entity_id: int, ability_name: String, result: Dictionary)
signal ability_learned(entity_id: int, ability_name: String)

var _ability_templates: Dictionary = {}
var _entity_abilities: Dictionary = {}
var _cooldowns: Dictionary = {}

func _init() -> void:
	_init_abilities()

func learn_ability(entity_id: int, ability_name: String) -> bool:
	if not _ability_templates.has(ability_name):
		return false
	if not _entity_abilities.has(entity_id):
		_entity_abilities[entity_id] = []
	if ability_name in _entity_abilities[entity_id]:
		return false
	_entity_abilities[entity_id].append(ability_name)
	ability_learned.emit(entity_id, ability_name)
	return true

func use_ability(entity: EntityBody, ability_name: String, target = null) -> Dictionary:
	if not has_ability(entity.entity_id, ability_name):
		return {"success": false, "reason": "not_learned"}
	var template: Dictionary = _ability_templates[ability_name]

	# Check cooldown
	var cd_key := "%d_%s" % [entity.entity_id, ability_name]
	if _cooldowns.has(cd_key) and _cooldowns[cd_key] > 0:
		return {"success": false, "reason": "on_cooldown", "remaining": _cooldowns[cd_key]}

	# Check stamina/mana cost
	var stats = entity.get_computed_stats()
	var cost_type: String = template.get("cost_type", "stamina")
	var cost_amount: float = template.get("cost", 10.0)
	if stats.get(cost_type, 0) < cost_amount:
		return {"success": false, "reason": "insufficient_%s" % cost_type}

	# Apply cost
	entity.base_stats[cost_type] -= cost_amount

	# Set cooldown
	_cooldowns[cd_key] = template.get("cooldown", 5.0)

	# Calculate effect
	var result := _calculate_effect(entity, template, target)
	result["success"] = true
	result["ability"] = ability_name

	ability_used.emit(entity.entity_id, ability_name, result)
	return result

func has_ability(entity_id: int, ability_name: String) -> bool:
	return _entity_abilities.has(entity_id) and ability_name in _entity_abilities[entity_id]

func get_abilities(entity_id: int) -> Array:
	return _entity_abilities.get(entity_id, [])

func tick_cooldowns(delta: float) -> void:
	for key in _cooldowns:
		_cooldowns[key] = maxf(0.0, _cooldowns[key] - delta)

func _calculate_effect(entity: EntityBody, template: Dictionary, target) -> Dictionary:
	var stats = entity.get_computed_stats()
	var effect_type: String = template.get("effect_type", "damage")
	var base_power: float = template.get("base_power", 10.0)
	var scaling_stat: String = template.get("scaling_stat", "strength")
	var scaling: float = template.get("scaling", 0.5)

	var total_power = base_power + stats.get(scaling_stat, 10.0) * scaling

	match effect_type:
		"damage":
			return {"type": "damage", "amount": total_power, "element": template.get("element", "physical")}
		"heal":
			if target and target is EntityBody:
				target.base_stats["health"] = minf(
					target.base_stats["health"] + total_power,
					target.base_stats.get("max_health", 100.0))
			return {"type": "heal", "amount": total_power}
		"buff":
			return {"type": "buff", "stat": template.get("buff_stat", "strength"), "amount": total_power * 0.1, "duration": template.get("duration", 30.0)}
		"terrain":
			return {"type": "terrain", "action": template.get("terrain_action", "dig"), "power": total_power}
		_:
			return {"type": effect_type, "power": total_power}

func _init_abilities() -> void:
	_ability_templates["power_strike"] = {
		"name": "Power Strike", "description": "A powerful melee attack",
		"effect_type": "damage", "base_power": 15.0, "scaling_stat": "strength", "scaling": 0.8,
		"cost_type": "stamina", "cost": 15.0, "cooldown": 3.0, "element": "physical",
	}
	_ability_templates["quick_slash"] = {
		"name": "Quick Slash", "description": "Fast but weaker attack",
		"effect_type": "damage", "base_power": 8.0, "scaling_stat": "dexterity", "scaling": 0.6,
		"cost_type": "stamina", "cost": 8.0, "cooldown": 1.5, "element": "physical",
	}
	_ability_templates["fireball"] = {
		"name": "Fireball", "description": "Launches a ball of fire",
		"effect_type": "damage", "base_power": 25.0, "scaling_stat": "intelligence", "scaling": 1.0,
		"cost_type": "mana", "cost": 20.0, "cooldown": 5.0, "element": "fire",
	}
	_ability_templates["heal"] = {
		"name": "Heal", "description": "Restores health",
		"effect_type": "heal", "base_power": 20.0, "scaling_stat": "wisdom", "scaling": 0.8,
		"cost_type": "mana", "cost": 15.0, "cooldown": 8.0,
	}
	_ability_templates["shield_bash"] = {
		"name": "Shield Bash", "description": "Stun with shield",
		"effect_type": "damage", "base_power": 10.0, "scaling_stat": "constitution", "scaling": 0.5,
		"cost_type": "stamina", "cost": 20.0, "cooldown": 6.0, "element": "physical",
	}
	_ability_templates["earth_shatter"] = {
		"name": "Earth Shatter", "description": "Breaks terrain beneath target",
		"effect_type": "terrain", "base_power": 30.0, "scaling_stat": "strength", "scaling": 0.7,
		"cost_type": "stamina", "cost": 25.0, "cooldown": 10.0, "terrain_action": "dig",
	}
	_ability_templates["ice_bolt"] = {
		"name": "Ice Bolt", "description": "Freezes water and slows targets",
		"effect_type": "damage", "base_power": 18.0, "scaling_stat": "intelligence", "scaling": 0.7,
		"cost_type": "mana", "cost": 12.0, "cooldown": 4.0, "element": "ice",
	}
	_ability_templates["time_drain"] = {
		"name": "Time Drain", "description": "Steals time from target",
		"effect_type": "damage", "base_power": 5.0, "scaling_stat": "wisdom", "scaling": 1.2,
		"cost_type": "mana", "cost": 30.0, "cooldown": 15.0, "element": "temporal",
	}
