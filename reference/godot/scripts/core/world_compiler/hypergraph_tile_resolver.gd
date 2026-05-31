class_name HypergraphTileResolver

## Given (biome, 4 corner elevations), returns the tileset key and Wang index.
## Stateless — all inputs passed in, no side effects.


static func resolve(biome_name: String, elev_tl: float, elev_tr: float, elev_bl: float, elev_br: float, world_seed: int, wx: int, wy: int) -> Dictionary:
	## Main entry point. Returns {tileset_type, tileset_key, wang_index, surface_a, surface_b}.

	# Map each corner elevation to a surface via the biome gradient
	var s_tl = ElevationGradientTable.surface_at(biome_name, elev_tl)
	var s_tr = ElevationGradientTable.surface_at(biome_name, elev_tr)
	var s_bl = ElevationGradientTable.surface_at(biome_name, elev_bl)
	var s_br = ElevationGradientTable.surface_at(biome_name, elev_br)

	# Collect unique surfaces
	var corners = [s_tl, s_tr, s_bl, s_br]
	var unique = _unique_surfaces(corners)

	if unique.size() == 1:
		# All corners same surface — use solid fill tile (wang_0).
		# Wang variety within a single surface creates visual noise, not coherence.
		var surface = unique[0]
		return {
			"tileset_type": "surface",
			"tileset_key": surface,
			"wang_index": 0,
			"surface_a": surface,
			"surface_b": surface,
		}

	# 2+ surfaces — find the dominant pair
	var pair = _dominant_pair(corners, unique, biome_name)
	var lower = pair[0]
	var upper = pair[1]

	# Compute Wang index: bit per corner, 0=lower, 1=upper
	var wang = 0
	if s_tl == upper:
		wang |= 1
	if s_tr == upper:
		wang |= 2
	if s_bl == upper:
		wang |= 4
	if s_br == upper:
		wang |= 8

	# Check if transition tileset exists
	var trans_key = ElevationGradientTable.transition_key(lower, upper)
	if ElevationGradientTable.has_transition(lower, upper):
		return {
			"tileset_type": "transition",
			"tileset_key": trans_key,
			"wang_index": wang,
			"surface_a": lower,
			"surface_b": upper,
		}

	# No transition tileset — fall back to the more common surface as self-tile
	var count_lower = corners.count(lower)
	var fallback = lower if count_lower >= 2 else upper
	return {
		"tileset_type": "surface",
		"tileset_key": fallback,
		"wang_index": _spatial_wang(wx, wy, world_seed),
		"surface_a": fallback,
		"surface_b": fallback,
	}


static func _unique_surfaces(corners: Array) -> Array:
	var seen: Dictionary = {}
	var result: Array = []
	for s in corners:
		if not seen.has(s):
			seen[s] = true
			result.append(s)
	return result


static func _dominant_pair(corners: Array, unique: Array, biome_name: String) -> Array:
	## Given corners with 2+ surfaces, return [lower, upper] ordered by gradient position.
	## "Lower" = appears at lower elevation in the biome's gradient.

	var pair: Array
	if unique.size() == 2:
		pair = [unique[0], unique[1]]
	else:
		# 3+ surfaces — find the two most common
		var counts: Dictionary = {}
		for s in corners:
			counts[s] = counts.get(s, 0) + 1
		var sorted_surfaces = unique.duplicate()
		sorted_surfaces.sort_custom(func(a, b): return counts[a] > counts[b])
		pair = [sorted_surfaces[0], sorted_surfaces[1]]

	# Order by gradient rank (lower elevation = first)
	var rank_a = ElevationGradientTable.gradient_rank(biome_name, pair[0])
	var rank_b = ElevationGradientTable.gradient_rank(biome_name, pair[1])
	if rank_a <= rank_b:
		return [pair[0], pair[1]]
	else:
		return [pair[1], pair[0]]


static func _spatial_wang(wx: int, wy: int, seed: int) -> int:
	## Deterministic spatial hash for self-tile variety. Returns 0-15.
	var idx = 0
	if _corner_hash(wx, wy, seed):
		idx |= 1
	if _corner_hash(wx + 1, wy, seed):
		idx |= 2
	if _corner_hash(wx, wy + 1, seed):
		idx |= 4
	if _corner_hash(wx + 1, wy + 1, seed):
		idx |= 8
	return idx


static func _corner_hash(cx: int, cy: int, seed: int) -> bool:
	var h = ((cx * 73856093) ^ (cy * 19349663) ^ (seed * 83492791)) & 0x7FFFFFFF
	return (h % 5) < 2
