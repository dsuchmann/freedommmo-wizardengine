class_name EntityBody
extends RefCounted

signal equipment_changed(slot: String)
signal stat_recalculated

enum Species {
	HUMAN, ELF, DWARF, ORC, GOBLIN, OGRE, GREMLIN, GHOUL,
	ALIEN, DRAGON, GOD, SPIRIT, CONSTRUCT, ELEMENTAL, DEMON, ANGEL,
}

const EQUIPMENT_SLOTS: Array = [
	"head", "face", "ears", "neck", "shoulders",
	"upper_arms", "lower_arms", "hands", "fingers",
	"chest", "back", "waist",
	"upper_legs", "lower_legs", "feet", "ankles",
	"tattoos", "implants", "accessories",
	"main_hand", "off_hand", "ranged",
]

var entity_id: int = 0
var species: int = Species.HUMAN
var gender: String = "male"  # "male" or "female"
var name: String = ""
var age: float = 18.0

var base_stats: Dictionary = {
	"strength": 10.0, "dexterity": 10.0, "constitution": 10.0,
	"intelligence": 10.0, "wisdom": 10.0, "charisma": 10.0,
	"health": 100.0, "max_health": 100.0, "stamina": 100.0,
	"mana": 50.0, "speed": 5.0, "defense": 0.0, "attack": 5.0,
}

var equipment: Dictionary = {}
var body_state: Dictionary = {
	"injuries": [],
	"missing_parts": [],
	"conditions": [],
}

var mind: MindStack
var time_pool: float = 36000.0

func _init(p_id: int = 0, p_species: int = Species.HUMAN) -> void:
	entity_id = p_id
	species = p_species
	mind = MindStack.new()
	mind.entity_id = p_id
	for slot in EQUIPMENT_SLOTS:
		equipment[slot] = null

func equip(slot: String, item: Dictionary) -> bool:
	if slot not in EQUIPMENT_SLOTS:
		return false
	equipment[slot] = item
	_recalculate_stats()
	equipment_changed.emit(slot)
	return true

func unequip(slot: String) -> Dictionary:
	if slot not in EQUIPMENT_SLOTS:
		return {}
	var item: Dictionary = equipment.get(slot, {})
	equipment[slot] = null
	_recalculate_stats()
	equipment_changed.emit(slot)
	return item if item else {}

func get_equipped(slot: String):
	return equipment.get(slot)

func get_computed_stats() -> Dictionary:
	var stats = base_stats.duplicate()
	for slot in EQUIPMENT_SLOTS:
		var item = equipment[slot]
		if item and item is Dictionary and item.has("stat_bonuses"):
			for stat_key in item["stat_bonuses"]:
				if stats.has(stat_key):
					stats[stat_key] += item["stat_bonuses"][stat_key]
	for injury in body_state["injuries"]:
		if injury.has("stat_penalties"):
			for stat_key in injury["stat_penalties"]:
				if stats.has(stat_key):
					stats[stat_key] -= injury["stat_penalties"][stat_key]
	return stats

func add_injury(part: String, severity: float, description: String = "") -> void:
	body_state["injuries"].append({
		"part": part, "severity": severity, "description": description,
		"stat_penalties": _injury_penalties(part, severity),
	})

func lose_body_part(part: String) -> void:
	if part not in body_state["missing_parts"]:
		body_state["missing_parts"].append(part)
	if equipment.has(part):
		equipment[part] = null

func has_body_part(part: String) -> bool:
	return part not in body_state["missing_parts"]

func is_alive() -> bool:
	return get_computed_stats().get("health", 0.0) > 0.0 and time_pool > 0.0

func get_visual_layers() -> Array:
	var layers: Array = []
	layers.append({"type": "body", "species": species, "body_state": body_state})
	var slot_order := ["feet", "lower_legs", "upper_legs", "waist", "chest",
		"shoulders", "upper_arms", "lower_arms", "hands", "neck",
		"head", "face", "ears", "main_hand", "off_hand", "accessories"]
	for slot in slot_order:
		var item = equipment.get(slot)
		if item:
			layers.append({"type": "equipment", "slot": slot, "item": item})
	return layers

func to_dict() -> Dictionary:
	return {
		"entity_id": entity_id, "species": species, "name": name,
		"age": age, "base_stats": base_stats, "equipment": equipment,
		"body_state": body_state, "time_pool": time_pool,
		"mind": mind.to_dict(),
	}

static func from_dict(d: Dictionary) -> EntityBody:
	var body := EntityBody.new(int(d.get("entity_id", 0)), int(d.get("species", 0)))
	body.name = d.get("name", "")
	body.age = float(d.get("age", 18.0))
	body.base_stats = d.get("base_stats", body.base_stats)
	body.equipment = d.get("equipment", body.equipment)
	body.body_state = d.get("body_state", body.body_state)
	body.time_pool = float(d.get("time_pool", 36000.0))
	if d.has("mind"):
		body.mind = MindStack.from_dict(d["mind"])
	return body

func _recalculate_stats() -> void:
	stat_recalculated.emit()

func _injury_penalties(part: String, severity: float) -> Dictionary:
	match part:
		"hands", "fingers":
			return {"dexterity": severity * 5.0, "attack": severity * 3.0}
		"legs", "upper_legs", "lower_legs", "feet":
			return {"speed": severity * 3.0, "dexterity": severity * 2.0}
		"head":
			return {"intelligence": severity * 5.0, "wisdom": severity * 3.0}
		"chest", "back":
			return {"constitution": severity * 4.0, "health": severity * 20.0}
		"arms", "upper_arms", "lower_arms":
			return {"strength": severity * 4.0, "attack": severity * 3.0}
		_:
			return {"health": severity * 5.0}
