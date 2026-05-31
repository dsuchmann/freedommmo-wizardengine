extends Node

signal npc_event(event_type: String, description: String, world_x: int, world_y: int)

var grain_registry: GrainRegistry
var world: WorldGraph
var terrain_gen: TerrainGenerator
var feature_placer: FeaturePlacement
var material_reg: MaterialRegistry
var sim_engine: SimEngine
var time_sys: TimeSystem
var causal: CausalTracker
var tile_renderer: TileRenderer
var asset_pipeline: AssetPipeline
var event_framework: EventFramework
var entity_spawner: EntitySpawner
var dialogue_engine: DialogueEngine
var combat_system: CombatSystem
var day_night: DayNightCycle
var loot_system: LootSystem
var weather: WeatherSystem
var tileset_mgr: TilesetManager
var sound_mgr: SoundManager
var faction_sys: FactionSystem
var world_events: WorldEvents
var ability_sys: AbilitySystem
var god_sys: GodSystem
var morality: MoralitySystem
var economy: EconomySystem
var relationships: RelationshipSystem
var npc_schedules: NPCSchedule
var structures: StructureSystem
var village_gen: VillageGenerator
var entity_lifecycle: EntityLifecycle
var pathfinding: Pathfinding
var npc_behavior: NPCBehavior
var npc_goal_system: NPCGoalSystem
var npc_interactions: NPCInteractions
var population_sim: PopulationSim
var death_respawn: DeathRespawn
var quest_gen: QuestGenerator
var skill_prog: SkillProgression
var discovery: DiscoverySystem
var status_fx: StatusEffects
var dungeon_gen: DungeonGenerator
var world_persist: WorldPersistence
var world_objects: WorldObjectSpawner
var world_map: WorldMap
var particles: ParticleEffects
var player_mgr: PlayerManager
var threaded_terrain: ThreadedTerrain
var command_interp: CommandInterpreter
var compositor: ComposableRenderer
var world_history: WorldHistory
var item_system: ItemSystem
var walkability: WalkabilityGrid
var struct_renderer: StructureRenderer
var world_compiler: WorldCompiler = null
var town_layout_compiler: TownLayoutCompiler = null
var object_catalog: ObjectCatalog
var interaction_registry: InteractionRegistry
var biome_affinity_loader: BiomeAffinityLoader
var placement_engine: PlacementEngine
var delta_persistence: DeltaPersistence
var animation_resolver: AnimationResolver

var _initialized: bool = false
var _sim_mutex := Mutex.new()
var _sim_accumulator: float = 0.0
var _sim_delta: float = 0.1  # 10hz sim tick
var _pending_npc_events: Array = []
var _sim_running: bool = false
var _shutting_down: bool = false

func _ready() -> void:
	_init_systems()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE or what == NOTIFICATION_EXIT_TREE:
		_shutting_down = true
		if threaded_terrain:
			threaded_terrain.shutdown()

func _exit_tree() -> void:
	_shutting_down = true

func _init_systems() -> void:
	grain_registry = GrainRegistry.new()
	grain_registry.load_templates("res://data/grains/physical_grains.json")

	world = WorldGraph.new()
	terrain_gen = TerrainGenerator.new(grain_registry, ServerConfig.get_world_seed())
	feature_placer = FeaturePlacement.new(grain_registry)
	material_reg = MaterialRegistry.new(grain_registry)
	sim_engine = SimEngine.new(world, material_reg)
	time_sys = TimeSystem.new()
	causal = CausalTracker.new()
	tile_renderer = TileRenderer.new()
	asset_pipeline = AssetPipeline.new()
	event_framework = EventFramework.new()
	entity_spawner = EntitySpawner.new(causal, time_sys)
	dialogue_engine = DialogueEngine.new(causal)
	combat_system = CombatSystem.new(causal, time_sys)
	day_night = DayNightCycle.new()
	loot_system = LootSystem.new()
	weather = WeatherSystem.new()
	tileset_mgr = TilesetManager.new()
	sound_mgr = SoundManager.new()
	faction_sys = FactionSystem.new()
	world_events = WorldEvents.new(event_framework)
	world_events.entity_spawner = entity_spawner
	ability_sys = AbilitySystem.new()
	god_sys = GodSystem.new()
	morality = MoralitySystem.new(causal)
	economy = EconomySystem.new()
	relationships = RelationshipSystem.new()
	npc_schedules = NPCSchedule.new()
	structures = StructureSystem.new()
	village_gen = VillageGenerator.new(structures, entity_spawner, faction_sys, npc_schedules, relationships)
	entity_lifecycle = EntityLifecycle.new(time_sys)
	pathfinding = Pathfinding.new()
	npc_behavior = NPCBehavior.new(entity_spawner, npc_schedules, pathfinding, world, day_night)
	npc_goal_system = NPCGoalSystem.new(entity_spawner, npc_schedules, day_night, structures, relationships)
	npc_behavior.goal_system = npc_goal_system
	npc_interactions = NPCInteractions.new(entity_spawner, relationships, dialogue_engine, combat_system, causal, faction_sys)
	population_sim = PopulationSim.new(entity_spawner, relationships, time_sys)
	death_respawn = DeathRespawn.new()
	quest_gen = QuestGenerator.new()
	skill_prog = SkillProgression.new()
	discovery = DiscoverySystem.new()
	status_fx = StatusEffects.new()
	dungeon_gen = DungeonGenerator.new(grain_registry)
	world_objects = WorldObjectSpawner.new()
	world_persist = WorldPersistence.new()
	world_map = WorldMap.new()
	particles = ParticleEffects.new()

	player_mgr = PlayerManager.new(skill_prog, discovery, entity_lifecycle, status_fx)

	threaded_terrain = ThreadedTerrain.new()
	threaded_terrain.setup(terrain_gen, feature_placer, world, tile_renderer, grain_registry)
	add_child(threaded_terrain)

	command_interp = CommandInterpreter.new()
	command_interp.set_world_manager(self)
	compositor = ComposableRenderer.new()
	world_history = WorldHistory.new()
	world_history.bootstrap_world_history()
	item_system = ItemSystem.new()
	walkability = WalkabilityGrid.new()
	struct_renderer = StructureRenderer.new()

	# Late-bind dialogue engine dependencies
	# Late-bind cross-system dependencies
	combat_system.status_effects = status_fx
	combat_system.relationships = relationships
	combat_system.weather = weather
	population_sim.entity_lifecycle = entity_lifecycle
	population_sim.loot_system = loot_system
	population_sim.causal_tracker = causal
	dialogue_engine.relationships = relationships
	dialogue_engine.world_history = world_history
	dialogue_engine.morality = morality
	dialogue_engine.llm_client.set_http_node(self)
	pathfinding.walkability_grid = walkability

	# World Compiler — layered deterministic world generation
	world_compiler = WorldCompiler.new(ServerConfig.get_world_seed())
	world_compiler.register_layer(ElevationLayer.new())
	world_compiler.register_layer(OceanMaskLayer.new())
	world_compiler.register_layer(DrainageLayer.new())
	world_compiler.register_layer(RiversLakesLayer.new())
	world_compiler.register_layer(ClimateLayer.new())
	world_compiler.register_layer(BiomeLayer.new())
	world_compiler.register_layer(SoilFertilityLayer.new())
	world_compiler.register_layer(VegetationLayer.new())
	world_compiler.register_layer(CoastalLayer.new())
	world_compiler.register_layer(RoadsLayer.new())
	var _settlements_layer = SettlementsLayer.new()
	town_layout_compiler = TownLayoutCompiler.new(_settlements_layer._building_compiler)
	_settlements_layer.town_layout_compiler = town_layout_compiler
	world_compiler.register_layer(_settlements_layer)
	world_compiler.register_layer(FarmsLayer.new())
	world_compiler.register_layer(POIsLayer.new())
	world_compiler.register_layer(EventsLayer.new())

	# Terrain object systems — catalog-driven placement pipeline
	object_catalog = ObjectCatalog.new()
	interaction_registry = InteractionRegistry.new()
	biome_affinity_loader = BiomeAffinityLoader.new()
	placement_engine = PlacementEngine.new(object_catalog, biome_affinity_loader, ServerConfig.get_world_seed())
	delta_persistence = DeltaPersistence.new()
	animation_resolver = AnimationResolver.new(interaction_registry, object_catalog)

	_connect_lifecycle_signals()
	_initialized = true
	print("WorldManager: %d systems initialized" % 48)

var _wm_frame_count: int = 0

func _process(delta: float) -> void:
	if not _initialized or _shutting_down:
		return

	# Skip heavy sim when world compiler handles everything
	if world_compiler:
		day_night.tick(delta)
		weather.tick(delta)
		return

	day_night.tick(delta)
	weather.tick(delta)
	time_sys.tick(delta)
	ability_sys.tick_cooldowns(delta)
	player_mgr.tick(delta)
	command_interp.tick(delta)
	event_framework.tick(delta)
	world_events.tick(delta)

	_sim_accumulator += delta
	if _sim_accumulator >= _sim_delta and not _shutting_down:
		var sim_dt = _sim_accumulator
		_sim_accumulator = 0.0
		_main_thread_sim_tick(sim_dt)

func _main_thread_sim_tick(dt: float) -> void:
	sim_engine.tick(dt)
	entity_spawner.tick(dt)
	economy.tick(dt)
	npc_behavior.tick(dt)
	var npc_events = npc_interactions.tick(dt)
	# Process NPC events immediately (we're on main thread)
	for ev in npc_events:
		var ev_type = ev.get("type", "")
		var id_a = ev.get("a_id", -1)
		var id_b = ev.get("b_id", -1)
		if ev_type == "fight":
			var desc = "%s attacked %s" % [ev.get("attacker", "?"), ev.get("defender", "?")]
			world_history.record_live_event(desc, [WorldHistory.Dimension.MILITARY])
			npc_event.emit("fight", desc, id_a, id_b)
		elif ev_type == "chat":
			var desc = "%s chatted with %s" % [ev.get("a", "?"), ev.get("b", "?")]
			npc_event.emit("chat", desc, id_a, id_b)
		elif ev_type == "trade":
			var desc = "%s traded with %s" % [ev.get("a", "?"), ev.get("b", "?")]
			npc_event.emit("trade", desc, 0, 0)
		elif ev_type == "bond":
			var desc = "%s and %s grew closer" % [ev.get("a", "?"), ev.get("b", "?")]
			npc_event.emit("bond", desc, 0, 0)
	population_sim.tick(dt)
	quest_gen.tick(dt)
	var eids = entity_spawner.get_entity_ids()
	for eid in eids:
		status_fx.tick(eid, dt)

func load_area(center_cell_x: int, center_cell_y: int, radius: int = 1) -> void:
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			var cx := center_cell_x + dx
			var cy := center_cell_y + dy
			if not world.has_cell(cx, cy):
				var cell := terrain_gen.generate_cell(cx, cy)
				feature_placer.place_features(cell)
				world.cells[world._cell_key(cx, cy)] = cell
				walkability.populate_from_cell(cell, GrainTypes)
	asset_pipeline.predict_needed_assets(world, center_cell_x, center_cell_y, radius)
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			var cx := center_cell_x + dx
			var cy := center_cell_y + dy
			var cell = world.get_cell(cx, cy)
			if cell:
				discovery.record_exploration(cx, cy, cell.biome)

func get_cell_image(cell_x: int, cell_y: int, tile_size: int = 2) -> Image:
	var cell = world.get_cell(cell_x, cell_y)
	if cell == null:
		return null
	return tile_renderer.render_cell_to_image(cell, tile_size)

func dig_at(world_x: int, world_y: int, strength: float) -> Dictionary:
	# Mining skill increases dig strength
	var mining_level = skill_prog.get_skill_level(0, "mining")
	var boosted_strength = strength + mining_level * 0.1  # +0.1 per mining level
	var result := sim_engine.process_dig(world_x, world_y, boosted_strength)
	if result["success"]:
		causal.record_event(-1, -1, "dig", {"world_x": world_x, "world_y": world_y})
		sound_mgr.play_interaction_sound("dig")
		skill_prog.add_experience(0, "mining", 5.0)
	return result

func burn_at(world_x: int, world_y: int, heat: float) -> Dictionary:
	var result := sim_engine.process_burn(world_x, world_y, heat)
	if result["success"]:
		causal.record_event(-1, -1, "burn", {"world_x": world_x, "world_y": world_y})
		sound_mgr.play_interaction_sound("burn")
	return result

func attack_entity(attacker: EntityBody, defender: EntityBody) -> Dictionary:
	var result = combat_system.attack(attacker, defender)
	sound_mgr.play_combat_sound("melee")
	relationships.record_interaction(attacker.entity_id, defender.entity_id, "attacked")
	morality.record_action(attacker.entity_id, "attack_innocent", defender.entity_id)
	skill_prog.add_experience(attacker.entity_id, "combat_melee", 10.0)
	if attacker.entity_id == 0:
		player_mgr.gain_xp(15.0)
	if result.get("defeated", false):
		var loot = loot_system.generate_loot(defender)
		var pos = entity_spawner.get_entity_position(defender.entity_id)
		loot_system.drop_items_at(loot, pos.x, pos.y)
		result["loot"] = loot
		_on_entity_death(defender.entity_id, "combat")
		# Update quest kill progress
		var species_name = _species_name_for_quest(defender.species)
		var completed = quest_gen.update_kill_progress(species_name)
		for qid in completed:
			var rewards = quest_gen.complete_quest(qid)
			if rewards.has("coins"):
				player_mgr.add_gold(rewards["coins"])
			if rewards.has("experience"):
				player_mgr.gain_xp(rewards["experience"])
		result["quests_completed"] = completed
		# Record in world history
		world_history.record_live_event(
			"%s was slain by %s" % [defender.name, attacker.name],
			[WorldHistory.Dimension.MILITARY, WorldHistory.Dimension.SOCIAL, WorldHistory.Dimension.CRIMINAL]
		)
		# Witnesses: nearby NPCs see the kill and react
		var kill_pos = entity_spawner.get_entity_position(defender.entity_id)
		var witnesses = entity_spawner.get_entities_near(kill_pos.x, kill_pos.y, 20)
		for witness in witnesses:
			if witness.entity_id == attacker.entity_id or witness.entity_id == defender.entity_id:
				continue
			# Witness gains fear of the killer
			var fear = InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.FEAR)
			fear.intensity = 0.6
			fear.target_entity_id = attacker.entity_id
			fear.salience = 0.8
			witness.mind.add(fear)
			# If they had a bond with the victim, gain grudge against killer
			if witness.mind.has_bond_with(defender.entity_id):
				var grudge = InfoGrain.new(InfoGrainTypes.Category.RELATIONAL, InfoGrainTypes.Relational.GRUDGE)
				grudge.intensity = 0.8
				grudge.target_entity_id = attacker.entity_id
				grudge.salience = 0.9
				grudge.decay_rate = 0.001
				witness.mind.add(grudge)
			# Memory of witnessing the kill
			var memory = InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.MEMORY)
			memory.intensity = 0.9
			memory.context = {"type": "witnessed_kill", "killer": attacker.name if attacker else "?", "victim": defender.name}
			memory.decay_rate = 0.002
			witness.mind.add(memory)
			# Observational grain for goal system investigation
			var obs = InfoGrain.new(InfoGrainTypes.Category.OBSERVATIONAL, InfoGrainTypes.Observational.WITNESSED)
			obs.intensity = 0.9
			obs.salience = 0.9
			obs.context = {"type": "kill", "world_x": kill_pos.x, "world_y": kill_pos.y, "killer": attacker.name if attacker else "?"}
			if day_night:
				obs.created_at = day_night.get_total_time()
			obs.decay_rate = 0.005
			witness.mind.add(obs)
	return result

func talk_to_npc(npc: EntityBody, player_message: String) -> String:
	var brain = entity_spawner._npc_brains.get(npc.entity_id)
	if brain == null:
		return "..."
	var response := dialogue_engine.request_dialogue(npc, brain, player_message)
	relationships.record_interaction(-1, npc.entity_id, "conversation")
	sound_mgr.play_interaction_sound("dialogue_open" if player_message == "" else "")
	return response

func get_stack_info(world_x: int, world_y: int) -> Dictionary:
	var stack = world.get_stack_at_world_pos(world_x, world_y)
	if stack == null:
		return {"exists": false}
	var visible = stack.get_visible_grains()
	var layers: Array = []
	for g in visible:
		layers.append({
			"type": g.grain_type, "category": g.category,
			"hardness": g.properties.hardness, "flammability": g.properties.flammability,
		})
	var emergent = material_reg.get_emergent_properties(stack)
	return {"exists": true, "layers": layers, "depth": stack.size(), "emergent": emergent,
		"weather": weather.get_weather_name(), "time": day_night.get_time_string(),
		"light": day_night.get_light_level()}

func get_world_status() -> Dictionary:
	return {
		"time": day_night.get_time_string(),
		"day": day_night.get_day(),
		"weather": weather.get_weather_name(),
		"light": day_night.get_light_level(),
		"entities": entity_spawner.entity_count(),
		"cells_loaded": world.cell_count(),
		"events_active": event_framework.active_count(),
		"causal_events": causal.event_count(),
		"active_quests": quest_gen.get_active_quests().size(),
		"explored_pct": discovery.get_exploration_percentage(world.cell_count()),
	}

func _connect_lifecycle_signals() -> void:
	population_sim.death.connect(_on_entity_death)
	population_sim.birth.connect(_on_entity_birth)
	quest_gen.quest_available.connect(_on_quest_available)
	status_fx.effect_applied.connect(_on_effect_applied)
	status_fx.effect_expired.connect(_on_effect_expired)

func _species_name_for_quest(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "human"
		EntityBody.Species.ELF: return "elf"
		EntityBody.Species.DWARF: return "dwarf"
		EntityBody.Species.ORC: return "orc"
		EntityBody.Species.GOBLIN: return "goblin"
		EntityBody.Species.DRAGON: return "dragon"
		_: return "creature"

func _on_entity_death(entity_id: int, cause: String) -> void:
	var pos = entity_spawner.get_entity_position(entity_id)
	var entity = entity_spawner.get_entity(entity_id)
	if entity:
		death_respawn.process_death(entity, cause, pos.x, pos.y)
		causal.record_event(-1, entity_id, "death", {"cause": cause})
		status_fx.clear_effects(entity_id)

func _on_entity_birth(parent_a: int, parent_b: int, child_id: int) -> void:
	causal.record_event(parent_a, child_id, "birth", {"parent_b": parent_b})

func _on_quest_available(quest: Dictionary) -> void:
	pass

func _on_effect_applied(entity_id: int, effect_name: String) -> void:
	causal.record_event(-1, entity_id, "status_effect", {"effect": effect_name, "action": "applied"})

func _on_effect_expired(entity_id: int, effect_name: String) -> void:
	causal.record_event(-1, entity_id, "status_effect", {"effect": effect_name, "action": "expired"})

func save_game(filename: String = "autosave") -> bool:
	return world_persist.save_world(world, filename)

func load_game(filename: String = "autosave") -> bool:
	return world_persist.load_world(world, grain_registry, filename)

func gain_skill_xp(entity_id: int, skill_name: String, amount: float) -> void:
	skill_prog.add_experience(entity_id, skill_name, amount)

func apply_status_effect(entity_id: int, effect: String, duration: float, potency: float = 1.0) -> void:
	status_fx.apply_effect(entity_id, effect, duration, potency)

func discover_area(cell_x: int, cell_y: int, biome: String) -> void:
	discovery.record_exploration(cell_x, cell_y, biome)
