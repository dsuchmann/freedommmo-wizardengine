class_name PlacementEngine
extends RefCounted

## Deterministic layer-stack placement pipeline.
## Reads biome_layers JSON to place objects layer-by-layer.
## Lower layers guarantee 100% coverage. Upper layers are sparser.
## Thread-safe: produces data only, never touches scene tree.

var _catalog: ObjectCatalog
var _affinity: BiomeAffinityLoader
var _layer_loader: BiomeLayerLoader
var _noise: FastNoiseLite
var _world_seed: int

const CHUNK_SIZE = ChunkData.SIZE
const MAX_OBJECTS_PER_CHUNK = 50000
const CLIFF_SLOPE_THRESHOLD = 0.3  # No objects on cliff faces
const MIN_RENDER_LAYER = 5  # Skip layers 1-4 (handled by TileMapLayer terrain renderer)

# Biome ID → name mapping (matches BiomeLayer enum order)
const BIOME_NAMES = [
	"ocean", "beach", "grassland", "forest", "dense_forest",
	"desert", "savanna", "steppe", "tundra", "taiga",
	"mountains", "swamp", "tropical_forest", "volcanic",
	"arctic", "lake", "river", "mystic"
]


func _init(catalog: ObjectCatalog, affinity: BiomeAffinityLoader, world_seed: int):
	_catalog = catalog
	_affinity = affinity
	_layer_loader = BiomeLayerLoader.new()
	_world_seed = world_seed
	_noise = FastNoiseLite.new()
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 0.05


func place_chunk(chunk_data, chunk_x: int, chunk_y: int) -> Array:
	## Elevation-aware layer-stack placement.
	## Each tile gets layers based on its biome AND elevation.
	## Cliff faces (high slope) are skipped entirely.
	var instances: Array = []
	var blocking_tiles: Dictionary = {}

	# Cache: "biome:elev_band" -> {layers, weights_per_layer}
	var layer_cache: Dictionary = {}

	for cy in range(CHUNK_SIZE):
		for cx in range(CHUNK_SIZE):
			if instances.size() >= MAX_OBJECTS_PER_CHUNK:
				return instances

			var idx = cy * CHUNK_SIZE + cx
			var world_x = chunk_x * CHUNK_SIZE + cx
			var world_y = chunk_y * CHUNK_SIZE + cy

			# Skip water tiles
			if chunk_data.ocean_mask[idx] == 1:
				continue
			var elevation = chunk_data.elevation[idx]
			if elevation < 0.35:
				continue

			# Skip cliff faces — no objects on steep slopes
			var slope_val = chunk_data.slope[idx]
			if slope_val > CLIFF_SLOPE_THRESHOLD:
				continue

			# Get tile biome
			var tile_biome_idx = chunk_data.biome_id[idx]
			if tile_biome_idx < 0 or tile_biome_idx >= BIOME_NAMES.size():
				continue
			var tile_biome = BIOME_NAMES[tile_biome_idx]

			# Get elevation-aware layers for this tile
			var layers = _layer_loader.get_layers_for_elevation(tile_biome, elevation)
			if layers.is_empty():
				# Fallback to legacy affinity system
				_place_tile_legacy(chunk_data, idx, world_x, world_y, tile_biome, instances)
				continue

			# Place objects for each layer on this tile
			# Layers 1-4 (ground cover) are handled by the TileMapLayer terrain renderer
			# Only emit layer 5+ (trees, bushes, boulders) as Sprite2D nodes
			for layer_def in layers:
				if instances.size() >= MAX_OBJECTS_PER_CHUNK:
					return instances
				var layer_num = int(layer_def.get("layer", 0))
				if layer_num < MIN_RENDER_LAYER:
					continue
				_place_tile_layer(layer_def, world_x, world_y, idx, chunk_data,
					slope_val, instances, blocking_tiles)

	return instances


func _place_tile_layer(layer_def: Dictionary, world_x: int, world_y: int,
		idx: int, chunk_data, slope_val: float,
		instances: Array, blocking_tiles: Dictionary) -> void:
	## Place layer objects on a single tile. High-coverage flora layers (3)
	## get 2 objects per tile to fill gaps between sprites.
	var coverage = layer_def.get("coverage", 0.0)
	var layer_objects = layer_def.get("objects", [])
	var z_off = int(layer_def.get("z_offset", 0))
	var scale_range = layer_def.get("scale_range", [0.5, 1.0])
	var layer_num = int(layer_def.get("layer", 0))

	if layer_objects.is_empty():
		return

	# Skip steep slopes for upper layers (more restrictive than cliff threshold)
	if layer_num >= 4 and slope_val > 0.2:
		return

	# Coverage roll — 1.0 = every tile guaranteed
	if coverage < 1.0:
		var cov_rng = _make_rng(world_x, world_y, layer_num * 3333)
		if cov_rng.randf() > coverage:
			return

	# Precompute cumulative weights
	var total_weight = 0.0
	for obj_entry in layer_objects:
		total_weight += obj_entry.get("weight", 1.0)

	# Multi-placement per tile.
	# Layer 1: 3 overlapping ground textures with jitter to hide grid seams
	# Layer 2: 2 tiny debris items
	# Layer 3: 2 flora per tile
	var placements = 1
	if layer_num == 1 and coverage >= 1.0:
		placements = 1  # Renderer expands layer 1 into sub-grid internally
	elif layer_num == 2 and coverage >= 1.0:
		placements = 2
	elif layer_num == 3 and coverage >= 0.5:
		placements = 2

	for p in range(placements):
		# Select object: use noise-based clustering for layers 1-3 so adjacent
		# tiles tend to pick the SAME object type, creating coherent patches
		# instead of random per-tile soup. Layer 4+ uses pure random.
		var selected_obj_id = ""
		var selected_variant_count = 1
		if layer_num <= 3 and layer_objects.size() > 1:
			# Noise value determines which object "zone" we're in.
			# Layer 1 uses lower frequency (0.06) for LARGER coherent patches.
			var freq = 0.06 if layer_num == 1 else 0.15
			var zone_noise = _noise.get_noise_2d(
				float(world_x) * freq + float(layer_num) * 100.0 + float(p) * 50.0,
				float(world_y) * freq)
			# Map noise (-1..1) to (0..1) then to cumulative weight range
			var mapped = (zone_noise + 1.0) * 0.5 * total_weight
			var cumulative = 0.0
			for obj_entry in layer_objects:
				cumulative += obj_entry.get("weight", 1.0)
				if mapped <= cumulative:
					selected_obj_id = obj_entry.get("object_id", "")
					selected_variant_count = int(obj_entry.get("variant_count", 1))
					break
		else:
			# Random selection for accent/large layers
			var sel_rng = _make_rng(world_x, world_y, layer_num * 5555 + p * 7171)
			var roll = sel_rng.randf() * total_weight
			var cumulative = 0.0
			for obj_entry in layer_objects:
				cumulative += obj_entry.get("weight", 1.0)
				if roll <= cumulative:
					selected_obj_id = obj_entry.get("object_id", "")
					selected_variant_count = int(obj_entry.get("variant_count", 1))
					break

		if selected_obj_id == "":
			selected_obj_id = layer_objects[0].get("object_id", "")
			selected_variant_count = int(layer_objects[0].get("variant_count", 1))

		# Look up catalog
		var obj_def = _catalog.get_object(selected_obj_id)
		if obj_def.is_empty():
			continue

		# Skip if blocking tile occupied
		var pos_key = Vector2i(world_x, world_y)
		if obj_def.get("blocking", false) and blocking_tiles.has(pos_key):
			continue

		# Create instance with unique seed per placement
		var inst_seed = _instance_seed(world_x, world_y, selected_obj_id) ^ (p * 13579)
		var phase = _select_phase(obj_def, {}, inst_seed)
		var var_idx = 1
		if selected_variant_count > 1:
			if layer_num == 1:
				# Layer 1: noise-based variant — adjacent tiles get SAME variant
				# for coherent ground patches (like a real dirt texture continuing)
				var var_noise = _noise.get_noise_2d(
					float(world_x) * 0.04 + 500.0 + float(p) * 30.0,
					float(world_y) * 0.04 + 500.0)
				var_idx = int((var_noise + 1.0) * 0.5 * float(selected_variant_count)) + 1
				var_idx = clampi(var_idx, 1, selected_variant_count)
			else:
				var_idx = (abs(inst_seed) % selected_variant_count) + 1

		var inst = ObjectInstance.from_placement(
			obj_def, pos_key, inst_seed, phase, var_idx)
		inst.layer_num = layer_num
		inst.layer_z_offset = z_off
		var scale_rng = _make_rng(world_x, world_y, layer_num * 9999 + p * 4242)
		if layer_num == 1:
			# All layer 1 placements: small uniform scale, tiled in sub-grid
			inst.layer_scale = 0.38
		else:
			inst.layer_scale = lerpf(scale_range[0], scale_range[1], scale_rng.randf())
		instances.append(inst)

		if inst.blocking:
			blocking_tiles[pos_key] = true


func _place_tile_legacy(chunk_data, idx: int, world_x: int, world_y: int,
		biome_id: String, instances: Array) -> void:
	## Fallback: old affinity-based placement for a single tile.
	var pools = _affinity.get_object_pools(biome_id)
	for pool in pools:
		var obj_id = pool.get("object_id", "")
		var obj_def = _catalog.get_object(obj_id)
		if obj_def.is_empty():
			continue
		var density = pool.get("density", 0.0) * 0.5
		var rng = _make_rng(world_x, world_y, obj_id.hash())
		if rng.randf() > density:
			continue
		var inst_seed = _instance_seed(world_x, world_y, obj_id)
		var var_idx = (abs(inst_seed) % int(pool.get("variant_count", 1))) + 1
		var inst = ObjectInstance.from_placement(
			obj_def, Vector2i(world_x, world_y), inst_seed, "", var_idx)
		instances.append(inst)


func _check_eligibility(chunk_data, idx: int, pool: Dictionary) -> bool:
	# Elevation check
	var elev_range = pool.get("elevation_range")
	if elev_range != null and elev_range is Array and elev_range.size() >= 2:
		var elev = chunk_data.elevation[idx]
		if elev < elev_range[0] or elev > elev_range[1]:
			return false

	# Moisture check
	var moist_range = pool.get("moisture_range")
	if moist_range != null and moist_range is Array and moist_range.size() >= 2:
		var precip = chunk_data.precipitation[idx]
		if precip < moist_range[0] or precip > moist_range[1]:
			return false

	# Slope check
	var slope_max = pool.get("slope_max", 1.0)
	if slope_max is float or slope_max is int:
		var slope = chunk_data.slope[idx]
		if slope > slope_max:
			return false

	# Distance rules
	var rules = pool.get("distance_rules")
	if rules != null and rules is Dictionary:
		var water_dist = chunk_data.water_distance[idx]
		var min_w = rules.get("min_water")
		if min_w != null and water_dist < min_w:
			return false
		var max_w = rules.get("max_water")
		if max_w != null and water_dist > max_w:
			return false

	return true


func _sample_density(pool: Dictionary, chunk_data, idx: int,
		wx: int, wy: int, obj_id: String) -> float:
	var base_density = pool.get("density", 0.0)
	# vegetation_density modulates placement — but only mildly for ground cover
	var veg_raw = chunk_data.vegetation_density[idx] / 255.0
	var veg_density = clampf(veg_raw + 0.4, 0.4, 1.0)  # floor at 0.4 so ground cover always appears

	var cluster_mode = pool.get("cluster_mode", "scatter")
	var cluster_val = 1.0

	if cluster_mode == "perlin":
		var scale = pool.get("cluster_scale", 0.3)
		var noise = FastNoiseLite.new()
		noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		noise.frequency = scale
		noise.seed = _world_seed + obj_id.hash()
		var raw = noise.get_noise_2d(float(wx), float(wy))
		# Bias toward 1.0 — ground cover should be dense everywhere with slight variation
		cluster_val = clampf((raw + 1.0) * 0.5 + 0.3, 0.3, 1.0)
	elif cluster_mode == "scatter":
		var rng = _make_rng(wx, wy, obj_id.hash() + 999)
		cluster_val = 0.6 + rng.randf() * 0.4
	elif cluster_mode == "edge_follow" or cluster_mode == "water_follow":
		# Higher density near water
		var water_dist = chunk_data.water_distance[idx]
		cluster_val = clampf(1.0 - water_dist / 10.0, 0.0, 1.0)

	return base_density * veg_density * cluster_val


func _apply_transition_blending(chunk_data, cx: int, cy: int, idx: int,
		biome_id: String, density: float) -> float:
	# Check immediate neighbors for biome boundary
	var at_boundary = false
	for dy in range(-1, 2):
		for dx in range(-1, 2):
			if dx == 0 and dy == 0:
				continue
			var nx = cx + dx
			var ny = cy + dy
			if nx < 0 or nx >= CHUNK_SIZE or ny < 0 or ny >= CHUNK_SIZE:
				continue
			var n_idx = ny * CHUNK_SIZE + nx
			var n_biome_idx = chunk_data.biome_id[n_idx]
			if n_biome_idx != chunk_data.biome_id[idx]:
				at_boundary = true
				break
		if at_boundary:
			break

	if at_boundary:
		density *= 0.5

	return density


func _select_phase(obj_def: Dictionary, pool: Dictionary, seed_val: int) -> String:
	var ontology = obj_def.get("ontology", "")
	if ontology != "animate":
		return ""

	var dist = pool.get("lifecycle_distribution", {})
	if dist.is_empty():
		var lifecycle = obj_def.get("lifecycle", {})
		var phases = lifecycle.get("phases", [])
		if phases.size() > 0:
			var mid = phases.size() / 2
			var mid_phase = phases[mid]
			return mid_phase.get("id", "mature")
		return "mature"

	# Weighted random selection from distribution
	var rng = RandomNumberGenerator.new()
	rng.seed = seed_val + 7777
	var roll = rng.randf()
	var cumulative = 0.0
	var last_key = ""
	for phase_id in dist:
		var weight = dist[phase_id]
		cumulative += weight
		last_key = phase_id
		if roll <= cumulative:
			return phase_id

	return last_key if last_key != "" else "mature"


func _instance_seed(wx: int, wy: int, obj_id: String) -> int:
	return hash(Vector3i(wx, wy, _world_seed)) ^ obj_id.hash()


func _make_rng(wx: int, wy: int, extra: int) -> RandomNumberGenerator:
	var rng = RandomNumberGenerator.new()
	rng.seed = hash(Vector3i(wx, wy, _world_seed)) ^ extra
	return rng
