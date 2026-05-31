# Terrain Shading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire existing C++ normal maps to Godot's 2D lighting, add DirectionalLight2D sun/moon, fix day/night transitions, fix moonlight spotlight.

**Architecture:** The C++ NativeChunkCompiler already generates normal maps from elevation data. Each elevation sprite gets a CanvasTexture (diffuse + normal). A DirectionalLight2D rotates with the sun angle from DayNightCycle. Day/night color transitions use smoothstep with extended time boundaries.

**Tech Stack:** GDScript, Godot 4.4 CanvasTexture, DirectionalLight2D, existing C++ normal map generation

**Spec:** `docs/superpowers/specs/2026-05-27-terrain-shading-design.md`

---

### Task 1: Fix Day/Night Transitions — Smoothstep + Extended Boundaries

**Files:**
- Modify: `scripts/core/day_night_cycle.gd`

- [ ] **Step 1: Update time boundary constants**

In `scripts/core/day_night_cycle.gd`, replace the existing constants (lines 11-15):

```gdscript
# Time boundaries — extended for smoother transitions
const DAWN_START := 4.0       # Was 4.5
const DAWN_END := 8.0         # Was 7.0
const GOLDEN_START := 14.5    # Was 15.0
const SUNSET := 19.0          # Was 18.5
const DUSK_END := 21.5        # Was 20.5
```

- [ ] **Step 2: Add _smoothlerp helper**

Add after the existing `smoothstep` function (after line 73):

```gdscript
func _smoothlerp(a: Color, b: Color, t: float) -> Color:
	var st = t * t * (3.0 - 2.0 * t)
	return a.lerp(b, st)
```

- [ ] **Step 3: Rewrite get_sun_color with smoothstep and synced boundaries**

Replace the entire `get_sun_color()` function (lines 116-146):

```gdscript
func get_sun_color() -> Color:
	var night_color := Color(0.35, 0.4, 0.65)
	var dawn_color := Color(1.0, 0.55, 0.3)
	var day_color := Color(1.0, 0.98, 0.92)
	var golden_color := Color(1.0, 0.6, 0.2)
	var dusk_color := Color(0.95, 0.35, 0.12)

	if _hour < DAWN_START:
		return night_color
	elif _hour < DAWN_END:
		# Night → dawn → day as one smooth arc
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		if t < 0.5:
			return _smoothlerp(night_color, dawn_color, t * 2.0)
		else:
			return _smoothlerp(dawn_color, day_color, (t - 0.5) * 2.0)
	elif _hour < GOLDEN_START:
		return day_color
	elif _hour < DUSK_END:
		# Day → golden → dusk → night as one smooth arc
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		if t < 0.35:
			return _smoothlerp(day_color, golden_color, t / 0.35)
		elif t < 0.65:
			return _smoothlerp(golden_color, dusk_color, (t - 0.35) / 0.3)
		else:
			return _smoothlerp(dusk_color, night_color, (t - 0.65) / 0.35)
	else:
		return night_color
```

- [ ] **Step 4: Rewrite get_ambient_color with smoothstep and synced boundaries**

Replace the entire `get_ambient_color()` function (lines 151-185):

```gdscript
func get_ambient_color() -> Color:
	var night_tint := Color(0.2, 0.25, 0.6)
	var dawn_tint := Color(0.9, 0.5, 0.25)
	var day_tint := Color(1.0, 1.0, 0.93)
	var golden_tint := Color(1.0, 0.7, 0.2)
	var sunset_tint := Color(0.9, 0.4, 0.15)
	var blue_dusk := Color(0.35, 0.3, 0.6)

	if _hour < DAWN_START:
		return night_tint
	elif _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		if t < 0.5:
			return _smoothlerp(night_tint, dawn_tint, t * 2.0)
		else:
			return _smoothlerp(dawn_tint, day_tint, (t - 0.5) * 2.0)
	elif _hour < GOLDEN_START:
		return day_tint
	elif _hour < DUSK_END:
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		if t < 0.3:
			return _smoothlerp(day_tint, golden_tint, t / 0.3)
		elif t < 0.55:
			return _smoothlerp(golden_tint, sunset_tint, (t - 0.3) / 0.25)
		elif t < 0.75:
			return _smoothlerp(sunset_tint, blue_dusk, (t - 0.55) / 0.2)
		else:
			return _smoothlerp(blue_dusk, night_tint, (t - 0.75) / 0.25)
	else:
		return night_tint
```

- [ ] **Step 5: Update get_tint_strength and get_scene_brightness to use new boundaries**

These functions already reference the constants, so they'll use the new values automatically. But `get_tint_strength` has hardcoded `6.0` breakpoints. Replace the entire function (lines 188-207):

```gdscript
func get_tint_strength() -> float:
	if _hour < DAWN_START:
		return 0.65
	elif _hour < DAWN_END:
		var t = (_hour - DAWN_START) / (DAWN_END - DAWN_START)
		var st = t * t * (3.0 - 2.0 * t)
		return lerpf(0.65, 0.0, st)
	elif _hour < GOLDEN_START:
		return 0.0
	elif _hour < DUSK_END:
		var t = (_hour - GOLDEN_START) / (DUSK_END - GOLDEN_START)
		var st = t * t * (3.0 - 2.0 * t)
		return lerpf(0.0, 0.65, st)
	else:
		return 0.65
```

- [ ] **Step 6: Commit**

```bash
git add scripts/core/day_night_cycle.gd
git commit -m "fix: smoothstep day/night transitions with extended boundaries"
```

---

### Task 2: Fix Moonlight Spotlight — Cubic Falloff

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Update spotlight texture to cubic falloff**

In `scripts/CleanWorld.gd`, find `_create_soft_light_texture()` (around line 197). Replace the falloff calculation:

```gdscript
func _create_soft_light_texture() -> Texture2D:
	var size = 256
	var img = Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center = size / 2.0
	for y in range(size):
		for x in range(size):
			var dist = Vector2(x - center, y - center).length() / center
			# Cubic falloff — steep center dropoff, long gentle tail
			var alpha = clampf(1.0 - dist, 0.0, 1.0)
			alpha = alpha * alpha * alpha  # pow(x, 3)
			img.set_pixel(x, y, Color(1, 1, 1, alpha))
	return ImageTexture.create_from_image(img)
```

- [ ] **Step 2: Set spotlight scale**

In `_setup_lighting()`, the spotlight scale should be `1.2`:

```gdscript
_moon_spotlight.texture_scale = 1.2  # Moderate pool, cubic falloff handles diffusion
```

- [ ] **Step 3: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "fix: moonlight spotlight cubic falloff with longer diffuse tail"
```

---

### Task 3: Generate Per-Level Normal Maps in ElevationRenderer

**Files:**
- Modify: `scripts/core/world_compiler/elevation_renderer.gd`

- [ ] **Step 1: Add normal map generation helper**

Add this function to `ElevationRenderer`, after the `_is_present` function:

```gdscript
func _generate_normal_map(chunk: ChunkData, tile_elev: PackedFloat32Array, level_present: PackedByteArray, size: int) -> Image:
	## Generate a normal map for one elevation level's visible region.
	## Encodes surface normals from elevation gradients as RGB.
	var img_width = size * tile_size
	var img_height = size * tile_size + int(pixels_per_unit / float(ELEV_LEVELS)) + tile_size
	var nmap = Image.create(img_width, img_height, true, Image.FORMAT_RGBA8)
	var scale = 4.0  # Normal map intensity

	for y in range(size):
		for x in range(size):
			if not level_present[y * size + x]:
				continue
			# Sample elevation neighbors
			var h_l = chunk.elevation[y * size + clampi(x - 1, 0, size - 1)]
			var h_r = chunk.elevation[y * size + clampi(x + 1, 0, size - 1)]
			var h_u = chunk.elevation[clampi(y - 1, 0, size - 1) * size + x]
			var h_d = chunk.elevation[clampi(y + 1, 0, size - 1) * size + x]

			var nx = (h_l - h_r) * scale
			var ny = (h_u - h_d) * scale
			var nz = 1.0
			var length = sqrt(nx * nx + ny * ny + nz * nz)
			nx /= length
			ny /= length
			nz /= length

			# Encode to RGB: [-1,1] → [0,1]
			var color = Color(nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5, 1.0)

			# Fill tile_size x tile_size block with this normal
			var dest_x = x * tile_size
			var dest_y = y * tile_size
			for py in range(tile_size):
				for px in range(tile_size):
					var ix = dest_x + px
					var iy = dest_y + py
					if ix < nmap.get_width() and iy < nmap.get_height():
						nmap.set_pixel(ix, iy, color)

	return nmap
```

- [ ] **Step 2: Return normal maps alongside terrain images**

In `render_chunk()`, modify the return data. After creating each level's terrain image, also generate its normal map. Change the results append (around the `if has_content:` block):

```gdscript
		if has_content:
			var nmap = _generate_normal_map(chunk, tile_elev, p, size)
			results.append({
				"image": img,
				"normal_map": nmap,
				"level": level,
				"z_order": level_idx,
			})
```

- [ ] **Step 3: Commit**

```bash
git add scripts/core/world_compiler/elevation_renderer.gd
git commit -m "feat: generate per-level normal maps in elevation renderer"
```

---

### Task 4: Wire Normal Maps to Sprites via CanvasTexture

**Files:**
- Modify: `scripts/core/world_compiler/layered_chunk_renderer.gd`

- [ ] **Step 1: Update display_prerendered to use CanvasTexture**

In `display_prerendered()`, replace the texture creation block (lines 48-56) to use `CanvasTexture` when a normal map is available:

```gdscript
	for entry in level_data:
		var img = entry["image"] as Image
		if img == null or img.get_width() == 0:
			continue

		var sprite = Sprite2D.new()
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.centered = false

		var normal_img = entry.get("normal_map") as Image
		if normal_img != null and normal_img.get_width() > 0:
			var canvas_tex = CanvasTexture.new()
			canvas_tex.diffuse_texture = ImageTexture.create_from_image(img)
			canvas_tex.normal_texture = ImageTexture.create_from_image(normal_img)
			sprite.texture = canvas_tex
		else:
			sprite.texture = ImageTexture.create_from_image(img)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/layered_chunk_renderer.gd
git commit -m "feat: wire normal maps to elevation sprites via CanvasTexture"
```

---

### Task 5: Add DirectionalLight2D Sun + Moon

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Add light variables**

Add near the top of `CleanWorld.gd` with the other variable declarations:

```gdscript
var _sun_light: DirectionalLight2D
var _moon_light: DirectionalLight2D
```

- [ ] **Step 2: Create lights in _setup_lighting**

At the end of `_setup_lighting()`, after the moonlight spotlight setup, add:

```gdscript
	# Directional sun light — illuminates terrain normals
	_sun_light = DirectionalLight2D.new()
	_sun_light.color = Color.WHITE
	_sun_light.energy = 0.0
	_sun_light.height = 0.6
	_sun_light.shadow_enabled = false  # Shadows are expensive in 2D
	add_child(_sun_light)

	# Directional moon light — subtle blue directionality at night
	_moon_light = DirectionalLight2D.new()
	_moon_light.color = Color(0.4, 0.5, 0.85)
	_moon_light.energy = 0.0
	_moon_light.height = 0.6
	_moon_light.shadow_enabled = false
	add_child(_moon_light)
```

- [ ] **Step 3: Update lights in _process**

In `_process()`, after the existing moonlight spotlight update (after line 323 `_moon_spotlight.energy = ...`), add:

```gdscript
	# Directional lights — driven by day/night cycle
	_sun_light.color = _day_night.get_sun_color()
	_sun_light.energy = _day_night.get_sun_energy() * 0.6  # Moderate intensity
	_sun_light.rotation = _day_night.get_sun_angle()

	# Moon light: opposite direction, only at night
	_moon_light.energy = _day_night.get_moonlight_energy() * 0.3  # Subtle
	_moon_light.rotation = _day_night.get_sun_angle() + PI  # Opposite sun
```

- [ ] **Step 4: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: add DirectionalLight2D sun and moon driven by DayNightCycle"
```

---

### Task 6: Pass Normal Maps Through Background Thread Pipeline

**Files:**
- Modify: `scripts/core/chunk_streamer.gd`

- [ ] **Step 1: Verify level_data passes through**

The background thread already calls `_layered_renderer.prerender_chunk(chunk)` which returns level_data. The level_data now includes `"normal_map"` keys (from Task 3). The `display_prerendered` function (from Task 4) already reads `entry.get("normal_map")`. No code change needed — just verify the data flow:

Thread: `prerender_chunk()` → returns `[{image, normal_map, level, z_order}, ...]`
Main thread: `display_prerendered()` → reads `entry.get("normal_map")` → creates `CanvasTexture`

- [ ] **Step 2: Verify center chunk path**

In `chunk_streamer.gd`, `load_grid_around()` calls `_layered_renderer.prerender_chunk(center_chunk)` then `display_prerendered(center_chunk, level_data)`. Same data flow. No change needed.

- [ ] **Step 3: Commit (if any tweaks needed)**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "verify: normal map data flows through threaded pipeline"
```

---

### Task 7: Visual Verification

- [ ] **Step 1: Run the game at dawn (set time to 5:00)**

In `_setup_lighting()`, temporarily set `_day_night.set_time(5.0)`. Run the scene. Verify:
- Terrain has visible slope shading (east-facing slopes brighter)
- No abrupt color snap at 6:00 AM
- Warm peach-orange tint fading smoothly to neutral

- [ ] **Step 2: Test golden hour (set time to 17:00)**

Set `_day_night.set_time(17.0)`. Verify:
- Rich amber-gold tint
- Smooth transition — no snap when time advances to 19:00
- Western slopes catch golden light

- [ ] **Step 3: Test night (set time to 22:00)**

Set `_day_night.set_time(22.0)`. Verify:
- Deep blue tint
- Moonlight spotlight has soft diffuse edge — no visible circle
- Moon directional light provides subtle slope shading

- [ ] **Step 4: Restore default time and commit**

Set back to `_day_night.set_time(8.0)`. Take a screenshot for reference.

```bash
git add -A
git commit -m "feat: terrain shading layer complete — normals, directional light, smooth transitions"
```
