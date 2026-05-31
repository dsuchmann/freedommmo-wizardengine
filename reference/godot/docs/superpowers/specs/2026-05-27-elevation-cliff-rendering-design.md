# Elevation Cliff Rendering System

**Date:** 2026-05-27
**Status:** Approved
**Scope:** Replace flat tile rendering with continuous elevation-driven cliff layers, where terrain height is expressed as stacked cliff walls and elevated surface tiles.

## Problem

The current hypergraph terrain system selects the correct surface (grass, rock, snow) based on elevation, but renders everything on a single flat plane. A mountain peak and a valley floor sit at the same visual Y position — only the tile color differs. There is no visual topography: no cliffs, no height, no sense of the landscape rising and falling. The world looks like a painted carpet, not terrain.

## Core Model

Elevation is continuous (0.0–1.0). Every tile's elevation maps to a visual Y-offset in pixels:

```
visual_y_offset = (elevation - SEA_LEVEL) * PIXELS_PER_UNIT
```

Where `SEA_LEVEL = 0.38` and `PIXELS_PER_UNIT = 512` (tunable). This means:
- A tile at elevation 0.50 renders 61px above sea level
- A tile at elevation 0.80 renders 215px above sea level
- A tile at elevation 1.00 renders 317px above sea level
- A tile at elevation 0.38 (sea level) renders at Y-offset 0

There are no fixed "levels" or "buckets." Every tile sits at its exact elevation. The number of visual layers in any given area is determined entirely by the terrain — a flat plain has zero cliff faces, a mountain might have cliff walls hundreds of pixels tall.

## Cliff Walls

When adjacent tiles differ in elevation, the gap between them is filled with a **cliff wall** — a vertical textured face visible from the top-down camera.

### Which edges get cliff walls

Cliff walls render on the **south and east** edges of elevated tiles. These are the sides visible to a top-down camera with a slight southward perspective (standard for 2D RPGs). North and west edges are occluded by the tile's own surface.

For a tile at (x, y) with elevation E:
- **South wall:** if tile at (x, y+1) has elevation E_south < E, draw a cliff wall of height `(E - E_south) * PIXELS_PER_UNIT` pixels on the south edge
- **East wall:** if tile at (x+1, y) has elevation E_east < E, draw a cliff wall of height `(E - E_east) * PIXELS_PER_UNIT` pixels on the east edge

### Cliff wall composition

Each cliff wall is assembled from three tile pieces:

| Piece | Size | Purpose |
|-------|------|---------|
| `cliff_top` | 32×8px | Overhang where surface meets wall — grass roots, dirt edge, snow lip |
| `cliff_mid` | 32×32px | Repeating wall face — stone layers, dirt strata, ice. Tiles vertically. |
| `cliff_bot` | 32×8px | Base where wall meets lower ground — shadow, rubble, moss |

For a cliff wall of height H pixels:
1. Draw `cliff_top` (8px)
2. Draw `cliff_mid` repeated `floor((H - 16) / 32)` times (middle fill)
3. Draw remaining fractional `cliff_mid` height (partial tile)
4. Draw `cliff_bot` (8px)

Minimum cliff height to render: 4px (below this, the elevation difference is too small to see).

### Cliff face variants per surface

Each of the 13 surface types needs its own cliff face set, because the wall should match the terrain it's part of:

| Surface | Cliff face appearance |
|---------|----------------------|
| lush_grass | Dirt/soil with grass roots hanging over the top edge |
| golden_sand | Sandy crumbling cliff face with exposed rock |
| forest_floor | Dark earth with tree roots and moss |
| grey_rock | Layered stone with mineral veins |
| snow | Packed snow over ice with frozen dirt |
| frozen_earth | Permafrost layers with ice crystals |
| glacial_ice | Blue-white ice face with pressure cracks |
| volcanic_rock | Dark basalt with glowing lava veins |
| swamp_mud | Wet mud layers with standing water seeping out |
| dry_grass | Rocky soil with sparse root systems |
| dark_humus | Very dark decomposing layers with fungal growth |
| ocean_water | (no cliff face — water fills from below) |
| mystic_crystal | Glowing purple crystal cross-section |

That's 12 cliff face sets × 3 pieces = 36 cliff tiles, plus corner and diagonal variants are required for V1:

**Corner variants** (where two cliff walls meet at 90°):
- Inner corner (concave) — south wall meets east wall from adjacent tiles
- Outer corner (convex) — cliff wraps around a protruding ledge

**Diagonal variants** (where elevation changes diagonally):
- SW-NE diagonal cliff face
- SE-NW diagonal cliff face

Each surface needs: 3 straight pieces + 2 corner pieces + 2 diagonal pieces = **7 cliff tiles per surface**.

Total: 12 surfaces × 7 pieces = **84 cliff tiles** to generate via PixelLab.

## Render Order

Tiles render back-to-front using a **painter's algorithm** sorted by (world_y ascending, elevation ascending):

1. **Water plane** at sea-level Y-offset (if any water visible in the viewport)
2. For each row (north to south):
   a. For each tile in the row (sorted by elevation ascending):
      - Draw cliff walls (south and east) descending from this tile to lower neighbors
      - Draw surface tile at this tile's visual Y-offset
3. Higher tiles naturally occlude lower tiles' cliff walls

This ensures:
- Cliffs face the camera (south-facing walls visible)
- Higher terrain covers lower terrain's walls
- Water sits at the bottom of basins

## Water

Water is the floor at elevation 0.38 (sea level):

- Any tile with elevation < SEA_LEVEL is submerged — the water surface renders at the sea-level Y plane
- The ocean_water surface tile renders ON the water plane for submerged tiles
- Coastlines are natural cliff faces: land tiles at elevation > SEA_LEVEL have cliff walls descending to the water plane
- Lakes are terrain depressions below sea level
- Rivers are narrow channels cut below surrounding terrain elevation

This naturally fixes the overmap/render mismatch — areas the overmap shows as blue (low elevation) will visually be water basins with terrain rising out of them.

## Camera

- **Follows player** at their visual position (grid position + elevation Y-offset)
- **Zoom-out at height**: camera zoom decreases slightly as player elevation increases, giving a wider view from mountaintops. Scale factor: `zoom = base_zoom - (elevation - SEA_LEVEL) * ZOOM_ELEVATION_FACTOR`
- **Bokeh/depth-of-field**: terrain below the player's current elevation gets progressively blurred. Already partially implemented — extend to use the new elevation offset system.

## Player Movement (Deferred)

Not in scope for this spec, but the elevation system enables:

- **Walking**: traverse gentle slopes where adjacent tile elevation difference < MAX_WALK_SLOPE
- **Climbing**: BotW/Genshin-style wall climbing on cliff faces (stamina-based)
- **Gliding**: jump off cliff edges, trade height for horizontal distance
- **Swimming**: enter water at sea level

These will be designed in a separate spec.

## PIXELS_PER_UNIT Tuning

The single most important constant. Starting value: **512**.

| Scenario | Elevation diff | Visual height |
|----------|---------------|---------------|
| Gentle slope | 0.02 | 10px (subtle step) |
| Small hill | 0.05 | 26px (visible rise) |
| Significant hill | 0.15 | 77px (~2.4 tile heights) |
| Mountain from plains | 0.40 | 205px (~6.4 tile heights) |
| Full sea-to-peak | 0.62 | 317px (~10 tile heights) |

This is data, not code. Tunable at runtime for visual QA.

## Architecture

### Modified Components

**`LayeredChunkRenderer`** — Major rewrite. Instead of painting one flat image per chunk, it now:
1. Calculates visual Y-offset per tile from elevation
2. Creates cliff wall sprites between tiles with different elevations
3. Renders surface tiles at their elevated Y positions
4. Sorts everything back-to-front for correct occlusion

**`CleanWorld.gd`** — Camera system updates:
- Track player elevation for Y-offset
- Zoom-out factor based on elevation
- Bokeh intensity based on elevation delta between player and terrain

### New Components

**`CliffTileLoader`** — Loads cliff face tile assets (cliff_top, cliff_mid, cliff_bot per surface type). Similar to LayeredTilesetLoader but for vertical cliff tiles.

**`ElevationRenderer`** — Core rendering logic extracted from LayeredChunkRenderer. Given a chunk's elevation data, produces the sorted draw list of (surface tiles + cliff walls + water) with correct Y-offsets and z-ordering.

### New Assets

- `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_top.png` (32×8)
- `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_mid.png` (32×32)
- `assets/catalog/terrain_v3/cliffs/{surface_id}/cliff_bot.png` (32×8)
- ~48 total cliff tile images via PixelLab

### Unchanged Components

- `ElevationGradientTable` — still provides surface_at(biome, elevation)
- `HypergraphTileResolver` — still resolves surface + Wang index per tile
- `LayeredTilesetLoader` — still loads surface and transition Wang tiles
- `ChunkStreamer` — still streams chunks, emits chunk_loaded
- `NativeChunkCompiler` (C++) — still produces elevation + biome data

## Performance Considerations

Each chunk is 64×64 = 4,096 tiles. In the worst case (mountainous terrain), each tile could have south and east cliff walls. That's up to 8,192 cliff wall sprites per chunk plus 4,096 surface sprites = 12,288 draw calls per chunk. With a 7×7 chunk grid visible, that's up to 600K draw calls.

This will require optimization:
- **Batch cliff walls** into chunk-level images (like the current surface image approach)
- **Skip tiny cliffs** below the 4px minimum threshold
- **LOD**: at far zoom, render cliff walls as simple dark lines instead of textured tiles
- **Frustum culling**: only render cliff walls visible in the viewport

The GDScript prototype will be slow. This is a strong candidate for C++ migration after the visual design is validated.
