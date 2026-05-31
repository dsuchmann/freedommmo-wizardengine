class_name CoastalLayer
extends LayerBase

## L9: Coastal material classification (beach, cliff, marsh, dune).
## Uses precomputed ocean_distance field instead of per-cell scanning.

enum CoastType { NONE, BEACH, CLIFF, MARSH, DUNE }

func _init():
	layer_name = "coastal"
	layer_id = 9

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			chunk.coast_type[i] = CoastType.NONE

			if chunk.is_ocean(x, y):
				continue

			# Only classify cells near ocean (precomputed BFS distance)
			var ocean_dist = chunk.ocean_distance[i]
			if ocean_dist > 3.0:
				continue

			var s = chunk.slope[i]
			var p = chunk.precipitation[i]
			var veg = float(chunk.vegetation_density[i]) / 255.0

			if s > 0.15:
				chunk.coast_type[i] = CoastType.CLIFF
			elif p > 0.7 and chunk.get_elevation(x, y) < 0.42:
				chunk.coast_type[i] = CoastType.MARSH
			elif p < 0.3 and veg < 0.2:
				chunk.coast_type[i] = CoastType.DUNE
			else:
				chunk.coast_type[i] = CoastType.BEACH

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var ct = chunk.coast_type[chunk.idx(x, y)]
			match ct:
				CoastType.BEACH: img.set_pixel(x, y, Color(0.95, 0.9, 0.6))
				CoastType.CLIFF: img.set_pixel(x, y, Color(0.5, 0.5, 0.5))
				CoastType.MARSH: img.set_pixel(x, y, Color(0.3, 0.5, 0.3))
				CoastType.DUNE: img.set_pixel(x, y, Color(0.85, 0.8, 0.5))
				_:
					if chunk.is_ocean(x, y):
						img.set_pixel(x, y, Color(0.1, 0.2, 0.5))
					else:
						var h = chunk.get_elevation(x, y)
						img.set_pixel(x, y, Color(h * 0.4, h * 0.5, h * 0.3))
	return img
