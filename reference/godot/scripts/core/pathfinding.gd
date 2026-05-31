class_name Pathfinding
extends RefCounted

const DIRECTIONS := [
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
	Vector2i(1, 1), Vector2i(-1, 1), Vector2i(1, -1), Vector2i(-1, -1),
]

var walkability_grid: WalkabilityGrid

func find_path(world: WorldGraph, start: Vector2i, end: Vector2i, max_steps: int = 200) -> Array:
	if start == end:
		return [start]

	var open_set: Array = [start]
	var came_from: Dictionary = {}
	var g_score: Dictionary = {start: 0}
	var f_score: Dictionary = {start: _heuristic(start, end)}
	var closed: Dictionary = {}

	var steps := 0
	while not open_set.is_empty() and steps < max_steps:
		steps += 1

		# Find lowest f_score in open set
		var current: Vector2i = open_set[0]
		var lowest_f: float = f_score.get(current, 999999.0)
		for pos in open_set:
			var f: float = f_score.get(pos, 999999.0)
			if f < lowest_f:
				lowest_f = f
				current = pos

		if current == end:
			return _reconstruct_path(came_from, current)

		open_set.erase(current)
		closed[current] = true

		for dir in DIRECTIONS:
			var neighbor = current + dir
			if closed.has(neighbor):
				continue

			var move_cost := _get_movement_cost(world, neighbor)
			if move_cost < 0:
				continue

			var tentative_g: float = g_score.get(current, 999999.0) + move_cost
			if tentative_g < g_score.get(neighbor, 999999.0):
				came_from[neighbor] = current
				g_score[neighbor] = tentative_g
				f_score[neighbor] = tentative_g + _heuristic(neighbor, end)
				if neighbor not in open_set:
					open_set.append(neighbor)

	# No path found, return partial path toward goal
	if not came_from.is_empty():
		var best: Vector2i = start
		var best_dist: float = _heuristic(start, end)
		for pos in came_from:
			var dist := _heuristic(pos, end)
			if dist < best_dist:
				best_dist = dist
				best = pos
		return _reconstruct_path(came_from, best)

	return [start]

func _heuristic(a: Vector2i, b: Vector2i) -> float:
	return absf(a.x - b.x) + absf(a.y - b.y)

func _get_movement_cost(world: WorldGraph, pos: Vector2i) -> float:
	# Use walkability grid if available (single source of truth for movement costs)
	if walkability_grid:
		var cost = walkability_grid.get_cost_v(pos)
		return cost
	# Fallback to direct grain stack reading if no walkability grid
	var stack = world.get_stack_at_world_pos(pos.x, pos.y)
	if stack == null:
		return 1.0
	if stack.top() == null:
		return 1.0

	var grain_type: int = stack.top().grain_type
	match grain_type:
		GrainTypes.Physical.WATER:
			return 5.0
		GrainTypes.Physical.LAVA:
			return -1.0
		GrainTypes.Physical.STONE:
			return 1.5
		GrainTypes.Physical.SAND:
			return 1.3
		GrainTypes.Physical.MUD:
			return 2.0
		GrainTypes.Physical.ICE:
			return 1.8
		GrainTypes.Physical.SNOW:
			return 1.5
		_:
			return 1.0

func _reconstruct_path(came_from: Dictionary, current: Vector2i) -> Array:
	var path: Array = [current]
	while came_from.has(current):
		current = came_from[current]
		path.insert(0, current)
	return path

func get_direction_to(from: Vector2i, to: Vector2i) -> Vector2i:
	var dx := clampi(to.x - from.x, -1, 1)
	var dy := clampi(to.y - from.y, -1, 1)
	return Vector2i(dx, dy)
