# Layer -1: Terrain Shading Design

**Date:** 2026-05-27
**Status:** Approved
**Scope:** Wire existing C++ normal maps + AO to rendering, add directional lighting, fix day/night transitions

## Context

The elevation renderer stacks terrain at different Y-offsets, creating visible height. But there's no dynamic shading — no sense of sun direction, no slope highlighting, no ambient depth. The C++ `NativeChunkCompiler` already generates normal maps and baked AO, but they're not connected to rendering.

Day/night transitions have abrupt color snaps at 6:00 AM and golden hour→night due to piecewise linear interpolation with hard breakpoints.

## Architecture

### Approach: Hybrid (Godot Native Normals + AO)

1. **Godot's built-in 2D lighting** handles sun/moon via DirectionalLight2D + normal maps
2. **C++ baked AO** provides static ambient depth (valleys dark, ridges bright) — always visible regardless of sun position
3. **DayNightCycle** drives all light parameters (angle, color, energy)

### Components

#### 1. DirectionalLight2D (Sun + Moon)

Two `DirectionalLight2D` nodes, children of the scene root:

- **Sun light**: angle from `DayNightCycle.get_sun_angle()`, color from `get_sun_color()`, energy from `get_sun_energy()`. Active during day. Slopes facing the sun are bright, slopes facing away are dark.
- **Moon light**: opposite angle, blue-white color `(0.4, 0.5, 0.85)`, energy from `get_moonlight_energy()`. Active during night. Subtle — provides directionality to moonlit terrain.

Both lights use `height = 0.6` for a moderate incidence angle that creates visible slope shading without extreme shadows.

#### 2. Normal Map Wiring

The C++ compiler already returns `{"image": terrain, "normal_map": normal_map}` from `build_chunk_image_with_normals()`.

For elevation sprites (created by `LayeredChunkRenderer.display_prerendered()`):
- Create a `CanvasTexture` instead of a raw `ImageTexture`
- Assign the terrain image as `diffuse_texture`
- Assign the normal map as `normal_texture`
- Godot's 2D lighting system automatically uses the normals for directional light response

For the elevation renderer's per-level sprites:
- Generate a per-level normal map alongside the per-level terrain image in `ElevationRenderer.render_chunk()`
- Use the same elevation data that's already available to compute normals: `nx = elev[left] - elev[right]`, `ny = elev[up] - elev[down]`, `nz = 1.0`, normalized and encoded as RGB

#### 3. AO Integration

The C++ compiler already bakes AO into the terrain image (valleys -15%, ridges +8%). This is sufficient for the base level. For elevation sprites, the darkened cliff walls (`_get_dark_tile`) serve as basic AO.

No additional AO overlay needed — the existing bake provides ambient depth.

#### 4. Day/Night Transition Fix

**Problem:** Piecewise linear lerps in `get_sun_color()` and `get_ambient_color()` create visible discontinuities ("knees") where two linear segments meet.

**Fix:** Replace all `lerp` calls with `smoothstep` interpolation:

```gdscript
func _smoothlerp(a: Color, b: Color, t: float) -> Color:
    var st = t * t * (3.0 - 2.0 * t)  # smoothstep
    return a.lerp(b, st)
```

**Extended time boundaries:**

| Period | Current | New |
|--------|---------|-----|
| Dawn start | 4:30 | 4:00 |
| Dawn end | 7:00 | 8:00 |
| Golden start | 15:00 | 14:30 |
| Sunset | 18:30 | 19:00 |
| Dusk end | 20:30 | 21:30 |

Apply to both `get_sun_color()` and `get_ambient_color()` with matching boundaries so they transition in sync.

#### 5. Moonlight Spotlight Fix

Current: `texture_scale = 1.0` (reduced from 14.0). Still visible as a distinct circle.

Fix:
- `texture_scale = 1.2` — moderate pool of light around player
- Cubic falloff instead of quadratic: `alpha = pow(clamp(1.0 - dist, 0.0, 1.0), 3.0)` — steep center dropoff with a long, gentle tail that blends into the ambient darkness
- `blend_mode = BLEND_MODE_ADD` (keep) — adds to ambient rather than replacing
- `energy` driven by `get_moonlight_energy()` (keep)

#### 6. CanvasModulate Update

Current: `Color(ambient.r * b, ambient.g * b, ambient.b * b)` — multiplies ambient tint by brightness.

This is correct. The ambient color from the updated `get_ambient_color()` (with smoothstep + extended boundaries) will automatically produce the golden hour warmth, deep blue nights, and warm peach sunrises.

## Files Modified

| File | Change |
|------|--------|
| `scripts/core/day_night_cycle.gd` | Smoothstep interpolation, extended boundaries |
| `scripts/CleanWorld.gd` | Add DirectionalLight2D sun + moon, fix spotlight falloff |
| `scripts/core/world_compiler/layered_chunk_renderer.gd` | Use CanvasTexture with normal maps for elevation sprites |
| `scripts/core/world_compiler/elevation_renderer.gd` | Generate per-level normal map alongside terrain image |
| `scripts/core/chunk_streamer.gd` | Pass normal map data through to display_prerendered |

## What NOT to Change

- C++ NativeChunkCompiler — normal map generation already works
- ElevationGradientTable — surface selection logic is correct
- LayeredTilesetLoader — tile loading is correct
- Wang mask system — edge shapes working

## Success Criteria

- Sun visibly illuminates terrain slopes — morning light from east, evening from west
- Cliff faces are darker on the shadow side, brighter on the sun side
- Dawn/dusk transitions flow smoothly with no visible color snaps
- Golden hour feels warm and opinionated
- Night feels deep blue with subtle moonlight directionality
- Moonlight spotlight has a soft, diffuse edge — no visible circle boundary
- No performance regression — normal map assignment is GPU-side, zero CPU cost
