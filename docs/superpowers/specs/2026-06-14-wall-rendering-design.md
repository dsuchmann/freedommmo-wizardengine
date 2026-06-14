# Wall Rendering System — Design Spec

**Date:** 2026-06-14
**Status:** design (user review pending)
**Prerequisites:** building floors in chunk pipeline (done), building layout system (done)

## Problem

Building walls are 8-directional objects placed around building perimeters.
The current prototype shows the approach works but has positioning errors,
aspect ratio distortion, missing interior walls, and no east/west wall strategy.

## Architecture

### Wall Types

Every building has at minimum TWO wall types:

1. **Exterior wall** — the outside face of the building. Brick/stone texture facing
   outward. South and north exterior walls show the full face. Windows and doors
   appear only on exterior walls.

2. **Interior wall** — the inside face of walls + room dividers. Plain plaster,
   wood paneling, or painted surface. No windows. Interior walls appear at:
   - The INSIDE face of exterior walls (what you see looking at the north wall
     from inside the building)
   - Room dividers where two rooms meet within a building (L-shape junctions,
     corridor walls, etc.)

Some buildings may have multiple interior wall materials (e.g., a manor with
stone corridors but plastered bedrooms).

### Wall Directions

In 3/4 top-down view, the 8 directions have different visual roles:

| Direction | Visibility | What You See |
|-----------|-----------|--------------|
| **South** | Full face | Most visible — brick/stone face, windows, doors. This is THE wall. |
| **North** | Back of wall | Seen above the building, partially occluded. Shows the wall cap/top and upper portion of the back face. |
| **East** | Minimal | Nearly invisible in top-down. Render as a decorative column/pillar element or thin textured strip. |
| **West** | Minimal | Same as east, mirrored. Column/pillar or thin strip. |
| **SE/SW** | Partial | Corner pieces — show the angle where south wall meets side wall. |
| **NE/NW** | Partial | Corner pieces — show the angle where north/back wall meets side wall. |

**East/West strategy:** Since these walls are edge-on in top-down view, they're
nearly invisible. Instead of a full wall face, render a decorative element:
- Column/pillar at each corner
- Or a thin textured strip (1-2 tiles wide) showing the wall edge
- Or nothing (collision-only, no visual)

### Tiling Math

Wall objects must tile seamlessly along building edges without distortion.

**Source sprite:** 170×170px (PixelLab max for 8-dir at 4 candidates)
**Game tile:** 32px per tile

170px ÷ 32px = 5.3125 tiles — does NOT divide evenly.

**Options:**
- **A) Generate at 160×160** (5 tiles exactly). Loses some resolution but tiles perfectly.
- **B) Generate at 170×170**, render at 160px (5 tiles). 6% downscale, barely visible.
- **C) Generate at 128×128** (4 tiles exactly). Smaller but cleaner tiling.

**Recommendation:** Generate at 160×160 (request `size: 160` from PixelLab).
Each wall segment = exactly 5 tiles. A 15-tile-wide building south wall =
3 segments. A 20-tile-wide wall = 4 segments. No stretching, no gaps.

### Wall Placement

Walls sit ON the perimeter border (the dark line drawn in the chunk compiler).
The wall sprite's anchor point determines where it sits relative to the
building edge.

**South wall:** Bottom edge of wall sprite aligns with the south edge of the
building floor. Wall extends UPWARD (visually) from the floor edge. The sprite
is drawn at `(edgeX, edgeY - wallHeight + anchorOffset)`.

**North wall:** Top edge aligns with the north edge of the building floor.
Wall extends upward BEHIND the building (partially occluded by the floor).

**East/West:** Column sprites placed at the corners where south/north walls end.

### Interior Wall Placement

Interior walls appear at:
1. **Room boundaries** — where two building sections meet in L/T/compound shapes.
   The junction line gets an interior wall on each side.
2. **Back of exterior walls** — the interior face of the north wall (seen from
   inside the building looking north).

Interior walls use the same placement math as exterior walls but with interior
wall sprites (no windows, different texture).

### Asset Generation Plan

**Per wall material (e.g., stone brick):**

| Asset | Size | Directions | Count |
|-------|------|-----------|-------|
| Exterior wall plain | 160×160 | S, N, SE, SW, NE, NW | 6 |
| Exterior wall + window | 160×160 | S, N | 2 |
| Exterior wall + door | 160×160 | S, N | 2 |
| Interior wall plain | 160×160 | S, N | 2 |
| Corner column/pillar | 64×64 | 1 (top-down) | 1 |
| **Total per material** | | | **13 sprites** |

**Window/door animations (later):**
- Window open/close: 4 frames
- Door open/close: 4 frames
- Generated via `animate_object` on the wall+window/door state

**Quality control:** Each generation produces candidates. Select the best via
`select_object_frames`. Mirror good sprites for missing directions (flip east↔west).

### Rendering Pipeline

1. **Chunk compiler** draws floor tiles + foundation border (already done)
2. **F2 pipeline** draws vegetation (suppressed at buildings)
3. **Wall renderer** draws wall objects at building perimeters:
   - North walls first (behind the building)
   - East/West columns
   - South walls last (in front, most visible)
   - Interior walls at room junctions
4. **Player** drawn by F2 pipeline (correct z-order with walls)

The wall renderer draws on the 2D canvas AFTER F2 sprites. South walls are
in front of the player (you walk behind them). North walls are behind
(drawn first, player occludes them).

### Collision

All perimeter tiles are impassable (wall collision). Interior wall tiles
are impassable except at door positions. This is data-only — no visual
needed for collision. The building footprint already defines wall positions
(`footprint.walls` array from the layout system).

### Interior/Exterior Detection

For each wall tile on the building perimeter:
- If the tile faces OUTWARD (neighbor outside building): exterior wall
- If the tile faces INWARD (neighbor inside building, different section): interior wall
- Room-junction walls: interior wall on both sides

The `queryBuildingTile` function can determine this: a building tile whose
neighbor is also a building tile but in a different section = interior wall.

## Phases

### Phase 1 — Fix positioning + south wall only
- Align wall sprites to perimeter border
- Correct aspect ratio (160px segments, 5 tiles each)
- South wall only (most impactful visual)
- Remove east/west walls temporarily

### Phase 2 — Interior walls + room junctions
- Generate interior wall sprites (plain, no windows)
- Detect room junctions in L/T/compound buildings
- Place interior walls at junctions

### Phase 3 — North wall + corner columns
- North wall (behind building, partially visible)
- Corner column sprites at east/west edges
- Corner pieces at NE/NW/SE/SW

### Phase 4 — Windows + doors + animations
- Window open/close animation frames
- Door open/close animation frames
- Interactive: player can open/close doors

### Phase 5 — Roof
- Roof Wang tileset (already generated: thatch)
- Roof covers building from above
- Alpha-fades when player enters
- Different roof materials (thatch, tile, slate, etc.)

## Honest Absences

- East/West walls: collision-only until Phase 3 (no visual)
- Interior walls: absent until Phase 2
- Roof: absent until Phase 5
- Window/door animations: absent until Phase 4
- Lighting through windows: absent (future atmosphere integration)
