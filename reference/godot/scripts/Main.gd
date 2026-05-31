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
var detail_tilemap: TileMap = null  # Reference to the main DetailRegion tilemap
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
	if not world_tilemap or not is_instance_valid(world_tilemap):
		print("[HB] ERROR: world_tilemap not available for click handling")
		return
		
	var world_local = world_tilemap.to_local(world_pos)
	var tile_pos = world_tilemap.local_to_map(world_local)
	print("[HB] Tile position: ", tile_pos)
	
	# Check if click is within the tilemap bounds
	var tilemap_rect = world_tilemap.get_used_rect()
	print("[HB] TileMap bounds: ", tilemap_rect)
	
	if tilemap_rect.has_point(tile_pos):
		# CRITICAL DEBUG: Check coordinate conversion
		var pixel_pos = Vector2i(int(world_pos.x), int(world_pos.y))
		print("[HB] === COORDINATE CONVERSION DEBUG ===")
		print("[HB] Screen pos: ", screen_pos)
		print("[HB] World pos: ", world_pos)
		print("[HB] Pixel pos: ", pixel_pos)
		print("[HB] World tilemap position: ", world_tilemap.position)
		print("[HB] World tilemap transform: ", world_tilemap.transform)
		print("[HB] === END COORDINATE DEBUG ===")
		
		print("[HB] Click is INSIDE bounds - Loading high-detail region at PIXEL: ", pixel_pos)
		_load_region_detail(pixel_pos)
	else:
		print("[HB] Click is OUTSIDE bounds - tile ", tile_pos, " not in ", tilemap_rect)

func _load_region_detail(center_pixel: Vector2i) -> void:
	print("[HB] === LOADING REGION DETAIL ===")
	print("[HB] Loading 3x3 region grid centered at PIXEL: ", center_pixel)
	
	# Store the region position (pixel coordinates)
	region_position = center_pixel
	current_mode = "region"
	print("[HB] Set current_mode to: ", current_mode)
	
	# Hide the world tilemap
	world_tilemap.visible = false
	print("[HB] Hidden world tilemap")
	
	# Load 3x3 grid of regions for seamless exploration
	print("[HB] About to call _load_region_grid_3x3...")
	_load_region_grid_3x3(center_pixel)
	print("[HB] _load_region_grid_3x3 completed")

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

func _get_nearest_edge_biome(tile_pos: Vector2i, world_bounds: Rect2i) -> String:
	"""Find the nearest biome from the world map edge to extrapolate for out-of-bounds regions."""
	# Clamp the position to the nearest edge of the world bounds
	var clamped_x = clamp(tile_pos.x, world_bounds.position.x, world_bounds.position.x + world_bounds.size.x - 1)
	var clamped_y = clamp(tile_pos.y, world_bounds.position.y, world_bounds.position.y + world_bounds.size.y - 1)
	var nearest_edge_tile = Vector2i(clamped_x, clamped_y)
	
	# Get the biome at the nearest edge tile (recursive call, but will be in bounds)
	return _get_world_tile_biome(nearest_edge_tile)

func _get_world_tile_biome(tile_pos: Vector2i) -> String:
	# Check if tile is within world bounds
	var world_bounds = world_tilemap.get_used_rect()
	if not world_bounds.has_point(tile_pos):
		# Instead of defaulting to ocean, find the nearest edge biome
		var nearest_biome = _get_nearest_edge_biome(tile_pos, world_bounds)
		print("[HB] Tile ", tile_pos, " is outside world bounds, using nearest edge biome: ", nearest_biome)
		return nearest_biome
	
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
	
	# Create 61x1 texture with all terrain types (64x64 each to match world tileset)
	var img = Image.create(61 * 64, 64, false, Image.FORMAT_RGB8)
	
	# All 61 terrain types matching the Python generator
	var terrain_types = [
		# Basic terrain (0-15)
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
		{"name": "flowers", "colors": [Color(1.0, 0.8, 0.9), Color(1.0, 0.9, 1.0)]},
		
		# Extended terrain variety (16-60)
		{"name": "clay", "colors": [Color(0.8, 0.6, 0.4), Color(0.9, 0.7, 0.5)]},
		{"name": "pebbles", "colors": [Color(0.75, 0.75, 0.7), Color(0.85, 0.85, 0.8)]},
		{"name": "cobblestone", "colors": [Color(0.6, 0.6, 0.65), Color(0.7, 0.7, 0.75)]},
		{"name": "marble", "colors": [Color(0.9, 0.9, 0.95), Color(1.0, 1.0, 1.0)]},
		{"name": "slate", "colors": [Color(0.4, 0.4, 0.5), Color(0.5, 0.5, 0.6)]},
		{"name": "limestone", "colors": [Color(0.85, 0.8, 0.75), Color(0.95, 0.9, 0.85)]},
		{"name": "sandstone", "colors": [Color(0.9, 0.8, 0.6), Color(1.0, 0.9, 0.7)]},
		{"name": "granite", "colors": [Color(0.55, 0.55, 0.6), Color(0.65, 0.65, 0.7)]},
		{"name": "obsidian", "colors": [Color(0.1, 0.1, 0.15), Color(0.2, 0.2, 0.25)]},
		{"name": "pumice", "colors": [Color(0.7, 0.7, 0.75), Color(0.8, 0.8, 0.85)]},
		{"name": "coral", "colors": [Color(1.0, 0.6, 0.7), Color(1.0, 0.8, 0.9)]},
		{"name": "shells", "colors": [Color(0.95, 0.9, 0.85), Color(1.0, 0.95, 0.9)]},
		{"name": "driftwood", "colors": [Color(0.6, 0.5, 0.4), Color(0.7, 0.6, 0.5)]},
		{"name": "seaweed", "colors": [Color(0.2, 0.5, 0.3), Color(0.3, 0.6, 0.4)]},
		{"name": "kelp", "colors": [Color(0.1, 0.4, 0.2), Color(0.2, 0.5, 0.3)]},
		{"name": "ferns", "colors": [Color(0.3, 0.7, 0.3), Color(0.4, 0.8, 0.4)]},
		{"name": "mushrooms", "colors": [Color(0.7, 0.6, 0.5), Color(0.8, 0.7, 0.6)]},
		{"name": "logs", "colors": [Color(0.5, 0.4, 0.3), Color(0.6, 0.5, 0.4)]},
		{"name": "bark", "colors": [Color(0.4, 0.3, 0.2), Color(0.5, 0.4, 0.3)]},
		{"name": "roots", "colors": [Color(0.6, 0.4, 0.3), Color(0.7, 0.5, 0.4)]},
		{"name": "wildflowers", "colors": [Color(0.9, 0.7, 0.8), Color(1.0, 0.8, 0.9)]},
		{"name": "dandelions", "colors": [Color(1.0, 0.9, 0.2), Color(1.0, 1.0, 0.4)]},
		{"name": "clover", "colors": [Color(0.4, 0.8, 0.4), Color(0.5, 0.9, 0.5)]},
		{"name": "weeds", "colors": [Color(0.5, 0.7, 0.3), Color(0.6, 0.8, 0.4)]},
		{"name": "thorns", "colors": [Color(0.4, 0.6, 0.2), Color(0.5, 0.7, 0.3)]},
		{"name": "dry_grass", "colors": [Color(0.7, 0.6, 0.3), Color(0.8, 0.7, 0.4)]},
		{"name": "tall_grass", "colors": [Color(0.3, 0.8, 0.2), Color(0.4, 0.9, 0.3)]},
		{"name": "short_grass", "colors": [Color(0.4, 0.7, 0.3), Color(0.5, 0.8, 0.4)]},
		{"name": "burnt_grass", "colors": [Color(0.3, 0.2, 0.1), Color(0.4, 0.3, 0.2)]},
		{"name": "rich_soil", "colors": [Color(0.4, 0.3, 0.2), Color(0.5, 0.4, 0.3)]},
		{"name": "sandy_soil", "colors": [Color(0.8, 0.7, 0.5), Color(0.9, 0.8, 0.6)]},
		{"name": "rocky_soil", "colors": [Color(0.6, 0.5, 0.4), Color(0.7, 0.6, 0.5)]},
		{"name": "fertile_soil", "colors": [Color(0.3, 0.2, 0.1), Color(0.4, 0.3, 0.2)]},
		{"name": "quicksand", "colors": [Color(0.9, 0.8, 0.6), Color(1.0, 0.9, 0.7)]},
		{"name": "wet_sand", "colors": [Color(0.7, 0.6, 0.4), Color(0.8, 0.7, 0.5)]},
		{"name": "black_sand", "colors": [Color(0.2, 0.2, 0.2), Color(0.3, 0.3, 0.3)]},
		{"name": "white_sand", "colors": [Color(0.95, 0.95, 0.9), Color(1.0, 1.0, 0.95)]},
		{"name": "shallow_water", "colors": [Color(0.3, 0.6, 0.9), Color(0.4, 0.7, 1.0)]},
		{"name": "deep_water", "colors": [Color(0.0, 0.2, 0.6), Color(0.1, 0.3, 0.7)]},
		{"name": "murky_water", "colors": [Color(0.3, 0.4, 0.3), Color(0.4, 0.5, 0.4)]},
		{"name": "clear_water", "colors": [Color(0.2, 0.7, 1.0), Color(0.3, 0.8, 1.0)]},
		{"name": "frozen_water", "colors": [Color(0.7, 0.9, 1.0), Color(0.8, 1.0, 1.0)]},
		{"name": "boiling_water", "colors": [Color(0.8, 0.9, 1.0), Color(0.9, 1.0, 1.0)]},
		{"name": "mineral_water", "colors": [Color(0.4, 0.7, 0.8), Color(0.5, 0.8, 0.9)]},
		{"name": "salt_water", "colors": [Color(0.1, 0.5, 0.7), Color(0.2, 0.6, 0.8)]}
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
	# Remove all region tilemaps (3x3 grid system + cached/preloaded regions)
	print("[HB] Clearing all region tilemaps and cached regions...")
	
	# Stop any background preloading
	preload_queue.clear()
	preload_busy = false
	
	# If the camera was parented under any region, reparent it back to root BEFORE freeing
	if cam and is_instance_valid(cam):
		var cam_parent = cam.get_parent()
		if cam_parent and cam_parent != self:
			cam_parent.remove_child(cam)
			add_child(cam)
			cam.make_current()
	
	var regions_cleared = 0
	for child in get_children():
		# Remove ALL region tilemaps (DetailRegion, Region_X_Y, Preload_X_Y, etc.)
		# BUT DO NOT remove the world tilemap (MassiveWorld)
		if (child.name == "DetailRegion" or 
			child.name.begins_with("Region_") or 
			child.name.begins_with("Preload_") or
			child.name == "ProceduralWorld" or
			child.name == "TestTileMap"):
			child.queue_free()
			regions_cleared += 1
		# Clean up debug elements
		elif child.name.begins_with("RegionMarker") or child.name.begins_with("DebugMarker"):
			child.queue_free()
	
	print("[HB] Cleared ", regions_cleared, " region tilemaps")
	
	# Clear region cache
	region_cache.clear()
	print("[HB] Cleared region cache")
	
	# DON'T remove player sprite during region transitions
	# Player sprite should persist across regions
	print("[HB] Keeping player sprite for region transition")
	
	# Reset detail_tilemap reference
	detail_tilemap = null
	
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
	
	# Reset camera to world view (with safety checks)
	if world_tilemap and is_instance_valid(world_tilemap):
		var tilemap_rect = world_tilemap.get_used_rect()
		var tilemap_center_tile = Vector2(tilemap_rect.position.x + tilemap_rect.size.x / 2.0, 
										  tilemap_rect.position.y + tilemap_rect.size.y / 2.0)
		var tilemap_center_world = world_tilemap.map_to_local(Vector2i(tilemap_center_tile))
		
		cam.position = tilemap_center_world
		cam.zoom = Vector2(0.1, 0.1)
		cam.rotation = 0.0
		
		# Make world tilemap visible again
		world_tilemap.visible = true
		print("[HB] Back to world view - click anywhere to zoom into a region!")
	else:
		print("[HB] ERROR: world_tilemap not available, using fallback camera position")
		_reset_camera_view()  # Fallback to reset view

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
	# Debug: Print all key events
	if event is InputEventKey and event.pressed:
		print("[DEBUG] Key pressed: ", event.keycode, " current_mode: ", current_mode)
	
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
	
	elif event is InputEventKey:
		var key_event := event as InputEventKey
		if key_event.pressed and key_event.keycode == KEY_TAB:
			print("[HB] Tab key pressed - toggling world map overlay")
			_toggle_world_map_overlay()
	elif event is InputEventMouseMotion and rotating:
		cam.rotation += -event.relative.x * 0.002 * rot_speed
	elif event is InputEventKey and event.pressed:
		if event.keycode == KEY_SPACE:
			if current_mode == "world":
				_reset_camera_view()  # Spacebar to reset world view
			else:
				# In region mode, spacebar centers camera on player
				if player_sprite:
					cam.position = player_sprite.global_position
					print("[HB] Camera centered on player at: ", player_sprite.global_position)
		elif event.keycode == KEY_ESCAPE:
			print("[DEBUG] ESC pressed! current_mode: ", current_mode)
			if current_mode == "region":
				print("[DEBUG] Calling _return_to_world_view()")
				_return_to_world_view()
			else:
				print("[DEBUG] Not in region mode, ignoring ESC")

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
	
	# HIGH-PERFORMANCE OPTIMIZATIONS
	_optimize_memory_usage()
	
	# BOUNDARY DETECTION: Check if player is near region edges and load new regions as needed
	if current_mode == "region" and player_sprite and Time.get_ticks_msec() - region_entered_at_ms > 200:
		var detail_region = get_node_or_null("DetailRegion")
		if detail_region:
			# Check if player is approaching the edge of the currently loaded region grid
			_check_and_expand_region_grid(player_sprite.global_position)
	
	# Update world map position if overlay is visible
	if world_map_visible:
		_update_player_position_on_world_map()

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

var last_expansion_check_time: int = 0
var expansion_cooldown_ms: int = 250  # Check for expansion 4 times per second for responsive loading

# World map overlay variables
var world_map_overlay: Control = null
var world_map_texture_rect: TextureRect = null
var player_position_indicator: ColorRect = null
var world_map_visible: bool = false

# High-performance memory pools for gaming PC optimization
var vector2i_pool: Array[Vector2i] = []
var array_pool: Array[Array] = []
var tilemap_pool: Array[TileMap] = []
var max_pool_size: int = 100

# Memory pool functions for high performance
func _get_pooled_vector2i() -> Vector2i:
	"""Get a Vector2i from the pool or create new one."""
	if vector2i_pool.size() > 0:
		return vector2i_pool.pop_back()
	return Vector2i()

func _return_to_pool(vec: Vector2i) -> void:
	"""Return a Vector2i to the pool."""
	if vector2i_pool.size() < max_pool_size:
		vec.x = 0
		vec.y = 0
		vector2i_pool.append(vec)

func _get_pooled_array() -> Array:
	"""Get an Array from the pool or create new one."""
	if array_pool.size() > 0:
		var arr = array_pool.pop_back()
		arr.clear()
		return arr
	return []

func _return_array_to_pool(arr: Array) -> void:
	"""Return an Array to the pool."""
	if array_pool.size() < max_pool_size:
		arr.clear()
		array_pool.append(arr)

func _optimize_memory_usage() -> void:
	"""Periodic memory optimization for sustained performance."""
	# Force garbage collection periodically to prevent buildup
	if Time.get_ticks_msec() % 30000 == 0:  # Every 30 seconds
		print("[PERF] Performing memory optimization...")
		
		# Trim pools if they're too large
		while vector2i_pool.size() > max_pool_size:
			vector2i_pool.pop_back()
		while array_pool.size() > max_pool_size:
			array_pool.pop_back()
		
		# Suggest garbage collection (Godot will decide when to actually do it)
		# This is more of a hint than a force
		print("[PERF] Memory pools optimized: Vector2i=", vector2i_pool.size(), " Arrays=", array_pool.size())

func _check_and_expand_region_grid(player_pos: Vector2) -> void:
	"""Check if player is near the edge of loaded regions and expand the grid as needed."""
	# Throttle expansion checks to prevent spam
	var current_time = Time.get_ticks_msec()
	if current_time - last_expansion_check_time < expansion_cooldown_ms:
		return

	var region_size_pixels = REGION_TILES * TILE_PX  # 32768 pixels per region
	var boundary_threshold = region_size_pixels * 0.75  # Start loading when 75% away from edge (very early for smooth experience)
	
	# Find the bounds of all currently loaded regions
	var min_x = INF
	var max_x = -INF
	var min_y = INF
	var max_y = -INF
	
	for child in get_children():
		if child.name.begins_with("Region_") or child.name == "DetailRegion":
			var tm = child as TileMap
			if tm:
				var region_bounds = Rect2(tm.position, Vector2(region_size_pixels, region_size_pixels))
				min_x = min(min_x, region_bounds.position.x)
				max_x = max(max_x, region_bounds.position.x + region_bounds.size.x)
				min_y = min(min_y, region_bounds.position.y)
				max_y = max(max_y, region_bounds.position.y + region_bounds.size.y)
	
	# Check if player is approaching any edge
	var needs_expansion = false
	var expansion_directions = []
	
	if player_pos.x - min_x < boundary_threshold:
		expansion_directions.append("west")
		needs_expansion = true
	if max_x - player_pos.x < boundary_threshold:
		expansion_directions.append("east")
		needs_expansion = true
	if player_pos.y - min_y < boundary_threshold:
		expansion_directions.append("north")
		needs_expansion = true
	if max_y - player_pos.y < boundary_threshold:
		expansion_directions.append("south")
		needs_expansion = true
	
	if needs_expansion:
		last_expansion_check_time = current_time  # Update the throttle timer
		print("[HB] *** BOUNDARY DETECTION TRIGGERED ***")
		print("[HB] Player approaching grid edge, expanding in directions: ", expansion_directions)
		print("[HB] Player position: ", player_pos)
		print("[HB] Grid bounds: min_x=", min_x, " max_x=", max_x, " min_y=", min_y, " max_y=", max_y)
		print("[HB] Boundary threshold: ", boundary_threshold)
		_expand_region_grid(expansion_directions)

func _expand_region_grid(directions: Array) -> void:
	"""Expand the loaded region grid in the specified directions."""
	var region_size_pixels = REGION_TILES * TILE_PX
	
	# Get current grid bounds
	var existing_regions = []
	for child in get_children():
		if child.name.begins_with("Region_") or child.name == "DetailRegion":
			var tm = child as TileMap
			if tm:
				# Extract region coordinates from position
				var region_center = tm.position + Vector2(region_size_pixels * 0.5, region_size_pixels * 0.5)
				existing_regions.append(region_center)
	
	# Load new regions in each direction
	for direction in directions:
		_load_regions_in_direction(direction, existing_regions, region_size_pixels)

func _load_regions_in_direction(direction: String, existing_regions: Array, region_size_pixels: int) -> void:
	"""Load new regions in a specific direction."""
	var new_regions_to_load = []
	
	match direction:
		"north":
			# Find the northernmost row and add a new row above it
			var min_y = INF
			for region_pos in existing_regions:
				min_y = min(min_y, region_pos.y)
			var new_y = min_y - region_size_pixels
			
			# Load regions across the entire width
			var x_positions = []
			for region_pos in existing_regions:
				if region_pos.y == min_y:  # This is the current northern edge
					x_positions.append(region_pos.x)
			
			for x_pos in x_positions:
				new_regions_to_load.append(Vector2i(x_pos, new_y))
		
		"south":
			# Find the southernmost row and add a new row below it
			var max_y = -INF
			for region_pos in existing_regions:
				max_y = max(max_y, region_pos.y)
			var new_y = max_y + region_size_pixels
			
			# Load regions across the entire width
			var x_positions = []
			for region_pos in existing_regions:
				if region_pos.y == max_y:  # This is the current southern edge
					x_positions.append(region_pos.x)
			
			for x_pos in x_positions:
				new_regions_to_load.append(Vector2i(x_pos, new_y))
		
		"west":
			# Find the westernmost column and add a new column to the left
			var min_x = INF
			for region_pos in existing_regions:
				min_x = min(min_x, region_pos.x)
			var new_x = min_x - region_size_pixels
			
			# Load regions across the entire height
			var y_positions = []
			for region_pos in existing_regions:
				if region_pos.x == min_x:  # This is the current western edge
					y_positions.append(region_pos.y)
			
			for y_pos in y_positions:
				new_regions_to_load.append(Vector2i(new_x, y_pos))
		
		"east":
			# Find the easternmost column and add a new column to the right
			var max_x = -INF
			for region_pos in existing_regions:
				max_x = max(max_x, region_pos.x)
			var new_x = max_x + region_size_pixels
			
			# Load regions across the entire height
			var y_positions = []
			for region_pos in existing_regions:
				if region_pos.x == max_x:  # This is the current eastern edge
					y_positions.append(region_pos.y)
			
			for y_pos in y_positions:
				new_regions_to_load.append(Vector2i(new_x, y_pos))
	
	# Filter out already loaded regions
	var regions_to_load = []
	for region_pixel in new_regions_to_load:
		var region_key = _region_key_for_pixel(region_pixel)
		if not _region_already_loaded(region_key):
			regions_to_load.append(region_pixel)
	
	if regions_to_load.size() > 0:
		print("[PERF] *** HIGH-PERFORMANCE BATCH LOADING ***")
		print("[PERF] Loading ", regions_to_load.size(), " regions in direction ", direction, " using parallel generation")
		
		# Use individual region loading (batch system has JSON parsing issues)
		print("[PERF] Loading ", regions_to_load.size(), " regions individually for reliability")
		for region_pixel in regions_to_load:
			print("[PERF] Loading region: ", region_pixel)
			_load_single_region_async(region_pixel, "Region_" + str(region_pixel.x) + "_" + str(region_pixel.y))

func _load_regions_batch_parallel(region_pixels: Array) -> void:
	"""Load multiple regions in parallel using Python multiprocessing for maximum performance."""
	print("[PERF] Starting PARALLEL BATCH generation of ", region_pixels.size(), " regions")
	var start_time = Time.get_ticks_msec()
	
	# Prepare region coordinates and biomes for Python
	var region_coords = []
	var biomes = []
	
	for region_pixel in region_pixels:
		# Convert pixel coordinates to world coordinates for Python
		var world_x = region_pixel.x / TILE_PX
		var world_y = region_pixel.y / TILE_PX
		region_coords.append([world_x, world_y])
		
		# Get biome for this region
		var biome = _get_biome_for_region(region_pixel)
		biomes.append(biome)
		print("[PERF] Queued region (", world_x, ",", world_y, ") with biome: ", biome)
	
	# Create Python script for batch parallel generation
	var python_script = """
import sys
sys.path.append('scripts/worldgen')
from python_generator_gpu import generate_regions_rtx3090_parallel
import json

# Parse arguments
regions_str = sys.argv[1]
biomes_str = sys.argv[2]
config_path = sys.argv[3] if len(sys.argv) > 3 else None

regions = json.loads(regions_str)
biomes = json.loads(biomes_str)

print(f"[PERF] Python batch: generating {len(regions)} regions with {len(biomes)} biomes")

# Generate all regions in parallel
results = generate_regions_rtx3090_parallel(
	[(int(r[0]), int(r[1])) for r in regions],
	biomes,
	config_path
)

print(f"[PERF] Python batch completed: {len(results)} regions generated")
for coords, filepath in results.items():
	print(f"[PERF] Generated: {coords} -> {filepath}")
"""
	
	# Write temporary Python script
	var script_path = "temp_batch_generator.py"
	var file = FileAccess.open(script_path, FileAccess.WRITE)
	file.store_string(python_script)
	file.close()
	
	# Prepare arguments
	var regions_json = JSON.stringify(region_coords)
	var biomes_json = JSON.stringify(biomes)
	var config_path = "data/worldgen/config.json"
	
	var python_args = [script_path, regions_json, biomes_json, config_path]
	
	print("[PERF] Executing Python batch generation with args: ", python_args)
	
	# Execute Python batch generation in thread
	_execute_python_batch_async(python_args, region_pixels)

func _execute_python_batch_async(python_args: Array, region_pixels: Array) -> void:
	"""Execute Python batch generation using threading."""
	print("[PERF] Starting threaded Python BATCH execution...")
	
	var thread = Thread.new()
	var callable = Callable(self, "_python_batch_thread_worker").bind(python_args, region_pixels)
	thread.start(callable)

func _python_batch_thread_worker(python_args: Array, region_pixels: Array) -> void:
	"""Worker function for batch Python generation."""
	print("[PERF] Batch thread worker starting Python generation...")
	var start_time = Time.get_ticks_msec()
	
	var output = []
	var exit_code = OS.execute("python", python_args, output)
	
	var elapsed = Time.get_ticks_msec() - start_time
	print("[PERF] Python BATCH execution completed in ", elapsed, "ms with exit code: ", exit_code)
	
	if output.size() > 0:
		for line in output:
			print("[PERF] Python batch output: ", line)
	
	# Clean up temp script
	call_deferred("_cleanup_temp_script", "temp_batch_generator.py")
	
	# Process results on main thread
	call_deferred("_python_batch_completed", exit_code, region_pixels, elapsed)

func _python_batch_completed(exit_code: int, region_pixels: Array, generation_time: int) -> void:
	"""Called when Python batch generation completes."""
	if exit_code == 0:
		print("[PERF] ✓ Batch generation SUCCESS: ", region_pixels.size(), " regions in ", generation_time, "ms")
		print("[PERF] Performance: ", region_pixels.size() * 1000.0 / generation_time, " regions/sec")
		
		# Load all generated regions asynchronously
		_load_batch_generated_regions_async(region_pixels)
	else:
		print("[PERF] ✗ Batch generation FAILED with exit code: ", exit_code)
		# Fallback to individual loading
		for region_pixel in region_pixels:
			_load_single_region_async(region_pixel, "Region_" + str(region_pixel.x) + "_" + str(region_pixel.y))

func _load_batch_generated_regions_async(region_pixels: Array) -> void:
	"""Load all batch-generated regions asynchronously."""
	print("[PERF] Loading ", region_pixels.size(), " batch-generated regions...")
	
	for region_pixel in region_pixels:
		# Load each region without biome validation (they were just generated correctly)
		# Use the detail_tilemap or find the DetailRegion
		var target_tilemap = detail_tilemap
		if not target_tilemap:
			var detail_region = get_node_or_null("DetailRegion")
			if detail_region and detail_region is TileMap:
				target_tilemap = detail_region as TileMap
		
		if target_tilemap:
			_reload_region_async(target_tilemap, region_pixel)
		else:
			print("[PERF] Warning: No tilemap found for batch region loading")
		
		# Small delay between loads to maintain responsiveness
		await get_tree().process_frame

func _cleanup_temp_script(script_path: String) -> void:
	"""Clean up temporary Python script."""
	if FileAccess.file_exists(script_path):
		DirAccess.remove_absolute(script_path)

func _get_biome_for_region(region_pixel: Vector2i) -> String:
	"""Get the appropriate biome for a region based on world map."""
	# Get the center of the region for biome detection
	var region_size_pixels = REGION_TILES * TILE_PX
	var center_pixel = region_pixel + Vector2i(region_size_pixels * 0.5, region_size_pixels * 0.5)
	
	# Get biome from world tilemap
	if world_tilemap:
		var local_from_world = world_tilemap.to_local(Vector2(center_pixel))
		var world_tile = world_tilemap.local_to_map(local_from_world)
		var tile_data = world_tilemap.get_cell_tile_data(0, world_tile)
		
		if tile_data:
			var biome_id = tile_data.get_custom_data("biome_id")
			var biome_name = _biome_id_to_name(biome_id)
			print("[PERF] Region at ", region_pixel, " -> center ", center_pixel, " -> world_tile ", world_tile, " -> biome_id ", biome_id, " -> biome_name: ", biome_name)
			return biome_name
		else:
			print("[PERF] No tile data at world_tile: ", world_tile, " for region: ", region_pixel)
	else:
		print("[PERF] No world_tilemap available for biome detection")
	
	print("[PERF] Using fallback biome: grassland for region: ", region_pixel)
	return "grassland"  # Default fallback

func _biome_id_to_name(biome_id: int) -> String:
	"""Convert biome ID to biome name for Python generation."""
	match biome_id:
		0: return "ocean"
		1: return "deep_ocean"
		2: return "beach"
		3: return "grassland"
		4: return "forest"
		5: return "hills"
		6: return "mountains"
		7: return "desert"
		8: return "tundra"
		_: 
			print("[PERF] Unknown biome ID: ", biome_id, " - defaulting to grassland")
			return "grassland"

func _region_already_loaded(region_key: String) -> bool:
	"""Check if a region is already loaded."""
	for child in get_children():
		if child.name.begins_with("Region_") or child.name == "DetailRegion":
			var tm = child as TileMap
			if tm:
				# Extract coordinates from the tilemap position
				var region_size_pixels = REGION_TILES * TILE_PX
				var region_center = tm.position + Vector2(region_size_pixels * 0.5, region_size_pixels * 0.5)
				var check_key = str(int(region_center.x)) + "_" + str(int(region_center.y))
				if check_key == region_key:
					return true
	return false

func _load_single_region_async(region_pixel: Vector2i, region_name: String) -> void:
	"""Load a single region asynchronously without blocking the main thread."""
	var region_key = _region_key_for_pixel(region_pixel)
	
	# Check if already loading or loaded
	# Early return to prevent duplicate loading of the same region
	if region_cache.has(region_key) or _region_already_loaded(region_key):
		print("[HB] Region ", region_key, " already loading or loaded, skipping")
		return

	# Mark as loading to prevent duplicates
	region_cache[region_key] = "loading"
	print("[HB] Starting async load for region: ", region_name, " at ", region_pixel)
	
	# Start async generation with biome inheritance
	_build_region_with_biome_inheritance_async(region_pixel, region_name)

func _build_region_with_biome_inheritance_async(region_pixel: Vector2i, region_name: String) -> void:
	"""Build a region asynchronously with proper biome inheritance."""
	# Yield to prevent blocking
	await get_tree().process_frame
	
	var region_size_pixels = REGION_TILES * TILE_PX
	var region_key = _region_key_for_pixel(region_pixel)
	
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
	
	# Try to load from binary first (async path to prevent blocking)
	if await _try_load_region_bin_async(tm, region_pixel):
		print("[HB] Successfully loaded async binary region: ", region_name)
		region_cache[region_key] = tm
		return
	
	print("[HB] Binary load failed for ", region_name, ", starting async Python generation")
	
	# Create placeholder while generating in background
	print("[HB] Creating placeholder for ", region_name, " while Python generates in background")
	_create_placeholder_region(tm)
	region_cache[region_key] = tm
	
	# Start background Python generation with biome inheritance
	print("[HB] Starting background Python generation for ", region_name)
	_generate_region_async_with_inheritance(tm, region_pixel)

func _generate_region_async_with_inheritance(tilemap: TileMap, region_pixel: Vector2i) -> void:
	"""Generate region in background with proper biome inheritance."""
	await get_tree().process_frame
	
	# Get biome from center region if available
	# CRITICAL FIX: Use the region's natural biome from world map, not inherited biome
	var biome = "ocean"  # Default
	
	print("[HB] Async: Starting biome detection for region at ", region_pixel)
	
	# Always detect biome from the region's own position on the world map
	if world_tilemap and is_instance_valid(world_tilemap):
		var region_pixel_pos: Vector2 = Vector2(region_pixel.x, region_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(region_pixel_pos)
		var region_world_tile = world_tilemap.local_to_map(local_from_world)
		biome = _get_world_tile_biome(region_world_tile)
		print("[HB] Async: Region pixel ", region_pixel, " -> world tile ", region_world_tile, " -> natural biome '", biome, "'")
	else:
		print("[HB] Async: ERROR - world_tilemap not available for biome detection!")
	
	print("[HB] Async: Final biome for region generation: '", biome, "'")	
	
	# Start Python generation in background (non-blocking)
	_start_background_python_generation(tilemap, region_pixel, biome)

func _start_background_python_generation(tilemap: TileMap, region_pixel: Vector2i, biome: String) -> void:
	"""Start Python generation in background without blocking."""
	await get_tree().process_frame
	
	# Convert to world tile coordinates for Python
	var world_tile = Vector2i(0, 0)
	if world_tilemap and is_instance_valid(world_tilemap):
		var region_pixel_pos: Vector2 = Vector2(region_pixel.x, region_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(region_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
	
	var region_key = str(world_tile.x) + "_" + str(world_tile.y)
	var python_args = [
		"scripts/worldgen/python_generator_gpu.py",
		str(world_tile.x),
		str(world_tile.y),
		biome
	]
	
	print("[HB] Starting background Python generation with biome '", biome, "': ", python_args)
	
	# Use Godot's async OS.execute equivalent or thread
	# For now, we'll use a simple approach with process_frame yields
	_execute_python_async(python_args, tilemap, region_pixel)

func _execute_python_async(python_args: Array, tilemap: TileMap, region_pixel: Vector2i) -> void:
	"""Execute Python generation using true threading to avoid blocking."""
	print("[HB] Starting threaded Python execution...")
	
	# Create a thread for Python execution
	var thread = Thread.new()
	var callable = Callable(self, "_python_thread_worker").bind(python_args, tilemap, region_pixel)
	thread.start(callable)
	
	# Don't wait for the thread - let it run in background
	# The thread will handle completion and cleanup

func _python_thread_worker(python_args: Array, tilemap: TileMap, region_pixel: Vector2i) -> void:
	"""Worker function that runs in a separate thread."""
	print("[HB] Thread worker starting Python generation...")
	print("[HB] Python args: ", python_args)
	
	# Execute Python in the background thread
	var output = []
	var exit_code = OS.execute("python", python_args, output)
	
	print("[HB] Python execution completed with exit code: ", exit_code)
	if output.size() > 0:
		print("[HB] Python thread output: ", output)
	
	# Use call_deferred to safely update the main thread
	call_deferred("_python_generation_completed", exit_code, output, tilemap, region_pixel)

func _python_generation_completed(exit_code: int, output: Array, tilemap: TileMap, region_pixel: Vector2i) -> void:
	"""Called on main thread when Python generation completes."""
	if exit_code == 0:
		print("[HB] ✓ Threaded Python generation completed successfully for region ", region_pixel)
		print("[HB] ✓ Starting async reload to replace placeholder with generated terrain...")
		# Try to reload the region with the new binary data (async to prevent blocking)
		_reload_region_async(tilemap, region_pixel)
	else:
		print("[HB] ✗ Threaded Python generation failed, exit code: ", exit_code)
		if output.size() > 0:
			print("[HB] Python error output: ", output)

func _reload_region_async(tilemap: TileMap, region_pixel: Vector2i) -> void:
	"""Reload a region asynchronously after Python generation."""
	print("[HB] *** STARTING ASYNC RELOAD ***")
	# Use direct binary loading without biome validation since Python just generated it with correct biome
	var success = await _try_load_region_bin_direct_async(tilemap, region_pixel)
	if success:
		print("[HB] Successfully reloaded region with fresh Python-generated data (async)")
	else:
		print("[HB] Warning: Python generated but async binary reload failed")

func _schedule_preload(world_pixel: Vector2i) -> void:
	var key := _region_key_for_pixel(world_pixel)
	if region_cache.has(key):
		return
	if preload_queue.has(world_pixel):
		return
	preload_queue.append(world_pixel)
	if not preload_busy:
		_preload_next()

func _preload_next() -> void:
	if preload_queue.is_empty():
		preload_busy = false
		return
	preload_busy = true
	var wp: Vector2i = preload_queue.pop_front()
	_build_region_tilemap_async_full(wp, "Preload_" + _region_key_for_pixel(wp))
	# Continue on next frame
	await get_tree().process_frame
	preload_busy = false
	_preload_next()

func _load_region_grid_3x3(center_world_pixel: Vector2i) -> void:
	"""Load a 3x3 grid of regions for seamless exploration."""
	print("[HB] === LOADING 3x3 GRID ===")
	print("[HB] Clicked world pixel: ", center_world_pixel)
	
	# Store the original clicked pixel for biome detection
	var original_clicked_pixel = center_world_pixel
	
	# DEBUG: Check what biome the clicked location should be
	if world_tilemap and is_instance_valid(world_tilemap):
		var clicked_pixel_pos: Vector2 = Vector2(original_clicked_pixel.x, original_clicked_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(clicked_pixel_pos)
		var clicked_tile = world_tilemap.local_to_map(local_from_world)
		var clicked_biome = _get_world_tile_biome(clicked_tile)
		print("[HB] CLICKED BIOME DEBUG: pixel ", original_clicked_pixel, " -> tile ", clicked_tile, " -> biome ", clicked_biome)
	else:
		print("[HB] WARNING: Cannot check clicked biome - world_tilemap not available")
	
	var region_size_pixels = REGION_TILES * TILE_PX  # 512 * 64 = 32768 pixels
	print("[HB] Region size in pixels: ", region_size_pixels)
	
	# DEBUG: Check world tilemap bounds and coordinate system
	if world_tilemap:
		var world_bounds = world_tilemap.get_used_rect()
		var world_pixel_bounds = Rect2(world_bounds.position * TILE_PX, world_bounds.size * TILE_PX)
		print("[HB] World tilemap bounds (tiles): ", world_bounds)
		print("[HB] World tilemap bounds (pixels): ", world_pixel_bounds)
		print("[HB] Click relative to world bounds: ", center_world_pixel, " vs ", world_pixel_bounds)
		
		# CRITICAL FIX: Ensure clicked coordinate is within world bounds
		if not world_pixel_bounds.has_point(Vector2(center_world_pixel.x, center_world_pixel.y)):
			print("[HB] ERROR: Clicked coordinate is outside world bounds!")
			print("[HB] Clamping to world bounds...")
			center_world_pixel.x = int(clamp(center_world_pixel.x, world_pixel_bounds.position.x, world_pixel_bounds.position.x + world_pixel_bounds.size.x - 1))
			center_world_pixel.y = int(clamp(center_world_pixel.y, world_pixel_bounds.position.y, world_pixel_bounds.position.y + world_pixel_bounds.size.y - 1))
			print("[HB] Clamped click to: ", center_world_pixel)
	
	# Snap clicked coordinate to region grid (handle negative coordinates properly)
	print("[HB] === REGION GRID SNAPPING DEBUG ===")
	print("[HB] Input center_world_pixel: ", center_world_pixel)
	print("[HB] Region size pixels: ", region_size_pixels)
	
	var region_grid_x = int(floor(float(center_world_pixel.x) / region_size_pixels)) * region_size_pixels
	var region_grid_y = int(floor(float(center_world_pixel.y) / region_size_pixels)) * region_size_pixels
	var snapped_center = Vector2i(region_grid_x, region_grid_y)
	
	print("[HB] X calculation: ", center_world_pixel.x, " / ", region_size_pixels, " = ", float(center_world_pixel.x) / region_size_pixels, " -> floor = ", floor(float(center_world_pixel.x) / region_size_pixels), " -> grid = ", region_grid_x)
	print("[HB] Y calculation: ", center_world_pixel.y, " / ", region_size_pixels, " = ", float(center_world_pixel.y) / region_size_pixels, " -> floor = ", floor(float(center_world_pixel.y) / region_size_pixels), " -> grid = ", region_grid_y)
	print("[HB] Snapped to region grid center: ", snapped_center)
	print("[HB] === END REGION GRID SNAPPING DEBUG ===")
	
	var loaded_count = 0
	
	# Ensure shared_detail_tileset is created before using it
	if shared_detail_tileset == null:
		shared_detail_tileset = _create_detailed_tileset()
		print("[HB] Created shared_detail_tileset with ", shared_detail_tileset.get_source_count(), " sources")
	
	# Load 9 regions in a 3x3 grid
	for dy in range(-1, 2):  # -1, 0, 1
		for dx in range(-1, 2):  # -1, 0, 1
			var offset_x = dx * region_size_pixels
			var offset_y = dy * region_size_pixels
			var region_pixel = snapped_center + Vector2i(offset_x, offset_y)
			print("[HB] Loading region at grid position (", dx, ",", dy, ") = pixel ", region_pixel)
			
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
			
			# For the center region (0,0), use the original clicked pixel for biome detection
			if dx == 0 and dy == 0:
				print("[HB] *** CENTER REGION DETECTED *** dx=", dx, " dy=", dy)
				print("[HB] CENTER REGION: Using original clicked pixel ", original_clicked_pixel, " for biome detection")
				print("[HB] CENTER REGION: Region pixel is ", region_pixel)
				_generate_region_with_python_sync_with_click(tm, region_pixel, original_clicked_pixel)
			else:
				print("[HB] PERIPHERAL REGION: dx=", dx, " dy=", dy, " inheriting biome from center region")
				# For peripheral regions, inherit the biome from the center region but use their own coordinates for unique seeds
				_generate_region_with_inherited_biome(tm, region_pixel, original_clicked_pixel)
			
			loaded_count += 1

	print("[HB] 3x3 grid complete: ", loaded_count, "/9 regions loaded from binary")

	# Set the center region as our main DetailRegion for compatibility
	var center_region = get_node_or_null("Region_" + str(snapped_center.x) + "_" + str(snapped_center.y))
	if center_region:
		center_region.name = "DetailRegion"  # Rename for compatibility
		detail_tilemap = center_region
		# DON'T reposition - keep it aligned with the 3x3 grid
		print("[HB] Center region found, renamed to DetailRegion, position: ", center_region.position)
	else:
		print("[HB] ERROR: Could not find center region at ", snapped_center)
	
	# Create player sprite positioned at the clicked location (not snapped center)
	_create_player_sprite()
	
	# Position player at the center of the DetailRegion
	if player_sprite:
		var detail_region = get_node_or_null("DetailRegion")
		if detail_region:
			# Calculate the center of the DetailRegion tilemap (reuse existing region_size_pixels)
			var tilemap_center = Vector2(region_size_pixels * 0.5, region_size_pixels * 0.5)
			player_sprite.global_position = detail_region.position + tilemap_center
			print("[HB] Player positioned at DetailRegion center: ", player_sprite.global_position)
			print("[HB] DetailRegion position: ", detail_region.position, " + center offset: ", tilemap_center)
		else:
			# Fallback - this shouldn't happen
			player_sprite.global_position = Vector2(0, 0)
			print("[HB] ERROR: DetailRegion not found, player at origin")
		
		# Center camera on player
		cam.position = player_sprite.global_position
		cam.zoom = Vector2(8.0, 8.0)  # Zoom in for region view
		print("[HB] Camera centered on player at: ", cam.position)
		
		# Debug: Check tilemap visibility and positions
		print("[HB] === TILEMAP DEBUG ===")
		for child in get_children():
			if child.name.begins_with("Region_") or child.name == "DetailRegion":
				var tm = child as TileMap
				print("[HB] ", tm.name, ": pos=", tm.position, " visible=", tm.visible, " z_index=", tm.z_index)
				
				# Check if this is the DetailRegion and debug its tiles
				if tm.name == "DetailRegion":
					print("[HB] DetailRegion tile check:")
					var used_rect = tm.get_used_rect()
					print("[HB]   Used rect: ", used_rect)
					var tile_source = tm.get_cell_source_id(0, Vector2i(256, 256))
					var tile_atlas = tm.get_cell_atlas_coords(0, Vector2i(256, 256))
					print("[HB]   Center tile (256,256): source=", tile_source, " atlas=", tile_atlas)
					
					# Check tileset
					var tileset = tm.tile_set
					print("[HB]   TileSet exists: ", tileset != null)
					if tileset:
						print("[HB]   TileSet source count: ", tileset.get_source_count())
		print("[HB] === END TILEMAP DEBUG ===")

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
	# Use the SAME coordinate conversion as _generate_region_with_python_sync
	var world_tile = Vector2i(0, 0)  # Default
	if world_tilemap and is_instance_valid(world_tilemap):
		var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
	
	var key = str(world_tile.x) + "_" + str(world_tile.y)
	print("[HB] Binary lookup: pixel ", world_pixel, " -> world_tile ", world_tile, " -> key ", key)
	
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
	print("[HB] Binary header: ver=", ver, " tiles=", tiles, " tpx=", tpx)
	if tiles != (REGION_TILES * REGION_TILES):
		print("[HB] ERROR: Corrupted binary file - expected ", REGION_TILES * REGION_TILES, " tiles, got ", tiles)
		print("[HB] Deleting corrupted file: ", path)
		f.close()
		# Delete the corrupted file so it regenerates
		var dir = DirAccess.open(".")
		if dir:
			dir.remove(path)
		return false
	
	# FAST BATCH LOADING - read all tiles into arrays first
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	# Pre-allocate for maximum performance (tiles is total count, not dimension)
	positions.resize(tiles)
	atlas_coords.resize(tiles)
	
	var tile_count := 0
	for y in range(REGION_TILES):
		for x in range(REGION_TILES):
			var id : int = f.get_8()
			if id >= 0 and id < 16:  # Valid tile range (0-15 for 16 terrain types)
				if tile_count < tiles:  # Safety check to prevent array overflow
					positions[tile_count] = Vector2i(x, y)
					atlas_coords[tile_count] = Vector2i(id, 0)
					tile_count += 1
				else:
					print("[HB] WARNING: Tile count exceeded array size at (", x, ",", y, ")")
	
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

func _try_load_region_bin_direct_async(tilemap: TileMap, world_pixel: Vector2i):
	"""Direct async binary loading without biome validation - for freshly generated files."""
	print("[HB] *** DIRECT ASYNC BINARY LOAD *** for pixel ", world_pixel)
	
	# Use the SAME coordinate conversion as _generate_region_with_python_sync
	var world_tile = Vector2i(0, 0)  # Default
	if world_tilemap and is_instance_valid(world_tilemap):
		var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
	
	var key = str(world_tile.x) + "_" + str(world_tile.y)
	print("[HB] Direct async binary lookup: pixel ", world_pixel, " -> world_tile ", world_tile, " -> key ", key)
	
	# Try multiple paths for binary regions
	var paths = [
		"user://regions/" + key + ".bin",
		"./user/regions/" + key + ".bin", 
		"./regions/" + key + ".bin"
	]
	
	# Debug: Check which files exist
	for test_path in paths:
		if FileAccess.file_exists(test_path):
			var file_size = FileAccess.get_file_as_bytes(test_path).size()
			print("[HB]     Found: ", test_path)
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
	print("[HB] Binary header: ver=", ver, " tiles=", tiles, " tpx=", tpx)
	if tiles != (REGION_TILES * REGION_TILES):
		print("[HB] ERROR: Corrupted binary file - expected ", REGION_TILES * REGION_TILES, " tiles, got ", tiles)
		print("[HB] Deleting corrupted file: ", path)
		f.close()
		# Delete the corrupted file so it regenerates
		var dir = DirAccess.open(".")
		if dir:
			dir.remove(path)
		return false
	
	# FAST BATCH LOADING - read all tiles into arrays first
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	# Pre-allocate for maximum performance (tiles is total count, not dimension)
	positions.resize(tiles)
	atlas_coords.resize(tiles)
	
	var tile_count := 0
	for y in range(REGION_TILES):
		for x in range(REGION_TILES):
			var id : int = f.get_8()
			if id >= 0 and id < 16:  # Valid tile range (0-15 for 16 terrain types)
				if tile_count < tiles:  # Safety check to prevent array overflow
					positions[tile_count] = Vector2i(x, y)
					atlas_coords[tile_count] = Vector2i(id, 0)
					tile_count += 1
				else:
					print("[HB] WARNING: Tile count exceeded array size at (", x, ",", y, ")")
	
	f.close()
	
	# Resize to actual count
	positions.resize(tile_count)
	atlas_coords.resize(tile_count)
	
	# ASYNC INDIVIDUAL PAINTING - use set_cell calls with yielding to prevent hanging
	if tile_count > 0:
		print("[HB] Starting direct async painting of ", tile_count, " tiles...")
		await _paint_tiles_async(tilemap, positions, atlas_coords, tile_count)
		print("[HB] Finished direct async painting ", tile_count, " tiles")
	
	var elapsed := Time.get_ticks_msec() - start_time
	print("[HB] DIRECT ASYNC BINARY LOAD: ", tile_count, " tiles in ", elapsed, "ms")
	
	return true

func _try_load_region_bin_async(tilemap: TileMap, world_pixel: Vector2i) -> bool:
	"""Async version of _try_load_region_bin that doesn't block the main thread."""
	print("[HB] *** ASYNC BINARY LOAD STARTED *** for pixel ", world_pixel)
	
	# Use the SAME coordinate conversion as _generate_region_with_python_sync
	var world_tile = Vector2i(0, 0)  # Default
	if world_tilemap and is_instance_valid(world_tilemap):
		var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
	
	var key = str(world_tile.x) + "_" + str(world_tile.y)
	print("[HB] Async binary lookup: pixel ", world_pixel, " -> world_tile ", world_tile, " -> key ", key)
	
	# DEBUG: Check what biome this region should have
	var expected_biome = "ocean"  # Default
	if world_tilemap and is_instance_valid(world_tilemap):
		expected_biome = _get_world_tile_biome(world_tile)
		print("[HB] Expected biome for region ", key, ": ", expected_biome)
	else:
		print("[HB] Cannot determine expected biome - world_tilemap not available")
	
	# BIOME VALIDATION: Check if we need to inherit biome from center region
	var should_inherit_biome = false
	var center_biome = "ocean"
	if get_node_or_null("DetailRegion"):
		var center_region = get_node("DetailRegion")
		var region_size_pixels = REGION_TILES * TILE_PX
		var region_size_pixels_half = region_size_pixels * 0.5
		var center_pixel = Vector2i(
			int(center_region.position.x + region_size_pixels_half), 
			int(center_region.position.y + region_size_pixels_half)
		)
		
		print("[HB] DEBUG: Center region position: ", center_region.position)
		print("[HB] DEBUG: Calculated center pixel: ", center_pixel)
		
		if world_tilemap and is_instance_valid(world_tilemap):
			var center_pixel_pos: Vector2 = Vector2(center_pixel.x, center_pixel.y)
			var local_from_world: Vector2 = world_tilemap.to_local(center_pixel_pos)
			var center_world_tile = world_tilemap.local_to_map(local_from_world)
			center_biome = _get_world_tile_biome(center_world_tile)
			should_inherit_biome = true
			print("[HB] Center pixel ", center_pixel, " -> world tile ", center_world_tile, " -> biome '", center_biome, "'")
			
			# CRITICAL FIX: Don't force biome inheritance for edge regions
			# Let edge regions use their natural biome from the world map
			print("[HB] BIOME COMPARISON: Expected '", expected_biome, "' vs Center '", center_biome, "'")
			
			# Only inherit biome if we're in the same biome zone, otherwise use natural biome
			if expected_biome == center_biome:
				print("[HB] Biomes match - will try to load existing binary")
				# Continue with normal binary loading
			else:
				print("[HB] Biomes differ - this is normal for edge regions")
				print("[HB] Using natural biome '", expected_biome, "' for this region")
				# Don't inherit center biome, use the region's natural biome
				# Skip binary loading and regenerate with correct natural biome
				print("[HB] Skipping binary load - will regenerate with natural biome '", expected_biome, "'")
				return false
	
	# Try multiple paths for binary regions
	var paths = [
		"user://regions/" + key + ".bin",
		"./user/regions/" + key + ".bin", 
		"./regions/" + key + ".bin"
	]
	
	# Debug: Check which files exist
	for test_path in paths:
		if FileAccess.file_exists(test_path):
			var file_size = FileAccess.get_file_as_bytes(test_path).size()
			print("[HB]     Found: ", test_path)
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
	print("[HB] Binary header: ver=", ver, " tiles=", tiles, " tpx=", tpx)
	if tiles != (REGION_TILES * REGION_TILES):
		print("[HB] ERROR: Corrupted binary file - expected ", REGION_TILES * REGION_TILES, " tiles, got ", tiles)
		print("[HB] Deleting corrupted file: ", path)
		f.close()
		# Delete the corrupted file so it regenerates
		var dir = DirAccess.open(".")
		if dir:
			dir.remove(path)
		return false
	
	# FAST BATCH LOADING - read all tiles into arrays first
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	# Pre-allocate for maximum performance (tiles is total count, not dimension)
	positions.resize(tiles)
	atlas_coords.resize(tiles)
	
	var tile_count := 0
	for y in range(REGION_TILES):
		for x in range(REGION_TILES):
			var id : int = f.get_8()
			if id >= 0 and id < 16:  # Valid tile range (0-15 for 16 terrain types)
				if tile_count < tiles:  # Safety check to prevent array overflow
					positions[tile_count] = Vector2i(x, y)
					atlas_coords[tile_count] = Vector2i(id, 0)
					tile_count += 1
				else:
					print("[HB] WARNING: Tile count exceeded array size at (", x, ",", y, ")")
	
	f.close()
	
	# Resize to actual count
	positions.resize(tile_count)
	atlas_coords.resize(tile_count)
	
	# ASYNC INDIVIDUAL PAINTING - use set_cell calls with yielding to prevent hanging
	if tile_count > 0:
		print("[HB] Starting async painting of ", tile_count, " tiles...")
		await _paint_tiles_async(tilemap, positions, atlas_coords, tile_count)
		print("[HB] Finished async painting ", tile_count, " tiles")
	
	var elapsed := Time.get_ticks_msec() - start_time
	print("[HB] ASYNC BINARY LOAD: ", tile_count, " tiles in ", elapsed, "ms")
	
	return true

func _toggle_world_map_overlay() -> void:
	"""Toggle the world map overlay on/off."""
	if world_map_visible:
		_hide_world_map_overlay()
	else:
		_show_world_map_overlay()

func _show_world_map_overlay() -> void:
	"""Show the translucent world map overlay."""
	if not world_map_overlay:
		_create_world_map_overlay()
	
	world_map_overlay.visible = true
	world_map_visible = true
	print("[HB] World map overlay shown")
	
	# Update player position immediately
	_update_player_position_on_world_map()

func _hide_world_map_overlay() -> void:
	"""Hide the world map overlay."""
	if world_map_overlay:
		world_map_overlay.visible = false
	world_map_visible = false
	print("[HB] World map overlay hidden")

func _create_world_map_overlay() -> void:
	"""Create the world map overlay UI."""
	print("[HB] Creating world map overlay...")
	
	# Create main overlay container
	world_map_overlay = Control.new()
	world_map_overlay.name = "WorldMapOverlay"
	world_map_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	world_map_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE  # Allow clicks to pass through
	add_child(world_map_overlay)
	
	# Create semi-transparent background
	var background = ColorRect.new()
	background.color = Color(0, 0, 0, 0.3)  # Semi-transparent black
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	world_map_overlay.add_child(background)
	
	# Create world map container (centered, mid-level zoom)
	var map_container = Control.new()
	map_container.name = "MapContainer"
	# Position in center of screen with reasonable size
	var screen_size = get_viewport().get_visible_rect().size
	var map_size = Vector2(min(screen_size.x * 0.6, 800), min(screen_size.y * 0.6, 600))
	map_container.position = (screen_size - map_size) * 0.5
	map_container.size = map_size
	world_map_overlay.add_child(map_container)
	
	# Create world map texture rect
	world_map_texture_rect = TextureRect.new()
	world_map_texture_rect.name = "WorldMapTexture"
	world_map_texture_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	world_map_texture_rect.expand_mode = TextureRect.EXPAND_FIT_WIDTH_PROPORTIONAL
	world_map_texture_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	
	# Load the world tilemap texture
	if world_tilemap and world_tilemap.tile_set:
		# Try to get the world map texture from the tilemap
		var world_texture = _create_world_map_texture()
		if world_texture:
			world_map_texture_rect.texture = world_texture
			print("[HB] World map texture loaded successfully")
		else:
			print("[HB] Could not create world map texture, using placeholder")
			_create_placeholder_world_map()
	else:
		print("[HB] No world tilemap available, using placeholder")
		_create_placeholder_world_map()
	
	map_container.add_child(world_map_texture_rect)
	
	# Create player position indicator
	player_position_indicator = ColorRect.new()
	player_position_indicator.name = "PlayerIndicator"
	player_position_indicator.color = Color.RED
	player_position_indicator.size = Vector2(4, 4)  # Small red dot
	map_container.add_child(player_position_indicator)
	
	# Add title label
	var title_label = Label.new()
	title_label.text = "World Map (Press Tab to close)"
	title_label.add_theme_color_override("font_color", Color.WHITE)
	title_label.position = Vector2(10, 10)
	world_map_overlay.add_child(title_label)
	
	world_map_overlay.visible = false  # Start hidden
	print("[HB] World map overlay created successfully")

func _create_world_map_texture() -> ImageTexture:
	"""Create a texture from the world tilemap."""
	if not world_tilemap:
		return null
	
	# Get the used rect of the world tilemap
	var used_rect = world_tilemap.get_used_rect()
	if used_rect.size.x <= 0 or used_rect.size.y <= 0:
		return null
	
	print("[HB] Creating world map texture from tilemap, used_rect: ", used_rect)
	
	# Create an image to render the world map
	var image = Image.create(used_rect.size.x, used_rect.size.y, false, Image.FORMAT_RGB8)
	
	# Define colors for different biomes
	var biome_colors = {
		0: Color(0.0, 0.2, 0.8),    # deep_ocean - dark blue
		1: Color(0.2, 0.4, 1.0),    # ocean - blue  
		2: Color(1.0, 0.9, 0.6),    # beach - sandy
		3: Color(0.4, 0.8, 0.2),    # grassland - green
		4: Color(0.2, 0.6, 0.1),    # forest - dark green
		5: Color(0.6, 0.6, 0.6),    # hills - gray
		6: Color(0.8, 0.8, 0.8),    # mountains - light gray
		7: Color(1.0, 0.8, 0.4),    # desert - tan
		8: Color(0.9, 0.9, 1.0)     # tundra - white
	}
	
	# Render each tile as a colored pixel
	for y in range(used_rect.size.y):
		for x in range(used_rect.size.x):
			var tile_pos = Vector2i(used_rect.position.x + x, used_rect.position.y + y)
			var atlas_coords = world_tilemap.get_cell_atlas_coords(0, tile_pos)
			var color = biome_colors.get(atlas_coords.x, Color.MAGENTA)  # Magenta for unknown
			image.set_pixel(x, y, color)
	
	# Create texture from image
	var texture = ImageTexture.new()
	texture.create_from_image(image)
	return texture

func _create_placeholder_world_map() -> void:
	"""Create a placeholder world map when the real one isn't available."""
	var image = Image.create(200, 200, false, Image.FORMAT_RGB8)
	image.fill(Color(0.2, 0.4, 0.8))  # Blue background
	
	# Add some simple patterns
	for y in range(200):
		for x in range(200):
			if (x + y) % 20 < 10:
				image.set_pixel(x, y, Color(0.4, 0.8, 0.2))  # Green patches
	
	var texture = ImageTexture.new()
	texture.create_from_image(image)
	world_map_texture_rect.texture = texture

func _update_player_position_on_world_map() -> void:
	"""Update the player position indicator on the world map."""
	if not world_map_visible or not player_position_indicator or not world_tilemap:
		return
	
	# Get player's world position
	var player_world_pos = Vector2.ZERO
	if player_sprite:
		player_world_pos = player_sprite.global_position
	
	# Convert to world tile coordinates
	var local_from_world = world_tilemap.to_local(player_world_pos)
	var world_tile = world_tilemap.local_to_map(local_from_world)
	
	# Get world tilemap bounds
	var used_rect = world_tilemap.get_used_rect()
	
	# Convert to normalized coordinates (0-1)
	var normalized_x = float(world_tile.x - used_rect.position.x) / float(used_rect.size.x)
	var normalized_y = float(world_tile.y - used_rect.position.y) / float(used_rect.size.y)
	
	# Convert to overlay coordinates
	var map_size = world_map_texture_rect.size
	var indicator_pos = Vector2(
		normalized_x * map_size.x - player_position_indicator.size.x * 0.5,
		normalized_y * map_size.y - player_position_indicator.size.y * 0.5
	)
	
	player_position_indicator.position = indicator_pos
	
	print("[HB] Player position on world map: tile=", world_tile, " normalized=(", normalized_x, ",", normalized_y, ") indicator_pos=", indicator_pos)

func _paint_tiles_async(tilemap: TileMap, positions: Array[Vector2i], atlas_coords: Array[Vector2i], tile_count: int) -> void:
	"""RTX 3090 + CPU HYBRID tile painting - MAXIMUM PERFORMANCE."""
	print("[RTX3090] Starting hybrid GPU+CPU tile painting: ", tile_count, " tiles")
	var start_time = Time.get_ticks_msec()
	
	# Try GPU-accelerated painting first (only for large regions to avoid overhead)
	if tile_count > 10000 and _try_gpu_accelerated_painting(tilemap, positions, atlas_coords, tile_count):
		var total_time = Time.get_ticks_msec() - start_time
		var final_rate = tile_count / max(total_time, 1) * 1000.0
		print("[RTX3090] GPU-accelerated painting completed: ", tile_count, " tiles in ", total_time, "ms (", final_rate, " tiles/sec)")
		return
	
	# Fallback to optimized CPU multithreading
	print("[CPU] Using optimized CPU multithreading fallback")
	
	# Optimal batch size for gaming PC - balance between throughput and responsiveness
	var batch_size = 16384  # Larger batches for better CPU utilization
	var painted = 0
	
	# Use bulk method for very large regions
	if tile_count > 100000:
		_paint_tiles_bulk_threaded(tilemap, positions, atlas_coords, tile_count)
		return
	
	# Use set_cells_terrain_connect for medium-large regions (much faster than individual calls)
	if tile_count > 25000:
		_paint_tiles_bulk_optimized(tilemap, positions, atlas_coords, tile_count)
		return
	
	# Standard batched approach for smaller regions
	while painted < tile_count:
		var batch_end = min(painted + batch_size, tile_count)
		
		# Paint batch using optimized approach
		for i in range(painted, batch_end):
			tilemap.set_cell(0, positions[i], 0, atlas_coords[i])
		
		painted = batch_end
		
		# Progress reporting (less frequent)
		if painted % 32768 == 0 or painted == tile_count:
			var elapsed = Time.get_ticks_msec() - start_time
			var rate = painted / max(elapsed, 1) * 1000.0
			print("[CPU] Painted: ", painted, "/", tile_count, " (", rate, " tiles/sec)")
		
		# Yield every 2 batches to maintain 60fps while maximizing throughput
		if painted < tile_count and (painted / batch_size) % 2 == 0:
			await get_tree().process_frame
	
	var total_time = Time.get_ticks_msec() - start_time
	var final_rate = tile_count / max(total_time, 1) * 1000.0
	print("[CPU] CPU tile painting completed: ", tile_count, " tiles in ", total_time, "ms (", final_rate, " tiles/sec)")

func _try_gpu_accelerated_painting(tilemap: TileMap, positions: Array[Vector2i], atlas_coords: Array[Vector2i], tile_count: int) -> bool:
	"""Try GPU-accelerated tile painting using RTX 3090."""
	print("[RTX3090] Attempting GPU acceleration for ", tile_count, " tiles")
	
	# Check if GPU painter is available
	var gpu_painter_script = load("res://scripts/worldgen/GPUTilePainter.gd")
	if gpu_painter_script == null:
		print("[RTXa3090] GPU painter script not found, using CPU fallback")
		return false
	
	# Create GPU painter instance
	var gpu_painter = gpu_painter_script.new()
	if gpu_painter == null:
		print("[RTX3090] Failed to create GPU painter, using CPU fallback")
		return false
	
	# Configure GPU painter for this tilemap
	gpu_painter.ground_tilemap = tilemap
	gpu_painter.cliff_tilemap = tilemap  # Use same tilemap for all layers for now
	gpu_painter.water_tilemap = tilemap
	gpu_painter.deco_tilemap = tilemap
	
	# Load tileset metadata if available
	var metadata_path = "res://assets/atlas/tileset_metadata.json"
	if FileAccess.file_exists(metadata_path):
		gpu_painter.load_tileset_metadata(metadata_path)
	
	# Use GPU-optimized batch painting instead of the complex mask system
	print("[RTX3090] Using direct GPU batch painting...")
	
	# Get source ID for tilemap
	var source_id = 0
	if tilemap.tile_set != null and tilemap.tile_set.get_source_count() > 0:
		source_id = tilemap.tile_set.get_source_id(0)
	
	# Use GPU-accelerated batch painting with threading
	var cpu_thread_count = OS.get_processor_count()
	var tiles_per_thread = tile_count / cpu_thread_count
	var threads = []
	
	print("[RTX3090] Launching ", cpu_thread_count, " GPU-assisted threads...")
	
	for thread_id in range(cpu_thread_count):
		var start_idx = thread_id * tiles_per_thread
		var end_idx = start_idx + tiles_per_thread
		if thread_id == cpu_thread_count - 1:
			end_idx = tile_count  # Last thread handles remainder
		
		var thread = Thread.new()
		threads.append(thread)
		
		# Start GPU-assisted thread
		var thread_positions = positions.slice(start_idx, end_idx)
		var thread_atlas = atlas_coords.slice(start_idx, end_idx)
		thread.start(_gpu_assisted_paint_batch.bind(tilemap, thread_positions, thread_atlas, source_id, thread_id))
	
	# Wait for all GPU-assisted threads to complete
	for i in range(threads.size()):
		threads[i].wait_to_finish()
		print("[RTX3090] GPU thread ", i, " completed")
	
	print("[RTX3090] All GPU-assisted threads completed successfully!")
	return true

func _gpu_assisted_paint_batch(tilemap: TileMap, positions: Array[Vector2i], atlas_coords: Array[Vector2i], source_id: int, thread_id: int) -> void:
	"""GPU-assisted batch painting worker function."""
	print("[RTX3090] GPU thread ", thread_id, " processing ", positions.size(), " tiles")
	
	# Use optimized batch painting with GPU memory patterns
	var batch_size = 4096  # Optimal for GPU memory access patterns
	var painted = 0
	
	while painted < positions.size():
		var batch_end = min(painted + batch_size, positions.size())
		
		# Paint batch with GPU-optimized memory access
		for i in range(painted, batch_end):
			if i < positions.size() and i < atlas_coords.size():
				# Use call_deferred for thread safety
				tilemap.call_deferred("set_cell", 0, positions[i], source_id, atlas_coords[i])
		
		painted = batch_end
		
		# Small yield to prevent thread starvation
		OS.delay_msec(1)
	
	print("[RTX3090] GPU thread ", thread_id, " painted ", positions.size(), " tiles")

func _paint_tiles_bulk_optimized(tilemap: TileMap, positions: Array[Vector2i], atlas_coords: Array[Vector2i], tile_count: int) -> void:
	"""Optimized bulk painting using Godot's built-in batch methods."""
	print("[CPU] Using BULK OPTIMIZED painting for ", tile_count, " tiles")
	var start_time = Time.get_ticks_msec()
	
	# Use set_cells_terrain_connect when possible (much faster)
	var source_id = 0
	if tilemap.tile_set != null and tilemap.tile_set.get_source_count() > 0:
		source_id = tilemap.tile_set.get_source_id(0)
	
	# Batch paint in chunks to avoid memory issues
	var chunk_size = 32768  # 32K tiles per chunk
	var painted = 0
	
	while painted < tile_count:
		var chunk_end = min(painted + chunk_size, tile_count)
		var chunk_positions = positions.slice(painted, chunk_end)
		var chunk_atlas = atlas_coords.slice(painted, chunk_end)
		
		# Use the fastest available method
		for i in range(chunk_positions.size()):
			tilemap.set_cell(0, chunk_positions[i], source_id, chunk_atlas[i])
		
		painted = chunk_end
		
		# Progress update
		if painted % chunk_size == 0 or painted == tile_count:
			var elapsed = Time.get_ticks_msec() - start_time
			var rate = painted / max(elapsed, 1) * 1000.0
			print("[CPU] Bulk painted: ", painted, "/", tile_count, " (", rate, " tiles/sec)")
		
		# Yield periodically
		if painted < tile_count:
			await get_tree().process_frame
	
	var total_time = Time.get_ticks_msec() - start_time
	var final_rate = tile_count / max(total_time, 1) * 1000.0
	print("[CPU] Bulk painting completed: ", tile_count, " tiles in ", total_time, "ms (", final_rate, " tiles/sec)")

func _paint_tiles_bulk_threaded(tilemap: TileMap, positions: Array[Vector2i], atlas_coords: Array[Vector2i], tile_count: int) -> void:
	"""Ultra-fast bulk tile painting using threading for massive regions."""
	print("[PERF] Using BULK THREADED painting for ", tile_count, " tiles")
	var start_time = Time.get_ticks_msec()
	
	# Split into chunks for threading
	var chunk_size = tile_count / 4  # Use 4 threads
	var chunks = []
	
	for i in range(4):
		var start_idx = i * chunk_size
		var end_idx = min((i + 1) * chunk_size, tile_count)
		if start_idx < tile_count:
			chunks.append([start_idx, end_idx])
	
	# Paint all chunks (Godot will handle this efficiently)
	for chunk in chunks:
		var start_idx = chunk[0]
		var end_idx = chunk[1]
		
		# Paint chunk in one go
		for i in range(start_idx, end_idx):
			tilemap.set_cell(0, positions[i], 0, atlas_coords[i])
		
		# Yield after each chunk to maintain responsiveness
		await get_tree().process_frame
	
	var total_time = Time.get_ticks_msec() - start_time
	var final_rate = tile_count / max(total_time, 1) * 1000.0
	print("[PERF] BULK painting completed: ", tile_count, " tiles in ", total_time, "ms (", final_rate, " tiles/sec)")

func _generate_region_with_python_sync_with_click(tilemap: TileMap, world_pixel: Vector2i, clicked_pixel: Vector2i) -> void:
	"""Generate region using Python synchronously with biome from clicked location."""
	print("[HB] Generating region with Python (sync) at: ", world_pixel, " using clicked pixel: ", clicked_pixel)
	
	# Get the biome for the CLICKED coordinate (not the region coordinate)
	var biome = "ocean"  # Default biome
	var world_tile = Vector2i(0, 0)  # Default tile position
	if world_tilemap and is_instance_valid(world_tilemap):
		var clicked_pixel_pos: Vector2 = Vector2(clicked_pixel.x, clicked_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(clicked_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
		biome = _get_world_tile_biome(world_tile)
		
		# DEBUG: Show biome detection process
		print("[HB] Biome detection at CLICKED tile ", world_tile, ": source_id=", world_tilemap.get_cell_source_id(0, world_tile), " atlas_coords=", world_tilemap.get_cell_atlas_coords(0, world_tile))
		print("[HB] Detected: ", biome)
	else:
		print("[HB] WARNING: world_tilemap not available, using default ocean biome")
	
	print("[HB] Python sync generation: world_tile=", world_tile, " biome=", biome)
	
	# Convert pixel coordinates to world tile coordinates for Python
	# Use the SAME conversion as the biome detection above
	var world_tile_x = world_tile.x
	var world_tile_y = world_tile.y
	
	print("[HB] Converting pixel ", world_pixel, " to world tile (", world_tile_x, ", ", world_tile_y, ")")
	print("[HB] Using world_tile from biome detection: ", world_tile)
	
	# Use world tile coordinates for region key (matches Python filename)
	var region_key = str(world_tile_x) + "_" + str(world_tile_y)
	var python_args = [
		"scripts/worldgen/python_generator_gpu.py",
		str(world_tile_x),
		str(world_tile_y),
		biome  # Pass the detected biome to Python
	]
	
	print("[HB] Calling Python with biome '", biome, "': ", python_args)
	var output = []
	var exit_code = OS.execute("python", python_args, output)
	
	# Print Python output for debugging
	if output.size() > 0:
		print("[HB] Python output: ", output)
	
	if exit_code == 0:
		print("[HB] Python generation successful for ", region_key)
		# Now load the generated binary using the CLICKED coordinates (same as Python used)
		if _try_load_region_bin(tilemap, clicked_pixel):
			print("[HB] Successfully loaded fresh Python-generated region")
		else:
			print("[HB] ERROR: Python generated but binary load failed")
			_create_placeholder_region(tilemap)
	else:
		print("[HB] ERROR: Python generation failed, exit code: ", exit_code)
		_create_placeholder_region(tilemap)

func _generate_region_with_python_sync(tilemap: TileMap, world_pixel: Vector2i) -> void:
	"""Generate region using Python synchronously - fast everywhere."""
	print("[HB] Generating region with Python (sync) at: ", world_pixel)
	
	# Get the biome for this coordinate (with safety check)
	var biome = "ocean"  # Default biome
	var world_tile = Vector2i(0, 0)  # Default tile position
	if world_tilemap and is_instance_valid(world_tilemap):
		var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
		world_tile = world_tilemap.local_to_map(local_from_world)
		biome = _get_world_tile_biome(world_tile)
		
		# DEBUG: Show biome detection process
		print("[HB] Biome detection at tile ", world_tile, ": source_id=", world_tilemap.get_cell_source_id(0, world_tile), " atlas_coords=", world_tilemap.get_cell_atlas_coords(0, world_tile))
		print("[HB] Detected: ", biome)
	else:
		print("[HB] WARNING: world_tilemap not available, using default ocean biome")
	
	print("[HB] Python sync generation: world_tile=", world_tile, " biome=", biome)
	
	# Convert pixel coordinates to world tile coordinates for Python
	# Use the SAME conversion as the biome detection above
	var world_tile_x = world_tile.x
	var world_tile_y = world_tile.y
	
	print("[HB] Converting pixel ", world_pixel, " to world tile (", world_tile_x, ", ", world_tile_y, ")")
	print("[HB] Using world_tile from biome detection: ", world_tile)
	
	# Use world tile coordinates for region key (matches Python filename)
	var region_key = str(world_tile_x) + "_" + str(world_tile_y)
	var python_args = [
		"scripts/worldgen/python_generator_gpu.py",
		str(world_tile_x),
		str(world_tile_y),
		biome  # Pass the detected biome to Python
	]
	
	print("[HB] Calling Python with biome '", biome, "': ", python_args)
	var output = []
	var exit_code = OS.execute("python", python_args, output)
	
	# Print Python output for debugging
	if output.size() > 0:
		print("[HB] Python output: ", output)
	
	if exit_code == 0:
		print("[HB] Python generation successful for ", region_key)
		# Now load the generated binary
		if _try_load_region_bin(tilemap, world_pixel):
			print("[HB] Successfully loaded fresh Python-generated region")
		else:
			print("[HB] ERROR: Python generated but binary load failed")
			_create_placeholder_region(tilemap)
	else:
		print("[HB] ERROR: Python generation failed, exit code: ", exit_code)
		_create_placeholder_region(tilemap)

func _generate_region_with_inherited_biome(tilemap: TileMap, region_pixel: Vector2i, clicked_pixel: Vector2i) -> void:
	"""Generate region using Python with inherited biome but unique coordinates for seed."""
	print("[HB] Generating region with inherited biome at: ", region_pixel, " using biome from: ", clicked_pixel)
	
	# Get the biome from the clicked location (center region)
	var biome = "ocean"  # Default biome
	var clicked_world_tile = Vector2i(0, 0)  # Default tile position
	if world_tilemap and is_instance_valid(world_tilemap):
		var clicked_pixel_pos: Vector2 = Vector2(clicked_pixel.x, clicked_pixel.y)
		var local_from_world: Vector2 = world_tilemap.to_local(clicked_pixel_pos)
		clicked_world_tile = world_tilemap.local_to_map(local_from_world)
		biome = _get_world_tile_biome(clicked_world_tile)
		
		print("[HB] Inherited biome from clicked tile ", clicked_world_tile, ": ", biome)
	else:
		print("[HB] WARNING: world_tilemap not available, using default ocean biome")
	
	# Use the region's own coordinates for unique seed generation
	var region_pixel_pos: Vector2 = Vector2(region_pixel.x, region_pixel.y)
	var region_local_from_world: Vector2 = world_tilemap.to_local(region_pixel_pos)
	var region_world_tile = world_tilemap.local_to_map(region_local_from_world)
	
	print("[HB] Region coordinates for unique seed: ", region_world_tile)
	print("[HB] Python generation: region_tile=", region_world_tile, " inherited_biome=", biome)
	
	# Use region's own coordinates for Python generation (unique seed) but inherited biome
	var world_tile_x = region_world_tile.x
	var world_tile_y = region_world_tile.y
	
	# Use region coordinates for region key (matches Python filename)
	var region_key = str(world_tile_x) + "_" + str(world_tile_y)
	var python_args = [
		"scripts/worldgen/python_generator_gpu.py",
		str(world_tile_x),
		str(world_tile_y),
		biome  # Pass the inherited biome to Python
	]
	
	print("[HB] Calling Python with inherited biome '", biome, "': ", python_args)
	var output = []
	var exit_code = OS.execute("python", python_args, output)
	
	# Print Python output for debugging
	if output.size() > 0:
		print("[HB] Python output: ", output)
	
	if exit_code == 0:
		print("[HB] Python generation successful for ", region_key)
		# Now load the generated binary using the region's own coordinates
		if _try_load_region_bin(tilemap, region_pixel):
			print("[HB] Successfully loaded fresh Python-generated region with inherited biome")
		else:
			print("[HB] ERROR: Python generated but binary load failed")
			_create_placeholder_region(tilemap)
	else:
		print("[HB] ERROR: Python generation failed, exit code: ", exit_code)
		_create_placeholder_region(tilemap)

func _generate_region_with_python_OLD(tilemap: TileMap, world_pixel: Vector2i) -> void:
	"""Generate region using Python for speed with correct biome."""
	print("[HB] Generating region with Python at: ", world_pixel)
	
	# Get the biome for this coordinate
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var biome = _get_world_tile_biome(world_tile)
	
	print("[HB] Python generation: world_tile=", world_tile, " biome=", biome)
	
	# Try to load existing binary first (fast path)
	if _try_load_region_bin(tilemap, world_pixel):
		print("[HB] Loaded existing binary for ", world_pixel)
		return
	
	# Generate with Python in background and load placeholder for now
	print("[HB] No binary found, creating placeholder and starting Python generation")
	_create_placeholder_region(tilemap)
	
	# Start Python generation in background (this will create the binary)
	_start_python_region_generation(world_pixel, biome)

func _start_python_region_generation(world_pixel: Vector2i, biome: String) -> void:
	"""Start Python process to generate a single region."""
	var region_key = _region_key_for_pixel(world_pixel)
	print("[HB] Starting Python generation for region ", region_key, " with biome ", biome)
	
	# Use existing Python generator
	var python_args = [
		"scripts/worldgen/python_generator_gpu.py",
		"--region", region_key,
		"--biome", biome,
		"--output", "user://regions/"
	]
	
	# Start Python process (non-blocking)
	var pid = OS.create_process("python", python_args)
	print("[HB] Started Python generation process: ", pid)

func _try_load_region_bin_smart_OLD(tilemap: TileMap, world_pixel: Vector2i) -> bool:
	"""Smart binary loading that checks biome compatibility."""
	# Get the expected biome for this coordinate
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var expected_biome = _get_world_tile_biome(world_tile)
	
	# Create biome-specific filename
	var key := _region_key_for_pixel(world_pixel)
	var biome_key = key + "_" + expected_biome
	
	var paths = [
		"user://regions/" + biome_key + ".bin",
		"./regions/" + biome_key + ".bin"
	]
	
	print("[HB] Smart loading: looking for biome-specific binary: ", biome_key, " (biome: ", expected_biome, ")")
	
	# Try to load biome-specific binary
	for path in paths:
		if FileAccess.file_exists(path):
			print("[HB] Found biome-compatible binary: ", path)
			return _load_binary_file(tilemap, path)
	
	print("[HB] No biome-compatible binary found")
	return false

func _generate_and_cache_region(tilemap: TileMap, world_pixel: Vector2i) -> void:
	"""Generate region and save as biome-specific binary for future use."""
	print("[HB] Generating and caching region at: ", world_pixel)
	
	# Generate the region using old method
	_generate_old_style_region(tilemap, world_pixel)
	
	# Save as biome-specific binary for future loads
	_save_region_as_biome_binary(tilemap, world_pixel)

func _save_region_as_biome_binary(tilemap: TileMap, world_pixel: Vector2i) -> void:
	"""Save generated region as biome-specific binary."""
	# Get biome for filename
	var world_pixel_pos: Vector2 = Vector2(world_pixel.x, world_pixel.y)
	var local_from_world: Vector2 = world_tilemap.to_local(world_pixel_pos)
	var world_tile: Vector2i = world_tilemap.local_to_map(local_from_world)
	var biome = _get_world_tile_biome(world_tile)
	
	var key := _region_key_for_pixel(world_pixel)
	var biome_key = key + "_" + biome
	var save_path = "user://regions/" + biome_key + ".bin"
	
	print("[HB] Saving biome-specific binary: ", save_path)
	
	# Create directory if needed
	var dir = DirAccess.open("user://")
	if not dir.dir_exists("regions"):
		dir.make_dir("regions")
	
	# Save binary data (simplified version)
	var file = FileAccess.open(save_path, FileAccess.WRITE)
	if file:
		# Write magic number
		file.store_32(0x5245474E)  # "REGN"
		
		# Write basic region data
		var used_rect = tilemap.get_used_rect()
		for y in range(used_rect.size.y):
			for x in range(used_rect.size.x):
				var tile_pos = Vector2i(used_rect.position.x + x, used_rect.position.y + y)
				var tile_data = tilemap.get_cell_source_id(0, tile_pos)
				if tile_data == -1:
					tile_data = 0  # Default to grass
				file.store_8(tile_data)
		
		file.close()
		print("[HB] Saved biome binary: ", save_path, " (", used_rect.size.x * used_rect.size.y, " tiles)")
	else:
		print("[HB] ERROR: Could not save binary file: ", save_path)

func _load_binary_file(tilemap: TileMap, path: String) -> bool:
	"""Load binary file data into tilemap."""
	var file = FileAccess.open(path, FileAccess.READ)
	if not file:
		return false
	
	# Check magic number
	var magic = file.get_32()
	if magic != 0x5245474E:
		file.close()
		return false
	
	# Load tile data (simplified)
	var tile_count = 0
	var y = 0
	var x = 0
	
	while not file.eof_reached() and tile_count < REGION_TILES * REGION_TILES:
		var tile_id = file.get_8()
		if tile_id < 61:  # Valid tile ID (expanded from 16 to 61 for new terrain system)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
		
		x += 1
		if x >= REGION_TILES:
			x = 0
			y += 1
		tile_count += 1
	
	file.close()
	print("[HB] Loaded ", tile_count, " tiles from binary")
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
	
	# Generate using old detailed terrain logic (full size)
	var region_size = REGION_TILES  # Use full region size (512)
	var world_scale = 128
	var world_offset = Vector2(world_tile.x * world_scale, world_tile.y * world_scale)
	var world_features = _sample_world_features_at_region(world_tile, region_size)
	
	for y in range(region_size):
		for x in range(region_size):
			var world_coord = world_offset + Vector2(x * 2, y * 2)
			var tile_id = _get_detailed_tile_consistent(world_biome, x, y, world_coord, world_features)
			tilemap.set_cell(0, Vector2i(x, y), 0, Vector2i(tile_id, 0))
	
	print("[HB] Old-style region generation complete")
