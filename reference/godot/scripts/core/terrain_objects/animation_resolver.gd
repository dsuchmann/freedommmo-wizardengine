class_name AnimationResolver
extends RefCounted

## Resolves animation layers for terrain objects via priority stack.

var _registry: InteractionRegistry
var _catalog: ObjectCatalog


func _init(registry: InteractionRegistry, catalog: ObjectCatalog):
	_registry = registry
	_catalog = catalog


func resolve(instance: ObjectInstance, weather: Dictionary = {},
		time_of_day: float = 0.5) -> Array:
	## Returns array of animation layer dicts to composite.
	## Each: { interaction_id, blend_mode, intensity, loop, frames, duration_ms }
	var layers: Array = []
	var available = _get_available_interactions(instance)

	# Priority 1: Active effects
	for effect in instance.active_effects:
		if effect in available:
			var spec = _registry.get_animation_spec(effect)
			if not spec.is_empty():
				var blend = spec.get("blend_mode", "replace")
				layers.append({
					"interaction_id": effect,
					"blend_mode": blend,
					"intensity": 1.0,
					"loop": spec.get("loop", false),
					"frames": spec.get("frames", [4, 8]),
					"duration_ms": spec.get("duration_ms", [400, 800]),
				})
				if blend == "replace":
					return layers

	# Priority 2: State reactive
	var state_interactions = _get_state_reactive(instance, available)
	for si in state_interactions:
		var spec = _registry.get_animation_spec(si)
		if not spec.is_empty():
			var blend = spec.get("blend_mode", "replace")
			layers.append({
				"interaction_id": si,
				"blend_mode": blend,
				"intensity": 1.0,
				"loop": false,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [1000, 2000]),
			})
			if blend == "replace":
				return layers

	# Priority 3: Environmental
	var wind_speed = weather.get("wind_speed", 0.0)
	if wind_speed > 0.1 and "wind" in available:
		var spec = _registry.get_animation_spec("wind")
		if not spec.is_empty():
			layers.append({
				"interaction_id": "wind",
				"blend_mode": spec.get("blend_mode", "replace"),
				"intensity": clampf(wind_speed, 0.0, 1.0),
				"loop": true,
				"frames": spec.get("frames", [6, 10]),
				"duration_ms": spec.get("duration_ms", [600, 1200]),
			})

	var precip = weather.get("precipitation", 0.0)
	if precip > 0.1 and "rain" in available:
		var spec = _registry.get_animation_spec("rain")
		if not spec.is_empty():
			layers.append({
				"interaction_id": "rain",
				"blend_mode": spec.get("blend_mode", "overlay"),
				"intensity": clampf(precip, 0.0, 1.0),
				"loop": true,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [400, 800]),
			})

	# Priority 4: Ambient idle
	var has_replace = false
	for layer in layers:
		if layer.get("blend_mode", "") == "replace":
			has_replace = true
			break

	if not has_replace and "idle" in available:
		var spec = _registry.get_animation_spec("idle")
		if not spec.is_empty():
			layers.insert(0, {
				"interaction_id": "idle",
				"blend_mode": "replace",
				"intensity": 1.0,
				"loop": true,
				"frames": spec.get("frames", [4, 8]),
				"duration_ms": spec.get("duration_ms", [800, 1600]),
			})

	# Cap at base + 2 overlays
	if layers.size() > 3:
		layers.resize(3)

	return layers


func _get_available_interactions(instance: ObjectInstance) -> Array:
	return _catalog.get_interactions_for(instance.object_id, instance.lifecycle_phase)


func _get_state_reactive(instance: ObjectInstance, available: Array) -> Array:
	var reactive: Array = []
	var state_map = {
		"burning": "burn_ignite",
		"frozen": "freeze_cast",
		"chopped_stump": "chop",
		"dying": "wilt",
		"blooming": "bloom",
		"fruiting": "fruit",
		"cracked": "crack",
		"collapsing": "collapse",
		"decomposing": "decompose",
	}
	var mapped = state_map.get(instance.current_state, "")
	if mapped != "" and mapped in available:
		reactive.append(mapped)
	return reactive
