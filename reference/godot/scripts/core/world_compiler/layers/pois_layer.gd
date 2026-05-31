class_name POIsLayer
extends LayerBase

## L13: POI spawning from explainable triggers.

func _init():
	layer_name = "pois"
	layer_id = 13

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed

	chunk.pois.clear()

	for y in range(10, size - 10):
		for x in range(10, size - 10):
			if chunk.is_ocean(x, y):
				continue

			var triggers = _check_triggers(chunk, x, y)
			if triggers.is_empty():
				continue

			var too_close = false
			for poi in chunk.pois:
				var dist = sqrt(pow(x - poi["x"], 2) + pow(y - poi["y"], 2))
				if dist < 15:
					too_close = true
					break
			for structure in chunk.structures:
				var dist = sqrt(pow(x - structure["pos_x"], 2) + pow(y - structure["pos_y"], 2))
				if dist < 10:
					too_close = true
					break
			if too_close:
				continue

			if rng.randf() > 0.3:
				continue

			chunk.pois.append({
				"x": x,
				"y": y,
				"triggers": triggers,
				"type": _poi_type_from_triggers(triggers),
			})

func _check_triggers(chunk: ChunkData, x: int, y: int) -> Array:
	var triggers = []
	var i = chunk.idx(x, y)

	if chunk.river_cells.has(Vector2i(x, y)) and chunk.slope[i] > 0.1:
		triggers.append("waterfall")

	if chunk.road_cells.has(Vector2i(x, y)) and chunk.river_cells.has(Vector2i(x, y)):
		triggers.append("river_crossing")

	if chunk.road_cells.has(Vector2i(x, y)):
		var road_neighbors = 0
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dy == 0:
					continue
				if chunk.road_cells.has(Vector2i(x + dx, y + dy)):
					road_neighbors += 1
		if road_neighbors >= 3:
			triggers.append("road_junction")

	var h = chunk.get_elevation(x, y)
	if h > 0.7 and chunk.get_biome(x, y) == BiomeLayer.Biome.MOUNTAINS:
		triggers.append("mineral_deposit")

	if h > 0.6 and chunk.slope[i] < 0.02:
		var surrounding_slope = 0.0
		var count = 0
		for dy in range(-3, 4):
			for dx in range(-3, 4):
				var nx = x + dx
				var ny = y + dy
				if nx >= 0 and nx < ChunkData.SIZE and ny >= 0 and ny < ChunkData.SIZE:
					surrounding_slope += chunk.slope[chunk.idx(nx, ny)]
					count += 1
		if count > 0 and surrounding_slope / count > 0.08:
			triggers.append("isolated_plateau")

	return triggers

func _poi_type_from_triggers(triggers: Array) -> String:
	if "waterfall" in triggers:
		return "scenic_overlook"
	if "river_crossing" in triggers:
		return "bridge_site"
	if "road_junction" in triggers:
		return "crossroads_shrine"
	if "mineral_deposit" in triggers:
		return "mine_entrance"
	if "isolated_plateau" in triggers:
		return "ancient_ruins"
	return "point_of_interest"

func validate(chunk: ChunkData) -> Array:
	var errors = []
	for poi in chunk.pois:
		if poi.get("triggers", []).is_empty():
			errors.append("POI at (%d,%d) has no triggers" % [poi["x"], poi["y"]])
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			img.set_pixel(x, y, BiomeLayer.biome_color(chunk.get_biome(x, y)))
	for poi in chunk.pois:
		var color = Color(1, 1, 0)
		for dy in range(-1, 2):
			for dx in range(-1, 2):
				var px = poi["x"] + dx
				var py = poi["y"] + dy
				if px >= 0 and px < size and py >= 0 and py < size:
					img.set_pixel(px, py, color)
	return img
