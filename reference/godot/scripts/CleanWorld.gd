extends Node2D

## Clean terrain scene with overmap navigation and chunk streaming.
## Press M to open/close world map. Click on map to teleport.
## WASD to walk. Scroll wheel to zoom. Elevation affects speed and camera.

const WORLD_SEED: int = 42
const TILE_SIZE: int = 32
const PLAYER_SPEED: float = 48.0  # ~1.5 tiles/sec at 32px tiles — natural walk speed

var _renderer: TileMapTerrainRenderer
var _chunk_streamer: ChunkStreamer
var _object_renderer: TerrainObjectRenderer
var _player: Node2D
var _player_sprite: Sprite2D
var _player_shadow: Sprite2D
var _player_textures: Dictionary = {}  # "south" -> Texture2D (idle)
var _player_walk_frames: Dictionary = {}  # "south" -> Array[Texture2D] (walk cycle)
var _player_facing: String = "south"
var _player_walk_frame: int = 0
var _player_walk_timer: float = 0.0
var _player_is_moving: bool = false
const WALK_FPS: float = 8.0  # Walk animation speed
var _camera: Camera2D

# Elevation-driven camera/movement
const BASE_ZOOM: float = 4.5
const ZOOM_MIN: float = 3.5    # Zoomed out at peaks — still see player clearly
const ZOOM_MAX: float = 5.5    # Zoomed in at valleys — feels enclosed
const SPEED_UPHILL: float = 0.6    # Was 0.75
const SPEED_DOWNHILL: float = 1.15
var _target_zoom: float = BASE_ZOOM
var _bokeh_material: ShaderMaterial = null

# Day/night lighting
var _day_night: DayNightCycle
var _sun_angle: float = 0.0
var _last_shadow_angle: float = -999.0  # Track for shadow re-rendering
var _canvas_modulate: CanvasModulate
var _moon_spotlight: PointLight2D
var _sun_light: DirectionalLight2D
var _moon_light: DirectionalLight2D
var _lighting_test_mode: bool = false
var _lighting_hud: Label = null
const NORMAL_TIME_SCALE: float = 60.0   # 1 real sec = 1 game minute (24 min per day)
const TEST_TIME_SCALE: float = 2880.0   # Full day in ~30 seconds

# Overmap UI
var _overmap_layer: CanvasLayer = null
var _overmap_rect: TextureRect = null
var _overmap_marker: Control = null
var _overmap_visible: bool = false
var _overmap_generating: bool = false

# Two-phase compilers
var _phase1_compiler: WorldCompiler
var _phase2_compiler: WorldCompiler


func _ready() -> void:
	_setup_compilers()
	_setup_renderer()
	_setup_player()
	_setup_chunk_streamer()
	_setup_overmap_ui()
	_setup_lighting()
	# Find a spawn chunk with terrain variety (grassland/forest, not flat tundra)
	var spawn_chunk = _find_interesting_spawn()
	_chunk_streamer.load_grid_around(spawn_chunk.x, spawn_chunk.y, get_tree())
	var center_px = (spawn_chunk.x * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	var center_py = (spawn_chunk.y * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	_player.position = Vector2(center_px, center_py)
	# Clear blocking tiles at spawn so player isn't stuck
	var spawn_tx = int(_player.position.x / TILE_SIZE)
	var spawn_ty = int(_player.position.y / TILE_SIZE)
	for dy in range(-2, 3):
		for dx in range(-2, 3):
			_chunk_streamer._blocking_tiles.erase(Vector2i(spawn_tx + dx, spawn_ty + dy))


func _setup_compilers() -> void:
	_phase1_compiler = WorldCompiler.new(WORLD_SEED)
	_phase1_compiler.register_layer(ElevationLayer.new())
	_phase1_compiler.register_layer(OceanMaskLayer.new())

	_phase2_compiler = WorldCompiler.new(WORLD_SEED)
	_phase2_compiler.register_layer(ClimateLayer.new())
	_phase2_compiler.register_layer(BiomeLayer.new())
	_phase2_compiler.register_layer(SoilFertilityLayer.new())
	_phase2_compiler.register_layer(VegetationLayer.new())
	_phase2_compiler.register_layer(CoastalLayer.new())


func _setup_renderer() -> void:
	_renderer = TileMapTerrainRenderer.new()
	# Create a parent node for all tile map layers
	var tilemap_parent = Node2D.new()
	tilemap_parent.name = "TileMap"
	add_child(tilemap_parent)
	# Create layers as child TileMapLayer nodes (visible in editor at runtime)
	var layer_defs = [
		["TerrainLayer", -2],
		["CliffLayer", -1],
		["ShadingLayer", -1],
		["WaterLayer", 0],
		["RoadLayer", 2],
		["BuildingLayer", 3],
		["RoofLayer", 8],
	]
	for def in layer_defs:
		var layer = TileMapLayer.new()
		layer.name = def[0]
		layer.z_index = def[1]
		tilemap_parent.add_child(layer)
	_renderer.setup(tilemap_parent, TILE_SIZE)


func _setup_player() -> void:
	_player = Node2D.new()
	_player.z_index = 10
	# Load all 8 directional sprites
	var directions = ["south", "north", "east", "west", "south-east", "south-west", "north-east", "north-west"]
	var base_path = "res://assets/characters/human_male_base/rotations/"
	var fallback_path = "res://assets/characters/hero_knight_v2/rotations/"
	for dir_name in directions:
		var tex = ResourceLoader.load(base_path + dir_name + ".png") as Texture2D
		if tex == null:
			tex = ResourceLoader.load(fallback_path + dir_name + ".png") as Texture2D
		if tex == null:
			# Try loading raw image (unimported assets)
			var abs_path = ProjectSettings.globalize_path(base_path + dir_name + ".png")
			var img = Image.new()
			if img.load(abs_path) == OK:
				tex = ImageTexture.create_from_image(img)
		if tex:
			_player_textures[dir_name] = tex
	# Load walk animation frames per direction
	var walk_path = "res://assets/characters/human_male_base/walk/"
	for dir_name in directions:
		var frames: Array = []
		for frame_idx in range(8):
			var frame_file = walk_path + dir_name + "/" + str(frame_idx) + ".png"
			var abs_path = ProjectSettings.globalize_path(frame_file)
			var img = Image.new()
			if img.load(abs_path) == OK:
				frames.append(ImageTexture.create_from_image(img))
		if frames.size() > 0:
			_player_walk_frames[dir_name] = frames
	print("[PLAYER] Walk frames: %d directions loaded" % _player_walk_frames.size())
	# Character sprite — IDENTICAL setup to terrain_object_renderer.gd
	# centered=false, position=anchor (unscaled), scale applied uniformly.
	# Shadow is child sprite with flip_v, same as every other object.
	_player_sprite = Sprite2D.new()
	_player_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	if _player_textures.has("south"):
		_player_sprite.texture = _player_textures["south"]
		_player_sprite.centered = false
		var tex_h = float(_player_sprite.texture.get_height())
		var tex_w = float(_player_sprite.texture.get_width())
		var target_h = 32.0
		var sx = target_h / tex_w   # Match terrain object: sx = target_w / tex_w
		var sy = target_h / tex_h   # sy = target_h / tex_h
		_player_sprite.scale = Vector2(sx, sy)
		# Position in world coords (NOT pre-scaled). Player origin = feet.
		# Sprite bottom at origin means anchor_y = -target_h.
		_player_sprite.position = Vector2(-target_h * 0.5, -target_h)
		_player.add_child(_player_sprite)
		# Player shadow — uses same SKEW system as object shadows.
		# SIBLING of sprite (child of _player), not child of _player_sprite.
		_player_shadow = Sprite2D.new()
		_player_shadow.texture = _player_sprite.texture
		_player_shadow.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		_player_shadow.self_modulate = Color(0, 0, 0, 0.3)
		_player_shadow.centered = false
		# Same scale as sprite — skew + scale.y will be set per-frame
		_player_shadow.scale = Vector2(sx, sy * 0.3)
		# Position at player's feet (origin = 0,0).
		# Offset: shift texture UP so its base row sits at position.
		# Player sprite position is (-target_h*0.5, -target_h), so feet = (0, 0).
		# Shadow needs same X offset as sprite so it aligns horizontally.
		_player_shadow.position = Vector2(-target_h * 0.5, 0.0)
		_player_shadow.offset = Vector2(0.0, -tex_h)
		_player_shadow.skew = 0.0
		_player_shadow.z_index = 0
		_player_shadow.z_as_relative = false
		_player.add_child(_player_shadow)
		print("[PLAYER] Shadow created: tex=%s scale=%s pos=%s" % [
			str(_player_shadow.texture != null), str(_player_shadow.scale), str(_player_shadow.position)])
		print("[PLAYER] CleanWorld: loaded %d direction sprites" % _player_textures.size())
	else:
		var player_rect = ColorRect.new()
		player_rect.color = Color(0.2, 0.6, 1.0, 0.8)
		player_rect.size = Vector2(16, 16)
		player_rect.position = Vector2(-8, -8)
		_player.add_child(player_rect)
		push_warning("[PLAYER] CleanWorld: no character sprite found")
	var center = ChunkData.SIZE * TILE_SIZE / 2.0
	_player.position = Vector2(center, center)
	add_child(_player)

	_camera = Camera2D.new()
	_camera.zoom = Vector2(4.5, 4.5)
	_player.add_child(_camera)


func _setup_chunk_streamer() -> void:
	_chunk_streamer = ChunkStreamer.new()
	_chunk_streamer.setup(_renderer, _phase1_compiler, _phase2_compiler, WORLD_SEED)
	# Terrain object placement + rendering
	var catalog = ObjectCatalog.new()
	var affinity = BiomeAffinityLoader.new()
	_chunk_streamer._placement_engine = PlacementEngine.new(catalog, affinity, WORLD_SEED)
	# Only layer 5+ objects (trees, bushes, boulders) rendered as Sprite2D nodes
	# Layers 1-4 ground cover are handled by the TileMapLayer terrain renderer
	_object_renderer = TerrainObjectRenderer.new()
	_object_renderer.setup(self, TILE_SIZE)
	_chunk_streamer._object_renderer = _object_renderer


func _setup_overmap_ui() -> void:
	_overmap_layer = CanvasLayer.new()
	_overmap_layer.layer = 20
	_overmap_layer.visible = false
	add_child(_overmap_layer)

	# Dark background
	var bg = ColorRect.new()
	bg.color = Color(0, 0, 0, 0.7)
	bg.anchors_preset = Control.PRESET_FULL_RECT
	bg.mouse_filter = Control.MOUSE_FILTER_STOP
	bg.focus_mode = Control.FOCUS_NONE
	_overmap_layer.add_child(bg)

	# Map image
	_overmap_rect = TextureRect.new()
	_overmap_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_overmap_rect.anchors_preset = Control.PRESET_FULL_RECT
	_overmap_rect.mouse_filter = Control.MOUSE_FILTER_STOP
	_overmap_rect.focus_mode = Control.FOCUS_NONE
	_overmap_layer.add_child(_overmap_rect)

	# Player marker
	# Player marker — large pulsing crosshair
	_overmap_marker = Control.new()
	_overmap_marker.z_index = 10
	_overmap_rect.add_child(_overmap_marker)
	# White outline ring
	var ring = ColorRect.new()
	ring.color = Color.WHITE
	ring.size = Vector2(18, 18)
	ring.position = Vector2(-9, -9)
	_overmap_marker.add_child(ring)
	# Red inner square
	var inner = ColorRect.new()
	inner.color = Color(1, 0, 0)
	inner.size = Vector2(12, 12)
	inner.position = Vector2(-6, -6)
	_overmap_marker.add_child(inner)

	# Connect click
	_overmap_rect.gui_input.connect(_on_overmap_input)

	# Label
	var label = Label.new()
	label.text = "World Map  |  Click to travel  |  M to close"
	label.position = Vector2(20, 20)
	label.add_theme_font_size_override("font_size", 20)
	label.focus_mode = Control.FOCUS_NONE
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overmap_layer.add_child(label)

	# Disable all processing on the overmap layer when hidden
	_overmap_layer.process_mode = Node.PROCESS_MODE_DISABLED


func _setup_lighting() -> void:
	_day_night = DayNightCycle.new()
	_day_night.set_time(8.0)
	_day_night.set_time_scale(NORMAL_TIME_SCALE)

	# Global brightness for non-terrain elements
	_canvas_modulate = CanvasModulate.new()
	_canvas_modulate.color = Color(1, 1, 0.95)
	add_child(_canvas_modulate)

	# Moonlight spotlight — follows player, only visible at night
	_moon_spotlight = PointLight2D.new()
	_moon_spotlight.color = Color(0.4, 0.5, 0.85)
	_moon_spotlight.energy = 0.0  # Starts off (daytime)
	_moon_spotlight.texture = _create_soft_light_texture()
	_moon_spotlight.texture_scale = 1.2  # Moderate pool, cubic falloff handles diffusion
	_moon_spotlight.blend_mode = Light2D.BLEND_MODE_ADD
	_moon_spotlight.height = 0.8  # High up — moonlight from above
	_player.add_child(_moon_spotlight)
	_moon_spotlight.position = Vector2(8, 8)  # Center on player

	# Dev HUD (hidden by default)
	_lighting_hud = Label.new()
	_lighting_hud.visible = false
	_lighting_hud.add_theme_font_size_override("font_size", 18)
	_lighting_hud.add_theme_color_override("font_color", Color.WHITE)
	_lighting_hud.add_theme_color_override("font_shadow_color", Color.BLACK)
	_lighting_hud.add_theme_constant_override("shadow_offset_x", 1)
	_lighting_hud.add_theme_constant_override("shadow_offset_y", 1)
	var hud_layer = CanvasLayer.new()
	hud_layer.layer = 21
	add_child(hud_layer)
	hud_layer.add_child(_lighting_hud)

	# Directional sun light — illuminates terrain normals
	_sun_light = DirectionalLight2D.new()
	_sun_light.color = Color.WHITE
	_sun_light.energy = 0.0
	_sun_light.height = 0.15  # Low = more parallel = dramatic normal map shading
	_sun_light.shadow_enabled = true
	_sun_light.shadow_color = Color(0, 0, 0, 0.55)  # Prominent shadows
	_sun_light.shadow_filter = DirectionalLight2D.SHADOW_FILTER_PCF5
	add_child(_sun_light)

	# Directional moon light — subtle blue directionality at night
	_moon_light = DirectionalLight2D.new()
	_moon_light.color = Color(0.4, 0.5, 0.85)
	_moon_light.energy = 0.0
	_moon_light.height = 0.1
	_moon_light.shadow_enabled = false
	add_child(_moon_light)


func _create_soft_light_texture() -> Texture2D:
	var size = 256
	var img = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center = size / 2.0
	for y in range(size):
		for x in range(size):
			var dist = Vector2(x - center, y - center).length() / center
			# Cubic falloff — steep center dropoff, long gentle tail
			var alpha = clampf(1.0 - dist, 0.0, 1.0)
			alpha = alpha * alpha * alpha  # pow(x, 3)
			img.set_pixel(x, y, Color(1, 1, 1, alpha))
	return ImageTexture.create_from_image(img)


func _toggle_lighting_test() -> void:
	_lighting_test_mode = not _lighting_test_mode
	_lighting_hud.visible = _lighting_test_mode
	if _lighting_test_mode:
		_day_night.set_time_scale(TEST_TIME_SCALE)
		print("[CleanWorld] Lighting test mode ON — full day in ~30s")
	else:
		_day_night.set_time_scale(NORMAL_TIME_SCALE)
		print("[CleanWorld] Lighting test mode OFF — normal speed")


func _toggle_overmap() -> void:
	_overmap_visible = not _overmap_visible
	_overmap_layer.visible = _overmap_visible
	_overmap_layer.process_mode = Node.PROCESS_MODE_INHERIT if _overmap_visible else Node.PROCESS_MODE_DISABLED
	if _overmap_visible and _overmap_rect.texture == null and not _overmap_generating:
		_overmap_generating = true
		_overmap_rect.texture = OvermapGenerator.get_or_create(WORLD_SEED)
		_overmap_generating = false
		print("[CleanWorld] Overmap loaded")
	if _overmap_visible and _overmap_rect.texture != null:
		# Position red marker at player's world location on the map
		var chunk_px = ChunkData.SIZE * TILE_SIZE
		var player_chunk_x = int(_player.position.x) / chunk_px if _player.position.x >= 0 else (int(_player.position.x) - chunk_px + 1) / chunk_px
		var player_chunk_y = int(_player.position.y) / chunk_px if _player.position.y >= 0 else (int(_player.position.y) - chunk_px + 1) / chunk_px
		var tex_size = _overmap_rect.texture.get_size()
		var rect_size = _overmap_rect.size
		var scale_factor = minf(rect_size.x / tex_size.x, rect_size.y / tex_size.y)
		var offset = (rect_size - tex_size * scale_factor) / 2.0
		var map_x = (float(player_chunk_x) / OvermapGenerator.CHUNKS_PER_PIXEL + OvermapGenerator.HALF_SIZE) * scale_factor + offset.x
		var map_y = (float(player_chunk_y) / OvermapGenerator.CHUNKS_PER_PIXEL + OvermapGenerator.HALF_SIZE) * scale_factor + offset.y
		_overmap_marker.position = Vector2(map_x, map_y)
		_overmap_marker.visible = true


func _on_overmap_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	if _overmap_rect.texture == null:
		return

	var tex_size = _overmap_rect.texture.get_size()
	var rect_size = _overmap_rect.size
	var scale_factor = minf(rect_size.x / tex_size.x, rect_size.y / tex_size.y)
	var offset = (rect_size - tex_size * scale_factor) / 2.0
	var local_pos = _overmap_rect.get_local_mouse_position()
	var tex_pos = (local_pos - offset) / scale_factor

	var px = int(tex_pos.x)
	var py = int(tex_pos.y)
	if px >= 0 and px < int(tex_size.x) and py >= 0 and py < int(tex_size.y):
		var chunk_x = (px - int(tex_size.x) / 2) * OvermapGenerator.CHUNKS_PER_PIXEL
		var chunk_y = (py - int(tex_size.y) / 2) * OvermapGenerator.CHUNKS_PER_PIXEL
		_teleport_to(chunk_x, chunk_y)


func _teleport_to(chunk_x: int, chunk_y: int) -> void:
	# Snap to land if target is ocean
	var opx = chunk_x + OvermapGenerator.HALF_SIZE
	var opy = chunk_y + OvermapGenerator.HALF_SIZE
	var h = OvermapGenerator.sample_height_at_pixel(float(opx), float(opy))
	if h < 0.38:
		var found = false
		for radius in range(1, 30):
			for dy in range(-radius, radius + 1):
				for dx in range(-radius, radius + 1):
					if abs(dx) != radius and abs(dy) != radius:
						continue
					var nh = OvermapGenerator.sample_height_at_pixel(float(opx + dx), float(opy + dy))
					if nh >= 0.42:
						chunk_x += dx
						chunk_y += dy
						found = true
						break
				if found:
					break
			if found:
				break

	_overmap_visible = false
	_overmap_layer.visible = false
	_overmap_layer.process_mode = Node.PROCESS_MODE_DISABLED
	get_viewport().gui_release_focus()
	_renderer.clear_all()
	if _object_renderer:
		_object_renderer.clear_all()
	var center_px = (chunk_x * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	var center_py = (chunk_y * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	_player.position = Vector2(center_px, center_py)
	_chunk_streamer.load_grid_around(chunk_x, chunk_y, get_tree())
	# Clear blocking tiles around spawn point so player isn't stuck
	var spawn_tx = int(center_px / TILE_SIZE)
	var spawn_ty = int(center_py / TILE_SIZE)
	for dy in range(-2, 3):
		for dx in range(-2, 3):
			_chunk_streamer._blocking_tiles.erase(Vector2i(spawn_tx + dx, spawn_ty + dy))
	print("[CleanWorld] Teleported to chunk (%d, %d)" % [chunk_x, chunk_y])


func _find_interesting_spawn() -> Vector2i:
	## Compile test chunks near origin, find one that's actually grassland/forest.
	## The overmap elevation alone can't distinguish tundra from grassland.
	var best = Vector2i.ZERO
	var best_score = -1.0
	for radius in range(0, 30):
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				if abs(dx) != radius and abs(dy) != radius and radius > 0:
					continue
				# Quick overmap height check to skip ocean
				var opx = dx + OvermapGenerator.HALF_SIZE
				var opy = dy + OvermapGenerator.HALF_SIZE
				var h = OvermapGenerator.sample_height_at_pixel(float(opx), float(opy))
				if h < 0.42 or h > 0.85:
					continue
				# Compile a real chunk to check the actual biome
				var chunk = ChunkData.new()
				chunk.chunk_x = dx
				chunk.chunk_y = dy
				chunk.world_seed = WORLD_SEED
				for layer in _phase1_compiler.layers:
					var lseed = SeedHasher.hash_seed(WORLD_SEED, dx, dy, layer.layer_id)
					layer.compile(chunk, lseed)
					if layer.layer_name == "ocean_mask":
						_phase1_compiler._compute_ocean_distance(chunk)
				for layer in _phase2_compiler.layers:
					var lseed = SeedHasher.hash_seed(WORLD_SEED, dx, dy, layer.layer_id)
					layer.compile(chunk, lseed)
				# Count biome types — prefer grassland/forest
				var grass_count = 0
				var forest_count = 0
				var total = ChunkData.SIZE * ChunkData.SIZE
				for i in range(total):
					var b = chunk.biome_id[i]
					if b == 2:  # grassland
						grass_count += 1
					elif b == 3 or b == 4:  # forest, dense_forest
						forest_count += 1
				var score = float(grass_count + forest_count) / float(total)
				# Also check 4 neighbors via overmap — penalize if neighbors are ocean/extreme
				var neighbor_penalty = 0.0
				for nd in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]:
					var nh = OvermapGenerator.sample_height_at_pixel(float(opx + nd.x), float(opy + nd.y))
					if nh < 0.42 or nh > 0.80:
						neighbor_penalty += 0.15
				score -= neighbor_penalty
				if score > best_score:
					best_score = score
					best = Vector2i(dx, dy)
		if best_score > 0.7:
			break  # >70% grassland/forest with good neighbors
	print("[CleanWorld] Spawn: chunk (%d,%d) score=%.2f (grassland+forest %%)" % [best.x, best.y, best_score])
	return best


func _process(delta: float) -> void:
	# Tick day/night cycle and update lighting
	_day_night.tick(delta)
	# Compute sun direction vector from angle
	_sun_angle = _day_night.get_sun_angle()

	# CanvasModulate: full ambient + color tint (scaled down to avoid blown-out look)
	var ambient = _day_night.get_ambient_color()
	var b = _day_night.get_scene_brightness() * 0.78
	_canvas_modulate.color = Color(ambient.r * b, ambient.g * b, ambient.b * b)

	# Moonlight spotlight — smooth crossfade driven by DayNightCycle
	var target_moon = _day_night.get_moonlight_energy()
	_moon_spotlight.energy = lerpf(_moon_spotlight.energy, target_moon, delta * 3.0)

	# Directional lights — driven by day/night cycle
	_sun_light.color = _day_night.get_sun_color()
	_sun_light.energy = _day_night.get_sun_energy() * 0.4  # Subtle directional — for normal map shading only
	_sun_light.rotation = _day_night.get_sun_angle()

	_moon_light.energy = _day_night.get_moonlight_energy() * 0.5
	_moon_light.rotation = _day_night.get_sun_angle() + PI

	if Engine.get_process_frames() == 60:
		print("[LIGHT DEBUG] sun: energy=%.2f rot=%.1f° visible=%s | moon: energy=%.2f | canvas_mod=%s" % [
			_sun_light.energy, rad_to_deg(_sun_light.rotation), _sun_light.visible,
			_moon_light.energy, _canvas_modulate.color])

	if _lighting_test_mode:
		_lighting_hud.text = "%s | %s | angle: %d deg | energy: %.2f | tint: %.2f | bright: %.2f" % [
			_day_night.get_time_string(),
			_day_night.get_period().to_upper(),
			int(rad_to_deg(_sun_angle)),
			_day_night.get_sun_energy(),
			_day_night.get_tint_strength(),
			_day_night.get_scene_brightness()
		]

	if _overmap_visible:
		return

	# Update shadow positions every frame — fluid movement, zero cost
	if _object_renderer:
		_object_renderer.update_shadow_positions(_sun_angle, _day_night.get_sun_height(), delta)

	# Chunk streaming + update player chunk for LOD culling
	var pcx = int(_player.position.x / TILE_SIZE) / ChunkData.SIZE
	var pcy = int(_player.position.y / TILE_SIZE) / ChunkData.SIZE
	if _object_renderer:
		_object_renderer.set_player_chunk(pcx, pcy)
	_chunk_streamer.update(_player.position, TILE_SIZE, get_tree())

	# Player movement — raw key checks only (ui_up/ui_down get eaten by UI focus)
	var dir = Vector2.ZERO
	if Input.is_key_pressed(KEY_A):
		dir.x -= 1
	if Input.is_key_pressed(KEY_D):
		dir.x += 1
	if Input.is_key_pressed(KEY_W):
		dir.y -= 1
	if Input.is_key_pressed(KEY_S):
		dir.y += 1

	_player_is_moving = dir != Vector2.ZERO
	if _player_is_moving:
		dir = dir.normalized()
		# Update facing direction
		var new_facing = _direction_to_name(dir)
		if new_facing != _player_facing:
			_player_facing = new_facing
			_player_walk_frame = 0
		# Walk animation: cycle through frames
		if _player_walk_frames.has(_player_facing):
			_player_walk_timer += delta * WALK_FPS
			if _player_walk_timer >= 1.0:
				_player_walk_timer -= 1.0
				_player_walk_frame = (_player_walk_frame + 1) % _player_walk_frames[_player_facing].size()
			_player_sprite.texture = _player_walk_frames[_player_facing][_player_walk_frame]
			if _player_shadow:
				_player_shadow.texture = _player_sprite.texture
		elif _player_textures.has(_player_facing):
			_player_sprite.texture = _player_textures[_player_facing]
			if _player_shadow:
				_player_shadow.texture = _player_sprite.texture
	else:
		# Idle: show static direction sprite
		if _player_textures.has(_player_facing):
			_player_sprite.texture = _player_textures[_player_facing]
			if _player_shadow:
				_player_shadow.texture = _player_sprite.texture
		_player_walk_timer = 0.0
		_player_walk_frame = 0

	if _player_is_moving:
		var current_elev = _get_elevation_at(_player.position)
		var ahead_elev = _get_elevation_at(_player.position + dir * 8.0)
		var slope = ahead_elev - current_elev
		var speed_mult = 1.0
		if slope > 0.01:
			speed_mult = lerpf(1.0, SPEED_UPHILL, clampf(slope * 10.0, 0.0, 0.4))
		elif slope < -0.01:
			speed_mult = lerpf(1.0, SPEED_DOWNHILL, clampf(-slope * 10.0, 0.0, 0.4))
		var move = dir * PLAYER_SPEED * speed_mult * delta
		var new_pos = _player.position + move
		var new_elev = _get_elevation_at(new_pos)
		var elev_diff = abs(new_elev - current_elev)
		# Block: ocean, cliff faces (steep elevation change), steep slopes, blocking objects
		var new_tile_x = int(new_pos.x / TILE_SIZE)
		var new_tile_y = int(new_pos.y / TILE_SIZE)
		var tile_blocked = _chunk_streamer.is_tile_blocked(new_tile_x, new_tile_y)
		if tile_blocked:
			# Try sliding along axes (wall sliding)
			var slide_x = Vector2(_player.position.x + move.x, _player.position.y)
			var slide_tx = int(slide_x.x / TILE_SIZE)
			var slide_ty = int(slide_x.y / TILE_SIZE)
			if not _chunk_streamer.is_tile_blocked(slide_tx, slide_ty):
				new_pos = slide_x
				tile_blocked = false
			else:
				var slide_y = Vector2(_player.position.x, _player.position.y + move.y)
				slide_tx = int(slide_y.x / TILE_SIZE)
				slide_ty = int(slide_y.y / TILE_SIZE)
				if not _chunk_streamer.is_tile_blocked(slide_tx, slide_ty):
					new_pos = slide_y
					tile_blocked = false
		if not tile_blocked and new_elev >= 0.35 and elev_diff < 0.08:
			_player.position = new_pos
		elif not tile_blocked and new_elev >= 0.35 and elev_diff < 0.15:
			# Steep but climbable — very slow
			_player.position += move * 0.2

	# Update player shadow position based on sun angle
	var shadow_scale = 1.0 / maxf(tan(_day_night.get_sun_height() * PI * 0.5), 0.15)
	var shadow_len = 8.0 * shadow_scale * 0.15
	# Player shadow is a child of player_sprite — position is automatic

	# Elevation-aware player position: blend quantized (matches terrain) with raw (smooth)
	var elev = _get_elevation_at(_player.position)
	var quantized_elev = roundf(elev * 8.0) / 8.0
	# Blend 70% quantized (snaps to terrain surface) + 30% raw (smooth transitions)
	var blended_elev = quantized_elev * 0.7 + elev * 0.3
	var elev_visual_offset = blended_elev * 512.0
	# Smooth lerp — feels like gradual climbing
	_player_sprite.position.y = lerpf(_player_sprite.position.y, -elev_visual_offset, delta * 4.0)
	# Shadow stays at feet (y=0 is feet). Only adjust for elevation visual offset.
	_player_shadow.position.y = 0.0
	# Camera follows smoothly
	_camera.offset = _camera.offset.lerp(Vector2(0, _player_sprite.position.y), delta * 3.0)
	# Y-sort: use visual Y position (player pos + sprite elevation offset) to match objects
	var player_visual_y = int((_player.position.y + _player_sprite.position.y) / float(TILE_SIZE))
	_player.z_index = clampi(player_visual_y + 2000, 0, 4000)
	_player.z_as_relative = false
	# Update player shadow: z just below player, rotate with sun
	if _player_shadow:
		_player_shadow.z_index = clampi(player_visual_y + 2000 - 1, 0, 4000)
		# Skew-based shadow — identical math to object shadows in terrain_object_renderer
		var sun_h = _day_night.get_sun_height()
		var s_stretch = clampf(1.0 / maxf(tan(sun_h * PI * 0.5), 0.2), 0.8, 2.0)
		var s_len = s_stretch * 0.6
		var s_dir_x = -cos(_sun_angle)
		var s_dir_y = -sin(_sun_angle)
		_player_shadow.rotation = 0.0
		_player_shadow.skew = atan(s_dir_x * s_len)
		var s_sy = clampf(-s_dir_y * s_len, -1.5, 1.5)
		if absf(s_sy) < 0.1:
			s_sy = 0.1 if s_sy >= 0.0 else -0.1
		# Keep X scale constant (matches sprite width), update Y for shadow projection
		var base_sx = _player_sprite.scale.x
		_player_shadow.scale = Vector2(base_sx, s_sy * base_sx)
		_player_shadow.self_modulate.a = clampf(0.4 - sun_h * 0.1, 0.15, 0.35)

	# Zoom out at height — see more from mountaintops
	_target_zoom = lerpf(ZOOM_MAX, ZOOM_MIN, clampf((elev - 0.35) / 0.5, 0.0, 1.0))
	_camera.zoom = _camera.zoom.lerp(Vector2(_target_zoom, _target_zoom), delta * 2.0)

	# Bokeh disabled — shader needs rework for Forward Plus renderer


func _on_chunk_loaded_layers(_cx: int, _cy: int) -> void:
	pass  # Elevation rendering now happens on background thread via chunk_streamer


func _create_oval_shadow(w: int, h: int) -> Texture2D:
	# White oval — modulate to dark on the sprite node
	var img = Image.create(w * 2, h * 2, false, Image.FORMAT_RGBA8)
	var cx = float(w)
	var cy = float(h)
	for y in range(h * 2):
		for x in range(w * 2):
			var dx = (float(x) - cx) / float(w)
			var dy = (float(y) - cy) / float(h)
			var dist = dx * dx + dy * dy
			if dist < 1.0:
				img.set_pixel(x, y, Color(1.0, 1.0, 1.0, 1.0 - dist))
			else:
				img.set_pixel(x, y, Color(0.0, 0.0, 0.0, 0.0))
	return ImageTexture.create_from_image(img)


func _direction_to_name(dir: Vector2) -> String:
	# Map movement vector to 8-direction sprite name
	var angle = dir.angle()  # radians, 0 = right, positive = clockwise
	# Normalize to 0-360 degrees
	var deg = rad_to_deg(angle)
	if deg < 0:
		deg += 360.0
	# 8 sectors of 45 degrees each, offset by 22.5
	if deg < 22.5 or deg >= 337.5:
		return "east"
	elif deg < 67.5:
		return "south-east"
	elif deg < 112.5:
		return "south"
	elif deg < 157.5:
		return "south-west"
	elif deg < 202.5:
		return "west"
	elif deg < 247.5:
		return "north-west"
	elif deg < 292.5:
		return "north"
	else:
		return "north-east"


func _get_elevation_at(world_pos: Vector2) -> float:
	var tile_x = int(world_pos.x) / TILE_SIZE
	var tile_y = int(world_pos.y) / TILE_SIZE
	var cx = 0
	var cy = 0
	var lx = tile_x
	var ly = tile_y
	if tile_x < 0:
		cx = (tile_x - ChunkData.SIZE + 1) / ChunkData.SIZE
		lx = tile_x - cx * ChunkData.SIZE
	else:
		cx = tile_x / ChunkData.SIZE
		lx = tile_x - cx * ChunkData.SIZE
	if tile_y < 0:
		cy = (tile_y - ChunkData.SIZE + 1) / ChunkData.SIZE
		ly = tile_y - cy * ChunkData.SIZE
	else:
		cy = tile_y / ChunkData.SIZE
		ly = tile_y - cy * ChunkData.SIZE
	var chunk = _chunk_streamer.get_chunk(cx, cy)
	if chunk == null:
		return 0.5
	lx = clampi(lx, 0, ChunkData.SIZE - 1)
	ly = clampi(ly, 0, ChunkData.SIZE - 1)
	return chunk.elevation[chunk.idx(lx, ly)]


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_M:
			_toggle_overmap()
		elif event.keycode == KEY_T:
			_toggle_lighting_test()
		elif event.keycode == KEY_EQUAL:
			_camera.zoom *= 1.2
		elif event.keycode == KEY_MINUS:
			_camera.zoom *= 0.8
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_camera.zoom *= 1.1
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_camera.zoom *= 0.9
