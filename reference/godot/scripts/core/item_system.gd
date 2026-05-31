class_name ItemSystem
extends RefCounted

## Grain-based item system. Items are composed of material grains
## that determine their properties. A sword made of iron has different
## stats than one made of mithril. Equipment bonuses derive from materials.

signal item_created(item: Dictionary)
signal item_consumed(item: Dictionary, entity_id: int)
signal item_broken(item: Dictionary, entity_id: int)

var _next_item_id: int = 1000
var _items: Dictionary = {}  # item_id → item dict
var _recipes: Array = []

func _init() -> void:
	_init_recipes()

func create_item(item_name: String, materials: Array = [], quality: float = 1.0) -> Dictionary:
	_next_item_id += 1
	var template = _get_template(item_name)
	var item := {
		"id": _next_item_id,
		"name": item_name,
		"type": template.get("type", "misc"),
		"slot": template.get("slot", ""),
		"description": template.get("description", ""),
		"materials": materials,
		"quality": quality,
		"durability": template.get("max_durability", 100.0) * quality,
		"max_durability": template.get("max_durability", 100.0),
		"weight": template.get("weight", 1.0),
		"value": int(template.get("base_value", 10) * quality),
		"stat_bonuses": _calculate_bonuses(template, materials, quality),
		"effects": template.get("effects", []),
		"lore": _generate_lore(item_name, materials, quality),
	}
	_items[_next_item_id] = item
	item_created.emit(item)
	return item

func use_item(item: Dictionary, entity: EntityBody) -> Dictionary:
	var item_type = item.get("type", "misc")
	match item_type:
		"consumable":
			return _consume(item, entity)
		"weapon", "armor", "accessory":
			return _equip(item, entity)
		_:
			return {"success": false, "reason": "Can't use this item"}

func _consume(item: Dictionary, entity: EntityBody) -> Dictionary:
	var effects = item.get("effects", [])
	var results: Array = []
	for effect in effects:
		var etype = effect.get("type", "")
		var amount = effect.get("amount", 0) * item.get("quality", 1.0)
		match etype:
			"heal":
				entity.base_stats["health"] = minf(
					entity.base_stats["health"] + amount,
					entity.base_stats.get("max_health", 100.0))
				results.append("Healed %.0f HP" % amount)
			"restore_time":
				entity.time_pool += amount
				results.append("Restored %.0f time" % amount)
			"restore_mana":
				entity.base_stats["mana"] = minf(
					entity.base_stats.get("mana", 0) + amount,
					entity.base_stats.get("max_mana", 100.0))
				results.append("Restored %.0f mana" % amount)
			"buff_strength":
				results.append("Strength boosted")
			"cure_poison":
				results.append("Poison cured")
	item_consumed.emit(item, entity.entity_id)
	return {"success": true, "effects": results, "message": " | ".join(results)}

func _equip(item: Dictionary, entity: EntityBody) -> Dictionary:
	var slot = item.get("slot", "")
	if slot.is_empty():
		return {"success": false, "reason": "No equipment slot"}
	entity.equip(slot, item)
	return {"success": true, "message": "Equipped %s" % item["name"]}

func degrade_item(item: Dictionary, amount: float) -> void:
	item["durability"] = maxf(0, item.get("durability", 100) - amount)
	if item["durability"] <= 0:
		item_broken.emit(item, -1)

func _calculate_bonuses(template: Dictionary, materials: Array, quality: float) -> Dictionary:
	var base = template.get("stat_bonuses", {}).duplicate()
	# Material quality modifiers
	for mat in materials:
		var mat_name = mat if mat is String else str(mat)
		match mat_name:
			"iron": pass  # baseline
			"steel":
				base["attack"] = base.get("attack", 0) + 2
				base["defense"] = base.get("defense", 0) + 1
			"mithril":
				base["attack"] = base.get("attack", 0) + 5
				base["speed"] = base.get("speed", 0) + 2
			"adamantine":
				base["attack"] = base.get("attack", 0) + 8
				base["defense"] = base.get("defense", 0) + 4
			"gold":
				base["charisma"] = base.get("charisma", 0) + 3
			"crystal":
				base["intelligence"] = base.get("intelligence", 0) + 3
				base["mana"] = base.get("mana", 0) + 20
			"bone":
				base["attack"] = base.get("attack", 0) + 1
			"wood":
				pass  # baseline
			"leather":
				base["defense"] = base.get("defense", 0) + 1
				base["speed"] = base.get("speed", 0) + 1
	# Quality multiplier
	for stat in base:
		base[stat] = int(base[stat] * quality)
	return base

func _generate_lore(item_name: String, materials: Array, quality: float) -> String:
	if quality > 1.5:
		return "A masterwork %s of exceptional craftsmanship." % item_name
	elif quality > 1.2:
		return "A well-crafted %s." % item_name
	elif quality < 0.5:
		return "A crude, hastily made %s." % item_name
	return "A standard %s." % item_name

func _get_template(item_name: String) -> Dictionary:
	match item_name.to_lower():
		"iron sword":
			return {"type": "weapon", "slot": "main_hand", "description": "A sturdy iron blade",
				"stat_bonuses": {"attack": 8}, "max_durability": 100, "weight": 3.0, "base_value": 30}
		"steel sword":
			return {"type": "weapon", "slot": "main_hand", "description": "A sharp steel blade",
				"stat_bonuses": {"attack": 12}, "max_durability": 150, "weight": 2.5, "base_value": 60}
		"mithril blade":
			return {"type": "weapon", "slot": "main_hand", "description": "A gleaming mithril blade, light as air",
				"stat_bonuses": {"attack": 18, "speed": 3}, "max_durability": 300, "weight": 1.0, "base_value": 200}
		"wooden shield":
			return {"type": "armor", "slot": "off_hand", "description": "A basic wooden shield",
				"stat_bonuses": {"defense": 4}, "max_durability": 60, "weight": 4.0, "base_value": 15}
		"iron shield":
			return {"type": "armor", "slot": "off_hand", "description": "A heavy iron shield",
				"stat_bonuses": {"defense": 8}, "max_durability": 120, "weight": 6.0, "base_value": 40}
		"leather tunic":
			return {"type": "armor", "slot": "chest", "description": "Light leather chest protection",
				"stat_bonuses": {"defense": 3, "speed": 1}, "max_durability": 80, "weight": 2.0, "base_value": 20}
		"iron chestplate":
			return {"type": "armor", "slot": "chest", "description": "Heavy iron chest armor",
				"stat_bonuses": {"defense": 10, "speed": -2}, "max_durability": 150, "weight": 8.0, "base_value": 60}
		"leather boots":
			return {"type": "armor", "slot": "feet", "description": "Soft leather boots",
				"stat_bonuses": {"speed": 2, "defense": 1}, "max_durability": 60, "weight": 1.0, "base_value": 15}
		"iron helmet":
			return {"type": "armor", "slot": "head", "description": "A sturdy iron helmet",
				"stat_bonuses": {"defense": 5}, "max_durability": 100, "weight": 3.0, "base_value": 25}
		"healing potion":
			return {"type": "consumable", "description": "Restores 30 health",
				"effects": [{"type": "heal", "amount": 30}], "max_durability": 1, "weight": 0.5, "base_value": 15}
		"time shard":
			return {"type": "consumable", "description": "Restores 500 time units",
				"effects": [{"type": "restore_time", "amount": 500}], "max_durability": 1, "weight": 0.1, "base_value": 50}
		"mana crystal":
			return {"type": "consumable", "description": "Restores 40 mana",
				"effects": [{"type": "restore_mana", "amount": 40}], "max_durability": 1, "weight": 0.3, "base_value": 25}
		"bread":
			return {"type": "consumable", "description": "Restores 10 health and 100 time",
				"effects": [{"type": "heal", "amount": 10}, {"type": "restore_time", "amount": 100}],
				"max_durability": 1, "weight": 0.3, "base_value": 3}
		"stone pick":
			return {"type": "weapon", "slot": "main_hand", "description": "A crude mining pick",
				"stat_bonuses": {"attack": 5}, "max_durability": 50, "weight": 4.0, "base_value": 10}
		"torch":
			return {"type": "weapon", "slot": "off_hand", "description": "Provides light, can burn things",
				"stat_bonuses": {"attack": 2}, "max_durability": 30, "weight": 1.0, "base_value": 5}
		_:
			return {"type": "misc", "description": item_name, "max_durability": 50, "weight": 1.0, "base_value": 10}

func _init_recipes() -> void:
	_recipes = [
		# Smithing — weapons
		{"name": "Iron Dagger", "materials": {"iron": 1, "wood": 1}, "skill": "smithing", "level": 1},
		{"name": "Iron Sword", "materials": {"iron": 3, "wood": 1}, "skill": "smithing", "level": 1},
		{"name": "Iron Axe", "materials": {"iron": 2, "wood": 2}, "skill": "smithing", "level": 2},
		{"name": "Iron Spear", "materials": {"iron": 2, "wood": 3}, "skill": "smithing", "level": 2},
		{"name": "Steel Sword", "materials": {"iron": 2, "coal": 1, "wood": 1}, "skill": "smithing", "level": 3},
		{"name": "Steel Axe", "materials": {"iron": 3, "coal": 2, "wood": 2}, "skill": "smithing", "level": 4},
		{"name": "War Hammer", "materials": {"iron": 5, "wood": 2}, "skill": "smithing", "level": 5},
		{"name": "Mithril Blade", "materials": {"mithril": 3, "crystal": 1}, "skill": "smithing", "level": 8},
		# Smithing — armor
		{"name": "Iron Shield", "materials": {"iron": 4, "wood": 2}, "skill": "smithing", "level": 2},
		{"name": "Iron Helmet", "materials": {"iron": 3}, "skill": "smithing", "level": 2},
		{"name": "Iron Chestplate", "materials": {"iron": 5, "leather": 2}, "skill": "smithing", "level": 4},
		{"name": "Iron Gauntlets", "materials": {"iron": 2, "leather": 1}, "skill": "smithing", "level": 3},
		{"name": "Chain Mail", "materials": {"iron": 8, "leather": 3}, "skill": "smithing", "level": 6},
		{"name": "Steel Chestplate", "materials": {"iron": 4, "coal": 3, "leather": 2}, "skill": "smithing", "level": 7},
		# Leatherworking
		{"name": "Leather Tunic", "materials": {"leather": 4}, "skill": "smithing", "level": 1},
		{"name": "Leather Boots", "materials": {"leather": 2}, "skill": "smithing", "level": 1},
		{"name": "Leather Gloves", "materials": {"leather": 2}, "skill": "smithing", "level": 1},
		{"name": "Leather Cap", "materials": {"leather": 3}, "skill": "smithing", "level": 1},
		{"name": "Fur Cloak", "materials": {"leather": 5, "bone": 2}, "skill": "smithing", "level": 3},
		# Alchemy — potions
		{"name": "Healing Potion", "materials": {"flower": 2, "water": 1}, "skill": "alchemy", "level": 1},
		{"name": "Greater Healing Potion", "materials": {"flower": 4, "crystal": 1, "water": 1}, "skill": "alchemy", "level": 4},
		{"name": "Stamina Potion", "materials": {"mushroom": 2, "water": 1}, "skill": "alchemy", "level": 1},
		{"name": "Speed Potion", "materials": {"flower": 1, "crystal": 1, "water": 1}, "skill": "alchemy", "level": 3},
		{"name": "Strength Elixir", "materials": {"bone": 2, "crystal": 1, "flower": 2}, "skill": "alchemy", "level": 5},
		{"name": "Mana Crystal", "materials": {"crystal": 1, "water": 1}, "skill": "alchemy", "level": 2},
		{"name": "Antidote", "materials": {"mushroom": 1, "flower": 1, "water": 1}, "skill": "alchemy", "level": 2},
		# Cooking — food
		{"name": "Bread", "materials": {"wheat": 2, "water": 1}, "skill": "cooking", "level": 1},
		{"name": "Meat Stew", "materials": {"bone": 1, "mushroom": 1, "water": 2}, "skill": "cooking", "level": 2},
		{"name": "Berry Pie", "materials": {"flower": 3, "wheat": 2}, "skill": "cooking", "level": 3},
		{"name": "Fish Meal", "materials": {"bone": 2, "wheat": 1, "water": 1}, "skill": "cooking", "level": 2},
		{"name": "Travelers Rations", "materials": {"wheat": 3, "leather": 1}, "skill": "cooking", "level": 1},
		# Survival — utility
		{"name": "Torch", "materials": {"wood": 1, "coal": 1}, "skill": "survival", "level": 1},
		{"name": "Rope", "materials": {"vine": 3}, "skill": "survival", "level": 1},
		{"name": "Campfire Kit", "materials": {"wood": 3, "stone": 2}, "skill": "survival", "level": 1},
		{"name": "Fishing Rod", "materials": {"wood": 2, "vine": 2}, "skill": "survival", "level": 2},
		{"name": "Lockpick", "materials": {"iron": 1}, "skill": "survival", "level": 3},
		{"name": "Explosive Flask", "materials": {"coal": 3, "crystal": 1, "glass": 1}, "skill": "survival", "level": 5},
	]

func get_recipes() -> Array:
	return _recipes

func can_craft(recipe: Dictionary, inventory_materials: Dictionary, skill_level: int = 1) -> bool:
	var required = recipe.get("materials", {})
	for mat in required:
		if inventory_materials.get(mat, 0) < required[mat]:
			return false
	if skill_level < recipe.get("level", 1):
		return false
	return true

func craft(recipe: Dictionary, crafter: EntityBody) -> Dictionary:
	var quality = 0.8 + randf() * 0.4  # 0.8-1.2 base quality
	quality += 0.1
	var item = create_item(recipe["name"], recipe.get("materials", {}).keys(), quality)
	return item

## Generative crafting — experiment with materials to discover new items.
## Material properties (hardness, flammability, magical affinity) determine
## what categories of items can be created. No pre-defined recipe needed.
var _discovered_combinations: Dictionary = {}  # hash → item_name

func experiment(materials: Array, crafter: EntityBody) -> Dictionary:
	if materials.size() < 2:
		return {"success": false, "reason": "Need at least 2 materials"}
	# Analyze material properties to determine outcome category
	var total_hardness = 0.0
	var total_organic = 0.0
	var total_magical = 0.0
	var total_liquid = 0.0
	var mat_names: Array = []
	for mat in materials:
		var name = mat.get("name", "").to_lower()
		mat_names.append(name)
		total_hardness += _material_property(name, "hardness")
		total_organic += _material_property(name, "organic")
		total_magical += _material_property(name, "magical")
		total_liquid += _material_property(name, "liquid")
	mat_names.sort()
	var combo_key = "|".join(mat_names)
	# Check if already discovered
	if _discovered_combinations.has(combo_key):
		var known = _discovered_combinations[combo_key]
		return {"success": true, "item": create_item(known, mat_names, 0.9), "discovered": false}
	# Determine item category from material properties
	var category = _determine_category(total_hardness, total_organic, total_magical, total_liquid, materials.size())
	var item_name = _generate_item_name(category, mat_names)
	_discovered_combinations[combo_key] = item_name
	var quality = 0.7 + randf() * 0.3
	var item = create_item(item_name, mat_names, quality)
	item["category"] = category
	return {"success": true, "item": item, "discovered": true, "category": category}

func _material_property(mat_name: String, prop: String) -> float:
	# Material properties derived from grain type names
	var hard_mats = ["iron", "stone", "granite", "copper", "gold", "silver", "mithril", "obsidian", "steel", "adamantine"]
	var organic_mats = ["wood", "leather", "flower", "mushroom", "bone", "vine", "leaf", "grass", "wheat", "bark"]
	var magic_mats = ["crystal", "mithril", "obsidian", "gold", "diamond", "moonstone"]
	var liquid_mats = ["water", "oil", "lava", "potion"]
	match prop:
		"hardness": return 1.0 if mat_name in hard_mats else 0.1
		"organic": return 1.0 if mat_name in organic_mats else 0.1
		"magical": return 1.0 if mat_name in magic_mats else 0.0
		"liquid": return 1.0 if mat_name in liquid_mats else 0.0
		_: return 0.0

func _determine_category(hardness: float, organic: float, magical: float, liquid: float, count: int) -> String:
	if hardness > organic and hardness > magical:
		if liquid > 0.5: return "refined_metal"
		return "weapon" if count <= 3 else "armor"
	if organic > hardness and organic > magical:
		if liquid > 0.5: return "potion"
		return "food" if count <= 2 else "clothing"
	if magical > 0.5:
		if liquid > 0.5: return "elixir"
		return "enchanted"
	if liquid > 1.0:
		return "potion"
	return "tool"

func _generate_item_name(category: String, mat_names: Array) -> String:
	var primary = mat_names[0].capitalize() if not mat_names.is_empty() else "Strange"
	match category:
		"weapon":
			var suffixes = ["Blade", "Sword", "Axe", "Dagger", "Mace", "Spear"]
			return "%s %s" % [primary, suffixes[mat_names.size() % suffixes.size()]]
		"armor":
			var suffixes = ["Chestplate", "Helmet", "Shield", "Gauntlets", "Mail"]
			return "%s %s" % [primary, suffixes[mat_names.size() % suffixes.size()]]
		"potion":
			var effects = ["Healing", "Strength", "Speed", "Resistance", "Vitality"]
			var hash_val = 0
			for n in mat_names: hash_val += n.hash()
			return "%s Potion" % effects[absi(hash_val) % effects.size()]
		"food":
			var types = ["Stew", "Bread", "Soup", "Pie", "Roast"]
			return "%s %s" % [primary, types[mat_names.size() % types.size()]]
		"clothing":
			var types = ["Tunic", "Cloak", "Boots", "Gloves", "Hood"]
			return "%s %s" % [primary, types[mat_names.size() % types.size()]]
		"elixir":
			return "Elixir of %s" % primary
		"enchanted":
			return "Enchanted %s Charm" % primary
		"refined_metal":
			return "Refined %s Ingot" % primary
		"tool":
			var types = ["Toolkit", "Bundle", "Kit", "Pack"]
			return "%s %s" % [primary, types[mat_names.size() % types.size()]]
		_:
			return "%s Creation" % primary
