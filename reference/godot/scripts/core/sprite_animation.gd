class_name SpriteAnimation
extends RefCounted

enum State { IDLE, WALK, ATTACK, DIE, CAST }

const SPECIES_SPRITE_DIR: Dictionary = {
	EntityBody.Species.HUMAN: "player_v2",
	EntityBody.Species.ELF: "hero_knight",
	EntityBody.Species.DWARF: "hero_knight",
	EntityBody.Species.ORC: "orc_warrior",
	EntityBody.Species.GOBLIN: "goblin_thief",
}

const NPC_SPRITE_DIRS: Array = [
	"villager_female", "hero_knight", "orc_warrior",
]

const DIRECTION_NAMES: Array = [
	"south", "south-west", "west", "north-west",
	"north", "north-east", "east", "south-east",
]

var _state: int = State.IDLE
var _frame: int = 0
var _frame_timer: float = 0.0
var _frame_duration: float = 0.12
var _direction: String = "south"
var _sprites: Dictionary = {}
var _walk_frames: Dictionary = {}
var _loaded: bool = false

func load_sprites(sprite_dir: String) -> void:
	var base = "res://assets/characters/%s" % sprite_dir
	for dir_name in DIRECTION_NAMES:
		var path = "%s/rotations/%s.png" % [base, dir_name]
		if ResourceLoader.exists(path):
			_sprites[dir_name] = load(path)
	var walk_base = "%s/animations/walk" % base
	for dir_name in ["south", "west"]:
		var frames: Array = []
		for i in range(8):
			var path = "%s/%s_%d.png" % [walk_base, dir_name, i]
			if ResourceLoader.exists(path):
				frames.append(load(path))
		if not frames.is_empty():
			_walk_frames[dir_name] = frames
	_loaded = not _sprites.is_empty()

func get_species_dir(species: int) -> String:
	return SPECIES_SPRITE_DIR.get(species, "player_v2")

func get_npc_dir(npc_index: int) -> String:
	return NPC_SPRITE_DIRS[npc_index % NPC_SPRITE_DIRS.size()]

func is_loaded() -> bool:
	return _loaded

func set_state(new_state: int) -> void:
	if _state != new_state:
		_state = new_state
		_frame = 0
		_frame_timer = 0.0

func set_direction_from_velocity(vx: float, vy: float) -> void:
	if abs(vx) < 0.01 and abs(vy) < 0.01:
		return
	var angle = atan2(vy, vx)
	var idx = int(round((angle + PI) / (PI / 4.0))) % 8
	var dir_map = ["west", "north-west", "north", "north-east",
		"east", "south-east", "south", "south-west"]
	_direction = dir_map[idx]

func tick(delta: float) -> void:
	if _state == State.WALK or _state == State.ATTACK:
		_frame_timer += delta
		if _frame_timer >= _frame_duration:
			_frame_timer -= _frame_duration
			_frame += 1

func get_current_texture() -> Texture2D:
	if not _loaded:
		return null

	if _state == State.WALK and _walk_frames.has(_direction):
		var frames: Array = _walk_frames[_direction]
		if not frames.is_empty():
			return frames[_frame % frames.size()]
		# Try south walk as fallback
		if _walk_frames.has("south"):
			var south_frames: Array = _walk_frames["south"]
			if not south_frames.is_empty():
				return south_frames[_frame % south_frames.size()]

	# Static rotation sprite
	if _sprites.has(_direction):
		return _sprites[_direction]
	if _sprites.has("south"):
		return _sprites["south"]
	return null

func get_state() -> int:
	return _state

func get_direction() -> String:
	return _direction
