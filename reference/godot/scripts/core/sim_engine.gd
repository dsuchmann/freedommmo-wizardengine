class_name SimEngine
extends RefCounted

signal tick_completed(tick_number: int, delta: float)
signal interaction_processed(result: Dictionary)

var world: WorldGraph
var material_registry: MaterialRegistry
var _tick_count: int = 0
var _interaction_queue: Array = []
var _propagation_rules: Array = []
var tick_rate: float = 1.0 / 10.0

func _init(p_world: WorldGraph = null, p_materials: MaterialRegistry = null) -> void:
	world = p_world if p_world else WorldGraph.new()
	material_registry = p_materials if p_materials else MaterialRegistry.new()
	_init_propagation_rules()

func tick(delta: float) -> void:
	_tick_count += 1
	_process_interactions()
	_process_propagation(delta)
	tick_completed.emit(_tick_count, delta)

func queue_interaction(interaction: Dictionary) -> void:
	_interaction_queue.append(interaction)

func get_tick_count() -> int:
	return _tick_count

func process_dig(world_x: int, world_y: int, strength: float) -> Dictionary:
	var stack = world.get_stack_at_world_pos(world_x, world_y)
	if stack == null:
		return {"success": false, "reason": "no_stack"}
	if stack.size() <= 1:
		return {"success": false, "reason": "bedrock"}
	var surface = stack.top()
	if surface.properties.hardness > strength:
		return {"success": false, "reason": "too_hard", "hardness": surface.properties.hardness}
	var removed = stack.pop_top()
	return {"success": true, "removed": removed.to_dict(), "new_surface": stack.top().to_dict() if stack.top() else {}}

func process_burn(world_x: int, world_y: int, heat: float) -> Dictionary:
	var stack = world.get_stack_at_world_pos(world_x, world_y)
	if stack == null:
		return {"success": false, "reason": "no_stack"}
	var surface = stack.top()
	if surface == null:
		return {"success": false, "reason": "empty"}
	if surface.properties.flammability <= 0.0:
		return {"success": false, "reason": "not_flammable"}
	if heat < (1.0 - surface.properties.flammability) * 500.0:
		return {"success": false, "reason": "not_hot_enough"}
	var removed = stack.pop_top()
	var ash := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.ASH)
	ash.quantity = removed.quantity * 0.3
	stack.push(ash)
	return {"success": true, "burned": removed.to_dict(), "produced": "ash"}

func process_freeze(world_x: int, world_y: int, cold: float) -> Dictionary:
	var stack = world.get_stack_at_world_pos(world_x, world_y)
	if stack == null:
		return {"success": false, "reason": "no_stack"}
	var surface = stack.top()
	if surface == null:
		return {"success": false, "reason": "empty"}
	if surface.grain_type == GrainTypes.Physical.WATER:
		var ice := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.ICE)
		ice.quantity = surface.quantity
		ice.properties.temperature = -cold
		stack.pop_top()
		stack.push(ice)
		return {"success": true, "froze": "water_to_ice"}
	surface.properties.temperature = maxf(surface.properties.temperature - cold, -50.0)
	return {"success": true, "cooled_to": surface.properties.temperature}

func _process_interactions() -> void:
	while not _interaction_queue.is_empty():
		var interaction: Dictionary = _interaction_queue.pop_front()
		var action: String = interaction.get("action", "")
		var wx: int = interaction.get("world_x", 0)
		var wy: int = interaction.get("world_y", 0)
		var result: Dictionary
		match action:
			"dig":
				result = process_dig(wx, wy, interaction.get("strength", 0.5))
			"burn":
				result = process_burn(wx, wy, interaction.get("heat", 100.0))
			"freeze":
				result = process_freeze(wx, wy, interaction.get("cold", 10.0))
			_:
				result = {"success": false, "reason": "unknown_action"}
		result["action"] = action
		result["tick"] = _tick_count
		interaction_processed.emit(result)

func _process_propagation(delta: float) -> void:
	pass

func _init_propagation_rules() -> void:
	pass
