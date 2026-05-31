extends Node

signal time_updated(delta: float)

## Elapsed game time in seconds since the game started
var _elapsed_time: float = 0.0
## Whether game time is currently paused
var _paused: bool = false
## Game time scale multiplier (1.0 = normal, 2.0 = double speed)
var _time_scale: float = 1.0

func _ready() -> void:
	_elapsed_time = 0.0
	_paused = false
	_time_scale = 1.0

func _process(delta: float) -> void:
	if _paused:
		return
	var scaled_delta := delta * _time_scale
	_elapsed_time += scaled_delta
	time_updated.emit(scaled_delta)

## Get total elapsed game time in seconds
func get_time_seconds() -> float:
	return _elapsed_time

## Get time scale multiplier
func get_time_scale() -> float:
	return _time_scale

## Set time scale multiplier
func set_time_scale(scale: float) -> void:
	_time_scale = maxf(0.0, scale)

## Pause game time progression
func pause() -> void:
	_paused = true

## Resume game time progression
func resume() -> void:
	_paused = false

## Check if game time is paused
func is_paused() -> bool:
	return _paused

## Reset elapsed time to zero
func reset() -> void:
	_elapsed_time = 0.0
