class_name ParticleEffects
extends RefCounted

var _effect_configs: Dictionary = {}

func _init() -> void:
	_init_configs()

func get_config(effect_name: String) -> Dictionary:
	return _effect_configs.get(effect_name, {})

func create_particle_params(effect_name: String) -> Dictionary:
	var config: Dictionary = _effect_configs.get(effect_name, {})
	return {
		"amount": config.get("amount", 10),
		"lifetime": config.get("lifetime", 1.0),
		"speed": config.get("speed", 50.0),
		"color": config.get("color", Color.WHITE),
		"size": config.get("size", 2.0),
		"gravity": config.get("gravity", 0.0),
		"spread": config.get("spread", 180.0),
		"emitting": true,
	}

func _init_configs() -> void:
	_effect_configs["hit_physical"] = {
		"amount": 8, "lifetime": 0.3, "speed": 80.0,
		"color": Color(0.8, 0.2, 0.2), "size": 2.0, "spread": 90.0,
	}
	_effect_configs["hit_magic"] = {
		"amount": 15, "lifetime": 0.5, "speed": 60.0,
		"color": Color(0.3, 0.5, 1.0), "size": 3.0, "spread": 180.0,
	}
	_effect_configs["heal"] = {
		"amount": 12, "lifetime": 0.8, "speed": 30.0,
		"color": Color(0.3, 1.0, 0.3), "size": 2.5, "gravity": -20.0, "spread": 60.0,
	}
	_effect_configs["fire"] = {
		"amount": 20, "lifetime": 0.6, "speed": 40.0,
		"color": Color(1.0, 0.5, 0.1), "size": 3.0, "gravity": -30.0, "spread": 45.0,
	}
	_effect_configs["ice"] = {
		"amount": 10, "lifetime": 0.7, "speed": 50.0,
		"color": Color(0.6, 0.8, 1.0), "size": 2.0, "spread": 120.0,
	}
	_effect_configs["dig"] = {
		"amount": 6, "lifetime": 0.4, "speed": 70.0,
		"color": Color(0.5, 0.35, 0.2), "size": 2.5, "gravity": 50.0, "spread": 90.0,
	}
	_effect_configs["loot_sparkle"] = {
		"amount": 5, "lifetime": 1.0, "speed": 20.0,
		"color": Color(1.0, 0.9, 0.3), "size": 1.5, "gravity": -10.0, "spread": 360.0,
	}
	_effect_configs["death"] = {
		"amount": 25, "lifetime": 1.0, "speed": 40.0,
		"color": Color(0.3, 0.1, 0.1), "size": 2.0, "spread": 360.0,
	}
	_effect_configs["level_up"] = {
		"amount": 30, "lifetime": 1.5, "speed": 50.0,
		"color": Color(1.0, 1.0, 0.5), "size": 3.0, "gravity": -40.0, "spread": 360.0,
	}
	_effect_configs["rain"] = {
		"amount": 100, "lifetime": 0.5, "speed": 200.0,
		"color": Color(0.5, 0.6, 0.8, 0.4), "size": 1.0, "gravity": 300.0, "spread": 10.0,
	}
	_effect_configs["snow"] = {
		"amount": 50, "lifetime": 3.0, "speed": 30.0,
		"color": Color(0.95, 0.95, 1.0, 0.7), "size": 2.0, "gravity": 20.0, "spread": 60.0,
	}
