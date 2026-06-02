# PixelLab Landscape V2 Assets

Coherent horizontal terrain assembly library for FreedomMMO / WizardGenie.

Every asset belongs to a layer, every layer has a role, every asset can be selected deterministically from tile state via `landscapeRecipe(tile)`.

## Layer Stack

| Layer | Role | Alpha | Directory |
|-------|------|-------|-----------|
| 1 | Opaque base terrain / Wang tile | No | `base/` |
| 2 | Terrain form structure (cliff/step/slope) | Yes | `surface_overlays/structure_*/` |
| 3 | Surface overlays (mud pools, wet shine, snow) | Yes | `surface_overlays/` |
| 4 | Micro alpha decals (soil, ground cover, blades) | Yes | `micro/` |
| 5 | Medium dressing sprites (reeds, bushes, roots) | Yes | `medium/` |
| 6 | Gameplay objects (trees, harvest nodes) | Yes | `objects/` |
| 7 | Runtime lighting / atmosphere | N/A | runtime |

## Current Generation Status

- **Phase**: Swamp / wet mud / mud pool calibration batch
- **Manifest**: `manifest.json`
- **Prompts**: `prompts/generated_prompts.jsonl`
- **Audit**: `audit/`

## Art Requirements

- 32x32 source, 16x16 display
- PNG, RGBA for alpha layers, opaque for base
- Pixel-perfect, nearest-neighbor compatible
- No black outlines unless explicitly requested for objects
- No baked UI, labels, or perspective shadows
- Consistent color palette per biome family

## Naming Convention

`{material}__{biome}__{layer_type}__{variant}.png`

Examples:
```
wet_mud__swamp__wang_07__v003.png
moss_ground_cover__swamp__micro__density_medium__v012.png
reed_cluster__swamp__medium__variant_041.png
```

## Seed Scheme

```
base tiles:       100000000 + familyIndex * 100000 + variant
wang tiles:       200000000 + familyIndex * 100000 + mask * 1000 + variant
transitions:      300000000 + transitionIndex * 100000 + mask * 1000 + variant
surface overlays: 400000000 + familyIndex * 100000 + variant
micro:            500000000 + familyIndex * 100000 + variant
medium:           600000000 + familyIndex * 100000 + variant
objects:          700000000 + familyIndex * 100000 + variant
structure:        800000000 + familyIndex * 100000 + variant
```

## Alignment

Assets must align with `src/render/landscape-recipe.js` output. The renderer calls `landscapeRecipe(tile)` to determine which layers and families are allowed for each tile.
