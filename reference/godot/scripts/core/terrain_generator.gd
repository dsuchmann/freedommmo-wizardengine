class_name TerrainGenerator
extends RefCounted

var registry: GrainRegistry
var noise: FastNoiseLite
var moisture_noise: FastNoiseLite
var detail_noise: FastNoiseLite
var _seed: int = 42

var temp_noise: FastNoiseLite

func _init(p_registry: GrainRegistry = null, p_seed: int = 42) -> void:
	registry = p_registry if p_registry else GrainRegistry.new()
	_seed = p_seed
	_init_noise()

func generate_cell(cell_x: int, cell_y: int) -> WorldCell:
	var cell := WorldCell.new(cell_x, cell_y)
	var base_x := cell_x * WorldCell.CELL_SIZE
	var base_y := cell_y * WorldCell.CELL_SIZE

	cell.heights.resize(WorldCell.CELL_SIZE * WorldCell.CELL_SIZE)
	for y in range(WorldCell.CELL_SIZE):
		for x in range(WorldCell.CELL_SIZE):
			var wx := base_x + x
			var wy := base_y + y
			var height := _sample_height(wx, wy)
			var moist := _sample_moisture(wx, wy)
			var temp := _sample_temperature(wx, wy, height)
			var detail := _sample_detail(wx, wy)
			var biome := _classify_biome(height, moist, temp)
			var stack: GrainStack
			# Rivers override biome at certain heights
			if _has_river(wx, wy) and height > 0.3 and height < 0.6:
				stack = registry.create_terrain_stack("shallow_water")
			# Paths override biome — create dirt paths through terrain
			elif _has_path(wx, wy) and height > 0.35 and height < 0.75:
				stack = registry.create_terrain_stack("path")
				if stack == null:
					stack = _build_stack(biome, height, moist, detail)
			# Clearings in forests — open grass patches
			elif biome == "forest" and _is_clearing(wx, wy):
				stack = registry.create_terrain_stack("grassland")
				_add_surface_variation(stack, "grassland", height, moist, detail)
			else:
				stack = _build_stack(biome, height, moist, detail)
			cell.set_stack(x, y, stack)
			cell.heights[y * WorldCell.CELL_SIZE + x] = height

	cell.biome = _classify_biome(
		_sample_height(base_x + 64, base_y + 64),
		_sample_moisture(base_x + 64, base_y + 64))
	return cell

func _sample_height(wx: int, wy: int) -> float:
	var h := 0.0
	h += noise.get_noise_2d(wx * 0.0008, wy * 0.0008) * 0.35
	h += noise.get_noise_2d(wx * 0.003, wy * 0.003) * 0.25
	h += noise.get_noise_2d(wx * 0.012, wy * 0.012) * 0.15
	h += noise.get_noise_2d(wx * 0.05, wy * 0.05) * 0.1
	h += noise.get_noise_2d(wx * 0.2, wy * 0.2) * 0.05
	h += noise.get_noise_2d(wx * 0.8, wy * 0.8) * 0.02
	return clampf((h + 0.5), 0.0, 1.0)

func _sample_moisture(wx: int, wy: int) -> float:
	var m := 0.0
	m += moisture_noise.get_noise_2d(wx * 0.002, wy * 0.002) * 0.4
	m += moisture_noise.get_noise_2d(wx * 0.008, wy * 0.008) * 0.3
	m += moisture_noise.get_noise_2d(wx * 0.03, wy * 0.03) * 0.2
	m += moisture_noise.get_noise_2d(wx * 0.1, wy * 0.1) * 0.1
	return clampf((m + 0.5), 0.0, 1.0)

func _sample_temperature(wx: int, wy: int, height: float) -> float:
	var t := 0.0
	t += temp_noise.get_noise_2d(wx * 0.001, wy * 0.001) * 0.5
	t += temp_noise.get_noise_2d(wx * 0.005, wy * 0.005) * 0.3
	t += temp_noise.get_noise_2d(wx * 0.02, wy * 0.02) * 0.2
	t = clampf((t + 0.5), 0.0, 1.0)
	t = clampf(t - height * 0.35, 0.0, 1.0)
	return t

func _sample_detail(wx: int, wy: int) -> float:
	return (detail_noise.get_noise_2d(wx * 0.05, wy * 0.05) + 1.0) * 0.5

func _has_path(wx: int, wy: int) -> bool:
	var path_val = detail_noise.get_noise_2d(wx * 0.015, wy * 0.015)
	return abs(path_val) < 0.03

func _is_clearing(wx: int, wy: int) -> bool:
	var clearing = noise.get_noise_2d(wx * 0.04 + 500, wy * 0.04 + 500)
	return clearing > 0.4

func _has_river(wx: int, wy: int) -> bool:
	# Rivers follow narrow bands of moisture noise at low heights
	var river_val = moisture_noise.get_noise_2d(wx * 0.01, wy * 0.01)
	return abs(river_val) < 0.02

func _classify_biome(height: float, moisture: float, temp: float = 0.5) -> String:
	if height < 0.25:
		return "deep_ocean" if height < 0.15 else "ocean"
	if height < 0.32:
		return "shallow_water"
	if height < 0.37:
		return "beach"
	if height > 0.82:
		if temp < 0.3:
			return "tundra"
		return "mountains"
	if height > 0.65:
		return "hills"
	if temp < 0.25:
		return "tundra"
	if temp > 0.75 and moisture < 0.3:
		return "desert"
	if moisture > 0.7 and temp > 0.4:
		return "forest"
	if moisture > 0.55 and temp > 0.5:
		return "forest"
	if moisture < 0.25:
		if temp > 0.6:
			return "desert"
		return "hills"
	if moisture > 0.8 and temp > 0.3:
		return "swamp"
	if temp > 0.85 and height > 0.6:
		return "volcanic"
	if height > 0.7 and moisture > 0.4 and temp < 0.35:
		return "frozen_lake"
	if moisture > 0.75 and temp > 0.55 and height < 0.5:
		return "mushroom_forest"
	return "grassland"

func _build_stack(biome: String, height: float, moisture: float, detail: float) -> GrainStack:
	var stack = registry.create_terrain_stack(biome)
	_add_surface_variation(stack, biome, height, moisture, detail)
	_maybe_add_hidden_resources(stack, height, detail)
	return stack

func _add_surface_variation(stack: GrainStack, biome: String, height: float, moisture: float, detail: float) -> void:
	match biome:
		"grassland":
			if detail > 0.8:
				stack.push(registry.create_grain("flower"))
			elif detail > 0.65 and moisture > 0.5:
				stack.push(registry.create_grain("moss"))
			if detail < 0.15 and height > 0.4:
				stack.pop_top()
				stack.push(registry.create_grain("stone"))
		"forest":
			if detail > 0.7:
				stack.push(registry.create_grain("mushroom"))
			if detail < 0.2:
				stack.push(registry.create_grain("wood"))
		"desert":
			if detail > 0.85:
				stack.push(registry.create_grain("stone"))
			if detail < 0.1 and moisture > 0.2:
				stack.pop_top()
				stack.push(registry.create_grain("clay"))
		"beach":
			if detail > 0.8:
				stack.push(registry.create_grain("shell"))
			if moisture > 0.7:
				stack.pop_top()
				stack.push(registry.create_grain("water"))
		"mountains":
			if detail > 0.7:
				stack.push(registry.create_grain("gravel"))
			if height > 0.9 and moisture > 0.3:
				stack.push(registry.create_grain("snow"))
		"tundra":
			if detail > 0.6:
				stack.push(registry.create_grain("snow"))
		"hills":
			if detail > 0.75:
				stack.push(registry.create_grain("flower"))
			if detail < 0.2:
				stack.pop_top()
				stack.push(registry.create_grain("gravel"))
		"swamp":
			if detail > 0.6:
				stack.push(registry.create_grain("mushroom"))
			if detail < 0.3:
				stack.push(registry.create_grain("vine"))
		"volcanic":
			if detail > 0.7:
				stack.push(registry.create_grain("obsidian"))
			if detail < 0.2:
				stack.push(registry.create_grain("lava"))
			if detail > 0.9:
				stack.push(registry.create_grain("crystal"))
		"frozen_lake":
			if detail > 0.5:
				stack.push(registry.create_grain("ice"))
			if detail < 0.2:
				stack.push(registry.create_grain("snow"))
		"mushroom_forest":
			if detail > 0.4:
				stack.push(registry.create_grain("mushroom"))
			if detail > 0.8:
				stack.push(registry.create_grain("vine"))
			if detail < 0.15:
				stack.push(registry.create_grain("moss"))

func _maybe_add_hidden_resources(stack: GrainStack, height: float, detail: float) -> void:
	if detail > 0.95 and height > 0.5:
		var ore_roll := detail * 100.0
		if ore_roll > 99.0:
			stack.layers.insert(stack.size() - 1, registry.create_grain("mithril"))
		elif ore_roll > 97.0:
			stack.layers.insert(stack.size() - 1, registry.create_grain("gold"))
		elif ore_roll > 95.5:
			stack.layers.insert(stack.size() - 1, registry.create_grain("iron"))
		else:
			stack.layers.insert(stack.size() - 1, registry.create_grain("coal"))

func _init_noise() -> void:
	noise = FastNoiseLite.new()
	noise.seed = _seed
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 6

	moisture_noise = FastNoiseLite.new()
	moisture_noise.seed = _seed ^ 0x9E3779B9
	moisture_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	moisture_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	moisture_noise.fractal_octaves = 4

	detail_noise = FastNoiseLite.new()
	detail_noise.seed = _seed ^ 0x85EBCA6B
	detail_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
	detail_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	detail_noise.fractal_octaves = 5
	detail_noise.frequency = 0.02

	temp_noise = FastNoiseLite.new()
	temp_noise.seed = _seed ^ 0xC2B2AE35
	temp_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	temp_noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	temp_noise.fractal_octaves = 3
