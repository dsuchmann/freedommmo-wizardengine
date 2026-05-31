class_name VegetationLayer
extends LayerBase

## L8: Vegetation density and species from biome, fertility, slope, moisture.

enum Species { NONE, GRASS, SHRUB, DECIDUOUS, CONIFER, TROPICAL, CACTUS, MOSS, FERN }

func _init():
	layer_name = "vegetation"
	layer_id = 8

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE

	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.vegetation_density[i] = 0
				chunk.vegetation_species[i] = Species.NONE
				continue

			var fert = float(chunk.fertility[i]) / 255.0
			var biome = chunk.get_biome(x, y)
			var s = chunk.slope[i]
			var p = chunk.precipitation[i]

			var density = (fert * 0.6 + p * 0.4) * 255.0
			density -= s * 200.0

			var species = Species.GRASS
			match biome:
				BiomeLayer.Biome.FOREST:
					species = Species.DECIDUOUS
					density *= 1.3
				BiomeLayer.Biome.DENSE_FOREST:
					species = Species.DECIDUOUS
					density *= 1.5
				BiomeLayer.Biome.TAIGA:
					species = Species.CONIFER
					density *= 1.2
				BiomeLayer.Biome.TROPICAL_FOREST:
					species = Species.TROPICAL
					density *= 1.4
				BiomeLayer.Biome.DESERT:
					species = Species.CACTUS
					density *= 0.15
				BiomeLayer.Biome.TUNDRA:
					species = Species.MOSS
					density *= 0.3
				BiomeLayer.Biome.SWAMP:
					species = Species.FERN
					density *= 0.8
				BiomeLayer.Biome.STEPPE, BiomeLayer.Biome.SAVANNA:
					species = Species.SHRUB
					density *= 0.5
				BiomeLayer.Biome.MOUNTAINS:
					species = Species.CONIFER if p > 0.3 else Species.MOSS
					density *= 0.3
				BiomeLayer.Biome.GRASSLAND:
					species = Species.GRASS
				BiomeLayer.Biome.BEACH:
					species = Species.NONE
					density *= 0.05
				BiomeLayer.Biome.RIVER, BiomeLayer.Biome.LAKE:
					species = Species.NONE
					density = 0

			chunk.vegetation_density[i] = clampi(int(density), 0, 255)
			chunk.vegetation_species[i] = species

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var d = float(chunk.vegetation_density[chunk.idx(x, y)]) / 255.0
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				img.set_pixel(x, y, Color(0.4 - d * 0.3, 0.15 + d * 0.7, 0.1))
	return img
