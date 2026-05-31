# Dynamic Lighting & Shading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a moving sun/moon with terrain normal maps so the world has dynamic hillshading, day/night atmosphere, and a dev test mode to verify it all in 30 seconds.

**Architecture:** The C++ `NativeChunkCompiler` generates a normal map alongside each terrain image. A `DirectionalLight2D` rotates west-to-east driven by the existing `DayNightCycle` class. A `CanvasModulate` tints the scene for atmosphere. A `T` hotkey toggles 50x speed for visual testing.

**Tech Stack:** Godot 4.4 (DirectionalLight2D, CanvasModulate, CanvasItemMaterial, normal maps), GDExtension C++ (normal map + AO generation)

**Spec:** `docs/superpowers/specs/2026-05-26-dynamic-lighting-spec.md`

---

## File Structure

```
gdextension/src/
├── native_chunk_compiler.h        # MODIFY: add build_chunk_image_with_normals declaration
├── native_chunk_compiler.cpp      # MODIFY: add normal map generation + AO baking
scripts/
├── CleanWorld.gd                  # MODIFY: add DayNightCycle, DirectionalLight2D, CanvasModulate, T key, HUD
├── core/
│   ├── day_night_cycle.gd         # MODIFY: add sun_angle(), sun_height(), set_time(), set_time_scale()
│   ├── chunk_streamer.gd          # MODIFY: call build_chunk_image_with_normals, pass normal map
│   └── world_compiler/
│       └── tilemap_terrain_renderer.gd  # MODIFY: display_chunk_image accepts normal map, creates material
```

---

### Task 1: Add Normal Map + AO Generation to C++

**Files:**
- Modify: `gdextension/src/native_chunk_compiler.h`
- Modify: `gdextension/src/native_chunk_compiler.cpp`

- [ ] **Step 1: Add `build_chunk_image_with_normals` declaration to header**

In `native_chunk_compiler.h`, add after the existing `build_chunk_image` declaration (around line 85):

```cpp
    Dictionary build_chunk_image_with_normals(
        int chunk_x, int chunk_y,
        const PackedFloat32Array &elevation,
        const PackedFloat32Array &slope,
        const PackedByteArray &biome_id,
        const PackedByteArray &ocean_mask,
        int world_seed,
        const Dictionary &wang_tiles,
        const Dictionary &biome_pairs,
        const Dictionary &self_tilesets,
        const Dictionary &tileset_upper,
        const Dictionary &biome_fallback,
        int tile_size
    );
```

- [ ] **Step 2: Bind the new method**

In `native_chunk_compiler.cpp`, in `_bind_methods()`, add:

```cpp
    ClassDB::bind_method(D_METHOD("build_chunk_image_with_normals", "chunk_x", "chunk_y", "elevation", "slope", "biome_id", "ocean_mask", "world_seed", "wang_tiles", "biome_pairs", "self_tilesets", "tileset_upper", "biome_fallback", "tile_size"), &NativeChunkCompiler::build_chunk_image_with_normals);
```

- [ ] **Step 3: Implement `build_chunk_image_with_normals`**

Add at the end of `native_chunk_compiler.cpp`, after the existing `build_chunk_image`:

```cpp
Dictionary NativeChunkCompiler::build_chunk_image_with_normals(
    int chunk_x, int chunk_y,
    const PackedFloat32Array &elevation,
    const PackedFloat32Array &slope,
    const PackedByteArray &biome_id,
    const PackedByteArray &ocean_mask,
    int world_seed,
    const Dictionary &wang_tiles,
    const Dictionary &biome_pairs,
    const Dictionary &self_tilesets,
    const Dictionary &tileset_upper,
    const Dictionary &biome_fallback,
    int tile_size
) {
    // Build terrain image using existing method
    Ref<Image> terrain_img = build_chunk_image(
        chunk_x, chunk_y, biome_id, ocean_mask, world_seed,
        wang_tiles, biome_pairs, self_tilesets, tileset_upper, biome_fallback, tile_size
    );

    const int S = CHUNK_SIZE;
    const int px_size = S * tile_size;
    const int tile_row_bytes = tile_size * 4;
    const int row_bytes = px_size * 4;

    // === Apply AO to terrain image ===
    // Get terrain image pixels for modification
    PackedByteArray terrain_data = terrain_img->get_data();
    uint8_t *tpx = terrain_data.ptrw();
    const float *elev = elevation.ptr();

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            int i = y * S + x;
            float h = elev[i];

            // Average of 8 neighbors
            float avg = 0.0f;
            int count = 0;
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    if (dx == 0 && dy == 0) continue;
                    int nx = x + dx;
                    int ny = y + dy;
                    if (nx >= 0 && nx < S && ny >= 0 && ny < S) {
                        avg += elev[ny * S + nx];
                        count++;
                    }
                }
            }
            if (count > 0) avg /= count;

            // AO factor: negative = valley (darken), positive = ridge (lighten)
            float diff = h - avg;
            float ao_factor = 1.0f;
            if (diff < -0.005f) {
                // Valley: darken by up to 15%
                ao_factor = 1.0f + std::max(diff * 3.0f, -0.15f);
            } else if (diff > 0.005f) {
                // Ridge: lighten by up to 8%
                ao_factor = 1.0f + std::min(diff * 2.0f, 0.08f);
            }

            // Apply AO to all pixels in this tile
            for (int ty = 0; ty < tile_size; ty++) {
                for (int tx = 0; tx < tile_size; tx++) {
                    int px_off = ((y * tile_size + ty) * px_size + (x * tile_size + tx)) * 4;
                    tpx[px_off + 0] = std::clamp(int(tpx[px_off + 0] * ao_factor), 0, 255);
                    tpx[px_off + 1] = std::clamp(int(tpx[px_off + 1] * ao_factor), 0, 255);
                    tpx[px_off + 2] = std::clamp(int(tpx[px_off + 2] * ao_factor), 0, 255);
                }
            }
        }
    }

    // Recreate terrain image with AO applied
    Ref<Image> ao_img = Image::create_from_data(px_size, px_size, false, Image::FORMAT_RGBA8, terrain_data);

    // === Generate normal map ===
    PackedByteArray normal_data;
    normal_data.resize(px_size * px_size * 4);
    uint8_t *npx = normal_data.ptrw();
    const float normal_scale = 4.0f;

    for (int y = 0; y < S; y++) {
        for (int x = 0; x < S; x++) {
            // Sample elevation at neighbors (clamped at edges)
            float h_left = (x > 0) ? elev[y * S + (x - 1)] : elev[y * S + x];
            float h_right = (x < S - 1) ? elev[y * S + (x + 1)] : elev[y * S + x];
            float h_up = (y > 0) ? elev[(y - 1) * S + x] : elev[y * S + x];
            float h_down = (y < S - 1) ? elev[(y + 1) * S + x] : elev[y * S + x];

            // Compute normal
            float nx_val = (h_left - h_right) * normal_scale;
            float ny_val = (h_up - h_down) * normal_scale;
            float nz_val = 1.0f;

            // Normalize
            float len = std::sqrt(nx_val * nx_val + ny_val * ny_val + nz_val * nz_val);
            nx_val /= len;
            ny_val /= len;
            nz_val /= len;

            // Encode to RGB [0,255]
            uint8_t r = static_cast<uint8_t>((nx_val * 0.5f + 0.5f) * 255.0f);
            uint8_t g = static_cast<uint8_t>((ny_val * 0.5f + 0.5f) * 255.0f);
            uint8_t b = static_cast<uint8_t>((nz_val * 0.5f + 0.5f) * 255.0f);

            // Fill all pixels in this tile with the same normal
            for (int ty = 0; ty < tile_size; ty++) {
                for (int tx = 0; tx < tile_size; tx++) {
                    int px_off = ((y * tile_size + ty) * px_size + (x * tile_size + tx)) * 4;
                    npx[px_off + 0] = r;
                    npx[px_off + 1] = g;
                    npx[px_off + 2] = b;
                    npx[px_off + 3] = 255;
                }
            }
        }
    }

    Ref<Image> normal_img = Image::create_from_data(px_size, px_size, false, Image::FORMAT_RGBA8, normal_data);

    Dictionary result;
    result["image"] = ao_img;
    result["normal_map"] = normal_img;
    return result;
}
```

- [ ] **Step 4: Build**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo/gdextension
python -m SCons platform=windows target=template_debug
```

Expected: Clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo
git add gdextension/src/native_chunk_compiler.h gdextension/src/native_chunk_compiler.cpp
git commit -m "feat: normal map generation + AO baking in NativeChunkCompiler C++"
```

---

### Task 2: Update TileMapTerrainRenderer to Display Normal Maps

**Files:**
- Modify: `scripts/core/world_compiler/tilemap_terrain_renderer.gd:399-416`

- [ ] **Step 1: Add `display_chunk_image_with_normal` method**

Add after the existing `display_chunk_image` method (after line 416 in `tilemap_terrain_renderer.gd`):

```gdscript
func display_chunk_image_with_normal(chunk: ChunkData, img: Image, normal_map: Image) -> void:
	## Display chunk with normal map for dynamic lighting — MAIN THREAD ONLY.
	register_chunk(chunk)
	var size = ChunkData.SIZE
	var tex = ImageTexture.create_from_image(img)
	var normal_tex = ImageTexture.create_from_image(normal_map)

	var sprite = Sprite2D.new()
	sprite.texture = tex
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	# Create material with normal map for DirectionalLight2D interaction
	var mat = CanvasItemMaterial.new()
	mat.light_mode = CanvasItemMaterial.LIGHT_MODE_NORMAL
	sprite.material = mat
	sprite.set_meta("normal_texture", normal_tex)

	# Use a ShaderMaterial to bind the normal map
	var shader = Shader.new()
	shader.code = """
shader_type canvas_item;

uniform sampler2D normal_map : hint_normal;

void fragment() {
	COLOR = texture(TEXTURE, UV);
	NORMAL_MAP = texture(normal_map, UV).rgb;
}
"""
	var shader_mat = ShaderMaterial.new()
	shader_mat.shader = shader
	shader_mat.set_shader_parameter("normal_map", normal_tex)
	sprite.material = shader_mat

	sprite.centered = false
	sprite.position = Vector2(
		chunk.chunk_x * size * _world_scale,
		chunk.chunk_y * size * _world_scale
	)
	sprite.z_index = -2
	sprite.name = "Chunk_%d_%d" % [chunk.chunk_x, chunk.chunk_y]
	_parent.add_child(sprite)
	_chunk_sprites[Vector2i(chunk.chunk_x, chunk.chunk_y)] = sprite
	chunk_render_complete.emit(chunk.chunk_x, chunk.chunk_y)
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/world_compiler/tilemap_terrain_renderer.gd
git commit -m "feat: display_chunk_image_with_normal for dynamic lighting on terrain"
```

---

### Task 3: Update ChunkStreamer to Pass Normal Maps

**Files:**
- Modify: `scripts/core/chunk_streamer.gd`

- [ ] **Step 1: Update `_thread_compile_batch` to use `build_chunk_image_with_normals`**

Replace the native path in `_thread_compile_batch` (around line 192-207) with:

```gdscript
func _thread_compile_batch(batch: Array) -> void:
	## Runs on background thread. Compiles chunks AND builds images.
	for pos in batch:
		var chunk = _compile_chunk_data(pos)
		var img: Image
		var normal_map: Image = null
		var ti0 = Time.get_ticks_usec()
		if _native_compiler != null:
			var result = _native_compiler.build_chunk_image_with_normals(
				chunk.chunk_x, chunk.chunk_y,
				chunk.elevation, chunk.slope,
				chunk.biome_id, chunk.ocean_mask,
				chunk.world_seed,
				_renderer.get_wang_cache(),
				_renderer.get_biome_pairs(),
				_renderer.get_self_tilesets(),
				_renderer.get_tileset_upper(),
				_renderer.get_biome_fallback(),
				_renderer._world_scale
			)
			img = result["image"]
			normal_map = result["normal_map"]
		else:
			img = _renderer.build_chunk_image(chunk)
		var ti1 = Time.get_ticks_usec()
		print("[ChunkStreamer] Image (%d,%d): %d us%s" % [chunk.chunk_x, chunk.chunk_y, ti1 - ti0, " [C++]" if _native_compiler != null else " [GDScript]"])
		_mutex.lock()
		_compiled_queue.append({"chunk": chunk, "pos": pos, "image": img, "normal_map": normal_map})
		_mutex.unlock()
	_thread_busy = false
```

- [ ] **Step 2: Update `_process_load_queue` to pass normal maps when displaying**

In `_process_load_queue`, update the rendering section (around line 150-157) where compiled chunks are displayed:

```gdscript
	for entry in ready:
		var chunk = entry["chunk"] as ChunkData
		var pos = entry["pos"] as Vector2i
		var img = entry.get("image") as Image
		var normal_map = entry.get("normal_map")
		if not _loaded_positions.has(pos):
			if img != null:
				if normal_map != null:
					_renderer.display_chunk_image_with_normal(chunk, img, normal_map)
				else:
					_renderer.display_chunk_image(chunk, img)
			else:
				_renderer.render_chunk_fast(chunk)
			_loaded_positions[pos] = true
			chunk_loaded.emit(pos.x, pos.y)
```

- [ ] **Step 3: Also update `load_grid_around` center chunk rendering**

In `load_grid_around` (around line 42-44), update the center chunk to also use normals:

```gdscript
	# Compile and render CENTER chunk immediately
	var center_pos = Vector2i(cx, cy)
	var center_chunk = _compile_chunk_data(center_pos)
	if _native_compiler != null:
		var result = _native_compiler.build_chunk_image_with_normals(
			center_chunk.chunk_x, center_chunk.chunk_y,
			center_chunk.elevation, center_chunk.slope,
			center_chunk.biome_id, center_chunk.ocean_mask,
			center_chunk.world_seed,
			_renderer.get_wang_cache(),
			_renderer.get_biome_pairs(),
			_renderer.get_self_tilesets(),
			_renderer.get_tileset_upper(),
			_renderer.get_biome_fallback(),
			_renderer._world_scale
		)
		_renderer.display_chunk_image_with_normal(center_chunk, result["image"], result["normal_map"])
	else:
		_renderer.render_chunk_fast(center_chunk)
	_loaded_positions[center_pos] = true
```

- [ ] **Step 4: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: ChunkStreamer passes normal maps for dynamic lighting"
```

---

### Task 4: Extend DayNightCycle with Sun/Moon Angle

**Files:**
- Modify: `scripts/core/day_night_cycle.gd`

- [ ] **Step 1: Add sun/moon angle and height methods**

Add the following methods to `day_night_cycle.gd` after the existing `get_time_string()`:

```gdscript
func get_sun_angle() -> float:
	## Returns the DirectionalLight2D rotation in radians.
	## Sun arc: dawn (5h) = 270deg (west), noon (12h) = 180deg, dusk (20h) = 90deg (east).
	## Moon arc: dusk (20h) = 270deg (west), midnight (0h) = 180deg, dawn (5h) = 90deg (east).
	if _hour >= DAWN and _hour <= NIGHT:
		# Sun: 270 at dawn → 90 at dusk, linear sweep
		var t = (_hour - DAWN) / (NIGHT - DAWN)
		var degrees = lerpf(270.0, 90.0, t)
		return deg_to_rad(degrees)
	else:
		# Moon: 270 at dusk → 90 at dawn
		var night_hour = _hour
		if night_hour < DAWN:
			night_hour += 24.0
		var t = (night_hour - NIGHT) / (24.0 + DAWN - NIGHT)
		var degrees = lerpf(270.0, 90.0, t)
		return deg_to_rad(degrees)


func get_sun_height() -> float:
	## Returns light height [0.0-1.0]. Low at dawn/dusk (long shadows), high at noon (short).
	if _hour >= DAWN and _hour <= NIGHT:
		var mid = (DAWN + NIGHT) / 2.0
		var dist = abs(_hour - mid) / (mid - DAWN)
		return lerpf(1.0, 0.15, dist)
	else:
		# Moon: dimmer, peaks at midnight
		var night_hour = _hour
		if night_hour < DAWN:
			night_hour += 24.0
		var mid = NIGHT + (24.0 + DAWN - NIGHT) / 2.0
		var dist = abs(night_hour - mid) / ((24.0 + DAWN - NIGHT) / 2.0)
		return lerpf(0.4, 0.1, dist)


func get_sun_energy() -> float:
	## Returns light energy [0.0-1.0].
	if _hour >= DAY and _hour <= DUSK:
		return 1.0
	elif _hour >= DAWN and _hour < DAY:
		return lerpf(0.3, 1.0, (_hour - DAWN) / (DAY - DAWN))
	elif _hour > DUSK and _hour <= NIGHT:
		return lerpf(1.0, 0.1, (_hour - DUSK) / (NIGHT - DUSK))
	else:
		return 0.15  # Moonlight


func get_sun_color() -> Color:
	## Returns the directional light color.
	if _hour < DAWN:
		return Color(0.2, 0.25, 0.45)  # Moonlight
	elif _hour < DAY:
		var t = (_hour - DAWN) / (DAY - DAWN)
		return Color(1.0, 0.6, 0.3).lerp(Color(1.0, 0.95, 0.9), t)  # Orange dawn → warm white
	elif _hour < 17.0:
		return Color(1.0, 1.0, 0.95)  # Daylight
	elif _hour < DUSK:
		var t = (_hour - 17.0) / (DUSK - 17.0)
		return Color(1.0, 1.0, 0.95).lerp(Color(1.0, 0.7, 0.3), t)  # → Golden hour
	elif _hour < NIGHT:
		var t = (_hour - DUSK) / (NIGHT - DUSK)
		return Color(0.9, 0.4, 0.2).lerp(Color(0.2, 0.25, 0.45), t)  # Dusk → moonlight
	else:
		return Color(0.2, 0.25, 0.45)  # Moonlight


func set_time(hour: float) -> void:
	_hour = fmod(hour, 24.0)
	if _hour < 0:
		_hour += 24.0


func set_time_scale(scale: float) -> void:
	_time_scale = scale
```

- [ ] **Step 2: Commit**

```bash
git add scripts/core/day_night_cycle.gd
git commit -m "feat: DayNightCycle sun/moon angle, height, energy, color methods"
```

---

### Task 5: Wire Lighting into CleanWorld.gd

**Files:**
- Modify: `scripts/CleanWorld.gd`

- [ ] **Step 1: Add lighting member variables**

Add after the existing member variables (after line 23, before `_overmap_layer`):

```gdscript
# Day/night lighting
var _day_night: DayNightCycle
var _sun_light: DirectionalLight2D
var _canvas_modulate: CanvasModulate
var _lighting_test_mode: bool = false
var _lighting_hud: Label = null
const NORMAL_TIME_SCALE: float = 60.0   # 1 real sec = 1 game minute (24 min per day)
const TEST_TIME_SCALE: float = 2880.0   # Full day in ~30 seconds
```

- [ ] **Step 2: Add `_setup_lighting` method**

Add after `_setup_overmap_ui()`:

```gdscript
func _setup_lighting() -> void:
	_day_night = DayNightCycle.new()
	_day_night.set_time(8.0)  # Start at 8 AM
	_day_night.set_time_scale(NORMAL_TIME_SCALE)

	# Directional light (sun/moon)
	_sun_light = DirectionalLight2D.new()
	_sun_light.enabled = true
	_sun_light.color = Color(1, 1, 0.95)
	_sun_light.energy = 1.0
	_sun_light.blend_mode = Light2D.BLEND_MODE_MIX
	_sun_light.shadow_enabled = false  # Enable when we have occluders
	_sun_light.height = 0.6
	_sun_light.rotation = _day_night.get_sun_angle()
	add_child(_sun_light)

	# Global ambient tint
	_canvas_modulate = CanvasModulate.new()
	_canvas_modulate.color = Color(1, 1, 0.95)
	add_child(_canvas_modulate)

	# Dev HUD (hidden by default)
	_lighting_hud = Label.new()
	_lighting_hud.visible = false
	_lighting_hud.position = Vector2(10, 10)
	_lighting_hud.z_index = 100
	_lighting_hud.add_theme_font_size_override("font_size", 18)
	_lighting_hud.add_theme_color_override("font_color", Color.WHITE)
	_lighting_hud.add_theme_color_override("font_shadow_color", Color.BLACK)
	_lighting_hud.add_theme_constant_override("shadow_offset_x", 1)
	_lighting_hud.add_theme_constant_override("shadow_offset_y", 1)
	# Add to CanvasLayer so it stays on screen
	var hud_layer = CanvasLayer.new()
	hud_layer.layer = 21
	add_child(hud_layer)
	hud_layer.add_child(_lighting_hud)
```

- [ ] **Step 3: Call `_setup_lighting` from `_ready`**

In `_ready()`, add the call after the existing setup methods:

```gdscript
func _ready() -> void:
	_setup_compilers()
	_setup_renderer()
	_setup_player()
	_setup_chunk_streamer()
	_setup_overmap_ui()
	_setup_lighting()
	# Initial load around origin
	_chunk_streamer.load_grid_around(0, 0, get_tree())
```

- [ ] **Step 4: Add lighting update to `_process`**

Add at the beginning of `_process`, before the overmap check:

```gdscript
func _process(delta: float) -> void:
	# Tick day/night cycle
	_day_night.tick(delta)
	_sun_light.rotation = _day_night.get_sun_angle()
	_sun_light.color = _day_night.get_sun_color()
	_sun_light.energy = _day_night.get_sun_energy()
	_sun_light.height = _day_night.get_sun_height()
	_canvas_modulate.color = _day_night.get_ambient_color()

	# Update dev HUD
	if _lighting_test_mode:
		_lighting_hud.text = "%s | %s | angle: %d° | energy: %.2f | height: %.2f" % [
			_day_night.get_time_string(),
			_day_night.get_period().to_upper(),
			int(rad_to_deg(_sun_light.rotation)),
			_sun_light.energy,
			_sun_light.height
		]

	if _overmap_visible:
		return
	# ... rest of existing _process code
```

- [ ] **Step 5: Add T key handler**

In `_unhandled_input`, add the T key case alongside the existing M key:

```gdscript
		if event.keycode == KEY_M:
			_toggle_overmap()
		elif event.keycode == KEY_T:
			_toggle_lighting_test()
```

Add the toggle method:

```gdscript
func _toggle_lighting_test() -> void:
	_lighting_test_mode = not _lighting_test_mode
	_lighting_hud.visible = _lighting_test_mode
	if _lighting_test_mode:
		_day_night.set_time_scale(TEST_TIME_SCALE)
		print("[CleanWorld] Lighting test mode ON — full day in ~30s")
	else:
		_day_night.set_time_scale(NORMAL_TIME_SCALE)
		print("[CleanWorld] Lighting test mode OFF — normal speed")
```

- [ ] **Step 6: Commit**

```bash
git add scripts/CleanWorld.gd
git commit -m "feat: dynamic lighting — sun/moon rotation, ambient tint, T for test mode"
```

---

### Task 6: Build, Test, and Verify

**Files:**
- No new files — this is testing and verification.

- [ ] **Step 1: Rebuild C++ DLL**

```bash
cd C:/Users/daves/OneDrive/Documents/freedommmo/gdextension
python -m SCons platform=windows target=template_debug
```

Expected: Clean build.

- [ ] **Step 2: Clear chunk cache**

```bash
rm -f "$APPDATA/Godot/app_userdata/"*freedommmo*/chunks/*.bin
rm -f "$APPDATA/Godot/app_userdata/"*FreedomMMO*/chunks/*.bin
rm -f "$APPDATA/Godot/app_userdata/"*Clean*/chunks/*.bin
```

- [ ] **Step 3: Run the game and verify normal lighting**

Run `res://scenes/CleanWorld.tscn`. Verify:
- Terrain renders with visible elevation shading (valleys darker, ridges lighter from AO)
- No visual artifacts or black tiles
- Light color is warm white (game starts at 8 AM)

- [ ] **Step 4: Test lighting cycle with T key**

Press `T`. Verify:
- HUD appears showing time, period, angle, energy, height
- Day cycles through in ~30 seconds
- Dawn: warm orange light from the west, long shadows on terrain
- Noon: white light, minimal shadows, bright atmosphere
- Golden hour: amber light from the east
- Night: dark blue atmosphere, dim cool moonlight
- Transitions are smooth, no hard cuts
- Press `T` again to return to normal speed

- [ ] **Step 5: Take screenshots at key moments**

During test mode, take screenshots at dawn, noon, golden hour, and night for visual comparison.

- [ ] **Step 6: Remove timing instrumentation from chunk_streamer.gd**

Remove or gate the benchmark print statements added in the performance task behind a `const DEBUG_TIMING: bool = false` flag.

- [ ] **Step 7: Commit**

```bash
git add scripts/core/chunk_streamer.gd
git commit -m "feat: dynamic lighting verified — AO, normal maps, day/night cycle working"
```

---

## Post-Plan Notes

- The normal map shader is minimal — just reads the normal texture and passes it to Godot's lighting pipeline. No custom light math needed.
- Building light occlusion is NOT implemented here. It activates naturally when Layer 3 (Buildings) adds `LightOccluder2D` to wall tiles.
- Point lights are NOT implemented here. They'll be added when the object/building systems create torch/campfire entities.
- The `height` property on DirectionalLight2D is Godot's built-in mechanism for controlling how steep the 2D directional light hits surfaces. Low = long shadows, high = overhead.
