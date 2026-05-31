class_name RiversLakesLayer
extends LayerBase

## L4: D8 flow direction, accumulation, river extraction, lake detection.

const RIVER_THRESHOLD: int = 50

var _dx = [-1, 0, 1, -1, 1, -1, 0, 1]
var _dy = [-1, -1, -1, 0, 0, 1, 1, 1]

func _init():
	layer_name = "rivers_lakes"
	layer_id = 4

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	_compute_flow_direction(chunk, size)
	_compute_flow_accumulation(chunk, size)
	_extract_rivers(chunk, size)
	_detect_lakes(chunk, size)

func _compute_flow_direction(chunk: ChunkData, size: int) -> void:
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				chunk.flow_dir[i] = 255
				continue

			var h = chunk.corrected_elevation[i]
			var steepest_drop = 0.0
			var best_dir = 255

			for d in range(8):
				var nx = x + _dx[d]
				var ny = y + _dy[d]
				if nx < 0 or nx >= size or ny < 0 or ny >= size:
					best_dir = d
					steepest_drop = 0.01
					continue
				var n_idx = chunk.idx(nx, ny)
				var nh = chunk.corrected_elevation[n_idx]
				var drop = h - nh
				if d == 0 or d == 2 or d == 5 or d == 7:
					drop /= 1.414
				if drop > steepest_drop:
					steepest_drop = drop
					best_dir = d

			chunk.flow_dir[i] = best_dir

func _compute_flow_accumulation(chunk: ChunkData, size: int) -> void:
	chunk.flow_accum.fill(1)

	var in_degree = PackedInt32Array()
	in_degree.resize(size * size)
	in_degree.fill(0)

	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			var dir = chunk.flow_dir[i]
			if dir >= 8:
				continue
			var nx = x + _dx[dir]
			var ny = y + _dy[dir]
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				in_degree[chunk.idx(nx, ny)] += 1

	var queue: Array = []
	for i in range(size * size):
		if in_degree[i] == 0:
			queue.append(i)

	var head = 0
	while head < queue.size():
		var i = queue[head]
		head += 1
		var x = i % size
		var y = i / size
		var dir = chunk.flow_dir[i]
		if dir >= 8:
			continue
		var nx = x + _dx[dir]
		var ny = y + _dy[dir]
		if nx < 0 or nx >= size or ny < 0 or ny >= size:
			continue
		var n_idx = chunk.idx(nx, ny)
		chunk.flow_accum[n_idx] += chunk.flow_accum[i]
		in_degree[n_idx] -= 1
		if in_degree[n_idx] == 0:
			queue.append(n_idx)

func _extract_rivers(chunk: ChunkData, size: int) -> void:
	chunk.river_cells.clear()
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				continue
			var accum = chunk.flow_accum[i]
			if accum >= RIVER_THRESHOLD:
				var order = 1
				if accum > 200:
					order = 2
				if accum > 500:
					order = 3
				if accum > 1000:
					order = 4
				chunk.river_cells[Vector2i(x, y)] = order

func _detect_lakes(chunk: ChunkData, size: int) -> void:
	chunk.lake_cells.clear()
	var lake_id = 0
	for y in range(size):
		for x in range(size):
			var i = chunk.idx(x, y)
			if chunk.is_ocean(x, y):
				continue
			var orig = chunk.elevation[i]
			var corrected = chunk.corrected_elevation[i]
			if corrected - orig > 0.01:
				chunk.lake_cells[Vector2i(x, y)] = lake_id
				lake_id += 1

func validate(chunk: ChunkData) -> Array:
	var errors = []
	for pos in chunk.river_cells:
		var i = chunk.idx(pos.x, pos.y)
		var dir = chunk.flow_dir[i]
		if dir >= 8:
			continue
		var nx = pos.x + _dx[dir]
		var ny = pos.y + _dy[dir]
		if nx < 0 or nx >= ChunkData.SIZE or ny < 0 or ny >= ChunkData.SIZE:
			continue
		var h = chunk.corrected_elevation[i]
		var nh = chunk.corrected_elevation[chunk.idx(nx, ny)]
		if nh > h + 0.001:
			errors.append("River flows uphill at (%d,%d): %.3f -> %.3f" % [pos.x, pos.y, h, nh])
			if errors.size() > 5:
				return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var h = chunk.get_elevation(x, y)
			if chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.05, 0.1, 0.3))
			else:
				img.set_pixel(x, y, Color(h * 0.5, h * 0.6, h * 0.3))
	for pos in chunk.river_cells:
		img.set_pixel(pos.x, pos.y, Color(0.2, 0.4, 0.9))
	for pos in chunk.lake_cells:
		img.set_pixel(pos.x, pos.y, Color(0.2, 0.7, 0.8))
	return img
