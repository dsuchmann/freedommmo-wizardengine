# Wall Tile System — Building Wall Pipeline

**Date:** 2026-06-14
**Status:** design (user review pending)
**Replaces:** `2026-06-14-wall-rendering-design.md` (superseded by this more complete spec)

## Goal

Tileable wall columns that assemble into complete building walls. Doors and
windows are replacement pieces at exact footprint positions. One material
(stone brick) end to end in Phase 1. 64 variants + animations in Phase 2.
Roof in Phase 3.

## Proportions

All dimensions are multiples of 32px for perfect tiling with the 32×32 Wang grid.

| Reference | Height | Notes |
|-----------|--------|-------|
| Player character | ~2.5 tiles (80px) | RIG_UNIT_PX = 1.4 |
| 1-story wall | 4 tiles (128px) | Taller than player, proportional |
| Door opening | 3 tiles (96px) | Player can walk through |
| Window center | tiles 1-2 (32-64px from top) | Above player head height |
| F6 tree | 6 tiles (192px) | Wall shorter than trees |

## Tile Anatomy

### South Exterior Wall (the main visible face)

**Plain base column:** 32×128px (1×4 tiles)
- Tileable horizontally — place side by side for any wall length
- Shows: wall cap (top row), brick face (middle 2 rows), foundation (bottom row)
- Source: `create_1_direction_object` at 128×128, then crop to 32×128 (leftmost column)
  OR generate at 32×128 directly if PixelLab supports non-square

**Window replacement:** 32×128px (1×4 tiles)
- Replaces ONE column of the plain base at a window position
- Window frame + glass in the upper-middle section (tiles 1-2)
- Brick at top (cap) and bottom (foundation) matches the base
- Generated via `create_object_state` from the base: "add arched window"

**Door replacement:** 64×128px (2×4 tiles)
- Replaces TWO adjacent columns at a door position
- Door frame + door in lower section, arch at top
- Brick flanking the door matches the base
- Must be ≥2 tiles from any section edge
- Generated via `create_1_direction_object` at 64×128

### East/West Exterior Wall (side edges)

**Edge piece:** 32×32px (1×1 tile)
- Just the wall cap from above + thin material edge
- Tiles vertically along the building side
- Minimal visual — mostly top-of-wall
- Generated via `create_1_direction_object` at 32×32

### North Exterior Wall (back, partially visible)

**Back piece:** 32×64px (1×2 tiles)
- Wall cap + upper back face
- Tiles horizontally along the north edge
- Less detailed than south (facing away from camera)
- Generated via `create_1_direction_object` at 64×64, crop to 32×64

### Interior Wall (south-facing, inside rooms)

**Interior base column:** 32×128px (1×4 tiles)
- Same dimensions as south exterior
- Different texture: plaster, wood paneling, smoother surface
- No windows — doors/archways only
- Generated via `create_object_state` from exterior: "interior plaster wall, smooth surface"

**Interior door/archway:** 64×128px (2×4 tiles)
- Open archway (no door, always passable) or interior door
- Simpler frame than exterior

## Placement Logic

### South Exterior Wall

```
for each section's south edge:
  for each tile (left to right):
    southNeighborOutside = tile south of this is NOT in the building
    if not southNeighborOutside: skip (interior junction)
    
    if door at this tile AND next tile (2-wide):
      if tile is ≥2 tiles from left edge AND ≥2 tiles from right edge:
        draw door piece (64×128) at this position
        skip next tile (door is 2 wide)
    else if window at this tile:
      if tile is ≥1 tile from each edge:
        draw window piece (32×128)
    else:
      draw plain column (32×128)
```

### Window Placement Rules

Windows are placed at regular intervals along exterior south edges:
- Every 3rd-4th tile, starting 2 tiles from the left edge
- Never within 1 tile of a section edge
- Never adjacent to a door
- Never on tiles where the south neighbor is inside the building

### Other Directions

- **East/West:** tile the 32×32 edge piece vertically along the side
- **North:** tile the 32×64 back piece horizontally
- **Interior south:** same logic as exterior south, but with interior texture and door/archway pieces only (no windows)

## Generation Pipeline

### Phase 1: Stone Brick (one material, one variant each)

Generate via PixelLab, download, wire into renderer:

| # | Asset | Dimensions | PixelLab Tool | Description |
|---|-------|-----------|---------------|-------------|
| 1 | South exterior base | 32×128 | `create_1_direction_object(size=128)` → crop | Tileable stone brick column |
| 2 | South exterior window | 32×128 | `create_object_state(#1, "add arched window")` | Window replacement |
| 3 | South exterior door | 64×128 | `create_1_direction_object(size=128)` | Door replacement (2 tiles wide) |
| 4 | South interior base | 32×128 | `create_object_state(#1, "interior plaster wall")` | Interior wall column |
| 5 | South interior archway | 64×128 | `create_object_state(#3, "open stone archway, no door")` | Interior passage |
| 6 | East/West edge | 32×32 | `create_1_direction_object(size=32)` | Side wall cap |
| 7 | North back | 32×64 | `create_1_direction_object(size=64)` → crop | Back wall piece |
| **Total** | | | | **7 sprites** |

### Phase 2: All Materials + Variants + Animations

Materials (10 categories):
- stone_brick, wood_plank, granite, marble, thatch, mud_brick,
  crystal (Veylith), volcanic_rock (Ignaar), living_bark (Sylvari),
  carved_stone (Kaldreth)

Per material:
- 64 variants of base column (seeded from `create_object_state` edits:
  "add moss", "add cracks", "weathered", "fresh mortar", etc.)
- 64 window variants (different frame styles, glass types, shutters)
- 64 door variants (wood, iron, ornate, damaged, etc.)
- Open/close animations for doors and windows (4 frames each)

### Phase 3: Roof

- Roof Wang tileset covering the building from above (already generated: thatch)
- Alpha-fades when player enters
- Different roof materials per building type

## Renderer Architecture

```js
drawBuildingWalls(ctx, camX, camY, tilePx, w, h)
  for each building:
    build floorSet, doorSet, windowPositions from footprint
    
    for each section:
      // SOUTH EXTERIOR (most visible, drawn last for z-order)
      walk south edge left→right:
        if south neighbor outside building:
          check door → draw door piece (skip next tile)
          check window → draw window piece  
          else → draw plain column

      // NORTH EXTERIOR (behind building, drawn first)
      walk north edge left→right:
        if north neighbor outside building:
          draw north back piece

      // EAST/WEST EDGES
      walk east/west edges top→bottom:
        if neighbor outside building:
          draw edge piece

      // INTERIOR SOUTH WALLS (room junctions)
      walk south edge left→right:
        if south neighbor inside building (different section):
          check interior door → draw archway piece
          else → draw interior column
```

**Draw order within each building:**
1. North walls (behind — drawn first, occluded by floor)
2. East/West edges
3. Interior walls
4. South walls (in front — drawn last, occludes player)

## File Structure

```
assets/pixelab/buildings/walls/
  stone_brick/
    south_base.png          (32×128)
    south_window.png        (32×128)
    south_door.png          (64×128)
    interior_base.png       (32×128)
    interior_archway.png    (64×128)
    edge_ew.png             (32×32)
    north_back.png          (32×64)

src/render/building-renderer.js  — rewritten drawBuildingWalls
```

## Honest Absences

- Phase 1: one variant per piece, no animations, one material (stone brick)
- East/West walls: minimal visual (edge piece only) until better side-view generation
- Interior walls: no windows (exterior only)
- Roof: absent until Phase 3
- Door/window animations: absent until Phase 2
- Night lighting through windows: absent (future atmosphere integration)
