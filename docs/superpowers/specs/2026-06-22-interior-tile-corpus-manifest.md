# Grassland INTERIOR Tile Corpus — Manifest + Deterministic Prompts

Companion to `2026-06-22-tile-corpus-manifest.md` (exterior). Interiors are **derived from the same
exterior bases** so the inside of a wall matches its outside, in ONE coherent tile-corpus pipeline. This
**supersedes** the grassland interiors previously made by `bulk_generate_buildings.py` (`edit-images-v2`
faces under `walls/grassland/**`), which were seeded from a different exterior and are unwired — they are
retired for grassland once these land.

## Why derive, not independently generate
Each interior face is a `create_object_state` of its material's **exterior** tile (the same PixelLab object
that already carries that material's exact coursing/plaster pattern). Editing "show the INTERIOR side of
this wall" keeps palette + proportions + tiling locked to the exterior, so a building reads as one solid
structure when you walk in. (The exterior bases must exist first — generation order: exterior bases →
exterior states → interior states.)

## Sizing (identical to exterior — they share the wall grid)
- **64 px/tile**, one tile-object = **256×256 px = 4 tiles wide × 4 tiles tall (one storey)**.
- Interior faces are **storey-agnostic** — no foundation course inside, so one `interior_plain` serves
  ground and upper storeys (unlike the exterior, which splits `ground_plain` / `upper_plain`).

## Corpus = biome(grassland) × material × variant × {interior states}
- **materials (4):** `timber_frame`, `fieldstone`, `cob`, `wattle_daub` (same as exterior).
- **variants (2):** `v0`, `v1` — each interior state derives from the matching exterior **variant** base
  (v1 interior ← v1 exterior), so v0/v1 stay siblings inside and out.
- **interior states (5)** — a derivation tree rooted at the exterior `ground_plain`:

| state id | what it is | `create_object_state` of |
|---|---|---|
| `interior_plain` | BASE interior face: smooth finished surface, warm tone, baseboard + top trim, no weathering, tileable | exterior `ground_plain` |
| `interior_window` | + the interior reveal/sill of a window, centred | `interior_plain` |
| `interior_door` | + the interior side of a plank door in its frame, centred, CLOSED, reaching the floor | `interior_plain` |
| `interior_archway` | an open internal passage (no door), dark threshold — for unit-to-unit openings (a STATIC opening, not an animated door) | `interior_plain` |

→ 4 states × 4 materials × 2 variants = **32 interior tile-objects** (all `create_object_state`; 0 new
`create_1_direction_object` — they all trace back to the exterior bases).

**Door MOTION = `animate_object` ONLY (NON-NEGOTIABLE, same rule as exterior).** `interior_door` is a STATE
of `interior_plain`; its open/close motion is a real `animate_object` applied to THAT object — played forward
to open, reverse to close. Do NOT generate an `interior_door_open` state to fake it, and do NOT composite a
separate leaf sprite. So per material×variant: **4 PixelLab objects + 1 animation** (`animate_object` on
`interior_door`). `interior_archway` is a genuinely separate static opening (no door leaf) — it does not
animate. `interior_window` is a static reveal (window shutters are an exterior feature) — it does not animate.
Across 4 materials × 2 variants = **32 generated objects + 8 animations**.

## Deterministic prompt — `interior_plain` (derive from exterior `ground_plain`)
> Show the INTERIOR side of this same wall, as seen from inside the room. Replace the outer face with a
> SMOOTH FINISHED INTERIOR SURFACE in keeping with the material ({INTERIOR_FACE}); WARMER, cleaner tone with
> NO exterior weather-staining, moss, or grass. Add a subtle {INTERIOR_TRIM}: a low baseboard along the
> bottom edge and a slim top rail along the top edge. CRITICAL: every pixel inside the wall rectangle is
> SOLID OPAQUE (no transparent or see-through gaps); only OUTSIDE the rectangle is transparent. Keep the
> exact width, height, and horizontal tiling of the source so it still mirror-tiles (left edge ≡ right). NO
> door, NO window, NO foundation course, NO roof, NO furniture, NO people. Clean high-resolution pixel art.

INTERIOR_FACE (the finished inner surface per material):
- fieldstone: "a smooth pale lime-plastered surface over the stone, warm cream, evenly opaque"
- cob: "a smooth warm ochre lime-washed cob surface, evenly opaque"
- timber_frame: "cream lime-plaster panels between dark-oak studs, seen from inside, evenly opaque"
- wattle_daub: "smooth whitewashed daub panels between slender studs, seen from inside, evenly opaque"

INTERIOR_TRIM (baseboard + top rail per material):
- fieldstone / cob: "dark timber baseboard and top rail"
- timber_frame / wattle_daub: "dark-oak baseboard and top rail matching the studs"

## Deterministic STATE edits (`create_object_state`)
- `interior_window`: "Add the INTERIOR reveal of ONE window centred in the wall, about 1 tile wide and 1.2
  tiles tall: a recessed timber-framed opening with a sill and a hint of daylight beyond. Keep the interior
  surface, baseboard, top rail, proportions, and tiling EXACTLY the same — change nothing else."
- `interior_door`: "Add the INTERIOR side of a LARGE wooden plank DOOR centred at the base of the wall,
  CLOSED. SIZE & PLACEMENT: the door is TALL and WIDE and reaches the FLOOR — its bottom edge extends all the
  way DOWN to the very bottom edge of the image (the floor line), with NO baseboard or strip visible beneath
  it; it spans about 90% of the wall's height (about 230 of 256 pixels) and about half the width (2 tiles,
  ~130 of 256 pixels) — big enough for an adult to walk through standing upright. Set into a timber
  door-frame. Keep the interior surface, baseboard to the LEFT and RIGHT of the door, top rail, and
  proportions identical — change nothing else." (Its open MOTION is an `animate_object` on this object — see
  *Animations*; there is NO separate `interior_door_open` state tile.)
- `interior_archway`: "Cut an OPEN ARCHWAY passage through this wall, centred, about 2 tiles wide and 3
  tiles tall, reaching the floor, with a finished timber or plastered surround and a dark threshold beyond
  (NO door leaf — this is a permanent opening). Keep the interior surface, baseboard to the sides,
  proportions, and tiling identical."

## Animations (`animate_object` on the `interior_door` state — NON-NEGOTIABLE)
Same rule as the exterior manifest: the door is a STATE (`interior_door`), and its open/close MOTION is a
real multi-frame `animate_object` on that object (mode `v3`, 1-direction → no `directions`, `frame_count` 8).
Played forward = open, reverse = close. No `interior_door_open` state; no leaf compositing.
- `animate_object(object_id=<interior_door obj>, animation_description="the wooden plank door swings open
  inward on its hinges, from fully closed to fully open, in smooth steps; the interior wall and timber
  door-frame stay perfectly still — only the door leaf moves", frame_count=8, mode="v3")`.
- Download all 9 frames to `tiles/grassland/<material>/anim/interior_door/frame_NNN.png` for the renderer.

## Opacity + tiling (same rules as exterior)
- **Opacity enforced in code** — PixelLab interior faces can come back with holes; run `solidify.mjs` on
  every interior tile (guaranteed-opaque rectangle = clean mirror-tiling). Plaster/whitewash usually solid,
  but never trusted.
- **Mirror/flip tiling** — `interior_plain` lays then horizontal-flips (base · flip · base · flip), seamless.
  `interior_window` / `interior_door` / `interior_archway` drop into their centred columns (flip-invariant).
- Post-process chain (reuse exterior scripts): `normalize-blocks.mjs` (strip any added furniture/debris) →
  `solidify.mjs` (fill holes) → `flip-tile.mjs` (verify seam).

## Naming + on-disk layout (co-located with the exterior corpus = single source of truth)
```
assets/pixelab/buildings/tiles/grassland/<material>/
  interior_plain__v{0,1}.png
  interior_window__v{0,1}.png
  interior_door__v{0,1}.png
  interior_door_open__v{0,1}.png
  interior_archway__v{0,1}.png
```
Tracking: extend `assets/pixelab/buildings/tiles/grassland/_corpus.json` with an `interior_states_v0` /
`interior_states_v1` section (object IDs per material per state), parallel to `states_v0`.

## Wiring (after generation — interior layer is already ON)
`src/render/interior-renderer.js` + `building-renderer.js` currently load interior faces from the generic
`/walls/stone_brick_tiles/` fallback. Round-2 wiring: resolve interior wall images per (biome, material)
from `tiles/grassland/<material>/interior_*`, threading the building's `biome` + `wallSlug` through the
loader; fall back to `stone_brick_tiles` only when a biome/material has no interior corpus yet.
- `interior_plain` → N / E / W / S interior faces (the side pilasters + back wall). **This is the E/W side
  framing** — what we almost made an exterior `side_ew` tile. It belongs here: the exterior side is hidden
  by the roof, so the only E/W face you ever see is the *interior* one.
- `interior_door` / `interior_door_open` → the unit/entry doors. `interior_archway` → unit-to-unit openings.
- `interior_window` → interior side of exterior windows.
- **Under a transparent roof (player inside):** the E/W edges additionally show a THIN sliver of the
  building's EXTERIOR material so the wall reads as having thickness (interior face inside, a thin exterior
  face at the very edge). This reuses the exterior `*_plain` tile drawn as a thin strip — a renderer detail,
  NO new generated object. Deferred to the interior+roof pass.

## Generation plan (depends on the exterior round)
1. Exterior round generates the v0+v1 **bases** (8 `create_1_direction_object`) — interiors need these IDs.
2. For each material × variant: `interior_plain` = `create_object_state(ground_plain base id)`.
3. From each `interior_plain`: `interior_window`, `interior_door`, `interior_archway`; from `interior_door`:
   `interior_door_open`. (4 + 1 = 5 states.)
4. Post-process (normalize → solidify → flip-verify). 5. Record IDs in `_corpus.json`. 6. Wire the renderer.

## Scope note (deliberately deferred)
- **Floors** are OUT (user-deferred) and are generic/shared across biomes anyway (`floors/<material>/` wang
  tilesets) — no biome round needed.
- **Interior wear states** (weathered / damaged / mossy), which the retired bulk pipeline had, are NOT in
  this pilot. Add later as extra `create_object_state` edits of `interior_plain` if interiors read too uniform.
