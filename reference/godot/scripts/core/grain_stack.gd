class_name GrainStack
extends RefCounted

## Depth-sorted list of grains at a world position
## Index 0 = top (surface), last index = bottom (deepest)
var layers: Array = []

## World position this stack occupies
var world_x: int = 0
var world_y: int = 0
var cell_id: int = 0

func size() -> int:
	return layers.size()

func top() -> Grain:
	if layers.is_empty():
		return null
	return layers[0]

func bottom() -> Grain:
	if layers.is_empty():
		return null
	return layers[layers.size() - 1]

func push(grain: Grain) -> void:
	## Add grain to top of stack (surface)
	layers.insert(0, grain)
	_recalculate_depths()

func push_bottom(grain: Grain) -> void:
	## Add grain to bottom of stack (deepest)
	layers.append(grain)
	_recalculate_depths()

func pop_top() -> Grain:
	## Remove and return top grain (digging)
	if layers.is_empty():
		return null
	var removed: Grain = layers[0]
	layers.remove_at(0)
	_recalculate_depths()
	return removed

func get_at_depth(depth_index: int) -> Grain:
	if depth_index < 0 or depth_index >= layers.size():
		return null
	return layers[depth_index]

func get_visible_grains() -> Array:
	## Returns grains visible from above (stops at first fully opaque grain)
	var visible: Array = []
	var accumulated_opacity := 0.0
	for grain in layers:
		visible.append(grain)
		accumulated_opacity += grain.properties.opacity * grain.quantity
		if accumulated_opacity >= 1.0:
			break
	return visible

func get_total_hardness() -> float:
	## Surface hardness for interaction calculations
	if layers.is_empty():
		return 0.0
	return top().properties.hardness

func has_grain_type(p_category: int, p_grain_type: int) -> bool:
	for grain in layers:
		if grain.category == p_category and grain.grain_type == p_grain_type:
			return true
	return false

func _recalculate_depths() -> void:
	var current_depth := 0.0
	for grain in layers:
		grain.properties.depth = current_depth
		current_depth += grain.quantity

func to_dict() -> Dictionary:
	var layer_dicts: Array = []
	for grain in layers:
		layer_dicts.append(grain.to_dict())
	return {
		"world_x": world_x,
		"world_y": world_y,
		"cell_id": cell_id,
		"layers": layer_dicts,
	}

static func from_dict(d: Dictionary) -> GrainStack:
	var stack := GrainStack.new()
	stack.world_x = int(d.get("world_x", 0))
	stack.world_y = int(d.get("world_y", 0))
	stack.cell_id = int(d.get("cell_id", 0))
	for layer_dict in d.get("layers", []):
		stack.layers.append(Grain.from_dict(layer_dict))
	stack._recalculate_depths()
	return stack
