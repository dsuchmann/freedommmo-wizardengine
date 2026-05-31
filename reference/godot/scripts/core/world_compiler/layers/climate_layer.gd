class_name ClimateLayer
extends LayerBase

## L5: Temperature + precipitation from latitude, elevation, ocean distance, rain shadow.
## Uses precomputed ocean_distance field (BFS) instead of per-cell scanning.

func _init():
	layer_name = "climate"
	layer_id = 5

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var world_seed = chunk.world_seed

	# Initialize overmap noise
	OvermapGenerator._ensure_noise(world_seed)
	var pixel_pos = OvermapGenerator.chunk_to_pixel(chunk.chunk_x, chunk.chunk_y)

	# Sample overmap temp/moisture at chunk corners (4 calls, not 4096)
	var base_h = OvermapGenerator.sample_height_at_pixel(pixel_pos.x, pixel_pos.y)
	var t_tl = OvermapGenerator.sample_temp_at_pixel(pixel_pos.x - 0.5, pixel_pos.y - 0.5, base_h)
	var t_tr = OvermapGenerator.sample_temp_at_pixel(pixel_pos.x + 0.5, pixel_pos.y - 0.5, base_h)
	var t_bl = OvermapGenerator.sample_temp_at_pixel(pixel_pos.x - 0.5, pixel_pos.y + 0.5, base_h)
	var t_br = OvermapGenerator.sample_temp_at_pixel(pixel_pos.x + 0.5, pixel_pos.y + 0.5, base_h)
	var m_tl = OvermapGenerator.sample_moisture_at_pixel(pixel_pos.x - 0.5, pixel_pos.y - 0.5)
	var m_tr = OvermapGenerator.sample_moisture_at_pixel(pixel_pos.x + 0.5, pixel_pos.y - 0.5)
	var m_bl = OvermapGenerator.sample_moisture_at_pixel(pixel_pos.x - 0.5, pixel_pos.y + 0.5)
	var m_br = OvermapGenerator.sample_moisture_at_pixel(pixel_pos.x + 0.5, pixel_pos.y + 0.5)

	for y in range(size):
		var ty = float(y) / float(size)
		for x in range(size):
			var tx = float(x) / float(size)
			var i = chunk.idx(x, y)
			var h = chunk.get_elevation(x, y)

			# Bilinear interpolation of overmap climate across chunk
			var temp = lerpf(lerpf(t_tl, t_tr, tx), lerpf(t_bl, t_br, tx), ty)
			# Adjust temperature for local elevation (overmap used chunk-average h)
			temp -= (h - base_h) * 0.3
			temp = clampf(temp, 0.0, 1.0)

			var moist = lerpf(lerpf(m_tl, m_tr, tx), lerpf(m_bl, m_br, tx), ty)
			var ocean_dist = chunk.ocean_distance[i]
			if ocean_dist < 20.0:
				moist += (20.0 - ocean_dist) / 20.0 * 0.15
				moist = clampf(moist, 0.0, 1.0)

			chunk.temperature[i] = temp
			chunk.precipitation[i] = moist

func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			var t = chunk.temperature[i]
			var h = chunk.get_elevation(x, y)
			if h > 0.85 and t > 0.7:
				errors.append("Hot mountain peak at (%d,%d): elev=%.2f temp=%.2f" % [x, y, h, t])
				if errors.size() > 5:
					return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			var t = chunk.temperature[i]
			var p = chunk.precipitation[i]
			img.set_pixel(x, y, Color(t, p * 0.5, 1.0 - t))
	return img
