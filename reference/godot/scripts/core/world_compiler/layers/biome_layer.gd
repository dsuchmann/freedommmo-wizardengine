class_name BiomeLayer
extends LayerBase

## L6: Whittaker-style biome classification from temperature + precipitation.

enum Biome {
	OCEAN, BEACH, GRASSLAND, FOREST, DENSE_FOREST, DESERT,
	SAVANNA, STEPPE, TUNDRA, TAIGA, MOUNTAINS, SWAMP,
	TROPICAL_FOREST, VOLCANIC, ARCTIC, LAKE, RIVER, MYSTIC
}

var _rules: Array = []

func _init():
	layer_name = "biomes"
	layer_id = 6
	_init_rules()

func _init_rules():
	_rules = [
		[0.0, 0.15, 0.0, 1.0, Biome.ARCTIC],
		[0.15, 0.3, 0.0, 0.4, Biome.TUNDRA],
		[0.15, 0.3, 0.4, 1.0, Biome.TAIGA],
		[0.6, 1.0, 0.0, 0.2, Biome.DESERT],
		[0.6, 1.0, 0.2, 0.5, Biome.SAVANNA],
		[0.6, 1.0, 0.5, 1.0, Biome.TROPICAL_FOREST],
		[0.3, 0.6, 0.0, 0.3, Biome.STEPPE],
		[0.3, 0.6, 0.3, 0.55, Biome.GRASSLAND],
		[0.3, 0.6, 0.55, 0.75, Biome.FOREST],
		[0.3, 0.6, 0.75, 1.0, Biome.DENSE_FOREST],
	]

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE

	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)

			if chunk.is_ocean(x, y):
				chunk.biome_id[i] = Biome.OCEAN
				continue

			if chunk.river_cells.has(Vector2i(x, y)):
				chunk.biome_id[i] = Biome.RIVER
				continue

			if chunk.lake_cells.has(Vector2i(x, y)):
				chunk.biome_id[i] = Biome.LAKE
				continue

			var h = chunk.get_elevation(x, y)
			var t = chunk.temperature[i]
			var p = chunk.precipitation[i]

			if h > 0.82:
				chunk.biome_id[i] = Biome.MOUNTAINS
				continue

			if h < 0.42 and _near_ocean(chunk, x, y, size):
				chunk.biome_id[i] = Biome.BEACH
				continue

			if p > 0.8 and h < 0.5 and t > 0.3:
				chunk.biome_id[i] = Biome.SWAMP
				continue

			var biome = Biome.GRASSLAND
			for rule in _rules:
				if t >= rule[0] and t < rule[1] and p >= rule[2] and p < rule[3]:
					biome = rule[4]
					break

			chunk.biome_id[i] = biome

func _near_ocean(chunk: ChunkData, x: int, y: int, size: int) -> bool:
	for dy in range(-3, 4):
		for dx in range(-3, 4):
			var nx = x + dx
			var ny = y + dy
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				if chunk.is_ocean(nx, ny):
					return true
	return false

static func biome_name(b: int) -> String:
	match b:
		Biome.OCEAN: return "ocean"
		Biome.BEACH: return "beach"
		Biome.GRASSLAND: return "grassland"
		Biome.FOREST: return "forest"
		Biome.DENSE_FOREST: return "dense_forest"
		Biome.DESERT: return "desert"
		Biome.SAVANNA: return "savanna"
		Biome.STEPPE: return "steppe"
		Biome.TUNDRA: return "tundra"
		Biome.TAIGA: return "taiga"
		Biome.MOUNTAINS: return "mountains"
		Biome.SWAMP: return "swamp"
		Biome.TROPICAL_FOREST: return "tropical_forest"
		Biome.VOLCANIC: return "volcanic"
		Biome.ARCTIC: return "arctic"
		Biome.LAKE: return "lake"
		Biome.RIVER: return "river"
		Biome.MYSTIC: return "mystic"
		_: return "unknown"

static func biome_color(b: int) -> Color:
	match b:
		Biome.OCEAN: return Color(0.1, 0.2, 0.5)
		Biome.BEACH: return Color(0.9, 0.85, 0.6)
		Biome.GRASSLAND: return Color(0.4, 0.75, 0.3)
		Biome.FOREST: return Color(0.15, 0.5, 0.15)
		Biome.DENSE_FOREST: return Color(0.05, 0.35, 0.1)
		Biome.DESERT: return Color(0.85, 0.75, 0.45)
		Biome.SAVANNA: return Color(0.7, 0.65, 0.3)
		Biome.STEPPE: return Color(0.6, 0.55, 0.35)
		Biome.TUNDRA: return Color(0.7, 0.75, 0.8)
		Biome.TAIGA: return Color(0.2, 0.4, 0.3)
		Biome.MOUNTAINS: return Color(0.55, 0.55, 0.55)
		Biome.SWAMP: return Color(0.3, 0.4, 0.25)
		Biome.TROPICAL_FOREST: return Color(0.1, 0.6, 0.2)
		Biome.VOLCANIC: return Color(0.6, 0.2, 0.1)
		Biome.ARCTIC: return Color(0.85, 0.9, 0.95)
		Biome.LAKE: return Color(0.2, 0.5, 0.8)
		Biome.RIVER: return Color(0.3, 0.5, 0.9)
		Biome.MYSTIC: return Color(0.5, 0.2, 0.7)
		_: return Color(1, 0, 1)

func validate(chunk: ChunkData) -> Array:
	return []

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var b = chunk.get_biome(x, y)
			img.set_pixel(x, y, BiomeLayer.biome_color(b))
	return img
