class_name ChunkCache

## Binary serialization for compiled terrain chunks.
## Files stored at user://chunks/{cx}_{cy}.bin
##
## Binary format:
##   u32  magic          (0x434B4E4B)
##   u16  version        (1)
##   i32  chunk_x
##   i32  chunk_y
##   i32  world_seed
##   u16  size           (64)
##   Then terrain arrays:
##     elevation           PackedFloat32Array  → 4096 * 4 bytes
##     slope               PackedFloat32Array  → 4096 * 4 bytes
##     ocean_mask          PackedByteArray     → 4096 bytes
##     ocean_distance      PackedFloat32Array  → 4096 * 4 bytes
##     temperature         PackedFloat32Array  → 4096 * 4 bytes
##     precipitation       PackedFloat32Array  → 4096 * 4 bytes
##     biome_id            PackedByteArray     → 4096 bytes
##     vegetation_density  PackedByteArray     → 4096 bytes
##     vegetation_species  PackedByteArray     → 4096 bytes

const MAGIC: int = 0x434B4E4B
const VERSION: int = 1
const CHUNKS_DIR: String = "user://chunks"


static func get_path(cx: int, cy: int) -> String:
	return CHUNKS_DIR + "/%d_%d.bin" % [cx, cy]


static func has_chunk(cx: int, cy: int) -> bool:
	return FileAccess.file_exists(get_path(cx, cy))


static func _ensure_dir() -> void:
	var dir = DirAccess.open("user://")
	if not dir.dir_exists("chunks"):
		dir.make_dir("chunks")


static func save_chunk(chunk: ChunkData) -> bool:
	_ensure_dir()
	var path = get_path(chunk.chunk_x, chunk.chunk_y)
	var f = FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("ChunkCache: failed to open for write: " + path)
		return false

	# Header
	f.store_32(MAGIC)
	f.store_16(VERSION)
	f.store_32(chunk.chunk_x)
	f.store_32(chunk.chunk_y)
	f.store_32(chunk.world_seed)
	f.store_16(ChunkData.SIZE)

	# Terrain arrays
	f.store_buffer(chunk.elevation.to_byte_array())
	f.store_buffer(chunk.slope.to_byte_array())
	f.store_buffer(chunk.ocean_mask)
	f.store_buffer(chunk.ocean_distance.to_byte_array())
	f.store_buffer(chunk.temperature.to_byte_array())
	f.store_buffer(chunk.precipitation.to_byte_array())
	f.store_buffer(chunk.biome_id)
	f.store_buffer(chunk.vegetation_density)
	f.store_buffer(chunk.vegetation_species)

	f.close()
	return true


static func load_chunk(cx: int, cy: int, expected_seed: int) -> ChunkData:
	var path = get_path(cx, cy)
	if not FileAccess.file_exists(path):
		return null

	var f = FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("ChunkCache: failed to open for read: " + path)
		return null

	# Validate header
	var magic = f.get_32()
	if magic != MAGIC:
		f.close()
		push_warning("ChunkCache: bad magic in " + path)
		DirAccess.remove_absolute(path)
		return null

	var version = f.get_16()
	if version != VERSION:
		f.close()
		push_warning("ChunkCache: unsupported version %d in %s" % [version, path])
		DirAccess.remove_absolute(path)
		return null

	# get_32 returns unsigned; reinterpret as signed for negative chunk coords
	var file_cx = f.get_32()
	if file_cx > 0x7FFFFFFF:
		file_cx = file_cx - 0x100000000
	var file_cy = f.get_32()
	if file_cy > 0x7FFFFFFF:
		file_cy = file_cy - 0x100000000
	var file_seed = f.get_32()
	var file_size = f.get_16()

	# Validate seed
	if file_seed != expected_seed:
		f.close()
		push_warning("ChunkCache: seed mismatch for %s (expected %d, got %d)" % [path, expected_seed, file_seed])
		DirAccess.remove_absolute(path)
		return null

	# Validate dimensions
	if file_size != ChunkData.SIZE:
		f.close()
		push_warning("ChunkCache: size mismatch in " + path)
		DirAccess.remove_absolute(path)
		return null

	var total = ChunkData.SIZE * ChunkData.SIZE
	var float_bytes = total * 4

	var chunk = ChunkData.new()
	chunk.chunk_x = file_cx
	chunk.chunk_y = file_cy
	chunk.world_seed = file_seed

	chunk.elevation = f.get_buffer(float_bytes).to_float32_array()
	chunk.slope = f.get_buffer(float_bytes).to_float32_array()
	chunk.ocean_mask = f.get_buffer(total)
	chunk.ocean_distance = f.get_buffer(float_bytes).to_float32_array()
	chunk.temperature = f.get_buffer(float_bytes).to_float32_array()
	chunk.precipitation = f.get_buffer(float_bytes).to_float32_array()
	chunk.biome_id = f.get_buffer(total)
	chunk.vegetation_density = f.get_buffer(total)
	chunk.vegetation_species = f.get_buffer(total)

	f.close()
	return chunk
