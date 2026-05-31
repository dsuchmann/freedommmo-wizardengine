class_name SpriteLoader
extends RefCounted

var _loaded_sprites: Dictionary = {}
var _loaded_animations: Dictionary = {}

func load_character_rotations(char_name: String, base_path: String) -> bool:
	var directions := ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"]
	var loaded := 0
	for dir in directions:
		var path := "%s/rotations/%s.png" % [base_path, dir]
		var tex = ResourceLoader.load(path) as Texture2D
		if tex == null:
			# Fallback for non-imported files
			if FileAccess.file_exists(path):
				var img := Image.load_from_file(path)
				if img:
					tex = ImageTexture.create_from_image(img)
		if tex:
			var key := "%s_%s" % [char_name, dir]
			_loaded_sprites[key] = tex
			loaded += 1
	return loaded > 0

func load_walk_animation(char_name: String, base_path: String, direction: String = "south", frame_count: int = 8) -> bool:
	var frames: Array = []
	for i in range(frame_count):
		var path := "%s/animations/walk/%s_%d.png" % [base_path, direction, i]
		var tex = ResourceLoader.load(path) as Texture2D
		if tex == null:
			if FileAccess.file_exists(path):
				var img := Image.load_from_file(path)
				if img:
					tex = ImageTexture.create_from_image(img)
		if tex:
			frames.append(tex)
	if frames.is_empty():
		return false
	var key := "%s_walk_%s" % [char_name, direction]
	_loaded_animations[key] = frames
	return true

func get_rotation(char_name: String, direction: String) -> Texture2D:
	var key := "%s_%s" % [char_name, direction]
	return _loaded_sprites.get(key)

func get_walk_frame(char_name: String, direction: String, frame: int) -> Texture2D:
	var key := "%s_walk_%s" % [char_name, direction]
	var frames = _loaded_animations.get(key)
	if frames == null or frames is not Array:
		return get_rotation(char_name, direction)
	return frames[frame % frames.size()]

func get_direction_from_velocity(vel: Vector2) -> String:
	if vel.length_squared() < 0.01:
		return "south"
	var angle := vel.angle()
	if angle < -2.75 or angle > 2.75: return "west"
	if angle < -1.96: return "north-west"
	if angle < -1.18: return "north"
	if angle < -0.39: return "north-east"
	if angle < 0.39: return "east"
	if angle < 1.18: return "south-east"
	if angle < 1.96: return "south"
	return "south-west"

func is_loaded(char_name: String) -> bool:
	return _loaded_sprites.has("%s_south" % char_name)

func loaded_count() -> int:
	return _loaded_sprites.size()

const SPECIES_DIRS: Dictionary = {
	EntityBody.Species.HUMAN: "hero_knight_v2",
	EntityBody.Species.ELF: "elf_merchant",
	EntityBody.Species.DWARF: "dwarf_miner_v2",
	EntityBody.Species.ORC: "orc_warrior_v2",
	EntityBody.Species.GOBLIN: "goblin_thief_v2",
}

const NPC_DIRS: Array = [
	"villager_female", "hero_knight", "orc_warrior",
	"dwarf_smith", "elf_archer", "orc_berserker",
	"hero_knight_v2", "village_woman_v2", "blacksmith_v2",
	"village_guard_v2", "elf_merchant", "dwarf_miner_v2", "orc_warrior_v2",
	"goblin_thief_v2",
]

const OCCUPATION_SPRITE_MAP: Dictionary = {
	"blacksmith": "blacksmith_v2",
	"guard": "village_guard_v2",
	"merchant": "elf_merchant",
	"farmer": "village_woman_v2",
	"hunter": "hero_knight_v2",
	"scholar": "elf_merchant",
	"villager": "village_woman_v2",
}

func load_all_species() -> int:
	var count := 0
	for species in SPECIES_DIRS:
		var dir_name = SPECIES_DIRS[species]
		var path = "res://assets/characters/%s" % dir_name
		if load_character_rotations(dir_name, path):
			count += 1
	for npc_dir in NPC_DIRS:
		var path = "res://assets/characters/%s" % npc_dir
		load_character_rotations(npc_dir, path)
		# Load walk animations for all 8 directions
		var walk_dirs = ["south", "east", "north", "west", "south-east", "north-east", "north-west", "south-west"]
		for wdir in walk_dirs:
			load_walk_animation(npc_dir, path, wdir, 8)
	return count

func get_species_sprite(species: int, direction: String) -> Texture2D:
	var dir_name = SPECIES_DIRS.get(species, "player_v2")
	return get_rotation(dir_name, direction)

func get_npc_sprite(npc_index: int, direction: String) -> Texture2D:
	var dir_name = NPC_DIRS[npc_index % NPC_DIRS.size()]
	return get_rotation(dir_name, direction)

func get_occupation_sprite(occupation: String, direction: String) -> Texture2D:
	var dir_name = OCCUPATION_SPRITE_MAP.get(occupation, "village_woman_v2")
	var tex = get_rotation(dir_name, direction)
	if tex == null:
		# Fallback to species sprite
		tex = get_rotation("player_v2", direction)
	return tex
