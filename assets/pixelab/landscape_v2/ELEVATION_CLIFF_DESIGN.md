# Handling Elevation/Cliff Faces with Same Biome

## Problem

When level 1 = sand and level 2 = sand, both use the same base tile, so the cliff face needs a separate visual indicator.

This is a classic problem in top-down tile engines.

## Option 1: Cliff Face Overlay Tiles (Recommended)

Generate a separate set of cliff/edge tiles that render as an overlay on the lower level:

```
Level 2 (sand):  ████████
Cliff overlay:   ▓▓▓▓▓▓▓▓  ← dark shadow/rock face drawn on top of level 1
Level 1 (sand):  ░░░░░░░░
```

These would be biome-agnostic cliff tiles (rocky edge, shadow) or biome-specific (sandy cliff, grassy ledge, snowy drop-off). You'd use the same dual-grid corner system — but instead of encoding biome A vs B, you encode "elevated" vs "not elevated."

We could generate these with PixelLab as transition tilesets: `sand_low_to_sand_high` with a description like "sandy cliff face with shadow at the bottom showing elevation change."

### How it works with dual-grid

The cliff overlay uses the exact same `CORNER_TO_WANG` lookup table from `WANG_TILE_MAPPING.md`, but instead of corner biomes, you check corner elevations:

```javascript
const cliffMask = 
  (nwElevation > currentElevation ? 8 : 0) |
  (neElevation > currentElevation ? 4 : 0) |
  (swElevation > currentElevation ? 2 : 0) |
  (seElevation > currentElevation ? 1 : 0);
const cliffTile = CORNER_TO_WANG[cliffMask];
// Render cliff overlay tile on top of the base biome tile
```

## Option 2: Shadow/Darkening Layer

The simplest approach — draw a shadow strip along the south/east edges of elevated tiles. The cliff is implied by the shadow. Many top-down games use this (Zelda, Pokemon).

### Implementation
- Render the base biome tile normally
- For each tile that has an elevated neighbor to the N or W, draw a semi-transparent dark strip on the S or E edge
- No additional tile assets needed — just a shader or overlay effect

## Option 3: Separate Cliff Tileset per Biome

Generate cliff tiles per biome:
- `cliff_sand` — sandy cliff face
- `cliff_grass` — grassy ledge  
- `cliff_rock` — rocky cliff

Each would be a 16-tile Wang set using the same dual-grid system, where corners encode "is this corner elevated or not?"

### Pros
- Most visually rich — each biome gets a unique cliff look
- Cliffs look natural and biome-appropriate

### Cons
- Requires generating 20+ cliff tilesets (one per biome)
- Each costs ~30 PixelLab generations

## Recommendation for WizardGenie

**Start with Option 1** — one set of generic cliff overlay tiles that darkens/shadows the lower level. This works regardless of biome and only needs 16 tiles.

If the visual result needs improvement, upgrade to **Option 3** for key biomes (grassland, desert, mountains, snow) where cliff faces are most visible.

### Rendering order
1. Render base biome tile (from transition tileset interior)
2. Render biome transition tile (from dual-grid Wang lookup)
3. Render cliff overlay tile (from elevation dual-grid Wang lookup)
4. Render surface overlays (scatter decals, vegetation)
5. Render objects (trees, rocks, structures)

## Asset Generation Plan

When PixelLab recovers, generate cliff tiles using `create_topdown_tileset`:
- Description: "pixel art cliff face edge with dark shadow showing elevation drop, rocky ledge transitioning from elevated terrain to lower ground"
- This produces 16 tiles encoding all corner combinations of high/low
- Store in `transitions/cliff_overlay/wang/`

Cost: ~30 generations (we have ~168 remaining)
