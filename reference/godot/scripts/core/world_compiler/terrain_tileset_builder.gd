class_name TerrainTilesetBuilder

## Builds a Godot TileSet with Terrain Sets from terrain_v4 tilesets.
## Configures terrain peering bits on each tile for automatic edge selection.
## Uses TERRAIN_MODE_MATCH_CORNERS for 2-corner Wang tilesets (16 tiles each).
##
## Directory structure:
##   terrain_v4/surfaces/{surface_id}/tileset.png       — self tiles
##   terrain_v4/transitions/{lower}__{upper}/tileset.png — transition tiles
##   terrain_v4/void_edges/void__{surface_id}/tileset.png — edge-to-void tiles

const TERRAIN_V4 = "res://assets/catalog/terrain_v4"

# Grid index (row*4 + col in 4x4 spritesheet) -> our wang index
# Our convention: TL=bit0, TR=bit1, BL=bit2, BR=bit3
# Verified by pixel sampling of PixelLab MCP spritesheets.
const GRID_TO_WANG: Dictionary = {
	6: 0, 5: 1, 2: 2, 3: 3, 10: 4, 1: 5, 4: 6, 13: 7,
	7: 8, 14: 9, 11: 10, 0: 11, 9: 12, 8: 13, 15: 14, 12: 15
}

# Godot corner peering bit constants, indexed by our wang bit position
const CORNER_NEIGHBORS = [
	TileSet.CELL_NEIGHBOR_TOP_LEFT_CORNER,      # bit 0
	TileSet.CELL_NEIGHBOR_TOP_RIGHT_CORNER,     # bit 1
	TileSet.CELL_NEIGHBOR_BOTTOM_LEFT_CORNER,   # bit 2
	TileSet.CELL_NEIGHBOR_BOTTOM_RIGHT_CORNER,  # bit 3
]

var tileset: TileSet = null
var terrain_ids: Dictionary = {}   # surface_id -> terrain index
var source_ids: Dictionary = {}    # tileset_key -> source_id in TileSet
var _next_source_id: int = 0


func build(tile_size: int = 32) -> TileSet:
	tileset = TileSet.new()
	tileset.tile_size = Vector2i(tile_size, tile_size)
	tileset.tile_shape = TileSet.TILE_SHAPE_SQUARE

	# Create terrain set 0: match corners (2-corner Wang, 16 tiles)
	tileset.add_terrain_set()
	tileset.set_terrain_set_mode(0, TileSet.TERRAIN_MODE_MATCH_CORNERS)

	# Step 1: Discover all surfaces and register as terrains
	_discover_surfaces()

	# Step 2: Add self-tile atlas sources (one per surface)
	_add_surface_sources(tile_size)

	# Step 3: Add transition tile atlas sources
	_add_transition_sources(tile_size)

	# Step 4: Add void-edge atlas sources
	_add_void_edge_sources(tile_size)

	print("[TerrainTilesetBuilder] Built: %d terrains, %d sources" % [
		terrain_ids.size(), source_ids.size()])

	return tileset


func _discover_surfaces() -> void:
	## Scan surfaces/ directory and register each as a terrain.
	var surfaces_dir = TERRAIN_V4 + "/surfaces"
	var da = DirAccess.open(surfaces_dir)
	if da == null:
		push_error("[TerrainTilesetBuilder] Cannot open %s" % surfaces_dir)
		return

	var names: Array[String] = []
	da.list_dir_begin()
	var dir_name = da.get_next()
	while dir_name != "":
		if da.current_is_dir() and not dir_name.begins_with("."):
			if FileAccess.file_exists(surfaces_dir + "/" + dir_name + "/tileset.png"):
				names.append(dir_name)
		dir_name = da.get_next()
	names.sort()

	var colors = {
		"ocean_water": Color(0.1, 0.3, 0.8),
		"golden_sand": Color(0.85, 0.75, 0.45),
		"lush_grass": Color(0.3, 0.7, 0.2),
		"dry_grass": Color(0.65, 0.6, 0.25),
		"forest_floor": Color(0.4, 0.3, 0.15),
		"dark_humus": Color(0.25, 0.18, 0.1),
		"grey_rock": Color(0.5, 0.5, 0.5),
		"snow": Color(0.95, 0.95, 1.0),
		"glacial_ice": Color(0.7, 0.85, 1.0),
		"frozen_earth": Color(0.5, 0.55, 0.6),
		"volcanic_rock": Color(0.35, 0.15, 0.1),
		"swamp_mud": Color(0.35, 0.3, 0.2),
		"mystic_crystal": Color(0.5, 0.3, 0.7),
	}

	for i in range(names.size()):
		var surface_id = names[i]
		tileset.add_terrain(0)
		tileset.set_terrain_name(0, i, surface_id)
		tileset.set_terrain_color(0, i, colors.get(surface_id, Color.WHITE))
		terrain_ids[surface_id] = i
		print("  Terrain %d: %s" % [i, surface_id])


func _add_surface_sources(tile_size: int) -> void:
	## Add self-tile atlas sources. Each tile gets peering bits for its own terrain.
	for surface_id in terrain_ids:
		var terrain_id = terrain_ids[surface_id]
		var tex_path = TERRAIN_V4 + "/surfaces/" + surface_id + "/tileset.png"
		_add_atlas_source(tex_path, surface_id, terrain_id, terrain_id, tile_size)


func _add_transition_sources(tile_size: int) -> void:
	## Add transition tile atlas sources. Each tile gets peering bits for both terrains.
	var trans_dir = TERRAIN_V4 + "/transitions"
	var da = DirAccess.open(trans_dir)
	if da == null:
		return

	da.list_dir_begin()
	var dir_name = da.get_next()
	while dir_name != "":
		if da.current_is_dir() and not dir_name.begins_with("."):
			var parts = dir_name.split("__")
			if parts.size() == 2:
				var lower_id = parts[0]
				var upper_id = parts[1]
				if terrain_ids.has(lower_id) and terrain_ids.has(upper_id):
					var tex_path = trans_dir + "/" + dir_name + "/tileset.png"
					var lower_terrain = terrain_ids[lower_id]
					var upper_terrain = terrain_ids[upper_id]
					_add_atlas_source(tex_path, dir_name, lower_terrain, upper_terrain, tile_size)
		dir_name = da.get_next()


func _add_void_edge_sources(tile_size: int) -> void:
	## Add void-to-surface edge tiles. Empty corners get -1 (wildcard/void).
	var void_dir = TERRAIN_V4 + "/void_edges"
	var da = DirAccess.open(void_dir)
	if da == null:
		return

	da.list_dir_begin()
	var dir_name = da.get_next()
	while dir_name != "":
		if da.current_is_dir() and dir_name.begins_with("void__"):
			var surface_id = dir_name.substr(6)  # strip "void__"
			if terrain_ids.has(surface_id):
				var tex_path = void_dir + "/" + dir_name + "/tileset.png"
				var terrain_id = terrain_ids[surface_id]
				# lower = -1 (void/wildcard), upper = surface terrain
				_add_atlas_source(tex_path, dir_name, -1, terrain_id, tile_size)
		dir_name = da.get_next()


func _add_atlas_source(tex_path: String, key: String,
		lower_terrain: int, upper_terrain: int, tile_size: int) -> void:
	## Add a 4x4 spritesheet as an atlas source with terrain peering bits.
	## lower_terrain = terrain for empty corners (-1 for void)
	## upper_terrain = terrain for filled corners
	if not FileAccess.file_exists(tex_path):
		return

	var tex = ResourceLoader.load(tex_path) as Texture2D
	if tex == null:
		return

	var source = TileSetAtlasSource.new()
	source.texture = tex
	source.texture_region_size = Vector2i(tile_size, tile_size)

	# Create all 16 tiles in the 4x4 grid
	for grid_idx in range(16):
		var col = grid_idx % 4
		var row = grid_idx / 4
		source.create_tile(Vector2i(col, row))

	var sid = _next_source_id
	tileset.add_source(source, sid)
	source_ids[key] = sid
	_next_source_id += 1

	# Configure terrain peering bits on each tile
	for grid_idx in range(16):
		var col = grid_idx % 4
		var row = grid_idx / 4
		var td = source.get_tile_data(Vector2i(col, row), 0)
		var wang_idx = GRID_TO_WANG.get(grid_idx, 0)

		# The tile belongs to the upper terrain (the filled/opaque surface)
		td.terrain_set = 0
		td.terrain = upper_terrain

		# Set corner peering bits
		# Filled corner (bit set in wang_idx) = upper_terrain
		# Empty corner (bit not set) = lower_terrain (-1 for void)
		for bit in range(4):
			var filled = (wang_idx >> bit) & 1
			if filled:
				td.set_terrain_peering_bit(CORNER_NEIGHBORS[bit], upper_terrain)
			else:
				td.set_terrain_peering_bit(CORNER_NEIGHBORS[bit], lower_terrain)


func get_terrain_id(surface_id: String) -> int:
	return terrain_ids.get(surface_id, -1)
