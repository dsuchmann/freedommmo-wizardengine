class_name WorldPersistence
extends RefCounted

const SAVE_DIR := "user://world_saves/"

func save_world(world: WorldGraph, filename: String = "world") -> bool:
	DirAccess.make_dir_recursive_absolute(
		SAVE_DIR.replace("user://", OS.get_user_data_dir() + "/"))

	var save_data := {
		"version": 1,
		"timestamp": Time.get_unix_time_from_system(),
		"cell_count": world.cell_count(),
		"cells": {},
	}

	for key in world.cells:
		var cell = world.cells[key]
		if cell and cell.is_loaded():
			save_data["cells"][str(key)] = _serialize_cell_compact(cell)

	var path := SAVE_DIR + filename + ".json"
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("WorldPersistence: cannot open %s" % path)
		return false
	file.store_string(JSON.stringify(save_data))
	file.close()
	print("WorldPersistence: saved %d cells to %s" % [save_data["cells"].size(), path])
	return true

func load_world(world: WorldGraph, grain_registry: GrainRegistry, filename: String = "world") -> bool:
	var path := SAVE_DIR + filename + ".json"
	if not FileAccess.file_exists(path):
		return false

	var json_text := FileAccess.get_file_as_string(path)
	var data = JSON.parse_string(json_text)
	if data == null:
		return false

	var cells_loaded := 0
	for key_str in data.get("cells", {}):
		var cell_data: Dictionary = data["cells"][key_str]
		var cell = _deserialize_cell_compact(cell_data, grain_registry)
		if cell:
			world.cells[int(key_str)] = cell
			cells_loaded += 1

	print("WorldPersistence: loaded %d cells from %s" % [cells_loaded, path])
	return true

func save_entities(spawner: EntitySpawner, filename: String = "entities") -> bool:
	DirAccess.make_dir_recursive_absolute(
		SAVE_DIR.replace("user://", OS.get_user_data_dir() + "/"))

	var entities: Array = []
	for eid in spawner._entities:
		var data: Dictionary = spawner._entities[eid]
		var body: EntityBody = data["body"]
		entities.append({
			"body": body.to_dict(),
			"world_x": data["world_x"],
			"world_y": data["world_y"],
		})

	var path := SAVE_DIR + filename + ".json"
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify({"entities": entities}))
	file.close()
	print("WorldPersistence: saved %d entities" % entities.size())
	return true

func _serialize_cell_compact(cell) -> Dictionary:
	var top_types: Array = []
	for y in range(WorldCell.CELL_SIZE):
		for x in range(WorldCell.CELL_SIZE):
			var stack = cell.get_grain_stack(x, y)
			if stack and stack.top():
				top_types.append(stack.top().grain_type)
			else:
				top_types.append(-1)
	return {
		"cx": cell.cell_x, "cy": cell.cell_y,
		"biome": cell.biome,
		"tops": top_types,
	}

func _deserialize_cell_compact(data: Dictionary, registry: GrainRegistry):
	var cell = WorldCell.new(data.get("cx", 0), data.get("cy", 0))
	cell.biome = data.get("biome", "grassland")
	var tops: Array = data.get("tops", [])
	for y in range(WorldCell.CELL_SIZE):
		for x in range(WorldCell.CELL_SIZE):
			var idx := y * WorldCell.CELL_SIZE + x
			if idx < tops.size():
				var stack = registry.create_terrain_stack(cell.biome)
				cell.set_stack(x, y, stack)
	return cell
