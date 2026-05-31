class_name BuildingCompiler

## Compiles building templates into world-grid tiles.
## Stamps walls (impassable), floors (walkable), doors (entry points),
## and interior features onto ChunkData.

var _templates: Dictionary = {}

func _init():
	_load_templates()

func _load_templates() -> void:
	var dir_path = "res://data/building_templates/"
	var dir = DirAccess.open(dir_path)
	if dir == null:
		push_warning("BuildingCompiler: Cannot open %s" % dir_path)
		return
	dir.list_dir_begin()
	var file = dir.get_next()
	while file != "":
		if file.ends_with(".json"):
			var full_path = dir_path + file
			var json_text = FileAccess.get_file_as_string(full_path)
			if json_text != "":
				var json = JSON.new()
				if json.parse(json_text) == OK:
					var data = json.data
					if data.has("template_id"):
						_templates[data["template_id"]] = data
		file = dir.get_next()
	dir.list_dir_end()

func get_template(template_id: String) -> Dictionary:
	return _templates.get(template_id, {})

func get_all_template_ids() -> Array:
	return _templates.keys()

func compile_building(chunk: ChunkData, template_id: String, pos_x: int, pos_y: int) -> Dictionary:
	var tmpl = get_template(template_id)
	if tmpl.is_empty():
		push_warning("BuildingCompiler: Unknown template '%s'" % template_id)
		return {}

	var w = tmpl["footprint"]["width"]
	var h = tmpl["footprint"]["height"]
	var structure = {
		"template_id": template_id,
		"category": tmpl.get("category", "misc"),
		"pos_x": pos_x,
		"pos_y": pos_y,
		"width": w,
		"height": h,
		"wall_tiles": [],
		"floor_tiles": [],
		"door_tiles": [],
		"interior_features": [],
		"npc_slots": tmpl.get("npc_slots", []),
		"roof_bounds": [pos_x, pos_y, pos_x + w - 1, pos_y + h - 1],
	}

	var door_positions = {}
	for door in tmpl["walls"].get("doors", []):
		var side = door["side"]
		var offset = door["offset"]
		var door_w = door.get("width", 1)
		for i in range(door_w):
			match side:
				"south": door_positions[Vector2i(offset + i, h - 1)] = true
				"north": door_positions[Vector2i(offset + i, 0)] = true
				"east": door_positions[Vector2i(w - 1, offset + i)] = true
				"west": door_positions[Vector2i(0, offset + i)] = true

	# Parse window positions from template
	var window_positions = {}
	for win in tmpl["walls"].get("windows", []):
		var side = win["side"]
		var offset = win.get("offset", 1)
		match side:
			"south": window_positions[Vector2i(offset, h - 1)] = true
			"north": window_positions[Vector2i(offset, 0)] = true
			"east": window_positions[Vector2i(w - 1, offset)] = true
			"west": window_positions[Vector2i(0, offset)] = true

	var structure_id = template_id + "_%d_%d" % [pos_x, pos_y]
	var wall_material = tmpl["walls"]["material"]
	var floor_material = tmpl["floor"]["material"]

	for dy in range(h):
		for dx in range(w):
			var wx = pos_x + dx
			var wy = pos_y + dy
			if wx < 0 or wx >= ChunkData.SIZE or wy < 0 or wy >= ChunkData.SIZE:
				continue
			# Skip water tiles — never place building tiles on water
			var wpos = Vector2i(wx, wy)
			if chunk.lake_cells.has(wpos) or chunk.river_cells.has(wpos) or chunk.is_ocean(wx, wy):
				continue

			var idx = chunk.idx(wx, wy)
			var local = Vector2i(dx, dy)
			var is_perimeter = (dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1)

			# Determine wall edge direction for shadow rendering
			var is_south_edge = (dy == h - 1)
			var is_east_edge = (dx == w - 1)
			var is_north_edge = (dy == 0)
			var is_west_edge = (dx == 0)

			if door_positions.has(local):
				chunk.walkability[idx] = 0.8
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "door",
					"material": wall_material,
					"z_index": 2,
					"structure_id": structure_id,
				}
				structure["door_tiles"].append(Vector2i(wx, wy))
			elif is_perimeter and window_positions.has(local):
				chunk.walkability[idx] = -1.0
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "window",
					"material": wall_material,
					"z_index": 2,
					"structure_id": structure_id,
					"south_edge": is_south_edge,
					"east_edge": is_east_edge,
				}
				structure["wall_tiles"].append(Vector2i(wx, wy))
			elif is_perimeter and tmpl["walls"]["pattern"] != "none":
				chunk.walkability[idx] = -1.0
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "wall",
					"material": wall_material,
					"z_index": 2,
					"structure_id": structure_id,
					"south_edge": is_south_edge,
					"east_edge": is_east_edge,
					"north_edge": is_north_edge,
					"west_edge": is_west_edge,
				}
				structure["wall_tiles"].append(Vector2i(wx, wy))
			else:
				chunk.walkability[idx] = 1.0
				chunk.building_tiles[Vector2i(wx, wy)] = {
					"type": "floor",
					"material": floor_material,
					"z_index": 0,
					"structure_id": structure_id,
				}
				structure["floor_tiles"].append(Vector2i(wx, wy))

	for feat in tmpl.get("interior_features", []):
		var fx = pos_x + feat["pos"][0]
		var fy = pos_y + feat["pos"][1]
		if fx >= 0 and fx < ChunkData.SIZE and fy >= 0 and fy < ChunkData.SIZE:
			structure["interior_features"].append({
				"type": feat["type"],
				"world_x": fx,
				"world_y": fy,
				"provides": feat.get("provides", []),
			})
			chunk.walkability[chunk.idx(fx, fy)] = 2.0

	chunk.structures.append(structure)
	return structure
