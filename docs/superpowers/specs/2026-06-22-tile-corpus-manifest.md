# Grassland Tile Corpus — Manifest + Deterministic Prompts (from scratch)

Everything generated before is abandoned. We generate **tile objects** with `create_1_direction_object`,
each carrying **states** and **variants**, and assemble them through the revived tile engine + procedural roof.

> ## ROUND 2 STATUS (2026-06-22, user-locked)
> The Round-1 result on disk is a **v0 pilot subset (20 of 72)** with shortcuts we are now retiring:
> cropped-derived uppers, and a *shared* material-agnostic door/window overlay. Round 2 regenerates the
> **full 80 fresh** with these decisions:
> - **Regenerate all 80** (replace the 20 pilot tiles) — clean, single-provenance corpus.
> - **10 states** — the foundation/no-foundation split also covers the corners (`upper_left_corner`,
>   `upper_right_corner`), so a multi-storey building never floats a foundation course mid-wall. `side_ew`
>   moved OUT to the interior corpus (the roof occludes the exterior side). **General all-biome rule.**
> - **v0 + v1** both generated for every state (variety across a street; see *Variant strategy* below).
> - **Per-material apertures** — `ground_window` / `ground_door` / `ground_door_open` / `upper_window` are
>   real per-material `create_object_state` tiles, NOT the shared wood overlay. (The shared overlay is dropped.)
> - **Uppers generated, not cropped** — every `upper_*` (plain, window, AND left/right corner) comes from
>   `create_object_state` with opacity enforced; `derive-upper.mjs` is a *fallback only* when PixelLab
>   returns >75% transparent.
> - **Interiors are derived from these same exterior bases** — see the companion
>   `2026-06-22-interior-tile-corpus-manifest.md`. This makes inside match outside and lets us **retire the
>   parallel `bulk_generate_buildings.py` / `walls/grassland/**` exterior+interior pipeline** for grassland.
> - **Materials unchanged** (already biome-specific): `timber_frame`, `fieldstone`, `cob`, `wattle_daub`.

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

**Two storey tiers — `ground_*` (carries the grey foundation course at the bottom) and `upper_*` (no
foundation; wall runs to the bottom edge so it stacks above) — apply to EVERY face and edge piece**, so a
multi-storey building never floats a foundation course mid-wall. Only the **door** is ground-only (you
enter on the ground). Every `upper_*` is a uniform "remove the foundation course" `create_object_state` of
its `ground_*` counterpart.

| state id | what it is | how produced |
|---|---|---|
| `ground_plain` | BASE: 4×4 wall, foundation course at bottom, wall-plate beam at top, no apertures, tileable | **create_1_direction_object** |
| `ground_window` | + a shuttered window (shutters OPEN by default), centred | state of `ground_plain` |
| `ground_door` | + a LARGE plank door (~3.4 tiles tall × 2 wide, person-height) that REACHES THE GROUND (its threshold is at the bottom edge, no foundation strip beneath), centred | state of `ground_plain` |
| `ground_left_corner` | FLAT finished LEFT wall-END: leftmost strip is the final material as a clean vertical edge, flush to the wall-plate — NO 3D/side-wall/depth + foundation | state of `ground_plain` |
| `ground_right_corner` | FLAT finished RIGHT wall-END | **flip-h(`ground_left_corner`)** — not generated |
| `upper_plain` | `ground_plain` with the foundation REMOVED — wall runs to the bottom edge (stacks above) | state of `ground_plain` |
| `upper_window` | `ground_window` with the foundation removed | state of `ground_window` |
| `upper_left_corner` | `ground_left_corner` with the foundation removed — upper-storey finished edge | state of `ground_left_corner` |
| `upper_right_corner` | upper-storey finished RIGHT wall-END | **flip-h(`upper_left_corner`)** — not generated |

**Door & window MOTION = `animate_object` ONLY (NON-NEGOTIABLE).** The aperture is a STATE of the base
(`ground_door`, `ground_window`); the open/close MOTION is a real multi-frame `animate_object` applied to
THAT state object. We do NOT generate `ground_door_open` / `ground_window_closed` state tiles to fake motion,
and we do NOT composite separate door "leaf" sprites (the leaf/overlay approach failed — rejected). So per
material×variant: door = `animate_object(ground_door)`, window = `animate_object(ground_window)`.

→ Per material×variant: **7 PixelLab objects** (1 `create_1_direction_object` base + 6 `create_object_state`:
window, door, left_corner, upper_plain, upper_window, upper_left_corner) + **2 flips** (both right corners,
free) + **2 animations** (`animate_object` on the door + window state objects). Across 4 materials × 2 variants
= **56 generated objects + 16 flips + 16 animations**. (Right corners are mirror-derived, never generated —
PixelLab is unreliable per-side, so we make ONE good side and flip it.)

> **`side_ew` is NOT in the exterior corpus — it belongs to the INTERIOR.** A building's exterior E/W side
> is occluded by its roof in normal play, so the exterior set draws no side face. The E/W *framing* you see
> is an interior wall (`interior_plain`, interior manifest). One nuance: when the player is INSIDE and the
> roof goes transparent, we want a THIN sliver of the EXTERIOR material at the E/W edges — that reuses the
> exterior `*_plain` tile drawn as a thin strip (a renderer detail, NOT a new generated object). Deferred to
> the interior+roof pass.

> **General rule (ALL biomes, not just grassland):** every biome's exterior corpus uses these SAME 10
> states (5 piece-types {plain, window, door, left_corner, right_corner} × {ground, upper}, minus door +
> door_open on the upper tier). The ground/upper foundation split is structural — when we extend to other
> biomes the state list is identical; only the material vocabulary + prompts change. (E/W side framing is
> the interior corpus's job.)

## Variant strategy (v0 vs v1)
v1 is a **sibling** of v0, not a clone and not a different material: same deterministic BASE prompt +
the material's `MATERIAL_FACE`/`MATERIAL_DETAIL`, but generated as a SEPARATE `create_1_direction_object`
base with a different seed **plus a one-line `VARIANT_PHRASE`** that nudges the coursing/rhythm so a row of
houses doesn't read as one stamped wall. Each variant's 8 `create_object_state` tiles derive from THAT
variant's base (so v1's door tile matches v1's wall); each variant gets its own 2 flips + 2 animations. The
renderer picks v0/v1 per-building by a seeded hash.
- v0 `VARIANT_PHRASE`: "" (the canonical wall).
- v1 `VARIANT_PHRASE`: per material — a subtle sibling:
  - fieldstone: "slightly larger, more irregular stone coursing with a few darker stones; same palette."
  - cob: "a touch more surface undulation and a slightly warmer lime-wash; same palette."
  - timber_frame: "a different but still regular stud rhythm (one extra vertical bay); same palette."
  - wattle_daub: "slightly slimmer studs and a faintly cooler whitewash; same palette."
Keep everything else identical (proportions, zones, opacity rule, tiling) so v0 and v1 still mirror-tile
and still drop the same door/window columns.

## Deterministic prompt — BASE (`ground_plain`) — ZONE-SPECIFIED + OPACITY-ENFORCED
The wall must be specified as THREE opaque zones, and opacity must be enforced or stone/cob render with
see-through mortar gaps (measured: fieldstone 40–56% holes, cob 69%; timber/wattle 0–3% = fine).
> A seamless one-storey FRONT WALL of a {MATERIAL_PHRASE} grassland house, FLAT ORTHOGRAPHIC ELEVATION
> (straight-on, NOT isometric), exactly 4 tiles wide and 4 tiles tall (a square). THREE fully-opaque
> horizontal zones, NO transparent gaps anywhere inside the wall:
> • TOP (cap) — a horizontal dark-oak wall-plate beam across the full width.
> • MIDDLE (the wall face, most of the height) — {MATERIAL_FACE}.
> • BOTTOM (footing) — {FOUNDATION}.
> CRITICAL: every pixel inside the wall's rectangle is SOLID OPAQUE wall (the render/mortar FILLS all
> gaps); there are NO transparent or see-through areas within the wall outline — only the background
> OUTSIDE the rectangle is transparent. The texture repeats horizontally (left edge ≡ right). NO door,
> NO windows, NO roof, NO chimney, NO grass, NO ground, NO smoke, NO people. Clean high-resolution
> pixel art, single colour outline, detailed shading.

MATERIAL_FACE (the opacity-enforced middle zone):
- fieldstone: "tightly-fitted grey fieldstone blocks set in PALE SOLID MORTAR that completely fills every joint and gap between the stones — NO holes, NO see-through gaps"
- cob: "a smooth UNIFORM ochre cob render covering the whole zone as one solid plastered surface — NO holes"
- timber_frame: "tall slim bays of TEXTURED warm cream lime-plaster (visible rough plaster grain, faint hairline cracks, subtle warm tonal mottling — matte, opaque, NOT flat, NOT glassy) separated by a regular rhythm of SLENDER VERTICAL dark-oak studs ONLY — NO horizontal mid-rails, NO square panels, so it reads as a continuous plastered wall broken only by thin vertical timbers, NEVER as window panes" [2026-06-24 FIX: the old 'grid of studs+rails / solid cream panels' produced framed square bays that read as windows; see GLOBAL PROMPT RULE (wall ≠ windows)]
- wattle_daub: "solid whitewashed daub panels filling every bay between dark timber studs — opaque, no gaps"

MATERIAL_PHRASE / MATERIAL_DETAIL:
- timber_frame: "timber-frame" / "textured cream lime-plaster with a regular rhythm of slender VERTICAL dark-oak studs only (close-studding), no horizontal mid-rails — reads as a plastered wall, not a grid of panels"
- fieldstone: "fieldstone" / "tightly-coursed grey fieldstone rubble masonry with pale mortar joints"
- cob: "cob" / "smooth warm ochre earthen cob render with softly rounded surface and a pale lime-wash"
- wattle_daub: "wattle-and-daub" / "whitewashed wattle-and-daub panels between slender dark timber studs"

MATERIAL_EDGE (the FLAT finished vertical wall-END for the corner/edge tiles — a clean termination of the
material, NO depth, NO receding side wall):
- fieldstone: "a neat vertical column of larger interlocking grey quoin cornerstones"
- cob: "a finished vertical edge of the SAME ochre cob, gently rounded with a subtle highlight where the render wraps to a clean end — the SAME ochre colour as the wall, NOT cream, NOT white, NOT lime-washed, NOT a different material" (lesson: 'lime-washed edge' rendered a bright cream block that read as a 2nd material)
- timber_frame: "a finished vertical dark-oak corner post closing the plaster bays"
- wattle_daub: "a finished vertical dark timber edge stud capping the end daub panel"

BIOME-LEVEL tokens — `{FOUNDATION}` (footing course), `{DOOR}` (door leaf style), `{WINDOW}` (window style),
`{WALLPLATE}` (top cap beam). These are per-BIOME (shared across that biome's materials/variants unless a
material overrides). **Grassland values** (medieval village):
- `{FOUNDATION}`: "a grey fieldstone foundation course about half a tile high"
- `{DOOR}`: "wooden plank door (vertical oak planks with iron hinges and a simple handle)"
- `{WINDOW}`: "shuttered window with a timber frame, a sill, and OPEN wooden shutters"
- `{WALLPLATE}`: "dark-oak wall-plate"

> **DIVERSITY (maximal variance — full build-out DEFERRED until after this pilot proves the pipeline).**
> Nothing is a universal default. Every biome supplies its OWN `{FOUNDATION}/{DOOR}/{WINDOW}/{WALLPLATE}` +
> material set, so e.g. desert/tundra/mystic/volcanic get their own door leaf, window, footing, palette —
> NOT grassland's wooden door. Token resolution hierarchy: BIOME (foundation, door, window, wall-plate,
> material vocabulary) → MATERIAL (face, edge — optional door/window override) → VARIANT (sibling nudge).
> For NOW we only fill GRASSLAND's tokens to pilot fieldstone v0; we expand the per-biome/material/variant
> vocabularies (and push for maximal variance) once this set is proven in-game.

## Deterministic STATE edits (create_object_state of the base)
- `ground_window`: "Add ONE {WINDOW} centred in the wall, about 1 tile wide and 1.2 tiles tall. Keep the wall material, foundation, wall-plate, proportions, and tiling EXACTLY the same — change nothing else." (Its open/close MOTION is an `animate_object` on this object — see *Animations*; there is NO separate `*_window_closed` state tile.)
- `ground_door` — **SIZE + GROUND-PLACEMENT ENFORCED** (Round-2 fixes: first door rendered too small; second floated above the foundation; a caps emphasis word "LARGE" got rendered as literal TEXT on the wall-plate. Force size in tiles AND pixels AND human proportion, force the threshold to the ground, avoid caps emphasis words, and add a NO-TEXT clause): "Add a tall, wide {DOOR} centred at the base of the wall, set in a timber door-frame. It REACHES THE GROUND: its bottom edge extends all the way DOWN to the very bottom edge of the image, REPLACING the foundation course at its location — NO stone or foundation strip beneath the door; the threshold flush with the ground. It is about 90% of the wall's height (up to just under the {WALLPLATE}) and about half the wall's width — big enough for an adult to walk through upright. Keep the wall material, the {WALLPLATE}, and the foundation to the LEFT and RIGHT of the door identical. CRITICAL: render NO text, letters, words, numbers, or signage anywhere in the image. Change nothing else." (Its open MOTION is an `animate_object` on this object; NO separate `*_door_open` state tile.)
  - **GLOBAL PROMPT RULE:** never use ALL-CAPS emphasis WORDS that could be read as signage (PixelLab rendered "LARGE" as a sign once); keep emphasis lowercase, and include "render NO text/letters/words/signage" in any prompt that adds a prominent feature.
  - **GLOBAL PROMPT RULE (wall ≠ windows) [2026-06-24, applies to ALL biomes at scale]:** a base `ground_plain` wall must read as a SOLID WALL, never as a grid of windows. NEVER prompt timber/plaster infill as "a regular grid of studs AND rails" or "square panels" — that yields framed square bays that read as window panes. (The timber_frame v0 failure: windowless buildings looked "half-loaded", a wall of blank windows.) For ANY biome/material with framed-plaster infill, use VERTICAL studs / close-studding ONLY (no horizontal mid-rails) and make the infill TEXTURED (plaster grain, hairline cracks, tonal mottling — not flat/glassy). `wattle_daub` v0 (vertical studs, textured daub) is the reference for "reads as wall." Sanity check before mass-gen: imagine the tile mirror-tiled across a WINDOWLESS wall — if it looks like a wall of blank windows, the prompt is wrong.
- **Corners — generate the WEST (left) only, FLIP for the EAST (right)** (Round-2 fix: PixelLab is unreliable per-side — one edge often has the quoin intrude into / rise past the wall-plate cap. So we generate ONE clean side and mirror it; `scripts/flip-h.mjs <west> <east>` produces the opposite. **The GENERATED side is always the WEST**; the EAST is ALWAYS `flip-h(west)` — never generated. **The flip ONLY works if the generated WEST is clean**, so MONITOR it (see below). [LESSON 2026-06-22: a fieldstone build sourced the flip from the BAD east tile by mistake → the defect spread to both sides. The source must be the GENERATED west, verified clean.]
  - **MONITORING (how we keep this scalable):** ① objective auto-gates that DO catch failures — `solidify.mjs` (opacity holes), emptiness, gross bbox/size outliers → auto-reject + regenerate with a bumped `seed`. ② the subtle aesthetic defect (quoin intruding into the cap beam) is NOT reliably auto-detectable (top-profile and beam-continuity metrics both failed to separate good from bad), so the reliable catch is a **compact MONTAGE of the generated WEST corners for a ~5-second human glance** — cheap because we generate only ONE side per tier (≈8 corner tiles per biome). Glance, approve, THEN flip.
  - `ground_left_corner`: "Turn the LEFT edge of this wall into a CLEAN, FINISHED WALL END — NOT a 3D corner. Keep the view perfectly FLAT and straight-on (orthographic): do NOT show any receding east/west side wall, no perspective, no vanishing point, no sense of depth. Along the leftmost ~half tile render {MATERIAL_EDGE}. CRITICAL ALIGNMENT: this finished edge spans EXACTLY the same vertical extent as the wall — it starts at the foundation course at the bottom and stops FLUSH at the {WALLPLATE} beam at the top; NO stones/studs protrude ABOVE the wall-plate, NONE extend past the left edge, and the top of the edge column is LEVEL and even. Everything to the right stays the plain wall. Keep the foundation course, wall-plate, material, proportions, and horizontal tiling otherwise identical."
  - `ground_right_corner`: **NOT generated** → `node scripts/flip-h.mjs <ground_left_corner> <ground_right_corner>`.
- **`upper_*` — ONE uniform "remove-foundation" edit**, applied to the matching `ground_*` tile (upper_plain←ground_plain, upper_window←ground_window, upper_left_corner←ground_left_corner; **upper_right_corner = flip-h(upper_left_corner)**, NOT generated): "Remove the grey foundation course at the very bottom; the wall texture continues all the way to the bottom edge (this is an UPPER storey that stacks on the one below). Keep the wall material, wall-plate, and any quoin / window / corner detail, proportions, and tiling EXACTLY the same — delete ONLY the foundation course, change nothing else." If PixelLab returns an upper >75% transparent, fall back to `derive-upper.mjs` cropping the matching `ground_*` tile.

`{WALLPLATE}` = the material's top cap beam, "dark-oak wall-plate" for all four grassland materials (kept a token so other biomes can swap it).

## Animations (REAL multi-frame `animate_object` — NON-NEGOTIABLE method)
Only the APERTURES animate; walls/corners/plain faces are static. The MOTION is produced by `animate_object`
(mode `v3`, the default — it GENERATES the in-between frames). It is applied **directly to the aperture STATE
object** (`ground_door`, `ground_window`) — the same `create_object_state` object that lives in the corpus.

**HARD RULES (do not deviate):**
1. **State first, THEN animate.** The door/window is a `create_object_state` of the base (`ground_door`,
   `ground_window`); the open/close motion is `animate_object` on THAT object. 
2. **Never fake motion with extra states.** Do NOT generate `*_door_open` or `*_window_closed` state tiles to
   represent the open/closed pose — that is a state-change, not an animation. The animation frames ARE the
   open/closed poses (first frame = idle, last frame = fully open/shut).
3. **Never composite separate "leaf" sprites.** The leaf/overlay approach was tried and failed — rejected.
4. **Method = TEXT-PROMPTED.** Animate from a motion description; the start is the object's idle frame. Our
   tiles are **1-direction objects** → do NOT pass `directions`. `frame_count` 8 (v3 also stores the
   reference frame → 9 frames total). No `end_frame_base64`. `animation_description` is a short MOTION phrase.

| animation | apply `animate_object` to | motion prompt |
|---|---|---|
| **door** | the `ground_door` state object | door swings open inward on its hinges, wall + frame stay still |
| **window shutters** | the `ground_window` state object | the two shutters swing closed, wall + frame + sill stay still |

- Door: `animate_object(object_id=<ground_door obj>, animation_description="the wooden plank door swings open
  inward on its hinges, from fully closed to fully open, in smooth steps; the wall, foundation and timber
  door-frame stay perfectly still — only the door leaf moves", frame_count=8, mode="v3")`. Renderer plays
  forward = open, reverse = close (proximity/interaction-triggered).
- Window: `animate_object(object_id=<ground_window obj>, animation_description="the two wooden window shutters
  swing closed from fully open to fully shut, meeting in the middle, in smooth steps; the wall, frame and
  sill stay perfectly still — only the shutters move", frame_count=8, mode="v3")`. Forward = close, reverse = open.
- After each animation completes, `get_object` returns the animation's frame URLs; download ALL 9 frames to
  `tiles/grassland/<material>/anim/<door|window>/frame_NNN.png` for the renderer to play.
- There is an existing PROCEDURAL door-leaf path (`door-leaves.js`) — NOT used for these tiles; the baked
  `animate_object` frames are authoritative.

## Tiling = MIRROR/FLIP alternation (renderer trick, validated)
No cross-fade, no art change. The renderer lays the plain tile then its HORIZONTAL FLIP, alternating
(base · flip · base · flip …). Every seam is the same edge meeting itself (base.right ≡ flip.left), so
it's perfectly seamless — fieldstone proven flawless; timber/wattle seamless with a post-rhythm at joins.
Door/window variants drop into their columns (base or flipped, centred aperture is flip-invariant);
`*_left_corner`/`*_right_corner` tiles cap the two ends (ground tier on the ground storey, upper tier above).
Post-process is just `normalize-blocks.mjs` (strip
debris); verify each tile as a 5-wide mirror-tiled strip (`scripts/flip-tile.mjs`).

## Assembly + wiring (the renderer already exists — `building-tiles.js drawBuildingTiles`)
1. The mirror-tile renderer is built (Round 1). Round-2 wiring deltas: (a) **drop the shared wood overlay**
   (`_overlays/door__v0.png`, `window__v0.png`) and draw the **per-material** `ground_door`/`ground_window`
   tiles in their aperture columns; (b) the exterior draws NO E/W side face (the roof occludes it) — E/W
   framing is the interior corpus; (c) wire the `upper_*` tier (plain, window, left/right corner) for
   storeys>0; (d) pick v0/v1 per building by seeded hash. Tile→state map: `ground_plain` plain wall,
   `ground_door`/`ground_window` apertures, `ground/upper_left_corner` + `ground/upper_right_corner` ends,
   the `upper_*` tier for storeys>0.
2. **Procedural roof** caps the terminal row (the camera/depth). [exterior layer, re-enable later]
3. **Enrich the building-generation platform**: footprint generation tags each footprint tile with its
   identity (face S/E/W/N/interior · aperture plain/window/door · story ground/upper/terminal · edge
   interior/left/right) so the renderer picks the right tile-state. (sim/world/buildings/footprints.js +
   the resolved-building record.)
4. Browser-verify grassland buildings in the seed-42 settlement (tile walls + procedural roof, doors fit
   the character, clean tiling, 3D edges).

## Execution: subagent-driven (user-directed)
Generate (workflow) → post-process → wire engine (subagent) → enrich building-gen (subagent) →
browser-verify (subagent). One material end-to-end as the first vertical slice, then the rest.
