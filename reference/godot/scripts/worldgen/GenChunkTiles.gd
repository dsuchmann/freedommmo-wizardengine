extends SceneTree

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

	print("[HB] GenChunkTiles generating chunk (%d, %d) with seed %d" % [X, Y, SEED])

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

	# Create TilePainter and configure (preload to avoid global class load issues)
	var painter := preload("res://scripts/worldgen/TilePainter.gd").new()
	painter.ground_tilemap = ground_tilemap
	painter.cliff_tilemap = cliff_tilemap
	painter.water_tilemap = water_tilemap
	painter.deco_tilemap = deco_tilemap

	# Load tileset metadata
	var metadata_path := "res://assets/atlas/tileset_metadata.json"
	if FileAccess.file_exists(metadata_path):
		painter.load_tileset_metadata(metadata_path)
	else:
		print("Warning: No tileset metadata found, using mock data")

	# Paint the chunk using masks
	var masks_dir := "generated/masks"
	painter.paint_chunk_from_masks(X, Y, masks_dir)

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

	print("[HB] GenChunkTiles saved: " + output_scene)
	quit()
