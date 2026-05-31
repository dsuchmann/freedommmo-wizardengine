class_name EventsLayer
extends LayerBase

## L14: Generates initial world events from compiled state.

func _init():
	layer_name = "events"
	layer_id = 14

func compile(chunk: ChunkData, seed: int) -> void:
	chunk.events.clear()
	var tick = 0

	for structure in chunk.structures:
		chunk.events.append({
			"event_id": "evt_founding_%d_%d" % [structure["pos_x"], structure["pos_y"]],
			"tick": tick,
			"event_type": "settlement_founding",
			"location": {"x": structure["pos_x"], "y": structure["pos_y"]},
			"actors": [structure["template_id"]],
			"causes": ["settlement_placed"],
			"effects": [{"type": "structure_built", "target": structure["template_id"]}],
		})
		tick += 1

	for poi in chunk.pois:
		chunk.events.append({
			"event_id": "evt_poi_%d_%d" % [poi["x"], poi["y"]],
			"tick": tick,
			"event_type": "poi_discovered",
			"location": {"x": poi["x"], "y": poi["y"]},
			"actors": [],
			"causes": poi["triggers"],
			"effects": [{"type": "poi_marked", "target": poi["type"]}],
		})
		tick += 1

func validate(chunk: ChunkData) -> Array:
	var errors = []
	for event in chunk.events:
		if event.get("causes", []).is_empty():
			errors.append("Event %s has no causes" % event.get("event_id", "unknown"))
	return errors
