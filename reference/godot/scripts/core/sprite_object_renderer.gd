class_name SpriteObjectRenderer
extends RefCounted

## Renders world objects (trees, rocks, bushes, flowers) as Sprite2D nodes
## using downloaded PixelLab sprites. Falls back to procedural shapes if
## sprite files aren't available.

const TILE_PX = 8  # Must match world tile scale

var _object_textures: Dictionary = {}  # "pine_tree" → Array[Texture2D]
var _spawned_cells: Dictionary = {}  # Vector2i(cx,cy) → true

func _init() -> void:
	_load_object_textures()
	print("SpriteObjectRenderer: %d texture categories loaded" % _object_textures.size())

func _load_object_textures() -> void:
	# Load PixelLab nature objects by scanning the directory
	var nature_dir = "res://assets/objects/nature/"
	if DirAccess.dir_exists_absolute(nature_dir):
		var dir = DirAccess.open(nature_dir)
		if dir:
			dir.list_dir_begin()
			var file = dir.get_next()
			var textures: Array = []
			while file != "":
				if file.ends_with(".png") and not file.ends_with(".import"):
					var tex = load(nature_dir + file)
					if tex is Texture2D:
						textures.append(tex)
				file = dir.get_next()
			if not textures.is_empty():
				_object_textures["nature"] = textures
				print("SpriteObjectRenderer: loaded %d nature sprites" % textures.size())

	# Load by specific tag directories
	for tag in ["furniture", "architecture"]:
		var tag_dir = "res://assets/objects/%s/" % tag
		if DirAccess.dir_exists_absolute(tag_dir):
			var dir = DirAccess.open(tag_dir)
			if dir:
				dir.list_dir_begin()
				var file = dir.get_next()
				var textures: Array = []
				while file != "":
					if file.ends_with(".png") and not file.ends_with(".import"):
						var tex = load(tag_dir + file)
						if tex is Texture2D:
							textures.append(tex)
					file = dir.get_next()
				if not textures.is_empty():
					_object_textures[tag] = textures

## Spawn objects for a cell as Sprite2D nodes
func spawn_cell_objects(objects: Array, parent: Node2D, cell_key: Vector2i) -> void:
	if _spawned_cells.has(cell_key):
		return
	_spawned_cells[cell_key] = true

	for obj in objects:
		var obj_type = obj["type"]
		var scale = obj["scale"]
		var wx = obj["world_x"] * TILE_PX
		var wy = obj["world_y"] * TILE_PX
		var obj_hash = ((obj["world_x"] * 2654435761) ^ (obj["world_y"] * 2246822519)) & 0xFFFF
		var hue_var = (obj_hash & 0xFF) / 255.0 * 0.08 - 0.04
		var size_var = ((obj_hash >> 8) & 0xFF) / 255.0 * 0.4 + 0.8

		# Try PixelLab nature sprites first
		var nature_sprites = _object_textures.get("nature", [])
		if not nature_sprites.is_empty() and obj_type in ["pine_tree", "oak_tree", "bush", "rock", "dead_stump", "fern", "mushroom"]:
			var tex = nature_sprites[obj_hash % nature_sprites.size()]
			var sprite = Sprite2D.new()
			sprite.texture = tex
			sprite.position = Vector2(wx, wy)
			# Scale to world: target ~2-4 tiles depending on object type
			var target_size = 3.0 * TILE_PX * scale * size_var
			if obj_type in ["pine_tree", "oak_tree"]:
				target_size = 4.0 * TILE_PX * scale * size_var
			elif obj_type in ["bush", "fern", "mushroom"]:
				target_size = 2.0 * TILE_PX * scale * size_var
			var tex_size = maxf(tex.get_width(), 1)
			sprite.scale = Vector2(target_size / tex_size, target_size / tex_size)
			sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			sprite.z_index = 3
			# Subtle color variation
			sprite.modulate = Color(1.0 + hue_var, 1.0 + hue_var * 0.5, 1.0 - hue_var, 1.0)
			parent.add_child(sprite)
			continue

		# Fallback: procedural Sprite2D shapes
		match obj_type:
			"pine_tree", "oak_tree":
				var trunk_h = (1.5 + size_var * 0.5)
				var trunk = _make_colored_sprite(Vector2(1, trunk_h),
					Color(0.3 + hue_var, 0.2, 0.08, 0.9))
				trunk.position = Vector2(wx, wy)
				trunk.z_index = 2
				parent.add_child(trunk)
				var cs = (3.5 if obj_type == "oak_tree" else 2.5) * scale * size_var
				var base_g = 0.4 if obj_type == "pine_tree" else 0.5
				for i in range(3):
					var lsize = cs * (1.0 - i * 0.2)
					var leaf = _make_colored_sprite(Vector2(lsize, lsize * 0.8),
						Color(0.12 + hue_var + i * 0.02, base_g + hue_var - i * 0.03, 0.08, 0.85 - i * 0.1))
					leaf.position = Vector2(wx - lsize * 0.4 + i * 0.3, wy - cs + i * 0.4)
					leaf.z_index = 3
					parent.add_child(leaf)
			"rock":
				var rw = 2.0 * scale * size_var
				var rock = _make_colored_sprite(Vector2(rw, rw * 0.7),
					Color(0.48 + hue_var, 0.46 + hue_var, 0.43, 0.8))
				rock.position = Vector2(wx, wy)
				rock.z_index = 2
				parent.add_child(rock)
			"bush":
				var bsize = 2.0 * scale * size_var
				var bush = _make_colored_sprite(Vector2(bsize, bsize * 0.7),
					Color(0.15 + hue_var, 0.42 + hue_var, 0.1, 0.75))
				bush.position = Vector2(wx - bsize * 0.3, wy)
				bush.z_index = 2
				parent.add_child(bush)
			"flower_patch":
				var flower_colors = [
					Color(0.9, 0.3, 0.4, 0.8), Color(0.9, 0.8, 0.2, 0.8),
					Color(0.6, 0.3, 0.8, 0.8), Color(1.0, 0.5, 0.2, 0.8),
				]
				var flower = _make_colored_sprite(Vector2(1, 1),
					flower_colors[obj_hash % flower_colors.size()])
				flower.position = Vector2(wx, wy)
				flower.z_index = 2
				parent.add_child(flower)
			_:
				var misc = _make_colored_sprite(Vector2(1, 1),
					Color(0.3 + hue_var, 0.5 + hue_var, 0.2, 0.5))
				misc.position = Vector2(wx, wy)
				misc.z_index = 2
				parent.add_child(misc)

func _make_colored_sprite(size: Vector2, color: Color) -> Sprite2D:
	var sprite = Sprite2D.new()
	var px_w = maxi(1, int(size.x))
	var px_h = maxi(1, int(size.y))
	var img = Image.create(px_w, px_h, false, Image.FORMAT_RGBA8)
	img.fill(color)
	sprite.texture = ImageTexture.create_from_image(img)
	sprite.centered = false
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	return sprite
