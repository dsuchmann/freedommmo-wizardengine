class_name TileRenderer
extends RefCounted

const GRAIN_COLORS: Dictionary = {
	GrainTypes.Physical.BEDROCK: Color(0.2, 0.2, 0.2),
	GrainTypes.Physical.STONE: Color(0.5, 0.5, 0.5),
	GrainTypes.Physical.GRANITE: Color(0.6, 0.55, 0.5),
	GrainTypes.Physical.MARBLE: Color(0.9, 0.88, 0.85),
	GrainTypes.Physical.OBSIDIAN: Color(0.1, 0.08, 0.12),
	GrainTypes.Physical.IRON: Color(0.45, 0.4, 0.35),
	GrainTypes.Physical.COPPER: Color(0.7, 0.45, 0.2),
	GrainTypes.Physical.GOLD: Color(0.85, 0.75, 0.2),
	GrainTypes.Physical.SILVER: Color(0.75, 0.75, 0.8),
	GrainTypes.Physical.MITHRIL: Color(0.6, 0.7, 0.9),
	GrainTypes.Physical.ADAMANTINE: Color(0.3, 0.35, 0.4),
	GrainTypes.Physical.SAND: Color(0.9, 0.82, 0.55),
	GrainTypes.Physical.GRAVEL: Color(0.55, 0.5, 0.45),
	GrainTypes.Physical.CLAY: Color(0.65, 0.45, 0.3),
	GrainTypes.Physical.SOIL: Color(0.4, 0.3, 0.2),
	GrainTypes.Physical.MUD: Color(0.35, 0.25, 0.15),
	GrainTypes.Physical.PEAT: Color(0.25, 0.2, 0.1),
	GrainTypes.Physical.WATER: Color(0.15, 0.35, 0.65),
	GrainTypes.Physical.ICE: Color(0.75, 0.88, 0.95),
	GrainTypes.Physical.SNOW: Color(0.92, 0.93, 0.96),
	GrainTypes.Physical.LAVA: Color(0.95, 0.25, 0.05),
	GrainTypes.Physical.GLASS: Color(0.8, 0.85, 0.9),
	GrainTypes.Physical.CRYSTAL: Color(0.7, 0.5, 0.9),
	GrainTypes.Physical.WOOD: Color(0.55, 0.35, 0.15),
	GrainTypes.Physical.BARK: Color(0.4, 0.25, 0.1),
	GrainTypes.Physical.LEAF: Color(0.15, 0.5, 0.1),
	GrainTypes.Physical.GRASS: Color(0.3, 0.7, 0.2),
	GrainTypes.Physical.MOSS: Color(0.12, 0.4, 0.12),
	GrainTypes.Physical.VINE: Color(0.2, 0.5, 0.1),
	GrainTypes.Physical.FLOWER: Color(0.8, 0.3, 0.5),
	GrainTypes.Physical.MUSHROOM: Color(0.6, 0.45, 0.35),
	GrainTypes.Physical.BONE: Color(0.85, 0.82, 0.75),
	GrainTypes.Physical.CORAL: Color(0.8, 0.4, 0.35),
	GrainTypes.Physical.ASH: Color(0.4, 0.4, 0.4),
	GrainTypes.Physical.CHARCOAL: Color(0.15, 0.12, 0.1),
	GrainTypes.Physical.COAL: Color(0.1, 0.1, 0.1),
	GrainTypes.Physical.OIL: Color(0.15, 0.1, 0.05),
}

var _pixellab_cache: Dictionary = {}
var _fallback_mode: bool = true
var _biome_tilesets: Dictionary = {}

func _init() -> void:
	_load_biome_tilesets()

func _load_biome_tilesets() -> void:
	# Biome → clean tileset textures (center-extracted, no Wang transition edges)
	var tileset_map := {
		"grassland": ["res://assets/tilesets/pure/grass_clean.png"],
		"forest": ["res://assets/tilesets/pure/forest_clean.png"],
		"mushroom_forest": ["res://assets/tilesets/pure/forest_clean.png"],
		"desert": ["res://assets/tilesets/pure/desert_clean.png"],
		"beach": ["res://assets/tilesets/pure/desert_clean.png"],
		"ocean": ["res://assets/tilesets/pure/ocean_clean.png"],
		"deep_ocean": ["res://assets/tilesets/pure/ocean_clean.png"],
		"shallow_water": ["res://assets/tilesets/pure/ocean_clean.png"],
		"hills": ["res://assets/tilesets/pure/grass_clean.png"],
		"mountains": ["res://assets/tilesets/pure/mountain_clean.png"],
		"tundra": ["res://assets/tilesets/pure/snow_clean.png"],
		"frozen_lake": ["res://assets/tilesets/pure/snow_clean.png"],
		"swamp": ["res://assets/tilesets/pure/swamp_clean.png"],
		"volcanic": ["res://assets/tilesets/pure/mountain_clean.png"],
	}
	for biome in tileset_map:
		var paths = tileset_map[biome]
		for path in paths:
			if ResourceLoader.exists(path):
				var tex = load(path)
				if tex is Texture2D:
					_biome_tilesets[biome] = tex.get_image()
					break
			elif FileAccess.file_exists(path):
				var img = Image.load_from_file(path)
				if img:
					_biome_tilesets[biome] = img
					break
	if not _biome_tilesets.is_empty():
		print("TileRenderer: loaded %d biome tilesets" % _biome_tilesets.size())

func render_stack(stack: GrainStack) -> Color:
	if stack == null or stack.top() == null:
		return Color.MAGENTA
	var visible = stack.get_visible_grains()
	if visible.size() == 1:
		return _grain_color(visible[0])
	var blended := Color.BLACK
	var total_weight := 0.0
	for grain in visible:
		var weight = grain.properties.opacity * grain.quantity
		var color = _grain_color(grain)
		color = _modify_by_state(color, grain)
		blended += color * weight
		total_weight += weight
	if total_weight > 0.0:
		blended /= total_weight
	return blended.clamp()

func render_cell_to_image(cell: WorldCell, tile_size: int = 1) -> Image:
	var size := WorldCell.CELL_SIZE * tile_size
	var img := Image.create(size, size, false, Image.FORMAT_RGB8)

	# Tileset sampling disabled — creates visible repeating grid patterns.
	# Grain color rendering with noise produces seamless, unique terrain.

	# Grain color rendering with height shading and sub-tile texture
	for y in range(WorldCell.CELL_SIZE):
		for x in range(WorldCell.CELL_SIZE):
			var stack = cell.get_grain_stack(x, y)
			var base_color := render_stack(stack)
			var world_x = x + cell.cell_x * WorldCell.CELL_SIZE
			var world_y = y + cell.cell_y * WorldCell.CELL_SIZE
			base_color = _apply_height_shading(base_color, cell, x, y)

			# Sparse terrain details (per world tile, not per pixel)
			var detail_hash = ((world_x * 1103515245) ^ (world_y * 12345)) & 0xFFFF
			var detail_color = Color(-1, -1, -1)  # sentinel: no detail
			if stack and stack.top():
				var grain_type = stack.top().grain_type
				if grain_type == GrainTypes.Physical.GRASS:
					if detail_hash % 50 == 0:
						detail_color = base_color.darkened(0.2)  # Dark grass tuft
					elif detail_hash % 120 == 1:
						var flower_colors = [Color(0.9, 0.3, 0.4), Color(0.9, 0.8, 0.2), Color(0.6, 0.3, 0.8)]
						detail_color = flower_colors[detail_hash % flower_colors.size()]
				elif grain_type == GrainTypes.Physical.WATER:
					if detail_hash % 60 == 0:
						detail_color = base_color.lightened(0.2)  # Water sparkle

			# Render tile_size x tile_size block with rich sub-pixel texture
			for ty in range(tile_size):
				for tx in range(tile_size):
					var color = base_color
					# Multi-octave noise for natural texture within each tile
					var sub_hash = ((world_x * 2654435761 + tx * 73856093) ^ (world_y * 2246822519 + ty * 19349663)) & 0xFFFF
					var noise1 = ((sub_hash & 0xFF) / 255.0 - 0.5) * 0.15  # Large scale ±7.5%
					var noise2 = (((sub_hash >> 8) & 0xFF) / 255.0 - 0.5) * 0.08  # Fine detail ±4%
					var combined = noise1 + noise2
					color.r = clampf(color.r + combined, 0.0, 1.0)
					color.g = clampf(color.g + combined * 0.85, 0.0, 1.0)
					color.b = clampf(color.b + combined * 0.65, 0.0, 1.0)
					# Apply detail on a single sub-pixel (not all 4x4)
					if detail_color.r >= 0 and tx == 1 and ty == 1:
						color = detail_color
					img.set_pixel(x * tile_size + tx, y * tile_size + ty, color)
	return img

func has_pixellab_asset(grain_type: int) -> bool:
	return _pixellab_cache.has(grain_type)

func set_pixellab_asset(grain_type: int, texture: Texture2D) -> void:
	_pixellab_cache[grain_type] = texture
	_fallback_mode = false

func _apply_height_shading(color: Color, cell: WorldCell, x: int, y: int) -> Color:
	if cell.heights.size() == 0:
		return color
	var h = cell.get_height(x, y)
	# Get neighboring heights for edge detection
	var h_right = cell.get_height(mini(x + 1, WorldCell.CELL_SIZE - 1), y)
	var h_below = cell.get_height(x, mini(y + 1, WorldCell.CELL_SIZE - 1))
	var h_left = cell.get_height(maxi(x - 1, 0), y)
	var h_above = cell.get_height(x, maxi(y - 1, 0))

	# Elevation brightness: higher = brighter
	var brightness = 0.7 + h * 0.6  # range 0.7-1.3

	# Edge shadows: darken where height drops to the right/below (light from top-left)
	var edge_shadow := 0.0
	if h - h_right > 0.03:
		edge_shadow += (h - h_right) * 3.0
	if h - h_below > 0.03:
		edge_shadow += (h - h_below) * 3.0

	# Edge highlights: lighten where height rises from left/above
	var edge_highlight := 0.0
	if h - h_left > 0.03:
		edge_highlight += (h - h_left) * 2.0
	if h - h_above > 0.03:
		edge_highlight += (h - h_above) * 2.0

	brightness += edge_highlight * 0.3
	brightness -= edge_shadow * 0.4
	brightness = clampf(brightness, 0.3, 1.5)

	color.r *= brightness
	color.g *= brightness
	color.b *= brightness
	return color.clamp()

var _render_frame: int = 0

func advance_frame() -> void:
	_render_frame += 1

func _grain_color(grain: Grain) -> Color:
	return GRAIN_COLORS.get(grain.grain_type, Color.MAGENTA)

func _modify_by_state(color: Color, grain: Grain) -> Color:
	if grain.properties.moisture > 0.5:
		color = color.darkened(grain.properties.moisture * 0.3)
	if grain.properties.temperature < 0.0:
		color = color.lerp(Color(0.7, 0.85, 0.95), minf(absf(grain.properties.temperature) / 50.0, 0.5))
	if grain.properties.temperature > 200.0:
		color = color.lerp(Color(0.9, 0.3, 0.05), minf(grain.properties.temperature / 1500.0, 0.7))
	# Subtle per-grain color variation to break up uniformity
	var variation = (grain.properties.purity - 0.5) * 0.1
	color.r += variation
	color.g += variation * 0.8
	color.b += variation * 0.6
	return color.clamp()
