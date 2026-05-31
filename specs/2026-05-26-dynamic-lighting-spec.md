# Dynamic Lighting & Shading System

> Established 2026-05-26. Authoritative spec for Layers -1 and 7: terrain shading and dynamic world lighting.

## Problem

The terrain is flat-looking — elevation data exists but isn't visually communicated. There's no day/night cycle, no shadow direction, no atmosphere. The world feels static.

## Solution

A unified lighting system with a moving sun/moon, terrain normal maps for dynamic hillshading, global ambient tint for atmosphere, and infrastructure for building occlusion and point lights.

## Architecture

```
DayNightCycle (time source)
  → drives DirectionalLight2D (sun/moon angle, color, intensity, height)
  → drives CanvasModulate (global ambient tint)
  → drives HUD (time display in dev mode)

NativeChunkCompiler (C++)
  → generates terrain Image (existing)
  → generates normal map Image (new — from elevation data)
  → bakes static ambient occlusion into terrain image (new)

ChunkStreamer
  → assigns terrain texture + normal map to each chunk Sprite2D

Future:
  Building tiles → LightOccluder2D (walls block light, windows pass)
  Object system → PointLight2D (torches, campfires, lanterns)
```

## Component 1: Sun/Moon Directional Light

A single `DirectionalLight2D` node represents the dominant sky light source.

### Sun Arc (Dawn to Dusk)

The sun moves west to east across the sky:

| Game Hour | Period | Angle (degrees) | Height | Color | Energy |
|-----------|--------|-----------------|--------|-------|--------|
| 5:00 | Dawn start | 270 (west) | 0.2 | Warm orange (1.0, 0.6, 0.3) | 0.3 |
| 7:00 | Morning | 240 | 0.5 | Soft yellow (1.0, 0.9, 0.7) | 0.8 |
| 12:00 | Noon | 180 (overhead-south) | 1.0 | White (1.0, 1.0, 0.95) | 1.0 |
| 17:00 | Golden hour | 120 | 0.5 | Deep amber (1.0, 0.7, 0.3) | 0.8 |
| 18:00 | Dusk start | 100 | 0.3 | Red-orange (0.9, 0.4, 0.2) | 0.4 |
| 20:00 | Dusk end | 90 (east) | 0.1 | Fading (0.4, 0.2, 0.15) | 0.1 |

### Moon Arc (Night)

| Game Hour | Angle | Height | Color | Energy |
|-----------|-------|--------|-------|--------|
| 20:00 | 270 (west) | 0.1 | Cool blue (0.2, 0.25, 0.45) | 0.15 |
| 0:00 | 180 (overhead) | 0.4 | Silver-blue (0.25, 0.3, 0.5) | 0.2 |
| 5:00 | 90 (east) | 0.1 | Fading blue (0.15, 0.2, 0.35) | 0.1 |

All values smoothly interpolated using the existing `DayNightCycle` hour as the driver. No hard transitions.

### Height Property

The `height` property on DirectionalLight2D controls how "steep" the light hits the surface:
- Low height (0.1-0.3) = long dramatic shadows at dawn/dusk
- High height (0.8-1.0) = short/no shadows at noon
- This interacts with the terrain normal maps to create realistic hillshading

## Component 2: Terrain Normal Maps

For each chunk, the C++ `build_chunk_image` generates a second Image — the normal map.

### Normal Map Generation (in NativeChunkCompiler)

For each tile at position (x, y):
1. Sample elevation at (x-1, y), (x+1, y), (x, y-1), (x, y+1) — we already compute this for the slope array
2. Compute surface normal: `nx = (left - right) * scale`, `ny = (up - down) * scale`, `nz = 1.0`
3. Normalize the vector
4. Encode to RGB: `R = nx * 0.5 + 0.5`, `G = ny * 0.5 + 0.5`, `B = nz * 0.5 + 0.5`
5. Scale = tuning parameter controlling how dramatic the shading is (start with 4.0)

Output: 2048x2048 RGBA8 Image (same size as terrain image), where each tile's 32x32 pixel block has the same normal value (flat within each tile — variation comes from tile-to-tile differences).

### Sprite2D Material Setup

Each chunk Sprite2D gets a `CanvasItemMaterial` with:
- `texture` = terrain image (existing)
- `normal_map` = normal map image (new)
- `light_mode` = default (responds to Light2D nodes)

This is all Godot needs to shade the terrain dynamically under the DirectionalLight2D.

### Static Ambient Occlusion

Baked into the terrain image (not the normal map):
- For each tile, compute an AO factor from the surrounding elevation
- Valleys (elevation lower than average of 8 neighbors) get darkened by 5-15%
- Ridges (elevation higher than average) get lightened by 3-8%
- This provides base depth even without the dynamic light

## Component 3: Global Ambient Tint

A `CanvasModulate` node applies a color tint to the entire scene.

| Period | Color | Purpose |
|--------|-------|---------|
| Night (20:00-5:00) | (0.15, 0.15, 0.3) | Dark blue atmosphere |
| Dawn (5:00-7:00) | Lerp → (1.0, 0.9, 0.85) | Warm morning transition |
| Day (7:00-17:00) | (1.0, 1.0, 0.95) | Neutral, slightly warm |
| Golden hour (17:00-18:00) | Lerp → (1.0, 0.85, 0.6) | Amber evening |
| Dusk (18:00-20:00) | Lerp → (0.15, 0.15, 0.3) | Fade to night |

These values come from the existing `DayNightCycle.get_ambient_color()` method, which already implements similar logic. We'll refine the exact values to work well with the DirectionalLight2D.

## Component 4: Building Light Occlusion (Future-Ready)

Not implemented in this phase, but the system design accommodates it:

- Wall tiles → `LightOccluder2D` polygons (block directional + point lights)
- Window tiles → no occluder (light passes through)
- Door tiles → conditional occluder (closed = block, open = pass)
- Interior tiles without light sources are naturally dark
- The building layer (Layer 3) will add occluders when it's built

No code needed now. The DirectionalLight2D and normal map system work correctly whether occluders exist or not.

## Component 5: Point Light API (Future-Ready)

Not implemented in this phase. When the object/building systems are built:

- Torches, campfires, hearths, lanterns = `PointLight2D` nodes
- API: `create_light(world_pos: Vector2, color: Color, radius: float, energy: float, flicker: bool) -> Light2D`
- Flicker = small random energy variation per frame
- Managed by a LightManager that pools and recycles Light2D nodes (don't create/destroy per chunk)

No code needed now.

## Component 6: Dev Testing Mode

Press `T` to toggle lighting test mode:

### Test Mode Active
- Day cycle runs at ~50x speed (full 24 hours in ~30 seconds)
- HUD overlay in top-right shows:
  - Current time: "6:30 AM"
  - Period: "Dawn"
  - Sun angle: "240deg"
  - Light level: "0.65"
- Press `T` again to exit test mode

### Normal Mode
- 24 real minutes = 1 game day (1 real second = 1 game minute)
- No HUD overlay (time display is part of the game UI, built separately)
- Game starts at 8:00 AM

## Component 7: Integration Points

### CleanWorld.tscn Changes
- Add `DayNightCycle` instance (tick it in `_process`)
- Add `DirectionalLight2D` child node
- Add `CanvasModulate` child node
- Add lighting update logic in `_process`: read time → set light angle/color/height/energy → set modulate color
- Add `T` key handler for test mode toggle

### NativeChunkCompiler Changes
- New method: `build_chunk_image_with_normals()` returns Dictionary `{"image": Image, "normal_map": Image}` — keeps the old method signature intact for backward compatibility
- Add static AO baking into the terrain image (darken/lighten pixels based on neighbor elevation average)
- Normal map generation in the same pass as terrain image (reuses elevation data already in scope)

### ChunkStreamer Changes
- When displaying a chunk, create a `CanvasItemMaterial` with both terrain texture and normal map
- Assign material to the chunk's Sprite2D

### TileMapTerrainRenderer Changes
- `display_chunk_image` accepts both terrain and normal map images
- Creates material, assigns textures, sets light_mode

## Performance

- Normal map generation: ~0.5ms per chunk (same loop as elevation, just encoding)
- AO baking: ~0.2ms per chunk (8-neighbor average, one pass)
- DirectionalLight2D + CanvasModulate: GPU-side, no CPU cost per frame
- Memory: +16MB for normal maps across 49 loaded chunks (2048x2048x4 bytes each) — acceptable

## What This Spec Does NOT Cover

- Point light implementation (future — when objects/buildings exist)
- Light occluder placement (future — when building layer exists)
- Interior lighting design (future — when buildings are spatial)
- Weather effects on lighting (clouds dimming sun, rain darkening)
- Fog/volumetric effects
