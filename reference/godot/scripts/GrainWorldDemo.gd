extends Node2D

var _player_pos := Vector2(64, 64)
var _loaded: bool = false
var _info_label: Label
var _camera: Camera2D
var _player_marker: ColorRect
var _npc_markers: Dictionary = {}
var _cell_sprites: Dictionary = {}
var _move_speed: float = 40.0
var _cells_generated: Dictionary = {}
var _inventory_ui: Control
var _dialogue_ui: Control
var _equipment_ui: Control
var _crafting_ui: Control
var _minimap_ui: Control
var _status_bar_ui: Control
var _quest_tracker_ui: Control
var _notification_ui: Control
var _player_entity: EntityBody
var _sprite_loader: SpriteLoader
var _pause_menu: Control
var _inspect_ui: Control
var _trade_ui: Control
var _command_ui: Control
var _settings_ui: Control
var _stats_ui: Control
var _info_timer: float = 0.0
var _main_menu: Control
var _char_creation: Control
var _game_started: bool = false
var _weather_particles: Array = []
var _weather_particle_timer: float = 0.0
var _player_sprite: Sprite2D
var _player_facing: String = "south"
var _player_anim_timer: float = 0.0
var _player_anim_frame: int = 0
var _player_is_moving: bool = false
var _proximity_label: Label
var _highlighted_npc_id: int = -1
var _loot_markers: Dictionary = {}  # item_id → Node2D
var _loot_update_timer: float = 0.0
var _npc_anim_frames: Dictionary = {}  # eid → int (current frame)
var _npc_anim_timer: float = 0.0
var _time_warn_timer: float = 0.0
var _help_overlay: Panel
var _tilemap_renderer: TileMapRenderer
var _proc_audio: ProceduralAudio
var _sprite_struct_renderer: SpriteStructureRenderer
var _sprite_obj_renderer: SpriteObjectRenderer
var _map_obj_renderer: MapObjectRenderer
var _deferred_renderer: DeferredRenderer
var _tilemap_terrain_renderer: TileMapTerrainRenderer
var _debug_overlay: DebugOverlay
var _compiled_chunk: ChunkData

func _ready() -> void:
	# Show main menu first
	var menu_layer := CanvasLayer.new()
	menu_layer.layer = 20
	menu_layer.name = "MenuLayer"
	add_child(menu_layer)

	_main_menu = preload("res://scripts/ui/MainMenuUI.gd").new()
	_main_menu.new_game_requested.connect(_on_new_game)
	_main_menu.continue_game_requested.connect(_on_continue_game)
	_main_menu.quit_requested.connect(func(): get_tree().quit())
	menu_layer.add_child(_main_menu)

	_char_creation = preload("res://scripts/ui/CharacterCreationUI.gd").new()
	_char_creation.visible = false
	_char_creation.character_created.connect(_on_character_created)
	menu_layer.add_child(_char_creation)

func _on_new_game() -> void:
	_main_menu.visible = false
	_char_creation.visible = true

func _on_continue_game() -> void:
	_main_menu.visible = false
	var ok := WorldManager.load_game("manual_save")
	if ok:
		_player_entity = WorldManager.player_mgr.entity
		if _player_entity == null:
			_player_entity = WorldManager.player_mgr.create_player("Player", EntityBody.Species.HUMAN)
		_start_game()
	else:
		_on_new_game()

func _on_character_created(entity: EntityBody) -> void:
	_char_creation.visible = false
	WorldManager.player_mgr.entity = entity
	_player_entity = entity
	_start_game()

func _start_game() -> void:
	if _game_started:
		return
	var t0 = Time.get_ticks_msec()
	print("[STARTUP] _start_game() begin")

	# If world compiler, skip EVERYTHING except camera + compiler
	if WorldManager.world_compiler:
		_camera = Camera2D.new()
		_camera.zoom = Vector2(3.5, 3.5)  # Zoomed in: each 32px tile = ~112 screen pixels
		_camera.position_smoothing_enabled = true
		_camera.position_smoothing_speed = 10.0
		add_child(_camera)
		_camera.make_current()

		_player_marker = ColorRect.new()
		_player_marker.size = Vector2(2, 2)
		_player_marker.color = Color(0, 0, 0, 0)
		_player_marker.z_index = 10
		add_child(_player_marker)
		# Load player character sprite with walk animation support
		_sprite_loader = SpriteLoader.new()
		var player_dir = "player_v2"
		var player_asset_path = "res://assets/characters/%s" % player_dir
		_sprite_loader.load_character_rotations(player_dir, player_asset_path)
		var walk_dirs_compiler = ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"]
		for wdir in walk_dirs_compiler:
			_sprite_loader.load_walk_animation(player_dir, player_asset_path, wdir, 8)
		var player_tex = _sprite_loader.get_rotation(player_dir, "south")
		if player_tex == null:
			# Fallback: direct ResourceLoader
			player_tex = ResourceLoader.load("res://assets/characters/player_v2/rotations/south.png") as Texture2D
		if player_tex == null:
			# Last resort: Image.load_from_file
			var player_img = Image.load_from_file("res://assets/characters/player_v2/rotations/south.png")
			if player_img:
				player_tex = ImageTexture.create_from_image(player_img)
		if player_tex:
			_player_sprite = Sprite2D.new()
			_player_sprite.texture = player_tex
			_player_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			var target_h = 32.0
			_player_sprite.scale = Vector2(target_h / float(player_tex.get_height()), target_h / float(player_tex.get_height()))
			_player_sprite.z_index = 10
			_player_marker.add_child(_player_sprite)
			print("[PLAYER] Sprite loaded: %s (%dx%d)" % [player_tex.resource_path, player_tex.get_width(), player_tex.get_height()])
		else:
			# Fallback: make marker visible so player isn't invisible
			_player_marker.color = Color(0.2, 0.6, 1.0, 0.8)  # Blue marker instead of invisible
			_player_marker.size = Vector2(24, 24)
			push_warning("[PLAYER] Failed to load player sprite — using blue marker fallback")

		_player_pos = Vector2(32, 32)

		# TileMapLayer-based terrain renderer (replaces Image-based DeferredRenderer for tiles)
		_tilemap_terrain_renderer = TileMapTerrainRenderer.new()
		_tilemap_terrain_renderer.setup(self)
		add_child(_tilemap_terrain_renderer)

		# DeferredRenderer kept ONLY for object/decoration sprites (trees, rocks, grass, etc.)
		_deferred_renderer = DeferredRenderer.new()
		_deferred_renderer.setup(self)
		add_child(_deferred_renderer)
		# Wire catalog-driven placement engine into deferred renderer
		if WorldManager.placement_engine and WorldManager.object_catalog:
			_deferred_renderer.set_placement_engine(WorldManager.placement_engine, WorldManager.object_catalog)

		_debug_overlay = DebugOverlay.new()
		_debug_overlay.setup(WorldManager.world_compiler, self)
		add_child(_debug_overlay)

		_loaded = true
		_game_started = true

		print("[STARTUP] Minimal compiler startup done in %dms" % [Time.get_ticks_msec() - t0])

		# Compile chunks incrementally (one layer per frame)
		await _compile_all_chunks()

		# Spawn NPCs at settlement structures
		_spawn_compiler_npcs()
		return

	_camera = Camera2D.new()
	_camera.zoom = Vector2(0.85, 0.85)  # 8px tiles × 2.5 = 20 screen px per tile
	_camera.position_smoothing_enabled = true
	_camera.position_smoothing_speed = 10.0
	add_child(_camera)
	_camera.make_current()

	_player_marker = ColorRect.new()
	_player_marker.size = Vector2(2, 2)
	_player_marker.color = Color(0, 0, 0, 0)  # Start transparent
	_player_marker.z_index = 10
	add_child(_player_marker)
	# Load player sprite — try hero_knight_v2, fall back to player_v2
	var _legacy_player_tex = ResourceLoader.load("res://assets/characters/hero_knight_v2/rotations/south.png") as Texture2D
	if _legacy_player_tex == null:
		_legacy_player_tex = ResourceLoader.load("res://assets/characters/player_v2/rotations/south.png") as Texture2D
	if _legacy_player_tex:
		_player_sprite = Sprite2D.new()
		_player_sprite.texture = _legacy_player_tex
		_player_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		var _target_h = 20.0
		_player_sprite.scale = Vector2(_target_h / float(_legacy_player_tex.get_height()), _target_h / float(_legacy_player_tex.get_height()))
		_player_sprite.z_index = 10
		_player_marker.add_child(_player_sprite)
		print("[PLAYER] Legacy path: loaded %s" % _legacy_player_tex.resource_path)
	else:
		_player_marker.color = Color(0.2, 0.6, 1.0, 0.8)  # Blue fallback
		_player_marker.size = Vector2(16, 16)
		push_warning("[PLAYER] Could not load any character sprite")
	# Player light — warm glow that illuminates surroundings
	var player_light := PointLight2D.new()
	player_light.name = "PlayerLight"
	player_light.color = Color(1.0, 0.95, 0.8)
	player_light.energy = 0.6
	player_light.texture = _create_light_texture(128)
	player_light.texture_scale = 3.0
	player_light.z_index = 15
	player_light.blend_mode = Light2D.BLEND_MODE_ADD
	_player_marker.add_child(player_light)

	_info_label = Label.new()
	_info_label.z_index = 100
	_info_label.add_theme_font_size_override("font_size", 12)
	_info_label.position = Vector2(250, 20)
	# Add to UI layer so it doesn't scale with camera zoom
	var info_layer := CanvasLayer.new()
	info_layer.layer = 11
	add_child(info_layer)
	info_layer.add_child(_info_label)

	# Day/night ambient
	var canvas_mod := CanvasModulate.new()
	canvas_mod.name = "DayNightMod"
	add_child(canvas_mod)

	# Add UI layers
	var ui_layer := CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)

	_inventory_ui = preload("res://scripts/ui/InventoryUI.gd").new()
	_inventory_ui.item_used.connect(_on_item_used)
	ui_layer.add_child(_inventory_ui)
	# Create starter items through item system
	var pick = WorldManager.item_system.create_item("Stone Pick", ["stone", "wood"], 0.9)
	var torch = WorldManager.item_system.create_item("Torch", ["wood", "coal"], 1.0)
	var bread = WorldManager.item_system.create_item("Bread", [], 1.0)
	var potion = WorldManager.item_system.create_item("Healing Potion", ["flower", "water"], 1.0)
	_inventory_ui.add_item(pick)
	_inventory_ui.add_item(torch)
	_inventory_ui.add_item(bread)
	_inventory_ui.add_item(potion)

	_dialogue_ui = preload("res://scripts/ui/DialogueUI.gd").new()
	_dialogue_ui.dialogue_submitted.connect(_on_dialogue_submitted)
	ui_layer.add_child(_dialogue_ui)

	var starter_tunic = WorldManager.item_system.create_item("Leather Tunic", ["leather"], 1.0)
	var starter_weapon = WorldManager.item_system.create_item("Stone Pick", ["stone", "wood"], 0.9)
	_player_entity.equip("chest", starter_tunic)
	_player_entity.equip("main_hand", starter_weapon)

	_equipment_ui = preload("res://scripts/ui/EquipmentUI.gd").new()
	_equipment_ui.set_entity(_player_entity)
	_equipment_ui.item_unequipped.connect(func(_slot):
		_notification_ui.show_notification("Item unequipped", Color(0.8, 0.8, 0.6))
	)
	ui_layer.add_child(_equipment_ui)

	_crafting_ui = preload("res://scripts/ui/CraftingUI.gd").new()
	_crafting_ui.item_crafted.connect(_on_item_crafted)
	_crafting_ui.experiment_requested.connect(_on_experiment_requested)
	ui_layer.add_child(_crafting_ui)

	_status_bar_ui = preload("res://scripts/ui/StatusBarUI.gd").new()
	_status_bar_ui.set_entity(_player_entity)
	ui_layer.add_child(_status_bar_ui)

	_minimap_ui = preload("res://scripts/ui/MinimapUI.gd").new()
	ui_layer.add_child(_minimap_ui)

	_quest_tracker_ui = preload("res://scripts/ui/QuestTrackerUI.gd").new()
	ui_layer.add_child(_quest_tracker_ui)

	_notification_ui = preload("res://scripts/ui/NotificationUI.gd").new()
	ui_layer.add_child(_notification_ui)

	_pause_menu = preload("res://scripts/ui/PauseMenuUI.gd").new()
	_pause_menu.save_requested.connect(func(): _save_game())
	_pause_menu.load_requested.connect(func(): _load_game())
	_pause_menu.quit_requested.connect(func(): get_tree().quit())
	ui_layer.add_child(_pause_menu)

	_inspect_ui = preload("res://scripts/ui/InspectUI.gd").new()
	ui_layer.add_child(_inspect_ui)

	_trade_ui = preload("res://scripts/ui/TradeUI.gd").new()
	_trade_ui.trade_completed.connect(_on_trade_completed)
	ui_layer.add_child(_trade_ui)

	_command_ui = preload("res://scripts/ui/CommandInputUI.gd").new()
	_command_ui.command_submitted.connect(_on_command_submitted)
	ui_layer.add_child(_command_ui)

	_settings_ui = preload("res://scripts/ui/SettingsUI.gd").new()
	ui_layer.add_child(_settings_ui)

	_stats_ui = preload("res://scripts/ui/CharacterStatsUI.gd").new()
	_stats_ui.set_systems(WorldManager.player_mgr, WorldManager.skill_prog, WorldManager.entity_lifecycle)
	ui_layer.add_child(_stats_ui)

	# Wire command interpreter signals
	WorldManager.command_interp.action_completed.connect(func(action):
		var name = WorldManager.command_interp.get_action_name(action.get("type", -1))
		var target = action.get("target", "")
		var result = action.get("result", {})
		var success = result.get("success", false)
		_command_ui.add_action_log(name, target, success)
		if result.has("message"):
			_command_ui.add_response(result["message"], Color.WHITE if success else Color.RED)
	)
	WorldManager.command_interp.command_completed.connect(func(_results):
		_command_ui.add_response("Done.", Color.GREEN)
	)
	WorldManager.command_interp.command_failed.connect(func(reason):
		_command_ui.add_response(reason, Color.RED)
	)

	# Connect world event notifications
	WorldManager.world_events.event_announced.connect(func(title, desc):
		_notification_ui.show_quest_notification("%s: %s" % [title, desc])
	)
	WorldManager.weather.weather_changed.connect(func(w):
		_notification_ui.show_weather_notification(w)
	)
	WorldManager.quest_gen.quest_available.connect(func(quest):
		_notification_ui.show_quest_notification("New Quest: %s" % quest.get("title", "???"))
		_quest_tracker_ui.add_objective(quest.get("title", "???"), quest.get("description", ""), quest.get("type", "misc"))
	)
	WorldManager.population_sim.death.connect(func(eid, cause):
		var entity = WorldManager.entity_spawner.get_entity(eid)
		if entity:
			_notification_ui.show_notification("%s has died (%s)" % [entity.name, cause], Color.GRAY)
			if _npc_markers.has(eid):
				_npc_markers[eid].queue_free()
				_npc_markers.erase(eid)
	)
	WorldManager.population_sim.birth.connect(func(pa, pb, cid):
		_notification_ui.show_notification("A child was born!", Color(1.0, 0.9, 0.5))
		_spawn_single_npc_marker(cid)
	)
	# Async LLM dialogue responses update the dialogue UI
	WorldManager.dialogue_engine.response_ready.connect(func(npc_id, text):
		if _dialogue_ui.visible:
			var npc = WorldManager.entity_spawner.get_entity(npc_id)
			if npc:
				_dialogue_ui.add_npc_message(npc.name, text)
	)

	# Ambient world events
	# Time of day changes
	WorldManager.day_night.time_of_day_changed.connect(func(hour, period):
		match period:
			"dawn":
				_notification_ui.show_notification("The sun rises. A new day begins.", Color(1.0, 0.8, 0.4))
			"day":
				_notification_ui.show_notification("Morning light fills the land.", Color(1.0, 0.95, 0.7))
			"dusk":
				_notification_ui.show_notification("The sun sets. Darkness approaches.", Color(0.8, 0.5, 0.3))
			"night":
				_notification_ui.show_notification("Night falls. Be careful.", Color(0.3, 0.3, 0.6))
	)

	# Event framework progress
	WorldManager.event_framework.phase_entered.connect(func(_id, phase):
		_notification_ui.show_notification("Event: %s" % phase.capitalize().replace("_", " "), Color(0.9, 0.7, 0.3))
	)
	WorldManager.event_framework.event_completed.connect(func(_id, outcome):
		_notification_ui.show_notification("Event complete: %s" % outcome.replace("_", " "), Color(0.3, 0.9, 0.3))
		WorldManager.player_mgr.gain_xp(30.0)
	)

	# Discovery rewards
	WorldManager.discovery.biome_discovered.connect(func(biome):
		_notification_ui.show_notification("New biome discovered: %s!" % biome.capitalize(), Color(0.3, 1.0, 0.5))
		WorldManager.player_mgr.gain_xp(25.0)
		WorldManager.gain_skill_xp(_player_entity.entity_id, "survival", 10.0)
	)
	WorldManager.discovery.location_discovered.connect(func(loc_name, _wx, _wy):
		_notification_ui.show_notification("Discovered: %s!" % loc_name, Color(1.0, 0.9, 0.3))
		WorldManager.player_mgr.gain_xp(50.0)
	)

	WorldManager.npc_event.connect(func(ev_type, desc, id_a, id_b):
		match ev_type:
			"fight":
				_notification_ui.show_notification(desc, Color(1.0, 0.4, 0.4))
				# Show "!" above fighting NPCs
				if id_a >= 0:
					var pos = WorldManager.entity_spawner.get_entity_position(id_a)
					if pos.x >= 0:
						_spawn_floating_text("!", Vector2(pos.x, pos.y - 5), Color(1.0, 0.3, 0.3))
			"chat":
				# Show speech bubble above chatting NPCs
				if id_a >= 0:
					var pos_a = WorldManager.entity_spawner.get_entity_position(id_a)
					if pos_a.x >= 0:
						_spawn_floating_text("...", Vector2(pos_a.x, pos_a.y - 5), Color(1, 1, 1, 0.6))
				if id_b >= 0:
					var pos_b = WorldManager.entity_spawner.get_entity_position(id_b)
					if pos_b.x >= 0:
						_spawn_floating_text("...", Vector2(pos_b.x, pos_b.y - 5), Color(1, 1, 1, 0.6))
			"trade":
				_notification_ui.show_notification(desc, Color(0.8, 0.7, 0.3))
			"bond":
				_notification_ui.show_notification(desc, Color(1.0, 0.7, 0.9))
				if id_a >= 0:
					var pos = WorldManager.entity_spawner.get_entity_position(id_a)
					if pos.x >= 0:
						_spawn_floating_text("♥", Vector2(pos.x, pos.y - 5), Color(1.0, 0.5, 0.7))
	)

	WorldManager.skill_prog.skill_leveled_up.connect(func(eid, skill, lvl):
		if eid == _player_entity.entity_id:
			_notification_ui.show_system_notification("%s leveled up to %d!" % [skill, lvl])
	)
	WorldManager.player_mgr.level_up.connect(func(new_lvl):
		_notification_ui.show_notification("LEVEL UP! You are now level %d!" % new_lvl, Color(1.0, 0.8, 0.0))
	)
	WorldManager.player_mgr.time_critical.connect(func(remaining):
		_notification_ui.show_notification("WARNING: Time running low! %.0f remaining" % remaining, Color.RED)
	)

	# === World Compiler — clean minimal startup (skip heavy loading) ===
	if WorldManager.world_compiler:
		_player_pos = Vector2(128, 128)  # Temporary — updated when first chunk compiles

		# Show loading indicator so player knows the world is generating
		var loading_label = Label.new()
		loading_label.name = "WorldCompilerLoading"
		loading_label.text = "Generating world..."
		loading_label.add_theme_font_size_override("font_size", 24)
		loading_label.add_theme_color_override("font_color", Color(1.0, 0.95, 0.7))
		loading_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		loading_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		loading_label.anchors_preset = Control.PRESET_CENTER
		loading_label.position = Vector2(-100, -20)
		var loading_layer = CanvasLayer.new()
		loading_layer.name = "LoadingLayer"
		loading_layer.layer = 15
		loading_layer.add_child(loading_label)
		add_child(loading_layer)

		# TileMapLayer-based terrain renderer (replaces Image-based DeferredRenderer for tiles)
		_tilemap_terrain_renderer = TileMapTerrainRenderer.new()
		_tilemap_terrain_renderer.setup(self)
		add_child(_tilemap_terrain_renderer)

		# DeferredRenderer kept ONLY for object/decoration sprites
		_deferred_renderer = DeferredRenderer.new()
		_deferred_renderer.setup(self)
		add_child(_deferred_renderer)
		# Wire catalog-driven placement engine into deferred renderer
		if WorldManager.placement_engine and WorldManager.object_catalog:
			_deferred_renderer.set_placement_engine(WorldManager.placement_engine, WorldManager.object_catalog)

		_debug_overlay = DebugOverlay.new()
		_debug_overlay.setup(WorldManager.world_compiler, self)
		add_child(_debug_overlay)

		# Compile all chunks incrementally — one layer per frame
		# Player chunk compiles first (14 frames × ~50ms = ~700ms total, spread across frames)
		# Game is interactive between each layer compilation
		_compile_all_chunks()
		print("[WorldCompiler] Incremental compilation started (1 layer/frame).")
	else:
		# Legacy fallback: load ALL old assets + village generation
		_sprite_loader = SpriteLoader.new()
		_sprite_loader.load_all_species()
		if _player_entity:
			var tex = WorldManager.compositor.composite_entity(_player_entity, "south")
			if tex == null:
				# Use species-mapped sprite dir (hero_knight_v2 for HUMAN)
				var species_dir = SpriteLoader.SPECIES_DIRS.get(_player_entity.species, "hero_knight_v2")
				tex = _sprite_loader.get_rotation(species_dir, "south")
			if tex == null:
				# Final fallback: load player_v2 directly
				var player_dir = "player_v2"
				_sprite_loader.load_character_rotations(player_dir, "res://assets/characters/%s" % player_dir)
				tex = _sprite_loader.get_rotation(player_dir, "south")
			if tex:
				_player_sprite = Sprite2D.new()
				_player_sprite.texture = tex
				_player_sprite.z_index = 15
				var pw = tex.get_width() if tex else 68
				_player_sprite.scale = Vector2(20.0 / pw, 20.0 / pw)
				_player_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
				_player_marker.add_child(_player_sprite)
				_player_marker.color = Color(0, 0, 0, 0)
		_tilemap_renderer = TileMapRenderer.new()
		_tilemap_renderer.setup(self)
		_sprite_struct_renderer = SpriteStructureRenderer.new()
		_sprite_obj_renderer = SpriteObjectRenderer.new()
		_map_obj_renderer = MapObjectRenderer.new()
		_proc_audio = ProceduralAudio.new()
		add_child(_proc_audio)
		WorldManager.threaded_terrain.cell_ready.connect(_on_cell_ready)
		_generate_area(0, 0, 0)
		print("Spawn cell generated.")
		var village_x = 64
		var village_y = 64
		var cell = WorldManager.world.get_cell(0, 0)
		if cell:
			for attempt in range(50):
				var tx = 20 + randi() % 88
				var ty = 20 + randi() % 88
				var h = cell.get_height(tx, ty)
				if h > 0.4 and h < 0.75:
					village_x = tx
					village_y = ty
					break
		_player_pos = Vector2(village_x, village_y)
		var village = WorldManager.village_gen.generate_village(village_x, village_y, "medium")
		print("Legacy village: %d NPCs, %d structures" % [village["population"], village["structures"].size()])
		if _tilemap_renderer:
			_tilemap_renderer.render_paths(WorldManager.village_gen.all_path_tiles)
		if _map_obj_renderer:
			_map_obj_renderer.scatter_decorations(village_x, village_y, 25, self)
		_spawn_npc_markers()
		_spawn_structure_markers()

	_loaded = true
	_game_started = true
	_update_info()

	# Welcome sequence — introduce player to the village
	_notification_ui.show_notification("Welcome to the village.", Color(1.0, 0.95, 0.7))
	get_tree().create_timer(2.0).timeout.connect(func():
		_notification_ui.show_notification("Explore the village. Talk to NPCs with [E]. Check your inventory with [I].", Color(0.8, 0.9, 1.0))
	)
	get_tree().create_timer(5.0).timeout.connect(func():
		var npc_count = WorldManager.entity_spawner._entities.size()
		_notification_ui.show_notification("%d villagers live here. Find the blacksmith, merchant, and guard." % npc_count, Color(0.9, 0.8, 0.6))
	)

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_EXIT_TREE or what == NOTIFICATION_PREDELETE:
		_loaded = false
		_game_started = false

var _frame_count: int = 0

func _process(delta: float) -> void:
	if not _loaded or not _game_started:
		return

	_frame_count += 1

	# Compiler mode: minimal _process — just player movement + camera
	if WorldManager.world_compiler:
		if not _camera:
			return
		var move_dir := Vector2.ZERO
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			move_dir.x -= 1
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			move_dir.x += 1
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			move_dir.y -= 1
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			move_dir.y += 1
		if move_dir != Vector2.ZERO:
			var new_pos = _player_pos + move_dir.normalized() * 3.0 * delta
			# Check walkability across ALL compiled chunks
			var can_move = true
			var tx = int(new_pos.x)
			var ty = int(new_pos.y)
			var ccx = 0
			var ccy = 0
			if tx >= 0:
				ccx = tx / ChunkData.SIZE
			else:
				ccx = (tx - ChunkData.SIZE + 1) / ChunkData.SIZE
			if ty >= 0:
				ccy = ty / ChunkData.SIZE
			else:
				ccy = (ty - ChunkData.SIZE + 1) / ChunkData.SIZE
			var lx = tx - ccx * ChunkData.SIZE
			var ly = ty - ccy * ChunkData.SIZE
			var chunk = WorldManager.world_compiler.get_chunk(ccx, ccy)
			if chunk == null:
				can_move = false
			elif lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
				var w = chunk.get_walkability(lx, ly)
				if w < 0:
					can_move = false
			else:
				can_move = false
			if can_move:
				_player_pos = new_pos
		if _player_marker:
			_player_marker.position = _player_pos * 32
		_camera.position = _player_pos * 32

		# Update player sprite direction and walk animation in compiler mode
		if _player_sprite and _sprite_loader:
			if move_dir != Vector2.ZERO:
				var new_facing = _sprite_loader.get_direction_from_velocity(move_dir)
				_player_facing = new_facing
				_player_is_moving = true
				_player_anim_timer += delta
				if _player_anim_timer >= 0.1:
					_player_anim_timer = 0.0
					_player_anim_frame = (_player_anim_frame + 1) % 8
				var walk_tex = _sprite_loader.get_walk_frame("player_v2", _player_facing, _player_anim_frame)
				if walk_tex == null:
					walk_tex = _sprite_loader.get_rotation("player_v2", _player_facing)
				if walk_tex:
					_player_sprite.texture = walk_tex
			elif _player_is_moving:
				_player_is_moving = false
				_player_anim_frame = 0
				var idle_tex = _sprite_loader.get_rotation("player_v2", _player_facing)
				if idle_tex:
					_player_sprite.texture = idle_tex

		# Tick simulation subsystems so NPCs move, weather changes, events fire
		if _frame_count % 2 == 0:
			WorldManager.entity_spawner.tick(delta)
		_update_npc_positions()

		# StatusBarUI auto-updates via its own _process()
		if _minimap_ui:
			_minimap_ui.update_player_position(int(_player_pos.x), int(_player_pos.y))

		# Roof fade
		if _tilemap_terrain_renderer and _compiled_chunk:
			_tilemap_terrain_renderer.update_roof_fade(_player_pos * 32, _compiled_chunk.structures, 0, 0)

		# Proximity prompt
		_update_proximity_prompt()
		return

	# Don't process game input when UI has focus (dialogue, commands, trade, etc)
	var ui_has_focus := false
	if _dialogue_ui and _dialogue_ui.visible:
		ui_has_focus = true
	if _command_ui and _command_ui.visible:
		ui_has_focus = true
	if _trade_ui and _trade_ui.visible:
		ui_has_focus = true
	if _pause_menu and _pause_menu.visible:
		ui_has_focus = true

	var dir := Vector2.ZERO
	if not ui_has_focus:
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
			dir.y -= 1
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
			dir.y += 1
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
			dir.x -= 1
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
			dir.x += 1

	if dir != Vector2.ZERO:
		var weather_mod = WorldManager.weather.get_movement_modifier()
		var base_move = dir.normalized() * _move_speed * weather_mod * delta
		var target_pos = _player_pos + base_move
		var target_tile = Vector2i(int(floor(target_pos.x)), int(floor(target_pos.y)))
		# Only check walkability if grid has data for this area
		if not WorldManager.walkability.has_data(target_tile.x, target_tile.y):
			# No walkability data yet — move freely
			_player_pos += base_move
		elif WorldManager.walkability.can_move_to(target_tile.x, target_tile.y):
			var terrain_mult = WorldManager.walkability.get_movement_multiplier(target_tile.x, target_tile.y)
			_player_pos += base_move * terrain_mult
		else:
			# Blocked — try sliding along X axis only
			var slide_x = _player_pos + Vector2(base_move.x, 0)
			var slide_x_tile = Vector2i(int(floor(slide_x.x)), int(floor(slide_x.y)))
			if base_move.x != 0.0 and WorldManager.walkability.can_move_to(slide_x_tile.x, slide_x_tile.y):
				_player_pos.x = slide_x.x
			# Try sliding along Y axis only
			var slide_y = _player_pos + Vector2(0, base_move.y)
			var slide_y_tile = Vector2i(int(floor(slide_y.x)), int(floor(slide_y.y)))
			if base_move.y != 0.0 and WorldManager.walkability.can_move_to(slide_y_tile.x, slide_y_tile.y):
				_player_pos.y = slide_y.y

	# Update player sprite — walk animation when moving, static when idle
	if _player_sprite:
		if dir != Vector2.ZERO:
			var new_facing = _sprite_loader.get_direction_from_velocity(dir)
			_player_facing = new_facing
			_player_is_moving = true
			_player_anim_timer += delta
			if _player_anim_timer >= 0.1:  # 10fps animation
				_player_anim_timer = 0.0
				_player_anim_frame = (_player_anim_frame + 1) % 8
			# Try species-specific walk animation, then composable renderer, then fallback
			var sprite_key = SpriteLoader.SPECIES_DIRS.get(_player_entity.species, "hero_knight_v2")
			var walk_tex = _sprite_loader.get_walk_frame(sprite_key, _player_facing, _player_anim_frame)
			if walk_tex == null:
				walk_tex = WorldManager.compositor.composite_entity(_player_entity, _player_facing)
			if walk_tex == null:
				walk_tex = _sprite_loader.get_species_sprite(_player_entity.species, _player_facing)
			if walk_tex:
				_player_sprite.texture = walk_tex
		elif _player_is_moving:
			_player_is_moving = false
			_player_anim_frame = 0
			var idle_tex = WorldManager.compositor.composite_entity(_player_entity, _player_facing)
			if idle_tex == null:
				idle_tex = _sprite_loader.get_species_sprite(_player_entity.species, _player_facing)
			if idle_tex:
				_player_sprite.texture = idle_tex

	# Footstep sounds while moving
	if _player_is_moving and _proc_audio:
		_player_anim_timer += 0.0  # Timer already advancing above
		if _player_anim_frame % 4 == 0:  # Every 4th animation frame
			var wx = int(_player_pos.x)
			var wy = int(_player_pos.y)
			var stack = WorldManager.world.get_stack_at_world_pos(wx, wy)
			if stack and stack.top():
				var gt = stack.top().grain_type
				if gt == GrainTypes.Physical.WATER:
					_proc_audio.play_sound("footstep_water")
				elif gt == GrainTypes.Physical.STONE or gt == GrainTypes.Physical.GRAVEL:
					_proc_audio.play_sound("footstep_stone")
				elif gt == GrainTypes.Physical.SAND:
					_proc_audio.play_sound("footstep_sand")
				elif gt == GrainTypes.Physical.SNOW:
					_proc_audio.play_sound("footstep_snow")
				else:
					_proc_audio.play_sound("footstep_grass")

	# Roof fade for compiled buildings
	if _tilemap_terrain_renderer and _compiled_chunk:
		_tilemap_terrain_renderer.update_roof_fade(_player_pos * 32, _compiled_chunk.structures, 0, 0)
	elif _deferred_renderer and _compiled_chunk:
		_deferred_renderer.update_roof_fade(_player_pos * 32, _compiled_chunk.structures, 0, 0)

	# Show proximity prompt when near an NPC
	_update_proximity_prompt()

	# Check player death
	if _player_entity and _player_entity.base_stats.get("health", 100) <= 0:
		_on_player_death()
		return

	if _player_marker:
		_player_marker.position = _player_pos * 32 - Vector2(1, 1)
	if _camera:
		_camera.position = _player_pos * 32
	_update_npc_positions()
	if _minimap_ui:
		_minimap_ui.update_player_position(int(_player_pos.x), int(_player_pos.y))
	if WorldManager.command_interp:
		WorldManager.command_interp.update_player_position(int(_player_pos.x), int(_player_pos.y))

	# Update day/night ambient
	var mod = get_node_or_null("DayNightMod")
	if mod and mod is CanvasModulate:
		mod.color = WorldManager.day_night.get_ambient_color() * WorldManager.weather.get_ambient_color_modifier()

	# Weather particles
	_weather_particle_timer += delta
	if _weather_particle_timer > 0.05:
		_weather_particle_timer = 0.0
		_spawn_weather_particles()

	# Ambient particles — floating dust motes / pollen / fireflies
	if randf() < 0.03:
		_spawn_ambient_particle()

	# Update world loot sprites
	_loot_update_timer += delta
	if _loot_update_timer > 1.0:
		_loot_update_timer = 0.0
		_update_loot_markers()

	# Time drain warning
	_time_warn_timer += delta
	if _time_warn_timer >= 30.0 and _player_entity:
		_time_warn_timer = 0.0
		var tp = _player_entity.time_pool
		if tp < 5000:
			_notification_ui.show_notification("Your time is running low... (%.0f remaining)" % tp, Color(1.0, 0.3, 0.3))
		elif tp < 15000:
			_notification_ui.show_notification("Time passes... (%.0f remaining)" % tp, Color(0.8, 0.6, 0.3))

	# Ambient NPC speech bubbles — template-based (fast) with occasional LLM (deep)
	if randf() < 0.002:  # ~once every 8 seconds at 60fps
		if randf() < 0.15:  # 15% chance to use LLM for richer speech
			_spawn_llm_ambient_speech()
		else:
			_spawn_ambient_npc_speech()

	_info_timer += delta
	if _info_timer >= 0.5:
		_info_timer = 0.0
		_update_info()

	var cell_x := int(_player_pos.x) / WorldCell.CELL_SIZE
	var cell_y := int(_player_pos.y) / WorldCell.CELL_SIZE
	_generate_area(cell_x, cell_y, 2)

func _input(event: InputEvent) -> void:
	if not _loaded or not _game_started:
		return
	# Don't process hotkeys when typing in a UI
	if _dialogue_ui and _dialogue_ui.visible:
		return
	if _command_ui and _command_ui.visible:
		return
	if _trade_ui and _trade_ui.visible:
		return
	if event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_E:
				_interact_nearest_npc_or_structure()
			KEY_Q:
				_attack_nearest_npc()
			KEY_SPACE:
				var wx := int(_player_pos.x)
				var wy := int(_player_pos.y)
				var result = WorldManager.dig_at(wx, wy, 0.5)
				if result.get("success", false):
					var removed = result.get("removed", {})
					var grain_type = removed.get("grain_type", -1)
					var grain_name = _grain_type_name(grain_type)
					_notification_ui.show_notification("Dug up: %s" % grain_name, Color(0.8, 0.7, 0.4))
					_spawn_floating_text(grain_name, _player_pos, Color(0.8, 0.7, 0.4))
					if _proc_audio: _proc_audio.play_sound("interaction_dig")
					WorldManager.gain_skill_xp(_player_entity.entity_id, "mining", 5.0)
					# Add material to inventory
					var mat_item = {"name": grain_name, "type": "material", "description": "Raw %s material" % grain_name}
					_inventory_ui.add_item(mat_item)
					# Update gather quest progress
					var completed = WorldManager.quest_gen.update_gather_progress(grain_name.to_lower())
					for qid in completed:
						var rewards = WorldManager.quest_gen.complete_quest(qid)
						if rewards.has("coins"):
							WorldManager.player_mgr.add_gold(rewards.get("coins", 0))
						if rewards.has("experience"):
							WorldManager.player_mgr.gain_xp(rewards.get("experience", 0))
						_notification_ui.show_notification("Quest complete! Rewards received.", Color(1.0, 0.9, 0.3))
				else:
					var reason = result.get("reason", "failed")
					if reason == "too_hard":
						_notification_ui.show_notification("Too hard to dig!", Color.RED)
					else:

						_notification_ui.show_notification("Can't dig here", Color.GRAY)
				_refresh_cell_at(wx, wy)
			KEY_F:
				var burn_x := int(_player_pos.x)
				var burn_y := int(_player_pos.y)
				var burn_result = WorldManager.burn_at(burn_x, burn_y, 500.0)
				if burn_result.get("success", false):
					_notification_ui.show_notification("Set fire! Produced: %s" % burn_result.get("produced", "ash"), Color(1.0, 0.5, 0.1))
					_spawn_floating_text("BURN", _player_pos, Color(1.0, 0.4, 0.1))
					WorldManager.gain_skill_xp(_player_entity.entity_id, "survival", 3.0)
				else:
					_notification_ui.show_notification("Not flammable", Color.GRAY)
				_refresh_cell_at(burn_x, burn_y)
			KEY_1:
				_use_ability("power_strike")
			KEY_2:
				_use_ability("fireball")
			KEY_3:
				_use_ability("heal")
			KEY_4:
				_use_ability("ice_bolt")
			KEY_G:
				var grab_x := int(_player_pos.x)
				var grab_y := int(_player_pos.y)
				var grab_items = WorldManager.loot_system.pickup_items_near(grab_x, grab_y, 5)
				if grab_items.is_empty():
					_notification_ui.show_notification("Nothing to pick up", Color.GRAY)
				else:
					for item in grab_items:
						if item.get("type") == "currency":
							var gold_val = item.get("gold_value", 0)
							WorldManager.player_mgr.add_gold(gold_val)
							_spawn_floating_text("+%d gold" % gold_val, _player_pos, Color(1.0, 0.85, 0.2))
						else:
							_inventory_ui.add_item(item)
							_notification_ui.show_loot_notification(item.get("name", "???"))
							_spawn_floating_text("+%s" % item.get("name", "?"), _player_pos, Color(0.3, 0.8, 1.0))
						WorldManager.quest_gen.update_gather_progress(item.get("name", "").to_lower())
			KEY_ESCAPE:
				_pause_menu.visible = !_pause_menu.visible
			KEY_I:
				if _inventory_ui:
					_inventory_ui.visible = !_inventory_ui.visible
			KEY_C:
				if _stats_ui:
					_stats_ui.visible = !_stats_ui.visible
			KEY_K:
				if _crafting_ui:
					_crafting_ui.visible = !_crafting_ui.visible
			KEY_M:
				if _minimap_ui:
					_minimap_ui.visible = !_minimap_ui.visible
			KEY_J:
				if _quest_tracker_ui:
					_quest_tracker_ui.visible = !_quest_tracker_ui.visible
			KEY_R:
				_inspect_at_cursor()
			KEY_T:
				_trade_nearest_npc()
			KEY_H:
				_toggle_help_overlay()
			KEY_V:
				_share_time_with_nearest_npc()
			KEY_SLASH:
				if _command_ui:
					_command_ui.visible = !_command_ui.visible
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_camera.zoom *= 1.2
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_camera.zoom /= 1.2
			if _camera.zoom.x < 0.5:
				_camera.zoom = Vector2(0.5, 0.5)

func _compile_chunk_incremental(chunk_x: int, chunk_y: int) -> void:
	## Compiles a chunk ONE LAYER PER FRAME to avoid blocking the main thread.
	## Each layer takes 10-140ms — short enough to maintain responsiveness.
	var compiler = WorldManager.world_compiler
	var chunk = compiler.create_chunk(chunk_x, chunk_y)
	if compiler.get_chunk(chunk_x, chunk_y) != null:
		return  # Already compiled

	for i in range(compiler.layers.size()):
		compiler.compile_layer(chunk, i)
		await get_tree().process_frame

	compiler.finalize_chunk(chunk)

	# TileMapLayer renderer handles terrain, water, roads, buildings, roofs
	if _tilemap_terrain_renderer:
		_tilemap_terrain_renderer.render_chunk(chunk)

	# DeferredRenderer handles ONLY object sprites (trees, decorations, detail)
	if _deferred_renderer:
		_deferred_renderer.render_objects_only(chunk)

	# First chunk: place player at settlement
	if _compiled_chunk == null:
		_compiled_chunk = chunk
		if chunk.structures.size() > 0:
			var first = chunk.structures[0]
			_player_pos = Vector2(first["pos_x"], first["pos_y"])
			print("[WorldCompiler] Player at settlement (%d, %d)" % [first["pos_x"], first["pos_y"]])

	print("[WorldCompiler] Chunk (%d,%d) ready" % [chunk_x, chunk_y])

func _compile_all_chunks() -> void:
	## Compiles player chunk then neighbors, one layer per frame each.
	var chunks = [
		Vector2i(0, 0),  # Player chunk first
		Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1),
		Vector2i(-1, 0),                    Vector2i(1, 0),
		Vector2i(-1, 1),  Vector2i(0, 1),  Vector2i(1, 1),
	]
	for coords in chunks:
		await _compile_chunk_incremental(coords.x, coords.y)

func _spawn_compiler_npcs() -> void:
	## Spawn NPCs at settlement building locations after world compilation.
	## Prefers TownLayout NPC assignments (with roles and home/work positions).
	## Falls back to structure-based generic spawning if no layout data exists.
	if not _compiled_chunk:
		return
	var spawner = WorldManager.entity_spawner
	if spawner == null:
		return

	# Check for TownLayout NPC assignments stored as chunk metadata
	var town_npcs = _compiled_chunk.get_meta("town_npcs", [])
	if not town_npcs.is_empty():
		_spawn_town_layout_npcs(town_npcs, spawner)
	else:
		_spawn_npcs_at_structures(spawner)
	# Create visual markers for spawned NPCs
	if _sprite_loader == null:
		_sprite_loader = SpriteLoader.new()
	_spawn_npc_markers()
	# Initialize essential UI for compiler mode
	_init_compiler_ui()

func _spawn_town_layout_npcs(town_npcs: Array, spawner) -> void:
	## Spawn NPCs from TownLayout assignments with roles, names, and positions.
	var role_names = {
		"fisherman": ["Aldric", "Brenna", "Cedric", "Dalia"],
		"guard": ["Aldric", "Brenna", "Gareth", "Helena"],
		"blacksmith": ["Cedric", "Kael", "Magnus", "Petra"],
		"innkeeper": ["Dalia", "Fiona", "Johanna", "Rhea"],
		"merchant": ["Eamon", "Nadia", "Orin", "Quinn"],
		"elder": ["Magnus", "Helena", "Soren", "Thalia"],
		"farmer": ["Ivar", "Lyra", "Wren", "Yara"],
		"hunter": ["Gareth", "Brenna", "Kael", "Soren"],
		"scholar": ["Orin", "Thalia", "Quinn", "Nadia"],
		"villager": ["Aldric", "Brenna", "Cedric", "Dalia", "Eamon", "Fiona",
			"Gareth", "Helena", "Ivar", "Johanna", "Kael", "Lyra"],
	}
	var role_counters = {}
	var species_list = [
		EntityBody.Species.HUMAN, EntityBody.Species.HUMAN, EntityBody.Species.HUMAN,
		EntityBody.Species.ELF, EntityBody.Species.DWARF]
	var npc_count = 0
	for npc_def in town_npcs:
		var role = npc_def.get("role", "villager")
		var hx = npc_def.get("home_x", 0)
		var hy = npc_def.get("home_y", 0)
		var wx = npc_def.get("work_x", hx)
		var wy = npc_def.get("work_y", hy)

		# Pick a role-appropriate name: "Guard Aldric", "Blacksmith Cedric"
		var count_for_role = role_counters.get(role, 0)
		role_counters[role] = count_for_role + 1
		var name_pool = role_names.get(role, role_names["villager"])
		var first_name = name_pool[count_for_role % name_pool.size()]
		var role_label = role.capitalize()
		var npc_name = "%s %s" % [role_label, first_name]

		var species = species_list[npc_count % species_list.size()]
		var age = 18.0 + randf() * 40.0
		var npc = spawner.spawn_npc(species, npc_name, hx, hy, age)

		# Store occupation and home/work positions in entity data
		var npc_data = spawner._entities.get(npc.entity_id)
		if npc_data:
			npc_data["occupation"] = role
			npc_data["home_x"] = hx
			npc_data["home_y"] = hy
			npc_data["work_x"] = wx
			npc_data["work_y"] = wy

		# Assign schedule based on role
		if WorldManager.npc_schedules:
			WorldManager.npc_schedules.assign_schedule(npc.entity_id, role)

		# Equip NPCs based on role
		_equip_npc_by_role(npc, role)

		npc_count += 1
	print("[TownLayout] Spawned %d NPCs from layout assignments" % npc_count)

func _equip_npc_by_role(npc: EntityBody, role: String) -> void:
	match role:
		"guard":
			npc.equip("main_hand", {"name": "Iron Sword", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 8}, "durability": 100, "max_durability": 100})
			npc.equip("chest", {"name": "Iron Chestplate", "type": "armor", "slot": "chest", "stat_bonuses": {"defense": 10}, "durability": 150, "max_durability": 150})
		"hunter":
			npc.equip("main_hand", {"name": "Hunting Bow", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 6, "dexterity": 2}, "durability": 80, "max_durability": 80})
			npc.equip("chest", {"name": "Leather Tunic", "type": "armor", "slot": "chest", "stat_bonuses": {"defense": 3, "speed": 1}, "durability": 60, "max_durability": 60})
		"blacksmith":
			npc.equip("main_hand", {"name": "Hammer", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 7, "strength": 3}, "durability": 120, "max_durability": 120})
		"farmer", "fisherman":
			npc.equip("main_hand", {"name": "Pitchfork", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 3}, "durability": 40, "max_durability": 40})
		"merchant":
			npc.equip("chest", {"name": "Fine Robes", "type": "armor", "slot": "chest", "stat_bonuses": {"charisma": 3}, "durability": 50, "max_durability": 50})

func _spawn_npcs_at_structures(spawner) -> void:
	## Fallback: spawn generic NPCs at structure positions when no layout data exists.
	var structures = _compiled_chunk.structures
	if structures.is_empty():
		print("[WorldCompiler] No structures found — skipping NPC spawn")
		return
	var names = ["Aldric", "Brenna", "Cedric", "Dalia", "Eamon", "Fiona",
		"Gareth", "Helena", "Ivar", "Johanna", "Kael", "Lyra", "Magnus",
		"Nadia", "Orin", "Petra", "Quinn", "Rhea", "Soren", "Thalia"]
	var species_list = [
		EntityBody.Species.HUMAN, EntityBody.Species.HUMAN, EntityBody.Species.HUMAN,
		EntityBody.Species.ELF, EntityBody.Species.DWARF]
	var npc_count = 0
	for structure in structures:
		var sx = structure.get("pos_x", 0)
		var sy = structure.get("pos_y", 0)
		var template_id = structure.get("template_id", "house")
		var count = 1
		if template_id in ["tavern", "inn", "market"]:
			count = 3
		elif template_id in ["forge", "temple", "barracks"]:
			count = 2
		for i in range(count):
			var offset_x = randi_range(-2, 2)
			var offset_y = randi_range(-2, 2)
			var npc_name = names[npc_count % names.size()]
			var species = species_list[npc_count % species_list.size()]
			spawner.spawn_npc(species, npc_name, sx + offset_x, sy + offset_y)
			npc_count += 1
	print("[WorldCompiler] Spawned %d NPCs at %d structures" % [npc_count, structures.size()])

func _init_compiler_ui() -> void:
	## Add essential UI panels to compiler mode so the game feels playable.
	var ui_layer = CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)

	_status_bar_ui = preload("res://scripts/ui/StatusBarUI.gd").new()
	if _player_entity:
		_status_bar_ui.set_entity(_player_entity)
	ui_layer.add_child(_status_bar_ui)

	_minimap_ui = preload("res://scripts/ui/MinimapUI.gd").new()
	ui_layer.add_child(_minimap_ui)

	_notification_ui = preload("res://scripts/ui/NotificationUI.gd").new()
	ui_layer.add_child(_notification_ui)

	_inventory_ui = preload("res://scripts/ui/InventoryUI.gd").new()
	_inventory_ui.item_used.connect(_on_item_used)
	ui_layer.add_child(_inventory_ui)

	_dialogue_ui = preload("res://scripts/ui/DialogueUI.gd").new()
	_dialogue_ui.dialogue_submitted.connect(_on_dialogue_submitted)
	ui_layer.add_child(_dialogue_ui)

	_equipment_ui = preload("res://scripts/ui/EquipmentUI.gd").new()
	if _player_entity:
		_equipment_ui.set_entity(_player_entity)
	ui_layer.add_child(_equipment_ui)

	_pause_menu = preload("res://scripts/ui/PauseMenuUI.gd").new()
	_pause_menu.save_requested.connect(func(): _save_game())
	_pause_menu.load_requested.connect(func(): _load_game())
	_pause_menu.quit_requested.connect(func(): get_tree().quit())
	ui_layer.add_child(_pause_menu)

	_proximity_label = Label.new()
	_proximity_label.visible = false
	_proximity_label.z_index = 100
	_proximity_label.add_theme_font_size_override("font_size", 10)
	ui_layer.add_child(_proximity_label)

	# Info label for debug stats
	_info_label = Label.new()
	_info_label.z_index = 100
	_info_label.add_theme_font_size_override("font_size", 12)
	_info_label.position = Vector2(250, 20)
	var info_layer = CanvasLayer.new()
	info_layer.layer = 11
	add_child(info_layer)
	info_layer.add_child(_info_label)

	# Connect LLM dialogue responses so NPC replies appear in the dialogue UI
	WorldManager.dialogue_engine.response_ready.connect(func(npc_id, text):
		if _dialogue_ui and _dialogue_ui.visible:
			var npc = WorldManager.entity_spawner.get_entity(npc_id)
			if npc:
				_dialogue_ui.add_npc_message(npc.name, text)
	)

	_notification_ui.show_notification("World compiled. Explore with WASD.", Color(0.8, 0.9, 1.0))

func _generate_area(center_cx: int, center_cy: int, radius: int) -> void:
	# Request cells async via threaded terrain generator
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			var cx := center_cx + dx
			var cy := center_cy + dy
			var key := Vector2i(cx, cy)
			if _cells_generated.has(key):
				continue
			_cells_generated[key] = true  # Mark as requested
			WorldManager.threaded_terrain.request_cell(cx, cy)

func _on_cell_ready(cx: int, cy: int, img: Image) -> void:
	# Skip entirely when world compiler is active — it handles all rendering
	if WorldManager.world_compiler:
		return
	var key := Vector2i(cx, cy)
	if _cell_sprites.has(key):
		return
	var cell = WorldManager.world.get_cell(cx, cy)
	if cell:
		WorldManager.walkability.populate_from_cell(cell, GrainTypes)
		WorldManager.discovery.record_exploration(cx, cy, cell.biome)
		if _tilemap_renderer:
			_tilemap_renderer.render_cell(cell)
	var tile_size = 32
	var tex = ImageTexture.create_from_image(img)
	var terrain_sprite = Sprite2D.new()
	terrain_sprite.texture = tex
	terrain_sprite.centered = false
	terrain_sprite.position = Vector2(cx * WorldCell.CELL_SIZE * tile_size, cy * WorldCell.CELL_SIZE * tile_size)
	terrain_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	terrain_sprite.z_index = 0
	add_child(terrain_sprite)
	_cell_sprites[key] = true
	# Legacy: Spawn structures using high-quality map object sprites
	var cell_center_x = cx * WorldCell.CELL_SIZE + 64
	var cell_center_y = cy * WorldCell.CELL_SIZE + 64
	if _map_obj_renderer:
		_map_obj_renderer.spawn_structures(WorldManager.structures, cell_center_x, cell_center_y, 80, self)
	elif _sprite_struct_renderer:
		_sprite_struct_renderer.spawn_structures_near(WorldManager.structures, cell_center_x, cell_center_y, 80, self)
	# Stamp structure walkability (collision only, no rendering)
	var walk_img = Image.create(16, 16, false, Image.FORMAT_RGB8)  # Dummy image for walkability API
	WorldManager.struct_renderer.render_structures_on_cell(
		WorldManager.structures, walk_img, cx, cy, WorldManager.walkability)
	# Scatter ground details (grass tufts, flowers) for terrain richness
	if cell and _map_obj_renderer:
		_map_obj_renderer.scatter_ground_details(cx, cy, cell.biome, self)
	# Spawn nature objects using map object sprites
	if cell and WorldManager.world_objects:
		var cell_objects = WorldManager.world_objects.generate_cell_objects(cell)
		for obj in cell_objects:
			if obj["type"] in ["pine_tree", "oak_tree", "rock"]:
				WorldManager.walkability.set_cost(obj["world_x"], obj["world_y"], -1.0)
		if _map_obj_renderer:
			var biome_name = cell.biome if cell else "grassland"
			_map_obj_renderer.spawn_nature(cell_objects, self, key, biome_name)
		elif _sprite_obj_renderer:
			_sprite_obj_renderer.spawn_cell_objects(cell_objects, self, key)
		else:
			_spawn_cell_objects(cell)

func _spawn_cell_objects(cell: WorldCell) -> void:
	var objects = WorldManager.world_objects.generate_cell_objects(cell)
	for obj in objects:
		var obj_type = obj["type"]
		var scale = obj["scale"]
		var wx = obj["world_x"] * 32
		var wy = obj["world_y"] * 32
		# Draw multi-pixel shapes directly onto terrain image would be ideal,
		# but we spawn as node for z-ordering. Use small colored shapes.
		# Per-object color/size variation using position hash
		var obj_hash = ((obj["world_x"] * 2654435761) ^ (obj["world_y"] * 2246822519)) & 0xFFFF
		var hue_var = (obj_hash & 0xFF) / 255.0 * 0.08 - 0.04  # ±4% hue
		var size_var = ((obj_hash >> 8) & 0xFF) / 255.0 * 0.4 + 0.8  # 80-120% size

		match obj_type:
			"pine_tree", "oak_tree":
				var trunk := ColorRect.new()
				var trunk_h = (1.5 + size_var * 0.5)
				trunk.size = Vector2(1, trunk_h)
				trunk.color = Color(0.3 + hue_var, 0.2 + hue_var * 0.5, 0.08, 0.9)
				trunk.position = Vector2(wx, wy)
				trunk.z_index = 2
				add_child(trunk)
				var canopy := ColorRect.new()
				var cs = (4.0 if obj_type == "oak_tree" else 3.0) * scale * size_var
				canopy.size = Vector2(cs, cs * (0.8 + hue_var * 2))
				var base_g = 0.4 if obj_type == "pine_tree" else 0.5
				canopy.color = Color(0.12 + hue_var, base_g + hue_var, 0.08 + hue_var * 0.5, 0.8)
				canopy.position = Vector2(wx - cs / 2 + 0.5, wy - cs + 1)
				canopy.z_index = 3
				add_child(canopy)
			"dead_stump":
				var stump := ColorRect.new()
				stump.size = Vector2(2 * scale * size_var, 1.5 * scale * size_var)
				stump.color = Color(0.38 + hue_var, 0.28 + hue_var, 0.13, 0.7)
				stump.position = Vector2(wx, wy)
				stump.z_index = 2
				add_child(stump)
			"bush":
				var bush := ColorRect.new()
				var bw = 2.5 * scale * size_var
				var bh = 2.0 * scale * size_var
				bush.size = Vector2(bw, bh)
				bush.color = Color(0.13 + hue_var, 0.4 + hue_var, 0.08 + hue_var * 0.5, 0.7)
				bush.position = Vector2(wx - bw * 0.3, wy - bh * 0.2)
				bush.z_index = 2
				add_child(bush)
			"rock":
				var rock := ColorRect.new()
				var rw = 2.0 * scale * size_var
				var rh = 1.5 * scale * size_var
				rock.size = Vector2(rw, rh)
				rock.color = Color(0.48 + hue_var, 0.46 + hue_var, 0.43 + hue_var, 0.7)
				rock.position = Vector2(wx, wy)
				rock.z_index = 2
				add_child(rock)
			"flower_patch":
				var flower := ColorRect.new()
				flower.size = Vector2(1.2 * size_var, 1.2 * size_var)
				var flower_colors = [
					Color(0.9, 0.3, 0.4, 0.7), Color(0.9, 0.8, 0.2, 0.7),
					Color(0.6, 0.3, 0.8, 0.7), Color(1.0, 0.5, 0.2, 0.7),
					Color(0.4, 0.6, 0.9, 0.7), Color(0.9, 0.5, 0.7, 0.7),
				]
				flower.color = flower_colors[obj_hash % flower_colors.size()]
				flower.position = Vector2(wx, wy)
				flower.z_index = 2
				add_child(flower)
			_:
				var misc := ColorRect.new()
				misc.size = Vector2(1.5 * scale * size_var, 1.5 * scale * size_var)
				misc.color = Color(0.28 + hue_var, 0.48 + hue_var, 0.18, 0.5)
				misc.position = Vector2(wx, wy)
				misc.z_index = 2
				add_child(misc)

func _refresh_cell_at(wx: int, wy: int) -> void:
	var cx := wx / WorldCell.CELL_SIZE
	var cy := wy / WorldCell.CELL_SIZE
	var key := Vector2i(cx, cy)
	var img = WorldManager.get_cell_image(cx, cy, 32)
	if img == null:
		return
	# Draw paths and structures onto refreshed image
	WorldManager.struct_renderer.render_paths_on_cell(
		WorldManager.village_gen.all_path_tiles, img, cx, cy, WorldManager.walkability)
	WorldManager.struct_renderer.render_structures_on_cell(
		WorldManager.structures, img, cx, cy, WorldManager.walkability)
	# Cell sprites may be boolean (no overlay) or Sprite2D — skip if not sprite
	if _cell_sprites.has(key) and _cell_sprites[key] is Sprite2D:
		_cell_sprites[key].texture = ImageTexture.create_from_image(img)

func _spawn_npc_markers() -> void:
	_sprite_loader.load_all_species()
	for eid in WorldManager.entity_spawner._entities:
		var data: Dictionary = WorldManager.entity_spawner._entities[eid]
		var body: EntityBody = data["body"]
		# Try composable renderer first (pro body + equipment), then occupation sprite fallback
		var tex: Texture2D = null
		tex = WorldManager.compositor.composite_entity(body, "south")
		if tex == null:
			var occupation = data.get("occupation", "")
			if occupation != "":
				tex = _sprite_loader.get_occupation_sprite(occupation, "south")
		if tex == null:
			tex = _sprite_loader.get_species_sprite(body.species, "south")
		var sprite := Sprite2D.new()
		if tex:
			sprite.texture = tex
		sprite.position = Vector2(data["world_x"] * 32, data["world_y"] * 32)
		sprite.z_index = 5
		# Scale sprites: target ~20 render pixels (40 screen px at zoom 2x)
		if tex and tex.get_width() > 16:
			var target_world_size = 32.0  # render pixels — match player size
			sprite.scale = Vector2(target_world_size / tex.get_width(), target_world_size / tex.get_height())
		else:
			sprite.scale = Vector2(1, 1)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		# Drop shadow for visual depth
		var npc_shadow := Sprite2D.new()
		if tex:
			npc_shadow.texture = tex
		npc_shadow.scale = sprite.scale
		npc_shadow.modulate = Color(0, 0, 0, 0.25)
		npc_shadow.position = Vector2(0.4, 0.7)
		npc_shadow.z_index = -1
		npc_shadow.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.add_child(npc_shadow)
		# Add to y-sorted ObjectContainer so NPCs depth-sort with trees/objects
		var obj_container = _deferred_renderer.get_object_container() if _deferred_renderer else null
		if obj_container:
			sprite.z_index = 0
			obj_container.add_child(sprite)
		else:
			add_child(sprite)
		_npc_markers[eid] = sprite
		# Name label above NPC
		var name_label := Label.new()
		name_label.name = "NameLabel"
		name_label.text = body.name
		# Counter-scale so label is readable regardless of sprite scale
		var inv_scale = 1.0 / sprite.scale.x if sprite.scale.x > 0 else 1.0
		name_label.scale = Vector2(inv_scale * 0.15, inv_scale * 0.15)
		name_label.position = Vector2(-4, -6)
		name_label.z_index = 20
		name_label.add_theme_font_size_override("font_size", 12)
		name_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.8))
		name_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
		name_label.add_theme_constant_override("shadow_offset_x", 1)
		name_label.add_theme_constant_override("shadow_offset_y", 1)
		sprite.add_child(name_label)

func _update_info() -> void:
	if _info_label == null:
		return
	var wx := int(_player_pos.x)
	var wy := int(_player_pos.y)
	var info = WorldManager.get_stack_info(wx, wy)
	var status = WorldManager.get_world_status()
	var ps = WorldManager.player_mgr.get_stat_summary()
	var text = "%s Day %d | %s\n" % [status.get("time", ""), status.get("day", 1), status.get("weather", "")]
	text += "Lv%d XP:%.0f/%.0f Gold:%d\n" % [ps.get("level", 1), ps.get("xp", 0), ps.get("xp_next", 100), ps.get("gold", 0)]
	var hp = ps.get("health", 100)
	var max_hp = ps.get("max_health", 100)
	var time_pool = _player_entity.time_pool if _player_entity else 0
	text += "HP:%.0f/%.0f Time:%.0f\n" % [hp, max_hp, time_pool]
	# Equipped weapon
	if _player_entity:
		var weapon = _player_entity.equipment.get("main_hand")
		if weapon and weapon is Dictionary:
			var dur = weapon.get("durability", 0)
			var max_dur = weapon.get("max_durability", 100)
			text += "Wpn: %s (%.0f%%)\n" % [weapon.get("name", "Fists"), dur / max_dur * 100 if max_dur > 0 else 0]
		else:
			text += "Wpn: Bare fists\n"
	# Biome
	var cell_x = wx / WorldCell.CELL_SIZE
	var cell_y = wy / WorldCell.CELL_SIZE
	var cell = WorldManager.world.get_cell(cell_x, cell_y)
	if cell:
		text += "Biome: %s\n" % cell.biome.capitalize()
	_info_label.text = text

func _spawn_structure_markers() -> void:
	# Add text labels at each structure location
	var nearby = WorldManager.structures.get_structures_near(64, 64, 80)
	for s in nearby:
		var stype = s.get("type", "")
		if stype.is_empty():
			continue
		var label := Label.new()
		label.text = stype.capitalize().replace("_", " ")
		label.position = Vector2(s["world_x"] * 32 - 10, s["world_y"] * 32 - 16)
		label.z_index = 8
		label.add_theme_font_size_override("font_size", 3)
		label.scale = Vector2(0.5, 0.5)  # Counter zoom scaling
		label.add_theme_color_override("font_color", Color(1, 1, 0.8, 0.9))
		label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
		label.add_theme_constant_override("shadow_offset_x", 1)
		label.add_theme_constant_override("shadow_offset_y", 1)
		add_child(label)
		# Add warm point lights to light-emitting structures
		if stype in ["campfire", "forge", "altar"]:
			var light := PointLight2D.new()
			var light_color = Color(1.0, 0.7, 0.3) if stype != "altar" else Color(0.5, 0.3, 0.8)
			light.color = light_color
			light.energy = 0.8
			light.texture = _create_light_texture(64)
			light.texture_scale = 2.5
			light.position = Vector2(s["world_x"] * 32, s["world_y"] * 32)
			light.z_index = 6
			light.blend_mode = Light2D.BLEND_MODE_ADD
			add_child(light)
		elif stype == "house":
			# Dim warm light from windows
			var light := PointLight2D.new()
			light.color = Color(1.0, 0.85, 0.5)
			light.energy = 0.3
			light.texture = _create_light_texture(48)
			light.texture_scale = 1.5
			light.position = Vector2(s["world_x"] * 32 + 16, s["world_y"] * 32 + 12)
			light.z_index = 6
			light.blend_mode = Light2D.BLEND_MODE_ADD
			add_child(light)

func _update_npc_positions() -> void:
	# Advance NPC animation timer
	_npc_anim_timer += get_process_delta_time()
	var advance_frame = false
	if _npc_anim_timer >= 0.12:  # ~8fps NPC animation
		_npc_anim_timer = 0.0
		advance_frame = true

	for eid in _npc_markers:
		var marker = _npc_markers[eid]
		var data = WorldManager.entity_spawner._entities.get(eid)
		if data == null:
			continue
		var pos_x = data.get("world_x", -1)
		var pos_y = data.get("world_y", -1)
		if pos_x >= 0:
			var dx = data.get("move_dir_x", 0)
			var dy = data.get("move_dir_y", 0)
			var is_moving = dx != 0 or dy != 0

			if is_moving:
				var dir_name = _sprite_loader.get_direction_from_velocity(Vector2(dx, dy))
				var occupation = data.get("occupation", "")
				var body: EntityBody = data["body"]
				var sprite_key = SpriteLoader.OCCUPATION_SPRITE_MAP.get(occupation, "")
				if sprite_key == "":
					sprite_key = SpriteLoader.SPECIES_DIRS.get(body.species, "hero_knight_v2")

				# Advance animation frame
				if advance_frame:
					var frame = _npc_anim_frames.get(eid, 0)
					_npc_anim_frames[eid] = (frame + 1) % 8

				# Try walk animation, composable renderer, then static fallback
				var frame = _npc_anim_frames.get(eid, 0)
				var new_tex = _sprite_loader.get_walk_frame(sprite_key, dir_name, frame)
				if new_tex == null:
					new_tex = WorldManager.compositor.composite_entity(body, dir_name)
				if new_tex == null:
					new_tex = _sprite_loader.get_species_sprite(body.species, dir_name)
				if new_tex and marker is Sprite2D:
					marker.texture = new_tex
			else:
				_npc_anim_frames.erase(eid)

			marker.position = Vector2(pos_x * 32, pos_y * 32)
		# Update name label with activity
		var name_lbl = marker.get_node_or_null("NameLabel")
		if name_lbl and WorldManager.npc_goal_system:
			var body: EntityBody = data["body"]
			var activity = WorldManager.npc_goal_system.get_activity_description(eid)
			if activity != "" and activity != "idle" and activity != "standing around":
				name_lbl.text = "%s\n(%s)" % [body.name, activity]
			else:
				name_lbl.text = body.name
		var entity = WorldManager.entity_spawner.get_entity(eid)
		if entity:
			var hp = entity.base_stats.get("health", 100)
			var max_hp = entity.base_stats.get("max_health", 100)
			var hp_bar = marker.get_node_or_null("HPBar")
			if hp < max_hp:
				if hp_bar == null:
					hp_bar = ColorRect.new()
					hp_bar.name = "HPBar"
					hp_bar.size = Vector2(10, 1)
					hp_bar.position = Vector2(-5, -14)
					hp_bar.z_index = 25
					hp_bar.color = Color.RED
					marker.add_child(hp_bar)
					var hp_bg = ColorRect.new()
					hp_bg.name = "HPBg"
					hp_bg.size = Vector2(10, 1)
					hp_bg.position = Vector2(-5, -14)
					hp_bg.z_index = 24
					hp_bg.color = Color(0.2, 0.2, 0.2, 0.7)
					marker.add_child(hp_bg)
				hp_bar.size.x = maxf(0, 10.0 * hp / max_hp)
				hp_bar.color = Color.GREEN if hp > max_hp * 0.5 else (Color.YELLOW if hp > max_hp * 0.25 else Color.RED)
			elif hp_bar:
				hp_bar.queue_free()
				var hp_bg = marker.get_node_or_null("HPBg")
				if hp_bg:
					hp_bg.queue_free()

func _update_loot_markers() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	var nearby_items = WorldManager.loot_system.get_items_near(wx, wy, 30)
	# Track which IDs are still alive
	var alive_ids: Dictionary = {}
	for item_data in nearby_items:
		var iid = item_data.get("id", -1)
		alive_ids[iid] = true
		if _loot_markers.has(iid):
			continue
		# Create marker for new loot
		var marker := Node2D.new()
		marker.position = Vector2(item_data.get("world_x", 0) * 32, item_data.get("world_y", 0) * 32)
		marker.z_index = 4
		# Glowing dot
		var dot := ColorRect.new()
		dot.size = Vector2(2, 2)
		dot.position = Vector2(-1, -1)
		dot.color = Color(0.3, 0.8, 1.0, 0.8)
		marker.add_child(dot)
		# Item name label
		var lbl := Label.new()
		var item = item_data.get("item", {})
		lbl.text = item.get("name", "?")
		lbl.position = Vector2(-6, -8)
		lbl.add_theme_font_size_override("font_size", 4)
		lbl.add_theme_color_override("font_color", Color(0.5, 0.9, 1.0, 0.9))
		lbl.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
		lbl.add_theme_constant_override("shadow_offset_x", 1)
		lbl.add_theme_constant_override("shadow_offset_y", 1)
		marker.add_child(lbl)
		add_child(marker)
		_loot_markers[iid] = marker
	# Remove markers for picked-up items
	var to_remove: Array = []
	for iid in _loot_markers:
		if not alive_ids.has(iid):
			_loot_markers[iid].queue_free()
			to_remove.append(iid)
	for iid in to_remove:
		_loot_markers.erase(iid)

func _update_proximity_prompt() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 8)
	# Remove highlight from previous NPC
	if _highlighted_npc_id >= 0 and _npc_markers.has(_highlighted_npc_id):
		_npc_markers[_highlighted_npc_id].modulate = Color.WHITE
		_highlighted_npc_id = -1
	if not nearby.is_empty():
		var npc = nearby[0]
		var npc_pos = WorldManager.entity_spawner.get_entity_position(npc.entity_id)
		# Highlight nearest NPC with subtle yellow tint
		if _npc_markers.has(npc.entity_id):
			_npc_markers[npc.entity_id].modulate = Color(1.2, 1.2, 0.9)
			_highlighted_npc_id = npc.entity_id
		if _proximity_label == null:
			_proximity_label = Label.new()
			_proximity_label.z_index = 30
			_proximity_label.add_theme_font_size_override("font_size", 3)
			_proximity_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.9))
			_proximity_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
			_proximity_label.add_theme_constant_override("shadow_offset_x", 1)
			_proximity_label.add_theme_constant_override("shadow_offset_y", 1)
			_proximity_label.scale = Vector2(0.3, 0.3)
			add_child(_proximity_label)
		_proximity_label.text = "[E] Talk [Q] Attack [T] Trade [V] Share Time"
		_proximity_label.position = Vector2(npc_pos.x * 32 - 20, npc_pos.y * 32 - 32)
		_proximity_label.visible = true
	else:
		# Check for nearby structures
		var nearby_structs = WorldManager.structures.get_structures_near(wx, wy, 6)
		if not nearby_structs.is_empty():
			var s = nearby_structs[0]
			var stype = s.get("type", "").capitalize().replace("_", " ")
			if _proximity_label == null:
				_proximity_label = Label.new()
				_proximity_label.z_index = 30
				_proximity_label.add_theme_font_size_override("font_size", 3)
				_proximity_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.9))
				_proximity_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
				_proximity_label.add_theme_constant_override("shadow_offset_x", 1)
				_proximity_label.add_theme_constant_override("shadow_offset_y", 1)
				_proximity_label.scale = Vector2(0.3, 0.3)
				add_child(_proximity_label)
			_proximity_label.text = "[E] Use %s" % stype
			_proximity_label.position = Vector2(s["world_x"] * 32 - 12, s["world_y"] * 32 - 24)
			_proximity_label.visible = true
		elif _proximity_label:
			_proximity_label.visible = false

func _interact_nearest_npc_or_structure() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	# Check for NPCs first
	var nearby_npcs = WorldManager.entity_spawner.get_entities_near(wx, wy, 10)
	if not nearby_npcs.is_empty():
		_interact_nearest_npc()
		return
	# No NPCs — check for nearby structures
	var nearby_structs = WorldManager.structures.get_structures_near(wx, wy, 6)
	if nearby_structs.is_empty():
		_notification_ui.show_notification("Nothing to interact with", Color.GRAY)
		return
	var s = nearby_structs[0]
	var stype = s.get("type", "")
	match stype:
		"forge":
			if _crafting_ui:
				_crafting_ui.visible = true
				_notification_ui.show_notification("You approach the forge. [K] to craft.", Color(0.9, 0.5, 0.1))
		"well":
			var hp = _player_entity.base_stats.get("health", 100)
			var max_hp = _player_entity.base_stats.get("max_health", 100)
			if hp < max_hp:
				_player_entity.base_stats["health"] = min(hp + 20, max_hp)
				_notification_ui.show_notification("You drink from the well. +20 HP", Color(0.3, 0.7, 1.0))
				_spawn_floating_text("+20 HP", _player_pos, Color(0.3, 0.8, 1.0))
			else:
				_notification_ui.show_notification("The water is cool and refreshing.", Color(0.5, 0.7, 0.9))
		"market_stall":
			_notification_ui.show_notification("The market stall has wares for trade. [T] near a merchant.", Color(0.8, 0.7, 0.3))
		"campfire":
			_notification_ui.show_notification("The campfire warms you. Stamina recovering faster.", Color(0.9, 0.6, 0.2))
			_player_entity.base_stats["stamina"] = min(_player_entity.base_stats.get("stamina", 100) + 10, 100)
		"altar":
			_notification_ui.show_notification("You feel a divine presence at the altar...", Color(0.6, 0.4, 0.8))
			WorldManager.player_mgr.gain_xp(10.0)
		"watchtower":
			_notification_ui.show_notification("From the watchtower, you survey the surrounding lands.", Color(0.7, 0.7, 0.5))
		"farm_plot":
			_notification_ui.show_notification("Crops grow in the fertile soil. Gather with [SPACE].", Color(0.4, 0.6, 0.2))
		_:
			_notification_ui.show_notification("You examine the %s." % stype.replace("_", " "), Color(0.7, 0.7, 0.7))

func _interact_nearest_npc() -> void:
	var wx := int(_player_pos.x)
	var wy := int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 10)
	if nearby.is_empty():
		if _notification_ui:
			_notification_ui.show_notification("No one nearby", Color.GRAY)
		return
	var npc: EntityBody = nearby[0]
	if _dialogue_ui == null:
		return
	var brain = WorldManager.entity_spawner._npc_brains.get(npc.entity_id)
	var context = ""
	if brain:
		context = brain.generate_dialogue_context(-1) if brain.has_method("generate_dialogue_context") else ""
	# Get NPC occupation from stored data
	var npc_data = WorldManager.entity_spawner._entities.get(npc.entity_id)
	var occupation = "villager"
	if npc_data:
		occupation = npc_data.get("occupation", "villager")

	var npc_species = _species_label(npc.species) if npc else "unknown"
	var intro = "* %s, a %s %s, looks at you *" % [npc.name, npc_species, occupation]
	_dialogue_ui.open_dialogue(npc.name, npc.entity_id, intro)

	# Show NPC stats safely
	var stats = npc.get_computed_stats() if npc.has_method("get_computed_stats") else {}
	var hp = stats.get("health", 100)
	var max_hp = stats.get("max_health", 100)
	var hp_pct = (hp / max_hp * 100) if max_hp > 0 else 100
	_dialogue_ui.add_system_message("(HP:%.0f%% | Age:%.0f | Time:%.0f)" % [
		hp_pct, npc.age, npc.time_pool])

func _attack_nearest_npc() -> void:
	var wx := int(_player_pos.x)
	var wy := int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 10)
	if nearby.is_empty():
		print("No NPCs nearby to attack")
		return
	var target: EntityBody = nearby[0]
	var result = WorldManager.attack_entity(_player_entity, target)
	var damage = result.get("damage", 0)
	var dodged = result.get("dodged", false)
	var blocked = result.get("blocked", false)
	_notification_ui.show_combat_notification("You", target.name, damage)

	# Floating damage number
	var target_pos = WorldManager.entity_spawner.get_entity_position(target.entity_id)
	if dodged:
		_spawn_floating_text("DODGE", Vector2(target_pos.x, target_pos.y), Color.CYAN)
		if _proc_audio: _proc_audio.play_sound("combat_miss")
	elif blocked:
		_spawn_floating_text("BLOCK %.0f" % damage, Vector2(target_pos.x, target_pos.y), Color.ORANGE)
		if _proc_audio: _proc_audio.play_sound("combat_block")
	elif damage > 0:
		var is_crit = result.get("critical", false)
		if is_crit:
			_spawn_floating_text("CRIT %.0f!" % damage, Vector2(target_pos.x, target_pos.y), Color(1.0, 0.8, 0.0))
			_camera_shake(0.2, 3.0)
		else:
			_spawn_floating_text("%.0f" % damage, Vector2(target_pos.x, target_pos.y), Color.RED)
			_camera_shake(0.12, 1.5)
		if _proc_audio: _proc_audio.play_sound("combat_melee_hit")

	# Hit flash on NPC marker
	if _npc_markers.has(target.entity_id) and damage > 0:
		var marker = _npc_markers[target.entity_id]
		marker.modulate = Color.RED
		get_tree().create_timer(0.15).timeout.connect(func():
			if is_instance_valid(marker):
				marker.modulate = Color.WHITE
		)

	# NPC responds to being hit based on personality
	if not result.get("defeated", false) and damage > 0:
		get_tree().create_timer(0.5).timeout.connect(func():
			if not is_instance_valid(target) or not target.is_alive():
				return
			# Decide fight or flee based on NPC state
			var hp_pct = target.base_stats.get("health", 100) / target.base_stats.get("max_health", 100)
			var has_fear = target.mind.get_by_type(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.FEAR).size() > 0

			if hp_pct < 0.25 or has_fear:
				# Low HP or fearful: flee!
				_notification_ui.show_notification("%s is fleeing!" % target.name, Color(0.8, 0.8, 0.3))
				_spawn_floating_text("FLEE!", Vector2(target_pos.x, target_pos.y - 5), Color.YELLOW)
				# Add move away from player
				var data = WorldManager.entity_spawner._entities.get(target.entity_id)
				if data:
					data["move_dir_x"] = sign(data["world_x"] - int(_player_pos.x))
					data["move_dir_y"] = sign(data["world_y"] - int(_player_pos.y))
			else:
				# Fight back!
				var retaliation = WorldManager.combat_system.attack(target, _player_entity)
				var ret_damage = retaliation.get("damage", 0)
				var ret_dodged = retaliation.get("dodged", false)
				if ret_dodged:
					_spawn_floating_text("DODGE", _player_pos, Color.CYAN)
					_notification_ui.show_notification("You dodged %s's attack!" % target.name, Color.CYAN)
				elif ret_damage > 0:
					_spawn_floating_text("%.0f" % ret_damage, _player_pos, Color(1.0, 0.4, 0.4))
					_notification_ui.show_combat_notification(target.name, "You", ret_damage)
					_camera_shake(0.15, 2.0)
					_player_marker.modulate = Color.RED
					get_tree().create_timer(0.15).timeout.connect(func():
						_player_marker.modulate = Color.WHITE
					)
		)

	if result.get("defeated", false):
		var time_gained = result.get("time_gained", 0)
		_notification_ui.show_notification("%s defeated! +%.0f time absorbed" % [target.name, time_gained], Color(1.0, 0.8, 0.0))
		_spawn_floating_text("DEFEATED", Vector2(target_pos.x, target_pos.y - 5), Color.YELLOW)
		if time_gained > 0:
			_spawn_floating_text("+%.0f TIME" % time_gained, _player_pos - Vector2(0, 10), Color(0.3, 0.8, 1.0))
		var loot = result.get("loot", [])
		for item in loot:
			_notification_ui.show_loot_notification(item.get("name", "???"))
		if _npc_markers.has(target.entity_id):
			_npc_markers[target.entity_id].queue_free()
			_npc_markers.erase(target.entity_id)

func _use_ability(ability_name: String) -> void:
	if not WorldManager.ability_sys.has_ability(_player_entity.entity_id, ability_name):
		WorldManager.ability_sys.learn_ability(_player_entity.entity_id, ability_name)
		_notification_ui.show_system_notification("Learned: %s" % ability_name)
		return
	var nearby = WorldManager.entity_spawner.get_entities_near(int(_player_pos.x), int(_player_pos.y), 10)
	var target = nearby[0] if not nearby.is_empty() else null
	var result = WorldManager.ability_sys.use_ability(_player_entity, ability_name, target)
	if result.get("success", false):
		var amount = result.get("amount", 0)
		match result.get("type", ""):
			"damage":
				if target:
					target.base_stats["health"] -= amount
					var target_pos = WorldManager.entity_spawner.get_entity_position(target.entity_id)
					_spawn_floating_text("%.0f" % amount, Vector2(target_pos.x, target_pos.y), Color(0.5, 0.8, 1.0))
					_notification_ui.show_combat_notification("You", target.name, amount)
					WorldManager.gain_skill_xp(_player_entity.entity_id, "combat_magic", 12.0)
					# Hit flash
					if _npc_markers.has(target.entity_id):
						var marker = _npc_markers[target.entity_id]
						marker.modulate = Color(0.3, 0.5, 1.0)
						get_tree().create_timer(0.2).timeout.connect(func():
							if is_instance_valid(marker):
								marker.modulate = Color.WHITE
						)
					if target.base_stats.get("health", 0) <= 0:
						_notification_ui.show_notification("%s defeated by %s!" % [target.name, ability_name], Color.YELLOW)
						if _npc_markers.has(target.entity_id):
							_npc_markers[target.entity_id].queue_free()
							_npc_markers.erase(target.entity_id)
			"heal":
				_player_entity.base_stats["health"] = minf(
					_player_entity.base_stats["health"] + amount,
					_player_entity.base_stats.get("max_health", 100))
				_spawn_floating_text("+%.0f HP" % amount, _player_pos, Color(0.3, 1.0, 0.3))
				_notification_ui.show_notification("Healed %.0f HP" % amount, Color(0.3, 1.0, 0.3))
			"buff":
				_spawn_floating_text("BUFF", _player_pos, Color(1.0, 0.8, 0.0))
				_notification_ui.show_notification("%s activated!" % ability_name, Color(1.0, 0.8, 0.0))
		_notification_ui.show_notification("Used %s!" % ability_name, Color(0.5, 0.8, 1.0))
	else:
		var reason = result.get("reason", "unknown")
		if reason == "on_cooldown":
			_notification_ui.show_notification("%s on cooldown (%.1fs)" % [ability_name, result.get("remaining", 0)], Color.GRAY)
		elif reason == "not_enough_mana":
			_notification_ui.show_notification("Not enough mana for %s" % ability_name, Color(0.3, 0.3, 1.0))
		else:
			_notification_ui.show_system_notification("Cannot use %s: %s" % [ability_name, reason])

func _on_dialogue_submitted(text: String) -> void:
	var npc_id = _dialogue_ui.get_current_npc_id()
	if npc_id < 0:
		return
	var npc = WorldManager.entity_spawner.get_entity(npc_id)
	if npc == null:
		return
	var brain = WorldManager.entity_spawner._npc_brains.get(npc_id)
	if brain:
		var response := WorldManager.dialogue_engine.request_dialogue(npc, brain, text)
		_dialogue_ui.add_npc_message(npc.name, response)

func _on_item_used(item: Dictionary, slot_index: int) -> void:
	var item_type = item.get("type", "misc")
	if item_type == "consumable":
		var result = WorldManager.item_system.use_item(item, _player_entity)
		if result.get("success", false):
			var msg = result.get("message", "Used item")
			_notification_ui.show_notification(msg, Color(0.3, 1.0, 0.5))
			_spawn_floating_text(msg.substr(0, 20), _player_pos, Color(0.3, 1.0, 0.5))
		else:
			_notification_ui.show_notification(result.get("reason", "Can't use"), Color.RED)
	elif item_type in ["weapon", "armor", "accessory"]:
		var slot = item.get("slot", "")
		if not slot.is_empty():
			# Unequip current item in that slot back to inventory
			var old_item = _player_entity.unequip(slot)
			if old_item and old_item is Dictionary and not old_item.is_empty():
				_inventory_ui.add_item(old_item)
			# Equip new item
			_player_entity.equip(slot, item)
			_notification_ui.show_notification("Equipped: %s" % item.get("name", "?"), Color(0.8, 0.8, 0.3))
			_spawn_floating_text("EQUIP", _player_pos, Color(0.8, 0.8, 0.3))
			if _equipment_ui:
				_equipment_ui.refresh()
			# Invalidate composable renderer cache
			WorldManager.compositor.invalidate_cache(_player_entity.entity_id)
		else:
			_notification_ui.show_notification("Can't equip: no slot", Color.RED)

func _on_command_submitted(text: String) -> void:
	var actions = WorldManager.command_interp.parse_command(text)
	if actions.is_empty():
		_command_ui.add_response("I don't understand that command.", Color.YELLOW)
		return
	var desc = WorldManager.command_interp.describe_action_queue(actions)
	_command_ui.add_response("Executing: %s" % desc, Color(0.5, 0.8, 1.0))
	WorldManager.command_interp.execute_command(text)

func _on_trade_completed(item_name: String, price: int, is_buying: bool) -> void:
	if is_buying and item_name != "":
		WorldManager.player_mgr.spend_gold(price)
		_inventory_ui.add_item({"name": item_name, "description": "Purchased item"})
		_notification_ui.show_notification("Bought %s for %dg" % [item_name, price], Color(0.3, 0.8, 0.3))
		WorldManager.gain_skill_xp(_player_entity.entity_id, "trading", 5.0)

func _on_item_crafted(recipe_id: String, recipe: Dictionary) -> void:
	var item_name: String = recipe.get("name", "Unknown")
	# Check if recipe has real material requirements
	var real_recipe = recipe.get("real_recipe")
	if real_recipe and real_recipe is Dictionary:
		var mats = real_recipe.get("materials", {})
		if not mats.is_empty() and not _inventory_ui.has_materials(mats):
			_notification_ui.show_notification("Missing materials for %s!" % item_name, Color.RED)
			return
		# Consume materials
		for mat in mats:
			_inventory_ui.consume_material(mat, mats[mat])
		# Create through item system for proper stats
		var item = WorldManager.item_system.craft(real_recipe, _player_entity)
		_inventory_ui.add_item(item)
		var skill = real_recipe.get("skill", "smithing")
		WorldManager.gain_skill_xp(_player_entity.entity_id, skill, 15.0)
	else:
		_inventory_ui.add_item({"name": item_name, "description": recipe.get("description", "")})
	_notification_ui.show_notification("Crafted: %s" % item_name, Color(0.8, 0.6, 0.2))
	_spawn_floating_text("CRAFTED", _player_pos, Color(0.8, 0.6, 0.2))
	if _proc_audio: _proc_audio.play_sound("interaction_craft")

func _on_experiment_requested() -> void:
	# Collect materials from inventory and experiment
	var materials = _inventory_ui.get_all_materials()
	if materials.size() < 2:
		_notification_ui.show_notification("Need at least 2 materials to experiment!", Color.RED)
		return
	# Use first 2-3 material types
	var mat_items: Array = []
	var count = 0
	for mat in materials:
		mat_items.append({"name": mat})
		count += 1
		if count >= 3:
			break
	var result = WorldManager.item_system.experiment(mat_items, _player_entity)
	if result.get("success", false):
		var item = result["item"]
		# Consume one of each material used
		for mat in mat_items:
			_inventory_ui.consume_material(mat["name"], 1)
		_inventory_ui.add_item(item)
		if result.get("discovered", false):
			_notification_ui.show_notification("NEW DISCOVERY: %s!" % item.get("name", "???"), Color(1.0, 0.9, 0.3))
			_spawn_floating_text("DISCOVERY!", _player_pos, Color(1.0, 0.9, 0.3))
			if _proc_audio: _proc_audio.play_sound("level_up")
		else:
			_notification_ui.show_notification("Created: %s" % item.get("name", "???"), Color(0.7, 0.7, 0.3))
			if _proc_audio: _proc_audio.play_sound("interaction_craft")
	else:
		_notification_ui.show_notification(result.get("reason", "Experiment failed"), Color.RED)

func _spawn_llm_ambient_speech() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 20)
	if nearby.is_empty():
		return
	var npc = nearby[randi() % nearby.size()]
	var pos = WorldManager.entity_spawner.get_entity_position(npc.entity_id)
	if pos.x < 0:
		return
	var npc_data = WorldManager.entity_spawner._entities.get(npc.entity_id, {})
	var activity = "idle"
	if WorldManager.npc_goal_system:
		activity = WorldManager.npc_goal_system.get_activity_description(npc.entity_id)
	var emotion_name = "calm"
	var emotion = npc.mind.get_dominant_emotion()
	if emotion:
		emotion_name = InfoGrainTypes.Emotional.keys()[emotion.info_type].to_lower() if emotion.info_type < InfoGrainTypes.Emotional.size() else "calm"
	var context = {
		"occupation": npc_data.get("occupation", "villager"),
		"activity": activity,
		"emotion": emotion_name,
		"weather": WorldManager.weather.get_weather_name() if WorldManager.weather else "clear",
		"period": WorldManager.day_night.get_period() if WorldManager.day_night else "day",
	}
	var npc_pos = pos  # capture for callback
	WorldManager.dialogue_engine.request_ambient_speech(npc, context, func(text):
		if text != "" and is_instance_valid(self):
			_spawn_floating_text(text, Vector2(npc_pos.x, npc_pos.y - 8), Color(0.9, 0.9, 0.8, 0.8))
	)

func _spawn_ambient_npc_speech() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 25)
	if nearby.is_empty():
		return
	var npc = nearby[randi() % nearby.size()]
	var pos = WorldManager.entity_spawner.get_entity_position(npc.entity_id)
	if pos.x < 0:
		return
	# Generate speech from NPC state — no hardcoded phrases
	var result = _generate_ambient_speech(npc)
	_spawn_floating_text(result["text"], Vector2(pos.x, pos.y - 8), result["color"])

func _generate_ambient_speech(npc: EntityBody) -> Dictionary:
	# Build context from NPC state, then select speech template + fill with NPC-specific details
	var npc_data = WorldManager.entity_spawner._entities.get(npc.entity_id, {})
	var occupation = npc_data.get("occupation", "villager")
	var species_name = EntityBody.Species.keys()[npc.species] if npc.species < EntityBody.Species.size() else "unknown"
	var color = Color(1, 1, 1, 0.6)

	# Gather NPC state signals
	var goal_type = -1
	if WorldManager.npc_goal_system:
		var goal = WorldManager.npc_goal_system.get_active_goal(npc.entity_id)
		if goal:
			goal_type = goal.type

	var emotion_type = -1
	var emotion_intensity = 0.0
	var emotion = npc.mind.get_dominant_emotion()
	if emotion:
		emotion_type = emotion.info_type
		emotion_intensity = emotion.intensity

	var hp = npc.base_stats.get("health", 100)
	var max_hp = npc.base_stats.get("max_health", 100)
	var hp_pct = hp / maxf(max_hp, 1)
	var time_pool = npc.base_stats.get("time_pool", 1000)

	var period = "day"
	if WorldManager.day_night:
		period = WorldManager.day_night.get_period()
	var weather = WorldManager.weather.get_weather_name() if WorldManager.weather else "Clear"

	# Evaluate speech by priority: urgent state > goal > emotion > environment
	# URGENT: health critical
	if hp_pct < 0.2:
		color = Color(1, 0.3, 0.3, 0.9)
		return {"text": _speech_from_template("injured", npc.name, occupation), "color": color}
	if time_pool < 100:
		color = Color(0.8, 0.3, 0.8, 0.9)
		return {"text": _speech_from_template("dying_time", npc.name, occupation), "color": color}

	# GOAL-DRIVEN
	if goal_type == NPCGoalSystem.GoalType.FLEE:
		color = Color(1, 0.4, 0.4, 0.8)
		return {"text": _speech_from_template("fleeing", npc.name, occupation), "color": color}
	if goal_type == NPCGoalSystem.GoalType.ATTACK:
		color = Color(1, 0.3, 0.2, 0.8)
		return {"text": _speech_from_template("combat", npc.name, occupation), "color": color}
	if goal_type == NPCGoalSystem.GoalType.INVESTIGATE:
		color = Color(0.8, 0.8, 0.3, 0.7)
		return {"text": _speech_from_template("investigating", npc.name, occupation), "color": color}
	if goal_type == NPCGoalSystem.GoalType.SEEK_HEALING:
		color = Color(0.4, 0.8, 0.4, 0.8)
		return {"text": _speech_from_template("seeking_healing", npc.name, occupation), "color": color}
	if goal_type == NPCGoalSystem.GoalType.SOCIALIZE:
		return {"text": _speech_from_template("socializing", npc.name, occupation), "color": color}

	# EMOTIONAL — only if intense enough
	if emotion_intensity > 0.5 and emotion_type >= 0:
		var emotion_name = InfoGrainTypes.Emotional.keys()[emotion_type] if emotion_type < InfoGrainTypes.Emotional.size() else "neutral"
		return {"text": _speech_from_template("emotion_" + emotion_name.to_lower(), npc.name, occupation), "color": color}

	# ENVIRONMENTAL — weather, time of day
	if weather != "Clear" and randf() < 0.3:
		return {"text": _speech_from_template("weather_" + weather.to_lower(), npc.name, occupation), "color": color}
	if period == "night":
		return {"text": _speech_from_template("night", npc.name, occupation), "color": Color(0.7, 0.7, 0.9, 0.5)}

	# DEFAULT — occupation-contextual idle
	return {"text": _speech_from_template("idle_" + occupation, npc.name, occupation), "color": color}

## Template-based speech generation. Templates define STRUCTURE, parameters fill CONTENT.
## Each template is a format string. %s slots are filled with NPC-specific data.
## New templates can be added without touching the evaluation logic above.
var _speech_templates: Dictionary = {}
var _templates_initialized: bool = false

func _ensure_speech_templates() -> void:
	if _templates_initialized:
		return
	_templates_initialized = true
	# Template categories — each is an Array of format strings
	# The system picks one at random. %s is replaced with contextual data.
	_speech_templates = {
		"injured": ["*clutching wound*", "*breathing hard*", "I need... help...", "*grimacing*"],
		"dying_time": ["My time... fading...", "So little left...", "*trembling*", "Not yet..."],
		"fleeing": ["*running*", "Not safe!", "*panting*", "Must get away!"],
		"combat": ["*battle cry*", "Stand down!", "For honor!", "*charging*"],
		"investigating": ["*looking around*", "Something happened here...", "What was that?", "*cautious*"],
		"seeking_healing": ["*wincing*", "Need to rest...", "*holding side*", "Just a scratch..."],
		"socializing": ["*waving*", "*nodding*", "*chatting*", "*laughing softly*"],
		"night": ["*yawning*", "Dark out...", "Stars are bright.", "*glancing at shadows*"],
		# Emotions (procedurally keyed as emotion_{name})
		"emotion_joy": ["*humming*", "*smiling*", "♪~", "*cheerful*"],
		"emotion_sadness": ["*sigh*", "*downcast*", "...", "*staring at ground*"],
		"emotion_anger": ["*scowling*", "*clenched fists*", "Tch.", "*glaring*"],
		"emotion_fear": ["*fidgeting*", "*looking around nervously*", "...", "*uneasy*"],
		"emotion_love": ["*blushing*", "*warm smile*", "♥", "*daydreaming*"],
		"emotion_grief": ["*wiping eyes*", "*trembling*", "...", "*hollow stare*"],
		"emotion_pride": ["*standing tall*", "*confident stride*", "*polishing gear*", "*nodding approvingly*"],
		"emotion_loneliness": ["*sitting alone*", "...", "*distant look*", "*quiet sigh*"],
		# Weather reactions
		"weather_rain": ["*pulling cloak tight*", "*squinting at sky*", "*splashing*", "*shivering*"],
		"weather_storm": ["*bracing against wind*", "*shielding eyes*", "Terrible weather!", "*hunched over*"],
		"weather_snow": ["*brushing off snow*", "*breath visible*", "*rubbing hands*", "*trudging*"],
		"weather_fog": ["*peering into mist*", "Can barely see...", "*cautious steps*", "*squinting*"],
		"weather_sandstorm": ["*covering face*", "*coughing*", "*shielding eyes*", "This sand!"],
	}

func _speech_from_template(category: String, npc_name: String, occupation: String) -> String:
	_ensure_speech_templates()
	var templates = _speech_templates.get(category)
	if templates == null:
		# Try occupation-specific idle as final fallback
		templates = _speech_templates.get("idle_" + occupation)
	if templates == null:
		# Generate a generic occupation-contextual idle utterance
		var actions = {
			"blacksmith": ["*hammering*", "*inspecting blade*", "*stoking forge*", "*wiping brow*"],
			"merchant": ["*arranging wares*", "*counting coins*", "*beckoning*", "*appraising*"],
			"guard": ["*scanning perimeter*", "*adjusting armor*", "*standing watch*", "*patrolling*"],
			"farmer": ["*tending soil*", "*checking crops*", "*pulling weeds*", "*wiping hands*"],
			"hunter": ["*scanning treeline*", "*checking traps*", "*sniffing air*", "*crouching*"],
			"scholar": ["*reading intently*", "*taking notes*", "*muttering formula*", "*pondering*"],
			"healer": ["*grinding herbs*", "*mixing potion*", "*checking bandages*", "*sorting bottles*"],
		}
		templates = actions.get(occupation, ["*busy*", "Hmm.", "*working*", "*thinking*"])
	return templates[randi() % templates.size()]

func _get_mood_string(npc: EntityBody) -> String:
	var emotion = npc.mind.get_dominant_emotion()
	if emotion == null:
		return "Calm"
	match emotion.info_type:
		InfoGrainTypes.Emotional.JOY: return "Happy"
		InfoGrainTypes.Emotional.SADNESS: return "Sad"
		InfoGrainTypes.Emotional.ANGER: return "Angry"
		InfoGrainTypes.Emotional.FEAR: return "Afraid"
		InfoGrainTypes.Emotional.CONTENTMENT: return "Content"
		InfoGrainTypes.Emotional.PRIDE: return "Proud"
		InfoGrainTypes.Emotional.LOVE: return "Loving"
		InfoGrainTypes.Emotional.GRIEF: return "Grieving"
		_: return "Complex"

func _grain_type_name(grain_type: int) -> String:
	match grain_type:
		GrainTypes.Physical.STONE: return "Stone"
		GrainTypes.Physical.GRASS: return "Grass"
		GrainTypes.Physical.SOIL: return "Soil"
		GrainTypes.Physical.SAND: return "Sand"
		GrainTypes.Physical.WATER: return "Water"
		GrainTypes.Physical.WOOD: return "Wood"
		GrainTypes.Physical.IRON: return "Iron Ore"
		GrainTypes.Physical.GOLD: return "Gold Nugget"
		GrainTypes.Physical.COAL: return "Coal"
		GrainTypes.Physical.CRYSTAL: return "Crystal"
		GrainTypes.Physical.CLAY: return "Clay"
		GrainTypes.Physical.GRAVEL: return "Gravel"
		GrainTypes.Physical.MOSS: return "Moss"
		GrainTypes.Physical.LEAF: return "Leaf"
		GrainTypes.Physical.BARK: return "Bark"
		GrainTypes.Physical.FLOWER: return "Flower"
		GrainTypes.Physical.MUSHROOM: return "Mushroom"
		GrainTypes.Physical.ICE: return "Ice"
		GrainTypes.Physical.SNOW: return "Snow"
		GrainTypes.Physical.MUD: return "Mud"
		GrainTypes.Physical.COPPER: return "Copper"
		GrainTypes.Physical.SILVER: return "Silver"
		GrainTypes.Physical.MITHRIL: return "Mithril!"
		GrainTypes.Physical.OBSIDIAN: return "Obsidian"
		GrainTypes.Physical.LAVA: return "Lava"
		GrainTypes.Physical.ASH: return "Ash"
		GrainTypes.Physical.VINE: return "Vine"
		GrainTypes.Physical.BONE: return "Bone"
		_: return "Material %d" % grain_type

func _species_label(s: int) -> String:
	match s:
		EntityBody.Species.HUMAN: return "Human"
		EntityBody.Species.ELF: return "Elf"
		EntityBody.Species.DWARF: return "Dwarf"
		EntityBody.Species.ORC: return "Orc"
		EntityBody.Species.GOBLIN: return "Goblin"
		_: return "Unknown"

func _spawn_single_npc_marker(eid: int) -> void:
	var body = WorldManager.entity_spawner.get_entity(eid)
	if body == null:
		return
	var pos = WorldManager.entity_spawner.get_entity_position(eid)
	var tex = WorldManager.compositor.composite_entity(body, "south")
	if tex == null:
		tex = _sprite_loader.get_species_sprite(body.species, "south")
	var sprite := Sprite2D.new()
	if tex:
		sprite.texture = tex
	sprite.position = Vector2(pos.x, pos.y)
	sprite.z_index = 5
	sprite.scale = Vector2(0.15, 0.15) if tex and tex.get_width() > 16 else Vector2(1, 1)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	# Add to y-sorted ObjectContainer so NPCs depth-sort with trees/objects
	var obj_container = _deferred_renderer.get_object_container() if _deferred_renderer else null
	if obj_container:
		sprite.z_index = 0
		obj_container.add_child(sprite)
	else:
		add_child(sprite)
	_npc_markers[eid] = sprite

func _inspect_at_cursor() -> void:
	var wx := int(_player_pos.x)
	var wy := int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 10)
	if not nearby.is_empty():
		_inspect_ui.show_entity_info(nearby[0], Vector2(400, 200))
	else:
		var stack_info = WorldManager.get_stack_info(wx, wy)
		_inspect_ui.show_terrain_info(stack_info, Vector2(400, 200))

func _toggle_help_overlay() -> void:
	if _help_overlay:
		_help_overlay.visible = !_help_overlay.visible
		return
	_help_overlay = Panel.new()
	_help_overlay.size = Vector2(320, 280)
	_help_overlay.position = Vector2(800, 400)
	var lbl := RichTextLabel.new()
	lbl.size = Vector2(300, 260)
	lbl.position = Vector2(10, 10)
	lbl.bbcode_enabled = true
	lbl.text = """[b]Controls[/b]
[color=yellow]WASD[/color] — Move
[color=yellow]E[/color] — Talk to NPC
[color=yellow]Q[/color] — Attack nearest NPC
[color=yellow]G[/color] — Pick up loot
[color=yellow]I[/color] — Inventory
[color=yellow]C[/color] — Character stats
[color=yellow]U[/color] — Equipment slots
[color=yellow]K[/color] — Crafting
[color=yellow]M[/color] — Toggle minimap
[color=yellow]J[/color] — Quest journal
[color=yellow]T[/color] — Trade with NPC
[color=yellow]V[/color] — Share time with NPC (peaceful path)
[color=yellow]R[/color] — Inspect tile/entity
[color=yellow]SPACE[/color] — Dig terrain
[color=yellow]F[/color] — Burn terrain
[color=yellow]/[/color] — Command input (NLP)
[color=yellow]1-8[/color] — Use abilities
[color=yellow]ESC[/color] — Pause menu
[color=yellow]H[/color] — Toggle this help
[color=yellow]Scroll[/color] — Zoom in/out"""
	lbl.add_theme_font_size_override("normal_font_size", 14)
	_help_overlay.add_child(lbl)
	# Add to UI layer
	var ui_layer = get_node_or_null("CanvasLayer")
	if ui_layer:
		ui_layer.add_child(_help_overlay)
	else:
		add_child(_help_overlay)

func _share_time_with_nearest_npc() -> void:
	var wx = int(_player_pos.x)
	var wy = int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 8)
	if nearby.is_empty():
		_notification_ui.show_notification("No one nearby to share time with", Color.GRAY)
		return
	var npc = nearby[0]
	var share_amount = 100.0  # Share 100 time units
	if _player_entity.time_pool < share_amount + 500:
		_notification_ui.show_notification("Not enough time to share (need 600+)", Color.RED)
		return
	# Transfer time at 95% efficiency (sharing is generous)
	var received = share_amount * 0.95
	_player_entity.time_pool -= share_amount
	npc.time_pool += received
	# Build strong bond
	if WorldManager.relationships:
		WorldManager.relationships.record_interaction(_player_entity.entity_id, npc.entity_id, "time_shared")
		WorldManager.relationships.modify_strength(_player_entity.entity_id, npc.entity_id, 0.15)
	# Record as moral good deed
	if WorldManager.morality:
		WorldManager.morality.record_action(_player_entity.entity_id, "share_time", npc.entity_id)
	# Visual feedback
	_notification_ui.show_notification("Shared %.0f time with %s (+%.0f received)" % [share_amount, npc.name, received], Color(0.5, 1.0, 0.8))
	_spawn_floating_text("-%.0f" % share_amount, _player_pos, Color(0.8, 0.4, 0.4))
	var npc_pos = WorldManager.entity_spawner.get_entity_position(npc.entity_id)
	if npc_pos.x >= 0:
		_spawn_floating_text("+%.0f" % received, Vector2(npc_pos.x, npc_pos.y), Color(0.3, 1.0, 0.5))
		_spawn_floating_text("♥", Vector2(npc_pos.x, npc_pos.y - 5), Color(1.0, 0.5, 0.7))
	# NPC remembers the kindness
	var gratitude = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.BOND)
	gratitude.intensity = 0.4
	gratitude.target_entity_id = _player_entity.entity_id
	gratitude.salience = 0.7
	gratitude.decay_rate = 0.002
	npc.mind.add(gratitude)
	# Karma boost
	WorldManager.player_mgr.gain_xp(20.0)
	WorldManager.gain_skill_xp(_player_entity.entity_id, "social", 15.0)
	# Record in world history
	WorldManager.world_history.record_live_event(
		"%s shared time with %s" % [_player_entity.name, npc.name],
		[WorldHistory.Dimension.SOCIAL, WorldHistory.Dimension.SPIRITUAL]
	)

func _trade_nearest_npc() -> void:
	var wx := int(_player_pos.x)
	var wy := int(_player_pos.y)
	var nearby = WorldManager.entity_spawner.get_entities_near(wx, wy, 10)
	if nearby.is_empty():
		_notification_ui.show_system_notification("No NPCs nearby to trade with")
		return
	var npc: EntityBody = nearby[0]
	var npc_items = WorldManager.economy.get_merchant_inventory(npc.entity_id)
	_trade_ui.open_trade(npc.name, npc_items, WorldManager.player_mgr.gold)
	_notification_ui.show_system_notification("Trading with %s" % npc.name)

func _save_game() -> void:
	var ok := WorldManager.save_game("manual_save")
	# Also save player state
	var player_data := {
		"pos_x": _player_pos.x,
		"pos_y": _player_pos.y,
		"name": _player_entity.name if _player_entity else "Player",
		"species": _player_entity.species if _player_entity else 0,
		"level": WorldManager.player_mgr.level,
		"gold": WorldManager.player_mgr.gold,
		"xp": WorldManager.player_mgr.experience,
	}
	var save_path = "user://player_save.json"
	var file = FileAccess.open(save_path, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(player_data))
		file.close()
	if ok:
		_notification_ui.show_system_notification("World saved!")
	else:
		_notification_ui.show_system_notification("Save failed!")

func _load_game() -> void:
	var ok := WorldManager.load_game("manual_save")
	# Load player state
	var save_path = "user://player_save.json"
	if FileAccess.file_exists(save_path):
		var file = FileAccess.open(save_path, FileAccess.READ)
		if file:
			var json = JSON.parse_string(file.get_as_text())
			file.close()
			if json and json is Dictionary:
				_player_pos = Vector2(json.get("pos_x", 64), json.get("pos_y", 64))
				WorldManager.player_mgr.level = json.get("level", 1)
				WorldManager.player_mgr.gold = json.get("gold", 100)
				WorldManager.player_mgr.experience = json.get("xp", 0)
	if ok:
		_notification_ui.show_system_notification("World loaded!")
		_reload_cell_sprites()
	else:
		_notification_ui.show_system_notification("No save found!")

func _spawn_ambient_particle() -> void:
	if _camera == null:
		return
	var cam_pos = _camera.position
	var particle := ColorRect.new()
	particle.z_index = 25
	var is_night = WorldManager.day_night and WorldManager.day_night.get_period() == "night"
	if is_night:
		# Fireflies — small yellow-green glowing dots
		particle.size = Vector2(1.5, 1.5)
		particle.color = Color(0.7, 1.0, 0.3, 0.7)
	else:
		# Pollen / dust motes — tiny white-gold specs
		particle.size = Vector2(1, 1)
		particle.color = Color(1.0, 0.95, 0.7, 0.3)
	var spawn_x = cam_pos.x + randf_range(-150, 150)
	var spawn_y = cam_pos.y + randf_range(-100, 100)
	particle.position = Vector2(spawn_x, spawn_y)
	add_child(particle)
	var tween = create_tween()
	var drift_x = spawn_x + randf_range(-30, 30)
	var drift_y = spawn_y + randf_range(-20, -40)  # Float upward
	var duration = randf_range(2.0, 5.0)
	tween.tween_property(particle, "position", Vector2(drift_x, drift_y), duration)
	if is_night:
		# Fireflies pulse
		tween.parallel().tween_property(particle, "modulate:a", 0.1, duration * 0.3)
		tween.tween_property(particle, "modulate:a", 0.8, duration * 0.2)
		tween.tween_property(particle, "modulate:a", 0.0, duration * 0.5)
	else:
		tween.parallel().tween_property(particle, "modulate:a", 0.0, duration)
	tween.tween_callback(particle.queue_free)

func _create_light_texture(size: int) -> ImageTexture:
	var img = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center = size / 2.0
	for y in range(size):
		for x in range(size):
			var dist = Vector2(x - center, y - center).length() / center
			var alpha = clampf(1.0 - dist * dist, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, alpha))
	return ImageTexture.create_from_image(img)

func _camera_shake(duration: float, intensity: float) -> void:
	if _camera == null:
		return
	var original_offset = _camera.offset
	var tween = create_tween()
	var steps = int(duration / 0.03)
	for i in range(steps):
		var offset = Vector2(randf_range(-intensity, intensity), randf_range(-intensity, intensity))
		tween.tween_property(_camera, "offset", offset, 0.03)
	tween.tween_property(_camera, "offset", original_offset, 0.03)

func _spawn_floating_text(text: String, world_pos: Vector2, color: Color) -> void:
	var render_pos = world_pos * 32  # Scale to render space
	var label := Label.new()
	label.text = text
	label.position = render_pos - Vector2(20, 20)
	label.z_index = 50
	label.add_theme_font_size_override("font_size", 10)
	label.add_theme_color_override("font_color", color)
	add_child(label)
	var tween := create_tween()
	tween.tween_property(label, "position:y", render_pos.y - 40, 0.8)
	tween.parallel().tween_property(label, "modulate:a", 0.0, 0.8)
	tween.tween_callback(label.queue_free)

func _spawn_weather_particles() -> void:
	var weather_name = WorldManager.weather.get_weather_name()
	if weather_name == "Clear" or weather_name == "Cloudy":
		return
	# Spawn a particle near the camera view
	var particle := ColorRect.new()
	particle.z_index = 30
	var cam_pos = _camera.position
	var spawn_x = cam_pos.x + randf_range(-100, 100)
	var spawn_y = cam_pos.y - 60
	particle.position = Vector2(spawn_x, spawn_y)
	match weather_name:
		"Rain":
			particle.size = Vector2(1, 3)
			particle.color = Color(0.5, 0.6, 0.8, 0.4)
		"Storm":
			particle.size = Vector2(1, 4)
			particle.color = Color(0.4, 0.5, 0.7, 0.5)
		"Snow":
			particle.size = Vector2(2, 2)
			particle.color = Color(0.9, 0.9, 0.95, 0.6)
		"Fog":
			particle.size = Vector2(4, 2)
			particle.color = Color(0.8, 0.8, 0.8, 0.15)
		"Sandstorm":
			particle.size = Vector2(2, 1)
			particle.color = Color(0.7, 0.6, 0.3, 0.4)
		_:
			particle.queue_free()
			return
	add_child(particle)
	var tween = create_tween()
	var end_y = spawn_y + 120
	if weather_name == "Snow":
		end_y = spawn_y + 80
		tween.tween_property(particle, "position", Vector2(spawn_x + randf_range(-20, 20), end_y), 2.0)
	else:
		tween.tween_property(particle, "position:y", end_y, 0.6)
	tween.parallel().tween_property(particle, "modulate:a", 0.0, 0.5).set_delay(0.3)
	tween.tween_callback(particle.queue_free)

func _on_player_death() -> void:
	var result = WorldManager.death_respawn.process_death(
		_player_entity, "combat", int(_player_pos.x), int(_player_pos.y))
	_notification_ui.show_notification("YOU DIED! Lost %.0f time. Respawning..." % result.get("time_lost", 0), Color.RED)
	_camera_shake(0.4, 4.0)
	# Respawn at village center
	_player_pos = Vector2(result.get("respawn_x", 64), result.get("respawn_y", 64))
	_player_marker.position = _player_pos * 32 - Vector2(1, 1)
	_camera.position = _player_pos * 32
	# Screen flash
	_player_marker.modulate = Color.RED
	get_tree().create_timer(1.0).timeout.connect(func():
		_player_marker.modulate = Color.WHITE
	)

func _reload_cell_sprites() -> void:
	for key in _cell_sprites:
		_cell_sprites[key].queue_free()
	_cell_sprites.clear()
	_cells_generated.clear()
	_generate_area(int(_player_pos.x) / WorldCell.CELL_SIZE, int(_player_pos.y) / WorldCell.CELL_SIZE, 1)
