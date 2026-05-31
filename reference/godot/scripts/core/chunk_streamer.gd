class_name ChunkStreamer

## Manages a 9x9 grid of loaded chunks around the player.
## Compiles new chunks as the player moves, caches to disk,
## loads from cache on revisit.

signal chunks_ready
signal chunk_loaded(cx: int, cy: int)

const GRID_RADIUS: int = 3  # 7x7 grid of 32x32 chunks

var _renderer: TileMapTerrainRenderer
var _phase1_compiler: WorldCompiler
var _phase2_compiler: WorldCompiler
var _world_seed: int
var _chunk_dict: Dictionary = {}  # Vector2i -> ChunkData
var _loaded_positions: Dictionary = {}  # Vector2i -> true (rendered chunks)
var _center_chunk: Vector2i = Vector2i.ZERO
var _compiling: bool = false
var _initial_load: bool = true
var _cached_from_disk: Dictionary = {}  # Vector2i -> true (chunks loaded from cache)
var _native_compiler = null  # NativeChunkCompiler (C++) if available
var _placement_engine = null  # PlacementEngine — terrain object placement on thread
var _object_renderer = null  # TerrainObjectRenderer — sprite creation on main thread
var _blocking_tiles: Dictionary = {}  # Vector2i -> true — tiles with blocking objects


func _try_init_native():
	if ClassDB.class_exists("NativeChunkCompiler"):
		_native_compiler = ClassDB.instantiate("NativeChunkCompiler")
		_native_compiler.set_world_seed(_world_seed)
		print("[ChunkStreamer] Native C++ compiler available — using accelerated path")
	else:
		print("[ChunkStreamer] Native compiler not found — using GDScript fallback")


func setup(renderer: TileMapTerrainRenderer, phase1: WorldCompiler, phase2: WorldCompiler, seed_val: int) -> void:
	_renderer = renderer
	_phase1_compiler = phase1
	_phase2_compiler = phase2
	_world_seed = seed_val
	_try_init_native()
	OvermapGenerator._compute_modifiers(seed_val)


func load_grid_around(cx: int, cy: int, _scene_tree: SceneTree) -> void:
	## Instantly loads center chunk, then queues the rest for background loading.
	_center_chunk = Vector2i(cx, cy)

	# Clear existing rendered chunks
	for pos in _loaded_positions:
		_renderer.clear_chunk(pos.x, pos.y)
	if _object_renderer != null:
		_object_renderer.clear_all()
	_loaded_positions.clear()
	_blocking_tiles.clear()

	# Compile and render CENTER chunk immediately — player sees terrain instantly
	var center_pos = Vector2i(cx, cy)
	var center_chunk = _compile_chunk_data(center_pos)
	_renderer.render_chunk(center_chunk)
	# Place terrain objects for center chunk
	if _placement_engine != null:
		var center_objects = _placement_engine.place_chunk(center_chunk, center_pos.x, center_pos.y)
		_register_blocking_objects(center_objects)
		if _object_renderer != null and center_objects.size() > 0:
			_object_renderer.render_chunk_objects(center_pos.x, center_pos.y, center_objects, center_chunk)
	_loaded_positions[center_pos] = true

	# Queue the rest for background thread loading (sorted by distance)
	_load_queue.clear()
	var needed: Array = []
	for dy in range(-GRID_RADIUS, GRID_RADIUS + 1):
		for dx in range(-GRID_RADIUS, GRID_RADIUS + 1):
			if dx == 0 and dy == 0:
				continue  # Already loaded
			needed.append(Vector2i(cx + dx, cy + dy))
	needed.sort_custom(func(a, b):
		var da = abs(a.x - cx) + abs(a.y - cy)
		var db = abs(b.x - cx) + abs(b.y - cy)
		return da < db
	)
	_load_queue = needed

	_initial_load = false
	_compiling = false
	chunks_ready.emit()
	print("[ChunkStreamer] Center chunk loaded, %d queued for background" % needed.size())


## Background loading — compilation happens on a thread, rendering on main thread
var _load_queue: Array = []  # Positions waiting to be compiled
var _compiled_queue: Array = []  # Compiled chunks waiting to be rendered (thread-safe handoff)
var _compile_thread: Thread = null
var _thread_busy: bool = false
var _mutex: Mutex = Mutex.new()


func update(player_world_pos: Vector2, tile_size: int, _scene_tree: SceneTree) -> void:
	## Called every frame. Detects chunk changes and processes load queue.
	if _initial_load:
		return

	# Check if player moved to a new chunk
	var chunk_px = ChunkData.SIZE * tile_size
	var px = int(player_world_pos.x)
	var py = int(player_world_pos.y)
	var new_cx: int
	var new_cy: int
	if px >= 0:
		new_cx = px / chunk_px
	else:
		new_cx = (px - chunk_px + 1) / chunk_px
	if py >= 0:
		new_cy = py / chunk_px
	else:
		new_cy = (py - chunk_px + 1) / chunk_px
	var new_center = Vector2i(new_cx, new_cy)

	if new_center != _center_chunk:
		_center_chunk = new_center
		_queue_needed_chunks()

	# Process load queue — do as much as we can within the time budget
	_process_load_queue()


func _queue_needed_chunks() -> void:
	## Queue chunks that need loading and unload distant ones.
	var cx = _center_chunk.x
	var cy = _center_chunk.y

	# Find missing chunks, sorted by distance from center (closest first)
	var needed: Array = []
	for dy in range(-GRID_RADIUS, GRID_RADIUS + 1):
		for dx in range(-GRID_RADIUS, GRID_RADIUS + 1):
			var pos = Vector2i(cx + dx, cy + dy)
			if not _loaded_positions.has(pos) and not _load_queue.has(pos):
				needed.append(pos)

	# Sort by distance to center (load nearest chunks first)
	needed.sort_custom(func(a, b):
		var da = abs(a.x - cx) + abs(a.y - cy)
		var db = abs(b.x - cx) + abs(b.y - cy)
		return da < db
	)
	_load_queue.append_array(needed)

	# Unload distant chunks
	var to_remove: Array = []
	for pos in _loaded_positions:
		if abs(pos.x - cx) > GRID_RADIUS + 1 or abs(pos.y - cy) > GRID_RADIUS + 1:
			to_remove.append(pos)
	for pos in to_remove:
		_renderer.clear_chunk(pos.x, pos.y)
		if _object_renderer != null:
			_object_renderer.clear_chunk(pos.x, pos.y)
		_unregister_blocking_chunk(pos.x, pos.y)
		_loaded_positions.erase(pos)


func _process_load_queue() -> void:
	## Two-stage pipeline:
	## 1. Kick off background thread compilation (if not busy)
	## 2. Render any compiled chunks that are ready (main thread only)

	# Stage 2: Render compiled chunks ready from background thread
	_mutex.lock()
	var ready = _compiled_queue.duplicate()
	_compiled_queue.clear()
	_mutex.unlock()

	# Render up to 2 chunks per frame — terrain_connect is expensive
	var rendered_this_frame = 0
	for entry in ready:
		var chunk = entry["chunk"] as ChunkData
		var pos = entry["pos"] as Vector2i
		if not _loaded_positions.has(pos):
			_renderer.render_chunk(chunk)
			var objects = entry.get("objects", [])
			_register_blocking_objects(objects)
			if _object_renderer != null and objects.size() > 0:
				_object_renderer.render_chunk_objects(pos.x, pos.y, objects, chunk)
			_loaded_positions[pos] = true
			chunk_loaded.emit(pos.x, pos.y)
			rendered_this_frame += 1
			if rendered_this_frame >= 2:
				# Re-queue remaining for next frame
				_mutex.lock()
				for i in range(ready.find(entry) + 1, ready.size()):
					_compiled_queue.push_front(ready[i])
				_mutex.unlock()
				break

	# Stage 1: Start background work if thread is free
	if not _thread_busy:
		# Clean up finished thread
		if _compile_thread != null and _compile_thread.is_started():
			_compile_thread.wait_to_finish()
			_compile_thread = null

		if not _load_queue.is_empty():
			# New chunk compilation — highest priority
			var batch: Array = []
			while not _load_queue.is_empty() and batch.size() < 3:
				var pos = _load_queue.pop_front()
				if not _loaded_positions.has(pos):
					batch.append(pos)
			if batch.size() > 0:
				_thread_busy = true
				_compile_thread = Thread.new()
				_compile_thread.start(_thread_compile_batch.bind(batch))


func _thread_compile_batch(batch: Array) -> void:
	## Runs on background thread. Compiles chunk data and places objects.
	## Main thread handles all rendering.
	for pos in batch:
		var chunk = _compile_chunk_data(pos)
		var objects: Array = []
		if _placement_engine != null:
			objects = _placement_engine.place_chunk(chunk, pos.x, pos.y)
		_mutex.lock()
		_compiled_queue.append({"chunk": chunk, "pos": pos, "objects": objects})
		_mutex.unlock()
	_thread_busy = false


func _compile_chunk_data(pos: Vector2i) -> ChunkData:
	## Pure data compilation — no rendering, thread-safe.
	# Check memory cache
	if _chunk_dict.has(pos):
		return _chunk_dict[pos]

	# Check disk cache
	var cached = ChunkCache.load_chunk(pos.x, pos.y, _world_seed)
	if cached != null:
		_mutex.lock()
		_chunk_dict[pos] = cached
		_cached_from_disk[pos] = true
		_mutex.unlock()
		return cached

	# Compile fresh
	var chunk = ChunkData.new()
	chunk.chunk_x = pos.x
	chunk.chunk_y = pos.y
	chunk.world_seed = _world_seed

	var t0 = Time.get_ticks_usec()

	if _native_compiler != null:
		# Fast path: C++ compiles elevation + ocean + climate + biome in one call
		var result = _native_compiler.compile_chunk(pos.x, pos.y)
		chunk.elevation = result["elevation"]
		chunk.slope = result["slope"]
		chunk.ocean_mask = result["ocean_mask"]
		chunk.temperature = result["temperature"]
		chunk.precipitation = result["precipitation"]
		chunk.biome_id = result["biome_id"]
		# Still need GDScript for ocean_distance BFS
		_phase1_compiler._compute_ocean_distance(chunk)
	else:
		# GDScript fallback
		for layer in _phase1_compiler.layers:
			var layer_seed = SeedHasher.hash_seed(_world_seed, pos.x, pos.y, layer.layer_id)
			layer.compile(chunk, layer_seed)
			if layer.layer_name == "ocean_mask":
				_phase1_compiler._compute_ocean_distance(chunk)

	var t1 = Time.get_ticks_usec()
	print("[ChunkStreamer] Compile (%d,%d): %d us%s" % [pos.x, pos.y, t1 - t0, " [C++]" if _native_compiler != null else " [GDScript]"])
	_apply_modifier_overrides(chunk)

	_mutex.lock()
	_chunk_dict[pos] = chunk
	_mutex.unlock()

	_propagate_single_chunk_edges(chunk)
	_compile_phase2(chunk)
	ChunkCache.save_chunk(chunk)
	return chunk


func _get_or_compile_phase1(pos: Vector2i) -> ChunkData:
	## Get chunk from memory, disk cache, or compile fresh (phase 1 only).
	if _chunk_dict.has(pos):
		return _chunk_dict[pos]
	# Try disk cache
	var cached = ChunkCache.load_chunk(pos.x, pos.y, _world_seed)
	if cached != null:
		_chunk_dict[pos] = cached
		_cached_from_disk[pos] = true
		return cached
	# Compile phase 1
	var chunk = ChunkData.new()
	chunk.chunk_x = pos.x
	chunk.chunk_y = pos.y
	chunk.world_seed = _world_seed
	for layer in _phase1_compiler.layers:
		var layer_seed = SeedHasher.hash_seed(_world_seed, pos.x, pos.y, layer.layer_id)
		layer.compile(chunk, layer_seed)
		if layer.layer_name == "ocean_mask":
			_phase1_compiler._compute_ocean_distance(chunk)
	_chunk_dict[pos] = chunk
	return chunk


func _compile_phase2(chunk: ChunkData) -> void:
	for layer in _phase2_compiler.layers:
		var layer_seed = SeedHasher.hash_seed(_world_seed, chunk.chunk_x, chunk.chunk_y, layer.layer_id)
		layer.compile(chunk, layer_seed)


func _propagate_ocean_distance_edges(chunks: Array) -> void:
	## Propagate ocean distance across chunk boundaries. 3 iterations for convergence.
	var size = ChunkData.SIZE
	for _iteration in range(3):
		for chunk in chunks:
			var ck = Vector2i(chunk.chunk_x, chunk.chunk_y)
			for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var nk = ck + dir
				if not _chunk_dict.has(nk):
					continue
				var neighbor = _chunk_dict[nk]
				if dir == Vector2i(1, 0):
					for y in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(size - 1, y)]
						var their_d = neighbor.ocean_distance[neighbor.idx(0, y)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(0, y)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(size - 1, y)] = their_d + 1.0
				elif dir == Vector2i(-1, 0):
					for y in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(0, y)]
						var their_d = neighbor.ocean_distance[neighbor.idx(size - 1, y)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(size - 1, y)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(0, y)] = their_d + 1.0
				elif dir == Vector2i(0, 1):
					for x in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(x, size - 1)]
						var their_d = neighbor.ocean_distance[neighbor.idx(x, 0)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(x, 0)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(x, size - 1)] = their_d + 1.0
				elif dir == Vector2i(0, -1):
					for x in range(size):
						var my_d = chunk.ocean_distance[chunk.idx(x, 0)]
						var their_d = neighbor.ocean_distance[neighbor.idx(x, size - 1)]
						if my_d + 1.0 < their_d:
							neighbor.ocean_distance[neighbor.idx(x, size - 1)] = my_d + 1.0
						elif their_d + 1.0 < my_d:
							chunk.ocean_distance[chunk.idx(x, 0)] = their_d + 1.0


func _propagate_single_chunk_edges(chunk: ChunkData) -> void:
	## Propagate ocean distance from already-loaded neighbors into a single new chunk.
	var size = ChunkData.SIZE
	var ck = Vector2i(chunk.chunk_x, chunk.chunk_y)
	for dir in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var nk = ck + dir
		if not _chunk_dict.has(nk):
			continue
		var neighbor = _chunk_dict[nk]
		if dir == Vector2i(-1, 0):
			for y in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(size - 1, y)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(0, y)]:
					chunk.ocean_distance[chunk.idx(0, y)] = nd + 1.0
		elif dir == Vector2i(1, 0):
			for y in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(0, y)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(size - 1, y)]:
					chunk.ocean_distance[chunk.idx(size - 1, y)] = nd + 1.0
		elif dir == Vector2i(0, -1):
			for x in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(x, size - 1)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(x, 0)]:
					chunk.ocean_distance[chunk.idx(x, 0)] = nd + 1.0
		elif dir == Vector2i(0, 1):
			for x in range(size):
				var nd = neighbor.ocean_distance[neighbor.idx(x, 0)]
				if nd + 1.0 < chunk.ocean_distance[chunk.idx(x, size - 1)]:
					chunk.ocean_distance[chunk.idx(x, size - 1)] = nd + 1.0


func _apply_modifier_overrides(chunk: ChunkData) -> void:
	## Override biome_id for volcanic/mystic/lake/river based on overmap modifiers.
	var opx = chunk.chunk_x + OvermapGenerator.HALF_SIZE
	var opy = chunk.chunk_y + OvermapGenerator.HALF_SIZE

	var vi = OvermapGenerator.get_volcanic_influence(opx, opy)
	var mi = OvermapGenerator.get_mystic_influence(opx, opy)
	var lake = OvermapGenerator.is_lake(opx, opy)
	var river = OvermapGenerator.is_river(opx, opy)

	if vi < 0.5 and mi < 0.5 and not lake and not river:
		return

	var override_name = "unknown"
	if lake:
		override_name = "LAKE"
	elif river:
		override_name = "RIVER"
	elif vi > 0.5:
		override_name = "VOLCANIC"
	elif mi > 0.5:
		override_name = "MYSTIC"
	print("[ChunkStreamer] Biome override (%d,%d) -> %s (vi=%.2f mi=%.2f lake=%s river=%s)" % [
		chunk.chunk_x, chunk.chunk_y, override_name, vi, mi, str(lake), str(river)])

	var biome_bytes = chunk.biome_id
	var ocean_bytes = chunk.ocean_mask
	var size = ChunkData.SIZE

	for y in range(size):
		for x in range(size):
			var i = y * size + x
			if ocean_bytes[i] == 1:
				continue
			if lake:
				biome_bytes[i] = 15  # LAKE
			elif river:
				biome_bytes[i] = 16  # RIVER
			elif vi > 0.5:
				biome_bytes[i] = 13  # VOLCANIC
			elif mi > 0.5:
				biome_bytes[i] = 17  # MYSTIC
	chunk.biome_id = biome_bytes


func get_chunk(cx: int, cy: int) -> ChunkData:
	return _chunk_dict.get(Vector2i(cx, cy))


func get_chunk_dict() -> Dictionary:
	return _chunk_dict


func is_tile_blocked(world_x: int, world_y: int) -> bool:
	return _blocking_tiles.has(Vector2i(world_x, world_y))


func _register_blocking_objects(objects: Array) -> void:
	for inst in objects:
		if not inst.blocking:
			continue
		# Only block if the object is large enough to be visually blocking.
		# Small objects (size 1x1) like pebbles, flowers, grass never block.
		# Trees (2x3), boulders (2x2), logs (2x1) are large enough to block.
		if inst.size.x < 2 and inst.size.y < 2:
			continue
		_blocking_tiles[inst.position] = true


func _unregister_blocking_chunk(cx: int, cy: int) -> void:
	var chunk_origin = Vector2i(cx * PlacementEngine.CHUNK_SIZE, cy * PlacementEngine.CHUNK_SIZE)
	var keys_to_remove: Array = []
	for key in _blocking_tiles:
		if key.x >= chunk_origin.x and key.x < chunk_origin.x + PlacementEngine.CHUNK_SIZE \
			and key.y >= chunk_origin.y and key.y < chunk_origin.y + PlacementEngine.CHUNK_SIZE:
			keys_to_remove.append(key)
	for key in keys_to_remove:
		_blocking_tiles.erase(key)


func shutdown() -> void:
	## Call before freeing — waits for background thread to finish.
	if _compile_thread != null and _compile_thread.is_started():
		_compile_thread.wait_to_finish()
		_compile_thread = null
