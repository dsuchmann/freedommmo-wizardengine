class_name TileMapRenderer
extends RefCounted

## Renders terrain using Godot's TileMapLayer with proper 32x32 tiles.
## Scaled to match the game's coordinate system (WORLD_SCALE pixels per world tile).
## Each biome gets its own source in the TileSet.

var _tilemap: TileMapLayer
var _path_tilemap: TileMapLayer
var _tileset: TileSet
var _path_tileset: TileSet
var _biome_source_ids: Dictionary = {}  # biome → Array[int] (source IDs for variants)
var _path_source_id: int = -1
var _placed_cells: Dictionary = {}
var _path_tiles_placed: bool = false

const TILE_PX = 32  # Native tile size in tileset images
const WORLD_SCALE = 32  # Must match tile_size in threaded_terrain / GrainWorldDemo

func setup(parent: Node2D) -> TileMapLayer:
	_tilemap = TileMapLayer.new()
	_tilemap.name = "TerrainTileMap"
	_tilemap.z_index = -1  # Behind sprites, structures, objects
	_tilemap.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	# Scale TileMap so 32px tiles align with WORLD_SCALE px coordinate system
	_tilemap.scale = Vector2(float(WORLD_SCALE) / TILE_PX, float(WORLD_SCALE) / TILE_PX)

	_tileset = TileSet.new()
	_tileset.tile_size = Vector2i(TILE_PX, TILE_PX)

	# Pro tiles — multiple variants per biome for visual variety
	var biome_textures := {
		"grassland": ["res://assets/tiles/pro/grass.png", "res://assets/tiles/pro/grass_flowers.png",
			"res://assets/tiles/pro/grass_daisies.png", "res://assets/tiles/pro/grass_wildflowers.png",
			"res://assets/tiles/pro/grass_plain.png"],
		"forest": ["res://assets/tiles/pro/forest.png"],
		"mushroom_forest": ["res://assets/tiles/pro/forest.png"],
		"desert": ["res://assets/tiles/pro/desert.png"],
		"beach": ["res://assets/tiles/pro/beach.png"],
		"ocean": ["res://assets/tiles/pro/deep_water.png"],
		"deep_ocean": ["res://assets/tiles/pro/deep_water.png"],
		"shallow_water": ["res://assets/tiles/pro/shallow_water.png"],
		"hills": ["res://assets/tiles/pro/grass.png", "res://assets/tiles/pro/grass_plain.png"],
		"mountains": ["res://assets/tiles/pro/mountain.png"],
		"tundra": ["res://assets/tiles/pro/snow.png"],
		"frozen_lake": ["res://assets/tiles/pro/snow.png"],
		"swamp": ["res://assets/tiles/pro/swamp.png"],
		"volcanic": ["res://assets/tiles/pro/volcanic.png"],
	}

	var path_to_source: Dictionary = {}
	var next_id = 0

	for biome in biome_textures:
		var source_ids: Array = []
		for path in biome_textures[biome]:
			if path_to_source.has(path):
				source_ids.append(path_to_source[path])
				continue
			var tex = load(path) if ResourceLoader.exists(path) else null
			if tex == null or not tex is Texture2D:
				continue
			var source = TileSetAtlasSource.new()
			source.texture = tex
			source.texture_region_size = Vector2i(TILE_PX, TILE_PX)
			source.create_tile(Vector2i(0, 0))
			var sid = _tileset.add_source(source, next_id)
			source_ids.append(sid)
			path_to_source[path] = sid
			next_id += 1
		if not source_ids.is_empty():
			_biome_source_ids[biome] = source_ids

	_tilemap.tile_set = _tileset
	parent.add_child(_tilemap)

	# Path TileMapLayer — separate layer for dirt/stone paths above terrain
	_path_tilemap = TileMapLayer.new()
	_path_tilemap.name = "PathTileMap"
	_path_tilemap.z_index = 0  # Above terrain, below structures
	_path_tilemap.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_path_tilemap.scale = Vector2(float(WORLD_SCALE) / TILE_PX, float(WORLD_SCALE) / TILE_PX)
	_path_tileset = TileSet.new()
	_path_tileset.tile_size = Vector2i(TILE_PX, TILE_PX)
	var path_tex_path = "res://assets/tiles/pro/dirt_path.png"
	if ResourceLoader.exists(path_tex_path):
		var ptex = load(path_tex_path)
		if ptex is Texture2D:
			var psource = TileSetAtlasSource.new()
			psource.texture = ptex
			psource.texture_region_size = Vector2i(TILE_PX, TILE_PX)
			psource.create_tile(Vector2i(0, 0))
			_path_source_id = _path_tileset.add_source(psource, 0)
	_path_tilemap.tile_set = _path_tileset
	parent.add_child(_path_tilemap)

	print("TileMapRenderer: %d biome sources, paths=%s, scale=%.3f" % [
		_biome_source_ids.size(), "yes" if _path_source_id >= 0 else "no", _tilemap.scale.x])
	return _tilemap

func render_cell(cell) -> void:
	if cell == null or _tilemap == null:
		return
	var key = Vector2i(cell.cell_x, cell.cell_y)
	if _placed_cells.has(key):
		return
	_placed_cells[key] = true

	var biome = cell.biome
	var source_list = _biome_source_ids.get(biome, _biome_source_ids.get("grassland", [0]))
	var base_x = cell.cell_x * cell.CELL_SIZE
	var base_y = cell.cell_y * cell.CELL_SIZE

	for y in range(cell.CELL_SIZE):
		for x in range(cell.CELL_SIZE):
			var tile_sources = source_list
			# Per-tile biome override based on grain type
			var stack = cell.get_grain_stack(x, y)
			if stack and stack.top():
				var gt = stack.top().grain_type
				var grain_biome = _grain_to_biome(gt)
				if grain_biome != "" and _biome_source_ids.has(grain_biome):
					tile_sources = _biome_source_ids[grain_biome]
			# Pick variant deterministically from position
			var wx = base_x + x
			var wy = base_y + y
			var variant_hash = ((wx * 73856093) ^ (wy * 19349663)) & 0xFFFF
			var tile_source = tile_sources[variant_hash % tile_sources.size()]
			_tilemap.set_cell(Vector2i(wx, wy), tile_source, Vector2i(0, 0))

func _grain_to_biome(grain_type: int) -> String:
	match grain_type:
		GrainTypes.Physical.WATER, GrainTypes.Physical.CORAL:
			return "ocean"
		GrainTypes.Physical.ICE:
			return "frozen_lake"
		GrainTypes.Physical.SNOW:
			return "tundra"
		GrainTypes.Physical.SAND:
			return "desert"
		GrainTypes.Physical.LAVA:
			return "volcanic"
		GrainTypes.Physical.LEAF, GrainTypes.Physical.WOOD, GrainTypes.Physical.BARK:
			return "forest"
		GrainTypes.Physical.MUD, GrainTypes.Physical.PEAT:
			return "swamp"
		GrainTypes.Physical.STONE, GrainTypes.Physical.GRANITE, GrainTypes.Physical.BEDROCK:
			return "mountains"
		_:
			return ""

## Place path tiles on the path TileMapLayer
func render_paths(path_tiles: Array) -> void:
	if _path_tilemap == null or _path_source_id < 0 or _path_tiles_placed:
		return
	_path_tiles_placed = true
	for pos in path_tiles:
		_path_tilemap.set_cell(Vector2i(pos.x, pos.y), _path_source_id, Vector2i(0, 0))
	print("TileMapRenderer: placed %d path tiles" % path_tiles.size())
