class_name FarmsLayer
extends LayerBase

## L12: Farm and industry placement based on settlement proximity, fertility, and resources.
## Farms expand outward from settlements into fertile accessible land.
## Industry anchors to resources and transport.

func _init():
	layer_name = "farms"
	layer_id = 12

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var rng = RandomNumberGenerator.new()
	rng.seed = seed

	for structure in chunk.structures:
		var sx = structure["pos_x"]
		var sy = structure["pos_y"]
		var category = structure.get("category", "")

		# Only settlements generate farms — not individual buildings
		# Scan outward from each settlement for fertile land
		if category == "residential" or category == "social":
			_place_farms_around(chunk, sx, sy, rng, size)

func _place_farms_around(chunk: ChunkData, cx: int, cy: int, rng: RandomNumberGenerator, size: int) -> void:
	# Scan in expanding rings for fertile, flat, unoccupied land
	var farm_count = 0
	var max_farms = 4

	for radius in range(8, 25):
		if farm_count >= max_farms:
			break
		for angle_step in range(8):
			if farm_count >= max_farms:
				break
			var angle = float(angle_step) / 8.0 * TAU + rng.randf() * 0.3
			var fx = cx + int(cos(angle) * radius)
			var fy = cy + int(sin(angle) * radius)

			if fx < 2 or fx >= size - 5 or fy < 2 or fy >= size - 5:
				continue

			var idx = chunk.idx(fx, fy)

			# Must be fertile, flat, walkable, not ocean/water/building
			if chunk.is_ocean(fx, fy):
				continue
			if chunk.building_tiles.has(Vector2i(fx, fy)):
				continue
			if chunk.road_cells.has(Vector2i(fx, fy)):
				continue

			var fert = float(chunk.fertility[idx]) / 255.0
			if fert < 0.4:
				continue

			var slope_val = chunk.slope[idx]
			if slope_val > 0.08:
				continue

			var biome = chunk.get_biome(fx, fy)
			if biome == BiomeLayer.Biome.MOUNTAINS or biome == BiomeLayer.Biome.DESERT:
				continue

			# Place a 3x3 farm plot
			var can_place = true
			for dy in range(3):
				for dx in range(3):
					var px = fx + dx
					var py = fy + dy
					if px >= size or py >= size:
						can_place = false
						break
					if chunk.building_tiles.has(Vector2i(px, py)):
						can_place = false
						break
					if chunk.is_ocean(px, py):
						can_place = false
						break
				if not can_place:
					break

			if not can_place:
				continue

			# Stamp farm tiles
			for dy in range(3):
				for dx in range(3):
					var px = fx + dx
					var py = fy + dy
					var pi = chunk.idx(px, py)
					chunk.building_tiles[Vector2i(px, py)] = {
						"type": "floor",
						"material": "tilled_soil",
						"z_index": 0,
						"structure_id": "farm_%d_%d" % [fx, fy]
					}
					chunk.walkability[pi] = 1.2  # Slightly slow

			# Build floor tile list
			var floor_tiles = []
			for fdy in range(3):
				for fdx in range(3):
					floor_tiles.append(Vector2i(fx + fdx, fy + fdy))

			# Record as structure
			chunk.structures.append({
				"template_id": "farm_plot",
				"category": "agriculture",
				"pos_x": fx,
				"pos_y": fy,
				"width": 3,
				"height": 3,
				"wall_tiles": [],
				"floor_tiles": floor_tiles,
				"door_tiles": [],
				"interior_features": [
					{"type": "crop_field", "world_x": fx + 1, "world_y": fy + 1, "provides": ["food"]}
				],
				"npc_slots": [{"role": "farmer", "workplace": "crop_field"}],
				"roof_bounds": [],
				"reasons": ["fertile_land", "settlement_proximity"],
			})

			farm_count += 1

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var f = float(chunk.get_fertility(x, y)) / 255.0
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				img.set_pixel(x, y, Color(f * 0.4, 0.2 + f * 0.3, 0.1))
	# Highlight farm plots in yellow-green
	for pos in chunk.building_tiles:
		var tile = chunk.building_tiles[pos]
		if tile.get("material", "") == "tilled_soil":
			img.set_pixel(pos.x, pos.y, Color(0.6, 0.7, 0.2))
	return img
