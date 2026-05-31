extends SceneTree

var _pass_count: int = 0
var _fail_count: int = 0

func _init() -> void:
	print("=== Simulation Engine Runtime Tests ===")
	test_tick()
	test_dig()
	test_dig_bedrock()
	test_dig_too_hard()
	test_burn()
	test_burn_not_flammable()
	test_freeze_water()
	test_interaction_queue()
	print("=== Results: %d passed, %d failed ===" % [_pass_count, _fail_count])
	quit(1 if _fail_count > 0 else 0)

func _setup() -> SimEngine:
	var reg := GrainRegistry.new()
	reg.load_templates("res://data/grains/physical_grains.json")
	var mat := MaterialRegistry.new(reg)
	var world := WorldGraph.new()
	world.load_cell(0, 0, reg, "grassland")
	return SimEngine.new(world, mat)

func test_tick() -> void:
	var sim := _setup()
	_assert(sim.get_tick_count() == 0, "initial tick 0")
	sim.tick(0.1)
	_assert(sim.get_tick_count() == 1, "tick 1 after tick()")
	sim.tick(0.1)
	_assert(sim.get_tick_count() == 2, "tick 2")

func test_dig() -> void:
	var sim := _setup()
	var result := sim.process_dig(64, 64, 0.5)
	_assert(result["success"] == true, "dig success")
	_assert(result.has("removed"), "dig has removed grain")

func test_dig_bedrock() -> void:
	var sim := _setup()
	for i in range(10):
		sim.process_dig(64, 64, 1.0)
	var stack = sim.world.get_stack_at_world_pos(64, 64)
	_assert(stack.size() >= 1, "can't dig past last layer")

func test_dig_too_hard() -> void:
	var sim := _setup()
	for i in range(3):
		sim.process_dig(64, 64, 1.0)
	var result := sim.process_dig(64, 64, 0.01)
	_assert(result["success"] == false, "too weak to dig stone/bedrock")

func test_burn() -> void:
	var sim := _setup()
	var result := sim.process_burn(64, 64, 500.0)
	_assert(result["success"] == true, "burn grass success")
	_assert(result["produced"] == "ash", "burn produces ash")
	var stack = sim.world.get_stack_at_world_pos(64, 64)
	_assert(stack.top().grain_type == GrainTypes.Physical.ASH, "top is now ash")

func test_burn_not_flammable() -> void:
	var sim := _setup()
	for i in range(3):
		sim.process_dig(64, 64, 1.0)
	var result := sim.process_burn(64, 64, 500.0)
	_assert(result["success"] == false, "can't burn stone")

func test_freeze_water() -> void:
	var reg := GrainRegistry.new()
	reg.load_templates("res://data/grains/physical_grains.json")
	var world := WorldGraph.new()
	world.load_cell(0, 0, reg, "ocean")
	var sim := SimEngine.new(world, MaterialRegistry.new(reg))
	var result := sim.process_freeze(64, 64, 20.0)
	_assert(result["success"] == true, "freeze water success")
	var stack = sim.world.get_stack_at_world_pos(64, 64)
	_assert(stack.top().grain_type == GrainTypes.Physical.ICE, "water became ice")

func test_interaction_queue() -> void:
	var sim := _setup()
	sim.queue_interaction({"action": "dig", "world_x": 64, "world_y": 64, "strength": 0.5})
	sim.queue_interaction({"action": "burn", "world_x": 65, "world_y": 65, "heat": 500.0})
	_assert(sim.get_tick_count() == 0, "no ticks yet")
	sim.tick(0.1)
	_assert(sim.get_tick_count() == 1, "tick processed")

func _assert(condition: bool, message: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		push_error("FAIL: %s" % message)
