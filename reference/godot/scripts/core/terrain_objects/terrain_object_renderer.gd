class_name TerrainObjectRenderer
extends RefCounted

## Renders terrain objects as Sprite2D nodes in the scene.
## Each object gets a shadow that moves with the sun angle.
## Thread-safe data prep happens in PlacementEngine; this is main-thread only.

var _parent: Node2D
var _tile_size: int = 32
var _sprite_cache: Dictionary = {}  # "object_id/v{N}" -> Texture2D
var _variant_counts: Dictionary = {}  # "object_id" -> int (max variant number)
var _chunk_sprites: Dictionary = {}  # Vector2i -> Array[Sprite2D]
var _shadow_data: Dictionary = {}  # Vector2i -> Array[{shadow, base_pos, height}]
var _shadow_textures: Dictionary = {}  # "WxH" -> Texture2D (cached oval shadows)
var _shadow_material: ShaderMaterial = null
var _tex_base_row: Dictionary = {}  # texture RID -> float (lowest opaque pixel row ratio)

const SPRITE_BASE = "res://assets/catalog/terrain_objects"
const ELEV_LEVELS: int = 8
const PPU: float = 512.0  # pixels_per_unit — must match TileMapLayer tile scale

# Ground tint colors for layer 1 rendering. Fallback sprites get tinted toward
# these earth tones so they look like actual ground rather than colorful blobs.
const GROUND_TINT: Dictionary = {
	# Forest/taiga — dark brown earth
	"pine_needle_bed": Color(0.45, 0.35, 0.22),
	"bark_debris": Color(0.40, 0.30, 0.20),
	"dark_earth": Color(0.35, 0.28, 0.18),
	"forest_floor": Color(0.38, 0.32, 0.20),
	"root_soil": Color(0.40, 0.30, 0.18),
	"leaf_litter": Color(0.50, 0.38, 0.22),
	"rich_dark_soil": Color(0.30, 0.25, 0.15),
	"wet_soil": Color(0.32, 0.28, 0.18),
	# Grassland — warm brown
	"dirt_patch": Color(0.55, 0.42, 0.28),
	"dry_soil": Color(0.58, 0.45, 0.30),
	"packed_earth": Color(0.50, 0.40, 0.28),
	# Snow/ice — blue-white
	"packed_snow": Color(0.80, 0.85, 0.92),
	"frozen_soil": Color(0.55, 0.58, 0.65),
	"frozen_gravel": Color(0.60, 0.62, 0.68),
	"permafrost": Color(0.52, 0.55, 0.62),
	# Desert — sandy tan
	"desert_sand": Color(0.72, 0.62, 0.42),
	"sun_bleached_soil": Color(0.68, 0.58, 0.38),
	"cracked_earth": Color(0.60, 0.48, 0.32),
	# Mountain — grey stone
	"mountain_soil": Color(0.48, 0.46, 0.42),
	"gravel_patch": Color(0.52, 0.50, 0.46),
	# Volcanic — dark charcoal
	"ash_layer": Color(0.30, 0.28, 0.26),
	"charred_earth": Color(0.25, 0.22, 0.20),
	"cooled_lava": Color(0.28, 0.24, 0.22),
	# Mystic — purple tint
	"ethereal_soil": Color(0.45, 0.35, 0.55),
	"glowing_earth": Color(0.40, 0.35, 0.50),
	# Swamp/beach
	"wet_sand": Color(0.50, 0.45, 0.35),
	"mud_patch": Color(0.38, 0.32, 0.22),
}
const GROUND_TINT_DEFAULT: Color = Color(0.48, 0.40, 0.28)

# Category-based display scale — controls how big objects appear relative to tile grid.
# Player is ~1 tile wide, ~1.5 tiles tall.
# Ground cover (grass, moss, leaves) should be tile-scale — they PAINT the surface.
# Trees use their defined multi-tile size. Small accents (pebbles) are tiny.
const CATEGORY_DISPLAY_SCALE: Dictionary = {
	# Ground cover — tile-scale, must visually cover base tiles
	"vegetation/grass": 0.80,
	"vegetation/moss": 0.70,
	"ground_cover": 0.75,
	# Small plants
	"vegetation/flower": 0.35,
	"vegetation/fern": 0.45,
	# Medium plants
	"vegetation/bush": 0.55,
	# Trees — at defined size (size [2,3] = large)
	"vegetation/tree": 1.0,
	# Minerals
	"mineral/rock": 0.45,
	"mineral/crystal": 0.35,
	# Water features
	"water_feature": 0.50,
	# Natural structures
	"structure_natural": 0.55,
}

# Sprite fallback: map missing object IDs to visually similar existing sprites.
# Removes "holes" where layer 1-3 objects have no art yet.
const SPRITE_FALLBACK: Dictionary = {
	# Layer 1 ground textures
	"dirt_patch": "cracked_earth",
	"dry_soil": "cracked_earth",
	"dark_earth": "forest_floor",
	"frozen_soil": "ice_patch",
	"packed_earth": "gravel_patch",
	"mountain_soil": "mountain_gravel",
	"root_soil": "forest_floor",
	"leaf_litter": "autumn_leaves",
	"bark_debris": "forest_floor",
	"ash_layer": "cracked_earth",
	"charred_earth": "cracked_earth",
	"cooled_lava": "volcanic_rock",
	"permafrost": "ice_patch",
	"frozen_gravel": "gravel_patch",
	"sun_bleached_soil": "desert_sand",
	"wet_soil": "forest_floor",
	"rich_dark_soil": "forest_floor",
	"ethereal_soil": "mystic_ground",
	"glowing_earth": "mystic_ground",
	"wet_sand": "beach_sand",
	# Layer 2 small debris
	"small_stone": "pebble",
	"loose_stone": "pebble",
	"slate_chip": "pebble",
	"twig": "dry_leaf",
	"bark_chip": "dry_leaf",
	"pine_cone": "pebble",
	"acorn": "pebble",
	"bone_fragment": "pebble",
	"dried_seed": "pebble",
	"seed_pod": "pebble",
	"ice_crystal": "pebble",
	"frost_crystal": "pebble",
	"ice_shard": "pebble",
	"frozen_pebble": "pebble",
	"frozen_leaf": "dry_leaf",
	"shell_fragment": "pebble",
	"seaweed_bit": "dry_leaf",
	"sulfur_crystal": "pebble",
	"crystal_fragment": "pebble",
	"glowing_particle": "pebble",
	"decomposing_leaves": "autumn_leaves",
	"fallen_fruit": "pebble",
	"large_leaf": "dry_leaf",
	"vine_debris": "dry_leaf",
	"swamp_debris": "wet_leaves",
	"dried_plant": "dry_grass",
	# Layer 3-4 flora / accent
	"charred_grass": "dry_grass",
	"clover_patch": "ground_moss",
	"lichen": "ground_moss",
	"tropical_grass": "tall_grass",
	"ember_patch": "lava_rock",
	"sulfur_vent": "lava_rock",
	"dead_twig": "dry_grass",
	# Layer 4-5 large objects
	"dead_shrub": "dry_bush",
	"frozen_boulder": "granite_boulder",
	"ice_formation": "granite_boulder",
	# Layer 5 trees — biome JSON names -> asset catalog names
	"oak_tree": "deciduous",
	"birch_tree": "deciduous",
	"maple_tree": "deciduous",
	"elm_tree": "deciduous",
	"pine_tree": "conifer",
	"spruce_tree": "conifer",
	"fir_tree": "conifer",
	"cedar_tree": "conifer",
	"palm_tree": "tropical",
	"jungle_tree": "tropical",
	"willow_tree": "willow",
	"dead_tree": "dead",
	"mossy_boulder": "granite_boulder",
	"fallen_log": "dead",
}

# Object-specific overrides for when category is too broad
const OBJECT_DISPLAY_SCALE: Dictionary = {
	# Grass — must cover base tile. Short = low profile, tall = waist height.
	"short_grass": 0.65,
	"tall_grass": 0.90,
	"meadow_grass": 0.80,
	"dry_grass": 0.70,
	"frozen_grass": 0.65,
	"sea_grass": 0.70,
	# Ground cover specifics
	"autumn_leaves": 0.70,
	"fresh_snow": 0.75,
	"cracked_earth": 0.75,
	"ice_patch": 0.75,
	# Tiny accents
	"pebble": 0.15,
	"stone_dust": 0.12,
	"gravel_patch": 0.18,
	# Small ground details
	"daisy": 0.25,
	"dandelion": 0.25,
	"poppy": 0.28,
	"wildflower": 0.30,
	"toadstool": 0.25,
	"morel": 0.22,
	"ant_mound": 0.22,
	"succulent": 0.25,
	"bird_nest": 0.25,
	"spider_web": 0.30,
	"shell": 0.18,
	"clam_shell": 0.18,
	"conch_shell": 0.20,
	# Medium objects
	"flowering_bush": 0.55,
	"berry_bush": 0.50,
	"fallen_log": 0.60,
	"hollow_log": 0.60,
	"mossy_log": 0.60,
	"driftwood": 0.45,
	"bone_pile": 0.30,
	# Large minerals
	"granite_boulder": 0.65,
	"mossy_boulder": 0.60,
	"flat_rock": 0.30,
	"volcanic_rock": 0.45,
	"sandstone": 0.45,
}

func _get_category_scale(category: String, object_id: String = "") -> float:
	# Object-specific override first
	if object_id != "" and OBJECT_DISPLAY_SCALE.has(object_id):
		return OBJECT_DISPLAY_SCALE[object_id]
	# Then category prefix match (most specific wins)
	var best_match = ""
	var best_scale = 0.4  # default for unknown categories
	for prefix in CATEGORY_DISPLAY_SCALE:
		if category.begins_with(prefix) and prefix.length() > best_match.length():
			best_match = prefix
			best_scale = CATEGORY_DISPLAY_SCALE[prefix]
	return best_scale


func setup(parent: Node2D, tile_size: int = 32) -> void:
	_parent = parent
	_tile_size = tile_size
	_scan_sprites()
	# Load shadow diffusion shader
	var shader = ResourceLoader.load("res://assets/shaders/shadow_diffuse.gdshader") as Shader
	if shader:
		_shadow_material = ShaderMaterial.new()
		_shadow_material.shader = shader
		_shadow_material.set_shader_parameter("fade_power", 1.5)


func _scan_sprites() -> void:
	_scan_dir(SPRITE_BASE)
	print("[TerrainObjectRenderer] Cached %d sprite variants" % _sprite_cache.size())


func _scan_dir(path: String) -> void:
	var dir = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry = dir.get_next()
	while entry != "":
		var full = path + "/" + entry
		if dir.current_is_dir() and not entry.begins_with("."):
			if entry == "variants":
				_scan_variants(path, full)
			else:
				_scan_dir(full)
		entry = dir.get_next()
	dir.list_dir_end()


func _scan_variants(object_dir: String, variants_dir: String) -> void:
	var object_id = object_dir.get_file()
	# Strip _batch suffix so batch-generated sprites map to base object_id
	if object_id.ends_with("_batch"):
		object_id = object_id.substr(0, object_id.length() - 6)
	var dir = DirAccess.open(variants_dir)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry = dir.get_next()
	while entry != "":
		if dir.current_is_dir() and entry.begins_with("v"):
			var png_path = variants_dir + "/" + entry + "/base.png"
			if FileAccess.file_exists(png_path):
				var key = object_id + "/" + entry
				_sprite_cache[key] = png_path
				# Track max variant number per object_id
				var vnum = entry.substr(1).to_int()  # "v3" -> 3
				var cur_max = _variant_counts.get(object_id, 0)
				if vnum > cur_max:
					_variant_counts[object_id] = vnum
		entry = dir.get_next()
	dir.list_dir_end()


func get_texture(object_id: String, variant: int) -> Texture2D:
	# Wrap variant to available range — prevents falling back to v1 for everything
	var max_v = _variant_counts.get(object_id, 0)
	if max_v > 0:
		variant = ((variant - 1) % max_v) + 1
	var key = object_id + "/v" + str(variant)
	var cached = _sprite_cache.get(key)
	if cached == null:
		key = object_id + "/v1"
		cached = _sprite_cache.get(key)
	if cached == null:
		# Fallback: try a visually similar sprite
		var fallback_id = SPRITE_FALLBACK.get(object_id, "")
		if fallback_id != "":
			key = fallback_id + "/v" + str(variant)
			cached = _sprite_cache.get(key)
			if cached == null:
				key = fallback_id + "/v1"
				cached = _sprite_cache.get(key)
	if cached == null:
		return null
	if cached is String:
		# Try ResourceLoader first (imported assets), fall back to raw Image load
		var tex = ResourceLoader.load(cached) as Texture2D
		if tex == null:
			# Load PNG directly without import system
			var abs_path = ProjectSettings.globalize_path(cached)
			var img = Image.new()
			if img.load(abs_path) == OK:
				tex = ImageTexture.create_from_image(img)
		if tex:
			_sprite_cache[key] = tex
			return tex
		return null
	return cached as Texture2D


func _get_shadow_texture(w: int, h: int) -> Texture2D:
	var key = "%d_%d" % [w, h]
	if _shadow_textures.has(key):
		return _shadow_textures[key]
	# White oval on transparent bg — modulate to dark on the sprite
	var img = Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in range(h):
		for x in range(w):
			var cx = float(w) * 0.5
			var cy = float(h) * 0.5
			var dx = (float(x) - cx) / cx
			var dy = (float(y) - cy) / cy
			var dist = dx * dx + dy * dy
			if dist < 1.0:
				var alpha = (1.0 - dist)
				img.set_pixel(x, y, Color(1.0, 1.0, 1.0, alpha))
			else:
				img.set_pixel(x, y, Color(0.0, 0.0, 0.0, 0.0))
	var tex = ImageTexture.create_from_image(img)
	_shadow_textures[key] = tex
	return tex


func _get_silhouette_shadow(source_tex: Texture2D) -> Texture2D:
	## Create a shadow texture from the sprite — just reuse the same texture.
	## The modulate Color(0,0,0,0.3) makes it a dark silhouette.
	## No per-pixel processing needed — the alpha channel is preserved.
	return source_tex


func _get_base_row(tex: Texture2D) -> float:
	## Find the lowest row with opaque pixels (where the object touches ground).
	## Returns a ratio 0.0-1.0 of tex_h. Cached per texture.
	var key = tex.get_rid().get_id()
	if _tex_base_row.has(key):
		return _tex_base_row[key]
	var img = tex.get_image()
	if img == null:
		_tex_base_row[key] = 1.0
		return 1.0
	var h = img.get_height()
	var w = img.get_width()
	# Scan from bottom upward to find first row with opaque pixels
	for y in range(h - 1, -1, -1):
		for x in range(w):
			if img.get_pixel(x, y).a > 0.1:
				var ratio = float(y + 1) / float(h)
				_tex_base_row[key] = ratio
				return ratio
	_tex_base_row[key] = 1.0
	return 1.0


var _player_chunk: Vector2i = Vector2i.ZERO
const GROUND_COVER_RADIUS: int = 1  # Only render ground cover within 1 chunk of player

# Debug: control which layers render. Set to 5 for all layers.
var max_render_layer: int = 1  # FOCUS: layer 1 only until it looks right
# Layer 1 re-enabled — ground textures with overlap/jitter per spec.
var skip_layer_1: bool = false

func set_player_chunk(cx: int, cy: int) -> void:
	_player_chunk = Vector2i(cx, cy)

func render_chunk_objects(chunk_x: int, chunk_y: int, instances: Array, chunk_data = null) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	clear_chunk(chunk_x, chunk_y)

	# Distance-based LOD: aggressively cull ground layers in non-center chunks.
	# Center chunk (dist 0): all layers rendered
	# Adjacent (dist 1): skip layer 1 (ground textures — base tile visible anyway)
	# Distant (dist 2+): only large objects (layer 4+)
	var chunk_dist = maxi(absi(chunk_x - _player_chunk.x), absi(chunk_y - _player_chunk.y))

	var sprites: Array = []
	var shadows: Array = []
	var rendered = 0
	var skipped = 0

	for inst in instances:
		# Layer filter
		if inst.layer_num > max_render_layer:
			skipped += 1
			continue
		if skip_layer_1 and inst.layer_num == 1:
			skipped += 1
			continue
		# LOD: layer 1 everywhere (it IS the floor). Layer 2-3 only nearby.
		if inst.layer_num >= 2 and inst.layer_num <= 3 and chunk_dist > 1:
			skipped += 1
			continue
		# LOD: layer-based culling by distance (layer 2-3 only in center + adjacent)
		if chunk_dist >= 2 and inst.layer_num >= 2 and inst.layer_num < 4:
			skipped += 1
			continue
		var tex = get_texture(inst.object_id, inst.variant)
		if tex == null:
			skipped += 1
			continue
		rendered += 1

		# Position
		var jitter_rng = RandomNumberGenerator.new()
		jitter_rng.seed = inst.instance_seed ^ 0xDEAD
		# Layer 1: single sprite per tile, centered, fills the tile.
		# z_index set very low so higher elevation terrain renders on top.
		if inst.layer_num == 1:
			var tile_px = float(inst.position.x * _tile_size)
			var tile_py = float(inst.position.y * _tile_size)
			if chunk_data != null:
				var local_x = clampi(inst.position.x - chunk_x * ChunkData.SIZE, 0, ChunkData.SIZE - 1)
				var local_y = clampi(inst.position.y - chunk_y * ChunkData.SIZE, 0, ChunkData.SIZE - 1)
				var elev = chunk_data.elevation[chunk_data.idx(local_x, local_y)]
				var quantized = roundf(elev * ELEV_LEVELS) / float(ELEV_LEVELS)
				tile_py -= quantized * PPU
			# Scale sprite to slightly overfill tile (1.05x) to eliminate grid seams
			var tex_w_l1 = float(tex.get_width())
			var tex_h_l1 = float(tex.get_height())
			var fill_sx = float(_tile_size) * 1.05 / tex_w_l1
			var fill_sy = float(_tile_size) * 1.05 / tex_h_l1
			# Slight negative offset to center the 1.05x overfill
			var offset_x = -float(_tile_size) * 0.025
			var offset_y = -float(_tile_size) * 0.025
			var l1_sprite = Sprite2D.new()
			l1_sprite.texture = tex
			l1_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			l1_sprite.centered = false
			l1_sprite.scale = Vector2(fill_sx, fill_sy)
			l1_sprite.position = Vector2(tile_px + offset_x, tile_py + offset_y)
			l1_sprite.modulate = Color(1.0, 1.0, 1.0, 0.90)
			# Z: below higher elevation terrain
			var elev_z_l1 = 0
			if chunk_data != null:
				var lx2 = clampi(inst.position.x - chunk_x * ChunkData.SIZE, 0, ChunkData.SIZE - 1)
				var ly2 = clampi(inst.position.y - chunk_y * ChunkData.SIZE, 0, ChunkData.SIZE - 1)
				elev_z_l1 = int(chunk_data.elevation[chunk_data.idx(lx2, ly2)] * 8.0) * 200
			l1_sprite.z_index = clampi(elev_z_l1 - 180, 0, 4000)
			l1_sprite.z_as_relative = false
			_parent.add_child(l1_sprite)
			sprites.append(l1_sprite)
			shadows.append({})
			rendered += 1
			continue

		var jitter_amt = 0.3 if inst.layer_num == 2 else 0.4
		var jitter_x = jitter_rng.randf_range(-jitter_amt, jitter_amt) * _tile_size
		var jitter_y = jitter_rng.randf_range(-jitter_amt, jitter_amt) * _tile_size
		var base_px = float(inst.position.x * _tile_size) + jitter_x
		var base_py = float(inst.position.y * _tile_size) + jitter_y

		# Apply elevation offset — objects must sit ON the terrain surface
		if chunk_data != null:
			var local_x = inst.position.x - chunk_x * ChunkData.SIZE
			var local_y = inst.position.y - chunk_y * ChunkData.SIZE
			local_x = clampi(local_x, 0, ChunkData.SIZE - 1)
			local_y = clampi(local_y, 0, ChunkData.SIZE - 1)
			var elev = chunk_data.elevation[chunk_data.idx(local_x, local_y)]
			var quantized = roundf(elev * ELEV_LEVELS) / float(ELEV_LEVELS)
			base_py -= quantized * PPU

		# Scale: ALL layered objects use layer_scale from JSON scale_range.
		var tex_w = tex.get_width()
		var tex_h = tex.get_height()
		var display_scale = 0.4
		if inst.layer_num > 0:
			display_scale = inst.layer_scale
		else:
			display_scale = _get_category_scale(inst.category, inst.object_id)
		var target_w = float(inst.size.x * _tile_size) * display_scale
		var target_h = float(inst.size.y * _tile_size) * display_scale
		var sx = target_w / float(tex_w)
		var sy = target_h / float(tex_h)

		# Anchor offset
		var anchor_x = base_px
		var anchor_y = base_py
		if inst.anchor == "bottom_center":
			anchor_x -= target_w * 0.5
			anchor_y -= target_h - float(_tile_size) * display_scale
		elif inst.anchor == "center":
			anchor_x -= target_w * 0.5
			anchor_y -= target_h * 0.5

		# Object sprite first — shadow will be its child
		var sprite = Sprite2D.new()
		sprite.texture = tex
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.centered = false
		# Random horizontal flip for visual variety (deterministic from seed)
		var flip_x = 1.0
		if inst.instance_seed % 3 == 0:
			flip_x = -1.0
			anchor_x += target_w  # Compensate position for flip
		# Layer 1: uniform scale (no individual variance) for consistent overlap
		var final_ind_scale = 1.0 if inst.layer_num == 1 else inst.ind_scale
		sprite.scale = Vector2(sx * flip_x, sy) * final_ind_scale
		sprite.position = Vector2(anchor_x, anchor_y)
		# Color shift + layer opacity
		var base_color = Color(1.0, 1.0, 1.0, 1.0)
		if abs(inst.ind_color_shift) > 0.01:
			var shift = inst.ind_color_shift
			base_color = Color(1.0 + shift, 1.0, 1.0 - shift, 1.0)
		# Layer 1: earth-tone tinted ground texture — covers base tile.
		# Uses GROUND_TINT to replace sprite colors with biome-appropriate earth tones.
		# Layer 2: debris — small, near-opaque.
		# Layer 3+: full opacity (flora, trees).
		# Layer 1: ground textures at 70% — lets base tile peek through to
		# unify color transitions between different ground sprites.
		# Layer 2: debris — slightly transparent.
		if inst.layer_num == 1:
			base_color.a = 0.90
		elif inst.layer_num == 2:
			base_color.a = 0.85
		sprite.modulate = base_color

		# Z-sort: elevation shelf (coarse) → layer (medium) → Y-position (fine)
		# Objects on higher elevation render above objects on lower elevation.
		var elev_z = 0
		if chunk_data != null:
			var local_x = inst.position.x - chunk_x * ChunkData.SIZE
			var local_y = inst.position.y - chunk_y * ChunkData.SIZE
			local_x = clampi(local_x, 0, ChunkData.SIZE - 1)
			local_y = clampi(local_y, 0, ChunkData.SIZE - 1)
			var elev = chunk_data.elevation[chunk_data.idx(local_x, local_y)]
			elev_z = int(elev * 8.0) * 200  # 8 elevation levels × 200 z-units each
		var visual_y = int(anchor_y / float(_tile_size))
		var layer_z = inst.layer_z_offset * 40  # Tighter layer separation within elevation
		# Layer 1 ground textures render BEHIND terrain of higher elevations.
		# Subtract 150 from elev_z so they sit below the next elevation shelf's terrain.
		if inst.layer_num == 1:
			sprite.z_index = clampi(elev_z - 150 + visual_y, 0, 4000)
		else:
			sprite.z_index = clampi(elev_z + layer_z + visual_y + 500, 0, 4000)
		sprite.z_as_relative = false

		# Shadow — skip for small ground cover (flat on ground, no visible shadow)
		var needs_shadow = inst.size.x >= 2 or inst.size.y >= 2
		if not needs_shadow:
			_parent.add_child(sprite)
			sprites.append(sprite)
			shadows.append({})
			continue

		# Shadow — CHILD of object sprite. Uses SKEW (shear) instead of rotation.
		var shadow_sprite = Sprite2D.new()
		shadow_sprite.texture = tex
		shadow_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		shadow_sprite.self_modulate = Color(0, 0, 0, 0.3)
		shadow_sprite.centered = false
		# Position at actual base of object (accounting for transparent padding)
		var base_ratio = _get_base_row(tex)
		var actual_base_y = float(tex_h) * base_ratio
		shadow_sprite.position = Vector2(0.0, actual_base_y)
		# Offset: move texture UP so its bottom row (the base) sits at position.
		shadow_sprite.offset = Vector2(0.0, -actual_base_y)
		# Initial scale — will be updated by update_shadow_positions
		shadow_sprite.scale = Vector2(1.0, 0.3)
		shadow_sprite.skew = 0.0
		shadow_sprite.z_index = -1
		shadow_sprite.z_as_relative = true
		sprite.add_child(shadow_sprite)

		_parent.add_child(sprite)
		sprites.append(sprite)
		shadows.append({"shadow": shadow_sprite})

	_chunk_sprites[key] = sprites
	_shadow_data[key] = shadows
	if rendered > 0 or skipped > 0:
		print("[ObjectRenderer] chunk(%d,%d): %d rendered, %d skipped (no tex), elev_offset=%s" % [
			chunk_x, chunk_y, rendered, skipped, str(chunk_data != null)])


var _shadow_update_timer: float = 0.0
const SHADOW_UPDATE_INTERVAL: float = 0.25  # Update 4x/sec, not 60x

func update_shadow_positions(sun_angle: float, sun_altitude: float, delta: float = 0.016) -> void:
	## Throttled — shadows move slowly with sun, no need for 60fps updates.
	_shadow_update_timer += delta
	if _shadow_update_timer < SHADOW_UPDATE_INTERVAL:
		return
	_shadow_update_timer = 0.0

	var stretch = clampf(1.0 / maxf(tan(sun_altitude * PI * 0.5), 0.2), 0.8, 2.0)
	var away_x = -cos(sun_angle)
	var away_y = -sin(sun_angle)
	var base_alpha = clampf(0.4 - sun_altitude * 0.1, 0.15, 0.4)

	# Shadow projection via skew (shear). The shadow texture extends UPWARD
	# from the base (offset puts base at bottom). Skew shears the top of the
	# texture horizontally, scale.y controls vertical compression.
	#
	# For a pixel at "height" h above the base:
	#   local_y = -h (texture extends up = negative Y)
	#   displacement_x = h * shadow_dir_x * L
	#   displacement_y = h * shadow_dir_y * L
	#
	# Godot skew: x' = x + y * tan(skew). Since y is negative (upward):
	#   shear_x = -h * tan(skew) → tan(skew) = -shadow_dir_x * L → skew = atan(shadow_dir_x * L)
	# Godot scale.y: y' = y * scale_y = -h * scale_y
	#   We want y' = h * shadow_dir_y * L → scale_y = -shadow_dir_y * L
	#
	var shadow_len = stretch * 0.6  # How far shadow extends (higher = longer)
	var dir_x = -cos(sun_angle)  # Shadow direction (away from sun)
	var dir_y = -sin(sun_angle)
	var shear = atan(dir_x * shadow_len)
	var sy = clampf(-dir_y * shadow_len, -1.5, 1.5)
	# Ensure minimum vertical extent so shadow doesn't vanish
	if absf(sy) < 0.1:
		sy = 0.1 * signf(sy) if sy != 0.0 else 0.1

	for chunk_key in _shadow_data:
		for entry in _shadow_data[chunk_key]:
			var spr = entry.get("shadow")
			if spr == null or not is_instance_valid(spr):
				continue
			spr.rotation = 0.0  # No rotation — skew handles direction
			spr.skew = shear
			spr.scale = Vector2(1.0, sy)
			spr.self_modulate.a = clampf(base_alpha, 0.15, 0.35)


func clear_chunk(chunk_x: int, chunk_y: int) -> void:
	var key = Vector2i(chunk_x, chunk_y)
	if _chunk_sprites.has(key):
		for sprite in _chunk_sprites[key]:
			if sprite != null and is_instance_valid(sprite):
				sprite.queue_free()
		_chunk_sprites.erase(key)
	if _shadow_data.has(key):
		_shadow_data.erase(key)  # Shadows are children of sprites, freed automatically


func clear_all() -> void:
	for key in _chunk_sprites:
		for sprite in _chunk_sprites[key]:
			if sprite != null and is_instance_valid(sprite):
				sprite.queue_free()
	_chunk_sprites.clear()
	_shadow_data.clear()  # Shadows are children of sprites, freed automatically
