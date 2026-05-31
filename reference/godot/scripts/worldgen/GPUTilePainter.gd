class_name GPUTilePainter
extends RefCounted

## GPU-Accelerated Tile Painter for NVIDIA RTX 3090
## Leverages compute shaders and optimized CPU threading for maximum performance

var ground_tilemap: TileMap
var cliff_tilemap: TileMap
var water_tilemap: TileMap
var deco_tilemap: TileMap
var tileset: TileSet
var _tile_source_id: int = 0

var biome_tile_mapping: Dictionary = {}

# GPU acceleration settings
var use_gpu_acceleration: bool = true
var gpu_batch_size: int = 65536  # Optimal for RTX 3090
var cpu_thread_count: int = 0    # Auto-detect

# Compute shader for GPU tile processing
var compute_shader: RID
var rendering_device: RenderingDevice

func _init():
	print("[GPU] GPUTilePainter initializing for RTX 3090...")
	
	# Auto-detect optimal CPU thread count
	cpu_thread_count = OS.get_processor_count()
	print("[GPU] Detected ", cpu_thread_count, " CPU cores for hybrid processing")
	
	# Initialize GPU compute pipeline
	_initialize_gpu_pipeline()

func _initialize_gpu_pipeline() -> void:
	"""Initialize GPU compute pipeline for tile processing."""
	rendering_device = RenderingServer.create_local_rendering_device()
	
	if rendering_device == null:
		print("[GPU] WARNING: Could not create rendering device, falling back to CPU")
		use_gpu_acceleration = false
		return
	
	# Load compute shader for tile processing
	var shader_file = load("res://shaders/tile_compute.glsl")
	if shader_file == null:
		print("[GPU] Creating compute shader...")
		_create_compute_shader()
	else:
		var shader_spirv = shader_file.get_spirv()
		compute_shader = rendering_device.shader_create_from_spirv(shader_spirv)
	
	if compute_shader.is_valid():
		print("[GPU] ✓ GPU compute pipeline ready for RTX 3090")
	else:
		print("[GPU] WARNING: Compute shader failed, using CPU acceleration")
		use_gpu_acceleration = false

func _create_compute_shader() -> void:
	"""Create optimized compute shader for RTX 3090 tile processing."""
	var shader_code = """
#version 450

// RTX 3090 optimized compute shader for tile painting
// Processes tiles in parallel using GPU cores

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

// Input buffers
layout(set = 0, binding = 0, std430) restrict readonly buffer BiomeBuffer {
	uint biome_data[];
};

layout(set = 0, binding = 1, std430) restrict readonly buffer SlopeBuffer {
	uint slope_data[];
};

layout(set = 0, binding = 2, std430) restrict readonly buffer RiverBuffer {
	uint river_data[];
};

layout(set = 0, binding = 3, std430) restrict readonly buffer NoiseBuffer {
	uint noise_data[];
};

// Output buffer for tile IDs
layout(set = 0, binding = 4, std430) restrict writeonly buffer TileBuffer {
	uint tile_data[];
};

// Uniform parameters
layout(set = 0, binding = 5, std430) restrict readonly buffer ParamsBuffer {
	uint chunk_size;
	uint tile_types[16];  // Tile ID mapping
	float biome_weights[8];  // Biome influence weights
};

// Biome to tile mapping (optimized lookup)
const uint BIOME_OCEAN = 0u;
const uint BIOME_BEACH = 1u;
const uint BIOME_GRASS = 2u;
const uint BIOME_DESERT = 3u;
const uint BIOME_FOREST = 4u;
const uint BIOME_ROCK = 5u;
const uint BIOME_TUNDRA = 6u;

// Tile IDs
const uint TILE_WATER = 0u;
const uint TILE_SAND = 1u;
const uint TILE_GRASS = 2u;
const uint TILE_DIRT = 3u;
const uint TILE_STONE = 4u;
const uint TILE_FOREST = 5u;
const uint TILE_ROCK = 6u;
const uint TILE_MUD = 7u;
const uint TILE_GRAVEL = 8u;
const uint TILE_MOSS = 9u;
const uint TILE_SNOW = 10u;
const uint TILE_ICE = 11u;
const uint TILE_LAVA = 12u;
const uint TILE_CRYSTAL = 13u;
const uint TILE_PATH = 14u;
const uint TILE_FLOWERS = 15u;

uint get_tile_for_biome(uint biome_id, uint slope, uint river, uint noise) {
	switch(biome_id) {
		case BIOME_OCEAN:
			return river > 128u ? TILE_WATER : (slope > 200u ? TILE_SAND : TILE_WATER);
			
		case BIOME_BEACH:
			return slope > 180u ? TILE_GRAVEL : TILE_SAND;
			
		case BIOME_GRASS:
			if (river > 200u) return TILE_WATER;
			if (slope > 220u) return TILE_ROCK;
			if (noise > 240u) return TILE_FLOWERS;
			if (noise > 200u) return TILE_FOREST;
			return TILE_GRASS;
			
		case BIOME_DESERT:
			if (slope > 200u) return TILE_STONE;
			if (noise > 250u) return TILE_CRYSTAL;
			return TILE_SAND;
			
		case BIOME_FOREST:
			if (river > 200u) return TILE_WATER;
			if (slope > 230u) return TILE_ROCK;
			if (noise > 220u) return TILE_MOSS;
			if (noise > 180u) return TILE_DIRT;
			return TILE_FOREST;
			
		case BIOME_ROCK:
			if (slope > 180u) return TILE_STONE;
			if (noise > 240u) return TILE_GRAVEL;
			return TILE_ROCK;
			
		case BIOME_TUNDRA:
			if (river > 200u) return TILE_ICE;
			if (slope > 200u) return TILE_STONE;
			return TILE_SNOW;
			
		default:
			return TILE_GRASS;
	}
}

void main() {
	uvec2 coord = gl_GlobalInvocationID.xy;
	uint chunk_size_val = chunk_size;
	
	// Bounds check
	if (coord.x >= chunk_size_val || coord.y >= chunk_size_val) {
		return;
	}
	
	uint index = coord.y * chunk_size_val + coord.x;
	
	// Sample input data
	uint biome = biome_data[index];
	uint slope = slope_data[index];
	uint river = river_data[index];
	uint noise = noise_data[index];
	
	// Determine tile type using optimized lookup
	uint tile_id = get_tile_for_biome(biome, slope, river, noise);
	
	// Write result
	tile_data[index] = tile_id;
}
"""
	
	# Save shader to file for future use
	var file = FileAccess.open("res://shaders/tile_compute.glsl", FileAccess.WRITE)
	if file:
		file.store_string(shader_code)
		file.close()
		print("[GPU] Compute shader created and saved")

func load_tileset_metadata(metadata_path: String) -> void:
	"""Load tileset metadata for tile ID mapping."""
	if not FileAccess.file_exists(metadata_path):
		push_error("Tileset metadata not found: " + metadata_path)
		return
	
	var file := FileAccess.open(metadata_path, FileAccess.READ)
	var json_text := file.get_as_text()
	file.close()
	
	var json := JSON.new()
	var parse_result := json.parse(json_text)
	if parse_result != OK:
		push_error("Failed to parse tileset metadata")
		return
	
	var metadata: Dictionary = json.data
	
	# Setup debug tileset if needed
	var need_debug := (not FileAccess.file_exists("res://assets/tilesets/WorldTileSet.tres"))
	need_debug = need_debug or (ground_tilemap != null and ground_tilemap.tile_set == null)
	
	if need_debug and FileAccess.file_exists("res://assets/tilesets/DebugTileSet.tres"):
		print("[GPU] Using debug tileset with GPU acceleration")
		var set := load("res://assets/tilesets/DebugTileSet.tres") as TileSet
		if ground_tilemap: ground_tilemap.tile_set = set
		if cliff_tilemap: cliff_tilemap.tile_set = set
		if water_tilemap: water_tilemap.tile_set = set
		if deco_tilemap: deco_tilemap.tile_set = set
		
		# Build biome mapping for GPU processing
		var debug_map := {
			"ocean": 0, "beach": 1, "grass": 2, "desert": 3,
			"forest": 4, "rock": 5, "tundra": 6
		}
		for name in debug_map.keys():
			biome_tile_mapping[name] = {
				"ground_tiles": [int(debug_map[name])],
				"cliff_tiles": [5], "water_tiles": [0]
			}
	
	# Cache tile source ID
	var any_tm := ground_tilemap if ground_tilemap != null else (cliff_tilemap if cliff_tilemap != null else (water_tilemap if water_tilemap != null else deco_tilemap))
	if any_tm != null and any_tm.tile_set != null and any_tm.tile_set.get_source_count() > 0:
		_tile_source_id = any_tm.tile_set.get_source_id(0)
	else:
		_tile_source_id = 0

func paint_chunk_from_masks_gpu(chunk_x: int, chunk_y: int, masks_dir: String) -> void:
	"""GPU-accelerated tile painting using RTX 3090 compute shaders."""
	print("[GPU] Starting RTX 3090 accelerated painting for chunk (", chunk_x, ",", chunk_y, ")")
	var start_time = Time.get_ticks_msec()
	
	var mask_dir := masks_dir + "/chunk_%d_%d" % [chunk_x, chunk_y]
	
	if not DirAccess.dir_exists_absolute(mask_dir):
		push_error("Mask directory not found: " + mask_dir)
		return
	
	# Load metadata
	var meta_path := mask_dir + "/metadata.json"
	var file := FileAccess.open(meta_path, FileAccess.READ)
	if file == null:
		push_error("Failed to load chunk metadata: " + meta_path)
		return
	
	var json := JSON.new()
	var parse_result := json.parse(file.get_as_text())
	file.close()
	
	if parse_result != OK:
		push_error("Failed to parse chunk metadata")
		return
	
	var metadata: Dictionary = json.data
	var chunk_size: int = metadata["chunk_size"]
	
	if use_gpu_acceleration and rendering_device != null:
		# GPU-accelerated path
		_paint_chunk_gpu_compute(mask_dir, chunk_size)
	else:
		# Fallback to optimized CPU path
		_paint_chunk_cpu_optimized(mask_dir, chunk_size)
	
	var elapsed = Time.get_ticks_msec() - start_time
	print("[GPU] Chunk painting completed in ", elapsed, "ms")

func _paint_chunk_gpu_compute(mask_dir: String, chunk_size: int) -> void:
	"""RTX 3090 compute shader implementation for maximum GPU utilization."""
	print("[GPU] Launching RTX 3090 compute kernels...")
	
	# Load mask data
	var biome_mask := _load_mask_png_gpu_ready(mask_dir + "/biome.png", chunk_size)
	var slope_mask := _load_mask_png_gpu_ready(mask_dir + "/slope.png", chunk_size)
	var river_mask := _load_mask_png_gpu_ready(mask_dir + "/river.png", chunk_size)
	var blue_noise := _load_mask_png_gpu_ready(mask_dir + "/blue_noise.png", chunk_size)
	
	# Create GPU buffers
	var total_pixels = chunk_size * chunk_size
	
	# Input buffers
	var biome_buffer := rendering_device.storage_buffer_create(total_pixels * 4)  # uint32 per pixel
	var slope_buffer := rendering_device.storage_buffer_create(total_pixels * 4)
	var river_buffer := rendering_device.storage_buffer_create(total_pixels * 4)
	var noise_buffer := rendering_device.storage_buffer_create(total_pixels * 4)
	
	# Output buffer
	var tile_buffer := rendering_device.storage_buffer_create(total_pixels * 4)
	
	# Parameters buffer
	var params_data := PackedInt32Array()
	params_data.append(chunk_size)
	for i in range(16): params_data.append(i)  # Tile type mapping
	for i in range(8): params_data.append(1.0)  # Biome weights
	var params_buffer := rendering_device.storage_buffer_create(params_data.to_byte_array().size())
	
	# Upload data to GPU (Godot 4.4: buffer_update requires 4 args: rid, offset, size, data)
	var biome_bytes := biome_mask.to_byte_array()
	var slope_bytes := slope_mask.to_byte_array()
	var river_bytes := river_mask.to_byte_array()
	var noise_bytes := blue_noise.to_byte_array()
	var params_bytes := params_data.to_byte_array()
	rendering_device.buffer_update(biome_buffer, 0, biome_bytes.size(), biome_bytes)
	rendering_device.buffer_update(slope_buffer, 0, slope_bytes.size(), slope_bytes)
	rendering_device.buffer_update(river_buffer, 0, river_bytes.size(), river_bytes)
	rendering_device.buffer_update(noise_buffer, 0, noise_bytes.size(), noise_bytes)
	rendering_device.buffer_update(params_buffer, 0, params_bytes.size(), params_bytes)
	
	# Create uniform set
	var uniform := RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
	uniform.binding = 0
	uniform.add_id(biome_buffer)
	
	var uniform_set := rendering_device.uniform_set_create([
		_create_storage_uniform(0, biome_buffer),
		_create_storage_uniform(1, slope_buffer),
		_create_storage_uniform(2, river_buffer),
		_create_storage_uniform(3, noise_buffer),
		_create_storage_uniform(4, tile_buffer),
		_create_storage_uniform(5, params_buffer)
	], compute_shader, 0)
	
	# Dispatch compute shader with optimal workgroup size for RTX 3090
	var workgroup_size = 16  # 16x16 = 256 threads per workgroup (optimal for RTX 3090)
	var dispatch_x = (chunk_size + workgroup_size - 1) / workgroup_size
	var dispatch_y = (chunk_size + workgroup_size - 1) / workgroup_size
	
	var compute_list := rendering_device.compute_list_begin()
	rendering_device.compute_list_bind_compute_pipeline(compute_list, compute_shader)
	rendering_device.compute_list_bind_uniform_set(compute_list, uniform_set, 0)
	rendering_device.compute_list_dispatch(compute_list, dispatch_x, dispatch_y, 1)
	rendering_device.compute_list_end()
	
	# Submit and wait for completion
	rendering_device.submit()
	rendering_device.wait()
	
	# Read back results
	var output_bytes := rendering_device.buffer_get_data(tile_buffer)
	var tile_results := output_bytes.to_int32_array()
	
	# Apply results to tilemaps using optimized CPU threading
	_apply_gpu_results_to_tilemaps(tile_results, chunk_size)
	
	print("[GPU] RTX 3090 compute processing complete")

func _create_storage_uniform(binding: int, buffer: RID) -> RDUniform:
	"""Helper to create storage buffer uniform."""
	var uniform := RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
	uniform.binding = binding
	uniform.add_id(buffer)
	return uniform

func _apply_gpu_results_to_tilemaps(tile_data: PackedInt32Array, chunk_size: int) -> void:
	"""Apply GPU-computed tile results to Godot tilemaps using optimized CPU threading."""
	print("[GPU] Applying results to tilemaps with CPU threading...")
	
	# Prepare tile arrays for batch operations
	var positions: Array[Vector2i] = []
	var atlas_coords: Array[Vector2i] = []
	
	positions.resize(tile_data.size())
	atlas_coords.resize(tile_data.size())
	
	# Build position and atlas coordinate arrays
	for i in range(tile_data.size()):
		var x = i % chunk_size
		var y = i / chunk_size
		positions[i] = Vector2i(x, y)
		atlas_coords[i] = Vector2i(tile_data[i], 0)
	
	# Use threaded batch painting for maximum CPU utilization
	var thread_pool := []
	var tiles_per_thread = tile_data.size() / cpu_thread_count
	
	for thread_id in range(cpu_thread_count):
		var start_idx = thread_id * tiles_per_thread
		var end_idx = start_idx + tiles_per_thread
		if thread_id == cpu_thread_count - 1:
			end_idx = tile_data.size()  # Last thread handles remainder
		
		var thread := Thread.new()
		thread_pool.append(thread)
		
		# Start thread for this batch
		thread.start(_paint_tiles_batch_threaded.bind(positions.slice(start_idx, end_idx), atlas_coords.slice(start_idx, end_idx)))
	
	# Wait for all threads to complete
	for thread in thread_pool:
		thread.wait_to_finish()
	
	print("[GPU] Threaded tilemap application complete")

func _paint_tiles_batch_threaded(positions: Array[Vector2i], atlas_coords: Array[Vector2i]) -> void:
	"""Thread worker function for painting tile batches."""
	# Paint to appropriate tilemaps based on tile type
	for i in range(positions.size()):
		var pos = positions[i]
		var atlas = atlas_coords[i]
		var tile_id = atlas.x
		
		# Route to appropriate tilemap based on tile type
		if tile_id == 0:  # Water
			if water_tilemap: water_tilemap.set_cell(0, pos, _tile_source_id, atlas)
		elif tile_id >= 1 and tile_id <= 5:  # Ground tiles
			if ground_tilemap: ground_tilemap.set_cell(0, pos, _tile_source_id, atlas)
		elif tile_id >= 6 and tile_id <= 8:  # Cliff tiles
			if cliff_tilemap: cliff_tilemap.set_cell(0, pos, _tile_source_id, atlas)
		else:  # Decoration tiles
			if deco_tilemap: deco_tilemap.set_cell(0, pos, _tile_source_id, atlas)

func _paint_chunk_cpu_optimized(mask_dir: String, chunk_size: int) -> void:
	"""Optimized CPU fallback using all available cores."""
	print("[GPU] Using optimized CPU path with ", cpu_thread_count, " threads")
	
	# Load masks
	var biome_mask := _load_mask_png(mask_dir + "/biome.png", chunk_size)
	var slope_mask := _load_mask_png(mask_dir + "/slope.png", chunk_size)
	var river_mask := _load_mask_png(mask_dir + "/river.png", chunk_size)
	var blue_noise := _load_mask_png(mask_dir + "/blue_noise.png", chunk_size)
	
	# Process in parallel chunks
	var pixels_per_thread = (chunk_size * chunk_size) / cpu_thread_count
	var thread_pool := []
	
	for thread_id in range(cpu_thread_count):
		var start_pixel = thread_id * pixels_per_thread
		var end_pixel = start_pixel + pixels_per_thread
		if thread_id == cpu_thread_count - 1:
			end_pixel = chunk_size * chunk_size
		
		var thread := Thread.new()
		thread_pool.append(thread)
		thread.start(_process_pixels_batch.bind(biome_mask, slope_mask, river_mask, blue_noise, chunk_size, start_pixel, end_pixel))
	
	# Wait for completion
	for thread in thread_pool:
		thread.wait_to_finish()

func _process_pixels_batch(biome_mask: PackedByteArray, slope_mask: PackedByteArray, river_mask: PackedByteArray, blue_noise: PackedByteArray, chunk_size: int, start_pixel: int, end_pixel: int) -> void:
	"""Process a batch of pixels in a worker thread."""
	for pixel_idx in range(start_pixel, end_pixel):
		var x = pixel_idx % chunk_size
		var y = pixel_idx / chunk_size
		
		if pixel_idx >= biome_mask.size():
			continue
		
		var biome_id = biome_mask[pixel_idx]
		var slope_val = slope_mask[pixel_idx] if pixel_idx < slope_mask.size() else 0
		var river_val = river_mask[pixel_idx] if pixel_idx < river_mask.size() else 0
		var noise_val = blue_noise[pixel_idx] if pixel_idx < blue_noise.size() else 0
		
		var tile_id = _get_tile_for_biome_optimized(biome_id, slope_val, river_val, noise_val)
		
		# Apply to appropriate tilemap (thread-safe)
		call_deferred("_set_tile_deferred", x, y, tile_id)

func _set_tile_deferred(x: int, y: int, tile_id: int) -> void:
	"""Thread-safe tile setting using deferred calls."""
	var pos = Vector2i(x, y)
	var atlas = Vector2i(tile_id, 0)
	
	if tile_id == 0 and water_tilemap:
		water_tilemap.set_cell(0, pos, _tile_source_id, atlas)
	elif tile_id >= 1 and tile_id <= 5 and ground_tilemap:
		ground_tilemap.set_cell(0, pos, _tile_source_id, atlas)
	elif tile_id >= 6 and tile_id <= 8 and cliff_tilemap:
		cliff_tilemap.set_cell(0, pos, _tile_source_id, atlas)
	elif deco_tilemap:
		deco_tilemap.set_cell(0, pos, _tile_source_id, atlas)

func _get_tile_for_biome_optimized(biome_id: int, slope: int, river: int, noise: int) -> int:
	"""Optimized tile selection logic matching GPU shader."""
	match biome_id:
		0:  # Ocean
			return 0 if river <= 128 else (1 if slope > 200 else 0)
		1:  # Beach
			return 8 if slope > 180 else 1  # Gravel or sand
		2:  # Grass
			if river > 200: return 0  # Water
			if slope > 220: return 6  # Rock
			if noise > 240: return 15  # Flowers
			if noise > 200: return 5  # Forest
			return 2  # Grass
		3:  # Desert
			if slope > 200: return 4  # Stone
			if noise > 250: return 13  # Crystal
			return 1  # Sand
		4:  # Forest
			if river > 200: return 0  # Water
			if slope > 230: return 6  # Rock
			if noise > 220: return 9  # Moss
			if noise > 180: return 3  # Dirt
			return 5  # Forest
		5:  # Rock
			if slope > 180: return 4  # Stone
			if noise > 240: return 8  # Gravel
			return 6  # Rock
		6:  # Tundra
			if river > 200: return 11  # Ice
			if slope > 200: return 4  # Stone
			return 10  # Snow
		_:
			return 2  # Default to grass

func _load_mask_png_gpu_ready(path: String, size: int) -> PackedInt32Array:
	"""Load mask PNG and convert to GPU-ready format."""
	var mask := PackedInt32Array()
	mask.resize(size * size)
	
	if not FileAccess.file_exists(path):
		return mask
	
	var img := Image.load_from_file(path)
	if img == null:
		return mask
	
	img.convert(Image.FORMAT_L8)
	img.flip_y()
	
	for y in range(size):
		for x in range(size):
			var v := img.get_pixel(x, y).r
			var idx = y * size + x
			mask[idx] = int(round(v * 255.0)) if path.ends_with("biome.png") else int(v > 0.5)
	
	return mask

func _load_mask_png(path: String, size: int) -> PackedByteArray:
	"""Load mask PNG in standard format."""
	var mask := PackedByteArray()
	mask.resize(size * size)
	
	if not FileAccess.file_exists(path):
		return mask
	
	var img := Image.load_from_file(path)
	if img == null:
		return mask
	
	img.convert(Image.FORMAT_L8)
	img.flip_y()
	
	for y in range(size):
		for x in range(size):
			var v := img.get_pixel(x, y).r
			mask[y * size + x] = int(round(v * 255.0)) if path.ends_with("biome.png") else int(v > 0.5)
	
	return mask

func get_performance_stats() -> Dictionary:
	"""Get performance statistics for monitoring."""
	return {
		"gpu_acceleration": use_gpu_acceleration,
		"cpu_threads": cpu_thread_count,
		"gpu_batch_size": gpu_batch_size,
		"compute_shader_valid": compute_shader.is_valid() if compute_shader.is_valid() else false
	}
