extends Node

signal config_reloaded

var config_path: String = "res://config/server_config.json"
var config_data: Dictionary = {}
var _file_mod_time: int = 0
var _poll_interval: float = 2.0
var _poll_timer: float = 0.0

func _ready() -> void:
	load_config()

func _process(delta: float) -> void:
	# Poll for config file changes (hot-reload)
	_poll_timer += delta
	if _poll_timer >= _poll_interval:
		_poll_timer = 0.0
		_check_for_config_changes()

func load_config() -> void:
	if not FileAccess.file_exists(config_path):
		push_warning("ServerConfig: Config file not found at %s, using defaults" % config_path)
		config_data = _get_defaults()
		return

	var json_text := FileAccess.get_file_as_string(config_path)
	var parsed = JSON.parse_string(json_text)

	if parsed == null or typeof(parsed) != TYPE_DICTIONARY:
		push_error("ServerConfig: Failed to parse JSON config at %s" % config_path)
		config_data = _get_defaults()
		return

	var data: Dictionary = parsed
	if validate_config(data):
		config_data = data
		_file_mod_time = FileAccess.get_modified_time(config_path)
		config_reloaded.emit()
		print("ServerConfig: Loaded config from %s" % config_path)
	else:
		push_error("ServerConfig: Validation failed, using defaults")
		config_data = _get_defaults()

func validate_config(data: Dictionary) -> bool:
	var required_keys := {
		"max_players": TYPE_FLOAT,  # JSON numbers parse as float
		"server_name": TYPE_STRING,
		"tick_rate": TYPE_FLOAT,
	}
	for key in required_keys:
		if not data.has(key):
			push_warning("ServerConfig: Missing required key '%s'" % key)
			return false
		var expected_type: int = required_keys[key]
		var actual_type: int = typeof(data[key])
		# Accept both int and float for numeric fields
		if expected_type == TYPE_FLOAT and actual_type != TYPE_FLOAT and actual_type != TYPE_INT:
			push_warning("ServerConfig: Key '%s' has wrong type (expected number, got %s)" % [key, type_string(actual_type)])
			return false
		elif expected_type == TYPE_STRING and actual_type != TYPE_STRING:
			push_warning("ServerConfig: Key '%s' has wrong type (expected string, got %s)" % [key, type_string(actual_type)])
			return false
	return true

func _check_for_config_changes() -> void:
	if not FileAccess.file_exists(config_path):
		return
	var current_mod_time := FileAccess.get_modified_time(config_path)
	if current_mod_time != _file_mod_time:
		print("ServerConfig: Detected config file change, reloading...")
		load_config()

func _get_defaults() -> Dictionary:
	return {
		"max_players": 100,
		"server_name": "FreedomMMO",
		"tick_rate": 30,
		"world_seed": 42,
		"region_tiles": 512,
		"tile_size": 64,
	}

# --- Getters ---

func get_max_players() -> int:
	return int(config_data.get("max_players", 100))

func get_server_name() -> String:
	return config_data.get("server_name", "FreedomMMO")

func get_tick_rate() -> int:
	return int(config_data.get("tick_rate", 30))

func get_world_seed() -> int:
	return int(config_data.get("world_seed", 42))

func get_region_tiles() -> int:
	return int(config_data.get("region_tiles", 512))

func get_tile_size() -> int:
	return int(config_data.get("tile_size", 64))

func get_value(key: String, default = null):
	return config_data.get(key, default)
