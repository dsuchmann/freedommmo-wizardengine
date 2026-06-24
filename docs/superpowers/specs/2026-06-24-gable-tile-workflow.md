# Gable Tile — generation workflow (NEW building tile-corpus piece)

> 2026-06-24. Hand-off doc for the roof agent to fold into the `building-tile-pipeline` skill.
> This piece is MISSING from the current pilot workflow (which only covers the 9 wall tiles + roof slab).

## What it is + why

The **gable tile** skins the **south roof→wall transition** — the triangular gap between a gable roof's
sloped bottom edge and the flat top of the south wall (the "draw down to the wall top" fill that the roof
renderer's `drawSkirt` produces for `toWall` bridges). On a south-facing **gable end** (ridge runs N–S),
that triangle is architecturally the **gable wall**, so it should read as the wall material carried up into
the triangle — a half-timber/plaster gable — NOT flat colour and NOT the roof shingle texture.

Today (commit `16e3d24b3`) `drawSkirt` fills that bridge **solid with the roof's own colour** (the fix for
the see-through-grass bug — PixelLab textures have transparent holes). That's clean but flat. The gable tile
replaces that flat fill with a real textured gable surface.

## Corpus placement (a new per-MATERIAL tile state)

`assets/pixelab/buildings/tiles/<biome>/<material>/gable__v0.png` (+ `gable__v1.png` for variety).
It is **per wall MATERIAL** (timber_frame / fieldstone / cob / wattle_daub for grassland), because the gable
is the wall carried up — each building's gable must match its own wall. Record the object id in
`tiles/<biome>/_pixellab_ids.json` under a new `gable` key, same as every other tile state.

## Generation method — `create_tiles_pro` (NOT `create_1_direction_object`)

This piece uses a DIFFERENT PixelLab endpoint than the wall base (`create_1_direction_object`) and the roof
slab (`create_1_direction_object` top-down). The gable wants a small **tileset** of flat square gable
surfaces that the roof engine skins per-facet, so:

```
create_tiles_pro({
  description: "<numbered gable variants, per material — see template>",
  tile_type:    "square_topdown",   // flat square tile
  tile_view:    "top-down",         // NO depth — flat (the roof engine does the projection)
  outline_mode: "segmentation",     // RED/BLUE zones, no outline artifacts → cleaner tiles
  tile_size:    64,                 // matches the roof facet texture size
  seed:         <fixed per material for reproducibility>
})
```
Poll `get_tiles_pro(id)` until `completed`; download the tile PNGs the instant they're ready (PixelLab
EXPIRES them).

**Why `create_tiles_pro` + segmentation, not the slab method:** the gable is a small repeated surface skinned
onto a facet, not a single full-bleed background slab. Segmentation mode (no outlines) gives clean,
seamless-tiling pixel art without the gray-outline artifacts of `outline` mode. `square_topdown` + `top-down`
gives a flat square the engine can project onto the gable facet.

## Prompt template (per material — reuses the wall `MATERIAL_FACE` vocabulary)

Frame the gable as the building's UPPER WALL, fully opaque, NO roof/shingles. Apply the corpus-wide hard
rules: **every pixel solid opaque, NO transparent/white background, NO border, NO text**, and (the
`wall ≠ windows` rule) the surface must read as a WALL, never a grid of window-like panels.

> Numbered pixel-art GABLE-END wall tiles for a medieval {BIOME} {MATERIAL_PHRASE} house — flat orthographic
> front elevation, every pixel SOLID OPAQUE filling the whole tile (NO transparent/white background, no
> border): 1). {MATERIAL_FACE} 2). {MATERIAL_FACE} + a horizontal {WALLPLATE} tie-beam 3). {MATERIAL_FACE},
> lightly weathered 4). {MATERIAL_FACE} + a small round gable vent. NO shingles, NO roof, NO window glass,
> NO text, NO letters.

- Grassland timber_frame `{MATERIAL_FACE}`: "textured cream lime-plaster between slender vertical dark-oak studs".
- fieldstone / cob / wattle_daub: reuse each material's `MATERIAL_FACE` from
  `docs/superpowers/specs/2026-06-22-tile-corpus-manifest.md`.

## Post-process (MANDATORY — this is the whole point)

1. **`solidify`** (force opacity) — non-negotiable. PixelLab tiles carry random transparent holes; the gable
   FILLS A GAP, so any hole shows GRASS straight through (this is exactly the bug we just fixed in `drawSkirt`).
   The gable PNG must be 100% opaque inside its bounds.
2. Trim to the square tile; keep it seamless (left edge ≡ right so it tiles horizontally across a wide gable).
3. **QA gate** via `qa-tiles.mjs`: reject if it reads as windows/shingles, has transparent holes, or doesn't
   tile. Retry with a new `seed` or refine the prompt — never ship a flagged tile.

## Renderer integration (for the roof agent)

In `tools/roof/roof-renderer.js drawSkirt`, the `toWall` branch currently fills solid roof colour. Change it to:
1. Receive the building's gable texture via `cfg.gableTex` (plumb it through `drawRoofForBuilding` opts from
   `building-occluder.js`, keyed on the building's **wall material**, not the roof material).
2. Draw an **opaque base coat first** (`sampledBaseColor(cfg.gableTex)` or the roof colour), THEN the gable
   texture on top — same guard as the surface path, so even a holey texture can't show grass.
3. Fall back to the current solid roof-colour fill when no gable texture is loaded (async-safe).

Keep the face-shade overlay (`dShade`) so the gable still reads as sunlit-south.

## Scaling

Pilot = grassland **timber_frame** (this doc's generation). Then the other 3 grassland materials (fieldstone,
cob, wattle_daub) — one `create_tiles_pro` each, same params, material-specific `MATERIAL_FACE`. Then per
biome, driven by the tracker (`desert-pilot-status.mjs` should grow a `gable` column). Pilot-before-burst:
prove timber_frame in-game (textured gable, no see-through, tiles cleanly) before generating the rest.

## Add to the skill

Fold the above into `.claude/skills/building-tile-pipeline/SKILL.md`: add `gable` to the per-material tile
list, the `create_tiles_pro` step (the only piece that uses it), and the solidify-or-grass-shows-through note.
