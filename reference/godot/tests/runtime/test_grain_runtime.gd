extends SceneTree

var _pass_count: int = 0
var _fail_count: int = 0

func _init() -> void:
	print("=== Grain System Runtime Tests ===")

	test_grain_types()
	test_grain_properties()
	test_grain_creation()
	test_grain_serialization()
	test_grain_stack_operations()
	test_grain_stack_visibility()
	test_grain_stack_serialization()
	test_grain_registry()

	print("=== Results: %d passed, %d failed ===" % [_pass_count, _fail_count])
	quit(1 if _fail_count > 0 else 0)

func test_grain_types() -> void:
	_assert(GrainTypes.Category.PHYSICAL == 0, "PHYSICAL == 0")
	_assert(GrainTypes.Category.MAGICAL == 1, "MAGICAL == 1")
	_assert(GrainTypes.Category.SPIRITUAL == 2, "SPIRITUAL == 2")
	_assert(GrainTypes.Category.TECHNICAL == 3, "TECHNICAL == 3")
	_assert(GrainTypes.Physical.BEDROCK == 0, "BEDROCK == 0")
	_assert(GrainTypes.Physical.STONE == 1, "STONE == 1")
	_assert(GrainTypes.Physical.MITHRIL == 9, "MITHRIL == 9")

func test_grain_properties() -> void:
	var p := GrainProperties.new()
	_assert(p.hardness == 0.5, "default hardness 0.5")
	_assert(p.flammability == 0.0, "default flammability 0.0")
	_assert(p.purity == 1.0, "default purity 1.0")
	_assert(p.temperature == 20.0, "default temp 20.0")

	var p2 := GrainProperties.from_dict({"hardness": 0.9, "flammability": 0.1, "density": 2.5})
	_assert(p2.hardness == 0.9, "from_dict hardness")
	_assert(p2.flammability == 0.1, "from_dict flammability")
	_assert(p2.density == 2.5, "from_dict density")

	var d := p2.to_dict()
	var p3 := GrainProperties.from_dict(d)
	_assert(absf(p3.hardness - p2.hardness) < 0.001, "roundtrip hardness")
	_assert(absf(p3.density - p2.density) < 0.001, "roundtrip density")

func test_grain_creation() -> void:
	var g := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)
	_assert(g.category == GrainTypes.Category.PHYSICAL, "grain category")
	_assert(g.grain_type == GrainTypes.Physical.STONE, "grain type")
	_assert(g.quantity == 1.0, "grain quantity default")
	_assert(g.properties != null, "grain has properties")
	_assert(g.id > 0, "grain has unique id")

func test_grain_serialization() -> void:
	var g := Grain.new(GrainTypes.Category.MAGICAL, GrainTypes.Magical.ARCANE_DUST)
	g.quantity = 0.5
	g.properties.purity = 0.8
	var d := g.to_dict()
	var g2 := Grain.from_dict(d)
	_assert(g2.category == g.category, "serialize category")
	_assert(g2.grain_type == g.grain_type, "serialize type")
	_assert(absf(g2.quantity - 0.5) < 0.001, "serialize quantity")
	_assert(absf(g2.properties.purity - 0.8) < 0.001, "serialize purity")

func test_grain_stack_operations() -> void:
	var stack := GrainStack.new()
	_assert(stack.size() == 0, "empty stack size 0")
	_assert(stack.top() == null, "empty stack top null")

	var bedrock := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.BEDROCK)
	var stone := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)
	var soil := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SOIL)
	var grass := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS)

	stack.push_bottom(bedrock)
	stack.push(stone)
	stack.push(soil)
	stack.push(grass)

	_assert(stack.size() == 4, "stack size 4")
	_assert(stack.top().grain_type == GrainTypes.Physical.GRASS, "top is grass")
	_assert(stack.bottom().grain_type == GrainTypes.Physical.BEDROCK, "bottom is bedrock")

	var removed := stack.pop_top()
	_assert(removed.grain_type == GrainTypes.Physical.GRASS, "popped grass")
	_assert(stack.size() == 3, "stack size 3 after pop")
	_assert(stack.top().grain_type == GrainTypes.Physical.SOIL, "new top is soil")

	_assert(stack.has_grain_type(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE), "has stone")
	_assert(!stack.has_grain_type(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS), "no grass after pop")

func test_grain_stack_visibility() -> void:
	var stack := GrainStack.new()
	var water := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.WATER)
	water.properties.opacity = 0.3
	var sand := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SAND)
	sand.properties.opacity = 1.0
	var stone := Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.STONE)

	stack.push_bottom(stone)
	stack.push(sand)
	stack.push(water)

	var visible := stack.get_visible_grains()
	_assert(visible.size() == 2, "visible: water (0.3) + sand (1.0) = 1.3 >= 1.0, stops at sand")
	_assert(visible[0].grain_type == GrainTypes.Physical.WATER, "first visible is water")
	_assert(visible[1].grain_type == GrainTypes.Physical.SAND, "second visible is sand")

func test_grain_stack_serialization() -> void:
	var stack := GrainStack.new()
	stack.world_x = 42
	stack.world_y = 99
	stack.push(Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.GRASS))
	stack.push(Grain.new(GrainTypes.Category.PHYSICAL, GrainTypes.Physical.SOIL))

	var d := stack.to_dict()
	var stack2 := GrainStack.from_dict(d)
	_assert(stack2.world_x == 42, "roundtrip world_x")
	_assert(stack2.world_y == 99, "roundtrip world_y")
	_assert(stack2.size() == stack.size(), "roundtrip size")
	_assert(stack2.top().grain_type == GrainTypes.Physical.SOIL, "roundtrip top type")

func test_grain_registry() -> void:
	var reg := GrainRegistry.new()
	var loaded := reg.load_templates("res://data/grains/physical_grains.json")
	_assert(loaded, "templates loaded successfully")

	var stone := reg.create_grain("stone")
	_assert(stone != null, "created stone")
	_assert(absf(stone.properties.hardness - 0.8) < 0.001, "stone hardness 0.8")

	var grass := reg.create_grain("grass")
	_assert(grass != null, "created grass")
	_assert(absf(grass.properties.flammability - 0.7) < 0.001, "grass flammability 0.7")

	var grassland := reg.create_terrain_stack("grassland")
	_assert(grassland.size() >= 3, "grassland stack >= 3 layers")
	_assert(grassland.top().grain_type == GrainTypes.Physical.GRASS, "grassland top is grass")
	_assert(grassland.bottom().grain_type == GrainTypes.Physical.BEDROCK, "grassland bottom is bedrock")

	var desert := reg.create_terrain_stack("desert")
	_assert(desert.size() >= 4, "desert stack >= 4 layers")
	_assert(desert.top().grain_type == GrainTypes.Physical.SAND, "desert top is sand")

	var biomes := reg.get_biome_names()
	_assert(biomes.size() >= 10, "at least 10 biome presets")

func _assert(condition: bool, message: String) -> void:
	if condition:
		_pass_count += 1
	else:
		_fail_count += 1
		push_error("FAIL: %s" % message)
