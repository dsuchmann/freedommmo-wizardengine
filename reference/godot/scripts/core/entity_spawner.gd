class_name EntitySpawner
extends RefCounted

var _entities: Dictionary = {}
var _next_id: int = 1000
var _npc_brains: Dictionary = {}
var causal_tracker: CausalTracker
var time_system: TimeSystem

func _init(p_causal: CausalTracker = null, p_time: TimeSystem = null) -> void:
	causal_tracker = p_causal if p_causal else CausalTracker.new()
	time_system = p_time if p_time else TimeSystem.new()

func spawn_npc(species: int, name: String, world_x: int, world_y: int, age: float = 25.0) -> EntityBody:
	_next_id += 1
	var entity := EntityBody.new(_next_id, species)
	entity.name = name
	entity.age = age
	entity.time_pool = 36000.0 - (age * 100.0)

	_seed_mind(entity)
	time_system.register_entity(entity.entity_id, entity.time_pool, age)

	_entities[entity.entity_id] = {
		"body": entity,
		"world_x": world_x,
		"world_y": world_y,
	}

	var brain := NPCBrain.new(entity, causal_tracker, time_system)
	_npc_brains[entity.entity_id] = brain

	causal_tracker.record_event(entity.entity_id, -1, "spawned", {
		"species": species, "name": name, "x": world_x, "y": world_y,
	})

	return entity

func spawn_random_population(count: int, center_x: int, center_y: int, radius: int) -> int:
	var names := ["Aldric", "Brenna", "Cedric", "Dalia", "Eamon", "Fiona",
		"Gareth", "Helena", "Ivar", "Johanna", "Kael", "Lyra", "Magnus",
		"Nadia", "Orin", "Petra", "Quinn", "Rhea", "Soren", "Thalia",
		"Ulf", "Vera", "Wren", "Xander", "Yara", "Zeke"]
	var species_list := [
		EntityBody.Species.HUMAN, EntityBody.Species.HUMAN, EntityBody.Species.HUMAN,
		EntityBody.Species.ELF, EntityBody.Species.DWARF, EntityBody.Species.ORC,
		EntityBody.Species.GOBLIN,
	]

	var spawned := 0
	for i in range(count):
		var name_str: String = names[i % names.size()]
		if i >= names.size():
			name_str += " %d" % (i / names.size())
		var species: int = species_list[i % species_list.size()]
		var age := 16.0 + randf() * 50.0
		var x := center_x + randi_range(-radius, radius)
		var y := center_y + randi_range(-radius, radius)
		spawn_npc(species, name_str, x, y, age)
		spawned += 1
	return spawned

func tick(delta: float) -> Array:
	var actions: Array = []
	for eid in _npc_brains:
		var brain: NPCBrain = _npc_brains[eid]
		brain.tick(delta)
	_move_npcs(delta)
	return actions

func _move_npcs(delta: float) -> void:
	var walkability = null
	if WorldManager:
		walkability = WorldManager.walkability
	for eid in _entities:
		var data: Dictionary = _entities[eid]
		var brain = _npc_brains.get(eid)
		if brain == null:
			continue
		# Movement direction is set by NPCBehavior (pathfinding, goals, schedules).
		# If no direction has been set yet, initialize to stationary.
		if not data.has("move_dir_x"):
			data["move_dir_x"] = 0
			data["move_dir_y"] = 0
		# Accumulate fractional movement toward brain-directed target
		if not data.has("move_frac_x"):
			data["move_frac_x"] = 0.0
			data["move_frac_y"] = 0.0
		var dir_x = data["move_dir_x"]
		var dir_y = data["move_dir_y"]
		if dir_x == 0 and dir_y == 0:
			# No movement target — bleed off fractional accumulation
			data["move_frac_x"] = 0.0
			data["move_frac_y"] = 0.0
			continue
		var speed := 30.0 * delta
		data["move_frac_x"] += dir_x * speed
		data["move_frac_y"] += dir_y * speed
		if abs(data["move_frac_x"]) >= 1.0:
			var step = int(data["move_frac_x"])
			var target_x = data["world_x"] + step
			var target_y = data["world_y"]
			if walkability and walkability.has_data(target_x, target_y):
				if walkability.can_move_to(target_x, target_y):
					data["world_x"] = target_x
			else:
				data["world_x"] = target_x
			data["move_frac_x"] -= step
		if abs(data["move_frac_y"]) >= 1.0:
			var step = int(data["move_frac_y"])
			var target_x = data["world_x"]
			var target_y = data["world_y"] + step
			if walkability and walkability.has_data(target_x, target_y):
				if walkability.can_move_to(target_x, target_y):
					data["world_y"] = target_y
			else:
				data["world_y"] = target_y
			data["move_frac_y"] -= step

func get_entity(entity_id: int) -> EntityBody:
	var data = _entities.get(entity_id)
	if data:
		return data["body"]
	return null

func get_entity_position(entity_id: int) -> Vector2i:
	var data = _entities.get(entity_id)
	if data:
		return Vector2i(data["world_x"], data["world_y"])
	return Vector2i(-1, -1)

func get_entities_near(world_x: int, world_y: int, radius: int) -> Array:
	var candidates: Array = []
	for eid in _entities:
		var data: Dictionary = _entities[eid]
		var dx: int = abs(data["world_x"] - world_x)
		var dy: int = abs(data["world_y"] - world_y)
		if dx <= radius and dy <= radius:
			candidates.append({"body": data["body"], "dist": dx + dy})
	candidates.sort_custom(func(a, b): return a["dist"] < b["dist"])
	var result: Array = []
	for c in candidates:
		result.append(c["body"])
	return result

func entity_count() -> int:
	return _entities.size()

func get_entity_ids() -> Array:
	return _entities.keys()

func _seed_mind(entity: EntityBody) -> void:
	var survival := InfoGrain.new(InfoGrainTypes.Category.MOTIVATIONAL, InfoGrainTypes.Motivational.SURVIVAL)
	survival.intensity = 0.6 + randf() * 0.3
	survival.salience = 0.8
	survival.decay_rate = 0.001
	entity.mind.add(survival)

	if randf() > 0.5:
		var curiosity := InfoGrain.new(InfoGrainTypes.Category.COGNITIVE, InfoGrainTypes.Cognitive.CURIOSITY)
		curiosity.intensity = 0.3 + randf() * 0.5
		curiosity.salience = 0.5
		entity.mind.add(curiosity)

	if randf() > 0.7:
		var greed := InfoGrain.new(InfoGrainTypes.Category.MOTIVATIONAL, InfoGrainTypes.Motivational.GREED)
		greed.intensity = 0.2 + randf() * 0.4
		greed.salience = 0.4
		entity.mind.add(greed)

	var emotion_type: int = [
		InfoGrainTypes.Emotional.CONTENTMENT,
		InfoGrainTypes.Emotional.ANTICIPATION,
		InfoGrainTypes.Emotional.FEAR,
		InfoGrainTypes.Emotional.JOY,
	].pick_random()
	var emotion := InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, emotion_type)
	emotion.intensity = 0.3 + randf() * 0.4
	emotion.salience = 0.6
	entity.mind.add(emotion)
