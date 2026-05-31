class_name WorldGraph
extends RefCounted

var cells: Dictionary = {}
var _active_cell_ids: Array = []

func get_cell(cell_x: int, cell_y: int):
	var key := _cell_key(cell_x, cell_y)
	return cells.get(key)

func get_or_create_cell(cell_x: int, cell_y: int):
	var key := _cell_key(cell_x, cell_y)
	if not cells.has(key):
		cells[key] = WorldCell.new(cell_x, cell_y)
	return cells[key]

func has_cell(cell_x: int, cell_y: int) -> bool:
	return cells.has(_cell_key(cell_x, cell_y))

func load_cell(cell_x: int, cell_y: int, registry: GrainRegistry, biome: String = "grassland") -> WorldCell:
	var cell = get_or_create_cell(cell_x, cell_y)
	if not cell.is_loaded():
		cell.populate_from_registry(registry, biome)
		if not _active_cell_ids.has(cell.cell_id):
			_active_cell_ids.append(cell.cell_id)
	return cell

func unload_cell(cell_x: int, cell_y: int) -> void:
	var key := _cell_key(cell_x, cell_y)
	if cells.has(key):
		var cell: WorldCell = cells[key]
		_active_cell_ids.erase(cell.cell_id)
		cells.erase(key)

func get_adjacent_cells(cell_x: int, cell_y: int) -> Array:
	var adjacent: Array = []
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			if dx == 0 and dy == 0:
				continue
			var cell = get_cell(cell_x + dx, cell_y + dy)
			if cell:
				adjacent.append(cell)
	return adjacent

func get_cells_in_radius(center_x: int, center_y: int, radius: int) -> Array:
	var result: Array = []
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			var cell = get_cell(center_x + dx, center_y + dy)
			if cell:
				result.append(cell)
	return result

func get_stack_at_world_pos(world_x: int, world_y: int):
	var cell_x := world_x / WorldCell.CELL_SIZE
	var cell_y := world_y / WorldCell.CELL_SIZE
	var local_x := world_x % WorldCell.CELL_SIZE
	var local_y := world_y % WorldCell.CELL_SIZE
	if local_x < 0:
		local_x += WorldCell.CELL_SIZE
		cell_x -= 1
	if local_y < 0:
		local_y += WorldCell.CELL_SIZE
		cell_y -= 1
	var cell = get_cell(cell_x, cell_y)
	if cell:
		return cell.get_grain_stack(local_x, local_y)
	return null

func cell_count() -> int:
	return cells.size()

func active_cell_count() -> int:
	return _active_cell_ids.size()

func _cell_key(cell_x: int, cell_y: int) -> int:
	return cell_x * 100000 + cell_y
