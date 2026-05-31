class_name SoundManager
extends RefCounted

signal sound_requested(sound_id: String, position: Vector2)

var _sound_map: Dictionary = {}
var _music_track: String = ""
var _volume_master: float = 1.0
var _volume_sfx: float = 0.8
var _volume_music: float = 0.5

func _init() -> void:
	_init_sound_map()

func play_sfx(sound_id: String, position: Vector2 = Vector2.ZERO) -> void:
	if not _sound_map.has(sound_id):
		return
	sound_requested.emit(sound_id, position)

func play_footstep(grain_type: int) -> void:
	match grain_type:
		GrainTypes.Physical.GRASS: play_sfx("footstep_grass")
		GrainTypes.Physical.STONE, GrainTypes.Physical.GRAVEL: play_sfx("footstep_stone")
		GrainTypes.Physical.SAND: play_sfx("footstep_sand")
		GrainTypes.Physical.WATER: play_sfx("footstep_water")
		GrainTypes.Physical.WOOD: play_sfx("footstep_wood")
		GrainTypes.Physical.SNOW: play_sfx("footstep_snow")
		_: play_sfx("footstep_default")

func play_combat_sound(attack_type: String) -> void:
	match attack_type:
		"melee": play_sfx("combat_melee_hit")
		"ranged": play_sfx("combat_arrow")
		"magic": play_sfx("combat_magic")

func play_interaction_sound(action: String) -> void:
	match action:
		"dig": play_sfx("interaction_dig")
		"burn": play_sfx("interaction_fire")
		"pickup": play_sfx("interaction_pickup")
		"craft": play_sfx("interaction_craft")
		"equip": play_sfx("interaction_equip")

func play_ambient(biome: String) -> void:
	match biome:
		"grassland": _music_track = "ambient_grassland"
		"forest": _music_track = "ambient_forest"
		"desert": _music_track = "ambient_desert"
		"ocean", "shallow_water": _music_track = "ambient_ocean"
		"mountains", "hills": _music_track = "ambient_mountains"
		"tundra": _music_track = "ambient_tundra"
		"swamp": _music_track = "ambient_swamp"
		"volcanic": _music_track = "ambient_volcanic"
		"frozen_lake": _music_track = "ambient_frozen"
		"mushroom_forest": _music_track = "ambient_mushroom"
		_: _music_track = "ambient_default"

func get_ambient_for_context(biome: String, weather: String, is_night: bool) -> String:
	var base = "ambient_" + biome.replace(" ", "_")
	if weather == "Rain" or weather == "Storm":
		base += "_rain"
	elif weather == "Snow":
		base += "_snow"
	if is_night:
		base += "_night"
	return base

func get_sound_path(sound_id: String) -> String:
	return _sound_map.get(sound_id, "")

func _init_sound_map() -> void:
	# Placeholder paths - actual .ogg/.wav files to be generated later
	var sounds := [
		"footstep_grass", "footstep_stone", "footstep_sand",
		"footstep_water", "footstep_wood", "footstep_snow", "footstep_default",
		"combat_melee_hit", "combat_arrow", "combat_magic",
		"combat_block", "combat_miss", "combat_death",
		"interaction_dig", "interaction_fire", "interaction_pickup",
		"interaction_craft", "interaction_equip", "interaction_open",
		"ui_click", "ui_open", "ui_close", "ui_error",
		"ambient_grassland", "ambient_forest", "ambient_desert",
		"ambient_ocean", "ambient_mountains", "ambient_tundra", "ambient_default",
		"ambient_swamp", "ambient_volcanic", "ambient_frozen", "ambient_mushroom",
		"ambient_rain", "ambient_storm", "ambient_wind",
		"dialogue_open", "dialogue_close",
		"level_up", "quest_complete", "item_rare_drop",
	]
	for s in sounds:
		_sound_map[s] = "res://assets/audio/%s.ogg" % s
