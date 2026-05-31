class_name WorldCompiler

## Orchestrates the 14-layer compilation pipeline.

var layers: Array = []
var world_seed: int = 42
var _compiled_chunks: Dictionary = {}

func _init(seed: int = 42):
	world_seed = seed

func register_layer(layer: LayerBase) -> void:
	layers.append(layer)

func compile_chunk(chunk_x: int, chunk_y: int) -> ChunkData:
	var key = Vector2i(chunk_x, chunk_y)
	if _compiled_chunks.has(key):
		return _compiled_chunks[key]

	var total_start = Time.get_ticks_msec()
	var chunk = ChunkData.new()
	chunk.chunk_x = chunk_x
	chunk.chunk_y = chunk_y
	chunk.world_seed = world_seed

	for layer in layers:
		var layer_start = Time.get_ticks_msec()
		var layer_seed = SeedHasher.hash_seed(world_seed, chunk_x, chunk_y, layer.layer_id)
		layer.compile(chunk, layer_seed)
		var layer_ms = Time.get_ticks_msec() - layer_start

		# Compute distance fields after the layers that produce source cells
		if layer.layer_name == "ocean_mask":
			var df_start = Time.get_ticks_msec()
			_compute_ocean_distance(chunk)
			layer_ms += Time.get_ticks_msec() - df_start
		elif layer.layer_name == "rivers_lakes":
			var df_start = Time.get_ticks_msec()
			_compute_water_distance(chunk)
			layer_ms += Time.get_ticks_msec() - df_start

		var errors = layer.validate(chunk)
		if errors.size() > 0:
			for err in errors:
				push_warning("[WorldCompiler] %s validation: %s" % [layer.layer_name, err])

		if layer_ms > 50:
			print("[WorldCompiler]   %s: %dms (SLOW)" % [layer.layer_name, layer_ms])

	_compiled_chunks[key] = chunk

	var total_ms = Time.get_ticks_msec() - total_start
	print("[WorldCompiler] Chunk (%d,%d) compiled in %dms:" % [chunk_x, chunk_y, total_ms])
	print("  Layers: %d | Structures: %d | Roads: %d | Rivers: %d | POIs: %d" % [
		layers.size(), chunk.structures.size(), chunk.road_cells.size(),
		chunk.river_cells.size(), chunk.pois.size()])

	return chunk

func get_chunk(chunk_x: int, chunk_y: int) -> ChunkData:
	var key = Vector2i(chunk_x, chunk_y)
	if _compiled_chunks.has(key):
		return _compiled_chunks[key]
	return null

func get_debug_image(chunk_x: int, chunk_y: int, layer_index: int) -> Image:
	var chunk = get_chunk(chunk_x, chunk_y)
	if chunk == null or layer_index >= layers.size():
		return Image.create(ChunkData.SIZE, ChunkData.SIZE, false, Image.FORMAT_RGB8)
	return layers[layer_index].get_debug_image(chunk)

## BFS distance field from all ocean cells. O(n) for the whole grid.
func _compute_ocean_distance(chunk: ChunkData) -> void:
	var size = ChunkData.SIZE
	var total = size * size
	chunk.ocean_distance.fill(9999.0)
	var queue = PackedInt32Array()
	# Seed with all ocean cells at distance 0
	for i in range(total):
		if chunk.ocean_mask[i] == 1:
			chunk.ocean_distance[i] = 0.0
			queue.append(i)
	# BFS expand
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

## BFS distance field from all river + lake cells. O(n) for the whole grid.
func _compute_water_distance(chunk: ChunkData) -> void:
	var size = ChunkData.SIZE
	var total = size * size
	chunk.water_distance.fill(9999.0)
	var queue = PackedInt32Array()
	# Seed with river and lake cells
	for pos in chunk.river_cells:
		var i = pos.y * size + pos.x
		chunk.water_distance[i] = 0.0
		queue.append(i)
	for pos in chunk.lake_cells:
		var i = pos.y * size + pos.x
		chunk.water_distance[i] = 0.0
		queue.append(i)
	# Also include ocean cells as water sources
	for i in range(total):
		if chunk.ocean_mask[i] == 1 and chunk.water_distance[i] > 0:
			chunk.water_distance[i] = 0.0
			queue.append(i)
	# BFS expand
	var head = 0
	var dx = [-1, 0, 1, 0]
	var dy = [0, -1, 0, 1]
	while head < queue.size():
		var idx = queue[head]
		head += 1
		var cx = idx % size
		var cy = idx / size
		var d = chunk.water_distance[idx] + 1.0
		for dir in range(4):
			var nx = cx + dx[dir]
			var ny = cy + dy[dir]
			if nx < 0 or nx >= size or ny < 0 or ny >= size:
				continue
			var ni = ny * size + nx
			if d < chunk.water_distance[ni]:
				chunk.water_distance[ni] = d
				queue.append(ni)

## Create a blank chunk ready for incremental compilation.
func create_chunk(chunk_x: int, chunk_y: int) -> ChunkData:
	var key = Vector2i(chunk_x, chunk_y)
	if _compiled_chunks.has(key):
		return _compiled_chunks[key]
	var chunk = ChunkData.new()
	chunk.chunk_x = chunk_x
	chunk.chunk_y = chunk_y
	chunk.world_seed = world_seed
	return chunk

## Compile a single layer on a chunk. Call in sequence: layer 0, 1, 2, ...
func compile_layer(chunk: ChunkData, layer_index: int) -> void:
	if layer_index < 0 or layer_index >= layers.size():
		return
	var layer = layers[layer_index]
	var layer_seed = SeedHasher.hash_seed(world_seed, chunk.chunk_x, chunk.chunk_y, layer.layer_id)
	layer.compile(chunk, layer_seed)

	if layer.layer_name == "ocean_mask":
		_compute_ocean_distance(chunk)
	elif layer.layer_name == "rivers_lakes":
		_compute_water_distance(chunk)

## Mark chunk as complete and cache it.
func finalize_chunk(chunk: ChunkData) -> void:
	var key = Vector2i(chunk.chunk_x, chunk.chunk_y)
	_compiled_chunks[key] = chunk

func get_layer_names() -> Array:
	var names = []
	for layer in layers:
		names.append(layer.layer_name)
	return names
