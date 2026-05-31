class_name DeltaPersistence
extends RefCounted

## Manages sparse time-decaying deltas for terrain object mutations.

var _deltas: Dictionary = {}  # "x_y" -> Dictionary (delta data)
var _save_dir: String = "user://world_state/deltas/"


func _init():
	DirAccess.make_dir_recursive_absolute(_save_dir)


func record_delta(pos: Vector2i, object_id: String, mutation: String,
		new_state: String, game_time: float, decay_type: String = "regrow",
		recovery_time: float = 720.0, stages: Array = []) -> void:
	var key = "%d_%d" % [pos.x, pos.y]
	_deltas[key] = {
		"position": [pos.x, pos.y],
		"object_id": object_id,
		"mutation": mutation,
		"new_state": new_state,
		"timestamp": game_time,
		"decay": {
			"type": decay_type,
			"recovery_time": recovery_time,
			"stages": stages,
		},
	}


func get_delta(pos: Vector2i) -> Dictionary:
	var key = "%d_%d" % [pos.x, pos.y]
	return _deltas.get(key, {})


func has_delta(pos: Vector2i) -> bool:
	var key = "%d_%d" % [pos.x, pos.y]
	return _deltas.has(key)


func resolve_delta(pos: Vector2i, current_game_time: float) -> Dictionary:
	## Returns current state of delta after time decay.
	## Returns {} if delta has fully recovered (baseline reasserts).
	var delta = get_delta(pos)
	if delta.is_empty():
		return {}

	var timestamp = delta.get("timestamp", 0.0)
	var decay = delta.get("decay", {})
	var recovery_time = decay.get("recovery_time", 720.0)
	var elapsed = current_game_time - timestamp

	# Fully recovered
	if recovery_time > 0 and elapsed >= recovery_time:
		remove_delta(pos)
		return {}

	# Permanent delta
	var decay_type = decay.get("type", "regrow")
	if decay_type == "permanent":
		return delta

	# Compute progress through recovery stages
	var progress = elapsed / max(recovery_time, 0.001)
	var stages = decay.get("stages", [])
	var current_stage_state = delta.get("new_state", "")

	for i in range(stages.size() - 1, -1, -1):
		var stage = stages[i]
		var at = stage.get("at", 0.0)
		if progress >= at:
			var stage_state = stage.get("state")
			if stage_state == null:
				remove_delta(pos)
				return {}
			current_stage_state = stage_state
			break

	var resolved = delta.duplicate(true)
	resolved["new_state"] = current_stage_state
	resolved["_progress"] = progress
	return resolved


func remove_delta(pos: Vector2i) -> void:
	var key = "%d_%d" % [pos.x, pos.y]
	_deltas.erase(key)


func prune_expired(current_game_time: float) -> int:
	## Remove all fully recovered deltas. Returns count pruned.
	var to_remove: Array[String] = []
	for key in _deltas:
		var delta = _deltas[key]
		var decay = delta.get("decay", {})
		var recovery = decay.get("recovery_time", 720.0)
		var decay_type = decay.get("type", "regrow")
		if decay_type == "permanent":
			continue
		var elapsed = current_game_time - delta.get("timestamp", 0.0)
		if recovery > 0 and elapsed >= recovery:
			to_remove.append(key)

	for key in to_remove:
		_deltas.erase(key)
	return to_remove.size()


func save_chunk(chunk_x: int, chunk_y: int) -> void:
	var chunk_deltas: Dictionary = {}
	var x_min = chunk_x * 64
	var x_max = x_min + 64
	var y_min = chunk_y * 64
	var y_max = y_min + 64

	for key in _deltas:
		var delta = _deltas[key]
		var pos = delta.get("position", [0, 0])
		if pos[0] >= x_min and pos[0] < x_max and pos[1] >= y_min and pos[1] < y_max:
			chunk_deltas[key] = delta

	if chunk_deltas.is_empty():
		return

	var path = _save_dir + "chunk_%d_%d.json" % [chunk_x, chunk_y]
	var file = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_warning("[DeltaPersistence] Cannot write: %s" % path)
		return
	file.store_string(JSON.stringify(chunk_deltas, "\t"))
	file.close()


func load_chunk(chunk_x: int, chunk_y: int) -> void:
	var path = _save_dir + "chunk_%d_%d.json" % [chunk_x, chunk_y]
	if not FileAccess.file_exists(path):
		return
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var text = file.get_as_text()
	file.close()
	var json = JSON.new()
	if json.parse(text) != OK:
		return
	var data = json.get_data()
	if data is Dictionary:
		for key in data:
			_deltas[key] = data[key]
