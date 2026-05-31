class_name DrainageLayer
extends LayerBase

## L3: Priority-Flood pit correction. Ensures every land cell drains.

func _init():
	layer_name = "drainage"
	layer_id = 3

func compile(chunk: ChunkData, seed: int) -> void:
	var size = ChunkData.SIZE
	var total = size * size

	for i in range(total):
		chunk.corrected_elevation[i] = chunk.elevation[i]

	var visited = PackedByteArray()
	visited.resize(total)
	visited.fill(0)

	chunk.basin_ids.fill(-1)

	var dx = [-1, 0, 1, -1, 1, -1, 0, 1]
	var dy = [-1, -1, -1, 0, 0, 1, 1, 1]

	# Simplified Priority-Flood using sorted edge seeding + BFS queue.
	# Sort all cells by elevation, process from lowest to highest.
	# This avoids O(n^2) heap.insert() — uses O(n log n) sort + O(n) BFS.
	var sorted_cells: Array = []
	sorted_cells.resize(total)
	for i in range(total):
		sorted_cells[i] = i
	sorted_cells.sort_custom(func(a, b): return chunk.elevation[a] < chunk.elevation[b])

	var basin_counter = 0
	for idx in sorted_cells:
		if visited[idx] == 1:
			continue
		var x = idx % size
		var y = idx / size
		var is_edge = (x == 0 or x == size - 1 or y == 0 or y == size - 1)
		var is_ocean = chunk.ocean_mask[idx] == 1

		if not is_edge and not is_ocean:
			continue

		# BFS flood from this edge/ocean cell
		visited[idx] = 1
		chunk.basin_ids[idx] = basin_counter
		var queue: Array = [idx]
		var head = 0
		while head < queue.size():
			var c_idx = queue[head]
			head += 1
			var cx = c_idx % size
			var cy = c_idx / size
			var c_elev = chunk.corrected_elevation[c_idx]

			for d in range(8):
				var nx = cx + dx[d]
				var ny = cy + dy[d]
				if nx < 0 or nx >= size or ny < 0 or ny >= size:
					continue
				var n_idx = chunk.idx(nx, ny)
				if visited[n_idx] == 1:
					continue
				visited[n_idx] = 1
				chunk.basin_ids[n_idx] = basin_counter

				# Fill pits: raise neighbor if lower than current
				if chunk.corrected_elevation[n_idx] < c_elev:
					chunk.corrected_elevation[n_idx] = c_elev

				queue.append(n_idx)

		basin_counter += 1

	# Handle any remaining unvisited interior cells (shouldn't happen, but safety)
	for i in range(total):
		if visited[i] == 0:
			visited[i] = 1
			chunk.basin_ids[i] = basin_counter
			basin_counter += 1

func validate(chunk: ChunkData) -> Array:
	var errors = []
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			if not chunk.is_ocean(x, y):
				if chunk.basin_ids[chunk.idx(x, y)] < 0:
					errors.append("Land cell (%d,%d) has no basin" % [x, y])
					if errors.size() > 5:
						return errors
	return errors

func get_debug_image(chunk: ChunkData) -> Image:
	var size = ChunkData.SIZE
	var img = Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in range(size):
		for x in range(size):
			var bid = chunk.basin_ids[chunk.idx(x, y)]
			if bid < 0 or chunk.is_ocean(x, y):
				img.set_pixel(x, y, Color(0.1, 0.1, 0.2))
			else:
				var r = fmod(bid * 0.618033988, 1.0)
				var g = fmod(bid * 0.381966011, 1.0)
				var b = fmod(bid * 0.247213595, 1.0)
				img.set_pixel(x, y, Color(r * 0.7 + 0.3, g * 0.7 + 0.3, b * 0.7 + 0.3))
	return img
