class_name EntityRenderer
extends RefCounted

const SPECIES_BASE_COLORS: Dictionary = {
	EntityBody.Species.HUMAN: Color(0.9, 0.75, 0.6),
	EntityBody.Species.ELF: Color(0.85, 0.8, 0.7),
	EntityBody.Species.DWARF: Color(0.8, 0.65, 0.5),
	EntityBody.Species.ORC: Color(0.4, 0.55, 0.3),
	EntityBody.Species.GOBLIN: Color(0.5, 0.6, 0.3),
	EntityBody.Species.DRAGON: Color(0.3, 0.4, 0.5),
	EntityBody.Species.DEMON: Color(0.6, 0.2, 0.2),
	EntityBody.Species.ANGEL: Color(0.95, 0.92, 0.85),
}

const SLOT_COLORS: Dictionary = {
	"chest": Color(0.3, 0.3, 0.6),
	"head": Color(0.5, 0.5, 0.5),
	"feet": Color(0.4, 0.25, 0.1),
	"hands": Color(0.45, 0.3, 0.15),
	"waist": Color(0.35, 0.25, 0.15),
	"main_hand": Color(0.6, 0.6, 0.6),
	"off_hand": Color(0.5, 0.5, 0.5),
}

var _pixellab_cache: Dictionary = {}

func render_entity_fallback(entity: EntityBody, size: int = 32) -> Image:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var base_color: Color = SPECIES_BASE_COLORS.get(entity.species, Color(0.8, 0.7, 0.6))

	_draw_body(img, size, base_color, entity)
	_draw_equipment_layers(img, size, entity)
	_draw_injuries(img, size, entity)
	return img

func get_render_layers(entity: EntityBody) -> Array:
	return entity.get_visual_layers()

func _draw_body(img: Image, size: int, color: Color, entity: EntityBody) -> void:
	var head_y := int(size * 0.05)
	var head_h := int(size * 0.25)
	var body_y := head_y + head_h
	var body_h := int(size * 0.4)
	var leg_y := body_y + body_h
	var leg_h := size - leg_y

	for y in range(head_y, head_y + head_h):
		for x in range(int(size * 0.3), int(size * 0.7)):
			img.set_pixel(x, y, color)

	var body_color := color.darkened(0.1)
	for y in range(body_y, body_y + body_h):
		for x in range(int(size * 0.25), int(size * 0.75)):
			img.set_pixel(x, y, body_color)

	if entity.has_body_part("upper_legs"):
		for y in range(leg_y, mini(leg_y + leg_h, size)):
			for x in range(int(size * 0.25), int(size * 0.45)):
				img.set_pixel(x, y, color.darkened(0.15))
			for x in range(int(size * 0.55), int(size * 0.75)):
				img.set_pixel(x, y, color.darkened(0.15))

func _draw_equipment_layers(img: Image, size: int, entity: EntityBody) -> void:
	for slot in ["chest", "waist", "head", "feet", "hands", "main_hand"]:
		var item = entity.get_equipped(slot)
		if item and item is Dictionary:
			var color: Color = SLOT_COLORS.get(slot, Color(0.5, 0.5, 0.5))
			if item.has("color"):
				color = Color(item["color"])
			_draw_slot_overlay(img, size, slot, color)

func _draw_slot_overlay(img: Image, size: int, slot: String, color: Color) -> void:
	var region: Rect2i
	match slot:
		"head":
			region = Rect2i(int(size * 0.28), int(size * 0.03), int(size * 0.44), int(size * 0.12))
		"chest":
			region = Rect2i(int(size * 0.23), int(size * 0.3), int(size * 0.54), int(size * 0.3))
		"waist":
			region = Rect2i(int(size * 0.23), int(size * 0.55), int(size * 0.54), int(size * 0.1))
		"feet":
			region = Rect2i(int(size * 0.2), int(size * 0.85), int(size * 0.6), int(size * 0.12))
		"hands":
			region = Rect2i(int(size * 0.15), int(size * 0.5), int(size * 0.15), int(size * 0.12))
		"main_hand":
			region = Rect2i(int(size * 0.75), int(size * 0.2), int(size * 0.1), int(size * 0.45))
		_:
			return
	for y in range(region.position.y, mini(region.position.y + region.size.y, size)):
		for x in range(region.position.x, mini(region.position.x + region.size.x, size)):
			if x >= 0 and x < size:
				img.set_pixel(x, y, color)

func _draw_injuries(img: Image, size: int, entity: EntityBody) -> void:
	for part in entity.body_state.get("missing_parts", []):
		match part:
			"upper_arms", "lower_arms", "hands":
				for y in range(int(size * 0.3), int(size * 0.6)):
					for x in range(int(size * 0.15), int(size * 0.25)):
						if x >= 0 and x < size:
							img.set_pixel(x, y, Color(0, 0, 0, 0))
