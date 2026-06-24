# Desert Tile Corpus — Manifest (2nd biome pilot)

> The SECOND biome pilot. Validates that the tile-corpus pipeline generalizes past grassland — the structure
> is identical, ONLY the material vocabulary + the 4 biome tokens change. Inherits everything structural from
> `2026-06-22-tile-corpus-manifest.md` (the **same 10 states**, ground/upper foundation split, generate-WEST-
> flip-EAST corners, animate_object door/window motion, mirror-tiling, sizing). This file ONLY specifies the
> desert-specific values + prompts. Pipeline is now QA-gated: `finish_material.sh` runs the surgical corner
> post-process then `qa-tiles.mjs` + `qa-frames.mjs` automatically.

## Why desert (pilot choice, user-confirmed 2026-06-23)
Maximally unlike grassland while still grounded — it forces EVERY biome token to diverge (earthen materials,
arched recessed door, lattice window, mud-brick footing, flat-roof parapet/vigas instead of a pitched
dark-oak wall-plate). If the token system survives desert, it survives all 16 biomes.

## Biome tokens (desert) — resolve into the shared BASE + STATE prompts
- `{FOUNDATION}`: "a low plinth course of darker sun-baked mud-brick, about half a tile high"
- `{DOOR}`: "a weathered palm-plank door with dark iron studs and a simple ring handle, set in a recessed POINTED-ARCH (keyhole) doorway"
- `{WINDOW}`: "a small deep-set window filled with a carved wooden mashrabiya lattice screen (geometric fretwork); no shutters"
- `{WALLPLATE}`: "a horizontal row of projecting wooden viga roof-beam ends beneath a flat tan mud parapet cap"

## Materials (4) — the smooth / coursed / cut / woven spread (mirrors grassland)
| material | MATERIAL_PHRASE | MATERIAL_FACE (opacity-enforced middle zone) | MATERIAL_EDGE (finished flat vertical wall-END) |
|---|---|---|---|
| **adobe** | "adobe" | "a smooth UNIFORM warm tan adobe mud-plaster covering the whole zone as one solid earthen surface — NO holes, NO see-through gaps" | "a finished vertical edge of the SAME tan adobe, gently rounded where the mud render wraps to a clean end — the SAME tan colour as the wall, NOT cream, NOT a different material" |
| **mudbrick** | "mud-brick" | "tightly-coursed sun-dried tan mud-bricks set in solid earthen mortar that fills every joint — NO holes, NO see-through gaps" | "a neat vertical column of larger interlocking tan mud-brick quoins" |
| **sandstone** | "sandstone" | "tightly-fitted carved pale-gold sandstone ashlar blocks set in solid pale mortar filling every joint — NO holes, NO gaps" | "a neat vertical column of larger dressed pale-gold sandstone quoin blocks" |
| **reed_palm** | "reed-and-palm" | "solid woven reed-mat panels packed with tan daub filling every bay between slender palm-wood posts — opaque, no gaps" | "a finished vertical palm-wood corner post capping the end reed-daub panel" |

MATERIAL_DETAIL (for MATERIAL_PHRASE expansion if needed): adobe = "smooth hand-plastered tan adobe with softly
rounded surfaces and faint sun-cracks"; mudbrick = "coursed rows of sun-dried tan mud-bricks with thin earthen
joints"; sandstone = "carved pale-gold sandstone ashlar with fine tooled faces"; reed_palm = "woven reed-mat
daub between slender palm posts".

### v1 VARIANT_PHRASE (desert siblings — subtle, same palette)
- adobe: "a touch more surface undulation and a few darker sun-baked patches; same palette."
- mudbrick: "slightly larger, more irregular brick coursing with a few darker bricks; same palette."
- sandstone: "a different ashlar bond (one taller course) with faint weathering; same palette."
- reed_palm: "slightly slimmer palm posts and a denser reed weave; same palette."

## BASE prompt (`ground_plain`) — desert-resolved (adobe shown; swap MATERIAL_FACE/PHRASE per material)
> A seamless one-storey FRONT WALL of an **adobe** desert house, FLAT ORTHOGRAPHIC ELEVATION (straight-on, NOT
> isometric), exactly 4 tiles wide and 4 tiles tall (a square). THREE fully-opaque horizontal zones, NO
> transparent gaps anywhere inside the wall:
> • TOP (cap) — {WALLPLATE}, across the full width.
> • MIDDLE (the wall face, most of the height) — {MATERIAL_FACE}.
> • BOTTOM (footing) — {FOUNDATION}.
> CRITICAL: every pixel inside the wall's rectangle is SOLID OPAQUE wall (the render/mortar FILLS all gaps);
> there are NO transparent or see-through areas within the wall outline — only the background OUTSIDE the
> rectangle is transparent. The texture repeats horizontally (left edge ≡ right). NO door, NO windows, NO
> roof, NO chimney, NO sand, NO ground, NO smoke, NO people, NO text. Clean high-resolution pixel art, single
> colour outline, detailed shading.

STATE prompts (`ground_window`, `ground_door`, `ground_left_corner`, `upper_*`) reuse the grassland manifest's
deterministic edits VERBATIM with the desert `{DOOR}/{WINDOW}/{WALLPLATE}/{FOUNDATION}/{MATERIAL_EDGE}` tokens
substituted (incl. the GLOBAL no-caps-emphasis / "render NO text" rule and the door ground-placement
enforcement). Door animation prompt: "the palm-plank door swings open inward on its hinge … only the door
leaf moves" (frame_count=8, v3); the new prompt also names "a plain flat dark interior, no patterns" to avoid
the zigzag-triangle final-frame glitch that `qa-frames.mjs` caught on grassland.

## Roofs — DEFERRED for the wall pilot (decision pending)
Desert vernacular is FLAT/parapet-roofed; the procedural roof only does pitched. For the pilot we validate
desert WALLS first (roof layer off / flush). Adding a flat-roof profile (low parapet, viga shadow line) is a
follow-up once the walls prove out.

## Execution (vertical slice first)
1. **adobe v0** end-to-end: 1 `create_1_direction_object` base + 6 `create_object_state` (window, door,
   left_corner, upper_plain, upper_window, upper_left_corner) + 2 flips (right corners) + 2 animations
   (door, window). Drop raws into `tools/_round2/` as `desert_adobe__<state>_raw.png` and run
   `finish_material.sh` (→ surgical corners + auto qa-tiles/qa-frames).
2. Wire: the renderer resolves materials by biome via the building material catalog — confirm desert →
   {adobe,mudbrick,sandstone,reed_palm} is registered (see `src/world/lg-catalog.js` / the biome→material map).
3. Browser-verify one adobe desert building in a desert settlement.
4. If clean: generate the other 3 materials + every v1, then expand to all biomes.
