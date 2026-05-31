class_name DiscoverySystem
extends RefCounted

signal location_discovered(name: String, world_x: int, world_y: int)
signal biome_discovered(biome: String)

var _discovered_locations: Dictionary = {}
var _discovered_biomes: Dictionary = {}
var _explored_cells: Dictionary = {}

func record_exploration(cell_x: int, cell_y: int, biome: String) -> void:
	var key := "%d_%d" % [cell_x, cell_y]
	if not _explored_cells.has(key):
		_explored_cells[key] = {
			"cell_x": cell_x, "cell_y": cell_y,
			"biome": biome,
			"discovered_at": Time.get_unix_time_from_system(),
		}
		if not _discovered_biomes.has(biome):
			_discovered_biomes[biome] = true
			biome_discovered.emit(biome)

func discover_location(name: String, world_x: int, world_y: int, location_type: String = "poi") -> void:
	var key := "%d_%d" % [world_x, world_y]
	if not _discovered_locations.has(key):
		_discovered_locations[key] = {
			"name": name,
			"world_x": world_x,
			"world_y": world_y,
			"type": location_type,
			"discovered_at": Time.get_unix_time_from_system(),
		}
		location_discovered.emit(name, world_x, world_y)

func is_cell_explored(cell_x: int, cell_y: int) -> bool:
	return _explored_cells.has("%d_%d" % [cell_x, cell_y])

func get_explored_cell_count() -> int:
	return _explored_cells.size()

func get_discovered_locations() -> Array:
	return _discovered_locations.values()

func get_discovered_biomes() -> Array:
	return _discovered_biomes.keys()

func get_exploration_percentage(total_cells: int) -> float:
	if total_cells <= 0:
		return 0.0
	return float(_explored_cells.size()) / float(total_cells) * 100.0
