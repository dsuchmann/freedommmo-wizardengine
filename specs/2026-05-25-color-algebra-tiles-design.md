# Color-Algebra Tile System — Layered Composable Terrain

**Date**: 2026-05-25
**Status**: Active
**Depends on**: World Compiler, TileObjectStack, GrainStack (L0)

## Problem

Current terrain renders as flat colored squares or non-seamless tile art. No smooth biome transitions, no elevation shading, no ground texture, no visual richness. The world looks like a spreadsheet.

## Solution

A composable tile system built from color algebra: 8 base colors × luminance variants × directional gradients × biome transitions × texture patterns × detail objects × interactable items. Each layer is a transparent overlay painted onto the layer below. The layers map to the grain stack — digging removes layers and exposes what's underneath.

## The 8-Color Palette

| ID | Color | Hex Range (dark → light) | Biomes |
|----|-------|--------------------------|--------|
| 0 | grass_green | #1a5c1a → #6ed06e | grassland, forest, dense_forest, tropical_forest |
| 1 | water_blue | #0d3b6e → #4da6f0 | ocean, lake, river, swamp |
| 2 | sand_tan | #8a6b3d → #ecc88a | beach, desert, savanna |
| 3 | stone_grey | #3a3a3a → #a8a8a8 | mountains, steppe |
| 4 | snow_white | #c0c8d0 → #f5f7fa | tundra, arctic, taiga |
| 5 | earth_brown | #5a3a1a → #b8906a | paths, roads, dirt, farmland |
| 6 | lava_orange | #8a2a00 → #f0a040 | volcanic |
| 7 | mystic_purple | #3a1a5a → #a060d0 | mushroom_forest, magical zones |

Each color has 4 luminance stops: dark (0), mid-dark (1), mid-light (2), light (3).

## 7-Layer Stack (Bottom to Top)

### Layer 0 — Base Color (opaque)
Flat biome tile. One tile per biome, determined by top grain in the GrainStack at that position.

- 8 colors × 4 luminance = **32 tiles**
- Default luminance is mid (1 or 2); specific luminance chosen by elevation height band
- PixelLab generation: seamless flat tiles with subtle pixel noise, explicitly "uniform color covering entire tile, no borders, tileable"

### Layer 1 — Luminance Gradient (α 0.3-0.5)
Directional light/dark overlay driven by **elevation slope data**.

- Light source assumed top-left
- Slope facing top-left → light gradient overlay
- Slope facing bottom-right → dark gradient overlay
- Steeper slope → higher alpha (more pronounced shading)
- 8 colors × 4 directions (N→S, S→N, W→E, E→W) = **32 tiles**
- Each tile: transparent base with gradient from one luminance stop to another

### Layer 2 — Color Transition (α 0.5-0.8)
Biome boundary blending. Only rendered at tiles where a neighbor has a different biome.

- For each tile, check 4 cardinal neighbors
- If neighbor biome differs, overlay a transition tile that blends this biome's color into the neighbor's
- C(8,2) = 28 unique pairs × 4 edge directions = **112 tiles**
- Each tile: one color fading into another across the tile, transparent elsewhere
- Edge matching: transition tile's edge colors must match both biomes' base colors

### Layer 3 — Texture Pattern (α 0.2-0.4)
Seamless tileable noise overlays that add ground texture. Coverage density driven by **vegetation_density** from the compiler.

- Each pattern is palette-locked to its compatible base color family
- Placed when vegetation_density > threshold (varies by pattern type)
- High translucency — adds visual variance without obscuring base

| Pattern | Compatible Colors | Biomes |
|---------|-------------------|--------|
| grass_blades | grass_green | grassland, forest |
| leaf_litter | grass_green, earth_brown | forest, dense_forest |
| pebble_scatter | stone_grey, earth_brown | mountains, steppe, paths |
| mud_cracks | earth_brown, sand_tan | swamp, farmland |
| sand_ripples | sand_tan | desert, beach |
| moss_patches | grass_green, stone_grey | forest, mountains (wet areas) |
| snow_crystals | snow_white | tundra, arctic |
| water_ripples | water_blue | ocean, lake, river |

8 patterns × 4 variants = **32 tiles**

### Layer 4 — Detail Objects (transparent background, non-interactive)
Individual nature sprites placed by density rules per biome. Decorative only.

- Flower clusters, grass tufts, fallen leaves, small stones, roots, puddles, mushroom patches
- Placed where vegetation_density is high enough for the object type
- Palette-coherent with base biome color
- **~50 unique objects**, generated as map_objects in PixelLab (32×32, transparent bg)

### Layer 5 — Interactable Objects (transparent background, pickable)
Items the player can collect. Sparse placement.

- Branches, loose stones, herbs, berries, feathers, bones, shells
- Each has: value, use category (crafting material, food, tool component)
- Removed from TileStack when player collects them
- **~30 unique objects**

### Layer 6 — Large Structures (blocking, multi-tile)
Trees, boulders, walls, buildings, furniture. The Lego block system from the tile-object-system spec. Not covered in this spec — already designed separately.

## Grain Stack Binding (Dig Interaction)

The visual layer stack mirrors the GrainStack at each tile position:

| Grain (top → bottom) | Visual Layer |
|----------------------|--------------|
| grass grain | L0 = grass_green |
| soil grain | L0 = earth_brown (revealed after digging grass) |
| stone grain | L0 = stone_grey (revealed after digging soil) |
| bedrock grain | L0 = stone_grey dark (can't dig further) |

**When player digs:**
1. Pop top grain from GrainStack
2. Add popped material to player inventory (as TileObject with pickable=true)
3. Recalculate L0 base color from new top grain
4. Remove any L3-L5 overlays that depended on the removed grain type
5. Re-render affected tile layers

**When player places material:**
1. Push grain onto GrainStack
2. Update L0 base color
3. Re-render

## Rendering Pipeline (Per Chunk)

For each tile (x, y) in the chunk:

```
1. Read top grain → determine base_color_id and luminance from height band
2. Paint L0: base flat tile (opaque) onto terrain image
3. Read slope direction + magnitude → if slope > threshold:
   Paint L1: gradient tile (alpha = slope_magnitude * 0.5) onto gradient image
4. Check 4 cardinal neighbors for different biome:
   For each differing neighbor, paint L2: transition tile onto transition image
5. Read vegetation_density → if density > 0.2:
   Select texture pattern by biome, paint L3 onto pattern image (alpha = density * 0.4)
6. If density > 0.4: place L4 detail object (selected by biome + RNG)
7. If RNG < 0.05: place L5 interactable object (selected by biome + rarity)
```

Each layer is a separate Image (chunk_size × 32 pixels per side). Total: 6 Image sprites per chunk. With 9 chunks: **54 Sprite2D nodes** (same as current).

## Adjacency Rules

Each tile stores 4 edge colors (N, S, E, W) derived from its content:
- Flat tiles: all 4 edges = same luminance stop
- Gradient tiles: edges match the luminance at that edge of the gradient
- Transition tiles: one pair of edges = color A, opposite pair = color B

The renderer enforces: **adjacent tiles' touching edges must have the same color value.** This guarantees no visible seams.

## PixelLab Generation Strategy

### Batch 1: Base Flats (2 calls)
```
Call 1: "1). dark green flat grass 2). medium green flat grass 3). light green flat grass 4). very light green flat grass 5). dark blue flat water 6). medium blue flat water 7). light blue flat water 8). very light blue flat water 9). dark tan flat sand 10). medium tan flat sand 11). light tan flat sand 12). very light tan flat sand 13). dark grey flat stone 14). medium grey flat stone 15). light grey flat stone 16). very light grey flat stone"
Call 2: "1). dark white flat snow 2). medium white flat snow 3). light white flat snow 4). bright white flat snow 5). dark brown flat earth 6). medium brown flat earth 7). light brown flat earth 8). very light brown flat earth 9). dark orange flat lava 10). medium orange flat lava 11). light orange flat lava 12). bright orange flat lava 13). dark purple flat mystic 14). medium purple flat mystic 15). light purple flat mystic 16). bright purple flat mystic"
```

### Batch 2: Gradients (2 calls)
Generate directional gradient tiles for each color. Use segmentation mode.

### Batch 3: Transitions (4-7 calls)
Generate color-to-color edge blending tiles for the most common biome pairs first:
- grass↔water, grass↔sand, grass↔stone, sand↔water, sand↔stone, snow↔grass, snow↔stone

### Batch 4: Texture Patterns (2 calls)
Seamless tileable overlays with transparency.

### Batch 5: Detail Objects (4 calls)
Small nature sprites on transparent backgrounds via create_map_object.

### Batch 6: Interactable Objects (2 calls)
Collectible item sprites via create_map_object.

**Total: ~16-20 PixelLab calls, ~220 tiles**

## File Structure

```
assets/catalog/
  base_flats/manifest.json     # 32 flat tiles
  gradients/manifest.json      # 32 gradient tiles
  transitions/manifest.json    # 112 transition tiles
  patterns/manifest.json       # 32 texture pattern tiles
  details/manifest.json        # ~50 detail object sprites
  interactables/manifest.json  # ~30 pickable item sprites
data/
  color_palette.json           # 8 colors × 4 luminance hex values
  biome_color_map.json         # biome → color_id mapping
  pattern_rules.json           # which patterns pair with which colors
  adjacency_rules.json         # edge matching constraints
```

## Non-Goals (This Spec)

- Building Lego system (separate spec, already designed)
- Character sprites and animations
- Tree/boulder multi-tile objects
- Sound effects for digging/collecting

## Success Criteria

1. Terrain renders with real pixel art tiles, not flat colored squares
2. Smooth gradients create visible elevation on hills/valleys
3. Biome boundaries blend smoothly, no hard seams
4. Ground has visible texture (grass blades, pebbles, etc.)
5. Player can pick up scattered items (branches, herbs, stones)
6. Digging removes visual layers and exposes what's underneath
7. Same rendering performance (Image-based, ~54 Sprite2D nodes for 9 chunks)
