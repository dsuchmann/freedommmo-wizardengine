class_name LootSystem
extends RefCounted

var _drop_tables: Dictionary = {}
var _world_items: Dictionary = {}
var _next_item_id: int = 5000

func _init() -> void:
	_init_drop_tables()

func generate_loot(entity: EntityBody) -> Array:
	var drops: Array = []
	var table_key := _species_to_table(entity.species)
	var table: Array = _drop_tables.get(table_key, _drop_tables.get("default", []))

	for entry in table:
		if randf() <= entry.get("chance", 0.5):
			var item = entry.duplicate()
			item.erase("chance")
			drops.append(item)

	# Time-based loot: defeated entities drop time crystals
	if entity.time_pool > 100:
		drops.append({
			"name": "Time Shard",
			"description": "Crystallized time. Restores 50 time units.",
			"type": "consumable",
			"effects": [{"type": "restore_time", "amount": 50.0}],
		})

	# Drop equipped items
	for slot in entity.equipment:
		var item = entity.equipment[slot]
		if item and item is Dictionary and not item.is_empty():
			drops.append(item)

	# Gold drop based on NPC level/age
	var gold_amount = int(entity.age * 0.5 + randf() * 10)
	if gold_amount > 0:
		drops.append({
			"name": "Gold (%d)" % gold_amount,
			"description": "%d gold coins" % gold_amount,
			"type": "currency",
			"gold_value": gold_amount,
		})

	return drops

func drop_items_at(items: Array, world_x: int, world_y: int) -> void:
	for item in items:
		_next_item_id += 1
		_world_items[_next_item_id] = {
			"item": item,
			"world_x": world_x,
			"world_y": world_y,
			"id": _next_item_id,
		}

func pickup_items_near(world_x: int, world_y: int, radius: int = 3) -> Array:
	var picked: Array = []
	var to_remove: Array = []
	for id in _world_items:
		var data: Dictionary = _world_items[id]
		var dx: int = abs(data["world_x"] - world_x)
		var dy: int = abs(data["world_y"] - world_y)
		if dx <= radius and dy <= radius:
			picked.append(data["item"])
			to_remove.append(id)
	for id in to_remove:
		_world_items.erase(id)
	return picked

func get_items_near(world_x: int, world_y: int, radius: int = 10) -> Array:
	var result: Array = []
	for id in _world_items:
		var data: Dictionary = _world_items[id]
		var dx: int = abs(data["world_x"] - world_x)
		var dy: int = abs(data["world_y"] - world_y)
		if dx <= radius and dy <= radius:
			result.append(data)
	return result

func world_item_count() -> int:
	return _world_items.size()

func _species_to_table(species: int) -> String:
	match species:
		EntityBody.Species.HUMAN: return "humanoid"
		EntityBody.Species.ELF: return "humanoid"
		EntityBody.Species.DWARF: return "dwarf"
		EntityBody.Species.ORC: return "orc"
		EntityBody.Species.GOBLIN: return "goblin"
		_: return "default"

func _init_drop_tables() -> void:
	_drop_tables["humanoid"] = [
		{"name": "Bread", "description": "Stale but edible", "type": "consumable", "chance": 0.6, "effect": {"restore_health": 15.0}},
		{"name": "Copper Coin", "description": "Common currency", "type": "currency", "chance": 0.8, "value": 5},
		{"name": "Cloth Scrap", "description": "Can be used for bandages", "type": "material", "chance": 0.4},
		{"name": "Simple Ring", "description": "+1 Wisdom", "type": "equipment", "slot": "fingers", "chance": 0.1, "stat_bonuses": {"wisdom": 1.0}},
	]
	_drop_tables["orc"] = [
		{"name": "Bone Club", "description": "Crude but effective", "type": "equipment", "slot": "main_hand", "chance": 0.5, "stat_bonuses": {"attack": 8.0}},
		{"name": "Tusk Fragment", "description": "Sharp and valuable", "type": "material", "chance": 0.7},
		{"name": "Raw Meat", "description": "Cook before eating", "type": "consumable", "chance": 0.6, "effect": {"restore_health": 10.0}},
		{"name": "War Paint", "description": "+2 Strength when applied", "type": "consumable", "chance": 0.3, "effect": {"buff_strength": 2.0}},
	]
	_drop_tables["goblin"] = [
		{"name": "Rusty Dagger", "description": "Small and sharp", "type": "equipment", "slot": "main_hand", "chance": 0.4, "stat_bonuses": {"attack": 4.0, "dexterity": 2.0}},
		{"name": "Shiny Trinket", "description": "Goblins love these", "type": "material", "chance": 0.5, "value": 3},
		{"name": "Mushroom", "description": "Questionable edibility", "type": "consumable", "chance": 0.7, "effect": {"restore_health": 5.0}},
	]
	_drop_tables["dwarf"] = [
		{"name": "Iron Nugget", "description": "Raw iron ore", "type": "material", "chance": 0.6},
		{"name": "Ale Flask", "description": "Dwarven courage in a bottle", "type": "consumable", "chance": 0.5, "effect": {"restore_health": 20.0, "buff_strength": 1.0}},
		{"name": "Steel Gauntlets", "description": "+3 Defense, +2 Strength", "type": "equipment", "slot": "hands", "chance": 0.15, "stat_bonuses": {"defense": 3.0, "strength": 2.0}},
	]
	_drop_tables["default"] = [
		{"name": "Strange Stone", "description": "Warm to the touch", "type": "material", "chance": 0.5},
	]
