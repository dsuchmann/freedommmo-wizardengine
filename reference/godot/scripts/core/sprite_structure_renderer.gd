class_name SpriteStructureRenderer
extends RefCounted

## Renders structures as composed Sprite2D nodes using tile textures.
## Each structure tile (wall, floor, door, roof, feature) uses an actual
## texture instead of a flat ColorRect. Falls back to colored sprites if
## textures aren't available.

const TILE_PX = 8  # Must match world tile scale in GrainWorldDemo

var _tile_textures: Dictionary = {}  # "wall" → Texture2D, "floor" → Texture2D, etc.
var _structure_defs: Dictionary = {}
var _spawned: Dictionary = {}  # Vector2i(sx, sy) → true

func _init() -> void:
	_init_structure_defs()
	_load_tile_textures()

func _load_tile_textures() -> void:
	# Try to load pro tile textures, fall back to procedural
	var tile_paths := {
		"roof": "res://assets/tiles/pro/roof.png",
		"wall": "res://assets/tiles/pro/wall.png",
		"floor": "res://assets/tiles/pro/floor.png",
		"door": "res://assets/tiles/pro/door.png",
		"stone_floor": "res://assets/tiles/pro/stone_floor.png",
		"thatch_roof": "res://assets/tiles/pro/thatch_roof.png",
		"brick_wall": "res://assets/tiles/pro/brick_wall.png",
		"path": "res://assets/tiles/pro/path.png",
	}
	for key in tile_paths:
		var path = tile_paths[key]
		if ResourceLoader.exists(path):
			_tile_textures[key] = load(path)

func _init_structure_defs() -> void:
	_structure_defs["house"] = {
		"min_w": 5, "max_w": 9, "min_h": 5, "max_h": 8,
		"wall_color": Color(0.55, 0.35, 0.18),
		"floor_color": Color(0.65, 0.55, 0.38),
		"door_color": Color(0.4, 0.28, 0.15),
		"roof_color": Color(0.6, 0.22, 0.08),
	}
	_structure_defs["forge"] = {
		"min_w": 4, "max_w": 6, "min_h": 3, "max_h": 5,
		"wall_color": Color(0.35, 0.35, 0.4),
		"floor_color": Color(0.45, 0.4, 0.35),
		"door_color": Color(0.7, 0.4, 0.1),
		"roof_color": Color(0.3, 0.3, 0.35),
		"feature_color": Color(0.95, 0.5, 0.1),
	}
	_structure_defs["market_stall"] = {
		"min_w": 3, "max_w": 5, "min_h": 2, "max_h": 3,
		"wall_color": Color(0.55, 0.4, 0.2),
		"floor_color": Color(0.65, 0.55, 0.35),
		"roof_color": Color(0.7, 0.5, 0.15),
	}
	_structure_defs["well"] = {
		"min_w": 3, "max_w": 3, "min_h": 3, "max_h": 3,
		"wall_color": Color(0.5, 0.5, 0.5),
		"floor_color": Color(0.35, 0.45, 0.6),
	}

## Spawn a structure as Sprite2D nodes on the parent scene
func spawn_structure(structure: Dictionary, parent: Node2D) -> void:
	var sx = structure.get("world_x", 0)
	var sy = structure.get("world_y", 0)
	var key = Vector2i(sx, sy)
	if _spawned.has(key):
		return
	_spawned[key] = true

	var stype = structure.get("type", "house")
	var sdef = _structure_defs.get(stype, _structure_defs.get("house"))
	if sdef == null:
		return

	# Generate unique dimensions per structure
	var seed_val = (sx * 73856093) ^ (sy * 19349663)
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val
	var w = rng.randi_range(sdef.get("min_w", 5), sdef.get("max_w", 7))
	var h = rng.randi_range(sdef.get("min_h", 5), sdef.get("max_h", 7))

	# Color variation per structure
	var hue_shift = rng.randf_range(-0.06, 0.06)
	var bright_shift = rng.randf_range(-0.1, 0.1)

	var door_col = rng.randi_range(1, w - 2)

	# Spawn tile sprites
	for row in range(h):
		for col in range(w):
			var wx = (sx + col) * TILE_PX
			var wy = (sy + row) * TILE_PX
			var is_edge = row == 0 or row == h - 1 or col == 0 or col == w - 1
			var is_roof = row <= 1
			var is_door = row == h - 1 and col == door_col

			var tile_type: String
			var color: Color
			if is_door:
				tile_type = "door"
				color = sdef.get("door_color", Color(0.4, 0.3, 0.15))
			elif is_roof and is_edge:
				tile_type = "roof"
				color = sdef.get("roof_color", Color(0.6, 0.2, 0.1))
			elif is_edge:
				tile_type = "wall"
				color = sdef.get("wall_color", Color(0.5, 0.35, 0.2))
			else:
				tile_type = "floor"
				color = sdef.get("floor_color", Color(0.6, 0.5, 0.35))

			# Apply per-structure color variation
			color.r = clampf(color.r + hue_shift + bright_shift, 0, 1)
			color.g = clampf(color.g + bright_shift, 0, 1)
			color.b = clampf(color.b - hue_shift + bright_shift, 0, 1)

			# Sub-tile texture variation
			var sub_hash = ((sx + col) * 2654435761 ^ (sy + row) * 2246822519) & 0xFF
			var noise = (sub_hash / 255.0 - 0.5) * 0.08
			color.r = clampf(color.r + noise, 0, 1)
			color.g = clampf(color.g + noise * 0.8, 0, 1)
			color.b = clampf(color.b + noise * 0.6, 0, 1)

			var sprite: Sprite2D
			if _tile_textures.has(tile_type):
				var s = Sprite2D.new()
				s.texture = _tile_textures[tile_type]
				s.centered = false
				s.scale = Vector2(float(TILE_PX) / s.texture.get_width(), float(TILE_PX) / s.texture.get_height())
				s.modulate = color  # Tint the texture
				sprite = s
			else:
				# Fallback: solid color Sprite2D
				var s2 = Sprite2D.new()
				var img = Image.create(TILE_PX, TILE_PX, false, Image.FORMAT_RGBA8)
				if tile_type == "wall" and sub_hash % 3 == 0:
					color = color.darkened(0.1)
				elif tile_type == "roof" and sub_hash % 2 == 0:
					color = color.darkened(0.05)
				img.fill(color)
				s2.texture = ImageTexture.create_from_image(img)
				s2.centered = false
				sprite = s2

			sprite.position = Vector2(wx, wy)
			sprite.z_index = 3 if is_roof else 2
			parent.add_child(sprite)

## Spawn all structures near a position
func spawn_structures_near(structures_system, center_x: int, center_y: int,
		radius: int, parent: Node2D) -> void:
	var nearby = structures_system.get_structures_near(center_x, center_y, radius)
	for s in nearby:
		spawn_structure(s, parent)
