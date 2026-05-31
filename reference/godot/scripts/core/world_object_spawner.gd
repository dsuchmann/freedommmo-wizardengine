class_name WorldObjectSpawner
extends RefCounted

## Procedurally places environmental objects (trees, rocks, bushes) on terrain
## based on biome type and terrain features. Objects are spawned as sprites
## within each cell and stored for rendering.

# Object density per biome (objects per 128x128 cell)
const BIOME_DENSITY: Dictionary = {
	"forest": 80,
	"mushroom_forest": 65,
	"grassland": 25,
	"hills": 18,
	"swamp": 35,
	"desert": 6,
	"beach": 5,
	"tundra": 12,
	"mountains": 15,
	"volcanic": 8,
}

# Object types available per biome — references PixelLab nature object tags
# Each entry: {"weight": float, "sprite_prefix": String, "scale_range": [min, max]}
const BIOME_OBJECTS: Dictionary = {
	"forest": [
		{"weight": 3.0, "type": "pine_tree", "scale_min": 0.8, "scale_max": 1.2},
		{"weight": 2.0, "type": "oak_tree", "scale_min": 0.9, "scale_max": 1.3},
		{"weight": 1.0, "type": "dead_stump", "scale_min": 0.6, "scale_max": 0.9},
		{"weight": 2.0, "type": "bush", "scale_min": 0.5, "scale_max": 0.8},
		{"weight": 1.0, "type": "fern", "scale_min": 0.4, "scale_max": 0.7},
		{"weight": 0.5, "type": "mushroom", "scale_min": 0.3, "scale_max": 0.5},
	],
	"mushroom_forest": [
		{"weight": 3.0, "type": "mushroom", "scale_min": 0.5, "scale_max": 1.0},
		{"weight": 2.0, "type": "dead_stump", "scale_min": 0.6, "scale_max": 0.9},
		{"weight": 1.5, "type": "fern", "scale_min": 0.4, "scale_max": 0.7},
		{"weight": 1.0, "type": "bush", "scale_min": 0.5, "scale_max": 0.8},
	],
	"grassland": [
		{"weight": 2.0, "type": "bush", "scale_min": 0.4, "scale_max": 0.7},
		{"weight": 1.0, "type": "oak_tree", "scale_min": 0.7, "scale_max": 1.1},
		{"weight": 1.5, "type": "flower_patch", "scale_min": 0.3, "scale_max": 0.5},
		{"weight": 0.5, "type": "rock", "scale_min": 0.3, "scale_max": 0.6},
	],
	"hills": [
		{"weight": 2.0, "type": "rock", "scale_min": 0.4, "scale_max": 0.8},
		{"weight": 1.0, "type": "bush", "scale_min": 0.4, "scale_max": 0.6},
		{"weight": 0.5, "type": "pine_tree", "scale_min": 0.6, "scale_max": 1.0},
	],
	"swamp": [
		{"weight": 2.0, "type": "dead_stump", "scale_min": 0.5, "scale_max": 0.8},
		{"weight": 1.5, "type": "mushroom", "scale_min": 0.3, "scale_max": 0.6},
		{"weight": 1.0, "type": "fern", "scale_min": 0.4, "scale_max": 0.7},
	],
	"desert": [
		{"weight": 2.0, "type": "rock", "scale_min": 0.3, "scale_max": 0.7},
		{"weight": 1.0, "type": "dead_stump", "scale_min": 0.3, "scale_max": 0.5},
	],
	"tundra": [
		{"weight": 2.0, "type": "rock", "scale_min": 0.3, "scale_max": 0.6},
		{"weight": 1.0, "type": "pine_tree", "scale_min": 0.5, "scale_max": 0.8},
	],
	"mountains": [
		{"weight": 3.0, "type": "rock", "scale_min": 0.4, "scale_max": 0.9},
		{"weight": 0.5, "type": "pine_tree", "scale_min": 0.4, "scale_max": 0.7},
	],
}

# Cached object placements per cell: key = Vector2i(cx, cy), value = Array of placed objects
var _cell_objects: Dictionary = {}

## Generate object placements for a cell. Returns Array of Dictionaries with:
## {"type": String, "world_x": int, "world_y": int, "scale": float}
func generate_cell_objects(cell: WorldCell) -> Array:
	var key = Vector2i(cell.cell_x, cell.cell_y)
	if _cell_objects.has(key):
		return _cell_objects[key]

	var biome = cell.biome
	var density = BIOME_DENSITY.get(biome, 0)
	var object_defs = BIOME_OBJECTS.get(biome, [])

	if density == 0 or object_defs.is_empty():
		_cell_objects[key] = []
		return []

	var objects: Array = []
	var total_weight = 0.0
	for od in object_defs:
		total_weight += od["weight"]

	# Use deterministic seed per cell for consistency
	var cell_seed = cell.cell_x * 73856093 + cell.cell_y * 19349663
	var rng = RandomNumberGenerator.new()
	rng.seed = cell_seed

	var cell_base_x = cell.cell_x * WorldCell.CELL_SIZE
	var cell_base_y = cell.cell_y * WorldCell.CELL_SIZE

	for i in range(density):
		# Pick random position within cell
		var local_x = rng.randi_range(2, WorldCell.CELL_SIZE - 3)
		var local_y = rng.randi_range(2, WorldCell.CELL_SIZE - 3)
		var world_x = cell_base_x + local_x
		var world_y = cell_base_y + local_y

		# Avoid water tiles
		if cell.heights.size() > 0:
			var h = cell.get_height(local_x, local_y)
			if h < 0.35:  # Water height threshold
				continue

		# Pick object type by weighted random
		var roll = rng.randf() * total_weight
		var cumulative = 0.0
		var selected_type = object_defs[0]
		for od in object_defs:
			cumulative += od["weight"]
			if roll <= cumulative:
				selected_type = od
				break

		var scale = rng.randf_range(selected_type.get("scale_min", 0.5), selected_type.get("scale_max", 1.0))
		objects.append({
			"type": selected_type["type"],
			"world_x": world_x,
			"world_y": world_y,
			"scale": scale,
		})

	_cell_objects[key] = objects
	return objects

## Get all objects near a world position
func get_objects_near(world_x: int, world_y: int, radius: int) -> Array:
	var result: Array = []
	var cx_min = (world_x - radius) / WorldCell.CELL_SIZE
	var cx_max = (world_x + radius) / WorldCell.CELL_SIZE
	var cy_min = (world_y - radius) / WorldCell.CELL_SIZE
	var cy_max = (world_y + radius) / WorldCell.CELL_SIZE
	for cx in range(cx_min, cx_max + 1):
		for cy in range(cy_min, cy_max + 1):
			var key = Vector2i(cx, cy)
			if _cell_objects.has(key):
				for obj in _cell_objects[key]:
					var dist = abs(obj["world_x"] - world_x) + abs(obj["world_y"] - world_y)
					if dist <= radius:
						result.append(obj)
	return result
