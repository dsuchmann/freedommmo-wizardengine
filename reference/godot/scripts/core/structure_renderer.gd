class_name StructureRenderer
extends RefCounted

## Renders structures as pixel tiles onto terrain images and stamps walkability.
## Each structure type has a visual definition with wall/floor/door colors and layout.

# Visual definitions: each entry is a dict with:
#   "layout": 2D array where each cell is "wall", "floor", "door", "feature", or ""
#   "wall_color": Color for wall tiles
#   "floor_color": Color for interior floor
#   "door_color": Color for door/entrance
#   "feature_color": Color for special feature (forge glow, altar purple, etc.)
#   "roof_color": Optional roof color for visual depth

var _visual_defs: Dictionary = {}

func _init() -> void:
	_init_visual_definitions()

func _init_visual_definitions() -> void:
	_visual_defs["house"] = {
		"layout": [
			["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
			["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
			["wall", "floor", "floor", "floor", "floor", "floor", "wall"],
			["wall", "floor", "floor", "floor", "floor", "floor", "wall"],
			["wall", "floor", "floor", "floor", "floor", "floor", "wall"],
			["wall", "floor", "floor", "floor", "floor", "floor", "wall"],
			["wall", "wall", "wall", "door", "wall", "wall", "wall"],
		],
		"wall_color": Color(0.55, 0.35, 0.18),
		"floor_color": Color(0.65, 0.55, 0.38),
		"door_color": Color(0.4, 0.28, 0.15),
		"feature_color": Color(0.55, 0.35, 0.18),
		"roof_color": Color(0.6, 0.22, 0.08),
	}

	_visual_defs["forge"] = {
		"layout": [
			["wall", "wall", "wall", "wall", "wall"],
			["wall", "floor", "feature", "floor", "wall"],
			["wall", "floor", "floor", "floor", "wall"],
			["wall", "wall", "door", "wall", "wall"],
		],
		"wall_color": Color(0.35, 0.35, 0.4),
		"floor_color": Color(0.45, 0.4, 0.35),
		"door_color": Color(0.7, 0.4, 0.1),
		"feature_color": Color(0.95, 0.5, 0.1),
		"roof_color": Color(0.3, 0.3, 0.35),
	}

	_visual_defs["market_stall"] = {
		"layout": [
			["wall", "wall", "wall"],
			["feature", "feature", "feature"],
		],
		"wall_color": Color(0.55, 0.4, 0.2),
		"floor_color": Color(0.65, 0.55, 0.35),
		"door_color": Color(0.65, 0.55, 0.35),
		"feature_color": Color(0.6, 0.45, 0.2),
		"roof_color": Color(0.7, 0.5, 0.15),
	}

	_visual_defs["well"] = {
		"layout": [
			["wall", "wall", "wall"],
			["wall", "feature", "wall"],
			["wall", "wall", "wall"],
		],
		"wall_color": Color(0.5, 0.5, 0.5),
		"floor_color": Color(0.3, 0.5, 0.7),
		"door_color": Color(0.5, 0.5, 0.5),
		"feature_color": Color(0.35, 0.45, 0.6),
		"roof_color": Color(0.5, 0.5, 0.5),
	}

	_visual_defs["watchtower"] = {
		"layout": [
			["wall", "wall", "wall"],
			["wall", "wall", "wall"],
			["wall", "door", "wall"],
		],
		"wall_color": Color(0.5, 0.5, 0.55),
		"floor_color": Color(0.45, 0.45, 0.45),
		"door_color": Color(0.4, 0.35, 0.3),
		"feature_color": Color(0.5, 0.5, 0.55),
		"roof_color": Color(0.4, 0.4, 0.45),
	}

	_visual_defs["farm_plot"] = {
		"layout": [
			["feature", "feature", "feature", "feature"],
			["feature", "feature", "feature", "feature"],
			["feature", "feature", "feature", "feature"],
		],
		"wall_color": Color(0.35, 0.25, 0.1),
		"floor_color": Color(0.4, 0.3, 0.15),
		"door_color": Color(0.4, 0.3, 0.15),
		"feature_color": Color(0.3, 0.5, 0.15),
		"roof_color": Color(0.35, 0.25, 0.1),
	}

	_visual_defs["altar"] = {
		"layout": [
			["feature"],
			["feature"],
		],
		"wall_color": Color(0.6, 0.6, 0.65),
		"floor_color": Color(0.5, 0.5, 0.55),
		"door_color": Color(0.5, 0.5, 0.55),
		"feature_color": Color(0.5, 0.3, 0.6),
		"roof_color": Color(0.6, 0.6, 0.65),
	}

	_visual_defs["campfire"] = {
		"layout": [
			["feature"],
		],
		"wall_color": Color(0.4, 0.3, 0.15),
		"floor_color": Color(0.35, 0.25, 0.1),
		"door_color": Color(0.35, 0.25, 0.1),
		"feature_color": Color(0.9, 0.5, 0.1),
		"roof_color": Color(0.4, 0.3, 0.15),
	}

	_visual_defs["tent"] = {
		"layout": [
			["wall", "wall"],
			["wall", "door"],
		],
		"wall_color": Color(0.7, 0.65, 0.5),
		"floor_color": Color(0.6, 0.55, 0.4),
		"door_color": Color(0.55, 0.5, 0.35),
		"feature_color": Color(0.7, 0.65, 0.5),
		"roof_color": Color(0.65, 0.6, 0.45),
	}

## Draw a structure onto a terrain Image and stamp the walkability grid
func render_structure(structure: Dictionary, img: Image, cell_x: int, cell_y: int,
		walkability: WalkabilityGrid) -> void:
	var stype = structure.get("type", "")
	if not _visual_defs.has(stype):
		return

	var base_vdef = _visual_defs[stype]
	var sx = structure.get("world_x", 0)
	var sy = structure.get("world_y", 0)

	# Generate unique layout and colors per structure based on position seed
	var seed_val = (sx * 73856093) ^ (sy * 19349663)
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val
	var vdef = _vary_visual_def(base_vdef, stype, rng)
	var layout: Array = vdef["layout"]

	# Calculate cell-local coordinates
	var tile_scale = 32  # Must match tile_size in terrain rendering
	var cell_base_x = cell_x * 128
	var cell_base_y = cell_y * 128

	var wall_positions: Array = []
	var floor_positions: Array = []
	var door_positions: Array = []

	for row_idx in range(layout.size()):
		var row: Array = layout[row_idx]
		for col_idx in range(row.size()):
			var tile_type: String = row[col_idx]
			if tile_type.is_empty():
				continue

			var wx = sx + col_idx
			var wy = sy + row_idx
			var local_x = wx - cell_base_x
			var local_y = wy - cell_base_y

			# Get tile color
			var color: Color
			match tile_type:
				"wall":
					color = vdef["wall_color"]
					wall_positions.append(Vector2i(wx, wy))
				"floor":
					color = vdef["floor_color"]
					floor_positions.append(Vector2i(wx, wy))
				"door":
					color = vdef["door_color"]
					door_positions.append(Vector2i(wx, wy))
				"feature":
					color = vdef["feature_color"]
					floor_positions.append(Vector2i(wx, wy))
				_:
					continue

			# Add roof highlight on top row of walls
			if tile_type == "wall" and row_idx == 0:
				color = vdef.get("roof_color", color)

			# Draw tile_scale×tile_scale block with sub-pixel texture
			var rx = local_x * tile_scale
			var ry = local_y * tile_scale
			var img_size = 128 * tile_scale
			if rx >= 0 and rx < img_size and ry >= 0 and ry < img_size:
				for ty in range(tile_scale):
					for tx in range(tile_scale):
						if rx + tx < img_size and ry + ty < img_size:
							var pixel_color = color
							var sub_hash = ((wx * 73856093 + tx) ^ (wy * 19349663 + ty)) & 0xFF
							match tile_type:
								"wall":
									# Brick/stone pattern: mortar lines
									if tx == 0 or ty == 0:
										pixel_color = color.darkened(0.15)  # mortar
									elif sub_hash % 8 == 0:
										pixel_color = color.lightened(0.1)
									else:
										var noise = (sub_hash / 255.0 - 0.5) * 0.08
										pixel_color.r = clampf(pixel_color.r + noise, 0, 1)
										pixel_color.g = clampf(pixel_color.g + noise, 0, 1)
										pixel_color.b = clampf(pixel_color.b + noise, 0, 1)
								"floor":
									# Wood plank pattern: lines at tx==0
									if tx == 0:
										pixel_color = color.darkened(0.12)
									else:
										var noise = (sub_hash / 255.0 - 0.5) * 0.06
										pixel_color.r = clampf(pixel_color.r + noise, 0, 1)
										pixel_color.g = clampf(pixel_color.g + noise, 0, 1)
								"door":
									# Door highlight — brighter center
									if tx >= 1 and tx <= 2 and ty >= 1 and ty <= 2:
										pixel_color = color.lightened(0.15)
									elif tx == 0 or tx == 3:
										pixel_color = color.darkened(0.1)
								"feature":
									# Glowing feature — slightly brighter with shimmer
									if sub_hash % 6 == 0:
										pixel_color = color.lightened(0.2)
									else:
										var noise = (sub_hash / 255.0 - 0.5) * 0.1
										pixel_color.r = clampf(pixel_color.r + noise, 0, 1)
							# Roof row gets gradient (darker at bottom)
							if tile_type == "wall" and row_idx == 0:
								pixel_color = pixel_color.darkened(ty * 0.05)
							img.set_pixel(rx + tx, ry + ty, pixel_color)

	# Draw dark outline around walls for visual pop
	var outline_color = Color(0.1, 0.08, 0.05)
	var all_struct_positions: Dictionary = {}
	for pos in wall_positions:
		all_struct_positions[pos] = true
	for pos in floor_positions:
		all_struct_positions[pos] = true
	for pos in door_positions:
		all_struct_positions[pos] = true
	for pos in wall_positions:
		for offset in [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1)]:
			var neighbor = pos + offset
			if not all_struct_positions.has(neighbor):
				var lx = (neighbor.x - cell_base_x) * tile_scale
				var ly = (neighbor.y - cell_base_y) * tile_scale
				var img_size = 128 * tile_scale
				if lx >= 0 and lx < img_size and ly >= 0 and ly < img_size:
					for ty in range(tile_scale):
						for tx in range(tile_scale):
							if lx + tx < img_size and ly + ty < img_size:
								img.set_pixel(lx + tx, ly + ty, outline_color)

	# Stamp walkability
	if walkability:
		walkability.stamp_structure(wall_positions, floor_positions, door_positions)

## Generate a unique variant of a visual definition using the structure's RNG
func _vary_visual_def(base: Dictionary, stype: String, rng: RandomNumberGenerator) -> Dictionary:
	var result = base.duplicate(true)
	# Vary colors: shift hue/brightness slightly per structure
	var hue_shift = rng.randf_range(-0.05, 0.05)
	var bright_shift = rng.randf_range(-0.08, 0.08)
	for key in ["wall_color", "floor_color", "door_color", "feature_color", "roof_color"]:
		if result.has(key):
			var c: Color = result[key]
			c.r = clampf(c.r + hue_shift + bright_shift, 0, 1)
			c.g = clampf(c.g + bright_shift, 0, 1)
			c.b = clampf(c.b - hue_shift + bright_shift, 0, 1)
			result[key] = c

	# Vary layout for houses — different sizes and shapes
	if stype == "house":
		var w = rng.randi_range(5, 9)
		var h = rng.randi_range(5, 8)
		var door_x = rng.randi_range(1, w - 2)
		var door_side = rng.randi_range(0, 3)  # 0=bottom, 1=top, 2=left, 3=right
		var layout: Array = []
		for row in range(h):
			var line: Array = []
			for col in range(w):
				var is_edge = row == 0 or row == h - 1 or col == 0 or col == w - 1
				if is_edge:
					# Check if this is the door position
					var is_door = false
					match door_side:
						0: is_door = row == h - 1 and col == door_x
						1: is_door = row == 0 and col == door_x
						2: is_door = col == 0 and row == h / 2
						3: is_door = col == w - 1 and row == h / 2
					line.append("door" if is_door else "wall")
				else:
					# Interior — occasional feature
					if rng.randf() < 0.08:
						line.append("feature")
					else:
						line.append("floor")
			layout.append(line)
		result["layout"] = layout
	elif stype == "forge":
		var w = rng.randi_range(4, 6)
		var h = rng.randi_range(3, 5)
		var layout: Array = []
		for row in range(h):
			var line: Array = []
			for col in range(w):
				var is_edge = row == 0 or row == h - 1 or col == 0 or col == w - 1
				if is_edge:
					if row == h - 1 and col == w / 2:
						line.append("door")
					else:
						line.append("wall")
				elif row == 1 and col == w / 2:
					line.append("feature")  # forge/anvil
				else:
					line.append("floor")
			layout.append(line)
		result["layout"] = layout
	return result

## Render all structures near a cell onto its image
func render_structures_on_cell(structures_system: StructureSystem, img: Image,
		cell_x: int, cell_y: int, walkability: WalkabilityGrid) -> void:
	var cell_center_x = cell_x * 128 + 64
	var cell_center_y = cell_y * 128 + 64
	var nearby = structures_system.get_structures_near(cell_center_x, cell_center_y, 80)
	for s in nearby:
		render_structure(s, img, cell_x, cell_y, walkability)

## Draw path tiles onto a terrain image and stamp walkability
func render_paths_on_cell(path_tiles: Array, img: Image, cell_x: int, cell_y: int,
		walkability: WalkabilityGrid) -> void:
	var cell_base_x = cell_x * 128
	var cell_base_y = cell_y * 128

	var path_scale = 32  # Must match tile_size
	for pos in path_tiles:
		var local_x = pos.x - cell_base_x
		var local_y = pos.y - cell_base_y
		var rx = local_x * path_scale
		var ry = local_y * path_scale
		var img_size = 128 * path_scale
		if rx >= 0 and rx < img_size and ry >= 0 and ry < img_size:
			# Vary path color per-tile for cobblestone/dirt texture feel
			var hash_val = ((pos.x * 73856093) ^ (pos.y * 19349663)) & 0xFF
			var variation = (hash_val / 255.0 - 0.5) * 0.1
			var path_color: Color
			if hash_val % 7 == 0:
				# Occasional darker stone
				path_color = Color(0.45 + variation, 0.38 + variation, 0.28 + variation)
			elif hash_val % 11 == 0:
				# Occasional lighter sand
				path_color = Color(0.68 + variation, 0.58 + variation, 0.42 + variation)
			else:
				# Standard dirt
				path_color = Color(0.58 + variation, 0.48 + variation, 0.34 + variation)
			for ty in range(path_scale):
				for tx in range(path_scale):
					if rx + tx < img_size and ry + ty < img_size:
						img.set_pixel(rx + tx, ry + ty, path_color)
		if walkability:
			walkability.set_path(pos.x, pos.y)

## Get the visual definition for a structure type
func get_visual_def(structure_type: String) -> Dictionary:
	return _visual_defs.get(structure_type, {})

## Check if a structure type has a visual definition
func has_visual_def(structure_type: String) -> bool:
	return _visual_defs.has(structure_type)
