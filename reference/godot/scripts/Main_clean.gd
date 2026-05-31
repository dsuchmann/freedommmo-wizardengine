extends Node2D

var cam: Camera2D
var move_speed := 600.0
var rot_speed := 1.5
var rotating := false
var world_tilemap: TileMap
var current_mode := "world"  # "world" or "region"
var region_position: Vector2i
var player_sprite: Sprite2D  # Player as world-space sprite (affected by Camera2D)
var player_pixel_size := Vector2(32, 32)
var current_region_center_world: Vector2 = Vector2.ZERO
var region_entered_at_ms: int = 0
var region_lock_ms: int = 0

# Region sizing (make regional tile count configurable)
var TILE_PX: int = 64
var REGION_TILES: int = 512  # was 128; increase back to 512 for larger regions
var current_region_tiles: int = REGION_TILES
var current_region_pixel_size: int = REGION_TILES * TILE_PX
var shared_detail_tileset: TileSet = null
var current_region_bounds: Rect2 = Rect2()  # cached pixel bounds of active DetailRegion
var last_bounds_check_ms: int = 0
var player_active_ms: int = 0

func _current_region_pixel_size() -> int:
	var d := get_node_or_null("DetailRegion")
	if d == null:
		return current_region_pixel_size
	var r: Rect2i = d.get_used_rect()
	return int(r.size.x) * TILE_PX

# Region streaming system
var loaded_regions: Dictionary = {}  # region_key -> TileMap
var current_region_key: String = ""
var region_cache: Dictionary = {}  # region_key -> cached data

# Preload worker state (single-flight queue)
var preload_queue: Array = []
var preload_busy: bool = false
var python_background_process: int = -1  # Process ID for background generation

func _region_key_for_pixel(p: Vector2i) -> String:
	return str(p.x) + "_" + str(p.y)

func _start_python_background_generation(center_x: int, center_y: int, radius: int = 3) -> void:
	"""Start Python background process to generate regions around player."""
	if python_background_process != -1:
		return  # Already running
		
	print("[HB] Starting Python background generation around (", center_x, ", ", center_y, ") radius ", radius)
	
	# Build command to run background generator
	var python_script = "scripts/worldgen/background_generator.py"
	var args = [python_script, str(center_x), str(center_y), str(radius)]
	
	# Try to start Python process
	python_background_process = OS.create_process("python", args)
	if python_background_process == -1:
		print("[HB] Failed to start Python background process")
	else:
		print("[HB] Python background process started with PID: ", python_background_process)

func _stop_python_background_generation() -> void:
	"""Stop the Python background generation process."""
	if python_background_process != -1:
		OS.kill(python_background_process)
		python_background_process = -1
		print("[HB] Stopped Python background generation")

func _build_region_tilemap(world_pixel: Vector2i, name: String) -> TileMap:
	# Convert pixel to world tile for biome lookup
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var world_biome = _get_world_tile_biome(world_tile)
	var neighbor_biomes = _get_neighbor_biomes(world_tile)
	
	# Create TileMap (hidden by default for preloads)
	var tm = TileMap.new()
	tm.name = name
	add_child(tm)
	tm.rotation = 0.0
	tm.scale = Vector2.ONE
	
	# Position so its center aligns with the requested world pixel
	var region_pixel_size_local = current_region_tiles * TILE_PX
	var half := Vector2(region_pixel_size_local * 0.5, region_pixel_size_local * 0.5)
	tm.position = world_pixel_pos - half
	
	# Build tileset and paint
	tm.tile_set = _create_detailed_tileset()
	_paint_detailed_terrain_with_edges(tm, world_tile, world_biome, neighbor_biomes)
	
	tm.visible = false
	return tm

func _build_region_tilemap_async(world_pixel: Vector2i, name: String) -> void:
	await get_tree().process_frame
	var tm := _build_region_tilemap(world_pixel, name)
	var key := _region_key_for_pixel(world_pixel)
	region_cache[key] = tm

# Chunked painter to avoid long frame stalls during preloading
func _paint_detailed_terrain_with_edges_chunked(tilemap: TileMap, world_tile: Vector2i, base_biome: String, neighbor_biomes: Dictionary, yield_every: int = 8192) -> void:
	print("[HB] Painting (chunked) detailed terrain for biome: ", base_biome)
	var region_size = current_region_tiles
	var world_scale = 128
	var world_offset = Vector2(world_tile.x * world_scale, world_tile.y * world_scale)
	var world_features = _sample_world_features_at_region(world_tile, region_size)
	var painted := 0
	for y in range(region_size):
		for x in range(region_size):
			var edge_biome = _get_edge_transition_biome(x, y, region_size, neighbor_biomes)
			var effective_biome = base_biome
			if edge_biome != base_biome and edge_biome != "":
				var edge_distance = _get_distance_to_edge(x, y, region_size)
				if edge_distance < 16 and _are_biomes_compatible(base_biome, edge_biome):
					effective_biome = edge_biome
			var world_coord = world_offset + Vector2(x * 2, y * 2)
			var tile_id = _get_detailed_tile_consistent(effective_biome, x, y, world_coord, world_features)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
			painted += 1
			if (painted % yield_every) == 0:
				await get_tree().process_frame
	print("[HB] Chunked paint complete: ", painted, " tiles")

# Full async preload builder using chunked painter
func _build_region_tilemap_async_full(world_pixel: Vector2i, name: String) -> void:
	await get_tree().process_frame
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var world_biome = _get_world_tile_biome(world_tile)
	var neighbor_biomes = _get_neighbor_biomes(world_tile)
	var tm = TileMap.new()
	tm.name = name
	add_child(tm)
	tm.rotation = 0.0
	tm.scale = Vector2.ONE
	var region_pixel_size_local = current_region_tiles * TILE_PX
	var half := Vector2(region_pixel_size_local * 0.5, region_pixel_size_local * 0.5)
	tm.position = world_pixel_pos - half
	if shared_detail_tileset == null:
		shared_detail_tileset = _create_detailed_tileset()
	tm.tile_set = shared_detail_tileset
	if not _try_load_region_bin(tm, world_pixel):
		print("[HB] BINARY LOAD FAILED - No binary region found, using instant placeholder")
		# Create a simple placeholder instead of slow generation
		_create_placeholder_region(tm)
	tm.visible = false
	region_cache[_region_key_for_pixel(world_pixel)] = tm

# Update preload starter to use full async builder
func _start_preload(world_pixel: Vector2i) -> void:
	var key := _region_key_for_pixel(world_pixel)
	if region_cache.has(key):
		return
	region_cache[key] = "loading"
	_build_region_tilemap_async_full(world_pixel, "Preload_" + key)

func _ready() -> void:
	print("[HB] Main ready - PROCEDURAL GENERATION")
	cam = Camera2D.new()
	add_child(cam)
	cam.make_current()
	print("[HB] Camera created and made current")
	
	# Ensure a 1080p window on run
	var win := get_window()
	if win:
		win.size = Vector2i(1920, 1080)
		print("[HB] Window size set to 1920x1080")
	
	# Generate MASSIVE 50x50 chunk world (2500 chunks!)
	print("[HB] Starting world generation...")
	_create_massive_world()
	print("[HB] World generation complete, checking scene...")

func _create_massive_world() -> void:
	print("[HB] Creating 5x5 world (25 chunks)...")
	print("[HB] This will be 640x640 tiles = 409,600 tiles total!")
	
	# Check if cached world exists
	var cache_path = "user://world_cache.dat"
	if FileAccess.file_exists(cache_path):
		print("[HB] Found cached world, loading...")
		if _load_cached_world(cache_path):
			return
		else:
			print("[HB] Cache load failed, generating new world...")
	
	# Load configuration
	var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/worldgen/config.json"))
	var biome_table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/biomes/table.json"))
	
	var CH: int = cfg["chunk_size"]  # 128 tiles per chunk
	var GRID_SIZE: int = 5  # 5x5 chunks
	var TOTAL_SIZE: int = CH * GRID_SIZE  # 6400 tiles total
	
	print("[HB] Total world size: ", TOTAL_SIZE, "x", TOTAL_SIZE, " tiles")
	
	# Create one massive TileMap for the entire world
	var tilemap = TileMap.new()
	tilemap.name = "MassiveWorld"
	add_child(tilemap)
	print("[HB] TileMap created and added to scene: ", tilemap.name)
	
	# Create complex terrain tileset with multiple biomes
	var tileset = TileSet.new()
	var source = TileSetAtlasSource.new()
	
	# Create 6x1 texture with high-resolution terrain types (64x64 each)
	var img = Image.create(384, 64, false, Image.FORMAT_RGB8)
	
	# Create high-resolution terrain textures with gradients and detail
	_create_terrain_texture(img, 0, Color(0.0, 0.15, 0.4), Color(0.0, 0.25, 0.6))      # Deep Ocean
	_create_terrain_texture(img, 1, Color(0.1, 0.4, 0.7), Color(0.3, 0.6, 0.9))        # Shallow Water  
	_create_terrain_texture(img, 2, Color(0.85, 0.75, 0.55), Color(0.95, 0.85, 0.65))  # Beach/Sand
	_create_terrain_texture(img, 3, Color(0.2, 0.6, 0.15), Color(0.4, 0.8, 0.25))      # Grassland
	_create_terrain_texture(img, 4, Color(0.5, 0.35, 0.15), Color(0.7, 0.5, 0.25))     # Hills
	_create_terrain_texture(img, 5, Color(0.4, 0.4, 0.4), Color(0.6, 0.6, 0.6))        # Mountains
	
	var tex = ImageTexture.new()
	tex.set_image(img)
	source.texture = tex
	source.texture_region_size = Vector2i(64, 64)
	
	# Create tiles for each terrain type
	source.create_tile(Vector2i(0, 0))  # Deep Ocean
	source.create_tile(Vector2i(1, 0))  # Shallow Water
	source.create_tile(Vector2i(2, 0))  # Beach
	source.create_tile(Vector2i(3, 0))  # Grassland
	source.create_tile(Vector2i(4, 0))  # Hills
	source.create_tile(Vector2i(5, 0))  # Mountains
	
	tileset.add_source(source, 0)
	tilemap.tile_set = tileset
	print("[HB] TileSet created with ", tileset.get_source_count(), " sources and assigned to TileMap")
	
	# Generate noise fields for ENTIRE world at once
	print("[HB] Generating noise fields for entire world...")
	var nf_cfg: Dictionary = cfg.duplicate(true)
	nf_cfg["lapse_rate"] = biome_table["lapse_rate"]
	var seed_val = 12345  # Fixed seed for consistent world
	var fields := NoiseFields.new(nf_cfg, seed_val)
	
	# Sample the ENTIRE world in one go
	var world_rect := Rect2i(Vector2i(0, 0), Vector2i(TOTAL_SIZE, TOTAL_SIZE))
	var f: Dictionary = fields.sample_fields(world_rect, 1.0)
	
	# Normalize height values
	var height_array = f["H"] as PackedFloat32Array
	var min_h = 1.0
	var max_h = 0.0
	for h in height_array:
		if h < min_h: min_h = h
		if h > max_h: max_h = h
	
	if max_h > min_h:
		for i in range(height_array.size()):
			height_array[i] = (height_array[i] - min_h) / (max_h - min_h)
		f["H"] = height_array
		print("[HB] Normalized height range from [", min_h, ",", max_h, "] to [0.0,1.0]")
	
	# Classify biomes for entire world
	print("[HB] Classifying biomes for entire world...")
	var bio := BiomeMap.new(biome_table)
	var biomes: PackedStringArray = bio.classify_fields(f["H"], f["M"], f["T"], f["w"], f["h"])
	
	# Generate rivers using flow accumulation
	print("[HB] Generating rivers and complex terrain...")
	var hydro := CoastRiver.new()
	var rivers: PackedByteArray = hydro.river_mask(f["H"], f["w"], f["h"], 50, float(biome_table["sea_level"]))
	
	# Paint the ENTIRE world with complex terrain
	print("[HB] Painting ", TOTAL_SIZE * TOTAL_SIZE, " tiles with complex terrain...")
	var terrain_counts = {"deep_ocean": 0, "shallow_water": 0, "beach": 0, "grassland": 0, "hills": 0, "mountains": 0, "rivers": 0}
	var tiles_painted = 0
	
	for y in range(TOTAL_SIZE):
		for x in range(TOTAL_SIZE):
			var idx = y * TOTAL_SIZE + x
			var height = height_array[idx]
			var moisture = f["M"][idx]
			var river_strength = rivers[idx] if idx < rivers.size() else 0
			
			var tile_id = Vector2i(3, 0)  # Default to grassland
			
			# Determine terrain type based on height, moisture, and rivers
			if river_strength > 0.6:
				# Rivers override other terrain
				tile_id = Vector2i(1, 0)  # Shallow water for rivers
				terrain_counts["rivers"] += 1
			elif height < 0.08:
				# Deep ocean
				tile_id = Vector2i(0, 0)
				terrain_counts["deep_ocean"] += 1
			elif height < 0.25:
				# Coastal waters and beaches
				if height < 0.14:
					tile_id = Vector2i(1, 0)  # Shallow water
					terrain_counts["shallow_water"] += 1
				else:
					# Beach areas - more likely near water
					var nearby_water = _check_nearby_water(x, y, height_array, TOTAL_SIZE)
					if nearby_water:
						tile_id = Vector2i(2, 0)  # Beach
						terrain_counts["beach"] += 1
					else:
						tile_id = Vector2i(3, 0)  # Grassland
						terrain_counts["grassland"] += 1
			elif height < 0.6:
				# Lowlands - mostly grassland with some beaches near water
				var nearby_water = _check_nearby_water(x, y, height_array, TOTAL_SIZE)
				if nearby_water and height < 0.2:
					tile_id = Vector2i(2, 0)  # Beach
					terrain_counts["beach"] += 1
				else:
					tile_id = Vector2i(3, 0)  # Grassland
					terrain_counts["grassland"] += 1
			elif height < 0.75:
				# Hills - vary based on moisture and elevation
				if moisture > 0.7:
					tile_id = Vector2i(3, 0)  # Forested hills (green)
					terrain_counts["grassland"] += 1
				elif height > 0.65:
					tile_id = Vector2i(4, 0)  # Hills
					terrain_counts["hills"] += 1
				else:
					tile_id = Vector2i(3, 0)  # Grassland
					terrain_counts["grassland"] += 1
			elif height < 0.9:
				# High hills and low mountains
				if moisture > 0.5:
					tile_id = Vector2i(4, 0)  # Hills
					terrain_counts["hills"] += 1
				else:
					tile_id = Vector2i(5, 0)  # Mountains
					terrain_counts["mountains"] += 1
			else:
				# High mountains
				tile_id = Vector2i(5, 0)
				terrain_counts["mountains"] += 1
			
			tilemap.set_cell(0, Vector2i(x, y), 0, tile_id)
			tiles_painted += 1
			
			# Progress indicator every 100K tiles  
			if tiles_painted % 100000 == 0:
				print("[HB] Painted ", tiles_painted, " / ", TOTAL_SIZE * TOTAL_SIZE, " tiles...")
	
	# Get the actual bounds of the TileMap we just created
	var tilemap_rect = tilemap.get_used_rect()
	print("[HB] TileMap actual used rect: ", tilemap_rect)
	
	# Calculate the center of the actual TileMap in world coordinates
	var tilemap_center_tile = Vector2(tilemap_rect.position.x + tilemap_rect.size.x / 2.0, 
									  tilemap_rect.position.y + tilemap_rect.size.y / 2.0)
	var tilemap_center_world = tilemap.map_to_local(Vector2i(tilemap_center_tile))
	
	print("[HB] TileMap center tile: ", tilemap_center_tile)
	print("[HB] TileMap center world pos: ", tilemap_center_world)
	
	# Position camera at the actual center of the TileMap
	cam.position = tilemap_center_world
	cam.zoom = Vector2(0.1, 0.1)  # Zoom out to see full world
	
	print("[HB] Camera positioned at actual TileMap center: ", cam.position)
	
	print("[HB] COMPLEX WORLD COMPLETE!")
	print("[HB] Total tiles: ", TOTAL_SIZE * TOTAL_SIZE)
	print("[HB] Terrain distribution: ", terrain_counts)
	print("[HB] Camera centered at: ", cam.position, " with zoom: ", cam.zoom)
	print("[HB] Controls: WASD=move, Mouse wheel=zoom, Middle click/Space=reset view")
	
	# Store reference to world tilemap for region selection
	world_tilemap = tilemap
	print("[HB] Click on any area to zoom into high-detail regional view!")
	
	# Save the generated world to cache
	print("[HB] Saving world to cache...")
	_save_world_to_cache("user://world_cache.dat", tilemap)
	print("[HB] World cached successfully!")

func _reset_camera_view() -> void:
	# Reset camera to show the full world
	var TOTAL_SIZE = 5 * 128  # 5x5 chunks of 128 tiles each
	# TileMap tiles go from (0,0) to (TOTAL_SIZE-1, TOTAL_SIZE-1)
	# At TILE_PX per tile, the center should be at (TOTAL_SIZE/2 * TILE_PX, TOTAL_SIZE/2 * TILE_PX)
	cam.position = Vector2(TOTAL_SIZE * 32, TOTAL_SIZE * 32)  # Center of TileMap
	cam.zoom = Vector2(0.1, 0.1)  # Zoom out more to see full world
	cam.rotation = 0.0  # Reset rotation
	print("[HB] Camera reset - TileMap center should be at: ", cam.position)
	print("[HB] TileMap spans tiles (0,0) to (", TOTAL_SIZE-1, ",", TOTAL_SIZE-1, ")")
	print("[HB] In pixels: (0,0) to (", TOTAL_SIZE*64, ",", TOTAL_SIZE*64, ")")
	
	# Return to world mode
	current_mode = "world"
	_clear_region_view()

func _handle_world_click(screen_pos: Vector2) -> void:
	print("[HB] LEFT CLICK DETECTED! Screen pos: ", screen_pos)
	
	# Convert screen position to world position
	var world_pos = cam.get_global_mouse_position()
	print("[HB] World position: ", world_pos)
	
	# Convert world position to tile coordinates (for bounds checking only)
	var world_local = world_tilemap.to_local(world_pos)
	var tile_pos = world_tilemap.local_to_map(world_local)
	print("[HB] Tile position: ", tile_pos)
	
	# Check if click is within the tilemap bounds
	var tilemap_rect = world_tilemap.get_used_rect()
	print("[HB] TileMap bounds: ", tilemap_rect)
	
	if tilemap_rect.has_point(tile_pos):
		# Use PIXEL coordinates for region loading, not tile coordinates
		var pixel_pos = Vector2i(int(world_pos.x), int(world_pos.y))
		
		print("[HB] Click is INSIDE bounds - Loading high-detail region at PIXEL: ", pixel_pos)
		_load_region_detail(pixel_pos)
	else:
		print("[HB] Click is OUTSIDE bounds - tile ", tile_pos, " not in ", tilemap_rect)

func _load_region_detail(center_pixel: Vector2i) -> void:
	print("[HB] Generating high-detail region centered at PIXEL: ", center_pixel)
	
	# Store the region position (pixel coordinates)
	region_position = center_pixel
	current_mode = "region"
	
	# Hide the world tilemap
	world_tilemap.visible = false
	
	# Generate a high-detail region (represents 1 world pixel expanded to full region)
	_generate_detailed_region(center_pixel, true)

func _generate_detailed_region(world_pixel: Vector2i, center_on_generate: bool = true) -> void:
	print("[HB] Creating detailed region for world PIXEL: ", world_pixel)
	
	# Allow negative coordinates for seamless world transitions
	print("[HB] Generating region at world pixel: ", world_pixel, " (negative coordinates allowed)")
	
	# Convert pixel coordinates to world TileMap tile using proper transforms
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	print("[HB] World pixel ", world_pixel, " corresponds to tile ", world_tile)
	
	# Get the biome type at this world tile and its neighbors
	var world_biome = _get_world_tile_biome(world_tile)
	var neighbor_biomes = _get_neighbor_biomes(world_tile)
	print("[HB] World tile biome: ", world_biome)
	print("[HB] Neighbor biomes: ", neighbor_biomes)
	
	# Create a new high-resolution tilemap
	var detail_tilemap = TileMap.new()
	detail_tilemap.name = "DetailRegion"
	add_child(detail_tilemap)
	# Enforce identity transform to avoid inherited offsets/scales
	detail_tilemap.rotation = 0.0
	detail_tilemap.scale = Vector2.ONE
	detail_tilemap.position = detail_tilemap.position  # no-op, clarity
	
	# Position the detailed tilemap at the world coordinates of the clicked tile
	# The detailed region should replace the world tile area, but be much more detailed
	# Each world tile is 64x64 pixels, but detailed region is 512x512 tiles at 64px each
	# So we need to center the detailed region on the world tile location
	# Use the actual world pixel position (not derived from tile)
	# Reuse the earlier world_pixel_pos variable defined above
	current_region_tiles = REGION_TILES
	var region_pixel_size = current_region_tiles * TILE_PX
	
	# World-align the detailed region to the clicked pixel: center the region on world_pixel_pos
	var half := Vector2(region_pixel_size * 0.5, region_pixel_size * 0.5)
	detail_tilemap.position = world_pixel_pos - half
	# Cache the region world center for player/camera placement
	current_region_center_world = detail_tilemap.position + half
	
	print("[HB] FIXED: Detail tilemap positioned at origin offset: ", detail_tilemap.position)
	print("[HB] World PIXEL at: ", world_pixel_pos, " (camera will center here)")
	print("[HB] Region pixel size: ", region_pixel_size)
	print("[HB] Region bounds: ", detail_tilemap.position, " to ", detail_tilemap.position + Vector2(region_pixel_size, region_pixel_size))
	
	# Debug: Show the corrected calculation
	print("[HB] CORRECTED Region positioning:")
	print("[HB]   Camera will center on world_pixel: ", world_pixel_pos)
	print("[HB]   Region positioned at: ", detail_tilemap.position)
	print("[HB]   Region spans: ", detail_tilemap.position, " to ", detail_tilemap.position + Vector2(region_pixel_size, region_pixel_size))
	
	# Create/reuse detailed tileset with many terrain features
	if shared_detail_tileset == null:
		shared_detail_tileset = _create_detailed_tileset()
	print("[HB] Detailed tileset ready with ", shared_detail_tileset.get_source_count(), " sources")
	detail_tilemap.tile_set = shared_detail_tileset
	
	# Load center region + 8 adjacent regions (3x3 grid)
	_load_region_grid_3x3(world_pixel)
	
	# Create player sprite for region exploration
	_create_player_sprite()

	# Do NOT reparent camera; keep it under root and use global placement
	cam.make_current()
	
	# Start Python background generation for adjacent regions
	_start_python_background_generation(world_pixel.x, world_pixel.y, 3)

	# HARD ALIGN only when entering from world
	if center_on_generate:
		var used_rect_final: Rect2i = detail_tilemap.get_used_rect()
		var center_tile_final: Vector2 = Vector2(used_rect_final.position) + Vector2(used_rect_final.size) * 0.5
		var region_center: Vector2 = detail_tilemap.position + center_tile_final * TILE_PX
		if player_sprite:
			player_sprite.global_position = region_center
			print("[HB] ALIGN: Player set to region center global:", player_sprite.global_position)
		cam.make_current()
		# Always set camera using GLOBAL coordinates to avoid ambiguity
		cam.global_position = region_center
		print("[HB] ALIGN: Camera set to region center (global):", cam.global_position)
		print("[HB]   DetailRegion scale:", detail_tilemap.scale, " rotation:", detail_tilemap.rotation)
		print("[HB]   DetailRegion global_position:", detail_tilemap.global_position)
		region_entered_at_ms = Time.get_ticks_msec()
		region_lock_ms = region_entered_at_ms + 200  # lock 200ms to hold center
	
	# REMOVED TEST TILES - they were overwriting the actual terrain!
	print("[HB] Terrain generation complete - no test tiles, showing actual generated terrain")
	var used_rect_debug: Rect2i = detail_tilemap.get_used_rect()
	var tilemap_center_tile = Vector2i(used_rect_debug.position) + Vector2i(used_rect_debug.size.x / 2, used_rect_debug.size.y / 2)
	
	# CRITICAL DEBUG: Let's trace through ALL the coordinate calculations
	print("[HB] === COORDINATE SYSTEM DEBUG ===")
	print("[HB] Tilemap position: ", detail_tilemap.position)
	print("[HB] Tilemap center tile coord: ", tilemap_center_tile)
	print("[HB] Tile size: ", TILE_PX, " pixels")
	print("[HB] Tilemap world center calculation:")
	print("[HB]   ", detail_tilemap.position, " + ", tilemap_center_tile, " * ", TILE_PX)
	print("[HB]   = ", detail_tilemap.position, " + ", Vector2(tilemap_center_tile.x * TILE_PX, tilemap_center_tile.y * TILE_PX))
	var tilemap_world_center = detail_tilemap.position + Vector2(tilemap_center_tile.x * TILE_PX, tilemap_center_tile.y * TILE_PX)
	print("[HB]   = ", tilemap_world_center)
	
	# Set camera zoom and rotation, but don't set position yet - wait for player
	cam.zoom = Vector2(8.0, 8.0)  # Zoom WAY in for character-level ground view (8x zoom)
	cam.rotation = 0.0  # Reset rotation
	
	print("[HB] Camera zoom set to: ", cam.zoom)
	print("[HB] Region tilemap bounds: ", detail_tilemap.get_used_rect())
	print("[HB] Detail tilemap position: ", detail_tilemap.position)
	print("[HB] Detail tilemap visible: ", detail_tilemap.visible)
	
	# CRITICAL DEBUG: Check tilemap rendering properties
	print("[HB] TILEMAP DEBUG:")
	print("[HB]   Tilemap visible: ", detail_tilemap.visible)
	print("[HB]   Tilemap modulate: ", detail_tilemap.modulate)
	print("[HB]   Tilemap z_index: ", detail_tilemap.z_index)
	print("[HB]   Tilemap layer count: ", detail_tilemap.get_layers_count())
	if detail_tilemap.get_layers_count() > 0:
		print("[HB]   Layer 0 enabled: ", detail_tilemap.is_layer_enabled(0))
		print("[HB]   Layer 0 modulate: ", detail_tilemap.get_layer_modulate(0))
		print("[HB]   Layer 0 z_index: ", detail_tilemap.get_layer_z_index(0))
	
	# Force tilemap to be visible and on top
	detail_tilemap.visible = true
	detail_tilemap.z_index = 10  # Put it on top
	detail_tilemap.modulate = Color.WHITE  # Ensure it's not transparent
	if detail_tilemap.get_layers_count() > 0:
		detail_tilemap.set_layer_enabled(0, true)
		detail_tilemap.set_layer_modulate(0, Color.WHITE)
		detail_tilemap.set_layer_z_index(0, 0)
	
	print("[HB] FORCED tilemap visibility settings. Should be visible now!")
	print("[HB] Press ESC to return to world view")
	
	# No debug markers in production - clean UI
	# Immediately start background preloads for all four adjacent regions
	var preload_size_px := current_region_tiles * TILE_PX
	# One-ring
	_schedule_preload(world_pixel + Vector2i(0, -preload_size_px))
	_schedule_preload(world_pixel + Vector2i(0, preload_size_px))
	_schedule_preload(world_pixel + Vector2i(preload_size_px, 0))
	_schedule_preload(world_pixel + Vector2i(-preload_size_px, 0))
	# Second ring (diagonals)
	_schedule_preload(world_pixel + Vector2i(preload_size_px, -preload_size_px))
	_schedule_preload(world_pixel + Vector2i(preload_size_px, preload_size_px))
	_schedule_preload(world_pixel + Vector2i(-preload_size_px, -preload_size_px))
	_schedule_preload(world_pixel + Vector2i(-preload_size_px, preload_size_px))

func _get_neighbor_biomes(world_tile: Vector2i) -> Dictionary:
	# Get biomes of all 8 neighboring world tiles
	var neighbors = {
		"north": _get_world_tile_biome(world_tile + Vector2i(0, -1)),
		"south": _get_world_tile_biome(world_tile + Vector2i(0, 1)),
		"east": _get_world_tile_biome(world_tile + Vector2i(1, 0)),
		"west": _get_world_tile_biome(world_tile + Vector2i(-1, 0)),
		"northeast": _get_world_tile_biome(world_tile + Vector2i(1, -1)),
		"northwest": _get_world_tile_biome(world_tile + Vector2i(-1, -1)),
		"southeast": _get_world_tile_biome(world_tile + Vector2i(1, 1)),
		"southwest": _get_world_tile_biome(world_tile + Vector2i(-1, 1))
	}
	return neighbors

func _get_world_tile_biome(tile_pos: Vector2i) -> String:
	# Check if tile is within world bounds
	var world_bounds = world_tilemap.get_used_rect()
	if not world_bounds.has_point(tile_pos):
		print("[HB] Tile ", tile_pos, " is outside world bounds, using ocean")
		return "deep_ocean"  # Default for out-of-bounds
	
	# Get the terrain type from the world tilemap at this position
	var tile_data = world_tilemap.get_cell_source_id(0, tile_pos)
	var atlas_coords = world_tilemap.get_cell_atlas_coords(0, tile_pos)
	
	print("[HB] Biome detection at tile ", tile_pos, ": source_id=", tile_data, " atlas_coords=", atlas_coords)
	
	# Map tile IDs back to biome names based on atlas coordinates
	if tile_data == -1:
		print("[HB] No tile at position - using grassland default")
		return "grassland"
	
	match atlas_coords.x:
		0: 
			print("[HB] Detected: deep_ocean")
			return "ocean"
		1: 
			print("[HB] Detected: shallow_water")
			return "shallow_water" 
		2: 
			print("[HB] Detected: beach")
			return "beach"
		3: 
			print("[HB] Detected: grassland")
			return "grassland"
		4: 
			print("[HB] Detected: hills")
			return "hills"
		5: 
			print("[HB] Detected: mountains")
			return "mountains"
		_: 
			print("[HB] Unknown atlas coord ", atlas_coords.x, " - using grassland default")
			return "grassland"  # Default

func _create_detailed_tileset() -> TileSet:
	var tileset = TileSet.new()
	tileset.tile_size = Vector2i(TILE_PX, TILE_PX)
	var source = TileSetAtlasSource.new()
	
	# Create 16x1 texture with detailed terrain features (64x64 each to match world tileset)
	var img = Image.create(1024, 64, false, Image.FORMAT_RGB8)
	
	# Enhanced detailed terrain types for ground-level view
	var terrain_types = [
		{"name": "water", "colors": [Color(0.0, 0.4, 0.9), Color(0.1, 0.5, 1.0)]},
		{"name": "sand", "colors": [Color(0.95, 0.85, 0.65), Color(1.0, 0.9, 0.7)]},
		{"name": "grass", "colors": [Color(0.2, 0.8, 0.1), Color(0.3, 0.9, 0.2)]},
		{"name": "dirt", "colors": [Color(0.7, 0.5, 0.3), Color(0.8, 0.6, 0.4)]},
		{"name": "stone", "colors": [Color(0.6, 0.6, 0.6), Color(0.7, 0.7, 0.7)]},
		{"name": "forest", "colors": [Color(0.1, 0.6, 0.1), Color(0.2, 0.7, 0.2)]},
		{"name": "rock", "colors": [Color(0.5, 0.5, 0.5), Color(0.6, 0.6, 0.6)]},
		{"name": "mud", "colors": [Color(0.5, 0.4, 0.3), Color(0.6, 0.5, 0.4)]},
		{"name": "gravel", "colors": [Color(0.7, 0.7, 0.6), Color(0.8, 0.8, 0.7)]},
		{"name": "moss", "colors": [Color(0.4, 0.7, 0.4), Color(0.5, 0.8, 0.5)]},
		{"name": "snow", "colors": [Color(0.95, 0.95, 0.95), Color(1.0, 1.0, 1.0)]},
		{"name": "ice", "colors": [Color(0.8, 0.95, 1.0), Color(0.9, 1.0, 1.0)]},
		{"name": "lava", "colors": [Color(1.0, 0.4, 0.0), Color(1.0, 0.6, 0.1)]},
		{"name": "crystal", "colors": [Color(0.9, 0.5, 1.0), Color(1.0, 0.7, 1.0)]},
		{"name": "path", "colors": [Color(0.8, 0.7, 0.5), Color(0.9, 0.8, 0.6)]},
		{"name": "flowers", "colors": [Color(1.0, 0.8, 0.9), Color(1.0, 0.9, 1.0)]}
	]
	
	# Create the texture first
	for i in range(terrain_types.size()):
		_create_detailed_terrain_texture(img, i, terrain_types[i]["colors"][0], terrain_types[i]["colors"][1])
	
	var tex = ImageTexture.new()
	tex.set_image(img)
	source.texture = tex
	source.texture_region_size = Vector2i(64, 64)
	
	# Then create tiles after texture is set
	for i in range(terrain_types.size()):
		source.create_tile(Vector2i(i, 0))
		print("[HB] Debug: Created tile ", i, " (", terrain_types[i]["name"], ")")
	
	print("[HB] Debug: Created detailed texture ", img.get_width(), "x", img.get_height(), " with ", terrain_types.size(), " tiles")
	print("[HB] Debug: Texture region size: ", source.texture_region_size)
	print("[HB] Debug: First tile color at (0,0): ", img.get_pixel(0, 0))
	print("[HB] Debug: Second tile color at (64,0): ", img.get_pixel(64, 0))
	print("[HB] Debug: Texture format: ", img.get_format())
	print("[HB] Debug: Source texture size: ", source.texture.get_size())
	
	tileset.add_source(source, 0)
	return tileset

func _create_detailed_terrain_texture(img: Image, tile_index: int, color1: Color, color2: Color) -> void:
	var start_x = tile_index * 64
	var rng = RandomNumberGenerator.new()
	rng.seed = tile_index * 54321
	
	for x in range(64):
		for y in range(64):
			var noise1 = rng.randf_range(-0.15, 0.15)
			var noise2 = rng.randf_range(-0.08, 0.08)
			var blend = 0.5 + noise1 + noise2
			blend = clampf(blend, 0.0, 1.0)
			var final_color = color1.lerp(color2, blend)
			img.set_pixel(start_x + x, y, final_color)

func _paint_detailed_terrain_with_edges(tilemap: TileMap, world_tile: Vector2i, base_biome: String, neighbor_biomes: Dictionary) -> void:
	print("[HB] Painting detailed terrain for biome: ", base_biome, " with edge transitions")
	
	# Use consistent world-coordinate-based generation
	var region_size = current_region_tiles  # Configurable regional tile count
	var world_scale = 128  # Each world tile = 128x128 region tiles
	
	# Calculate the world coordinate offset for this region
	var world_offset = Vector2(world_tile.x * world_scale, world_tile.y * world_scale)
	
	# Sample world-level features at high resolution
	var world_features = _sample_world_features_at_region(world_tile, region_size)
	
	for y in range(region_size):
		for x in range(region_size):
			# Calculate world coordinates for this regional tile
			var world_coord = world_offset + Vector2(x * 2, y * 2)  # 2x upscaling
			
			# Determine if we're near an edge and which biome to transition to
			var edge_biome = _get_edge_transition_biome(x, y, region_size, neighbor_biomes)
			var effective_biome = base_biome
			
			# If we're near an edge, blend toward the neighboring biome (but conservatively)
			if edge_biome != base_biome and edge_biome != "":
				var edge_distance = _get_distance_to_edge(x, y, region_size)
				if edge_distance < 16:  # Smaller 16-pixel transition zone
					var blend_factor = (16.0 - edge_distance) / 16.0
					# Only transition if we're very close to edge AND biomes are compatible
					if blend_factor > 0.8 and _are_biomes_compatible(base_biome, edge_biome):
						effective_biome = edge_biome
			
			# Get detailed tile based on world features and effective biome
			var tile_id = _get_detailed_tile_consistent(effective_biome, x, y, world_coord, world_features)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
			
			# DEBUG: Print first few tiles to verify generation
			if x < 3 and y < 3:
				print("[HB] TERRAIN DEBUG: Tile (", x, ",", y, ") = tile_id:", tile_id, " biome:", effective_biome)
			
			# Progress indicator for large regions
			if (x + y * region_size) % 50000 == 0:
				var progress = float(x + y * region_size) / float(region_size * region_size) * 100.0
				print("[HB] Region generation progress: ", int(progress), "%")
	
	print("[HB] Detailed terrain painted with seamless edges: ", region_size, "x", region_size, " tiles")
	print("[HB] Total tiles generated: ", region_size * region_size, " (", (region_size * region_size) / 1000, "K tiles)")

func _are_biomes_compatible(biome1: String, biome2: String) -> bool:
	# Define which biomes can reasonably transition into each other
	var compatible_pairs = [
		["grassland", "hills"],
		["grassland", "beach"],
		["hills", "mountains"],
		["beach", "shallow_water"],
		["shallow_water", "deep_ocean"],
		["mountains", "hills"]
	]
	
	for pair in compatible_pairs:
		if (pair[0] == biome1 and pair[1] == biome2) or (pair[0] == biome2 and pair[1] == biome1):
			return true
	return false

func _get_edge_transition_biome(x: int, y: int, region_size: int, neighbor_biomes: Dictionary) -> String:
	# Determine which neighboring biome we should transition to based on position
	var edge_threshold = 16  # Smaller distance from edge to start transition
	
	# Check each edge
	if y < edge_threshold:  # Near north edge
		if x < edge_threshold:  # Northwest corner
			return neighbor_biomes["northwest"]
		elif x > region_size - edge_threshold:  # Northeast corner
			return neighbor_biomes["northeast"]
		else:  # North edge
			return neighbor_biomes["north"]
	elif y > region_size - edge_threshold:  # Near south edge
		if x < edge_threshold:  # Southwest corner
			return neighbor_biomes["southwest"]
		elif x > region_size - edge_threshold:  # Southeast corner
			return neighbor_biomes["southeast"]
		else:  # South edge
			return neighbor_biomes["south"]
	elif x < edge_threshold:  # Near west edge
		return neighbor_biomes["west"]
	elif x > region_size - edge_threshold:  # Near east edge
		return neighbor_biomes["east"]
	
	# Not near any edge, return empty string (use base biome)
	return ""

func _get_distance_to_edge(x: int, y: int, region_size: int) -> float:
	# Calculate minimum distance to any edge
	var dist_to_left = x
	var dist_to_right = region_size - x
	var dist_to_top = y
	var dist_to_bottom = region_size - y
	
	return min(min(dist_to_left, dist_to_right), min(dist_to_top, dist_to_bottom))

func _paint_detailed_terrain(tilemap: TileMap, world_tile: Vector2i, base_biome: String) -> void:
	print("[HB] Painting detailed terrain for biome: ", base_biome)
	
	# Use consistent world-coordinate-based generation
	var region_size = current_region_tiles  # Configurable regional tile count
	var world_scale = 128  # Each world tile = 128x128 region tiles
	
	# Calculate the world coordinate offset for this region
	var world_offset = Vector2(world_tile.x * world_scale, world_tile.y * world_scale)
	
	# Sample world-level features at high resolution
	var world_features = _sample_world_features_at_region(world_tile, region_size)
	
	for y in range(region_size):
		for x in range(region_size):
			# Calculate world coordinates for this regional tile
			var world_coord = world_offset + Vector2(x * 2, y * 2)  # 2x upscaling
			
			# Get detailed tile based on world features and biome
			var tile_id = _get_detailed_tile_consistent(base_biome, x, y, world_coord, world_features)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
			
			# Debug: Sample first few tiles to see what's being generated
			if x < 5 and y < 5:
				print("[HB] Tile (", x, ",", y, "): tile_id=", tile_id, " biome=", base_biome, " (0=water, 2=grass)")
			
			# Progress indicator for large regions
			if (x + y * region_size) % 50000 == 0:
				var progress = float(x + y * region_size) / float(region_size * region_size) * 100.0
				print("[HB] Region generation progress: ", int(progress), "%")
	
	print("[HB] Detailed terrain painted with world-consistent features: ", region_size, "x", region_size, " tiles")
	print("[HB] Total tiles generated: ", region_size * region_size, " (", (region_size * region_size) / 1000, "K tiles)")
	
	# Debug: Check if tiles were actually set (sample only first 100 for performance)
	var tiles_set = 0
	for y in range(min(10, region_size)):
		for x in range(min(10, region_size)):
			var cell_data = tilemap.get_cell_source_id(0, Vector2i(x, y))
			if cell_data != -1:
				tiles_set += 1
	print("[HB] Debug: ", tiles_set, " tiles set in first 10x10 sample")

func _sample_world_features_at_region(world_tile: Vector2i, region_size: int) -> Dictionary:
	# Sample the same noise functions used for world generation at higher resolution
	var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/worldgen/config.json"))
	var biome_table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/biomes/table.json"))
	
	var nf_cfg: Dictionary = cfg.duplicate(true)
	nf_cfg["lapse_rate"] = biome_table["lapse_rate"]
	
	# Use the same seed as world generation for consistency
	var fields := NoiseFields.new(nf_cfg, 12345)
	
	# Sample at higher resolution for this specific region
	var world_scale = 128
	var sample_rect = Rect2i(
		Vector2i(world_tile.x * world_scale, world_tile.y * world_scale),
		Vector2i(region_size * 2, region_size * 2)  # 2x higher resolution
	)
	
	var detailed_fields = fields.sample_fields(sample_rect, 0.5)  # Higher resolution scale
	
	# Generate rivers using flow accumulation at regional scale
	var hydro := CoastRiver.new()
	var regional_rivers = hydro.river_mask(
		detailed_fields["H"], 
		detailed_fields["w"], 
		detailed_fields["h"], 
		25,  # Lower threshold for more regional rivers
		float(biome_table["sea_level"])
	)
	
	return {
		"height": detailed_fields["H"],
		"moisture": detailed_fields["M"], 
		"temperature": detailed_fields["T"],
		"rivers": regional_rivers,
		"width": region_size * 2,
		"height_dim": region_size * 2
	}

func _get_detailed_tile_consistent(biome: String, x: int, y: int, world_coord: Vector2, world_features: Dictionary) -> int:
	# Sample the high-resolution world features
	var sample_x = clamp(int(x * 2), 0, world_features["width"] - 1)
	var sample_y = clamp(int(y * 2), 0, world_features["height_dim"] - 1)
	var idx = sample_y * world_features["width"] + sample_x
	
	var height = world_features["height"][idx] if idx < world_features["height"].size() else 0.5
	var moisture = world_features["moisture"][idx] if idx < world_features["moisture"].size() else 0.5
	var river_strength = world_features["rivers"][idx] if idx < world_features["rivers"].size() else 0
	
	# Debug: Check first few tiles to see river strength values
	if x < 3 and y < 3:
		print("[HB] Tile (", x, ",", y, ") river_strength=", river_strength, " height=", height, " moisture=", moisture)
	
	# Only create water for strong rivers and in appropriate biomes (tightened)
	if river_strength > 0.6 and (biome == "shallow_water" or biome == "deep_ocean"):
		if x < 3 and y < 3: print("[HB] Water tile created: moderate river in water biome")
		return 0  # water only for strong rivers in water biomes
	elif river_strength > 0.85:  # Very strong rivers can appear in any biome
		if x < 3 and y < 3: print("[HB] Water tile created: strong river")
		return 0  # water
	
	# Enhanced biome-specific terrain based on world data
	return _get_enhanced_biome_tile(biome, height, moisture, world_coord)

func _get_enhanced_biome_tile(biome: String, height: float, moisture: float, world_coord: Vector2) -> int:
	# Use world coordinates for consistent noise patterns
	var noise_x = world_coord.x * 0.02  # Larger scale for more coherent features
	var noise_y = world_coord.y * 0.02
	var terrain_noise = sin(noise_x) * cos(noise_y) * 0.5 + 0.5
	var detail_noise = sin(noise_x * 3.1) * cos(noise_y * 2.7) * 0.5 + 0.5
	var micro_noise = sin(noise_x * 8.3) * cos(noise_y * 6.1) * 0.5 + 0.5
	
	match biome:
		"grassland":
			# Grassland: 90% grass, 8% dirt, 2% special features
			var result_tile = 2  # default to grass
			if height < 0.1: 
				result_tile = 3  # dirt only in very low areas
			elif height > 0.95: 
				result_tile = 6  # rocks only on extremely high areas
			elif moisture > 0.9 and terrain_noise > 0.9: 
				result_tile = 5  # extremely rare forest patches
			elif detail_noise > 0.98: 
				result_tile = 14  # extremely rare paths
			elif detail_noise > 0.96: 
				result_tile = 15  # very rare flowers
			elif terrain_noise > 0.95: 
				result_tile = 3  # very rare dirt patches
			else: 
				result_tile = 2  # grass (DOMINANT - 90%+ of tiles)
			
			# Debug first few tiles
			if world_coord.x < 10 and world_coord.y < 10:
				print("[HB] Grassland tile at ", world_coord, ": height=", height, " moisture=", moisture, " -> tile_id=", result_tile)
			return result_tile
			
		"hills":
			# Hills: 80% rocks/stone, 15% gravel, 5% other
			if height > 0.4: return 4  # stone on peaks (very common)
			elif height > 0.2: return 6  # rocks on slopes (very common)
			elif detail_noise > 0.8: return 8  # gravel in valleys
			elif terrain_noise > 0.9: return 2  # rare grass
			elif micro_noise > 0.98: return 9  # extremely rare moss
			else: return 6  # rocks (DEFAULT - 80%+ of tiles)
			
		"beach":
			# Beach: 95% sand, 3% water, 2% other
			if height < 0.1 and moisture > 0.9: return 0  # water only in extremely low, wet areas
			elif detail_noise > 0.98: return 8  # extremely rare gravel
			elif micro_noise > 0.99: return 2  # extremely rare grass patches
			else: return 1  # sand (DOMINANT - 95%+ of tiles)
			
		"mountains":
			if height > 0.8: return 10  # snow on peaks
			elif height > 0.6: return 4  # stone
			elif terrain_noise > 0.7: return 6  # rocks
			elif height < 0.3: return 8  # gravel in valleys
			else: return 4  # stone (default)
			
		"beach":
			if height > 0.6 and moisture > 0.5: return 2  # grass on dunes
			elif terrain_noise > 0.8: return 8  # gravel patches
			else: return 1  # sand (default)
			
		"shallow_water":
			if height > 0.6: return 1  # sand at edges
			elif height > 0.4: return 8  # gravel transition
			else: return 0  # water
			
		"ocean":
			if height > 0.7: return 1  # sand at very edges
			else: return 0  # water
			
		_:
			return 2  # default grass

func _get_detailed_tile_for_biome_old(biome: String, x: int, y: int, rng: RandomNumberGenerator) -> int:
	# Create varied terrain within each biome type
	var noise = rng.randf()
	var distance_from_center = Vector2(x - 32, y - 32).length() / 32.0
	
	match biome:
		"grassland":
			if noise < 0.1: return 5  # forest patches
			elif noise < 0.15: return 14  # paths
			elif noise < 0.18: return 15  # flowers
			elif noise < 0.25: return 3  # dirt patches
			else: return 2  # grass
		"hills":
			if noise < 0.2: return 4  # stone outcrops
			elif noise < 0.3: return 6  # rocks
			elif noise < 0.4: return 3  # dirt
			elif noise < 0.6: return 2  # grass on hills
			else: return 9  # moss
		"mountains":
			if noise < 0.4: return 4  # stone
			elif noise < 0.6: return 6  # rocks
			elif noise < 0.8: return 8  # gravel
			else: return 10  # snow on peaks
		"beach":
			if noise < 0.7: return 1  # sand
			elif noise < 0.85: return 8  # gravel
			else: return 2  # grass patches
		"shallow_water":
			if distance_from_center > 0.7: return 1  # sand at edges
			else: return 0  # water
		"ocean":
			return 0  # water
		_:
			return 2  # default grass

func _clear_region_view() -> void:
	# Remove detailed region tilemap if it exists
	var detail_region = get_node_or_null("DetailRegion")
	# If the camera was parented under the DetailRegion, reparent it back to root BEFORE freeing
	if cam and is_instance_valid(cam):
		var cam_parent = cam.get_parent()
		if cam_parent and cam_parent != self:
			cam_parent.remove_child(cam)
			add_child(cam)
			cam.make_current()
	if detail_region:
		detail_region.queue_free()
		print("[HB] Removed DetailRegion tilemap")
	
	# DON'T remove player sprite during region transitions
	# Player sprite should persist across regions
	print("[HB] Keeping player sprite for region transition")
	
	# Clean up any debug elements
	for child in get_children():
		if child.name.begins_with("RegionMarker") or child.name.begins_with("DebugMarker"):
			child.queue_free()
	
	# Show world tilemap again
	if world_tilemap:
		world_tilemap.visible = true
		print("[HB] World tilemap made visible again")

func _create_player_sprite() -> void:
	# Create a simple red Sprite2D for the player in world space
	var img := Image.create(int(player_pixel_size.x), int(player_pixel_size.y), false, Image.FORMAT_RGBA8)
	img.fill(Color(1, 0, 0, 1))
	var tex := ImageTexture.create_from_image(img)
	player_sprite = Sprite2D.new()
	player_sprite.name = "Player"
	player_sprite.texture = tex
	player_sprite.centered = true  # Position refers to center
	player_sprite.z_index = 100
	# Parent to root so player persists across region transitions
	add_child(player_sprite)
	print("[HB] Player sprite created and parented to root")
	
	# Position player at the CENTER of the region (relative to the region's position)
	# Since the region is centered on the clicked pixel, the player should be at the region center
	var clicked_pixel = region_position  # This stores the clicked world pixel
	
	var detail_region = get_node_or_null("DetailRegion")
	if detail_region:
		var used_rect: Rect2i = detail_region.get_used_rect()
		var region_pixel_size = used_rect.size.x * TILE_PX  # assume square; use actual painted size
		
		# CRITICAL DEBUG: Let's trace through player positioning too
		print("[HB] === PLAYER POSITIONING DEBUG ===")
		var tilemap_center_tile = Vector2i(used_rect.position) + Vector2i(used_rect.size.x / 2, used_rect.size.y / 2)
		print("[HB] Detail region position: ", detail_region.position)
		print("[HB] Tilemap center tile: ", tilemap_center_tile)
		print("[HB] Player world center calculation:")
		print("[HB]   ", detail_region.position, " + ", tilemap_center_tile, " * ", TILE_PX)
		var tilemap_world_center = detail_region.position + Vector2(tilemap_center_tile.x * TILE_PX, tilemap_center_tile.y * TILE_PX)
		print("[HB]   = ", tilemap_world_center)
		print("[HB] Player sprite size (px): ", player_pixel_size)
		
		# Defer alignment to the final HARD ALIGN step after region painting
	else:
		print("[HB] ERROR: DetailRegion not found!")

func _return_to_world_view() -> void:
	print("[HB] Returning to world view...")
	current_mode = "world"
	
	# Stop Python background generation
	_stop_python_background_generation()
	
	_clear_region_view()
	
	# Reset camera to world view
	var tilemap_rect = world_tilemap.get_used_rect()
	var tilemap_center_tile = Vector2(tilemap_rect.position.x + tilemap_rect.size.x / 2.0, 
									  tilemap_rect.position.y + tilemap_rect.size.y / 2.0)
	var tilemap_center_world = world_tilemap.map_to_local(Vector2i(tilemap_center_tile))
	
	cam.position = tilemap_center_world
	cam.zoom = Vector2(0.1, 0.1)
	cam.rotation = 0.0
	
	print("[HB] Back to world view - click anywhere to zoom into a region!")

func _create_terrain_texture(img: Image, tile_index: int, color1: Color, color2: Color) -> void:
	# Create a 64x64 high-resolution terrain texture with truly random noise (no patterns)
	var start_x = tile_index * 64
	var rng = RandomNumberGenerator.new()
	rng.seed = tile_index * 12345  # Different seed per terrain type
	
	for x in range(64):
		for y in range(64):
			# Use pure random noise to eliminate all patterns
			var noise1 = rng.randf_range(-0.1, 0.1)
			var noise2 = rng.randf_range(-0.05, 0.05)
			
			# Add some very subtle organic variation
			var organic = sin((x + y) * 0.1) * 0.02
			
			# Combine for natural variation without patterns
			var blend = 0.5 + noise1 + noise2 + organic
			blend = clampf(blend, 0.0, 1.0)
			
			var final_color = color1.lerp(color2, blend)
			img.set_pixel(start_x + x, y, final_color)

func _check_nearby_water(x: int, y: int, height_data: PackedFloat32Array, size: int) -> bool:
	# Check 3x3 area around this tile for water (height < 0.4)
	for dy in range(-2, 3):
		for dx in range(-2, 3):
			var nx = x + dx
			var ny = y + dy
			if nx >= 0 and nx < size and ny >= 0 and ny < size:
				var idx = ny * size + nx
				if height_data[idx] < 0.4:
					return true
	return false

func _create_procedural_world() -> void:
	print("[HB] Creating procedural world...")
	
	# Generate world data using existing systems
	var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/worldgen/config.json"))
	var biome_table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/biomes/table.json"))
	
	var CH: int = cfg["chunk_size"]  # 128
	var rect: Rect2i = Rect2i(Vector2i(0, 0), Vector2i(CH, CH))
	
	var nf_cfg: Dictionary = cfg.duplicate(true)
	nf_cfg["lapse_rate"] = biome_table["lapse_rate"]
	
	# Use different seed to get different terrain and force proper height range
	var seed_val = randi() % 100000
	var fields := NoiseFields.new(nf_cfg, seed_val)
	var f: Dictionary = fields.sample_fields(rect, 1.0)
	
	# Force normalize height values to full 0.0-1.0 range
	var height_array = f["H"] as PackedFloat32Array
	var min_h = 1.0
	var max_h = 0.0
	for h in height_array:
		if h < min_h: min_h = h
		if h > max_h: max_h = h
	
	# Stretch to full range
	if max_h > min_h:
		for i in range(height_array.size()):
			height_array[i] = (height_array[i] - min_h) / (max_h - min_h)
		f["H"] = height_array
		print("[HB] Normalized height range from [", min_h, ",", max_h, "] to [0.0,1.0]")
	else:
		print("[HB] Height range too narrow, using manual distribution")
	
	# Debug final height values
	var final_height_array = f["H"] as PackedFloat32Array
	var final_min_h = 1.0
	var final_max_h = 0.0
	for h in final_height_array:
		if h < final_min_h: final_min_h = h
		if h > final_max_h: final_max_h = h
	print("[HB] Final height range: ", final_min_h, " to ", final_max_h, " (sea_level=", biome_table["sea_level"], ")")
	
	var bio := BiomeMap.new(biome_table)
	var biomes: PackedStringArray = bio.classify_fields(f["H"], f["M"], f["T"], f["w"], f["h"])
	
	print("[HB] Generated ", biomes.size(), " biome tiles with seed ", seed_val)
	
	# Create TileMap using the same working approach as the test
	var tilemap = TileMap.new()
	tilemap.name = "ProceduralWorld"
	add_child(tilemap)
	
	# Create simple biome-colored tileset
	var tileset = TileSet.new()
	var source = TileSetAtlasSource.new()
	
	# Create texture with biome colors (32x16 = 2 tiles wide, 1 tall)
	var img = Image.create(32, 16, false, Image.FORMAT_RGB8)
	
	# Water tile (0,0) - blue
	for x in range(16):
		for y in range(16):
			img.set_pixel(x, y, Color.BLUE)
	
	# Land tile (1,0) - green  
	for x in range(16, 32):
		for y in range(16):
			img.set_pixel(x, y, Color.GREEN)
	
	var tex = ImageTexture.new()
	tex.set_image(img)
	
	source.texture = tex
	source.texture_region_size = Vector2i(16, 16)
	source.create_tile(Vector2i(0, 0))  # Water
	source.create_tile(Vector2i(1, 0))  # Land
	
	tileset.add_source(source, 0)
	tilemap.tile_set = tileset
	
	# Paint tiles based on biome data
	print("[HB] Painting procedural tiles...")
	var water_count = 0
	var land_count = 0
	var biome_counts = {}
	
	for y in range(CH):
		for x in range(CH):
			var idx = y * CH + x
			var biome = biomes[idx]
			var tile_id = Vector2i(1, 0)  # Default to land
			
			# Count biome types for debugging
			if biome in biome_counts:
				biome_counts[biome] += 1
			else:
				biome_counts[biome] = 1
			
			# Check for water biomes (more comprehensive)
			if biome == "ocean" or biome == "sea" or biome == "lake" or biome == "water" or biome.contains("water"):
				tile_id = Vector2i(0, 0)  # Water (blue)
				water_count += 1
			else:
				land_count += 1
			
			tilemap.set_cell(0, Vector2i(x, y), 0, tile_id)
	
	# Debug: print all biome types found
	print("[HB] Biome distribution: ", biome_counts)
	
	# Center camera
	cam.position = Vector2(CH * 8, CH * 8)  # Center of 128x128 at 16px tiles
	cam.zoom = Vector2(0.5, 0.5)  # Zoom out to see more
	
	print("[HB] Procedural world created: ", water_count, " water, ", land_count, " land tiles")

func _create_simple_test_tilemap() -> void:
	print("[HB] Creating simple test tilemap...")
	
	# Create TileMap
	var tilemap = TileMap.new()
	tilemap.name = "TestTileMap"
	add_child(tilemap)
	
	# Create TileSet with colored tiles
	var tileset = TileSet.new()
	var source = TileSetAtlasSource.new()
	
	# Create a 32x32 texture with 4 colored 16x16 tiles
	var img = Image.create(32, 32, false, Image.FORMAT_RGB8)
	
	# Green tile (0,0)
	for x in range(16):
		for y in range(16):
			img.set_pixel(x, y, Color.GREEN)
	
	# Blue tile (1,0) 
	for x in range(16, 32):
		for y in range(16):
			img.set_pixel(x, y, Color.BLUE)
	
	# Brown tile (0,1)
	for x in range(16):
		for y in range(16, 32):
			img.set_pixel(x, y, Color(0.6, 0.4, 0.2))
	
	# Yellow tile (1,1)
	for x in range(16, 32):
		for y in range(16, 32):
			img.set_pixel(x, y, Color.YELLOW)
	
	var tex = ImageTexture.new()
	tex.set_image(img)
	
	source.texture = tex
	source.texture_region_size = Vector2i(16, 16)
	
	# Create tiles
	source.create_tile(Vector2i(0, 0))  # Green
	source.create_tile(Vector2i(1, 0))  # Blue  
	source.create_tile(Vector2i(0, 1))  # Brown
	source.create_tile(Vector2i(1, 1))  # Yellow
	
	tileset.add_source(source, 0)
	tilemap.tile_set = tileset
	
	# Paint a visible pattern
	print("[HB] Painting test pattern...")
	for x in range(64):
		for y in range(64):
			var tile_id = Vector2i(0, 0)  # Default green
			if x < 32 and y < 32:
				tile_id = Vector2i(0, 0)  # Green
			elif x >= 32 and y < 32:
				tile_id = Vector2i(1, 0)  # Blue
			elif x < 32 and y >= 32:
				tile_id = Vector2i(0, 1)  # Brown
			else:
				tile_id = Vector2i(1, 1)  # Yellow
			
			tilemap.set_cell(0, Vector2i(x, y), 0, tile_id)
	
	# Center camera on tilemap
	cam.position = Vector2(512, 512)  # 64*16/2 = 512
	cam.zoom = Vector2(1.0, 1.0)
	
	print("[HB] Simple tilemap created with 4096 tiles, camera at ", cam.position)

func _generate_chunk_00() -> void:
	# Mirrors GenHeadless.gd for in-editor run (single chunk 0,0)
	var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/worldgen/config.json"))
	var biome_table: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/biomes/table.json"))

	var tile_size: int = cfg["tile_size"]
	var CH: int = cfg["chunk_size"]
	var rect: Rect2i = Rect2i(Vector2i(0, 0), Vector2i(CH, CH))

	var nf_cfg: Dictionary = cfg.duplicate(true)
	nf_cfg["lapse_rate"] = biome_table["lapse_rate"]
	var fields := NoiseFields.new(nf_cfg, 12345)
	var f: Dictionary = fields.sample_fields(rect, 1.0)

	var bio := BiomeMap.new(biome_table)
	var biomes: PackedStringArray = bio.classify_fields(f["H"], f["M"], f["T"], f["w"], f["h"])

	var hydro := CoastRiver.new()
	var rivers: PackedByteArray = hydro.river_mask(f["H"], f["w"], f["h"], int(cfg["hydro"]["flow_threshold"]), float(biome_table["sea_level"]))

	var roads := PackedByteArray(); roads.resize(CH*CH); roads.fill(0)

	# Ensure output directories exist
	var da := DirAccess.open("res://")
	if da:
		da.make_dir_recursive("generated")
		da.make_dir_recursive("scenes/world")

	var painter := TilePainterSimple.new()
	var out_png := "res://generated/Chunk_0_0.png"
	painter.paint_png(Vector2i(0,0), biomes, rivers, roads, CH, CH, out_png)
	var out_scene := "res://scenes/world/Chunk_0_0.tscn"
	painter.build_chunk_scene(out_png, out_scene, tile_size, CH)
	print("[HB] Main generated: ", out_scene, ", png exists=", FileAccess.file_exists(out_png))

func _build_tilemap_chunk_00() -> void:
	var template := load("res://scenes/world/WorldChunk.tscn") as PackedScene
	if template == null:
		return
	var inst := template.instantiate()
	var painter_script := load("res://scripts/worldgen/TilePainter.gd")
	if painter_script == null:
		print("[HB] TilePainter script missing or failed to load; skipping.")
		return
	var painter = painter_script.new()
	painter.ground_tilemap = inst.get_node("GroundTileMap") as TileMap
	painter.cliff_tilemap = inst.get_node("CliffTileMap") as TileMap
	painter.water_tilemap = inst.get_node("WaterTileMap") as TileMap
	painter.deco_tilemap = inst.get_node("DecoTileMap") as TileMap
	var meta := "res://assets/atlas/tileset_metadata.json"
	if FileAccess.file_exists(meta):
		painter.load_tileset_metadata(meta)
	painter.paint_chunk_from_masks(0, 0, "generated/masks")
	# Also add PNG fallback as a background so visuals show even if TileSet mapping is empty
	var png_fallback := "res://generated/Chunk_0_0.png"
	if FileAccess.file_exists(png_fallback):
		var img := Image.load_from_file(png_fallback)
		if img:
			var tex := ImageTexture.create_from_image(img)
			var spr := Sprite2D.new()
			spr.texture = tex
			spr.centered = false
			spr.z_index = -100
			spr.scale = Vector2(16, 16)
			inst.add_child(spr)
	var ps := PackedScene.new()
	if ps.pack(inst) != OK:
		return
	var da := DirAccess.open("res://"); if da: da.make_dir_recursive("scenes/world")
	ResourceSaver.save(ps, "res://scenes/world/WorldChunk_0_0.tscn")

func _try_add_png_under(parent: Node) -> void:
	var png_path := "res://generated/Chunk_0_0.png"
	if not FileAccess.file_exists(png_path):
		return
	var img := Image.load_from_file(png_path)
	if img == null:
		return
	var tex := ImageTexture.create_from_image(img)
	var spr := Sprite2D.new()
	spr.texture = tex
	spr.centered = false
	spr.z_index = -100
	spr.scale = Vector2(16, 16)
	parent.add_child(spr)

func _hide_png_sprites(parent: Node) -> void:
	for child in parent.get_children():
		if child is Sprite2D:
			(child as Sprite2D).visible = false
		elif child is Node:
			_hide_png_sprites(child)

func _ensure_chunk_painted(chunk: Node) -> void:
	var ground_tm := chunk.get_node_or_null("GroundTileMap") as TileMap
	var cliff_tm := chunk.get_node_or_null("CliffTileMap") as TileMap
	var water_tm := chunk.get_node_or_null("WaterTileMap") as TileMap
	var deco_tm := chunk.get_node_or_null("DecoTileMap") as TileMap
	if ground_tm == null or cliff_tm == null or water_tm == null or deco_tm == null:
		return

	# Assign tileset if missing (prefer WorldTileSet, else DebugTileSet)
	if ground_tm.tile_set == null or cliff_tm.tile_set == null or water_tm.tile_set == null or deco_tm.tile_set == null:
		var ts: TileSet = null
		var world_path := "res://assets/tilesets/WorldTileSet.tres"
		var debug_path := "res://assets/tilesets/DebugTileSet.tres"
		if FileAccess.file_exists(world_path):
			ts = load(world_path) as TileSet
		elif FileAccess.file_exists(debug_path):
			ts = load(debug_path) as TileSet
		if ts != null:
			ground_tm.tile_set = ts
			cliff_tm.tile_set = ts
			water_tm.tile_set = ts
			deco_tm.tile_set = ts

	var painter_script := load("res://scripts/worldgen/TilePainter.gd")
	if painter_script == null:
		print("[HB] TilePainter script missing or failed to load; skipping.")
		return
	var painter = painter_script.new()
	painter.ground_tilemap = ground_tm
	painter.cliff_tilemap = cliff_tm
	painter.water_tilemap = water_tm
	painter.deco_tilemap = deco_tm
	var meta := "res://assets/atlas/tileset_metadata.json"
	if FileAccess.file_exists(meta):
		painter.load_tileset_metadata(meta)
	painter.paint_chunk_from_masks(0, 0, "generated/masks")


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		print("[HB] MOUSE EVENT: button=", event.button_index, " pressed=", event.pressed, " position=", event.position)
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_adjust_zoom(0.8)  # Zoom in faster
			return
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_adjust_zoom(1.25)  # Zoom out faster
			return
		elif event.button_index == MOUSE_BUTTON_MIDDLE and event.pressed:
			_reset_camera_view()  # Middle click to reset view
			return
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			rotating = event.pressed
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED if rotating else Input.MOUSE_MODE_VISIBLE)
		# Handle left-click for region selection  
		elif event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
			print("[HB] Left click detected! current_mode: ", current_mode)
			if current_mode == "world":
				print("[HB] In world mode - calling region handler")
				_handle_world_click(event.position)
			else:
				print("[HB] Not in world mode, ignoring click")
	elif event is InputEventMouseMotion and rotating:
		cam.rotation += -event.relative.x * 0.002 * rot_speed
	elif event is InputEventKey and event.pressed:
		if event.keycode == KEY_SPACE:
			_reset_camera_view()  # Spacebwar to reset view
		elif event.keycode == KEY_ESCAPE and current_mode == "region":
			_return_to_world_view()

func _adjust_zoom(mult: float) -> void:
	var old_zoom = cam.zoom
	var z := cam.zoom * mult
	# Much wider zoom range for the large world
	z.x = clampf(z.x, 0.01, 2.0)  # Can zoom out to see whole world, in to see detail
	z.y = clampf(z.y, 0.01, 2.0)
	cam.zoom = z
	print("[HB] Zoom changed from ", old_zoom, " to ", cam.zoom, " at global position ", cam.global_position)

func _process(dt: float) -> void:
	var dir := Vector2.ZERO
	if Input.is_action_pressed("ui_up") or Input.is_key_pressed(KEY_W):
		dir.y -= 1  # W = up (negative Y)
	if Input.is_action_pressed("ui_down") or Input.is_key_pressed(KEY_S):
		dir.y += 1  # S = down (positive Y)
	if Input.is_action_pressed("ui_left") or Input.is_key_pressed(KEY_A):
		dir.x -= 1  # A = left (negative X)
	if Input.is_action_pressed("ui_right") or Input.is_key_pressed(KEY_D):
		dir.x += 1  # D = right (positive X)
	
	# During the initial lock window, force camera and player to the computed center
	if current_mode == "region" and Time.get_ticks_msec() < region_lock_ms and player_sprite:
		var detail_region = get_node_or_null("DetailRegion")
		if detail_region:
			var used_rect: Rect2i = detail_region.get_used_rect()
			var center_tile: Vector2 = Vector2(used_rect.position) + Vector2(used_rect.size) * 0.5
			var region_center: Vector2 = detail_region.position + center_tile * TILE_PX
			player_sprite.global_position = region_center
			cam.global_position = region_center
			# Skip movement during lock to avoid early drift
			return

	# CRITICAL FIX: Only process movement if there's actual input
	if dir != Vector2.ZERO:
		dir = dir.normalized()
		
		if current_mode == "region" and player_sprite:
			# Move player in region mode
			var old_pos = player_sprite.global_position
			var movement = dir * move_speed * dt
			player_sprite.global_position += movement
			
			# Debug movement - only print if there's significant movement
			if movement.length() > 0.1:  # Only print if movement is more than 0.1 pixels
				print("[HB] Movement dir: ", dir, " -> movement: ", movement, " -> new pos: ", player_sprite.global_position)
			
			# Keep camera following player in region mode using GLOBAL coordinates
			cam.global_position = player_sprite.global_position
		else:
			# Move camera in world mode
			var rot := cam.rotation
			var forward := Vector2(0, -1).rotated(rot)
			var right := Vector2(1, 0).rotated(rot)
			var old_pos = cam.position
			cam.position += (forward * (-dir.y) + right * dir.x) * move_speed * dt
			print("[HB] Camera moved from ", old_pos, " to ", cam.position)
	
	# BOUNDARY DETECTION: Check if player is near region edges (guarded briefly after load)
	if current_mode == "region" and player_sprite and Time.get_ticks_msec() - region_entered_at_ms > 200:
		var detail_region = get_node_or_null("DetailRegion")
		if detail_region:
			# Compute region bounds from actual used_rect to avoid size mismatches
			var used_rect: Rect2i = detail_region.get_used_rect()
			var region_size_px: Vector2 = Vector2(float(used_rect.size.x) * TILE_PX, float(used_rect.size.y) * TILE_PX)
			var region_bounds = Rect2(detail_region.position, region_size_px)
			var player_center = player_sprite.global_position
			var boundary_threshold = TILE_PX * 32  # Start preloading much earlier (32 tiles)
			
			# CRITICAL FIX: Correct boundary detection logic
			var distance_to_edges = {
				"north": player_center.y - region_bounds.position.y,
				"south": (region_bounds.position.y + region_bounds.size.y) - player_center.y,
				"east": (region_bounds.position.x + region_bounds.size.x) - player_center.x,
				"west": player_center.x - region_bounds.position.x
			}
			
			# Check for edge proximity (reduced debug output)
			var triggered_edges = []
			for direction in distance_to_edges:
				var distance = distance_to_edges[direction]
				if distance < boundary_threshold:
					triggered_edges.append(direction)
					_prepare_adjacent_region(direction)
					# Kick off background preload immediately
					match direction:
						"north": _schedule_preload(region_position + Vector2i(0, -_current_region_pixel_size()))
						"south": _schedule_preload(region_position + Vector2i(0, _current_region_pixel_size()))
						"east": _schedule_preload(region_position + Vector2i(_current_region_pixel_size(), 0))
						"west": _schedule_preload(region_position + Vector2i(-_current_region_pixel_size(), 0))
			
			# Handle actual region transitions
			if not region_bounds.has_point(player_center):
				print("[HB] Player crossing region boundary!")
				_handle_region_transition(player_center, region_bounds)
			
			# Minimal debug output (only when something interesting happens)
			if triggered_edges.size() > 0:
				print("[HB] Player near edges: ", triggered_edges, " distances: ", distance_to_edges)

func _save_world_to_cache(cache_path: String, tilemap: TileMap) -> void:
	var file = FileAccess.open(cache_path, FileAccess.WRITE)
	if not file:
		print("[HB] Error: Could not create cache file")
		return
	
	# Save tilemap data
	var tilemap_rect = tilemap.get_used_rect()
	var cache_data = {
		"bounds": {"x": tilemap_rect.position.x, "y": tilemap_rect.position.y, "w": tilemap_rect.size.x, "h": tilemap_rect.size.y},
		"tiles": []
	}
	
	# Save all tile data
	for y in range(tilemap_rect.position.y, tilemap_rect.position.y + tilemap_rect.size.y):
		for x in range(tilemap_rect.position.x, tilemap_rect.position.x + tilemap_rect.size.x):
			var tile_pos = Vector2i(x, y)
			var source_id = tilemap.get_cell_source_id(0, tile_pos)
			var atlas_coords = tilemap.get_cell_atlas_coords(0, tile_pos)
			if source_id != -1:
				cache_data.tiles.append({"x": x, "y": y, "source": source_id, "atlas_x": atlas_coords.x, "atlas_y": atlas_coords.y})
	
	file.store_string(JSON.stringify(cache_data))
	file.close()

func _load_cached_world(cache_path: String) -> bool:
	var file = FileAccess.open(cache_path, FileAccess.READ)
	if not file:
		return false
	
	var json_string = file.get_as_text()
	file.close()
	
	var json = JSON.new()
	var parse_result = json.parse(json_string)
	if parse_result != OK:
		print("[HB] Error parsing cached world data")
		return false
	
	var cache_data = json.data
	
	# Create tilemap and tileset (same as original generation)
	var tilemap = TileMap.new()
	tilemap.name = "MassiveWorld"
	add_child(tilemap)
	
	# Create the same tileset as original
	var tileset = TileSet.new()
	var source = TileSetAtlasSource.new()
	
	# Create 6x1 texture with high-resolution terrain types (64x64 each)
	var img = Image.create(384, 64, false, Image.FORMAT_RGB8)
	
	# Create the same terrain textures
	_create_terrain_texture(img, 0, Color(0.0, 0.15, 0.4), Color(0.0, 0.25, 0.6))      # Deep Ocean
	_create_terrain_texture(img, 1, Color(0.1, 0.4, 0.7), Color(0.3, 0.6, 0.9))        # Shallow Water  
	_create_terrain_texture(img, 2, Color(0.85, 0.75, 0.55), Color(0.95, 0.85, 0.65))  # Beach/Sand
	_create_terrain_texture(img, 3, Color(0.2, 0.6, 0.15), Color(0.4, 0.8, 0.25))      # Grassland
	_create_terrain_texture(img, 4, Color(0.5, 0.35, 0.15), Color(0.7, 0.5, 0.25))     # Hills
	_create_terrain_texture(img, 5, Color(0.4, 0.4, 0.4), Color(0.6, 0.6, 0.6))        # Mountains
	
	var tex = ImageTexture.new()
	tex.set_image(img)
	source.texture = tex
	source.texture_region_size = Vector2i(64, 64)
	
	# Create tiles for each terrain type
	source.create_tile(Vector2i(0, 0))  # Deep Ocean
	source.create_tile(Vector2i(1, 0))  # Shallow Water
	source.create_tile(Vector2i(2, 0))  # Beach
	source.create_tile(Vector2i(3, 0))  # Grassland
	source.create_tile(Vector2i(4, 0))  # Hills
	source.create_tile(Vector2i(5, 0))  # Mountains
	
	tileset.add_source(source, 0)
	tilemap.tile_set = tileset
	
	# Load cached tiles
	print("[HB] Loading ", cache_data.tiles.size(), " cached tiles...")
	for tile_data in cache_data.tiles:
		var pos = Vector2i(tile_data.x, tile_data.y)
		var atlas_coords = Vector2i(tile_data.atlas_x, tile_data.atlas_y)
		tilemap.set_cell(0, pos, tile_data.source, atlas_coords)
	
	# Set up camera and world reference (same as original)
	var tilemap_rect = tilemap.get_used_rect()
	var tilemap_center_tile = Vector2(tilemap_rect.position.x + tilemap_rect.size.x / 2.0, 
									  tilemap_rect.position.y + tilemap_rect.size.y / 2.0)
	var tilemap_center_world = tilemap.map_to_local(Vector2i(tilemap_center_tile))
	
	cam.position = tilemap_center_world
	cam.zoom = Vector2(0.1, 0.1)
	
	world_tilemap = tilemap
	
	print("[HB] Cached world loaded successfully!")
	print("[HB] Camera positioned at: ", cam.position)
	print("[HB] Click on any area to zoom into high-detail regional view!")
	
	return true

func _prepare_adjacent_region(direction: String) -> void:
	# Start loading an adjacent region in the background
	# region_position now stores PIXEL coordinates, not tile coordinates
	var adjacent_world_pixel = region_position
	print("[HB] Preparing adjacent region in direction: ", direction, " from current PIXEL position: ", region_position)
	
	# Move by region size in pixels (128 tiles * 64 pixels = 8192 pixels per region)
	var region_size_pixels = _current_region_pixel_size()
	match direction:
		"north":
			adjacent_world_pixel += Vector2i(0, -region_size_pixels)
		"south":
			adjacent_world_pixel += Vector2i(0, region_size_pixels)
		"east":
			adjacent_world_pixel += Vector2i(region_size_pixels, 0)
		"west":
			adjacent_world_pixel += Vector2i(-region_size_pixels, 0)
	
	var region_key = _region_key_for_pixel(adjacent_world_pixel)
	print("[HB] Adjacent region key: ", region_key, " at world PIXEL: ", adjacent_world_pixel)
	
	# Only load if not already loaded or loading
	if not loaded_regions.has(region_key) and not region_cache.has(region_key):
		print("[HB] Pre-loading adjacent region (async): ", direction, " at ", adjacent_world_pixel)
		_start_preload(adjacent_world_pixel)

func _handle_region_transition(player_center: Vector2, current_bounds: Rect2) -> void:
	print("[HB] === REGION TRANSITION STARTED ===")
	print("[HB] Player center: ", player_center)
	print("[HB] Current bounds: ", current_bounds)
	
	# With 3x3 grid system, we don't need to transition - just load missing edge regions
	# Determine which direction player is moving and ensure those regions are loaded
	_ensure_edge_regions_loaded(player_center)
	return  # No more region swapping needed!

func _ensure_edge_regions_loaded(player_pos: Vector2) -> void:
	"""Ensure regions around player position are loaded."""
	var region_size_pixels = REGION_TILES * TILE_PX
	
	# Calculate which region the player is in
	var player_region_x = int(player_pos.x / region_size_pixels) * region_size_pixels
	var player_region_y = int(player_pos.y / region_size_pixels) * region_size_pixels
	var player_region_pixel = Vector2i(player_region_x, player_region_y)
	
	print("[HB] Player at ", player_pos, " is in region ", player_region_pixel)
	
	# Check if we need to load new regions around the player
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			var offset_x = dx * region_size_pixels
			var offset_y = dy * region_size_pixels
			var region_pixel = player_region_pixel + Vector2i(offset_x, offset_y)
			var region_name = "Region_" + str(region_pixel.x) + "_" + str(region_pixel.y)
			
			# Check if this region exists
			if not get_node_or_null(region_name):
				print("[HB] Loading missing region: ", region_name)
				_load_single_region(region_pixel, region_name)

func _load_single_region(region_pixel: Vector2i, region_name: String) -> void:
	"""Load a single region at the specified pixel position."""
	var region_size_pixels = REGION_TILES * TILE_PX
	
	# Create tilemap for this region
	var tm = TileMap.new()
	tm.name = region_name
	tm.tile_set = shared_detail_tileset
	tm.visible = true
	tm.z_index = 0
	
	# Position the tilemap correctly in world space
	var half_size = Vector2(region_size_pixels * 0.5, region_size_pixels * 0.5)
	tm.position = Vector2(region_pixel.x, region_pixel.y) - half_size
	
	add_child(tm)
	
	# Try to load from binary, fallback to old GDScript generation for comparison
	if not _try_load_region_bin(tm, region_pixel):
		print("[HB] Binary load failed for ", region_name, ", using old GDScript generation")
		_generate_old_style_region(tm, region_pixel)
	else:
		print("[HB] Successfully loaded binary region: ", region_name)
	_preload_next()

func _load_region_grid_3x3(center_world_pixel: Vector2i) -> void:
	"""Load a 3x3 grid of regions for seamless exploration."""
	print("[HB] Loading 3x3 region grid centered at: ", center_world_pixel)
	
	var region_size_pixels = REGION_TILES * TILE_PX  # 512 * 64 = 32768 pixels
	var loaded_count = 0
	
	# Load 9 regions in a 3x3 grid
	for dy in range(-1, 2):  # -1, 0, 1
		for dx in range(-1, 2):  # -1, 0, 1
			var offset_x = dx * region_size_pixels
			var offset_y = dy * region_size_pixels
			var region_pixel = center_world_pixel + Vector2i(offset_x, offset_y)
			
			var region_name = "Region_" + str(region_pixel.x) + "_" + str(region_pixel.y)
			print("[HB] Loading region ", region_name, " at pixel ", region_pixel)
			
			# Create tilemap for this region
			var tm = TileMap.new()
			tm.name = region_name
			tm.tile_set = shared_detail_tileset
			tm.visible = true
			tm.z_index = 0
			
			# Position the tilemap correctly in world space
			var half_size = Vector2(region_size_pixels * 0.5, region_size_pixels * 0.5)
			tm.position = Vector2(region_pixel.x, region_pixel.y) - half_size
			
			add_child(tm)
			
			# Try to load from binary, fallback to old GDScript generation for comparison
			if not _try_load_region_bin(tm, region_pixel):
				print("[HB] Binary load failed for ", region_name, ", using old GDScript generation")
				_generate_old_style_region(tm, region_pixel)
			else:
				print("[HB] Successfully loaded binary region: ", region_name)
				loaded_count += 1
	
	print("[HB] 3x3 grid complete: ", loaded_count, "/9 regions loaded from binary")
	
	# Set the center region as our main DetailRegion for compatibility
	var center_region = get_node_or_null("Region_" + str(center_world_pixel.x) + "_" + str(center_world_pixel.y))
	if center_region:
		center_region.name = "DetailRegion"  # Rename for compatibility
		detail_tilemap = center_region

func _create_placeholder_region(tilemap: TileMap) -> void:
	"""Create instant placeholder region for testing."""
	print("[HB] Creating instant placeholder region")
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	# Create a simple pattern for testing
	for y in range(64):  # Small test region
		for x in range(64):
			positions.append(Vector2i(x, y))
			# Alternate between grass (2) and dirt (3)
			var tile_id = 2 if (x + y) % 2 == 0 else 3
			atlas_coords.append(Vector2i(tile_id, 0))
	
	# Use individual set_cell calls since set_cells doesn't exist in Godot 4.x
	for i in range(positions.size()):
		tilemap.set_cell(0, positions[i], 0, atlas_coords[i])
	print("[HB] Placeholder region created with ", positions.size(), " tiles")

func _try_load_region_bin(tilemap: TileMap, world_pixel: Vector2i) -> bool:
	var key := _region_key_for_pixel(world_pixel)
	
	# Try multiple paths for binary regions
	var paths = [
		"user://regions/" + key + ".bin",
		"./user/regions/" + key + ".bin", 
		"./regions/" + key + ".bin"
	]
	
	# Debug: Show what user:// resolves to
	print("[HB] user:// resolves to: ", OS.get_user_data_dir())
	print("[HB] Checking paths for key: ", key)
	for test_path in paths:
		var exists = FileAccess.file_exists(test_path)
		print("[HB]   ", test_path, " exists: ", exists)
		if exists:
			var file_size = FileAccess.get_file_as_bytes(test_path).size()
			print("[HB]     File size: ", file_size, " bytes")
	
	var path := ""
	for test_path in paths:
		if FileAccess.file_exists(test_path):
			path = test_path
			break
	
	if path == "":
		print("[HB] No binary region found for key: ", key)
		print("[HB] Tried paths: ", paths)
		return false
		
	print("[HB] Loading binary region: ", path)
	var start_time := Time.get_ticks_msec()
	
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		print("[HB] ERROR: Failed to open file: ", path)
		return false
		
	print("[HB] Successfully opened binary file: ", path)
	
	# Minimal format: u32 magic, u16 ver, i32 tiles, i32 tile_px, followed by tiles (u8) row-major
	var magic = f.get_32()
	print("[HB] Magic number read: 0x", String.num_uint64(magic, 16), " (expected: 0x5245474E)")
	if magic != 0x5245474E:  # 'REGN'
		print("[HB] ERROR: Invalid magic number in binary file")
		f.close()
		return false
		
	var ver := f.get_16()
	var tiles := f.get_32()
	var tpx := f.get_32()
	if tiles <= 0 or tiles > 4096:
		f.close()
		return false
	
	# FAST BATCH LOADING - read all tiles into arrays first
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	# Pre-allocate for maximum performance
	positions.resize(tiles * tiles)
	atlas_coords.resize(tiles * tiles)
	
	var tile_count := 0
	for y in range(tiles):
		for x in range(tiles):
			var id : int = f.get_8()
			if id >= 0 and id < 16:  # Valid tile range (0-15 for 16 terrain types)
				positions[tile_count] = Vector2i(x, y)
				atlas_coords[tile_count] = Vector2i(id, 0)
				tile_count += 1
	
	f.close()
	
	# Resize to actual count
	positions.resize(tile_count)
	atlas_coords.resize(tile_count)
	
	# FAST INDIVIDUAL PAINTING - use set_cell calls with yielding to prevent hanging
	if tile_count > 0:
		print("[HB] Painting ", tile_count, " tiles...")
		for i in range(tile_count):
			tilemap.set_cell(0, positions[i], 0, atlas_coords[i])
			# Print progress every 10000 tiles
			if i % 10000 == 0:
				print("[HB] Progress: ", i, "/", tile_count, " tiles painted")
		print("[HB] Finished painting ", tile_count, " tiles")
	
	var elapsed := Time.get_ticks_msec() - start_time
	print("[HB] INSTANT BINARY LOAD: ", tile_count, " tiles in ", elapsed, "ms")
	
	return true

func _generate_old_style_region(tilemap: TileMap, world_pixel: Vector2i) -> void:
	"""Generate region using the old GDScript method for comparison."""
	print("[HB] Generating old-style region at: ", world_pixel)
	
	# Convert pixel to world tile for biome lookup
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var world_biome = _get_world_tile_biome(world_tile)
	var neighbor_biomes = _get_neighbor_biomes(world_tile)
	
	print("[HB] Old-style: world_tile=", world_tile, " biome=", world_biome)
	
	# Generate using old detailed terrain logic (simplified)
	var region_size = 64  # Small size for testing
	var world_scale = 128
	var world_offset = Vector2(world_tile.x * world_scale, world_tile.y * world_scale)
	var world_features = _sample_world_features_at_region(world_tile, region_size)
	
	for y in range(region_size):
		for x in range(region_size):
			var world_coord = world_offset + Vector2(x * 2, y * 2)
			var tile_id = _get_detailed_tile_consistent(world_biome, x, y, world_coord, world_features)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
	
	print("[HB] Old-style region generation complete")
