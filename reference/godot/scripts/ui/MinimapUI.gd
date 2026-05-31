extends Control

const MAP_SIZE := 150
const MAP_SCALE := 2

var _map_rect: ColorRect
var _map_texture: TextureRect
var _player_dot: ColorRect
var _npc_dots: Array = []
var _border: Panel
var _player_world_x: int = 64
var _player_world_y: int = 64
var _map_update_timer: float = 0.0
var _last_terrain_x: int = -999
var _last_terrain_y: int = -999
var _cached_terrain: Image = null

func _ready() -> void:
	_build_ui()

func _process(delta: float) -> void:
	if not visible:
		return
	_map_update_timer += delta
	if _map_update_timer >= 0.25:
		_map_update_timer = 0.0
		_update_map()

func _build_ui() -> void:
	_border = Panel.new()
	_border.size = Vector2(MAP_SIZE + 4, MAP_SIZE + 4)
	_border.position = Vector2(1746, 420)
	add_child(_border)

	_map_rect = ColorRect.new()
	_map_rect.size = Vector2(MAP_SIZE, MAP_SIZE)
	_map_rect.position = Vector2(2, 2)
	_map_rect.color = Color(0.1, 0.15, 0.1)
	_border.add_child(_map_rect)

	_map_texture = TextureRect.new()
	_map_texture.size = Vector2(MAP_SIZE, MAP_SIZE)
	_map_texture.position = Vector2.ZERO
	_map_texture.stretch_mode = TextureRect.STRETCH_SCALE
	_map_texture.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_map_rect.add_child(_map_texture)

	_player_dot = ColorRect.new()
	_player_dot.size = Vector2(4, 4)
	_player_dot.color = Color.RED
	_player_dot.position = Vector2(MAP_SIZE / 2 - 2, MAP_SIZE / 2 - 2)
	_map_rect.add_child(_player_dot)

func _update_map() -> void:
	# Clear old NPC dots
	for dot in _npc_dots:
		dot.queue_free()
	_npc_dots.clear()

	if not WorldManager or not WorldManager._initialized:
		return
	var player_wx := _player_world_x
	var player_wy := _player_world_y

	# Only re-render terrain when player moves significantly
	var moved = abs(player_wx - _last_terrain_x) + abs(player_wy - _last_terrain_y)
	if moved > 10 or _cached_terrain == null:
		_last_terrain_x = player_wx
		_last_terrain_y = player_wy
		_cached_terrain = _render_terrain_image(player_wx, player_wy)
	_map_texture.texture = ImageTexture.create_from_image(_cached_terrain)
	# NPC dots rendered below
	var nearby = WorldManager.entity_spawner.get_entities_near(player_wx, player_wy, 75)
	for npc in nearby:
		var npc_pos = WorldManager.entity_spawner.get_entity_position(npc.entity_id)
		var rel_x = (npc_pos.x - player_wx) * MAP_SCALE + MAP_SIZE / 2
		var rel_y = (npc_pos.y - player_wy) * MAP_SCALE + MAP_SIZE / 2
		if rel_x >= 0 and rel_x < MAP_SIZE and rel_y >= 0 and rel_y < MAP_SIZE:
			var dot := ColorRect.new()
			dot.size = Vector2(3, 3)
			dot.color = EntityRenderer.SPECIES_BASE_COLORS.get(npc.species, Color.YELLOW)
			dot.position = Vector2(rel_x, rel_y)
			_map_rect.add_child(dot)
			_npc_dots.append(dot)

func _render_terrain_image(pwx: int, pwy: int) -> Image:
	var img := Image.create(MAP_SIZE, MAP_SIZE, false, Image.FORMAT_RGB8)
	img.fill(Color(0.1, 0.15, 0.1))
	for my in range(0, MAP_SIZE, 2):  # Sample every 2 pixels for performance
		for mx in range(0, MAP_SIZE, 2):
			var wx = pwx + (mx - MAP_SIZE / 2) / MAP_SCALE
			var wy = pwy + (my - MAP_SIZE / 2) / MAP_SCALE
			var cx = wx / WorldCell.CELL_SIZE
			var cy = wy / WorldCell.CELL_SIZE
			var cell = WorldManager.world.get_cell(cx, cy)
			if cell:
				var lx = wx - cx * WorldCell.CELL_SIZE
				var ly = wy - cy * WorldCell.CELL_SIZE
				if lx >= 0 and lx < WorldCell.CELL_SIZE and ly >= 0 and ly < WorldCell.CELL_SIZE:
					var h = cell.get_height(lx, ly)
					var c = _biome_minimap_color(cell.biome)
					c = c * (0.6 + h * 0.8)
					c = c.clamp()
					img.set_pixel(mx, my, c)
					img.set_pixel(mini(mx + 1, MAP_SIZE - 1), my, c)
					img.set_pixel(mx, mini(my + 1, MAP_SIZE - 1), c)
					img.set_pixel(mini(mx + 1, MAP_SIZE - 1), mini(my + 1, MAP_SIZE - 1), c)
	return img

func _biome_minimap_color(biome: String) -> Color:
	match biome:
		"grassland": return Color(0.3, 0.6, 0.2)
		"forest": return Color(0.15, 0.4, 0.1)
		"desert": return Color(0.8, 0.7, 0.4)
		"beach": return Color(0.85, 0.78, 0.55)
		"ocean", "deep_ocean": return Color(0.15, 0.3, 0.6)
		"shallow_water": return Color(0.2, 0.4, 0.7)
		"hills": return Color(0.5, 0.45, 0.3)
		"mountains": return Color(0.4, 0.4, 0.45)
		"tundra": return Color(0.8, 0.85, 0.9)
		"swamp": return Color(0.3, 0.35, 0.2)
		"volcanic": return Color(0.6, 0.2, 0.1)
		"frozen_lake": return Color(0.6, 0.75, 0.85)
		"mushroom_forest": return Color(0.4, 0.3, 0.5)
		"path": return Color(0.5, 0.4, 0.3)
		_: return Color(0.3, 0.3, 0.3)

func update_player_position(wx: int, wy: int) -> void:
	_player_world_x = wx
	_player_world_y = wy
