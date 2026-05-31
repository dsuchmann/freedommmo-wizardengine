class_name TownLayoutCompiler
extends RefCounted

## Expands a TownLayout JSON into ChunkData tiles via BuildingCompiler.
## Handles: zone ground painting, building placement, road rasterization,
## decoration placement, NPC assignment.
##
## Road cell values:
##   1 = dirt road (rendered with grass_to_dirt tileset)
##   2 = cobblestone plaza/road (rendered with cobblestone_road tileset)

const BUILDING_BUFFER := 2  # grass tiles around each building

var _building_compiler: BuildingCompiler
var _layouts: Dictionary = {}  # town_id -> layout data

func _init(building_compiler: BuildingCompiler) -> void:
	_building_compiler = building_compiler
	_load_layouts()

func _load_layouts() -> void:
	var dir_path = "res://data/town_layouts/"
	var dir = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var file = dir.get_next()
	while file != "":
		if file.ends_with(".json"):
			var json_text = FileAccess.get_file_as_string(dir_path + file)
			if json_text != "":
				var json = JSON.new()
				if json.parse(json_text) == OK:
					var data = json.data
					var tid = data.get("town_id", file.get_basename())
					_layouts[tid] = data
		file = dir.get_next()
	dir.list_dir_end()
	print("[TownLayoutCompiler] Loaded %d town layouts" % _layouts.size())

func get_layout_ids() -> Array:
	return _layouts.keys()

func pick_layout_for_biome(biome_name: String, rng: RandomNumberGenerator) -> Dictionary:
	## Pick a layout appropriate for the biome. Falls back to any layout.
	var candidates = []
	for tid in _layouts:
		candidates.append(_layouts[tid])
	if candidates.is_empty():
		return {}
	return candidates[rng.randi() % candidates.size()]

func compile_town(chunk: ChunkData, layout: Dictionary, origin_x: int, origin_y: int) -> Dictionary:
	## Expand a TownLayout into chunk tiles. Returns town metadata.
	var town_name = layout.get("name", "Unknown Settlement")
	var structures = []
	var npc_assignments = []

	# Collect building footprints for overlap detection
	var occupied_rects = []  # Array of Rect2i covering building + buffer

	# 1) Paint zone ground tiles
	for zone in layout.get("zones", []):
		_paint_zone(chunk, zone, origin_x, origin_y)

	# 2) Place buildings via BuildingCompiler (with overlap check)
	var building_positions = {}  # label -> {x, y}
	for bld in layout.get("buildings", []):
		var tmpl_id = bld.get("template", "house")
		var pos = bld.get("pos", [0, 0])
		var wx = origin_x + pos[0]
		var wy = origin_y + pos[1]
		var label = bld.get("label", tmpl_id)

		# Get footprint size from building compiler templates
		var footprint = _get_building_footprint(tmpl_id)
		var buffered_rect = Rect2i(
			wx - BUILDING_BUFFER,
			wy - BUILDING_BUFFER,
			footprint.x + BUILDING_BUFFER * 2,
			footprint.y + BUILDING_BUFFER * 2
		)

		# Check for overlap with already-placed buildings
		var overlaps = false
		for existing in occupied_rects:
			if buffered_rect.intersects(existing):
				overlaps = true
				print("[TownLayoutCompiler] WARN: building '%s' overlaps with existing, skipping" % label)
				break

		if overlaps:
			continue

		var result = _building_compiler.compile_building(chunk, tmpl_id, wx, wy)
		if not result.is_empty():
			structures.append(result)
			building_positions[label] = {"x": wx, "y": wy}
			occupied_rects.append(buffered_rect)

	# 3) Rasterize roads
	for road in layout.get("roads", []):
		_rasterize_road(chunk, road, origin_x, origin_y)

	# 4) Place decorations
	for deco in layout.get("decorations", []):
		_place_decoration(chunk, deco, origin_x, origin_y)

	# 5) Assign NPCs to buildings
	for npc_def in layout.get("npcs", []):
		var home_label = npc_def.get("home", "")
		var work_label = npc_def.get("workplace", "")
		var home_pos = building_positions.get(home_label, {})
		var work_pos = building_positions.get(work_label, {})
		npc_assignments.append({
			"role": npc_def.get("role", "villager"),
			"home_x": home_pos.get("x", origin_x),
			"home_y": home_pos.get("y", origin_y),
			"work_x": work_pos.get("x", origin_x),
			"work_y": work_pos.get("y", origin_y),
		})

	return {
		"name": town_name,
		"structures": structures,
		"npcs": npc_assignments,
		"origin_x": origin_x,
		"origin_y": origin_y,
	}

func _get_building_footprint(template_id: String) -> Vector2i:
	## Return footprint size for a building template. Defaults to 4x4.
	match template_id:
		"house":
			return Vector2i(3, 4)
		"tavern":
			return Vector2i(5, 4)
		"forge":
			return Vector2i(4, 5)
		"market_stall":
			return Vector2i(2, 2)
		"well":
			return Vector2i(1, 1)
		"watchtower":
			return Vector2i(2, 3)
		_:
			return Vector2i(4, 4)

func _paint_zone(chunk: ChunkData, zone: Dictionary, ox: int, oy: int) -> void:
	var rect = zone.get("rect", [0, 0, 4, 4])
	var ground = zone.get("ground", "cobblestone")
	# Determine road_cell value: cobblestone=2 (plaza), dirt=1
	var cell_value = 2 if ground == "cobblestone" else 1
	for y in range(rect[1], rect[1] + rect[3]):
		for x in range(rect[0], rect[0] + rect[2]):
			var wx = ox + x
			var wy = oy + y
			var lx = wx - chunk.chunk_x * ChunkData.SIZE
			var ly = wy - chunk.chunk_y * ChunkData.SIZE
			if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
				chunk.road_cells[Vector2i(lx, ly)] = cell_value

func _rasterize_road(chunk: ChunkData, road: Dictionary, ox: int, oy: int) -> void:
	var path_points = road.get("path", [])
	var width = road.get("width", 3)
	var road_type = road.get("type", "dirt")
	# cobblestone roads get value 2, dirt roads get value 1
	var cell_value = 2 if road_type == "cobblestone" else 1
	for i in range(path_points.size() - 1):
		var from_pt = path_points[i]
		var to_pt = path_points[i + 1]
		var fx = ox + from_pt[0]
		var fy = oy + from_pt[1]
		var tx = ox + to_pt[0]
		var ty = oy + to_pt[1]
		_bresenham_road(chunk, fx, fy, tx, ty, width, cell_value)

func _bresenham_road(chunk: ChunkData, x0: int, y0: int, x1: int, y1: int, width: int, cell_value: int) -> void:
	var dx = abs(x1 - x0)
	var dy = abs(y1 - y0)
	var sx = 1 if x0 < x1 else -1
	var sy = 1 if y0 < y1 else -1
	var err = dx - dy
	var cx = x0
	var cy = y0
	var half_w = width / 2
	while true:
		for wy in range(-half_w, half_w + 1):
			for wx in range(-half_w, half_w + 1):
				var lx = cx + wx - chunk.chunk_x * ChunkData.SIZE
				var ly = cy + wy - chunk.chunk_y * ChunkData.SIZE
				if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
					chunk.road_cells[Vector2i(lx, ly)] = cell_value
					chunk.walkability[chunk.idx(lx, ly)] = 0.5
		if cx == x1 and cy == y1:
			break
		var e2 = 2 * err
		if e2 > -dy:
			err -= dy
			cx += sx
		if e2 < dx:
			err += dx
			cy += sy

func _place_decoration(chunk: ChunkData, deco: Dictionary, ox: int, oy: int) -> void:
	var pos = deco.get("pos", [0, 0])
	var lx = ox + pos[0] - chunk.chunk_x * ChunkData.SIZE
	var ly = oy + pos[1] - chunk.chunk_y * ChunkData.SIZE
	if lx >= 0 and lx < ChunkData.SIZE and ly >= 0 and ly < ChunkData.SIZE:
		# Store decoration in chunk for renderer to pick up
		if not chunk.has_meta("decorations"):
			chunk.set_meta("decorations", [])
		var decos = chunk.get_meta("decorations")
		decos.append({"type": deco.get("type", ""), "x": lx, "y": ly})
