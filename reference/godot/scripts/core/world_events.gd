class_name WorldEvents
extends RefCounted

signal event_announced(title: String, description: String)

var event_framework: EventFramework
var _event_timer: float = 0.0
var _active_world_events: Array = []

func _init(p_framework: EventFramework = null) -> void:
	event_framework = p_framework if p_framework else EventFramework.new()
	_register_event_templates()

func tick(delta: float) -> void:
	_event_timer -= delta
	if _event_timer <= 0:
		_event_timer = 30.0 + randf() * 60.0
		_try_spawn_world_event()

func _try_spawn_world_event() -> void:
	var roll := randf()
	if roll < 0.15:
		_spawn_hunt_event()
	elif roll < 0.25:
		_spawn_trade_caravan()
	elif roll < 0.30:
		_spawn_weather_disaster()
	elif roll < 0.35:
		_spawn_monster_sighting()

func _spawn_hunt_event() -> void:
	var template := EventFramework.EventTemplate.new()
	template.name = "community_hunt"
	template.tags = ["social", "combat", "food"]
	template.add_phase("gathering", {
		"description": "Hunters gathering at the meeting point",
		"transitions": [{"condition": {"elapsed_min": 5.0}, "next_phase": "tracking", "actions": []}],
	})
	template.add_phase("tracking", {
		"description": "Following prey tracks through the wilderness",
		"transitions": [{"condition": {"elapsed_min": 10.0, "random_chance": 0.7}, "next_phase": "ambush", "actions": []},
			{"condition": {"elapsed_min": 15.0}, "next_phase": "lost_trail", "outcome": "prey_escaped"}],
	})
	template.add_phase("ambush", {
		"description": "The hunting party springs the trap",
		"transitions": [{"condition": {"elapsed_min": 3.0}, "next_phase": "", "outcome": "successful_hunt",
			"actions": [{"type": "set_context", "values": {"prey_caught": true}}]}],
	})
	event_framework.register_template("community_hunt", template)
	var instance_id := event_framework.start_event("community_hunt", [], {"type": "hunt"})
	event_announced.emit("Community Hunt", "Local hunters are organizing a hunt. Join them!")
	_active_world_events.append({"id": instance_id, "type": "hunt"})

func _spawn_trade_caravan() -> void:
	var template := EventFramework.EventTemplate.new()
	template.name = "trade_caravan"
	template.tags = ["economic", "social"]
	template.add_phase("arriving", {
		"description": "A merchant caravan approaches from the east",
		"transitions": [{"condition": {"elapsed_min": 5.0}, "next_phase": "trading", "actions": []}],
	})
	template.add_phase("trading", {
		"description": "Merchants set up shop and begin trading",
		"transitions": [{"condition": {"elapsed_min": 30.0}, "next_phase": "", "outcome": "caravan_departed",
			"actions": [{"type": "set_context", "values": {"trade_complete": true}}]}],
	})
	event_framework.register_template("trade_caravan", template)
	event_framework.start_event("trade_caravan", [], {"type": "trade"})
	event_announced.emit("Trade Caravan", "A merchant caravan has arrived with rare goods!")

func _spawn_weather_disaster() -> void:
	event_announced.emit("Storm Warning", "Dark clouds gather on the horizon. Seek shelter!")

var entity_spawner: EntitySpawner

func _spawn_monster_sighting() -> void:
	if entity_spawner == null:
		event_announced.emit("Monster Sighting", "Strange creatures have been spotted in the wilderness!")
		return
	# Spawn hostile goblin raiders at a random location
	var spawn_x = 64 + randi_range(-80, 80)
	var spawn_y = 64 + randi_range(-80, 80)
	var raider_names = ["Skrag", "Gnash", "Blitz", "Rot", "Fang"]
	var species = [EntityBody.Species.GOBLIN, EntityBody.Species.ORC].pick_random()
	var raider_name = raider_names.pick_random()
	var raider = entity_spawner.spawn_npc(species, raider_name, spawn_x, spawn_y, 15.0 + randf() * 20.0)
	raider.base_stats["attack"] = 10.0 + randf() * 5.0
	raider.base_stats["defense"] = 3.0 + randf() * 3.0
	raider.equip("main_hand", {"name": "Crude Club", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 4}, "durability": 30, "max_durability": 30})
	# Make them hostile via grudge
	var hostility = InfoGrain.new(InfoGrainTypes.Category.EMOTIONAL, InfoGrainTypes.Emotional.ANGER)
	hostility.intensity = 0.8
	hostility.salience = 0.7
	raider.mind.add(hostility)
	event_announced.emit("Raider Spotted!", "%s the %s has appeared near (%d, %d)!" % [raider_name, "goblin" if species == EntityBody.Species.GOBLIN else "orc", spawn_x, spawn_y])

func get_active_events() -> Array:
	return _active_world_events

func _register_event_templates() -> void:
	# Combat encounter template
	var combat := EventFramework.EventTemplate.new()
	combat.name = "combat_encounter"
	combat.tags = ["combat"]
	combat.add_phase("approach", {
		"description": "Entities notice each other",
		"transitions": [
			{"condition": {"elapsed_min": 1.0}, "next_phase": "engage", "actions": []},
			{"condition": {"elapsed_min": 3.0, "entity_state": {"fled": true}}, "next_phase": "", "outcome": "fled"}
		],
	})
	combat.add_phase("engage", {
		"description": "Combat begins",
		"transitions": [
			{"condition": {"elapsed_min": 2.0}, "next_phase": "exchange", "actions": [
				{"type": "record_causal", "action": "combat_started"}
			]}
		],
	})
	combat.add_phase("exchange", {
		"description": "Blows are exchanged",
		"transitions": [
			{"condition": {"intensity_above": {"threshold": 0.8}}, "next_phase": "", "outcome": "decisive_victory"},
			{"condition": {"elapsed_min": 10.0}, "next_phase": "", "outcome": "stalemate"}
		],
	})
	event_framework.register_template("combat_encounter", combat)

	# Romance template
	var romance := EventFramework.EventTemplate.new()
	romance.name = "romance_arc"
	romance.tags = ["social", "romance"]
	romance.add_phase("attraction", {
		"description": "Initial attraction between entities",
		"transitions": [
			{"condition": {"intensity_above": {"threshold": 0.5}}, "next_phase": "courtship", "actions": [
				{"type": "modify_info_grain", "category": "emotional", "type_id": 8, "intensity": 0.3}
			]},
			{"condition": {"elapsed_min": 30.0}, "next_phase": "", "outcome": "no_spark"}
		],
	})
	romance.add_phase("courtship", {
		"description": "Getting to know each other",
		"transitions": [
			{"condition": {"intensity_above": {"threshold": 0.7}}, "next_phase": "intimacy", "actions": [
				{"type": "modify_info_grain", "category": "relational", "type_id": 0, "intensity": 0.5}
			]},
			{"condition": {"elapsed_min": 60.0}, "next_phase": "", "outcome": "friendship_only"}
		],
	})
	romance.add_phase("intimacy", {
		"description": "Deep connection formed",
		"transitions": [
			{"condition": {"elapsed_min": 5.0}, "next_phase": "", "outcome": "bonded",
			"actions": [
				{"type": "modify_info_grain", "category": "relational", "type_id": 9, "intensity": 0.8},
				{"type": "record_causal", "action": "romance_bonded"}
			]}
		],
	})
	event_framework.register_template("romance_arc", romance)
