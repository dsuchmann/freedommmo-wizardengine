class_name ElevationLayer
extends LayerBase

## L1: Generates elevation grid from multi-octave noise.

var noise: FastNoiseLite

func _init():
	layer_name = "elevation"
	layer_id = 1

func compile(chunk: ChunkData, seed: int) -> void:
	var world_seed = chunk.world_seed

	# Initialize overmap noise (shared static — only runs once per seed)
	OvermapGenerator._ensure_noise(world_seed)

	var size = ChunkData.SIZE
	var origin_x = chunk.chunk_x * size
	var origin_y = chunk.chunk_y * size

	# Get overmap base elevation for this chunk (pixel-scale continental shape)
	var pixel_pos = OvermapGenerator.chunk_to_pixel(chunk.chunk_x, chunk.chunk_y)
	var base_h = OvermapGenerator.sample_height_at_pixel(pixel_pos.x, pixel_pos.y)

	# Detail noise — adds tile-level variation WITHIN the overmap's base elevation
	# These are high-frequency, low-amplitude — they create local hills/valleys
	# without changing the overall biome (ocean stays ocean, mountains stay mountains)
	noise = FastNoiseLite.new()
	noise.seed = world_seed + 4000
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	noise.frequency = 0.03  # Tile-level detail

	var ridge_noise = FastNoiseLite.new()
	ridge_noise.seed = world_seed + 5000
	ridge_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	ridge_noise.fractal_octaves = 3
	ridge_noise.frequency = 0.05

	# Warp for organic tile shapes
	var warp_noise = FastNoiseLite.new()
	warp_noise.seed = world_seed + 6000
	warp_noise.noise_type = FastNoiseLite.TYPE_PERLIN
	warp_noise.frequency = 0.02
	warp_noise.fractal_octaves = 3

	# Sample overmap at 4 corners of this chunk for smooth interpolation
	# This replaces per-tile overmap sampling (was 4096 calls, now just 4)
	var h_tl = OvermapGenerator.sample_height_at_pixel(pixel_pos.x - 0.5, pixel_pos.y - 0.5)
	var h_tr = OvermapGenerator.sample_height_at_pixel(pixel_pos.x + 0.5, pixel_pos.y - 0.5)
	var h_bl = OvermapGenerator.sample_height_at_pixel(pixel_pos.x - 0.5, pixel_pos.y + 0.5)
	var h_br = OvermapGenerator.sample_height_at_pixel(pixel_pos.x + 0.5, pixel_pos.y + 0.5)

	for y in range(size):
		var ty = float(y) / float(size)
		for x in range(size):
			var tx = float(x) / float(size)
			var wx = float(origin_x + x)
			var wy = float(origin_y + y)

			# Bilinear interpolation of overmap height across the chunk
			var top = lerpf(h_tl, h_tr, tx)
			var bot = lerpf(h_bl, h_br, tx)
			var local_base = lerpf(top, bot, ty)

			# Tile-level detail noise
			var warp_x = warp_noise.get_noise_2d(wx, wy) * 8.0
			var warp_y = warp_noise.get_noise_2d(wx + 500.0, wy + 500.0) * 8.0
			var wwx = wx + warp_x
			var wwy = wy + warp_y
			var detail = noise.get_noise_2d(wwx, wwy) * 0.08
			detail += abs(ridge_noise.get_noise_2d(wwx, wwy)) * 0.05

			var h = local_base + detail
			chunk.set_elevation(x, y, clampf(h, 0.0, 1.0))

	# Calculate slope — use noise evaluation at boundaries for seamless slopes
	for y in range(size):
		for x in range(size):
			var h_left: float
			var h_right: float
			var h_up: float
			var h_down: float

			if x > 0:
				h_left = chunk.get_elevation(x - 1, y)
			else:
				h_left = _eval_elevation(noise, ridge_noise, warp_noise, origin_x + x - 1, origin_y + y)
			if x < size - 1:
				h_right = chunk.get_elevation(x + 1, y)
			else:
				h_right = _eval_elevation(noise, ridge_noise, warp_noise, origin_x + x + 1, origin_y + y)
			if y > 0:
				h_up = chunk.get_elevation(x, y - 1)
			else:
				h_up = _eval_elevation(noise, ridge_noise, warp_noise, origin_x + x, origin_y + y - 1)
			if y < size - 1:
				h_down = chunk.get_elevation(x, y + 1)
			else:
				h_down = _eval_elevation(noise, ridge_noise, warp_noise, origin_x + x, origin_y + y + 1)

			var dx_val = h_right - h_left
			var dy_val = h_down - h_up
			chunk.slope[chunk.idx(x, y)] = sqrt(dx_val * dx_val + dy_val * dy_val)

func _eval_elevation(p_noise: FastNoiseLite, p_ridge: FastNoiseLite, p_warp: FastNoiseLite, wx_int: int, wy_int: int) -> float:
	## Evaluate elevation at arbitrary world coordinates using the same noise as compile().
	## Note: med_noise and fine_noise aren't passed — approximate with p_noise at different scales.
	var wx = float(wx_int)
	var wy = float(wy_int)
	var warp_x = p_warp.get_noise_2d(wx, wy) * 15.0
	var warp_y = p_warp.get_noise_2d(wx + 500.0, wy + 500.0) * 15.0
	var wwx = wx + warp_x
	var wwy = wy + warp_y
	var continental = p_noise.get_noise_2d(wwx, wwy) * 0.4
	var ridge = abs(p_ridge.get_noise_2d(wwx, wwy)) * 0.2
	var h = continental + ridge + 0.5
	return clampf(h, 0.0, 1.0)


func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	for y in range(1, size - 1):
		for x in range(1, size - 1):
			var h = chunk.get_elevation(x, y)
			var avg = (
				chunk.get_elevation(x-1, y) + chunk.get_elevation(x+1, y) +
				chunk.get_elevation(x, y-1) + chunk.get_elevation(x, y+1)
			) / 4.0
			if abs(h - avg) > 0.3:
				errors.append("Elevation spike at (%d,%d): %.2f vs avg %.2f" % [x, y, h, avg])
				if errors.size() > 10:
					return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			var color: Color
			if h < 0.3:
				color = Color(0.1, 0.2, 0.5)
			elif h < 0.5:
				color = Color(0.2, 0.6, 0.2)
			elif h < 0.7:
				color = Color(0.5, 0.4, 0.2)
			elif h < 0.85:
				color = Color(0.6, 0.6, 0.6)
			else:
				color = Color(0.9, 0.9, 0.95)
			img.set_pixel(x, y, color)
	return img
