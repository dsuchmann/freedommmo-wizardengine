extends SceneTree

func _init() -> void:
	_run_tests()
	quit()

func _run_tests() -> void:
	test_defaults()
	test_load_valid_config()
	test_validation_missing_key()
	test_validation_wrong_type()
	test_getters()
	test_get_value()
	print("All ServerConfig tests passed.")

func test_defaults() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	# Without loading a file, should have defaults
	sc.config_data = sc._get_defaults()
	_assert(sc.get_max_players() == 100, "default max_players should be 100")
	_assert(sc.get_server_name() == "FreedomMMO", "default server_name should be FreedomMMO")
	_assert(sc.get_tick_rate() == 30, "default tick_rate should be 30")
	_assert(sc.get_world_seed() == 42, "default world_seed should be 42")

func test_load_valid_config() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	sc.config_path = "res://config/server_config.json"
	sc.load_config()
	_assert(sc.get_max_players() == 100, "loaded max_players should be 100")
	_assert(sc.get_server_name() == "FreedomMMO", "loaded server_name should be FreedomMMO")
	_assert(sc.get_tick_rate() == 30, "loaded tick_rate should be 30")

func test_validation_missing_key() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	var invalid_data := {"max_players": 50, "server_name": "Test"}  # missing tick_rate
	_assert(not sc.validate_config(invalid_data), "should fail validation with missing tick_rate")

func test_validation_wrong_type() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	var invalid_data := {"max_players": "not_a_number", "server_name": "Test", "tick_rate": 30}
	_assert(not sc.validate_config(invalid_data), "should fail validation with wrong type for max_players")

func test_getters() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	sc.config_data = {"max_players": 200, "server_name": "TestServer", "tick_rate": 60}
	_assert(sc.get_max_players() == 200, "getter max_players should return 200")
	_assert(sc.get_server_name() == "TestServer", "getter server_name should return TestServer")
	_assert(sc.get_tick_rate() == 60, "getter tick_rate should return 60")

func test_get_value() -> void:
	var sc = preload("res://scripts/autoload/ServerConfig.gd").new()
	sc.config_data = {"custom_key": "custom_value"}
	_assert(sc.get_value("custom_key") == "custom_value", "get_value should return custom_value")
	_assert(sc.get_value("missing_key", "fallback") == "fallback", "get_value should return fallback for missing key")

func _assert(condition: bool, message: String = "") -> void:
	if not condition:
		push_error("ASSERTION FAILED: %s" % message)
		quit(1)
