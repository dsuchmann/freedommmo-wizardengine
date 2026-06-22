# Façade Component-Block Manifest (grassland pilot)

The library of generatable building **component pieces**, the generation recipe, the post-process
pipeline, and the per-piece **metadata schema**. This is the authority for what we generate and how.

## Non-negotiable constraints (the lessons)
1. **Orthographic — NO vanishing point, NOT isometric.** It's a 2D game; parallel projection only.
   → generate walls with PixelLab **`view: "side"`** (flat front elevation; proven clean on
   chapel/temple). `low top-down` drifts isometric/perspective — banned for walls.
2. **Use the alpha-native object generator, NOT `create_map_object`.** `create_map_object` ALWAYS
   returns an opaque matte (verified 100% opaque, RGBA all-255) — that was the white-box bug.
   `create_1_direction_object` (view `sidescroller`) returns REAL alpha (verified 32.9% transparent,
   min α=0), exactly like the flora/doors. The border-flood key stays only as a fallback.
3. **Verify over a DARK background AND over grass**, and sample alpha. Never judge over a light
   canvas (that hid the white boxes last time).
4. **Decompose, don't whole-stamp.** Foundation only at base, roof only at top, wall-slice tiles.
5. **Detect door/window/entry metadata** from the art (vision pass, once per asset).
6. **Camera ratio.** The good in-game look the prior tile-build had (roofs RECEDING = depth, shapes
   reading, a south-wall band below) comes from the game's ¾ orthographic projection + the **TOP-DOWN
   procedural roof**. KEEP the procedural roof for depth/camera. Facade blocks supply only the **flat
   WALL band** (sized to the 4-tile wall height); the roof is the procedural top-down receding surface —
   NOT the flat gable that a front-elevation generation bakes on (crop that off, or generate roofs in
   `high top-down`).

## Consistency — ONE base object per (biome × material × variant); derive the rest
Blocks must NOT be independent generations — separate generations drift in plaster pattern, timber
rhythm, and tone, so an assembled building looks patchwork. Generate ONE base "complete building" per
biome×material×variant, then derive EVERY primitive from it so they share the exact art:
- **crop** → geometric subsets: wall-slice (no roof/foundation), roof-cap, foundation, ground/upper slices.
- **`create_object_state`** → content/aperture variants sharing the base art: door↔window (no-door bay),
  door open/closed, shutters open/closed, lit-at-night, weathered (grouped via group_id).
- **`style_image`** (on `create_1/8_direction_object`) → SHAPE variants needing fresh geometry (round,
  triangular, curved) that inherit the base's STYLE by passing the base as the style reference.
- **`create_8_direction_object`** → the directional/rotation set (south facade + edges + corners) of the
  same object, so every face matches.
Everything traces to one base → reliably consistent. (The pilot's separate entry+bay generations were
wrong — they drift. Derive the bay as a STATE of the base instead.)

## Axes
`biome × material × variant × shape`. Pilot biome = **grassland**. Pilot material =
**timber_frame** (cream plaster + dark oak frame + fieldstone foundation). Other grassland
materials (cob, fieldstone, wattle_daub, thatch-dominant) follow the same recipe.

## Piece taxonomy (roles)
| role | piece | what it is | view | tiles |
|---|---|---|---|---|
| facade | `facade_entry` | south wall, centered **door** + flanking windows | side | ≤12 w |
| facade | `facade_window` | south wall, **windows only** (no door) — for tiling wide fronts | side | ≤12 w |
| facade | `facade_plain` | south wall, blank (rare filler) | side | ≤12 w |
| edge | `edge_plain` | E/W side face (thin wall + eave) | side | depth |
| edge | `edge_porch` | E/W **wraparound porch** along the side | side | depth |
| corner | `corner_plain` | SE/SW corner (the face the building turns into) | side | 1 |
| corner | `corner_porch` | SE/SW corner carrying the porch wrap | side | 1 |
| roof | *(procedural default)* | the existing footprint-driven roof engine (orthographic, any depth) | — | any |
| roof | `roof_block` *(alt)* | top-down roof slope/ridge/endcap, tiled N→S for depth | high top-down | depth |
| shape | `portico` / `wing` / `round` | non-rect section facades | side | ≤12 |

Each **facade** is generated **complete** (roof + wall + foundation in one side-view image), then
**decomposed** into: `roof_cap` (top), `wall_slice` (middle — the tileable floor, no roof/foundation),
`foundation_course` (base). The slice is cropped from the same art → tiles seam-clean, material matches.

## Generation recipe (per facade piece)
- **`create_1_direction_object`, `view: "sidescroller"`, `size: 256`** (= 8 tiles at native 32px/tile;
  256 is the max). Alpha-native, no keying needed. ~5–7 min/object. Use **`create_8_direction_object`**
  for the directional/rotation set (south facade + edges + corners) in one call. (`create_map_object`
  is banned — opaque only.)
- Prompt spine: *"Orthographic FLAT FRONT ELEVATION (straight-on, NO perspective, NO vanishing point,
  NOT isometric) of a grassland village building front, timber-frame: cream lime-plaster panels with
  dark oak timber framing, a low grey fieldstone foundation course at the base, [APERTURES], a simple
  gabled wood-shingle roof above. Clean readable pixel art, single-color outline, detailed shading,
  warm cozy palette, transparent background."* + subject/apertures.
- Blueprint feeds **prompt guidance** (door count, role, grandeur, material), never coordinates.

## Post-process pipeline (`scripts/gen-blocks.mjs`, to build)
1. **Key background** → transparent: flood/chroma-key the near-white (`>238` on all channels, low
   saturation) connected to the image border. (NOT a bottom-band-only key — the whole surround.)
2. **Decompose** at measured horizontal bands: find `roofBottom` (eave line, where the roof color
   gives way to the wall body), `wallBottom` (top of the foundation course), `groundBottom`. Emit
   `roof_cap` [0..roofBottom], `wall_slice` [roofBottom..wallBottom], `foundation` [wallBottom..end].
3. **Detect metadata** (vision, me at pilot scale): door leaf rect + entry tile, window rects — in px
   and tile coords. Store seam tokens (left/right edge material) for abutment.
4. **Verify**: emit a composite of each piece over DARK + over a grass tile; I read those, not a light bg.

## Metadata schema (per piece, `blocks-manifest.json`)
```
{ "id":"timber_frame/facade_entry__v0", "material":"timber_frame", "role":"facade_entry",
  "tilesW":8, "px":[w,h],
  "bands": { "roofCap":[0,Y1], "wallSlice":[Y1,Y2], "foundation":[Y2,H] },
  "door":   { "leaf":[x0,y0,x1,y1], "entryTile":[tx,ty] },
  "windows":[ [x0,y0,x1,y1], ... ],
  "seam":   { "left":"timber_A", "right":"timber_A", "cap":true } }
```

## Assembly (driven by the placement/occupancy plan)
- Width → tile `facade_entry` + `facade_window`(×k) across the exposed south edge, `corner_*` at the
  ends, cap/cornice over the joins.
- Depth → **roof** (procedural over the footprint, orthographic; or `roof_block` tiled N→S).
- Height → `foundation` (base) + `wall_slice` ×stories + `roof_cap`/procedural roof (top).
- Edges → `edge_*` pieces along E/W per the plan's per-edge treatment (plain/porch/…).
- Interior (existing system) reads the same sections + floor count + material → stays consistent.

## Edge coherency / plan extension
Ambitious buildings need per-edge treatments in the **plan** (which edges have porches/balconies),
because assembled buildings can't be derived from one image. Small standalone buildings = one
complete generated piece (+ detection). The biome×material×variant family + the seam contract
(matching body, cap, corner pieces, matching roof) keep adjacent blocks AND adjacent buildings coherent.

## Grassland — full scope (the generation set)
- **Materials (4):** `timber_frame`, `fieldstone`, `cob`, `wattle_daub`.
- **Variants (2 each):** `v0`, `v1` → **8 base buildings** (generated via `create_1_direction_object`,
  `sidescroller`, 256px, real alpha). This is the ENTIRE paid generation set — everything else derives:
- **Derived per base (crop / state / rotation — no extra full generation):**
  - `wall_slice` (crop, no roof/foundation) — the tileable floor.
  - `foundation` (crop) — base only.   `ground_floor` (crop, door+lower) — base only.
  - `no_door_bay` — `create_object_state` ("door→window") or style-referenced gen.
  - `door_open` / `shutters_open` / `lit_night` — `create_object_state` (content states).
  - `edge` / `corner` directional set — `create_8_direction_object` of the base (or mirror E↔W).
  - `round` / `portico` shape — fresh gen with the base as `style_image` (inherits the art).
- **Roof:** PROCEDURAL (top-down, the good camera) — generate only a few `roof_top` textures
  (thatch / wood_shingle / clay_tile / turf) per biome, not roof geometry.

## Assembly & wiring — blueprint ↔ blocks (the interplay)
The blueprint/placement system is the source of truth (location · sections · floors · material ·
door/window tiles). **It may be extended** (user-approved) to emit assembly-ready data and more
interesting shapes:
- sections **quantized** to ≤8-tile patches (the block size);
- a **shape tag** per section (`rect` / `round` / `wing` / …);
- a **per-edge treatment** (`plain` / `porch` / …);
- **material** per section; door/window tiles aligned to block apertures.

`decompose(footprint)` → patches → classify by exposed edges (`facade` / `edge` / `corner` /
`roof-only` / `round`) → look up the block in the library by `(biome, material, variant, role, shape)`
→ place at the patch (anchored to the south edge, scaled to 8-tile native). Then the **procedural roof**
draws over the footprint union (the camera). Door/window metadata aligns walk-in + the door-leaf.
This **replaces** `building-facade.js` (the whole-stamp path); the interior system is unchanged (same
sections). Verify in-game against the prior build's camera before scaling materials/biomes.

## PILOT — generate NOW (validate the core end-to-end)
Grassland · timber_frame · `view: side` · orthographic:
1. `facade_entry__v0` — centered plank door + 2 shuttered windows.
2. `facade_window__v0` — 3 shuttered windows, no door (tiling filler).
3. `facade_entry__v1` — variant (different framing rhythm / window style).

Then: key bg → decompose → detect metadata → **assemble & verify over dark + grass**: (a) single
1-story building, (b) 2-story stack (foundation + 2 slices + roof), (c) a wide front (entry + window
tiled + caps). Prove: no white box, orthographic, decompose/stack/tile works, door metadata lands.
Edges/corners/porches/roof-blocks + more materials follow once the core is proven.
