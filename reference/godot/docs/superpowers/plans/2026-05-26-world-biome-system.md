# World Biome System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 18 biomes (including volcanic, arctic, mystic, lake, river) appear on both the overmap and in chunk terrain, with procedural macro feature placement guaranteeing geographic structure.

**Architecture:** The overmap generator scans base noise fields to derive macro features (mountain spine, volcanic hotspot, mystic domains, lakes, rivers) and stores them as static modifier arrays. The chunk streamer applies modifier overrides to biome_id after C++ compilation. The C++ compiler gets minimal changes: expanded enum, magic noise, stronger temp penalty.

**Tech Stack:** C++ GDExtension (NativeChunkCompiler), GDScript (OvermapGenerator, ChunkStreamer, CleanWorld), SCons build

**Spec:** `docs/superpowers/specs/2026-05-26-world-biome-system-design.md`

**Testing strategy:** No unit test framework exists for GDScript or this C++ codebase. Verification is: C++ compiles, game runs (F6), overmap shows all 18 biome colors, teleport to each biome produces correct chunk terrain. Visual verification at each stage.

**GDScript safety:** NEVER use `:=` with `Dictionary.get()`, `abs()`, or untyped returns. Always use `=`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `gdextension/src/noise_sampler.h` | Modify | Add magic noise field, increase temp penalty |
| `gdextension/src/native_chunk_compiler.h` | Modify | Add MYSTIC=17 to enum, expand array |
| `gdextension/src/native_chunk_compiler.cpp` | Modify | Update biome name array to 18, update _biome_to_mapped array |
| `scripts/core/overmap_generator.gd` | Modify | Add magic noise, modifier computation, new biome colors, modifier accessors |
| `scripts/core/chunk_streamer.gd` | Modify | Apply modifier overrides to biome_id after compile_chunk |
| `scripts/core/world_compiler/tilemap_terrain_renderer.gd` | Modify | Add "mystic" to fallback dictionary |
| `scripts/CleanWorld.gd` | Modify | Teleport land-snap, speed floor fix |

---

### Task 1: C++ Enum Expansion + Noise Changes

**Files:**
- Modify: `gdextension/src/native_chunk_compiler.h:27-31`
- Modify: `gdextension/src/native_chunk_compiler.cpp:248-256` (biome name array)
- Modify: `gdextension/src/native_chunk_compiler.cpp:320-325` (biome mapping array)
- Modify: `gdextension/src/native_chunk_compiler.h:58` (array size)
- Modify: `gdextension/src/noise_sampler.h:67-74` (temp penalty)
- Modify: `gdextension/src/noise_sampler.h:19-53` (add magic noise)

- [ ] **Step 1: Add MYSTIC to enum in header**

In `native_chunk_compiler.h`, change the enum:

```cpp
enum Biome {
    OCEAN = 0, BEACH, GRASSLAND, FOREST, DENSE_FOREST, DESERT,
    SAVANNA, STEPPE, TUNDRA, TAIGA, MOUNTAINS, SWAMP,
    TROPICAL_FOREST, VOLCANIC, ARCTIC, LAKE, RIVER, MYSTIC
};
```

Change array size from 17 to 18:
```cpp
uint8_t _biome_to_mapped[18];  // biome_id -> mapped biome_id
```

- [ ] **Step 2: Update biome name array in cpp (all 3 locations)**

In `native_chunk_compiler.cpp`, update ALL three `BIOME_NAMES` arrays (lines ~249, ~320, ~383) to have 18 entries:

```cpp
static const char* BIOME_NAMES[] = {
    "ocean", "beach", "grassland", "forest", "dense_forest", "desert",
    "savanna", "steppe", "tundra", "taiga", "mountains", "swamp",
    "tropical_forest", "volcanic", "arctic", "lake", "river", "mystic"
};
```

Update the loop bound from `17` to `18` in `_build_biome_mapping` and `_get_biome_name`:

```cpp
// In _get_biome_name:
if (b < 18) return String(BIOME_NAMES[b]);

// In _build_biome_mapping:
for (int i = 0; i < 18; i++) {
```

Also update `mapped_biomes` default fallback:
```cpp
mapped_biomes[i] = (b < 18) ? _biome_to_mapped[b] : 2; // default grassland
```

- [ ] **Step 3: Add magic noise to noise_sampler.h**

Add a `magic` noise field to the `OvermapNoise` struct:

```cpp
godot::Ref<godot::FastNoiseLite> magic;
```

In `init()`, add after the moist initialization:

```cpp
magic.instantiate();
magic->set_seed(world_seed + 888);
magic->set_noise_type(godot::FastNoiseLite::TYPE_PERLIN);
magic->set_fractal_type(godot::FastNoiseLite::FRACTAL_FBM);
magic->set_fractal_octaves(4);
magic->set_frequency(0.004f);
```

Add a sampling method:

```cpp
float sample_magic(float px, float py) const {
    float warp_x = warp->get_noise_2d(px, py) * 25.0f;
    float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
    float wx = px + warp_x;
    float wy = py + warp_y;
    float m = (magic->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
    return std::clamp(m, 0.0f, 1.0f);
}
```

- [ ] **Step 4: Increase temperature elevation penalty**

In `noise_sampler.h`, change `sample_temp`:

```cpp
float sample_temp(float px, float py, float h) const {
    float warp_x = warp->get_noise_2d(px, py) * 25.0f;
    float warp_y = warp->get_noise_2d(px + 300.0f, py + 300.0f) * 25.0f;
    float wx = px + warp_x;
    float wy = py + warp_y;
    float t = (temp->get_noise_2d(wx, wy) + 1.0f) * 0.5f;
    t -= h * 0.45f;  // Was 0.15f — stronger altitude cooling
    return std::clamp(t, 0.0f, 1.0f);
}
```

Also in `native_chunk_compiler.cpp` `_compile_climate`, change the local elevation adjustment:

```cpp
temp_val -= (h - base_h) * 0.5f;  // Was 0.3f — stronger local cooling on peaks
```

- [ ] **Step 5: Rebuild C++**

```bash
cd gdextension && scons platform=windows target=template_debug -j8
```

Expected: Compiles successfully, produces `bin/libfreedommmo.windows.template_debug.x86_64.dll`

- [ ] **Step 6: Commit**

```bash
git add gdextension/src/native_chunk_compiler.h gdextension/src/native_chunk_compiler.cpp gdextension/src/noise_sampler.h
git commit -m "feat: expand biome enum to 18 (add MYSTIC), add magic noise, stronger temp penalty"
```

---

### Task 2: Overmap Modifier System

**Files:**
- Modify: `scripts/core/overmap_generator.gd`

This task adds magic noise, modifier field computation, and static accessors so the chunk streamer can query them.

- [ ] **Step 1: Add magic noise and modifier storage**

Add to the static variables at the top of `overmap_generator.gd`:

```gdscript
static var _n_magic: FastNoiseLite
# Modifier fields — 640x640 arrays computed at world init
static var _volcanic_influence: PackedFloat32Array  # 0.0-1.0 radial from hotspot
static var _mystic_influence: PackedFloat32Array    # 0.0-1.0 radial from domains
static var _lake_mask: PackedByteArray              # 1 = lake cell
static var _river_mask: PackedByteArray             # 1 = river cell
static var _modifiers_ready: bool = false
```

In `_ensure_noise()`, add magic noise init after moist:

```gdscript
_n_magic = FastNoiseLite.new()
_n_magic.seed = world_seed + 888
_n_magic.noise_type = FastNoiseLite.TYPE_PERLIN
_n_magic.fractal_type = FastNoiseLite.FRACTAL_FBM
_n_magic.fractal_octaves = 4
_n_magic.frequency = 0.004
```

Add a sampling method:

```gdscript
static func sample_magic_at_pixel(px: float, py: float) -> float:
	var warp_x = _n_warp.get_noise_2d(px, py) * 25.0
	var warp_y = _n_warp.get_noise_2d(px + 300.0, py + 300.0) * 25.0
	var wx = px + warp_x
	var wy = py + warp_y
	var m = (_n_magic.get_noise_2d(wx, wy) + 1.0) * 0.5
	return clampf(m, 0.0, 1.0)
```

- [ ] **Step 2: Implement modifier computation**

Add the `_compute_modifiers()` function. This scans all 640x640 pixels to find feature anchor points, then builds radial influence fields:

```gdscript
static func _compute_modifiers(world_seed: int) -> void:
	if _modifiers_ready and _current_seed == world_seed:
		return
	_ensure_noise(world_seed)

	var total = MAP_SIZE * MAP_SIZE
	_volcanic_influence = PackedFloat32Array()
	_volcanic_influence.resize(total)
	_mystic_influence = PackedFloat32Array()
	_mystic_influence.resize(total)
	_lake_mask = PackedByteArray()
	_lake_mask.resize(total)
	_river_mask = PackedByteArray()
	_river_mask.resize(total)

	# --- Pass 1: Sample all noise values ---
	var heights = PackedFloat32Array()
	heights.resize(total)
	var temps = PackedFloat32Array()
	temps.resize(total)
	var moistures = PackedFloat32Array()
	moistures.resize(total)
	var ridges = PackedFloat32Array()
	ridges.resize(total)
	var magics = PackedFloat32Array()
	magics.resize(total)

	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var i = py * MAP_SIZE + px
			var fpx = float(px)
			var fpy = float(py)
			var h = sample_height_at_pixel(fpx, fpy)
			heights[i] = h
			temps[i] = sample_temp_at_pixel(fpx, fpy, h)
			moistures[i] = sample_moisture_at_pixel(fpx, fpy)
			# Ridge noise (same params as C++)
			var warp_x = _n_warp.get_noise_2d(fpx, fpy) * 25.0
			var warp_y = _n_warp.get_noise_2d(fpx + 300.0, fpy + 300.0) * 25.0
			ridges[i] = _n_ridge.get_noise_2d((fpx + warp_x) * 0.8, (fpy + warp_y) * 0.8)
			magics[i] = sample_magic_at_pixel(fpx, fpy)

	# --- Pass 2: Find volcanic hotspot ---
	# Volcanic = where ridge is highest AND base temp is hottest (before elevation penalty)
	var best_volcanic_score = -1.0
	var volcanic_px = MAP_SIZE / 2
	var volcanic_py = MAP_SIZE / 2
	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var i = py * MAP_SIZE + px
			var h = heights[i]
			if h < 0.5 or h > 0.85:  # Must be on elevated land, not ocean or mountain peak
				continue
			# Score = ridge value × raw temperature (undo elevation penalty to get base temp)
			var raw_t = temps[i] + h * 0.45
			var score = ridges[i] * raw_t
			if score > best_volcanic_score:
				best_volcanic_score = score
				volcanic_px = px
				volcanic_py = py

	# Apply volcanic influence — radial falloff, radius 18 pixels
	var volcanic_radius = 18.0
	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var dist = sqrt(float((px - volcanic_px) * (px - volcanic_px) + (py - volcanic_py) * (py - volcanic_py)))
			var influence = clampf(1.0 - dist / volcanic_radius, 0.0, 1.0)
			_volcanic_influence[py * MAP_SIZE + px] = influence

	# --- Pass 3: Find mystic domains ---
	# Find top 4 magic noise peaks (separated by at least 60 pixels)
	var mystic_centers: Array = []
	var min_separation = 60.0
	var mystic_candidates: Array = []  # [score, px, py]
	for py in range(MAP_SIZE):
		for px in range(MAP_SIZE):
			var i = py * MAP_SIZE + px
			if heights[i] < 0.38:  # Not in ocean
				continue
			if magics[i] > 0.72:
				mystic_candidates.append([magics[i], px, py])
	mystic_candidates.sort_custom(func(a, b): return a[0] > b[0])

	for candidate in mystic_candidates:
		if mystic_centers.size() >= 4:
			break
		var cpx = candidate[1]
		var cpy = candidate[2]
		var too_close = false
		for existing in mystic_centers:
			var dist = sqrt(float((cpx - existing[0]) * (cpx - existing[0]) + (cpy - existing[1]) * (cpy - existing[1])))
			if dist < min_separation:
				too_close = true
				break
		if not too_close:
			mystic_centers.append([cpx, cpy])

	# Apply mystic influence — radial falloff, radius 10 pixels per domain
	var mystic_radius = 10.0
	for center in mystic_centers:
		var mcx = center[0]
		var mcy = center[1]
		for py in range(MAP_SIZE):
			for px in range(MAP_SIZE):
				var dist = sqrt(float((px - mcx) * (px - mcx) + (py - mcy) * (py - mcy)))
				var influence = clampf(1.0 - dist / mystic_radius, 0.0, 1.0)
				var i = py * MAP_SIZE + px
				_mystic_influence[i] = maxf(_mystic_influence[i], influence)

	# --- Pass 4: Find lakes ---
	# Local elevation minima on land, not near ocean, not in volcanic/mystic
	var lake_candidates: Array = []  # [elevation, px, py]
	for py in range(10, MAP_SIZE - 10):
		for px in range(10, MAP_SIZE - 10):
			var i = py * MAP_SIZE + px
			var h = heights[i]
			if h < 0.42 or h > 0.75:  # Must be mid-elevation land
				continue
			if _volcanic_influence[i] > 0.3 or _mystic_influence[i] > 0.3:
				continue
			# Check if local minimum (lower than all 8 neighbors at distance 3)
			var is_minimum = true
			for dy in range(-3, 4):
				for dx in range(-3, 4):
					if dx == 0 and dy == 0:
						continue
					var ni = (py + dy) * MAP_SIZE + (px + dx)
					if heights[ni] < h:
						is_minimum = false
						break
				if not is_minimum:
					break
			if is_minimum:
				lake_candidates.append([h, px, py])

	# Pick top 8 lakes, separated by at least 40 pixels
	lake_candidates.sort_custom(func(a, b): return a[0] < b[0])
	var lake_centers: Array = []
	for candidate in lake_candidates:
		if lake_centers.size() >= 8:
			break
		var lpx = candidate[1]
		var lpy = candidate[2]
		var too_close = false
		for existing in lake_centers:
			var dist = sqrt(float((lpx - existing[0]) * (lpx - existing[0]) + (lpy - existing[1]) * (lpy - existing[1])))
			if dist < 40.0:
				too_close = true
				break
		if not too_close:
			lake_centers.append([lpx, lpy])

	# Paint lake masks — radius 3-5 based on local moisture
	for center in lake_centers:
		var lcx = center[0]
		var lcy = center[1]
		var local_m = moistures[lcy * MAP_SIZE + lcx]
		var radius = lerpf(3.0, 5.0, local_m)
		for py in range(MAP_SIZE):
			for px in range(MAP_SIZE):
				var dist = sqrt(float((px - lcx) * (px - lcx) + (py - lcy) * (py - lcy)))
				if dist <= radius and heights[py * MAP_SIZE + px] >= 0.38:
					_lake_mask[py * MAP_SIZE + px] = 1

	# --- Pass 5: Trace rivers from lakes downhill ---
	for center in lake_centers:
		var rx = center[0]
		var ry = center[1]
		var max_steps = 200
		for _step in range(max_steps):
			_river_mask[ry * MAP_SIZE + rx] = 1
			# Find lowest neighbor
			var best_h = heights[ry * MAP_SIZE + rx]
			var best_dx = 0
			var best_dy = 0
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					if dx == 0 and dy == 0:
						continue
					var nx = rx + dx
					var ny = ry + dy
					if nx < 0 or nx >= MAP_SIZE or ny < 0 or ny >= MAP_SIZE:
						continue
					var nh = heights[ny * MAP_SIZE + nx]
					if nh < best_h:
						best_h = nh
						best_dx = dx
						best_dy = dy
			if best_dx == 0 and best_dy == 0:
				break  # No downhill — stuck in basin
			rx += best_dx
			ry += best_dy
			if heights[ry * MAP_SIZE + rx] < 0.38:
				break  # Reached ocean

	# --- Pass 6: Boost moisture near volcanic to create swamp border ---
	# This doesn't modify moistures[] — it's applied during classification
	# The _classify function will check volcanic_influence and boost moisture locally

	_modifiers_ready = true
	print("[OvermapGenerator] Modifiers computed: volcanic at (%d,%d), %d mystic domains, %d lakes" % [
		volcanic_px, volcanic_py, mystic_centers.size(), lake_centers.size()
	])
```

- [ ] **Step 3: Add static accessor functions**

```gdscript
static func get_volcanic_influence(px: int, py: int) -> float:
	if not _modifiers_ready or px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return 0.0
	return _volcanic_influence[py * MAP_SIZE + px]

static func get_mystic_influence(px: int, py: int) -> float:
	if not _modifiers_ready or px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return 0.0
	return _mystic_influence[py * MAP_SIZE + px]

static func is_lake(px: int, py: int) -> bool:
	if not _modifiers_ready or px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return false
	return _lake_mask[py * MAP_SIZE + px] == 1

static func is_river(px: int, py: int) -> bool:
	if not _modifiers_ready or px < 0 or px >= MAP_SIZE or py < 0 or py >= MAP_SIZE:
		return false
	return _river_mask[py * MAP_SIZE + px] == 1

static func chunk_to_overmap_px(chunk_x: int, chunk_y: int) -> Vector2i:
	return Vector2i(chunk_x + HALF_SIZE, chunk_y + HALF_SIZE)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/overmap_generator.gd
git commit -m "feat: overmap modifier system — volcanic hotspot, mystic domains, lakes, rivers"
```

---

### Task 3: Overmap Classification + Colors

**Files:**
- Modify: `scripts/core/overmap_generator.gd` (the `_classify` and `_generate` functions)

- [ ] **Step 1: Update _generate to compute modifiers before rendering**

In `_generate()`, add modifier computation before the pixel loop:

```gdscript
static func _generate(world_seed: int) -> Image:
	_ensure_noise(world_seed)
	_compute_modifiers(world_seed)  # <-- ADD THIS LINE
	var img = Image.create(MAP_SIZE, MAP_SIZE, false, Image.FORMAT_RGB8)
	# ... rest unchanged
```

- [ ] **Step 2: Update _classify to apply modifiers**

Replace the `_classify` function. The new version checks modifier fields first (volcanic, mystic, lake, river), then falls through to standard classification:

```gdscript
static func _classify(h: float, t: float, m: float, px: int = -1, py: int = -1) -> Color:
	## Classify biome with modifier overrides.
	## px/py are overmap pixel coordinates — needed for modifier lookups.

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

	# --- Modifier overrides (checked before standard rules) ---
	if px >= 0 and py >= 0 and _modifiers_ready:
		var vi = get_volcanic_influence(px, py)
		var mi = get_mystic_influence(px, py)

		# River (check before lake — rivers flow FROM lakes)
		if is_river(px, py) and not is_lake(px, py):
			return Color(0.3, 0.6, 0.9)            # River blue

		# Lake
		if is_lake(px, py):
			return Color(0.25, 0.55, 0.85)          # Lake blue

		# Volcanic
		if vi > 0.5:
			return Color(0.6, 0.15, 0.05)           # Deep red-orange

		# Swamp boost near volcanic — increase effective moisture
		if vi > 0.15 and vi <= 0.5:
			m = clampf(m + vi * 0.8, 0.0, 1.0)

		# Mystic
		if mi > 0.5:
			return Color(0.45, 0.15, 0.6)           # Deep purple

	# Mountains — matches BiomeLayer: h > 0.82
	if h > 0.82:
		# Arctic at mountain peaks (very cold)
		if t < 0.12:
			return Color(0.9, 0.93, 0.97)           # Arctic white
		return Color(0.55, 0.55, 0.55)             # Mountains (gray)

	# Swamp — matches BiomeLayer: m > 0.8 and h < 0.5 and t > 0.3
	if m > 0.8 and h < 0.5 and t > 0.3:
		return Color(0.3, 0.4, 0.25)               # Swamp

	# Arctic: t < 0.15 (now reachable with stronger elevation penalty)
	if t < 0.15:
		return Color(0.9, 0.93, 0.97)              # Arctic white

	# Tundra: t 0.15-0.3, m < 0.4
	if t >= 0.15 and t < 0.3 and m < 0.4:
		return Color(0.7, 0.75, 0.8)               # Tundra

	# Taiga: t 0.15-0.3, m >= 0.4
	if t >= 0.15 and t < 0.3 and m >= 0.4:
		return Color(0.2, 0.4, 0.3)                # Taiga

	# Desert: t >= 0.6, m < 0.2
	if t >= 0.6 and m < 0.2:
		return Color(0.85, 0.75, 0.45)             # Desert

	# Savanna: t >= 0.6, m 0.2-0.5
	if t >= 0.6 and m >= 0.2 and m < 0.5:
		return Color(0.7, 0.65, 0.3)               # Savanna

	# Tropical forest: t >= 0.6, m >= 0.5
	if t >= 0.6 and m >= 0.5:
		return Color(0.1, 0.6, 0.2)                # Tropical forest

	# Steppe: t 0.3-0.6, m < 0.3
	if t >= 0.3 and t < 0.6 and m < 0.3:
		return Color(0.6, 0.55, 0.35)              # Steppe

	# Grassland: t 0.3-0.6, m 0.3-0.55
	if t >= 0.3 and t < 0.6 and m >= 0.3 and m < 0.55:
		return Color(0.4, 0.75, 0.3)               # Grassland

	# Forest: t 0.3-0.6, m 0.55-0.75
	if t >= 0.3 and t < 0.6 and m >= 0.55 and m < 0.75:
		return Color(0.15, 0.5, 0.15)              # Forest

	# Dense forest: t 0.3-0.6, m >= 0.75
	if t >= 0.3 and t < 0.6 and m >= 0.75:
		return Color(0.05, 0.35, 0.1)              # Dense forest

	return Color(0.4, 0.75, 0.3)                   # Default grassland
```

- [ ] **Step 3: Update the _generate pixel loop to pass coordinates**

Change the pixel loop to pass px/py to `_classify`:

```gdscript
var color = _classify(h, t, m, px, py)
```

- [ ] **Step 4: Delete cached overmap so it regenerates**

```bash
# Delete overmap cache files (if any exist)
rm -f "$APPDATA/Godot/app_userdata/FreedomMMO/overmap_*.png" 2>/dev/null || true
# Also check user:// path
find "$APPDATA" -name "overmap_42.png" -delete 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add scripts/core/overmap_generator.gd
git commit -m "feat: overmap shows all 18 biomes — volcanic, mystic, arctic, lake, river colors"
```

---

### Task 4: Chunk Biome Override

**Files:**
- Modify: `scripts/core/chunk_streamer.gd:237-289` (`_compile_chunk_data` function)

The chunk compiler (C++) classifies biomes using temp/moisture/elevation rules. It doesn't know about modifiers. After compile_chunk returns, apply overrides from the overmap modifier fields.

- [ ] **Step 1: Add biome override function**

Add this function to `chunk_streamer.gd`:

```gdscript
func _apply_modifier_overrides(chunk: ChunkData) -> void:
	## Override biome_id for volcanic/mystic/lake/river based on overmap modifiers.
	var opx = chunk.chunk_x + OvermapGenerator.HALF_SIZE
	var opy = chunk.chunk_y + OvermapGenerator.HALF_SIZE

	# Sample modifier influences at chunk's overmap position
	var vi = OvermapGenerator.get_volcanic_influence(opx, opy)
	var mi = OvermapGenerator.get_mystic_influence(opx, opy)
	var is_lake = OvermapGenerator.is_lake(opx, opy)
	var is_river = OvermapGenerator.is_river(opx, opy)

	# No overrides needed for this chunk
	if vi < 0.5 and mi < 0.5 and not is_lake and not is_river:
		return

	var biome_bytes = chunk.biome_id
	var ocean_bytes = chunk.ocean_mask
	var size = ChunkData.SIZE

	for y in range(size):
		for x in range(size):
			var i = y * size + x
			if ocean_bytes[i] == 1:
				continue  # Don't override ocean tiles

			if is_lake:
				biome_bytes[i] = 15  # LAKE
			elif is_river:
				biome_bytes[i] = 16  # RIVER
			elif vi > 0.5:
				biome_bytes[i] = 13  # VOLCANIC
			elif mi > 0.5:
				biome_bytes[i] = 17  # MYSTIC

	chunk.biome_id = biome_bytes
```

- [ ] **Step 2: Call override after compile_chunk in _compile_chunk_data**

In `_compile_chunk_data`, add the override call after C++ compilation (and after GDScript fallback), but BEFORE saving to disk cache. Insert after line ~280 (after the compile timing print), before `_propagate_single_chunk_edges`:

```gdscript
	# Apply modifier overrides (volcanic, mystic, lake, river)
	_apply_modifier_overrides(chunk)
```

The modified section should look like:

```gdscript
	var t1 = Time.get_ticks_usec()
	print("[ChunkStreamer] Compile (%d,%d): %d us%s" % [pos.x, pos.y, t1 - t0, " [C++]" if _native_compiler != null else " [GDScript]"])

	# Apply modifier overrides (volcanic, mystic, lake, river)
	_apply_modifier_overrides(chunk)

	_mutex.lock()
	_chunk_dict[pos] = chunk
	_mutex.unlock()
```

- [ ] **Step 3: Ensure modifiers are computed before chunk streaming starts**

In `setup()`, ensure modifiers are ready:

```gdscript
func setup(renderer: TileMapTerrainRenderer, phase1: WorldCompiler, phase2: WorldCompiler, seed_val: int) -> void:
	_renderer = renderer
	_phase1_compiler = phase1
	_phase2_compiler = phase2
	_world_seed = seed_val
	_try_init_native()
	# Ensure overmap modifiers are computed (needed for chunk biome overrides)
	OvermapGenerator._compute_modifiers(seed_val)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: chunk biome overrides — volcanic/mystic/lake/river from overmap modifiers"
```

---

### Task 5: Biome Fallback Dictionary

**Files:**
- Modify: `scripts/core/world_compiler/tilemap_terrain_renderer.gd:36-46`

- [ ] **Step 1: Add mystic fallback**

Update the `_biome_fallback` dictionary. The `crystal_cave` tileset exists in `assets/catalog/terrain/crystal_cave/` and is the best visual match for mystic:

```gdscript
var _biome_fallback: Dictionary = {
	"forest": "grassland", "dense_forest": "grassland",
	"tropical_forest": "grassland", "taiga": "grassland",
	"savanna": "desert", "steppe": "desert",
	"arctic": "tundra",
	"lake": "ocean", "river": "ocean",
	"beach": "desert",
	"mountains": "tundra", "hills": "grassland",
	"swamp": "grassland", "volcanic": "desert",
	"mystic": "volcanic",
	"mushroom_forest": "grassland", "frozen_lake": "ocean",
}
```

Note: `mystic` falls back to `volcanic` which falls back to `desert`. This gives mystic a reddish/dark appearance until a dedicated mystic tileset is generated. If the `crystal_cave` tileset has a manifest that registers it as a self-tileset for "mystic", it would be used directly instead.

- [ ] **Step 2: Check if crystal_cave tileset can be used for mystic**

Read `assets/catalog/terrain/crystal_cave/manifest.json`. If it has a `"lower"` field, check what biome it maps to. If it can serve as a self-tileset for mystic, add it to `_self_tilesets` loading logic.

If the manifest uses a biome name like "crystal_cave" that doesn't match "mystic", we may need to add a mapping. For V1, the fallback chain is sufficient.

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: add mystic biome to fallback dictionary"
```

---

### Task 6: Movement Fix

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Teleport land-snap — refuse ocean**

In the `_teleport_to` function (~line 232), after computing `chunk_x` and `chunk_y`, check if the target is ocean and snap to nearest land:

```gdscript
func _teleport_to(chunk_x: int, chunk_y: int) -> void:
	# Snap to land if target is ocean
	var opx = chunk_x + OvermapGenerator.HALF_SIZE
	var opy = chunk_y + OvermapGenerator.HALF_SIZE
	var h = OvermapGenerator.sample_height_at_pixel(float(opx), float(opy))
	if h < 0.38:
		# Search outward for nearest land chunk
		var found = false
		for radius in range(1, 30):
			for dy in range(-radius, radius + 1):
				for dx in range(-radius, radius + 1):
					if abs(dx) != radius and abs(dy) != radius:
						continue  # Only check perimeter
					var nh = OvermapGenerator.sample_height_at_pixel(float(opx + dx), float(opy + dy))
					if nh >= 0.42:
						chunk_x += dx
						chunk_y += dy
						found = true
						break
				if found:
					break
			if found:
				break

	_overmap_visible = false
	_overmap_layer.visible = false
	_overmap_layer.process_mode = Node.PROCESS_MODE_DISABLED
	get_viewport().gui_release_focus()
	_renderer.clear_all()
	var center_px = (chunk_x * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	var center_py = (chunk_y * ChunkData.SIZE + ChunkData.SIZE / 2) * TILE_SIZE
	_player.position = Vector2(center_px, center_py)
	await _chunk_streamer.load_grid_around(chunk_x, chunk_y, get_tree())
	print("[CleanWorld] Teleported to chunk (%d, %d)" % [chunk_x, chunk_y])
```

- [ ] **Step 2: Increase minimum speed floor**

Change the slope speed clamping to ensure minimum 60% speed. In the movement section (~line 299):

```gdscript
		# Clamp slope effect — never slower than 60% speed, even on cliffs
		var speed_mult = 1.0
		if slope > 0.01:
			speed_mult = lerpf(1.0, SPEED_UPHILL, clampf(slope * 10.0, 0.0, 0.4))
		elif slope < -0.01:
			speed_mult = lerpf(1.0, SPEED_DOWNHILL, clampf(-slope * 10.0, 0.0, 0.4))
```

Change `SPEED_UPHILL` to be less aggressive:

```gdscript
const SPEED_UPHILL: float = 0.6    # Was 0.75 — gentler uphill slowdown
```

Note: `clampf(slope * 10.0, 0.0, 0.4)` means the lerp factor maxes at 0.4, so speed_mult ranges from 0.6 to 1.15.

- [ ] **Step 3: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "fix: teleport land-snap + 60% minimum movement speed"
```

---

### Task 7: Cache Cleanup + Verification

**Files:** None (operational task)

- [ ] **Step 1: Delete stale disk cache**

The cached chunks have old biome_id data without modifier overrides. Delete them so they regenerate:

```bash
# Delete all cached region files
rm -f regions/*.bin

# Delete overmap cache
find "$APPDATA" -path "*/FreedomMMO/overmap_*.png" -delete 2>/dev/null || true
```

- [ ] **Step 2: Run the game**

Run from Godot (F6) or:
```bash
# From project root
godot --path . scenes/CleanWorld.tscn
```

- [ ] **Step 3: Verify overmap (press M)**

Check that the overmap shows:
- [ ] White regions (arctic) at mountain peaks
- [ ] Red-orange region (volcanic) — one distinct hotspot
- [ ] Purple regions (mystic) — 3-4 scattered domains
- [ ] Blue dots (lakes) scattered across land
- [ ] Blue lines (rivers) flowing from lakes toward ocean
- [ ] All existing biomes still present (grassland, forest, desert, etc.)

- [ ] **Step 4: Verify chunk teleportation**

Click on each biome color on the overmap and verify:
- [ ] Teleporting to arctic shows tundra-colored terrain (fallback)
- [ ] Teleporting to volcanic shows desert-colored terrain (fallback)
- [ ] Teleporting to mystic shows volcanic→desert-colored terrain (fallback chain)
- [ ] Teleporting to lake shows ocean-colored terrain (fallback)
- [ ] Teleporting to ocean snaps to nearest land chunk instead
- [ ] Movement works after every teleport (no stuck spots)

- [ ] **Step 5: Commit any fixes found during verification**

```bash
git add -A
git commit -m "fix: post-verification fixes for biome system"
```
