extends SceneTree

var _pass_count: int = 0
var _fail_count: int = 0

func _init() -> void:
	print("=== World State Graph Runtime Tests ===")
	test_world_cell_creation()
	test_world_cell_stacks()
	test_world_cell_populate()
	test_world_graph_cells()
	test_world_graph_adjacency()
	test_world_graph_world_pos()
	print("=== Results: %d passed, %d failed ===" % [_pass_count, _fail_count])
	quit(1 if _fail_count > 0 else 0)

func test_world_cell_creation() -> void:
	var cell := WorldCell.new(3, 5)
	_assert(cell.cell_x == 3, "cell_x == 3")
	_assert(cell.cell_y == 5, "cell_y == 5")
	_assert(cell.stack_count() == 0, "empty cell has 0 stacks")
	_assert(!cell.is_loaded(), "new cell not loaded")

func test_world_cell_stacks() -> void:
	var cell := WorldCell.new(0, 0)
	var stack := GrainStack.new()
	stack.push(Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS))
	cell.set_stack(10, 20, stack)
	_assert(cell.has_stack(10, 20), "cell has stack at 10,20")
	_assert(!cell.has_stack(0, 0), "cell has no stack at 0,0")
	var retrieved = cell.get_grain_stack(10, 20)
	_assert(retrieved != null, "retrieved stack not null")
	_assert(retrieved.top().grain_type == GrainTypes.Physical.GRASS, "retrieved top is grass")

func test_world_cell_populate() -> void:
	var reg := GrainRegistry.new()
	reg.load_templates("res://data/grains/physical_grains.json")
	var cell := WorldCell.new(0, 0)
	cell.populate_from_registry(reg, "desert")
	_assert(cell.is_loaded(), "cell loaded after populate")
	_assert(cell.stack_count() == 128 * 128, "cell has 128x128 stacks")
	_assert(cell.biome == "desert", "biome is desert")
	var s = cell.get_grain_stack(64, 64)
	_assert(s != null, "center stack exists")
	_assert(s.top().grain_type == GrainTypes.Physical.SAND, "desert top is sand")

func test_world_graph_cells() -> void:
	var graph := WorldGraph.new()
	_assert(graph.cell_count() == 0, "empty graph")
	var cell := graph.get_or_create_cell(1, 2)
	_assert(cell != null, "created cell")
	_assert(graph.cell_count() == 1, "1 cell")
	_assert(graph.has_cell(1, 2), "has cell 1,2")
	_assert(!graph.has_cell(0, 0), "no cell 0,0")

func test_world_graph_adjacency() -> void:
	var graph := WorldGraph.new()
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			graph.get_or_create_cell(5 + dx, 5 + dy)
	var adj := graph.get_adjacent_cells(5, 5)
	_assert(adj.size() == 8, "8 adjacent cells")

func test_world_graph_world_pos() -> void:
	var reg := GrainRegistry.new()
	reg.load_templates("res://data/grains/physical_grains.json")
	var graph := WorldGraph.new()
	graph.load_cell(0, 0, reg, "grassland")
	var stack = graph.get_stack_at_world_pos(64, 64)
	_assert(stack != null, "stack at world pos 64,64")
	_assert(stack.top().grain_type == GrainTypes.Physical.GRASS, "world pos top is grass")

func _assert(condition: bool, message: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		push_error("FAIL: %s" % message)
