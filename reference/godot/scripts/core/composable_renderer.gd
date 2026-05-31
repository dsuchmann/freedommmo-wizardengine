class_name ComposableRenderer
extends RefCounted

## Layered sprite compositor for entities.
## Visual appearance is ALWAYS a derivative of simulation state.
## Pipeline: base_body + equipment_overlays + status_effects → final texture

const CANVAS_SIZE: int = 64  # Default composite canvas size

const LAYER_ORDER: Array = [
	"body",        # Layer 0: Nude base body (species + gender + variant)
	"undergarment",# Layer 1: Undergarments
	"legs",        # Layer 2: Leg armor/pants
	"feet",        # Layer 3: Boots/shoes
	"chest",       # Layer 4: Chest armor/clothing
	"hands",       # Layer 5: Gloves/gauntlets
	"head",        # Layer 6: Helmet/hat/hood
	"back",        # Layer 7: Cape/backpack
	"off_hand",    # Layer 8: Shield/offhand item
	"main_hand",   # Layer 9: Weapon/tool (drawn last = on top)
	"effect",      # Layer 10: Status effect overlays (glow, aura)
]

const DIRECTIONS: Array = [
	"south", "south-west", "west", "north-west",
	"north", "north-east", "east", "south-east",
]

var _cache: Dictionary = {}  # cache_key → ImageTexture
var _body_images: Dictionary = {}  # "{species}_{gender}_{variant}_{dir}" → Image
var _equipment_images: Dictionary = {}  # "{item_id}_{dir}" → Image

func composite_entity(entity: EntityBody, direction: String = "south") -> ImageTexture:
	var cache_key = _build_cache_key(entity, direction)
	if _cache.has(cache_key):
		return _cache[cache_key]

	var result = _build_composite(entity, direction)
	if result:
		_cache[cache_key] = result
	return result

func invalidate_cache(entity_id: int) -> void:
	var keys_to_remove: Array = []
	for key in _cache:
		if key.begins_with("%d_" % entity_id):
			keys_to_remove.append(key)
	for key in keys_to_remove:
		_cache.erase(key)

func invalidate_all() -> void:
	_cache.clear()

func _build_cache_key(entity: EntityBody, direction: String) -> String:
	var key = "%d_%s_%d" % [entity.entity_id, direction, entity.species]
	for slot in LAYER_ORDER:
		if slot == "body" or slot == "effect":
			continue
		var item = entity.equipment.get(slot)
		if item and item is Dictionary:
			key += "_%s" % item.get("name", "none")
		else:
			key += "_empty"
	return key

func _build_composite(entity: EntityBody, direction: String) -> ImageTexture:
	var size := 64  # Match pro mode sprite size
	var canvas := Image.create(size, size, true, Image.FORMAT_RGBA8)

	# Layer 0: Base body
	var body_img = _get_body_image(entity, direction)
	if body_img:
		canvas.blend_rect(body_img, Rect2i(0, 0, body_img.get_width(), body_img.get_height()), Vector2i.ZERO)

	# Layer 0.5: Anatomical details (procedural — drawn on body before equipment)
	_draw_anatomical_details(canvas, entity.species, entity.gender, direction, size)

	# Layers 1-9: Equipment overlays
	for slot in LAYER_ORDER:
		if slot == "body" or slot == "effect":
			continue
		var item = entity.equipment.get(slot)
		if item == null or not (item is Dictionary):
			continue
		var equip_img = _get_equipment_image(item, direction)
		if equip_img:
			canvas.blend_rect(equip_img, Rect2i(0, 0, equip_img.get_width(), equip_img.get_height()), Vector2i.ZERO)

	# Layer 10: Status effects (tint overlay)
	_apply_status_tint(canvas, entity)

	if canvas.get_width() == 0:
		return null
	return ImageTexture.create_from_image(canvas)

func _get_body_image(entity: EntityBody, direction: String) -> Image:
	var gender = entity.gender if entity.gender != "" else "male"
	var variant = "default"
	var key = "%d_%s_%s_%s" % [entity.species, gender, variant, direction]
	if _body_images.has(key):
		return _body_images[key]

	# Try loading from disk — check with and without variant suffix
	var species_name = _species_dir(entity.species)
	var path = "res://assets/characters/bodies/%s_%s/rotations/%s.png" % [species_name, gender, direction]
	if not FileAccess.file_exists(path):
		path = "res://assets/characters/bodies/%s_%s_%s/rotations/%s.png" % [species_name, gender, variant, direction]
	if FileAccess.file_exists(path):
		var img = Image.load_from_file(path)
		if img:
			if img.get_width() != CANVAS_SIZE or img.get_height() != CANVAS_SIZE:
				img.resize(CANVAS_SIZE, CANVAS_SIZE, Image.INTERPOLATE_NEAREST)
			_body_images[key] = img
			return img

	# Fallback: try old test sprites
	var fallback_path = "res://assets/characters/%s/rotations/%s.png" % [_species_fallback_dir(entity.species), direction]
	if FileAccess.file_exists(fallback_path):
		var img = Image.load_from_file(fallback_path)
		if img:
			if img.get_width() != CANVAS_SIZE or img.get_height() != CANVAS_SIZE:
				img.resize(CANVAS_SIZE, CANVAS_SIZE, Image.INTERPOLATE_NEAREST)
			_body_images[key] = img
			return img

	# Final fallback: generate a colored silhouette
	var img = _generate_placeholder_body(entity.species, direction, entity.entity_id)
	_body_images[key] = img
	return img

func _get_equipment_image(item: Dictionary, direction: String) -> Image:
	var item_name = item.get("name", "unknown")
	var key = "%s_%s" % [item_name.to_lower().replace(" ", "_"), direction]
	if _equipment_images.has(key):
		return _equipment_images[key]

	var size = 64
	var path = "res://assets/equipment/%s/rotations/%s.png" % [item_name.to_lower().replace(" ", "_"), direction]
	if FileAccess.file_exists(path):
		var img = Image.load_from_file(path)
		if img:
			if img.get_width() != size or img.get_height() != size:
				img.resize(size, size, Image.INTERPOLATE_NEAREST)
			_equipment_images[key] = img
			return img

	# Procedural equipment overlay — draw colored shapes based on slot + material
	var facing_front = direction in ["south", "south-east", "south-west"]
	var img = _generate_procedural_equipment(item, direction, size, facing_front)
	if img:
		_equipment_images[key] = img
	return img

func _generate_procedural_equipment(item: Dictionary, direction: String, size: int, facing_front: bool) -> Image:
	var slot = item.get("slot", "")
	if slot.is_empty():
		return null
	var img = Image.create(size, size, true, Image.FORMAT_RGBA8)
	var cx = size / 2
	# Determine equipment color from materials/name
	var equip_color = _equipment_color(item)
	var highlight = equip_color.lightened(0.2)
	var shadow = equip_color.darkened(0.2)

	match slot:
		"chest":
			# Torso armor — covers chest area
			var top_y = int(size * 0.32)
			var bot_y = int(size * 0.52)
			var half_w = int(size * 0.12)
			for y in range(top_y, bot_y):
				for x in range(cx - half_w, cx + half_w):
					var c = equip_color if y > top_y + 1 else highlight
					_safe_pixel(img, x, y, c)
			# Shoulder pads
			if facing_front:
				for dx in [-1, 1]:
					_safe_pixel(img, cx + half_w * dx + dx, top_y, highlight)
					_safe_pixel(img, cx + half_w * dx + dx, top_y + 1, equip_color)
		"legs", "upper_legs":
			var top_y = int(size * 0.52)
			var bot_y = int(size * 0.68)
			var half_w = int(size * 0.08)
			for y in range(top_y, bot_y):
				for x in range(cx - half_w, cx + half_w):
					img.set_pixel(x, y, equip_color)
		"feet":
			var y = int(size * 0.72)
			var half_w = int(size * 0.06)
			for dy in range(3):
				for x in range(cx - half_w, cx + half_w):
					_safe_pixel(img, x, y + dy, equip_color)
		"head":
			var top_y = int(size * 0.18)
			var half_w = int(size * 0.08)
			for dy in range(4):
				for x in range(cx - half_w - 1, cx + half_w + 1):
					_safe_pixel(img, x, top_y + dy, equip_color)
		"main_hand":
			# Weapon — line extending from hand
			if facing_front:
				var hand_x = cx + int(size * 0.12)
				var hand_y = int(size * 0.48)
				for dy in range(8):
					_safe_pixel(img, hand_x, hand_y + dy, equip_color)
					if dy < 2:
						_safe_pixel(img, hand_x - 1, hand_y + dy, highlight)
		"off_hand":
			# Shield — small colored block on opposite side
			if facing_front:
				var shield_x = cx - int(size * 0.14)
				var shield_y = int(size * 0.40)
				for dy in range(5):
					for dx in range(3):
						_safe_pixel(img, shield_x + dx, shield_y + dy, equip_color)
		_:
			return null

	return img

func _equipment_color(item: Dictionary) -> Color:
	var name_lower = item.get("name", "").to_lower()
	if "iron" in name_lower: return Color(0.55, 0.55, 0.6)
	if "steel" in name_lower: return Color(0.7, 0.7, 0.75)
	if "leather" in name_lower: return Color(0.5, 0.35, 0.2)
	if "cloth" in name_lower: return Color(0.7, 0.65, 0.55)
	if "gold" in name_lower: return Color(0.85, 0.75, 0.2)
	if "mithril" in name_lower: return Color(0.6, 0.7, 0.9)
	if "wood" in name_lower: return Color(0.55, 0.35, 0.15)
	if "fine" in name_lower: return Color(0.3, 0.2, 0.5)
	return Color(0.5, 0.45, 0.4)

func _draw_anatomical_details(canvas: Image, species: int, gender: String, direction: String, size: int) -> void:
	# Only draw on front-facing directions where anatomy is visible
	var facing_front = direction in ["south", "south-east", "south-west"]
	var facing_side = direction in ["east", "west"]
	if not facing_front and not facing_side:
		return

	var cx = size / 2  # Center x
	# Skin tone varies by species
	var skin = _species_skin_tone(species)
	var nipple_color = skin.darkened(0.25)
	var navel_color = skin.darkened(0.2)

	if facing_front:
		# Nipples — positioned on chest
		var chest_y = int(size * 0.38)
		if gender == "male":
			var nipple_offset = int(size * 0.06)
			_safe_pixel(canvas, cx - nipple_offset, chest_y, nipple_color)
			_safe_pixel(canvas, cx + nipple_offset, chest_y, nipple_color)
		else:
			# Female — slightly larger breast area with nipples
			var breast_offset = int(size * 0.07)
			var breast_y = int(size * 0.36)
			_safe_pixel(canvas, cx - breast_offset, breast_y, skin.lightened(0.05))
			_safe_pixel(canvas, cx + breast_offset, breast_y, skin.lightened(0.05))
			_safe_pixel(canvas, cx - breast_offset, breast_y + 1, nipple_color)
			_safe_pixel(canvas, cx + breast_offset, breast_y + 1, nipple_color)

		# Navel
		var navel_y = int(size * 0.48)
		_safe_pixel(canvas, cx, navel_y, navel_color)

		# Genitalia
		var genital_y = int(size * 0.55)
		var genital_color = skin.darkened(0.15)
		if gender == "male":
			# Penis and testicles
			_safe_pixel(canvas, cx, genital_y, genital_color)
			_safe_pixel(canvas, cx, genital_y + 1, genital_color)
			_safe_pixel(canvas, cx - 1, genital_y + 2, genital_color.darkened(0.1))
			_safe_pixel(canvas, cx + 1, genital_y + 2, genital_color.darkened(0.1))
		else:
			# Vulva
			_safe_pixel(canvas, cx, genital_y, genital_color.darkened(0.1))
			_safe_pixel(canvas, cx, genital_y + 1, genital_color.darkened(0.15))

	elif facing_side:
		# Side view — minimal detail
		var chest_y = int(size * 0.38)
		if gender == "female":
			var breast_x = cx + (2 if direction == "east" else -2)
			_safe_pixel(canvas, breast_x, chest_y, skin.lightened(0.05))
			_safe_pixel(canvas, breast_x, chest_y + 1, nipple_color)

		# Side genital hint
		var genital_y = int(size * 0.55)
		var genital_x = cx + (1 if direction == "east" else -1)
		if gender == "male":
			_safe_pixel(canvas, genital_x, genital_y, skin.darkened(0.15))

	# Buttocks for rear-facing handled elsewhere (not drawn for now)

func _safe_pixel(img: Image, x: int, y: int, color: Color) -> void:
	if x >= 0 and x < img.get_width() and y >= 0 and y < img.get_height():
		# Only draw on non-transparent pixels (body area)
		var existing = img.get_pixel(x, y)
		if existing.a > 0.1:
			img.set_pixel(x, y, color)

func _species_skin_tone(species: int) -> Color:
	match species:
		EntityBody.Species.HUMAN: return Color(0.87, 0.72, 0.58)
		EntityBody.Species.ELF: return Color(0.9, 0.85, 0.75)
		EntityBody.Species.DWARF: return Color(0.8, 0.65, 0.5)
		EntityBody.Species.ORC: return Color(0.3, 0.55, 0.25)
		EntityBody.Species.GOBLIN: return Color(0.4, 0.6, 0.3)
		_: return Color(0.8, 0.7, 0.6)

func _apply_status_tint(canvas: Image, entity: EntityBody) -> void:
	# Apply visual tints based on entity state
	if entity.base_stats.get("health", 100) < entity.base_stats.get("max_health", 100) * 0.25:
		_tint_image(canvas, Color(1.0, 0.3, 0.3, 0.15))  # Low HP red tint
	if entity.time_pool < 1000:
		_tint_image(canvas, Color(0.5, 0.5, 1.0, 0.1))  # Low time blue tint

func _tint_image(img: Image, tint: Color) -> void:
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			var pixel = img.get_pixel(x, y)
			if pixel.a > 0.01:
				var blended = pixel.lerp(tint, tint.a)
				blended.a = pixel.a
				img.set_pixel(x, y, blended)

func _generate_placeholder_body(species: int, _direction: String, entity_id: int = 0) -> Image:
	var img = Image.create(CANVAS_SIZE, CANVAS_SIZE, true, Image.FORMAT_RGBA8)

	# Vary skin tone per entity
	var hash = (entity_id * 73856093) & 0x7FFFFFFF
	var skin_var = (hash % 100) / 500.0 - 0.1  # -0.1 to +0.1

	var skin_color: Color
	match species:
		EntityBody.Species.HUMAN: skin_color = Color(0.87 + skin_var, 0.72 + skin_var * 0.8, 0.58 + skin_var * 0.5)
		EntityBody.Species.ELF: skin_color = Color(0.9 + skin_var * 0.5, 0.85 + skin_var * 0.3, 0.75 + skin_var)
		EntityBody.Species.DWARF: skin_color = Color(0.8 + skin_var, 0.65 + skin_var * 0.7, 0.5 + skin_var * 0.4)
		EntityBody.Species.ORC: skin_color = Color(0.3 + skin_var * 0.5, 0.55 + skin_var, 0.25 + skin_var * 0.3)
		EntityBody.Species.GOBLIN: skin_color = Color(0.4 + skin_var, 0.6 + skin_var * 0.5, 0.3 + skin_var * 0.3)
		EntityBody.Species.DRAGON: skin_color = Color(0.6 + skin_var, 0.2 + skin_var * 0.3, 0.2 + skin_var * 0.2)
		_: skin_color = Color(0.7 + skin_var, 0.6 + skin_var, 0.5 + skin_var)
	skin_color = skin_color.clamp()

	# Hair color varies per entity
	var hair_colors = [
		Color(0.15, 0.1, 0.05), Color(0.4, 0.25, 0.1), Color(0.7, 0.55, 0.3),
		Color(0.85, 0.75, 0.5), Color(0.6, 0.15, 0.1), Color(0.2, 0.2, 0.2),
		Color(0.9, 0.9, 0.85), Color(0.3, 0.15, 0.4),
	]
	var hair_color = hair_colors[hash % hair_colors.size()]

	# Body proportions vary
	var body_width = 4 + (hash / 100 % 3)  # 4-6
	var head_size = 4 + (hash / 1000 % 2)  # 4-5
	var leg_length = 7 + (hash / 10000 % 3)  # 7-9
	var cx := CANVAS_SIZE / 2
	var cy := int(CANVAS_SIZE * 0.46)

	# Dwarves are shorter and wider
	if species == EntityBody.Species.DWARF:
		body_width += 2
		leg_length -= 2
		cy += 3
	# Goblins are small
	elif species == EntityBody.Species.GOBLIN:
		body_width -= 1
		head_size -= 1
		leg_length -= 2
		cy += 4
	# Orcs are big
	elif species == EntityBody.Species.ORC:
		body_width += 1
		leg_length += 1

	# Hair
	for dy in range(-head_size - 2, -head_size + 2):
		for dx in range(-head_size, head_size + 1):
			if dx * dx + (dy + 1) * (dy + 1) < head_size * head_size + 4:
				var px = cx + dx
				var py = cy + dy
				if px >= 0 and px < CANVAS_SIZE and py >= 0 and py < CANVAS_SIZE:
					img.set_pixel(px, py, hair_color)
	# Head
	for dy in range(-head_size, 0):
		for dx in range(-head_size + 1, head_size):
			if dx * dx + dy * dy < head_size * head_size:
				var px = cx + dx
				var py = cy + dy
				if px >= 0 and px < CANVAS_SIZE and py >= 0 and py < CANVAS_SIZE:
					img.set_pixel(px, py, skin_color)
	# Eyes
	var eye_color = Color(0.1, 0.1, 0.1)
	if cx - 2 >= 0 and cy - 2 >= 0:
		img.set_pixel(cx - 2, cy - 2, eye_color)
		img.set_pixel(cx + 1, cy - 2, eye_color)
	# Torso
	for dy in range(0, 8):
		for dx in range(-body_width, body_width + 1):
			if abs(dx) < body_width - dy / 5:
				var px = cx + dx
				var py = cy + dy
				if px >= 0 and px < CANVAS_SIZE and py >= 0 and py < CANVAS_SIZE:
					img.set_pixel(px, py, skin_color)
	# Arms
	for dy in range(1, 6):
		for side in [-1, 1]:
			var px = cx + side * (body_width + 1)
			var py = cy + dy
			if px >= 0 and px < CANVAS_SIZE and py >= 0 and py < CANVAS_SIZE:
				img.set_pixel(px, py, skin_color)
	# Legs
	for dy in range(8, 8 + leg_length):
		for side in [-1, 1]:
			for dx in range(0, 2):
				var px = cx + side * (1 + dx)
				var py = cy + dy
				if px >= 0 and px < CANVAS_SIZE and py >= 0 and py < CANVAS_SIZE:
					img.set_pixel(px, py, skin_color)
	return img

func _species_dir(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "human"
		EntityBody.Species.ELF: return "elf"
		EntityBody.Species.DWARF: return "dwarf"
		EntityBody.Species.ORC: return "orc"
		EntityBody.Species.GOBLIN: return "goblin"
		EntityBody.Species.DRAGON: return "dragon"
		_: return "human"

func _species_fallback_dir(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "hero_knight_v2"
		EntityBody.Species.ELF: return "elf_merchant"
		EntityBody.Species.DWARF: return "dwarf_miner_v2"
		EntityBody.Species.ORC: return "orc_warrior_v2"
		EntityBody.Species.GOBLIN: return "goblin_thief_v2"
		_: return "hero_knight_v2"

func get_direction_from_velocity(vx: float, vy: float) -> String:
	if abs(vx) < 0.01 and abs(vy) < 0.01:
		return "south"
	var angle = atan2(vy, vx)
	var idx = int(round((angle + PI) / (PI / 4.0))) % 8
	var dir_map = ["west", "north-west", "north", "north-east",
		"east", "south-east", "south", "south-west"]
	return dir_map[idx]
