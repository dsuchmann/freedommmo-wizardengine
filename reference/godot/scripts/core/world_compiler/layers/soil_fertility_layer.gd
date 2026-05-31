class_name SoilFertilityLayer
extends LayerBase

## L7: Soil quality and fertility from elevation, slope, water proximity, biome.
## Uses precomputed water_distance field instead of per-cell scanning.

func _init():
	layer_name = "soil_fertility"
	layer_id = 7

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.fertility[i] = 0
				continue

			var s = chunk.slope[i]
			var p = chunk.precipitation[i]
			var t = chunk.temperature[i]
			var biome = chunk.get_biome(x, y)

			var fert = 0.5
			fert -= s * 3.0

			# Water proximity boost from precomputed BFS distance
			var w_dist = chunk.water_distance[i]
			if w_dist < 8.0:
				fert += (8.0 - w_dist) / 8.0 * 0.35

			fert += p * 0.3
			if t > 0.3 and t < 0.7:
				fert += 0.1

			match biome:
				BiomeLayer.Biome.DESERT: fert *= 0.2
				BiomeLayer.Biome.MOUNTAINS: fert *= 0.3
				BiomeLayer.Biome.ARCTIC: fert *= 0.1
				BiomeLayer.Biome.TUNDRA: fert *= 0.2
				BiomeLayer.Biome.SWAMP: fert *= 0.7
				BiomeLayer.Biome.FOREST: fert *= 1.1
				BiomeLayer.Biome.GRASSLAND: fert *= 1.2

			chunk.fertility[i] = clampi(int(fert * 255), 0, 255)

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var f = float(chunk.get_fertility(x, y)) / 255.0
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				img.set_pixel(x, y, Color(0.6 - f * 0.5, 0.2 + f * 0.6, 0.1))
	return img
