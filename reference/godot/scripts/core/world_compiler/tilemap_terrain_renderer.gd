class_name TileMapTerrainRenderer
extends Node

## Renders compiled ChunkData onto Godot-native TileMapLayer nodes.
## Uses set_cells_terrain_connect() for automatic edge matching.
## Layers are scene-tree nodes found by name, not created dynamically.

signal chunk_render_complete(chunk_x: int, chunk_y: int)

var _tileset: TileSet = null
var _terrain_builder: TerrainTilesetBuilder = null
var _world_scale: int = 32

# Layer references (found in scene tree by name)
var _terrain_layer: TileMapLayer = null
var _cliff_layer: TileMapLayer = null
var _shading_layer: TileMapLayer = null
var _water_layer: TileMapLayer = null
var _road_layer: TileMapLayer = null
var _building_layer: TileMapLayer = null
var _roof_layer: TileMapLayer = null

# Shading + cliff tile source IDs (added dynamically to the TileSet)
var _shading_source_id: int = -1
var _cliff_source_ids: Dictionary = {}  # tier_diff -> source_id

# Elevation tier system
const TIER_THRESHOLDS: Array = [0.38, 0.50, 0.62, 0.75]
const TIER_COUNT: int = 5

# Cross-chunk lookup for neighbor surfaces
var _chunks: Dictionary = {}  # Vector2i -> ChunkData


func register_chunk(chunk: ChunkData) -> void:
	_chunks[Vector2i(chunk.chunk_x, chunk.chunk_y)] = chunk


func setup(tilemap_parent: Node2D, world_scale: int = 32) -> void:
	_world_scale = world_scale

	# Build TileSet from terrain_v4 assets
	ElevationGradientTable.load()
	_terrain_builder = TerrainTilesetBuilder.new()
	_tileset = _terrain_builder.build(world_scale)

	# Add shading + cliff tile sources
	_add_shading_and_cliff_sources()

	# Find layers in scene tree (they exist in the .tscn file)
	_terrain_layer = tilemap_parent.get_node("TerrainLayer")
	_cliff_layer = tilemap_parent.get_node("CliffLayer")
	_shading_layer = tilemap_parent.get_node("ShadingLayer")
	_water_layer = tilemap_parent.get_node("WaterLayer")
	_road_layer = tilemap_parent.get_node("RoadLayer")
	_building_layer = tilemap_parent.get_node("BuildingLayer")
	_roof_layer = tilemap_parent.get_node("RoofLayer")

	# Assign TileSet to all layers
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer != null:
			layer.tile_set = _tileset
			layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	print("[TileMapTerrainRenderer] Setup: %d terrains, %d sources" % [
		_terrain_builder.terrain_ids.size(), _terrain_builder.source_ids.size()])


func _add_shading_and_cliff_sources() -> void:
	var next_sid = _terrain_builder._next_source_id

	# 4 shade levels + 1 highlight
	_shading_source_id = next_sid
	var shade_alphas = [0.08, 0.15, 0.22, 0.30]
	for i in range(shade_alphas.size()):
		var img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
		img.fill(Color(0, 0, 0, shade_alphas[i]))
		_add_single_tile_source(img, next_sid + i)
	var hl_img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
	hl_img.fill(Color(1, 1, 1, 0.1))
	_add_single_tile_source(hl_img, next_sid + 4)

	# 4 cliff face darkness levels
	var cliff_sid = next_sid + 5
	var cliff_colors = [
		Color(0.35, 0.28, 0.18),
		Color(0.28, 0.22, 0.14),
		Color(0.22, 0.17, 0.10),
		Color(0.16, 0.12, 0.08),
	]
	for i in range(cliff_colors.size()):
		var img = Image.create(_world_scale, _world_scale, false, Image.FORMAT_RGBA8)
		for py in range(_world_scale):
			var t = float(py) / float(_world_scale)
			var row_color = cliff_colors[i].darkened(0.2).lerp(cliff_colors[i].lightened(0.1), t)
			for px in range(_world_scale):
				if py % 6 == 0:
					img.set_pixel(px, py, row_color.darkened(0.08))
				else:
					img.set_pixel(px, py, row_color)
		_add_single_tile_source(img, cliff_sid + i)
		_cliff_source_ids[i] = cliff_sid + i


func _add_single_tile_source(img: Image, sid: int) -> void:
	var tex = ImageTexture.create_from_image(img)
	var source = TileSetAtlasSource.new()
	source.texture = tex
	source.texture_region_size = Vector2i(_world_scale, _world_scale)
	source.create_tile(Vector2i(0, 0))
	_tileset.add_source(source, sid)


func render_chunk(chunk: ChunkData) -> void:
	register_chunk(chunk)
	var ox = chunk.chunk_x * ChunkData.SIZE
	var oy = chunk.chunk_y * ChunkData.SIZE
	_render_terrain(chunk, ox, oy)
	_render_cliffs(chunk, ox, oy)
	_render_shading(chunk, ox, oy)
	chunk_render_complete.emit(chunk.chunk_x, chunk.chunk_y)


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var ox = chunk_x * ChunkData.SIZE
	var oy = chunk_y * ChunkData.SIZE
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer == null:
			continue
		for y in range(ChunkData.SIZE):
			for x in range(ChunkData.SIZE):
				layer.erase_cell(Vector2i(ox + x, oy + y))


func clear_all() -> void:
	for layer in [_terrain_layer, _cliff_layer, _shading_layer,
				  _water_layer, _road_layer, _building_layer, _roof_layer]:
		if layer != null:
			layer.clear()
	_chunks.clear()


# --- Surface boundary noise ---
# Jitters elevation before gradient table lookup so surface boundaries
# are organic/wavy instead of perfectly horizontal lines.
var _boundary_noise: FastNoiseLite = null

func _get_boundary_noise() -> FastNoiseLite:
	if _boundary_noise == null:
		_boundary_noise = FastNoiseLite.new()
		_boundary_noise.seed = 9999
		_boundary_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX
		_boundary_noise.frequency = 0.08  # Medium-scale wobble
		_boundary_noise.fractal_octaves = 2
	return _boundary_noise


func _jittered_surface(biome_name: String, elevation: float, world_x: int, world_y: int) -> String:
	## Look up surface with noise-jittered elevation for organic boundaries.
	## Clamp above 0.42 so jitter never produces ocean_water or golden_sand from land tiles.
	var noise_val = _get_boundary_noise().get_noise_2d(float(world_x), float(world_y))
	var jittered_elev = clampf(elevation + noise_val * 0.08, 0.42, 1.0)
	return ElevationGradientTable.surface_at(biome_name, jittered_elev)


# --- Terrain rendering via manual set_cell (fast, cross-chunk aware) ---

# Wang index -> atlas coord in 4x4 PixelLab spritesheet
# Verified empirically: grid position for each wang corner configuration
const WANG_TO_ATLAS: Array = [
	Vector2i(2, 1),  # wang 0  (no corners filled)
	Vector2i(1, 1),  # wang 1  (TL)
	Vector2i(2, 0),  # wang 2  (TR)
	Vector2i(3, 0),  # wang 3  (TL+TR)
	Vector2i(2, 2),  # wang 4  (BL)
	Vector2i(1, 0),  # wang 5  (TL+BL)
	Vector2i(0, 1),  # wang 6  (TR+BL)
	Vector2i(1, 3),  # wang 7  (TL+TR+BL)
	Vector2i(3, 1),  # wang 8  (BR)
	Vector2i(2, 3),  # wang 9  (TL+BR)
	Vector2i(3, 2),  # wang 10 (TR+BR)
	Vector2i(0, 0),  # wang 11 (TL+TR+BR)
	Vector2i(1, 2),  # wang 12 (BL+BR)
	Vector2i(0, 2),  # wang 13 (TL+BL+BR)
	Vector2i(3, 3),  # wang 14 (TR+BL+BR)
	Vector2i(0, 3),  # wang 15 (all corners filled)
]


func _render_terrain(chunk: ChunkData, ox: int, oy: int) -> void:
	var size = ChunkData.SIZE

	# Build surface grid for this chunk
	var surface_grid: Array = []
	surface_grid.resize(size * size)
	for idx in range(size * size):
		if chunk.ocean_mask[idx] == 1:
			surface_grid[idx] = "ocean_water"
		else:
			var x = idx % size
			var y = idx / size
			# Smooth isolated biome patches: if this tile's biome differs from
			# majority of its 4 cardinal neighbors, use the majority biome instead
			var biome_id = chunk.biome_id[idx]
			var smoothed_biome = biome_id
			if x > 0 and x < size - 1 and y > 0 and y < size - 1:
				var n_biome = chunk.biome_id[(y - 1) * size + x]
				var s_biome = chunk.biome_id[(y + 1) * size + x]
				var w_biome = chunk.biome_id[y * size + (x - 1)]
				var e_biome = chunk.biome_id[y * size + (x + 1)]
				var same_count = 0
				if n_biome == biome_id: same_count += 1
				if s_biome == biome_id: same_count += 1
				if w_biome == biome_id: same_count += 1
				if e_biome == biome_id: same_count += 1
				if same_count <= 1:
					# Isolated tile — use the most common neighbor biome
					smoothed_biome = n_biome  # Pick any neighbor that's more common
			var biome_name = ElevationGradientTable.biome_name_from_id(smoothed_biome)
			var elevation = chunk.elevation[idx]
			var wx = ox + x
			var wy = oy + y
			surface_grid[idx] = _jittered_surface(biome_name, elevation, wx, wy)

	# Two-pass: fast set_cell for interior, terrain_connect for borders
	var border_cells: Dictionary = {}  # terrain_id -> Array[Vector2i]

	for y in range(size):
		for x in range(size):
			var idx = y * size + x
			var surface_id = surface_grid[idx] as String
			var cell = Vector2i(ox + x, oy + y)

			var terrain_id = _terrain_builder.get_terrain_id(surface_id)
			if terrain_id < 0:
				continue

			# Check if any neighbor has a different surface
			var is_border = false
			for d in [Vector2i(0,-1), Vector2i(0,1), Vector2i(-1,0), Vector2i(1,0)]:
				var ns = _surface_at(surface_grid, chunk, size, x + d.x, y + d.y)
				if ns != surface_id:
					is_border = true
					break

			if is_border:
				# Border tile — let Godot pick the right transition tile
				if not border_cells.has(terrain_id):
					border_cells[terrain_id] = []
				border_cells[terrain_id].append(cell)
			else:
				# Interior tile — fast direct placement (wang=15, solid fill)
				var src_id = _terrain_builder.source_ids.get(surface_id, -1)
				if src_id >= 0:
					_terrain_layer.set_cell(cell, src_id, WANG_TO_ATLAS[15])

	# Use terrain_connect for border tiles — one call per terrain type
	for terrain_id in border_cells:
		_terrain_layer.set_cells_terrain_connect(border_cells[terrain_id], 0, terrain_id, false)


func _compute_wang(grid: Array, chunk: ChunkData, size: int, x: int, y: int, surface_id: String) -> int:
	var wang = 0
	# TL corner: N, W, NW all same surface
	if _surface_at(grid, chunk, size, x, y - 1) == surface_id and \
	   _surface_at(grid, chunk, size, x - 1, y) == surface_id and \
	   _surface_at(grid, chunk, size, x - 1, y - 1) == surface_id:
		wang |= 1
	# TR corner: N, E, NE
	if _surface_at(grid, chunk, size, x, y - 1) == surface_id and \
	   _surface_at(grid, chunk, size, x + 1, y) == surface_id and \
	   _surface_at(grid, chunk, size, x + 1, y - 1) == surface_id:
		wang |= 2
	# BL corner: S, W, SW
	if _surface_at(grid, chunk, size, x, y + 1) == surface_id and \
	   _surface_at(grid, chunk, size, x - 1, y) == surface_id and \
	   _surface_at(grid, chunk, size, x - 1, y + 1) == surface_id:
		wang |= 4
	# BR corner: S, E, SE
	if _surface_at(grid, chunk, size, x, y + 1) == surface_id and \
	   _surface_at(grid, chunk, size, x + 1, y) == surface_id and \
	   _surface_at(grid, chunk, size, x + 1, y + 1) == surface_id:
		wang |= 8
	return wang


func _surface_at(grid: Array, chunk: ChunkData, size: int, lx: int, ly: int) -> String:
	## Get surface_id at local position, with cross-chunk lookup at boundaries.
	if lx >= 0 and lx < size and ly >= 0 and ly < size:
		return grid[ly * size + lx]
	# Cross-chunk lookup
	var cx = chunk.chunk_x
	var cy = chunk.chunk_y
	var nx = lx
	var ny = ly
	if nx < 0:
		cx -= 1
		nx += size
	elif nx >= size:
		cx += 1
		nx -= size
	if ny < 0:
		cy -= 1
		ny += size
	elif ny >= size:
		cy += 1
		ny -= size
	var neighbor = _chunks.get(Vector2i(cx, cy))
	if neighbor == null:
		# No neighbor loaded — assume same surface as edge tile
		return grid[clampi(ly, 0, size - 1) * size + clampi(lx, 0, size - 1)]
	if neighbor.ocean_mask[ny * size + nx] == 1:
		return "ocean_water"
	var biome_id = neighbor.biome_id[ny * size + nx]
	var biome_name = ElevationGradientTable.biome_name_from_id(biome_id)
	var elevation = neighbor.elevation[ny * size + nx]
	var world_x = cx * size + nx
	var world_y = cy * size + ny
	return _jittered_surface(biome_name, elevation, world_x, world_y)


# --- Cliff rendering ---

func _render_cliffs(chunk: ChunkData, ox: int, oy: int) -> void:
	if _cliff_source_ids.is_empty():
		return
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				continue
			var my_tier = _elevation_tier(chunk.elevation[chunk.idx(x, y)])
			# Check north neighbor for cliff (higher terrain to the north = cliff face below it)
			var north_tier = _get_neighbor_tier(chunk, x, y - 1)
			if north_tier - my_tier >= 2:
				var diff = north_tier - my_tier
				var shade_idx = clampi(diff - 1, 0, 3)
				if _cliff_source_ids.has(shade_idx):
					_cliff_layer.set_cell(
						Vector2i(ox + x, oy + y),
						_cliff_source_ids[shade_idx],
						Vector2i(0, 0))


func _elevation_tier(elev: float) -> int:
	for i in range(TIER_THRESHOLDS.size()):
		if elev < TIER_THRESHOLDS[i]:
			return i
	return TIER_COUNT


func _get_neighbor_tier(chunk: ChunkData, lx: int, ly: int) -> int:
	var size = ChunkData.SIZE
	if lx >= 0 and lx < size and ly >= 0 and ly < size:
		return _elevation_tier(chunk.elevation[chunk.idx(lx, ly)])
	# Cross-chunk lookup
	var cx = chunk.chunk_x
	var cy = chunk.chunk_y
	var nx = lx
	var ny = ly
	if nx < 0:
		cx -= 1
		nx += size
	elif nx >= size:
		cx += 1
		nx -= size
	if ny < 0:
		cy -= 1
		ny += size
	elif ny >= size:
		cy += 1
		ny -= size
	var neighbor = _chunks.get(Vector2i(cx, cy))
	if neighbor == null:
		return 0
	return _elevation_tier(neighbor.elevation[neighbor.idx(nx, ny)])


# --- Shading ---

func _render_shading(chunk: ChunkData, ox: int, oy: int) -> void:
	if _shading_source_id < 0:
		return
	var size = ChunkData.SIZE
	for y in range(size):
		for x in range(size):
			if chunk.is_ocean(x, y):
				continue
			var i = chunk.idx(x, y)
			var elev = chunk.elevation[i]
			var slope_val = chunk.slope[i]
			var cell = Vector2i(ox + x, oy + y)

			# Directional hillshade: NW light source
			var elev_se = elev
			if x + 1 < size and y + 1 < size:
				elev_se = chunk.elevation[chunk.idx(x + 1, y + 1)]
			var hill_factor = (elev - elev_se) * 8.0

			# High peaks get highlights
			if elev > 0.72 and slope_val < 0.03:
				_shading_layer.set_cell(cell, _shading_source_id + 4, Vector2i(0, 0))
				continue

			var shade = hill_factor + slope_val * 2.0
			if elev < 0.38:
				shade += (0.38 - elev) * 1.5

			if shade > 0.15:
				var level = clampi(int(shade * 6.0), 0, 3)
				_shading_layer.set_cell(cell, _shading_source_id + level, Vector2i(0, 0))
