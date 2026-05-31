class_name ChunkSeamRepair

## Repairs data discontinuities at chunk boundaries.
## Run AFTER all chunks are compiled, BEFORE rendering.
##
## The problem: per-chunk computations (ocean distance, biome classification,
## climate) can't see across chunk boundaries, causing hard seams.
## This pass propagates data across boundaries and reclassifies edge tiles.

const REPAIR_DEPTH: int = 8  # How many tiles inward from each edge to repair

static func repair_all(chunks: Dictionary) -> void:
	## Main entry point. chunks = {Vector2i(cx,cy): ChunkData}
	_repair_ocean_distance(chunks)
	_repair_biomes(chunks)


static func _repair_ocean_distance(chunks: Dictionary) -> void:
	## Propagate ocean distance across chunk boundaries via cross-chunk BFS.
	var size = ChunkData.SIZE
	# Build a queue of edge cells that could improve neighbor chunks
	var improved = true
	var iterations = 0
	while improved and iterations < 5:
		improved = false
		iterations += 1
		for key in chunks:
			var chunk = chunks[key] as ChunkData
			# Check each edge direction
			for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var neighbor_key = key + dir
				if not chunks.has(neighbor_key):
					continue
				var neighbor = chunks[neighbor_key] as ChunkData

				# Propagate distances across the shared edge
				if dir == Vector2i(1, 0):  # Right edge of chunk → left edge of neighbor
					for y in range(size):
						var my_dist = chunk.ocean_distance[chunk.idx(size - 1, y)]
						var their_dist = neighbor.ocean_distance[neighbor.idx(0, y)]
						if my_dist + 1.0 < their_dist:
							neighbor.ocean_distance[neighbor.idx(0, y)] = my_dist + 1.0
							improved = true
						elif their_dist + 1.0 < my_dist:
							chunk.ocean_distance[chunk.idx(size - 1, y)] = their_dist + 1.0
							improved = true
				elif dir == Vector2i(-1, 0):  # Left edge
					for y in range(size):
						var my_dist = chunk.ocean_distance[chunk.idx(0, y)]
						var their_dist = neighbor.ocean_distance[neighbor.idx(size - 1, y)]
						if my_dist + 1.0 < their_dist:
							neighbor.ocean_distance[neighbor.idx(size - 1, y)] = my_dist + 1.0
							improved = true
						elif their_dist + 1.0 < my_dist:
							chunk.ocean_distance[chunk.idx(0, y)] = their_dist + 1.0
							improved = true
				elif dir == Vector2i(0, 1):  # Bottom edge
					for x in range(size):
						var my_dist = chunk.ocean_distance[chunk.idx(x, size - 1)]
						var their_dist = neighbor.ocean_distance[neighbor.idx(x, 0)]
						if my_dist + 1.0 < their_dist:
							neighbor.ocean_distance[neighbor.idx(x, 0)] = my_dist + 1.0
							improved = true
						elif their_dist + 1.0 < my_dist:
							chunk.ocean_distance[chunk.idx(x, size - 1)] = their_dist + 1.0
							improved = true
				elif dir == Vector2i(0, -1):  # Top edge
					for x in range(size):
						var my_dist = chunk.ocean_distance[chunk.idx(x, 0)]
						var their_dist = neighbor.ocean_distance[neighbor.idx(x, size - 1)]
						if my_dist + 1.0 < their_dist:
							neighbor.ocean_distance[neighbor.idx(x, size - 1)] = my_dist + 1.0
							improved = true
						elif their_dist + 1.0 < my_dist:
							chunk.ocean_distance[chunk.idx(x, 0)] = their_dist + 1.0
							improved = true

		# After edge propagation, run local BFS inward from repaired edges
		if improved:
			for key2 in chunks:
				_propagate_distance_inward(chunks[key2])


static func _propagate_distance_inward(chunk: ChunkData) -> void:
	## Local BFS from edge cells inward to propagate improved distances.
	var size = ChunkData.SIZE
	var queue = PackedInt32Array()
	# Seed from all 4 edges
	for x in range(size):
		queue.append(chunk.idx(x, 0))
		queue.append(chunk.idx(x, size - 1))
	for y in range(1, size - 1):
		queue.append(chunk.idx(0, y))
		queue.append(chunk.idx(size - 1, y))

	var head = 0
	var dx = [-1, 0, 1, 0]
	var dy = [0, -1, 0, 1]
	while head < queue.size():
		var idx = queue[head]
		head += 1
		var cx = idx % size
		var cy = idx / size
		var d = chunk.ocean_distance[idx] + 1.0
		for dir in range(4):
			var nx = cx + dx[dir]
			var ny = cy + dy[dir]
			if nx < 0 or nx >= size or ny < 0 or ny >= size:
				continue
			var ni = ny * size + nx
			if d < chunk.ocean_distance[ni]:
				chunk.ocean_distance[ni] = d
				queue.append(ni)


static func _repair_biomes(chunks: Dictionary) -> void:
	## Reclassify biomes near chunk edges using repaired ocean distances.
	## Also checks cross-chunk neighbors for beach detection.
	var size = ChunkData.SIZE
	for key in chunks:
		var chunk = chunks[key] as ChunkData
		for y in range(size):
			for x in range(size):
				# Only repair tiles near edges (within REPAIR_DEPTH)
				if x >= REPAIR_DEPTH and x < size - REPAIR_DEPTH and y >= REPAIR_DEPTH and y < size - REPAIR_DEPTH:
					continue
				if chunk.is_ocean(x, y):
					continue

				var i = chunk.idx(x, y)
				var h = chunk.get_elevation(x, y)
				var t = chunk.temperature[i]
				var p = chunk.precipitation[i]

				# Check if this should be a beach using repaired ocean_distance
				var ocean_dist = chunk.ocean_distance[i]
				if h < 0.42 and ocean_dist <= 3.0:
					chunk.biome_id[i] = BiomeLayer.Biome.BEACH
					continue

				# For other edge tiles, check if any cross-chunk neighbor has ocean
				var near_ocean = false
				if ocean_dist <= 5.0:
					near_ocean = true

				# Reclassify using the standard rules but with cross-chunk awareness
				if h > 0.82:
					chunk.biome_id[i] = BiomeLayer.Biome.MOUNTAINS
				elif near_ocean and h < 0.42:
					chunk.biome_id[i] = BiomeLayer.Biome.BEACH
				elif p > 0.8 and h < 0.5 and t > 0.3:
					chunk.biome_id[i] = BiomeLayer.Biome.SWAMP
				else:
					# Use BiomeLayer rules (temperature/precipitation grid)
					var biome = BiomeLayer.Biome.GRASSLAND
					var rules = [
						[0.0, 0.15, 0.0, 1.0, BiomeLayer.Biome.ARCTIC],
						[0.15, 0.3, 0.0, 0.4, BiomeLayer.Biome.TUNDRA],
						[0.15, 0.3, 0.4, 1.0, BiomeLayer.Biome.TAIGA],
						[0.6, 1.0, 0.0, 0.2, BiomeLayer.Biome.DESERT],
						[0.6, 1.0, 0.2, 0.5, BiomeLayer.Biome.SAVANNA],
						[0.6, 1.0, 0.5, 1.0, BiomeLayer.Biome.TROPICAL_FOREST],
						[0.3, 0.6, 0.0, 0.3, BiomeLayer.Biome.STEPPE],
						[0.3, 0.6, 0.3, 0.55, BiomeLayer.Biome.GRASSLAND],
						[0.3, 0.6, 0.55, 0.75, BiomeLayer.Biome.FOREST],
						[0.3, 0.6, 0.75, 1.0, BiomeLayer.Biome.DENSE_FOREST],
					]
					for rule in rules:
						if t >= rule[0] and t < rule[1] and p >= rule[2] and p < rule[3]:
							biome = rule[4]
							break
					chunk.biome_id[i] = biome
