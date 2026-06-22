# Grassland Tile Corpus — Manifest + Deterministic Prompts (from scratch)

Everything generated before is abandoned. We generate **tile objects** with `create_1_direction_object`,
each carrying **states** and **variants**, and assemble them through the revived tile engine + procedural roof.

## Sizing (locked, from the game's real proportions)
- Source tile **32px**; on-screen **62.4px/tile** @ default zoom 1.95. Character **≈2.5 tiles** tall.
  Wall **4 tiles / story**. Door **3.4 tiles** tall (clears the character). (src: constants.js:4,
  camera.js:3, wall-config.js:10, door-leaves.js:28, humanoid rig.)
- **Tile resolution = 64 px/tile** (2× native; = on-screen size; the MAX that fits a full story in
  PixelLab's 256² square). **One tile-object = 256×256 px = 4 tiles wide × 4 tiles tall (one story).**
  Door = 2 tiles wide (128px) × 3.4 tall (~218px). Window ≈ 1 tile. Foundation course ≈ 0.5 tile (32px).

## Corpus = biome(grassland) × material × variant × object × {states}
- **materials (4):** `timber_frame`, `fieldstone`, `cob`, `wattle_daub`
- **variants (2):** `v0`, `v1`
- **objects/states per (material × variant)** — the BASE is one `create_1_direction_object`; the rest
  are `create_object_state` of it (so they share the exact wall pattern → tile seamlessly):

| state id | what it is | tool |
|---|---|---|
| `ground_plain` | BASE: 4×4 wall, foundation course at bottom, wall-plate beam at top, no apertures, tileable | create_1_direction_object |
| `ground_window` | + a shuttered window, centered | create_object_state |
| `ground_door` | + a 2-tile plank door (3.4 tall), centered | create_object_state |
| `ground_door_open` | door swung open, dark threshold (animation key) | create_object_state |
| `left_corner` | left edge turns toward the WEST side (quoin + sliver of receding side) — 3D edge | create_object_state |
| `right_corner` | right edge turns toward the EAST side | create_object_state |
| `side_ew` | the side (E/W) wall face, narrower, indicating depth | create_object_state |
| `upper_plain` | foundation removed; wall continues to the bottom edge (upper storeys) | create_object_state |
| `upper_window` | upper wall + window, no foundation | create_object_state |

→ 9 objects × 4 materials × 2 variants = **72 tile-objects** (8 base `create_1_direction_object` +
64 `create_object_state`). Apertures (`*_window`, `*_door`) are objects → later `animate_object`
(door open/close, shutter) for living buildings.

## Deterministic prompt — BASE (`ground_plain`)
> A seamless FRONT-FACING WALL SECTION of a {MATERIAL_PHRASE} grassland village house, drawn as a
> FLAT ORTHOGRAPHIC ELEVATION — straight-on, parallel to the screen, NO perspective, NO vanishing
> point, NOT isometric. The wall is exactly 4 tiles wide and 4 tiles tall (one storey, a square).
> {MATERIAL_DETAIL}. A low grey fieldstone FOUNDATION course runs along the very bottom, about half a
> tile high. A horizontal dark-oak WALL-PLATE beam runs along the very top edge. The wall texture is
> UNIFORM and REPEATS horizontally so the left edge matches the right edge for seamless tiling. NO
> door, NO windows, NO roof, NO chimney, NO grass, NO ground, NO smoke, NO shadow, NO people — just
> the wall, edge-to-edge, on a FULLY TRANSPARENT background. Clean high-resolution pixel art, single
> colour outline, detailed shading, warm cosy grassland palette.

MATERIAL_PHRASE / MATERIAL_DETAIL:
- timber_frame: "timber-frame" / "cream lime-plaster panels divided by a regular grid of dark oak timber studs and rails"
- fieldstone: "fieldstone" / "tightly-coursed grey fieldstone rubble masonry with pale mortar joints"
- cob: "cob" / "smooth warm ochre earthen cob render with softly rounded surface and a pale lime-wash"
- wattle_daub: "wattle-and-daub" / "whitewashed wattle-and-daub panels between slender dark timber studs"

## Deterministic STATE edits (create_object_state of the base)
- `ground_window`: "Add ONE shuttered window centred in the wall, about 1 tile wide and 1.2 tiles tall, with a timber frame, sill, and open wooden shutters. Keep the wall material, foundation, wall-plate, proportions, and tiling EXACTLY the same — change nothing else."
- `ground_door`: "Add a wooden plank DOOR centred at the base, exactly 2 tiles wide and 3.4 tiles tall, set into a timber door-frame, its bottom sitting on the foundation. Keep the wall material, foundation, proportions identical — change nothing else."
- `ground_door_open`: "Take the door and swing it OPEN inward, revealing a dark interior threshold behind it. Keep the frame, wall, and everything else identical."
- `left_corner`: "Show the LEFT edge of this wall turning the corner toward the building's WEST side: a stone/timber quoin on the left plus a thin sliver of the receding west side-wall, so the left edge reads as a 3D corner instead of a flat cut. Keep the material identical; the right ~3 tiles stay the plain wall."
- `right_corner`: "Mirror of left_corner — the RIGHT edge turns toward the EAST side with a quoin + sliver of the receding east side-wall. Keep the material identical."
- `side_ew`: "Show the building's SIDE wall face (the east/west elevation): the same material as a narrower receding wall indicating depth, with the foundation course and wall-plate. Keep the material identical."
- `upper_plain`: "Remove the fieldstone foundation course at the bottom; the wall texture continues all the way to the bottom edge (this is an UPPER storey that stacks on the one below). Keep the wall material, wall-plate, proportions, and tiling identical."
- `upper_window`: "From the upper-storey wall (no foundation), add ONE centred shuttered window (1 tile × 1.2 tall, timber frame). Keep everything else identical."

## Tiling = MIRROR/FLIP alternation (renderer trick, validated)
No cross-fade, no art change. The renderer lays the plain tile then its HORIZONTAL FLIP, alternating
(base · flip · base · flip …). Every seam is the same edge meeting itself (base.right ≡ flip.left), so
it's perfectly seamless — fieldstone proven flawless; timber/wattle seamless with a post-rhythm at joins.
Door/window variants drop into their columns (base or flipped, centred aperture is flip-invariant);
`left_corner`/`right_corner` tiles cap the two ends. Post-process is just `normalize-blocks.mjs` (strip
debris); verify each tile as a 5-wide mirror-tiled strip (`scripts/flip-tile.mjs`).

## Assembly + wiring (re-pilot, this is the build)
1. Place tiles in the engine's wall-piece paths per material; **re-enable** `building-occluder.drawWalls`
   tiling at the 64px/tile scale (`south_base`=`ground_plain`, doorway=`ground_door`, window=`ground_window`,
   corners=`left/right_corner`, edge_ew=`side_ew`, upper rows=`upper_*`); retire the whole-facade stamps.
2. **Procedural roof** caps the terminal row (the camera/depth).
3. **Enrich the building-generation platform**: footprint generation tags each footprint tile with its
   identity (face S/E/W/N/interior · aperture plain/window/door · story ground/upper/terminal · edge
   interior/left/right) so the renderer picks the right tile-state. (sim/world/buildings/footprints.js +
   the resolved-building record.)
4. Browser-verify grassland buildings in the seed-42 settlement (tile walls + procedural roof, doors fit
   the character, clean tiling, 3D edges).

## Execution: subagent-driven (user-directed)
Generate (workflow) → post-process → wire engine (subagent) → enrich building-gen (subagent) →
browser-verify (subagent). One material end-to-end as the first vertical slice, then the rest.
