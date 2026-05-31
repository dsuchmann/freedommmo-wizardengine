class_name WorldCell
extends RefCounted

const CELL_SIZE: int = 128

var cell_id: int = 0
var cell_x: int = 0
var cell_y: int = 0
var biome: String = "grassland"
var stacks: Dictionary = {}
var heights: PackedFloat32Array = PackedFloat32Array()
var _loaded: bool = false

func _init(p_x: int = 0, p_y: int = 0) -> void:
	cell_x = p_x
	cell_y = p_y
	cell_id = p_x * 10000 + p_y

func get_grain_stack(x: int, y: int):
	var key := x * CELL_SIZE + y
	return stacks.get(key)

func set_stack(x: int, y: int, stack: GrainStack) -> void:
	var key := x * CELL_SIZE + y
	stack.world_x = cell_x * CELL_SIZE + x
	stack.world_y = cell_y * CELL_SIZE + y
	stack.cell_id = cell_id
	stacks[key] = stack

func has_stack(x: int, y: int) -> bool:
	return stacks.has(x * CELL_SIZE + y)

func set_height(x: int, y: int, h: float) -> void:
	var idx = y * CELL_SIZE + x
	if heights.size() == 0:
		heights.resize(CELL_SIZE * CELL_SIZE)
	if idx >= 0 and idx < heights.size():
		heights[idx] = h

func get_height(x: int, y: int) -> float:
	var idx = y * CELL_SIZE + x
	if heights.size() == 0 or idx < 0 or idx >= heights.size():
		return 0.5
	return heights[idx]

func populate_from_registry(registry: GrainRegistry, p_biome: String = "") -> void:
	if not p_biome.is_empty():
		biome = p_biome
	for y in range(CELL_SIZE):
		for x in range(CELL_SIZE):
			if not has_stack(x, y):
				set_stack(x, y, registry.create_terrain_stack(biome))
	_loaded = true

func is_loaded() -> bool:
	return _loaded

func stack_count() -> int:
	return stacks.size()

func get_top_grain_type_grid() -> PackedInt32Array:
	var grid := PackedInt32Array()
	grid.resize(CELL_SIZE * CELL_SIZE)
	for y in range(CELL_SIZE):
		for x in range(CELL_SIZE):
			var stack = get_grain_stack(x, y)
			if stack != null and stack.top() != null:
				grid[y * CELL_SIZE + x] = stack.top().grain_type
			else:
				grid[y * CELL_SIZE + x] = -1
	return grid

func to_dict() -> Dictionary:
	var stack_dicts := {}
	for key in stacks:
		stack_dicts[str(key)] = stacks[key].to_dict()
	return {
		"cell_id": cell_id, "cell_x": cell_x, "cell_y": cell_y,
		"biome": biome, "loaded": _loaded, "stacks": stack_dicts,
	}

static func from_dict(d: Dictionary) -> WorldCell:
	var cell := WorldCell.new(int(d.get("cell_x", 0)), int(d.get("cell_y", 0)))
	cell.biome = d.get("biome", "grassland")
	cell._loaded = d.get("loaded", false)
	for key in d.get("stacks", {}):
		cell.stacks[int(key)] = GrainStack.from_dict(d["stacks"][key])
	return cell
