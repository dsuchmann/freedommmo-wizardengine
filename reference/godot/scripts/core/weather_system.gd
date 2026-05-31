class_name WeatherSystem
extends RefCounted

signal weather_changed(new_weather: String)

enum Weather {
	CLEAR,
	CLOUDY,
	RAIN,
	STORM,
	SNOW,
	FOG,
	SANDSTORM,
}

var current_weather: int = Weather.CLEAR
var _weather_timer: float = 0.0
var _weather_duration: float = 300.0
var _intensity: float = 0.0
var _biome: String = "grassland"

func tick(delta: float) -> void:
	_weather_timer -= delta
	if _weather_timer <= 0:
		_change_weather()

	# Weather affects world grain state
	match current_weather:
		Weather.RAIN:
			_intensity = 0.5 + randf() * 0.3
		Weather.STORM:
			_intensity = 0.8 + randf() * 0.2
		Weather.SNOW:
			_intensity = 0.3 + randf() * 0.4
		_:
			_intensity = 0.0

func set_biome(biome: String) -> void:
	_biome = biome

func get_weather_name() -> String:
	match current_weather:
		Weather.CLEAR: return "Clear"
		Weather.CLOUDY: return "Cloudy"
		Weather.RAIN: return "Rain"
		Weather.STORM: return "Storm"
		Weather.SNOW: return "Snow"
		Weather.FOG: return "Fog"
		Weather.SANDSTORM: return "Sandstorm"
		_: return "Unknown"

func get_intensity() -> float:
	return _intensity

func get_visibility_modifier() -> float:
	match current_weather:
		Weather.FOG: return 0.4
		Weather.STORM: return 0.6
		Weather.SANDSTORM: return 0.5
		Weather.SNOW: return 0.7
		Weather.RAIN: return 0.85
		_: return 1.0

func get_movement_modifier() -> float:
	match current_weather:
		Weather.RAIN: return 0.9
		Weather.STORM: return 0.7
		Weather.SANDSTORM: return 0.6
		Weather.SNOW: return 0.8
		Weather.FOG: return 0.95
		_: return 1.0

func get_combat_modifier() -> float:
	match current_weather:
		Weather.RAIN: return 0.95
		Weather.STORM: return 0.85
		Weather.SANDSTORM: return 0.8
		Weather.SNOW: return 0.9
		_: return 1.0

func get_ambient_color_modifier() -> Color:
	match current_weather:
		Weather.CLOUDY: return Color(0.8, 0.8, 0.85)
		Weather.RAIN: return Color(0.6, 0.65, 0.75)
		Weather.STORM: return Color(0.4, 0.4, 0.55)
		Weather.FOG: return Color(0.85, 0.85, 0.9)
		Weather.SNOW: return Color(0.9, 0.9, 0.95)
		Weather.SANDSTORM: return Color(0.8, 0.7, 0.5)
		_: return Color.WHITE

func _change_weather() -> void:
	var weights: Array = _get_weather_weights()
	var total := 0.0
	for w in weights:
		total += w
	var roll := randf() * total
	var cumulative := 0.0
	for i in range(weights.size()):
		cumulative += weights[i]
		if roll <= cumulative:
			var old := current_weather
			current_weather = i
			if old != current_weather:
				weather_changed.emit(get_weather_name())
			break
	_weather_duration = 120.0 + randf() * 360.0
	_weather_timer = _weather_duration

func _get_weather_weights() -> Array:
	match _biome:
		"desert":
			return [0.5, 0.2, 0.02, 0.01, 0.0, 0.05, 0.2]
		"tundra":
			return [0.2, 0.2, 0.05, 0.05, 0.4, 0.1, 0.0]
		"ocean", "shallow_water":
			return [0.3, 0.2, 0.25, 0.15, 0.0, 0.1, 0.0]
		"forest":
			return [0.3, 0.25, 0.2, 0.1, 0.0, 0.15, 0.0]
		"mountains", "hills":
			return [0.3, 0.2, 0.15, 0.1, 0.15, 0.1, 0.0]
		"swamp":
			return [0.15, 0.2, 0.35, 0.1, 0.0, 0.2, 0.0]
		"volcanic":
			return [0.3, 0.3, 0.0, 0.1, 0.0, 0.1, 0.2]
		"frozen_lake":
			return [0.15, 0.15, 0.05, 0.1, 0.45, 0.1, 0.0]
		"mushroom_forest":
			return [0.2, 0.3, 0.25, 0.05, 0.0, 0.2, 0.0]
		_:  # grassland default
			return [0.4, 0.25, 0.15, 0.08, 0.02, 0.1, 0.0]
