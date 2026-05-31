class_name OvermapGenerator

## Generates a world overview image with complex multi-continent geography.
## Uses Godot's built-in FBM (not manual layer summing) for natural terrain.
## Modifier system adds volcanic hotspots, mystic domains, lakes, and rivers.

const MAP_SIZE = 640
const HALF_SIZE = 320
const CHUNKS_PER_PIXEL = 1

# Shared noise instances — used by both overmap generation AND terrain compilation
static var _noise_ready: bool = false
static var _n_continent: FastNoiseLite
static var _n_ridge: FastNoiseLite
static var _n_warp: FastNoiseLite
static var _n_temp: FastNoiseLite
static var _n_moist: FastNoiseLite
static var _n_magic: FastNoiseLite
static var _current_seed: int = -1

# Modifier fields — computed once per seed, queried by classify and external systems
static var _volcanic_influence: PackedFloat32Array
static var _mystic_influence: PackedFloat32Array
static var _lake_mask: PackedByteArray
static var _river_mask: PackedByteArray
static var _modifiers_ready: bool = false
static var _modifiers_seed: int = -1


static func _ensure_noise(world_seed: int) -> void:
	if _noise_ready and _current_seed == world_seed:
		return
	_current_seed = world_seed

	_n_continent = FastNoiseLite.new()
	_n_continent.seed = world_seed
	_n_continent.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_continent.fractal_type = FastNoiseLite.FRACTAL_FBM
	_n_continent.fractal_octaves = 8
	_n_continent.frequency = 0.008

	_n_ridge = FastNoiseLite.new()
	_n_ridge.seed = world_seed + 1000
	_n_ridge.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_ridge.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_n_ridge.fractal_octaves = 5
	_n_ridge.frequency = 0.012

	_n_warp = FastNoiseLite.new()
	_n_warp.seed = world_seed + 777
	_n_warp.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_warp.fractal_type = FastNoiseLite.FRACTAL_FBM
	_n_warp.fractal_octaves = 4
	_n_warp.frequency = 0.005

	_n_temp = FastNoiseLite.new()
	_n_temp.seed = world_seed + 333
	_n_temp.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_temp.fractal_type = FastNoiseLite.FRACTAL_FBM
	_n_temp.fractal_octaves = 6
	_n_temp.frequency = 0.007

	_n_moist = FastNoiseLite.new()
	_n_moist.seed = world_seed + 500
	_n_moist.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_moist.fractal_type = FastNoiseLite.FRACTAL_FBM
	_n_moist.fractal_octaves = 6
	_n_moist.frequency = 0.009

	_n_magic = FastNoiseLite.new()
	_n_magic.seed = world_seed + 888
	_n_magic.noise_type = FastNoiseLite.TYPE_PERLIN
	_n_magic.fractal_type = FastNoiseLite.FRACTAL_FBM
	_n_magic.fractal_octaves = 4
	_n_magic.frequency = 0.004

	_noise_ready = true


static func sample_height_at_pixel(px: float, py: float) -> float:
	## Sample overmap height at pixel coordinates. Used by terrain layers.
	var warp_x = _n_warp.get_noise_2d(px, py) * 25.0
	var warp_y = _n_warp.get_noise_2d(px + 300.0, py + 300.0) * 25.0
	var wx = px + warp_x
	var wy = py + warp_y
	var continent = (_n_continent.get_noise_2d(wx, wy) + 1.0) * 0.5
	var ridge = _n_ridge.get_noise_2d(wx * 0.8, wy * 0.8)
	var h = continent * 0.7 + ridge * 0.3
	return clampf(h, 0.0, 1.0)


static func sample_temp_at_pixel(px: float, py: float, h: float) -> float:
	## Sample overmap temperature at pixel coordinates.
	var warp_x = _n_warp.get_noise_2d(px, py) * 25.0
	var warp_y = _n_warp.get_noise_2d(px + 300.0, py + 300.0) * 25.0
	var wx = px + warp_x
	var wy = py + warp_y
	var t = (_n_temp.get_noise_2d(wx, wy) + 1.0) * 0.5
	# Threshold penalty: no cooling near sea level, strong cooling at altitude
	t -= maxf(0.0, h - 0.45) * 1.0
	return clampf(t, 0.0, 1.0)


static func sample_moisture_at_pixel(px: float, py: float) -> float:
	## Sample overmap moisture at pixel coordinates.
	var warp_x = _n_warp.get_noise_2d(px, py) * 25.0
	var warp_y = _n_warp.get_noise_2d(px + 300.0, py + 300.0) * 25.0
	var wx = px + warp_x
	var wy = py + warp_y
	var m = (_n_moist.get_noise_2d(wx, wy) + 1.0) * 0.5
	return clampf(m, 0.0, 1.0)


static func sample_magic_at_pixel(px: float, py: float) -> float:
	## Sample overmap magic intensity at pixel coordinates.
	var warp_x = _n_warp.get_noise_2d(px, py) * 25.0
	var warp_y = _n_warp.get_noise_2d(px + 300.0, py + 300.0) * 25.0
	var wx = px + warp_x
	var wy = py + warp_y
	var mag = (_n_magic.get_noise_2d(wx, wy) + 1.0) * 0.5
	return clampf(mag, 0.0, 1.0)


static func chunk_to_pixel(chunk_x: int, chunk_y: int) -> Vector2:
	## Convert chunk coordinates to overmap pixel coordinates.
	return Vector2(float(chunk_x + HALF_SIZE), float(chunk_y + HALF_SIZE))


static func chunk_to_overmap_px(chunk_x: int, chunk_y: int) -> Vector2i:
	## Convert chunk coordinates to overmap pixel coordinates (integer).
	return Vector2i(chunk_x + HALF_SIZE, chunk_y + HALF_SIZE)


# --- Modifier accessors ---

static func get_volcanic_influence(px: int, py: int) -> float:
	if not _modifiers_ready:
		return 0.0
	if px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return 0.0
	return _volcanic_influence[py * MAP_SIZE + px]


static func get_mystic_influence(px: int, py: int) -> float:
	if not _modifiers_ready:
		return 0.0
	if px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return 0.0
	return _mystic_influence[py * MAP_SIZE + px]


static func is_lake(px: int, py: int) -> bool:
	if not _modifiers_ready:
		return false
	if px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return false
	return _lake_mask[py * MAP_SIZE + px] == 1


static func is_river(px: int, py: int) -> bool:
	if not _modifiers_ready:
		return false
	if px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return false
	return _river_mask[py * MAP_SIZE + px] == 1


# --- Modifier computation ---

static func _compute_modifiers(world_seed: int) -> void:
	if _modifiers_ready and _modifiers_seed == world_seed:
		return
	_ensure_noise(world_seed)
	_modifiers_seed = world_seed

	var total_pixels = MAP_SIZE * MAP_SIZE
	_volcanic_influence = PackedFloat32Array()
	_volcanic_influence.resize(total_pixels)
	_mystic_influence = PackedFloat32Array()
	_mystic_influence.resize(total_pixels)
	_lake_mask = PackedByteArray()
	_lake_mask.resize(total_pixels)
	_river_mask = PackedByteArray()
	_river_mask.resize(total_pixels)

	# Pre-sample all fields
	var heights = PackedFloat32Array()
	heights.resize(total_pixels)
	var temps = PackedFloat32Array()
	temps.resize(total_pixels)
	var moistures = PackedFloat32Array()
	moistures.resize(total_pixels)
	var ridges = PackedFloat32Array()
	ridges.resize(total_pixels)
	var magics = PackedFloat32Array()
	magics.resize(total_pixels)

	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var idx = py * MAP_SIZE + px
			var fpx = float(px)
			var fpy = float(py)
			var h = sample_height_at_pixel(fpx, fpy)
			heights[idx] = h
			# Raw temp without elevation penalty for volcanic scoring
			var warp_x = _n_warp.get_noise_2d(fpx, fpy) * 25.0
			var warp_y = _n_warp.get_noise_2d(fpx + 300.0, fpy + 300.0) * 25.0
			var wx = fpx + warp_x
			var wy = fpy + warp_y
			var raw_t = (_n_temp.get_noise_2d(wx, wy) + 1.0) * 0.5
			temps[idx] = raw_t
			moistures[idx] = sample_moisture_at_pixel(fpx, fpy)
			ridges[idx] = _n_ridge.get_noise_2d(wx * 0.8, wy * 0.8)
			magics[idx] = sample_magic_at_pixel(fpx, fpy)

	# --- Volcanic hotspot: highest ridge * raw_temp where h is 0.5-0.85 ---
	var best_volcanic_score = -1.0
	var best_volcanic_px = -1
	var best_volcanic_py = -1
	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var idx = py * MAP_SIZE + px
			var h = heights[idx]
			if h < 0.5 or h > 0.85:
				continue
			var score = ridges[idx] * temps[idx]
			if score > best_volcanic_score:
				best_volcanic_score = score
				best_volcanic_px = px
				best_volcanic_py = py

	if best_volcanic_px >= 0:
		var radius = 25
		var r2 = radius * radius
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				var tx = best_volcanic_px + dx
				var ty = best_volcanic_py + dy
				if tx < 0 or tx >= MAP_SIZE or ty < 0 or ty >= MAP_SIZE:
					continue
				var dist2 = dx * dx + dy * dy
				if dist2 > r2:
					continue
				var dist = sqrt(float(dist2))
				var influence = 1.0 - (dist / float(radius))
				var idx = ty * MAP_SIZE + tx
				if influence > _volcanic_influence[idx]:
					_volcanic_influence[idx] = influence

	# --- Mystic domains: top 3-4 magic peaks > 0.65 on land, separated by 50+ ---
	var mystic_centers: Array = []
	var magic_candidates: Array = []
	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var idx = py * MAP_SIZE + px
			if heights[idx] < 0.42:
				continue
			if magics[idx] > 0.65:
				magic_candidates.append({"px": px, "py": py, "val": magics[idx]})

	magic_candidates.sort_custom(func(a, b): return a["val"] > b["val"])

	for candidate in magic_candidates:
		if mystic_centers.size() >= 4:
			break
		var cpx = candidate["px"]
		var cpy = candidate["py"]
		var too_close = false
		for existing in mystic_centers:
			var ex = existing["px"]
			var ey = existing["py"]
			var ddx = cpx - ex
			var ddy = cpy - ey
			if ddx * ddx + ddy * ddy < 50 * 50:
				too_close = true
				break
		if too_close:
			continue
		mystic_centers.append(candidate)

	for center in mystic_centers:
		var cx = center["px"]
		var cy = center["py"]
		var radius = 15
		var r2 = radius * radius
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				var tx = cx + dx
				var ty = cy + dy
				if tx < 0 or tx >= MAP_SIZE or ty < 0 or ty >= MAP_SIZE:
					continue
				var dist2 = dx * dx + dy * dy
				if dist2 > r2:
					continue
				var dist = sqrt(float(dist2))
				var influence = 1.0 - (dist / float(radius))
				var idx = ty * MAP_SIZE + tx
				if influence > _mystic_influence[idx]:
					_mystic_influence[idx] = influence

	# --- Lakes: local elevation minima on mid-elevation land, separated by 40+ ---
	var lake_candidates: Array = []
	for py in range(4, MAP_SIZE - 4):
		for px in range(4, MAP_SIZE - 4):
			var idx = py * MAP_SIZE + px
			var h = heights[idx]
			if h < 0.42 or h > 0.75:
				continue
			# Check if local minimum in 5x5 neighborhood
			var is_min = true
			for dy in range(-2, 3):
				for dx in range(-2, 3):
					if dx == 0 and dy == 0:
						continue
					var nidx = (py + dy) * MAP_SIZE + (px + dx)
					if heights[nidx] < h:
						is_min = false
						break
				if not is_min:
					break
			if is_min:
				lake_candidates.append({"px": px, "py": py, "h": h, "m": moistures[idx]})

	# Sort by lowest elevation first (best lake spots)
	lake_candidates.sort_custom(func(a, b): return a["h"] < b["h"])

	var lake_centers: Array = []
	for candidate in lake_candidates:
		if lake_centers.size() >= 8:
			break
		var cpx = candidate["px"]
		var cpy = candidate["py"]
		var too_close = false
		for existing in lake_centers:
			var ex = existing["px"]
			var ey = existing["py"]
			var ddx = cpx - ex
			var ddy = cpy - ey
			if ddx * ddx + ddy * ddy < 40 * 40:
				too_close = true
				break
		if too_close:
			continue
		lake_centers.append(candidate)

	# Paint lake circles — radius 3-5 based on local moisture
	for lake in lake_centers:
		var lx = lake["px"]
		var ly = lake["py"]
		var lm = lake["m"]
		var radius = 5 + int(lm * 3.0)  # 5 at m=0, 8 at m=1
		if radius > 8:
			radius = 8
		var r2 = radius * radius
		for dy in range(-radius, radius + 1):
			for dx in range(-radius, radius + 1):
				var tx = lx + dx
				var ty = ly + dy
				if tx < 0 or tx >= MAP_SIZE or ty < 0 or ty >= MAP_SIZE:
					continue
				if dx * dx + dy * dy <= r2:
					_lake_mask[ty * MAP_SIZE + tx] = 1

	# --- Rivers: from each lake, follow downhill gradient to ocean ---
	# When stuck on flat terrain, erode slightly (rivers carve terrain) and continue.
	# Use moisture as tiebreaker — rivers prefer wetter paths.
	for lake in lake_centers:
		var rx = lake["px"]
		var ry = lake["py"]
		var max_steps = 300
		var stuck_count = 0
		var step = 0
		while step < max_steps:
			step += 1
			var cur_idx = ry * MAP_SIZE + rx
			var cur_h = heights[cur_idx]
			if cur_h < 0.38:
				break  # Reached ocean
			# Find lowest neighbor in 3x3, with moisture tiebreaker
			var best_x = rx
			var best_y = ry
			var best_h = cur_h
			var best_m = 0.0
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					if dx == 0 and dy == 0:
						continue
					var nx = rx + dx
					var ny = ry + dy
					if nx < 0 or nx >= MAP_SIZE or ny < 0 or ny >= MAP_SIZE:
						continue
					var nidx = ny * MAP_SIZE + nx
					var nh = heights[nidx]
					var nm = moistures[nidx]
					if nh < best_h or (nh == best_h and nm > best_m):
						best_h = nh
						best_x = nx
						best_y = ny
						best_m = nm
			if best_x == rx and best_y == ry:
				stuck_count += 1
				if stuck_count > 3:
					break  # Truly stuck
				# Erode: lower current cell slightly so next iteration can flow
				heights[cur_idx] = cur_h - 0.002
				continue
			stuck_count = 0
			rx = best_x
			ry = best_y
			var ridx = ry * MAP_SIZE + rx
			if _lake_mask[ridx] == 0:
				_river_mask[ridx] = 1

	_modifiers_ready = true

	# Summary
	var river_count = 0
	var lake_count = 0
	for i in range(total_pixels):
		if _river_mask[i] == 1:
			river_count += 1
		if _lake_mask[i] == 1:
			lake_count += 1
	print("[Overmap] Modifiers: volcanic=%s mystic=%d lakes=%d(%dpx) rivers=%dpx" % [
		"yes" if best_volcanic_px >= 0 else "no",
		mystic_centers.size(),
		lake_centers.size(),
		lake_count,
		river_count,
	])


# --- Map generation ---

static func get_or_create(world_seed: int) -> ImageTexture:
	var cache_path = "user://overmap_%d.png" % world_seed
	if FileAccess.file_exists(cache_path):
		var cached = Image.load_from_file(cache_path)
		if cached != null and cached.get_width() > 0:
			return ImageTexture.create_from_image(cached)
	_ensure_noise(world_seed)
	_compute_modifiers(world_seed)
	var img = _generate(world_seed)
	img.save_png(cache_path)
	return ImageTexture.create_from_image(img)


static func _generate(world_seed: int) -> Image:
	_ensure_noise(world_seed)
	_compute_modifiers(world_seed)
	var img = Image.create(MAP_SIZE, MAP_SIZE, false, Image.FORMAT_RGB8)

	# Biome pixel counter for diagnostics
	var biome_counts = {}

	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var h = sample_height_at_pixel(float(px), float(py))
			var t = sample_temp_at_pixel(float(px), float(py), h)
			var m = sample_moisture_at_pixel(float(px), float(py))
			var biome_name = _classify_name(h, t, m, px, py)
			var color = _classify(h, t, m, px, py)
			biome_counts[biome_name] = biome_counts.get(biome_name, 0) + 1
			# Elevation shading on the overmap — higher = lighter, lower = darker
			# Makes mountains visually pop and valleys recede
			if h > 0.3:  # Don't shade water
				var shade = (h - 0.3) * 0.4  # 0.0 at sea level, ~0.28 at peaks
				color = color.lightened(shade * 0.5)
				# Add subtle contour lines every 0.1 elevation
				var contour = fmod(h, 0.1)
				if contour < 0.008 or contour > 0.092:
					color = color.darkened(0.15)
			img.set_pixel(px, py, color)

	# Print biome distribution
	var total_land = MAP_SIZE * MAP_SIZE
	var sorted_biomes = biome_counts.keys()
	sorted_biomes.sort()
	print("[OvermapGenerator] Biome distribution (seed %d):" % world_seed)
	for biome_name in sorted_biomes:
		var count = biome_counts[biome_name]
		var pct = float(count) / float(total_land) * 100.0
		print("  %-20s %6d px  (%5.1f%%)" % [biome_name, count, pct])

	return img


static func _classify(h: float, t: float, m: float, px: int = -1, py: int = -1) -> Color:
	## Classify biome from height, temperature, moisture, and modifier fields.
	## Thresholds must match BiomeLayer + OceanMaskLayer.

	# Ocean — matches OceanMaskLayer.SEA_LEVEL = 0.38
	if h < 0.38:
		if h < 0.2:
			return Color(0.05, 0.12, 0.35)        # Deep ocean
		if h < 0.3:
			return Color(0.1, 0.3, 0.6)            # Shallow ocean
		return Color(0.2, 0.5, 0.8)                # Coastal water

	# Beach — matches BiomeLayer: h < 0.42 near ocean
	if h < 0.42:
		return Color(0.9, 0.85, 0.6)               # Beach

	# --- Modifier overrides (before standard biome rules) ---
	if px >= 0 and py >= 0 and _modifiers_ready:
		var pidx = py * MAP_SIZE + px

		# River (not lake) — flowing water
		if _river_mask[pidx] == 1 and _lake_mask[pidx] == 0:
			return Color(0.3, 0.6, 0.9)            # River

		# Lake — standing water
		if _lake_mask[pidx] == 1:
			return Color(0.25, 0.55, 0.85)          # Lake

		# Volcanic — hot, barren, dangerous
		var volc = _volcanic_influence[pidx]
		if volc > 0.5:
			return Color(0.6, 0.15, 0.05)           # Volcanic
		elif volc > 0.15:
			# Swamp boost near volcanic zones — heat + moisture
			m = m + volc * 0.8

		# Mystic — strange, magical terrain
		var myst = _mystic_influence[pidx]
		if myst > 0.5:
			return Color(0.45, 0.15, 0.6)           # Mystic

	# Mountains: h > 0.75
	if h > 0.75:
		if t < 0.2:
			return Color(0.9, 0.93, 0.97)           # Arctic mountain peaks
		return Color(0.55, 0.55, 0.55)             # Mountains (gray)

	# Swamp: m > 0.7 and h < 0.55 and t > 0.25
	if m > 0.7 and h < 0.55 and t > 0.25:
		return Color(0.3, 0.4, 0.25)               # Swamp

	# Arctic: t < 0.2
	if t < 0.2:
		return Color(0.9, 0.93, 0.97)              # Arctic

	# Tundra: t 0.2-0.35, m < 0.5
	if t >= 0.2 and t < 0.35 and m < 0.5:
		return Color(0.7, 0.75, 0.8)               # Tundra

	# Taiga: t 0.2-0.35, m >= 0.5
	if t >= 0.2 and t < 0.35 and m >= 0.5:
		return Color(0.2, 0.4, 0.3)                # Taiga

	# Desert: t >= 0.55, m < 0.3
	if t >= 0.55 and m < 0.3:
		return Color(0.85, 0.75, 0.45)             # Desert

	# Savanna: t >= 0.55, m 0.3-0.55
	if t >= 0.55 and m >= 0.3 and m < 0.55:
		return Color(0.7, 0.65, 0.3)               # Savanna

	# Tropical forest: t >= 0.55, m >= 0.55
	if t >= 0.55 and m >= 0.55:
		return Color(0.1, 0.6, 0.2)                # Tropical forest

	# Steppe: t 0.35-0.55, m < 0.35
	if t >= 0.35 and t < 0.55 and m < 0.35:
		return Color(0.6, 0.55, 0.35)              # Steppe

	# Grassland: t 0.35-0.55, m 0.35-0.5
	if t >= 0.35 and t < 0.55 and m >= 0.35 and m < 0.5:
		return Color(0.4, 0.75, 0.3)               # Grassland

	# Forest: t 0.35-0.55, m 0.5-0.65
	if t >= 0.35 and t < 0.55 and m >= 0.5 and m < 0.65:
		return Color(0.15, 0.5, 0.15)              # Forest

	# Dense forest: t 0.35-0.55, m >= 0.65
	if t >= 0.35 and t < 0.55 and m >= 0.65:
		return Color(0.05, 0.35, 0.1)              # Dense forest

	return Color(0.4, 0.75, 0.3)                   # Default grassland


static func _classify_name(h: float, t: float, m: float, px: int = -1, py: int = -1) -> String:
	if h < 0.38:
		if h < 0.2:
			return "deep_ocean"
		if h < 0.3:
			return "shallow_ocean"
		return "coastal_water"
	if h < 0.42:
		return "beach"
	if px >= 0 and py >= 0 and _modifiers_ready:
		var pidx = py * MAP_SIZE + px
		if _river_mask[pidx] == 1 and _lake_mask[pidx] == 0:
			return "river"
		if _lake_mask[pidx] == 1:
			return "lake"
		var volc = _volcanic_influence[pidx]
		if volc > 0.5:
			return "volcanic"
		elif volc > 0.15:
			m = m + volc * 0.8
		var myst = _mystic_influence[pidx]
		if myst > 0.5:
			return "mystic"
	if h > 0.75:
		if t < 0.2:
			return "arctic"
		return "mountains"
	if m > 0.7 and h < 0.55 and t > 0.25:
		return "swamp"
	if t < 0.2:
		return "arctic"
	if t >= 0.2 and t < 0.35 and m < 0.5:
		return "tundra"
	if t >= 0.2 and t < 0.35 and m >= 0.5:
		return "taiga"
	if t >= 0.55 and m < 0.3:
		return "desert"
	if t >= 0.55 and m >= 0.3 and m < 0.55:
		return "savanna"
	if t >= 0.55 and m >= 0.55:
		return "tropical_forest"
	if t >= 0.35 and t < 0.55 and m < 0.35:
		return "steppe"
	if t >= 0.35 and t < 0.55 and m >= 0.35 and m < 0.5:
		return "grassland"
	if t >= 0.35 and t < 0.55 and m >= 0.5 and m < 0.65:
		return "forest"
	if t >= 0.35 and t < 0.55 and m >= 0.65:
		return "dense_forest"
	return "grassland"
