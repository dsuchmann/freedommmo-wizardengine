extends Node

signal player_data_loaded(peer_id: int)
signal player_data_saved(peer_id: int)
signal save_failed(peer_id: int, error: String)

const SAVE_DIR: String = "user://player_data/"
const AUTO_SAVE_INTERVAL: float = 60.0  # seconds

var player_data: Dictionary = {}  # peer_id -> player data dict
var _auto_save_timer: float = 0.0

func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR.replace("user://", OS.get_user_data_dir() + "/"))

func _process(delta: float) -> void:
	_auto_save_timer += delta
	if _auto_save_timer >= AUTO_SAVE_INTERVAL:
		_auto_save_timer = 0.0
		save_all_players()

func create_default_player_data(peer_id: int, username: String = "") -> Dictionary:
	return {
		"version": 1,
		"peer_id": peer_id,
		"username": username if not username.is_empty() else "Player_%d" % peer_id,
		"profile": {
			"display_name": username if not username.is_empty() else "Player_%d" % peer_id,
			"species": "human",
			"created_at": Time.get_unix_time_from_system(),
			"last_login": Time.get_unix_time_from_system(),
			"play_time_seconds": 0,
		},
		"position": {
			"x": 0.0,
			"y": 0.0,
			"region": "spawn",
		},
		"stats": {
			"level": 1,
			"experience": 0,
			"health": 100,
			"max_health": 100,
			"time_remaining": 36000.0,  # 10 hours of game time
		},
		"inventory": {
			"slots": [],
			"max_slots": 20,
			"currency": 0,
		},
		"progress": {
			"quests_completed": [],
			"quests_active": [],
			"discoveries": [],
			"achievements": [],
		},
	}

func load_player(peer_id: int, username: String = "") -> Dictionary:
	var file_path := _get_save_path(peer_id)

	if FileAccess.file_exists(file_path):
		var json_text := FileAccess.get_file_as_string(file_path)
		var parsed = JSON.parse_string(json_text)
		if parsed != null and typeof(parsed) == TYPE_DICTIONARY:
			if _validate_player_data(parsed):
				player_data[peer_id] = parsed
				player_data[peer_id]["profile"]["last_login"] = Time.get_unix_time_from_system()
				player_data_loaded.emit(peer_id)
				print("PersistenceManager: Loaded data for player %d" % peer_id)
				return player_data[peer_id]
			else:
				push_warning("PersistenceManager: Invalid data for player %d, using defaults" % peer_id)
		else:
			push_warning("PersistenceManager: Failed to parse save for player %d" % peer_id)

	# Create new player data
	var data := create_default_player_data(peer_id, username)
	player_data[peer_id] = data
	save_player(peer_id)
	player_data_loaded.emit(peer_id)
	print("PersistenceManager: Created new data for player %d" % peer_id)
	return data

func save_player(peer_id: int) -> bool:
	if not player_data.has(peer_id):
		save_failed.emit(peer_id, "No data to save")
		return false

	var data: Dictionary = player_data[peer_id]
	data["profile"]["play_time_seconds"] += AUTO_SAVE_INTERVAL  # Approximate

	var file_path := _get_save_path(peer_id)
	var json_text := JSON.stringify(data, "\t")

	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if file == null:
		var err_msg := "Failed to open save file: %s" % file_path
		push_error("PersistenceManager: %s" % err_msg)
		save_failed.emit(peer_id, err_msg)
		return false

	file.store_string(json_text)
	file.close()
	player_data_saved.emit(peer_id)
	return true

func save_all_players() -> void:
	for peer_id in player_data:
		save_player(peer_id)

func remove_player(peer_id: int) -> void:
	if player_data.has(peer_id):
		save_player(peer_id)
		player_data.erase(peer_id)
		print("PersistenceManager: Saved and removed data for player %d" % peer_id)

func get_player_data(peer_id: int) -> Dictionary:
	return player_data.get(peer_id, {})

func update_player_position(peer_id: int, pos: Vector2, region: String = "") -> void:
	if player_data.has(peer_id):
		player_data[peer_id]["position"]["x"] = pos.x
		player_data[peer_id]["position"]["y"] = pos.y
		if not region.is_empty():
			player_data[peer_id]["position"]["region"] = region

func _get_save_path(peer_id: int) -> String:
	return SAVE_DIR + "player_%d.json" % peer_id

func _validate_player_data(data: Dictionary) -> bool:
	var required_keys := ["version", "profile", "position", "stats", "inventory"]
	for key in required_keys:
		if not data.has(key):
			push_warning("PersistenceManager: Missing required key '%s'" % key)
			return false
	if not data["profile"] is Dictionary:
		return false
	if not data["position"] is Dictionary:
		return false
	if not data["stats"] is Dictionary:
		return false
	return true
