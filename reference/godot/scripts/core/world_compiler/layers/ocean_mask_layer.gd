class_name OceanMaskLayer
extends LayerBase

## L2: Applies sea-level threshold to elevation.

const SEA_LEVEL: float = 0.38

func _init():
	layer_name = "ocean_mask"
	layer_id = 2

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			chunk.ocean_mask[chunk.idx(x, y)] = 1 if h < SEA_LEVEL else 0

func validate(chunk: ChunkData) -> Array:
	var ocean_count = 0
	var total = ChunkData.SIZE * ChunkData.SIZE
	for i in range(total):
		if chunk.ocean_mask[i] == 1:
			ocean_count += 1
	var ratio = float(ocean_count) / total
	var errors = []
	if ratio > 0.99:
		errors.append("Chunk is >99%% ocean (%.1f%%)" % [ratio * 100])
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.2, 0.6))
			else:
				img.set_pixel(x, y, Color(0.3, 0.7, 0.3))
	return img
