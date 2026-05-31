class_name VillageGenerator
extends RefCounted

var structure_sys: StructureSystem
var entity_spawner: EntitySpawner
var faction_sys: FactionSystem
var npc_schedules: NPCSchedule
var relationships: RelationshipSystem
var all_path_tiles: Array = []  # All generated path tiles across all villages

func _init(p_struct: StructureSystem = null, p_spawner: EntitySpawner = null,
		p_faction: FactionSystem = null, p_schedule: NPCSchedule = null,
		p_rel: RelationshipSystem = null) -> void:
	structure_sys = p_struct
	entity_spawner = p_spawner
	faction_sys = p_faction
	npc_schedules = p_schedule
	relationships = p_rel

func generate_village(center_x: int, center_y: int, size: String = "small") -> Dictionary:
	var village := {"center_x": center_x, "center_y": center_y, "structures": [], "npcs": []}

	var pop_count: int
	var struct_count: int
	match size:
		"tiny":
			pop_count = 3
			struct_count = 2
		"small":
			pop_count = 8
			struct_count = 5
		"medium":
			pop_count = 20
			struct_count = 12
		"large":
			pop_count = 50
			struct_count = 25
		_:
			pop_count = 8
			struct_count = 5

	# Place structures
	var placed_structures: Array = []

	# Always place a well at center
	if structure_sys:
		var well_id := structure_sys.place_structure("well", center_x, center_y)
		placed_structures.append(well_id)

	# Place houses in a ring
	var house_positions: Array = []
	for i in range(mini(pop_count / 2, struct_count - 1)):
		var angle := (float(i) / (pop_count / 2)) * TAU
		var dist := 25.0 + randf() * 15.0
		var hx := center_x + int(cos(angle) * dist)
		var hy := center_y + int(sin(angle) * dist)
		house_positions.append(Vector2i(hx, hy))
		if structure_sys:
			var house_id := structure_sys.place_structure("house", hx, hy)
			placed_structures.append(house_id)

	# Place functional buildings
	if structure_sys and struct_count > 3:
		structure_sys.place_structure("forge", center_x + 30, center_y + 10)
		structure_sys.place_structure("market_stall", center_x - 15, center_y + 25)
		if struct_count > 5:
			structure_sys.place_structure("farm_plot", center_x + 35, center_y - 25)
			structure_sys.place_structure("watchtower", center_x - 30, center_y - 20)
		if struct_count > 8:
			structure_sys.place_structure("altar", center_x, center_y + 35)
			structure_sys.place_structure("campfire", center_x + 8, center_y + 8)

	# Spawn NPCs
	var occupations := ["farmer", "farmer", "blacksmith", "guard", "merchant", "scholar", "hunter", "villager"]
	var human_m := ["Aldric", "Bron", "Cedric", "Dorian", "Eamon", "Gareth", "Hugo", "Ivar", "Kael", "Magnus"]
	var human_f := ["Brenna", "Dalia", "Fiona", "Helena", "Johanna", "Lyra", "Nadia", "Petra", "Rhea", "Thalia"]
	var elf_m := ["Aelindor", "Caelum", "Elendil", "Faenor", "Galadir", "Lorien", "Meldir", "Thalion"]
	var elf_f := ["Arwen", "Celebwen", "Elanor", "Galadwen", "Ithilwen", "Luthien", "Miriel", "Nimrodel"]
	var dwarf_m := ["Balin", "Dwalin", "Gimric", "Thorin", "Ulfgar", "Bromm", "Dolgrin", "Korvak"]
	var dwarf_f := ["Dagny", "Hilda", "Ragna", "Sigrid", "Thora", "Brynhild", "Astrid", "Gunhild"]
	var orc_m := ["Grukk", "Mogul", "Thrukk", "Urgash", "Varkash", "Zulgor", "Drago", "Kargath"]
	var orc_f := ["Grisha", "Marga", "Sharka", "Ulga", "Varsha", "Zulga", "Draga", "Karga"]
	var goblin_m := ["Skrix", "Nix", "Blix", "Grik", "Snag", "Pip", "Zix", "Krik"]
	var goblin_f := ["Nixie", "Trixie", "Pixie", "Grixie", "Snix", "Zippy", "Krixie", "Brixie"]

	for i in range(pop_count):
		if entity_spawner == null:
			break
		var is_female := randf() > 0.5
		var npc_name: String
		var species_roll = randf()
		var species: int
		if species_roll < 0.35:
			species = EntityBody.Species.HUMAN
		elif species_roll < 0.55:
			species = EntityBody.Species.ELF
		elif species_roll < 0.70:
			species = EntityBody.Species.DWARF
		elif species_roll < 0.85:
			species = EntityBody.Species.ORC
		else:
			species = EntityBody.Species.GOBLIN

		# Species-specific name
		match species:
			EntityBody.Species.HUMAN:
				npc_name = (human_f if is_female else human_m).pick_random()
			EntityBody.Species.ELF:
				npc_name = (elf_f if is_female else elf_m).pick_random()
			EntityBody.Species.DWARF:
				npc_name = (dwarf_f if is_female else dwarf_m).pick_random()
			EntityBody.Species.ORC:
				npc_name = (orc_f if is_female else orc_m).pick_random()
			EntityBody.Species.GOBLIN:
				npc_name = (goblin_f if is_female else goblin_m).pick_random()
			_:
				npc_name = (human_f if is_female else human_m).pick_random()

		var spawn_x := center_x + randi_range(-15, 15)
		var spawn_y := center_y + randi_range(-15, 15)
		var age := 18.0 + randf() * 40.0

		var npc := entity_spawner.spawn_npc(species, npc_name, spawn_x, spawn_y, age)
		npc.gender = "female" if is_female else "male"
		village["npcs"].append(npc.entity_id)

		# Assign occupation and faction
		var occupation: String = occupations[i % occupations.size()]

		# Equip NPCs based on occupation
		match occupation:
			"guard":
				npc.equip("main_hand", {"name": "Iron Sword", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 8}, "durability": 100, "max_durability": 100})
				npc.equip("chest", {"name": "Iron Chestplate", "type": "armor", "slot": "chest", "stat_bonuses": {"defense": 10}, "durability": 150, "max_durability": 150})
			"hunter":
				npc.equip("main_hand", {"name": "Hunting Bow", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 6, "dexterity": 2}, "durability": 80, "max_durability": 80})
				npc.equip("chest", {"name": "Leather Tunic", "type": "armor", "slot": "chest", "stat_bonuses": {"defense": 3, "speed": 1}, "durability": 60, "max_durability": 60})
			"blacksmith":
				npc.equip("main_hand", {"name": "Hammer", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 7, "strength": 3}, "durability": 120, "max_durability": 120})
			"farmer":
				npc.equip("main_hand", {"name": "Pitchfork", "type": "weapon", "slot": "main_hand", "stat_bonuses": {"attack": 3}, "durability": 40, "max_durability": 40})
			"merchant":
				npc.equip("chest", {"name": "Fine Robes", "type": "armor", "slot": "chest", "stat_bonuses": {"charisma": 3}, "durability": 50, "max_durability": 50})
		if npc_schedules:
			npc_schedules.assign_schedule(npc.entity_id, occupation)
		if faction_sys:
			faction_sys.register_entity(npc.entity_id, "villagers")

		# Store occupation and assign structures
		var npc_data = entity_spawner._entities.get(npc.entity_id)
		if npc_data:
			npc_data["occupation"] = occupation
			# Assign home — pick a house, cycling through available houses
			if not house_positions.is_empty():
				var home_pos = house_positions[i % house_positions.size()]
				npc_data["home_x"] = home_pos.x
				npc_data["home_y"] = home_pos.y
			else:
				npc_data["home_x"] = center_x
				npc_data["home_y"] = center_y

			# Assign workplace based on occupation
			match occupation:
				"blacksmith":
					npc_data["work_x"] = center_x + 30
					npc_data["work_y"] = center_y + 10
				"merchant":
					npc_data["work_x"] = center_x - 15
					npc_data["work_y"] = center_y + 25
				"guard":
					if struct_count > 5:
						npc_data["work_x"] = center_x - 30
						npc_data["work_y"] = center_y - 20
					else:
						npc_data["work_x"] = center_x
						npc_data["work_y"] = center_y
				"farmer":
					if struct_count > 5:
						npc_data["work_x"] = center_x + 35
						npc_data["work_y"] = center_y - 25
					else:
						npc_data["work_x"] = center_x
						npc_data["work_y"] = center_y
				"scholar":
					npc_data["work_x"] = center_x
					npc_data["work_y"] = center_y + 35
				_:
					# Default: work near well/center
					npc_data["work_x"] = center_x
					npc_data["work_y"] = center_y

			# Spawn NPC at their home door (center-bottom of house footprint)
			npc_data["world_x"] = npc_data["home_x"] + 2
			npc_data["world_y"] = npc_data["home_y"] + 5

		# Create family bonds between some NPCs
		if relationships and i > 0 and randf() > 0.6:
			var partner_id: int = village["npcs"][randi() % village["npcs"].size()]
			if partner_id != npc.entity_id:
				relationships.set_relationship(npc.entity_id, partner_id,
					RelationshipSystem.RelType.FRIEND, 0.5 + randf() * 0.3)

	# Generate path network connecting structures to village center
	village["paths"] = _generate_paths(center_x, center_y, house_positions, struct_count)
	all_path_tiles.append_array(village["paths"])
	village["structures"] = placed_structures
	village["population"] = pop_count
	return village

## Generate path tiles connecting structures to the village center (well)
func _generate_paths(center_x: int, center_y: int, house_positions: Array, struct_count: int) -> Array:
	var path_tiles: Array = []

	# Connect each house to center with 3-wide paths
	for pos in house_positions:
		var pts = _line_between(pos.x, pos.y, center_x, center_y, 3)
		path_tiles.append_array(pts)

	# Connect functional buildings to center
	var functional_buildings: Array = [
		Vector2i(center_x + 30, center_y + 10),   # forge
		Vector2i(center_x - 15, center_y + 25),   # market
	]
	if struct_count > 5:
		functional_buildings.append(Vector2i(center_x + 35, center_y - 25))  # farm
		functional_buildings.append(Vector2i(center_x - 30, center_y - 20))  # watchtower

	for bpos in functional_buildings:
		var pts = _line_between(bpos.x, bpos.y, center_x, center_y, 3)
		path_tiles.append_array(pts)

	return path_tiles

## Bresenham line drawing between two points — returns Array of Vector2i
## width parameter makes paths wider (3 = 3 tiles wide road)
func _line_between(x0: int, y0: int, x1: int, y1: int, width: int = 1) -> Array:
	var seen: Dictionary = {}
	var points: Array = []
	var dx = absi(x1 - x0)
	var dy = absi(y1 - y0)
	var sx = 1 if x0 < x1 else -1
	var sy = 1 if y0 < y1 else -1
	var err = dx - dy
	var cx = x0
	var cy = y0
	var half_w = width / 2

	while true:
		for wy in range(-half_w, half_w + 1):
			for wx in range(-half_w, half_w + 1):
				var pt = Vector2i(cx + wx, cy + wy)
				if not seen.has(pt):
					seen[pt] = true
					points.append(pt)
		if cx == x1 and cy == y1:
			break
		var e2 = 2 * err
		if e2 > -dy:
			err -= dy
			cx += sx
		if e2 < dx:
			err += dx
			cy += sy
	return points
