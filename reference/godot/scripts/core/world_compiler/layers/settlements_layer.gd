class_name SettlementsLayer
extends LayerBase

## L11: Scores settlement suitability, places settlements, compiles buildings,
## generates roads connecting them, initializes walkability.

var _building_compiler: BuildingCompiler = null
var town_layout_compiler: TownLayoutCompiler = null

func _init():
	layer_name = "settlements"
	layer_id = 11
	_building_compiler = BuildingCompiler.new()

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed

	_compute_suitability(chunk, size)
	var sites = _find_settlement_sites(chunk, size, rng)
	for site in sites:
		_compile_settlement(chunk, site, rng)
	_generate_roads(chunk, sites, size)
	_init_walkability(chunk, size)

func _compute_suitability(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			var pos = Vector2i(x, y)
			# Check ALL water sources — ocean, lakes, AND rivers
			if chunk.is_ocean(x, y) or chunk.lake_cells.has(pos) or chunk.river_cells.has(pos):
				chunk.settlement_suitability[i] = 0.0
				continue

			var score = 0.0

			# Water proximity from precomputed BFS distance field
			var w_dist = chunk.water_distance[i]
			var water_score = 0.0
			if w_dist < 10.0:
				water_score = 1.0 - w_dist / 10.0
			score += water_score * 0.3

			var fert = float(chunk.fertility[i]) / 255.0
			score += fert * 0.25

			var s = chunk.slope[i]
			score += maxf(0, 0.2 - s * 2.0)

			var biome = chunk.get_biome(x, y)
			match biome:
				BiomeLayer.Biome.OCEAN, BiomeLayer.Biome.LAKE, BiomeLayer.Biome.RIVER:
					score = 0.0
				BiomeLayer.Biome.MOUNTAINS:
					score *= 0.3
				BiomeLayer.Biome.DESERT:
					score *= 0.4
				BiomeLayer.Biome.SWAMP:
					score *= 0.5
				BiomeLayer.Biome.ARCTIC, BiomeLayer.Biome.TUNDRA:
					score *= 0.3
				BiomeLayer.Biome.GRASSLAND, BiomeLayer.Biome.FOREST:
					score *= 1.2

			var h = chunk.get_elevation(x, y)
			if h > 0.4 and h < 0.7:
				score += 0.15

			chunk.settlement_suitability[i] = clampf(score, 0.0, 1.0)

func _find_settlement_sites(chunk: ChunkData, size: int, rng: RandomNumberGenerator) -> Array:
	var sites = []
	var min_spacing = 20

	var candidates = []
	var margin = mini(20, size / 4)
	for y in range(margin, size - margin):
		for x in range(margin, size - margin):
			var score = chunk.settlement_suitability[chunk.idx(x, y)]
			if score > 0.5:
				candidates.append({"x": x, "y": y, "score": score})

	candidates.sort_custom(func(a, b): return a["score"] > b["score"])

	for candidate in candidates:
		var too_close = false
		for existing in sites:
			var dist = sqrt(pow(candidate["x"] - existing["x"], 2) + pow(candidate["y"] - existing["y"], 2))
			if dist < min_spacing:
				too_close = true
				break
		if not too_close:
			var tier = "hamlet"
			if candidate["score"] > 0.8:
				tier = "town"
			elif candidate["score"] > 0.65:
				tier = "village"

			var reasons = []
			var i = chunk.idx(candidate["x"], candidate["y"])
			if float(chunk.fertility[i]) / 255.0 > 0.5:
				reasons.append("fertile_land")
			if chunk.water_distance[i] < 8.0:
				reasons.append("water_access")
			if chunk.slope[i] < 0.05:
				reasons.append("flat_terrain")

			candidate["tier"] = tier
			candidate["reasons"] = reasons
			sites.append(candidate)

			if sites.size() >= 3:
				break

	return sites

func _compile_settlement(chunk: ChunkData, site: Dictionary, rng: RandomNumberGenerator) -> void:
	var cx = site["x"]
	var cy = site["y"]
	var tier = site["tier"]

	# Use TownLayoutCompiler if available — produces coherent layouts
	if town_layout_compiler != null:
		var biome = chunk.get_biome(cx, cy)
		var biome_name = BiomeLayer.Biome.keys()[biome] if biome >= 0 else "GRASSLAND"
		var layout = town_layout_compiler.pick_layout_for_biome(biome_name, rng)
		if not layout.is_empty():
			var result = town_layout_compiler.compile_town(chunk, layout, cx, cy)
			for s in result.get("structures", []):
				chunk.structures.append(s)
			# Store NPC assignments as chunk metadata for later spawning
			var existing_npcs = chunk.get_meta("town_npcs", [])
			existing_npcs.append_array(result.get("npcs", []))
			chunk.set_meta("town_npcs", existing_npcs)
			return

	# Fallback: hardcoded ring placement if no layouts available
	var buildings = []
	match tier:
		"hamlet":
			buildings = ["well", "house", "house"]
		"village":
			buildings = ["well", "house", "house", "house", "forge", "market_stall"]
		"town":
			buildings = ["well", "house", "house", "house", "house", "forge", "market_stall", "tavern", "watchtower"]

	var placed = 0
	var ring_radius = 5
	for template_id in buildings:
		var tmpl = _building_compiler.get_template(template_id)
		if tmpl.is_empty():
			continue

		var angle = (float(placed) / buildings.size()) * TAU + rng.randf() * 0.3
		var bx = cx + int(cos(angle) * ring_radius) - int(tmpl["footprint"]["width"]) / 2
		var by = cy + int(sin(angle) * ring_radius) - int(tmpl["footprint"]["height"]) / 2

		bx = clampi(bx, 1, ChunkData.SIZE - tmpl["footprint"]["width"] - 1)
		by = clampi(by, 1, ChunkData.SIZE - tmpl["footprint"]["height"] - 1)

		# Check entire footprint + 3-tile buffer for water or overlap
		var overlaps = false
		for dy in range(-3, tmpl["footprint"]["height"] + 3):
			for dx in range(-3, tmpl["footprint"]["width"] + 3):
				var cx2 = bx + dx
				var cy2 = by + dy
				if cx2 < 0 or cx2 >= ChunkData.SIZE or cy2 < 0 or cy2 >= ChunkData.SIZE:
					if dx >= 0 and dx < tmpl["footprint"]["width"] and dy >= 0 and dy < tmpl["footprint"]["height"]:
						overlaps = true
						break
					continue
				var bp = Vector2i(cx2, cy2)
				if dx >= 0 and dx < tmpl["footprint"]["width"] and dy >= 0 and dy < tmpl["footprint"]["height"]:
					if chunk.building_tiles.has(bp):
						overlaps = true
						break
				if chunk.lake_cells.has(bp) or chunk.river_cells.has(bp) or chunk.is_ocean(cx2, cy2):
					overlaps = true
					break
			if overlaps:
				break

		if overlaps:
			ring_radius += 3
			continue

		_building_compiler.compile_building(chunk, template_id, bx, by)
		placed += 1
		ring_radius += 2

func _generate_roads(chunk: ChunkData, sites: Array, size: int) -> void:
	if sites.size() < 2:
		if sites.size() == 1:
			var cx = sites[0]["x"]
			var cy = sites[0]["y"]
			for structure in chunk.structures:
				for door in structure.get("door_tiles", []):
					var path = _find_path(chunk, Vector2i(cx, cy), door, size)
					for pos in path:
						chunk.road_cells[pos] = 1
						chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5
		return

	for i in range(sites.size() - 1):
		var from_pos = Vector2i(sites[i]["x"], sites[i]["y"])
		var to_pos = Vector2i(sites[i + 1]["x"], sites[i + 1]["y"])
		var path = _find_path(chunk, from_pos, to_pos, size)
		for pos in path:
			chunk.road_cells[pos] = 2
			chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5

	for structure in chunk.structures:
		for door in structure.get("door_tiles", []):
			var nearest_road = Vector2i(-1, -1)
			var best_dist = 999.0
			for road_pos in chunk.road_cells:
				var dist = door.distance_to(road_pos)
				if dist < best_dist:
					best_dist = dist
					nearest_road = road_pos
			if nearest_road.x >= 0:
				var path = _find_path(chunk, door, nearest_road, size)
				for pos in path:
					chunk.road_cells[pos] = 1
					chunk.walkability[chunk.idx(pos.x, pos.y)] = 0.5

func _find_path(chunk: ChunkData, from: Vector2i, to: Vector2i, size: int) -> Array:
	var open_set = {from: true}
	var came_from = {}
	var g_score = {from: 0.0}
	var f_score = {from: float(from.distance_to(to))}

	var dx = [-1, 0, 1, -1, 1, -1, 0, 1]
	var dy = [-1, -1, -1, 0, 0, 1, 1, 1]

	var iterations = 0
	while open_set.size() > 0 and iterations < 10000:
		iterations += 1

		var current = Vector2i(-1, -1)
		var best_f = 999999.0
		for pos in open_set:
			var f = f_score.get(pos, 999999.0)
			if f < best_f:
				best_f = f
				current = pos

		if current == to:
			break

		open_set.erase(current)

		for d in range(8):
			var nx = current.x + dx[d]
			var ny = current.y + dy[d]
			if nx < 0 or nx >= size or ny < 0 or ny >= size:
				continue
			var neighbor = Vector2i(nx, ny)
			var cost = chunk.road_cost[chunk.idx(nx, ny)]
			if cost >= 999.0:
				continue

			var tent_g = g_score.get(current, 999999.0) + cost
			if tent_g < g_score.get(neighbor, 999999.0):
				came_from[neighbor] = current
				g_score[neighbor] = tent_g
				f_score[neighbor] = tent_g + float(neighbor.distance_to(to))
				open_set[neighbor] = true

	var path = []
	var current = to
	while came_from.has(current):
		path.append(current)
		current = came_from[current]
	path.reverse()
	return path

func _init_walkability(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.building_tiles.has(Vector2i(x, y)):
				continue
			if chunk.road_cells.has(Vector2i(x, y)):
				continue

			if chunk.is_ocean(x, y):
				chunk.walkability[i] = -1.0
			elif chunk.river_cells.has(Vector2i(x, y)):
				chunk.walkability[i] = -1.0
			elif chunk.lake_cells.has(Vector2i(x, y)):
				chunk.walkability[i] = -1.0
			else:
				var biome = chunk.get_biome(x, y)
				match biome:
					BiomeLayer.Biome.MOUNTAINS:
						chunk.walkability[i] = 3.0
					BiomeLayer.Biome.SWAMP:
						chunk.walkability[i] = 2.0
					BiomeLayer.Biome.DESERT:
						chunk.walkability[i] = 1.3
					_:
						chunk.walkability[i] = 1.0

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var s = chunk.settlement_suitability[chunk.idx(x, y)]
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.3))
			else:
				img.set_pixel(x, y, Color(s, s * 0.3, 0.0))
	for pos in chunk.building_tiles:
		var tile = chunk.building_tiles[pos]
		match tile["type"]:
			"wall": img.set_pixel(pos.x, pos.y, Color(0.6, 0.4, 0.2))
			"floor": img.set_pixel(pos.x, pos.y, Color(0.8, 0.7, 0.5))
			"door": img.set_pixel(pos.x, pos.y, Color(0.2, 0.8, 0.2))
	for pos in chunk.road_cells:
		img.set_pixel(pos.x, pos.y, Color(0.7, 0.6, 0.4))
	return img
