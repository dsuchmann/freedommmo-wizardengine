class_name WalkabilityGrid
extends RefCounted

## Spatial walkability system for the game world.
## Maps world positions to movement costs.
## -1.0 = impassable, 0.5 = path (fast), 1.0 = normal, 3.0+ = difficult

var _costs: Dictionary = {}
var _structure_overrides: Dictionary = {}

func set_cost(world_x: int, world_y: int, cost: float) -> void:
	var key = Vector2i(world_x, world_y)
	_costs[key] = cost

func set_cost_v(pos: Vector2i, cost: float) -> void:
	_costs[pos] = cost

func get_cost(world_x: int, world_y: int) -> float:
	var key = Vector2i(world_x, world_y)
	# Structure overrides take priority (walls, doors, floors)
	if _structure_overrides.has(key):
		return _structure_overrides[key]
	# Default to walkable (1.0) if no terrain data — fail open
	return _costs.get(key, 1.0)

func has_data(world_x: int, world_y: int) -> bool:
	var key = Vector2i(world_x, world_y)
	return _costs.has(key) or _structure_overrides.has(key)

func get_cost_v(pos: Vector2i) -> float:
	if _structure_overrides.has(pos):
		return _structure_overrides[pos]
	return _costs.get(pos, 1.0)

func is_walkable(world_x: int, world_y: int) -> bool:
	return get_cost(world_x, world_y) >= 0.0

func is_walkable_v(pos: Vector2i) -> bool:
	return get_cost_v(pos) >= 0.0

func can_move_to(world_x: int, world_y: int) -> bool:
	return is_walkable(world_x, world_y)

func get_movement_multiplier(world_x: int, world_y: int) -> float:
	var cost = get_cost(world_x, world_y)
	if cost <= 0.0:
		return 0.0
	# Lower cost = faster movement. cost=0.5 → mult=1.5, cost=1.0 → mult=1.0, cost=3.0 → mult=0.33
	return 1.0 / cost

## Stamp a structure footprint onto the grid
## wall_positions: Array of Vector2i (blocked)
## floor_positions: Array of Vector2i (walkable interior)
## door_positions: Array of Vector2i (walkable entrance)
func stamp_structure(wall_positions: Array, floor_positions: Array, door_positions: Array) -> void:
	for pos in wall_positions:
		_structure_overrides[pos] = -1.0
	for pos in floor_positions:
		_structure_overrides[pos] = 1.0
	for pos in door_positions:
		_structure_overrides[pos] = 0.8

func remove_structure_stamp(positions: Array) -> void:
	for pos in positions:
		_structure_overrides.erase(pos)

## Populate walkability from a terrain cell's grain stacks
func populate_from_cell(cell, grain_types_class) -> void:
	if cell == null:
		return
	var base_x = cell.cell_x * cell.CELL_SIZE
	var base_y = cell.cell_y * cell.CELL_SIZE
	for y in range(cell.CELL_SIZE):
		for x in range(cell.CELL_SIZE):
			var stack = cell.get_grain_stack(x, y)
			if stack == null or stack.top() == null:
				set_cost(base_x + x, base_y + y, 1.0)
				continue
			var grain_type = stack.top().grain_type
			var cost = _grain_type_to_cost(grain_type, grain_types_class)
			set_cost(base_x + x, base_y + y, cost)

func _grain_type_to_cost(grain_type: int, gt) -> float:
	# Water and lava are impassable
	if grain_type == gt.Physical.WATER:
		return -1.0
	if grain_type == gt.Physical.LAVA:
		return -1.0
	if grain_type == gt.Physical.ICE:
		return 1.8
	# Deep water variants
	if grain_type == gt.Physical.CORAL:
		return -1.0
	# Rocky/difficult terrain
	if grain_type == gt.Physical.STONE:
		return 1.5
	if grain_type == gt.Physical.GRANITE:
		return 2.0
	if grain_type == gt.Physical.BEDROCK:
		return -1.0
	if grain_type == gt.Physical.OBSIDIAN:
		return 2.5
	# Sand/mud slow you down
	if grain_type == gt.Physical.SAND:
		return 1.3
	if grain_type == gt.Physical.MUD:
		return 2.0
	if grain_type == gt.Physical.GRAVEL:
		return 1.2
	if grain_type == gt.Physical.SNOW:
		return 1.5
	# Vegetation is normal or slightly slow
	if grain_type == gt.Physical.VINE:
		return 1.3
	if grain_type == gt.Physical.MUSHROOM:
		return 1.1
	# Paths are fast
	if grain_type == gt.Physical.CLAY:
		return 1.1
	# Everything else (grass, soil, etc.) is normal
	return 1.0

## Set path cost for specific positions (used by village path network)
func set_path(world_x: int, world_y: int) -> void:
	set_cost(world_x, world_y, 0.5)

func cell_count() -> int:
	return _costs.size()

func override_count() -> int:
	return _structure_overrides.size()
