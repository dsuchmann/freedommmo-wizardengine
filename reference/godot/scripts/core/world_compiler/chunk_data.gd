class_name ChunkData
extends Resource

## Holds all compiled grid data for a chunk.
## SIZE=64 for fast GDScript compilation (~4K cells vs 65K at 256).
## Can increase once hot paths move to C++ or compute shaders.

const SIZE: int = 32

var chunk_x: int = 0
var chunk_y: int = 0
var z_level: int = 0  # 0 = surface, -1 = shallow underground, -2 = deep, etc.
var world_seed: int = 0
var compiler_version: String = "0.1.0"

# L1: Elevation
var elevation: PackedFloat32Array
var slope: PackedFloat32Array

# L2: Ocean mask
var ocean_mask: PackedByteArray

# L3: Drainage
var corrected_elevation: PackedFloat32Array
var basin_ids: PackedInt32Array

# L4: Rivers & Lakes
var flow_dir: PackedByteArray
var flow_accum: PackedInt32Array
var river_cells: Dictionary = {}
var lake_cells: Dictionary = {}

# Precomputed distance fields (BFS, O(n) — avoids per-cell neighbor scanning)
var ocean_distance: PackedFloat32Array    # Distance to nearest ocean cell
var water_distance: PackedFloat32Array    # Distance to nearest river/lake cell

# L5: Climate
var temperature: PackedFloat32Array
var precipitation: PackedFloat32Array

# L6: Biomes
var biome_id: PackedByteArray

# L7: Soil
var fertility: PackedByteArray

# L8: Vegetation
var vegetation_density: PackedByteArray
var vegetation_species: PackedByteArray

# L9: Coastal
var coast_type: PackedByteArray

# L10: Roads
var road_cost: PackedFloat32Array
var road_cells: Dictionary = {}

# L11: Settlements
var walkability: PackedFloat32Array
var settlement_suitability: PackedFloat32Array
var structures: Array = []
var building_tiles: Dictionary = {}
var tile_stacks: Dictionary = {}     # Vector2i → TileObject.TileStack

# L13: POIs
var pois: Array = []

# L14: Events
var events: Array = []

func _init():
	var total = SIZE * SIZE
	elevation = PackedFloat32Array()
	elevation.resize(total)
	slope = PackedFloat32Array()
	slope.resize(total)
	ocean_mask = PackedByteArray()
	ocean_mask.resize(total)
	corrected_elevation = PackedFloat32Array()
	corrected_elevation.resize(total)
	basin_ids = PackedInt32Array()
	basin_ids.resize(total)
	flow_dir = PackedByteArray()
	flow_dir.resize(total)
	flow_accum = PackedInt32Array()
	flow_accum.resize(total)
	ocean_distance = PackedFloat32Array()
	ocean_distance.resize(total)
	ocean_distance.fill(9999.0)
	water_distance = PackedFloat32Array()
	water_distance.resize(total)
	water_distance.fill(9999.0)
	temperature = PackedFloat32Array()
	temperature.resize(total)
	precipitation = PackedFloat32Array()
	precipitation.resize(total)
	biome_id = PackedByteArray()
	biome_id.resize(total)
	fertility = PackedByteArray()
	fertility.resize(total)
	vegetation_density = PackedByteArray()
	vegetation_density.resize(total)
	vegetation_species = PackedByteArray()
	vegetation_species.resize(total)
	coast_type = PackedByteArray()
	coast_type.resize(total)
	road_cost = PackedFloat32Array()
	road_cost.resize(total)
	walkability = PackedFloat32Array()
	walkability.resize(total)
	settlement_suitability = PackedFloat32Array()
	settlement_suitability.resize(total)

func idx(x: int, y: int) -> int:
	return y * SIZE + x

func get_elevation(x: int, y: int) -> float:
	return elevation[idx(x, y)]

func set_elevation(x: int, y: int, val: float) -> void:
	elevation[idx(x, y)] = val

func is_ocean(x: int, y: int) -> bool:
	return ocean_mask[idx(x, y)] == 1

func get_biome(x: int, y: int) -> int:
	return biome_id[idx(x, y)]

func get_fertility(x: int, y: int) -> int:
	return fertility[idx(x, y)]

func get_walkability(x: int, y: int) -> float:
	return walkability[idx(x, y)]

func get_tile_stack(x: int, y: int) -> TileObject.TileStack:
	var key = Vector2i(x, y)
	if not tile_stacks.has(key):
		tile_stacks[key] = TileObject.TileStack.new()
	return tile_stacks[key]

func add_tile_object(x: int, y: int, obj: TileObject) -> void:
	get_tile_stack(x, y).add(obj)

func get_deterministic_hash() -> String:
	var ctx = HashingContext.new()
	ctx.start(HashingContext.HASH_SHA256)
	ctx.update(elevation.to_byte_array())
	ctx.update(ocean_mask)
	ctx.update(biome_id)
	ctx.update(fertility)
	return ctx.finish().hex_encode()
