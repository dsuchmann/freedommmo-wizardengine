# Sorceress Style Guide — FreedomMMO

## Visual target

FreedomMMO should exceed the richness of CrossCode, classic Zelda, and Octopath-style 2D worlds by combining readable pixel-art forms with massive procedural variety.

## Camera/style

- Top-down / three-quarter RPG readability.
- Pixel-art compatible with 32×32 terrain tiles.
- Objects may exceed one tile but must anchor cleanly to tile coordinates.
- Transparent-background layer sheets are preferred.
- No baked lighting unless the layer is explicitly a lighting/shadow mask.

## Layer rule

Generate separable layers, not monolithic finished objects, whenever possible:

1. shadow
2. base/body
3. structural detail
4. foliage/material overlay
5. seasonal overlay
6. damage/state overlay
7. lighting mask

## Variation rule

Each asset family must support combinatorial variation:

- silhouette variants
- material variants
- palette variants
- state overlays
- seasonal overlays
- damage/depletion overlays
- wet/snow/burnt versions

## Output rule

Prefer sprite sheets with regular cells:

- terrain: 32×32 cells
- single-tile object: 32×32 or 32×48 cells
- two-tile object: 64×64 or 64×96 cells
- transparent background
- no UI framing
- no text
- no watermark

## Consistency rule

All generated sheets for a family must share:

- same perspective
- same anchor point
- same scale
- same palette family
- same outline/shading conventions
