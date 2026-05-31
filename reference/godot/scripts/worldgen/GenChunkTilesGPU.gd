extends SceneTree

## GPU-Accelerated Chunk Generation for RTX 3090
## Integrates GPU tile painter with existing pipeline

func _init():
	var args: PackedStringArray = OS.get_cmdline_args()
	if args.size() < 2:
		push_error("Usage: -- X Y [SEED]")
		quit(1)
		return

	var X: int = int(args[0])
	var Y: int = int(args[1])
	var SEED: int = 12345
	if args.size() >= 3:
		SEED = int(args[2])

	print("[GPU] GenChunkTilesGPU generating chunk (%d, %d) with RTX 3090 acceleration" % [X, Y, SEED])

	# Load WorldChunk template
	var chunk_template := load("res://scenes/world/WorldChunk.tscn") as PackedScene
	if chunk_template == null:
		push_error("Failed to load WorldChunk template")
		quit(1)
		return

	var chunk_instance := chunk_template.instantiate()
	
	# Get TileMap references
	var water_tilemap := chunk_instance.get_node("WaterTileMap") as TileMap
	var ground_tilemap := chunk_instance.get_node("GroundTileMap") as TileMap
	var cliff_tilemap := chunk_instance.get_node("CliffTileMap") as TileMap
	var deco_tilemap := chunk_instance.get_node("DecoTileMap") as TileMap

	# Create GPU-accelerated TilePainter
	var gpu_painter := preload("res://scripts/worldgen/GPUTilePainter.gd").new()
	gpu_painter.ground_tilemap = ground_tilemap
	gpu_painter.cliff_tilemap = cliff_tilemap
	gpu_painter.water_tilemap = water_tilemap
	gpu_painter.deco_tilemap = deco_tilemap

	# Load tileset metadata
	var metadata_path := "res://assets/atlas/tileset_metadata.json"
	if FileAccess.file_exists(metadata_path):
		gpu_painter.load_tileset_metadata(metadata_path)
	else:
		print("[GPU] Warning: No tileset metadata found, using debug tileset")

	# Paint the chunk using GPU acceleration
	var masks_dir := "generated/masks"
	var start_time = Time.get_ticks_msec()
	
	gpu_painter.paint_chunk_from_masks_gpu(X, Y, masks_dir)
	
	var elapsed = Time.get_ticks_msec() - start_time
	print("[GPU] GPU-accelerated painting completed in ", elapsed, "ms")

	# Print performance stats
	var stats = gpu_painter.get_performance_stats()
	print("[GPU] Performance Stats:")
	for key in stats.keys():
		print("  ", key, ": ", stats[key])

	# Save the painted chunk
	var output_scene := "res://scenes/world/WorldChunk_%d_%d.tscn" % [X, Y]
	
	# Ensure output directory exists
	var da := DirAccess.open("res://")
	if da:
		da.make_dir_recursive("scenes/world")

	var packed_scene := PackedScene.new()
	var pack_result := packed_scene.pack(chunk_instance)
	if pack_result != OK:
		push_error("Failed to pack chunk scene")
		quit(1)
		return

	var save_result := ResourceSaver.save(packed_scene, output_scene)
	if save_result != OK:
		push_error("Failed to save chunk scene: " + output_scene)
		quit(1)
		return

	print("[GPU] GenChunkTilesGPU saved: " + output_scene)
	quit()
