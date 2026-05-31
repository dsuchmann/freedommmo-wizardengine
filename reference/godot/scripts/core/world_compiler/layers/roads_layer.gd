class_name RoadsLayer
extends LayerBase

## L10: Computes terrain traversal costs and generates road network.

func _init():
	layer_name = "roads"
	layer_id = 10

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE

	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.road_cost[i] = 999.0
				continue

			var cost = 1.0
			var s = chunk.slope[i]
			var biome = chunk.get_biome(x, y)
			var veg = float(chunk.vegetation_density[i]) / 255.0

			cost += s * 10.0
			cost += veg * 2.0

			if chunk.river_cells.has(Vector2i(x, y)):
				cost += 5.0

			match biome:
				BiomeLayer.Biome.SWAMP: cost += 3.0
				BiomeLayer.Biome.MOUNTAINS: cost += 4.0
				BiomeLayer.Biome.DESERT: cost += 1.5

			chunk.road_cost[i] = cost

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var cost = chunk.road_cost[chunk.idx(x, y)]
			if cost >= 999.0:
				img.set_pixel(x, y, Color(0.1, 0.1, 0.3))
			else:
				var t = clampf(cost / 10.0, 0.0, 1.0)
				img.set_pixel(x, y, Color(t, 1.0 - t, 0.1))
	for pos in chunk.road_cells:
		img.set_pixel(pos.x, pos.y, Color(0.8, 0.7, 0.4))
	return img
