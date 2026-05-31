# Layer Architecture Specification

> Established 2026-05-25. This is the authoritative reference for the rendering layer system.
> All implementation must conform to this spec. Do not re-derive — reference this document.

## Core Principle: Animation Cel Model

The world is composed like traditional animation cels — transparent sheets stacked on top of each other. Each layer is a separate sheet. Some sheets are fully painted (opaque), most have sparse content with transparency showing layers beneath.

The player sees one composite image. We know it's 8 separate layers.

## Layer Stack

| Z | Layer | Blend Mode | Coverage | Purpose |
|---|-------|-----------|----------|---------|
| -2 | **Terrain** | Opaque fill | 100% of tiles | Base color — solid green/brown/blue/gray. Every pixel covered. |
| -1 | **Shading** | Multiply | 100% of tiles | Elevation shadows, hillshade, ambient occlusion. Darkens/lightens terrain beneath. Never fully opaque. |
| 0 | **Water** | Opaque where present | Sparse (~15-25%) | Rivers, lakes, ocean. Replaces terrain visually. Transparent elsewhere. Animated (ripple frames). |
| 1 | **Ground Detail** | Transparent overlay | Dense (~60-80%) | Grass blades, pebbles, fallen leaves, sand ripples, moss patches. You see terrain between them. |
| 2 | **Paths/Roads** | Opaque where present | Sparse (~5-10%) | Dirt trails, cobblestone roads, bridges. Covers terrain + ground detail where path exists. |
| 3 | **Buildings** | Opaque where present | Sparse (~3-8%) | Floors, walls, doors, windows, interior furniture. Covers everything beneath. |
| 4-5 | **Objects** | Transparent sprites | Moderate (~20-40%) | Trees, bushes, rocks, signs, wells, carts, flowers, branches. Sprites have transparent backgrounds. Y-sorted (front overlaps back). |
| 6 | **Roofs** | Conditional alpha | Sparse (building footprints only) | Building canopies. Opaque normally, alpha-fades when player enters building. |
| 7 | **Lighting** | Multiply/Additive | 100% of tiles | Day/night tint, torchlight radii, point light glow. Tints everything beneath. Never fully opaque. |

## Blend Mode Definitions

- **Opaque fill**: Every pixel in this layer is drawn. Nothing beneath is visible.
- **Opaque where present**: Where a tile exists on this layer, it fully covers what's beneath. Where no tile exists, the layer is invisible (pass-through).
- **Transparent overlay**: Sprites/tiles are placed on this layer but have transparent backgrounds. You see through to all layers beneath between the drawn pixels.
- **Multiply**: Darkens the composite beneath. White = no effect, black = full shadow. Used for lighting/shading.
- **Additive**: Brightens the composite beneath. Black = no effect. Used for light sources.
- **Conditional alpha**: Normally opaque, but fades to transparent based on game state (e.g., player enters building).

## Layer -2: Terrain (Detail)

### What it IS

A smooth continuous field of three values per tile, rendered as opaque colored tiles:

| Per-tile value | Range | Source |
|---|---|---|
| Elevation | 0.0 – 1.0 | Perlin noise |
| Temperature | 0.0 – 1.0 | Perlin noise + latitude gradient |
| Precipitation | 0.0 – 1.0 | Perlin noise + elevation influence |

Derived values (computed from the above):
- **Slope**: magnitude of elevation gradient between neighbors
- **Fertility**: derived from precipitation + temperature + slope
- **Ocean distance**: BFS from ocean cells
- **Water distance**: BFS from river/lake cells

### Biome Labels

The continuous values get classified into 15 biome labels for convenience. These are NOT hard visual boundaries — they're indexes that higher layers use to select content.

| Biome | Elevation | Temperature | Precipitation | Visual Base |
|---|---|---|---|---|
| Deep Ocean | < 0.15 | — | — | Dark blue |
| Ocean | 0.15–0.25 | — | — | Blue |
| Shallow Water | 0.25–0.32 | — | — | Light blue |
| Beach | 0.32–0.37 | — | — | Tan/yellow |
| Grassland | mid | 0.3–0.6 | 0.3–0.55 | Green |
| Forest | mid | > 0.4 | > 0.55 | Dark green |
| Dense Forest | mid | 0.3–0.6 | > 0.75 | Very dark green |
| Desert | mid-low | > 0.6 | < 0.3 | Sandy yellow |
| Savanna | mid | > 0.6 | 0.2–0.5 | Yellow-green |
| Steppe | mid | 0.3–0.6 | < 0.3 | Brown-green |
| Hills | 0.65–0.82 | — | — | Olive/rocky |
| Mountains | > 0.82 | > 0.3 | — | Gray |
| Tundra | high or cold | < 0.25–0.3 | — | White-blue |
| Taiga | — | 0.15–0.3 | > 0.4 | Dark blue-green |
| Swamp | < 0.5 | > 0.3 | > 0.8 | Murky green |
| Tropical Forest | mid | > 0.6 | > 0.5 | Bright green |
| Volcanic | > 0.6 | > 0.85 | — | Dark red-gray |
| Arctic | — | < 0.15 | — | White |
| Frozen Lake | high | < 0.35 | > 0.4 | Ice blue |
| Mushroom Forest | < 0.5 | > 0.55 | > 0.75 | Purple-green |

### Biome Labels Are Convenience Indexes, Not Boundaries

The underlying data is continuous. Two adjacent tiles may have nearly identical temperature/moisture but fall on different sides of a classification threshold. Visually, they should look nearly identical — the transition is smooth via Wang tilesets, not a hard edge.

Higher layers query the biome label when they need a quick "what kind of place is this?" answer (e.g., "should I place oak trees or cacti here?"). They can also query the raw floats for finer-grained decisions.

### Elevation as Visual Information

Elevation is communicated visually through multiple mechanisms:
- **This layer (Layer -2)**: Tile selection shifts — higher elevation gets rockier, exposed stone at peaks
- **Layer -1 (Shading)**: Hillshade — darker on north-facing slopes, lighter on south-facing
- **Layer 1 (Ground Detail)**: Fewer grass blades on steep slopes, more exposed rock
- **Layer 4-5 (Objects)**: Tree density decreases with elevation, different species at altitude

This is TERRAIN elevation (continuous, natural landscape). STRUCTURAL elevation (stairs, second floors, raised platforms) is a separate system on Layer 3.

### What This Layer Does NOT Do

- Does not know about buildings, paths, or any man-made content
- Does not carve holes for settlements
- Does not render visual detail (that's Layer 1)
- Does not determine walkability by itself (walkability comes from combining multiple layers)

## How Layers Interact

### Information flows DOWN → UP

Lower layers don't know about higher layers. Higher layers READ from lower layers.

```
Layer -2 (Terrain: elevation, temp, precip)
  → Layer -1 reads elevation for shading
  → Layer 0 reads elevation for water placement (below sea level = water)
  → Layer 1 reads biome + fertility for ground detail selection
  → Layer 2 reads terrain for road routing (prefer flat, avoid water)
  → Layer 3 reads terrain for building placement (flat areas, near water, avoid flood zones)
  → Layer 4-5 reads biome for object selection (oaks in forest, cacti in desert)
  → Layer 7 reads elevation for fog density (valleys = foggy)
```

### Visual compositing flows UP → DOWN (painter's algorithm)

Render from bottom to top. Each layer paints over what's beneath based on its blend mode.

### Occlusion rules

- Opaque layers HIDE everything beneath them where they have content
- Transparent layers ADD to what's beneath without hiding it
- Building floors (Layer 3) hide terrain (Layer -2) and ground detail (Layer 1)
- But objects (Layer 4-5) near buildings are removed by the SETTLEMENT SYSTEM, not by visual occlusion — you don't place flowers inside a tavern because the system knows not to, not because the floor hides them

## The Grassland Example (All Layers)

What the player sees when looking at a grassy hillside with a nearby building:

1. **Layer -2**: Solid green fill (base terrain — every pixel)
2. **Layer -1**: Subtle darkening on the north slope, slight brightening on south (multiply)
3. **Layer 0**: Nothing here (no water)
4. **Layer 1**: Dense grass blade sprites scattered across the green. A few pebbles near the hill crest. (transparent overlay — green shows between blades)
5. **Layer 2**: A dirt path cutting through (opaque — covers green + grass where it exists)
6. **Layer 3**: Tavern floor/walls (opaque — covers everything beneath within footprint)
7. **Layer 4-5**: Wildflowers in the grass. A fallen branch. Three oak trees. A sign by the path. (transparent sprites — y-sorted, you see through to grass between them)
8. **Layer 6**: Red thatch roof over the tavern (opaque, would alpha-fade if player enters)
9. **Layer 7**: Warm afternoon tint, torch glow from tavern windows (multiply/additive)

Each layer animates independently:
- Grass blades sway (Layer 1)
- Flowers bob slightly (Layer 4)
- Torch light flickers (Layer 7)
- Water ripples if present (Layer 0)

## Design Philosophy

### Layer -2 is primarily INFORMATION, secondarily visual

Its main job is providing the continuous terrain data that all other layers query. The visual rendering (solid colored tiles) is a baseline that's mostly hidden by the richer layers above it. But it must cover every pixel — it's the "canvas" that guarantees no gaps.

### Higher layers ENRICH, lower layers INFORM

Layer -2 tells Layer 1 "this is grassland with 0.8 fertility" → Layer 1 places dense grass blades.
Layer -2 tells Layer 4 "this is forest with 0.6 moisture" → Layer 4 places oak trees with ferns at their base.

### Additive vs Replacement is per-layer, not per-tile

A layer's blend mode is fixed. Ground Detail (Layer 1) is ALWAYS transparent overlay. Buildings (Layer 3) are ALWAYS opaque where present. You don't decide per-tile whether to add or replace — the layer's role determines it.

### The settlement system clears higher layers, not the terrain

When a building is placed, the settlement system removes grass blades (Layer 1) and objects (Layer 4-5) from within the footprint. It does NOT modify Layer -2. The terrain data persists beneath the building for:
- Biome context ("the tavern is in a grassland")
- Destruction recovery (if building burns, terrain is revealed)
- Gameplay systems that query terrain regardless of structures
